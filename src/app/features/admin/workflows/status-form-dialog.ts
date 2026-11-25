import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CreateDto } from '@core/models/entity.model';
import { isApiError } from '@core/models/api-error.model';
import { ToastService } from '@core/notifications/toast.service';
import { StatusesApi, StatusLookup } from '@domain/workflow/workflow.api';
import { Status, STATUS_CATEGORIES, STATUS_CATEGORY_LABELS, StatusCategory, StatusScope } from '@domain/workflow/workflow.models';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { HELP } from '@shared/help/help-texts';
import { HelpTip } from '@shared/ui/help-tip/help-tip';
import { fieldErrors, splitErrors } from '../shared/api-errors';
import { ColorField } from '../shared/color-field';

export interface StatusFormData {
  /** `null` creates a status; `scope` pre-selects the group it is created from. */
  readonly status: Status | null;
  readonly scope: StatusScope;
}

const STATUS_CONTROLS: readonly string[] = ['key', 'name', 'color', 'category', 'scope'];

export const SCOPE_LABELS: Record<StatusScope, string> = { project: 'حالات المشاريع', 'work-item': 'حالات الأعمال' };

@Component({
  selector: 'app-status-form-dialog',
  imports: [ReactiveFormsModule, DialogShell, ColorField, HelpTip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell [title]="editing ? 'تعديل حالة' : 'حالة جديدة'" subtitle="الحالات لا تُحذف نهائيًا؛ عطّلها بدلًا من ذلك (FR-WF-06).">
      <form id="status-form" [formGroup]="form" (ngSubmit)="save()" class="form-grid">
        <div class="field">
          <label for="s-key">المفتاح الداخلي <span class="req">*</span></label>
          <input id="s-key" class="input ltr" formControlName="key" autocomplete="off" />
          <span class="hint">{{ editing ? 'ثابت ولا يتغير.' : 'ثابت بعد الإنشاء: حروف إنجليزية صغيرة وأرقام و_.' }}</span>
          @if (form.controls.key.touched && form.controls.key.invalid) {
            <span class="error">مفتاح غير صالح.</span>
          }
          @if (srv()['key']; as msg) { <span class="error" role="alert">{{ msg }}</span> }
        </div>
        <div class="field">
          <label for="s-name">الاسم <span class="req">*</span></label>
          <input id="s-name" class="input" formControlName="name" [attr.aria-invalid]="srv()['name'] ? 'true' : null" />
          @if (form.controls.name.touched && form.controls.name.invalid) { <span class="error">الاسم مطلوب.</span> }
          @if (srv()['name']; as msg) { <span class="error" role="alert">{{ msg }}</span> }
        </div>
        <div class="field span-2">
          <label for="s-desc">الوصف</label>
          <textarea id="s-desc" class="textarea" formControlName="description"></textarea>
        </div>
        <div class="field">
          <label for="s-cat">فئة الحالة (ثابتة) <span class="req">*</span> <app-help-tip [text]="categoryHelp" /></label>
          <select id="s-cat" class="select" formControlName="category">
            @for (c of categories; track c) {
              <option [value]="c">{{ categoryLabels[c] }}</option>
            }
          </select>
          <span class="hint">تعتمد عليه التقارير وإحصاءات الإنجاز.</span>
          @if (srv()['category']; as msg) { <span class="error" role="alert">{{ msg }}</span> }
        </div>
        <div class="field">
          <label for="s-scope">النطاق <app-help-tip [text]="scopeHelp" /></label>
          <select id="s-scope" class="select" formControlName="scope">
            <option value="project">{{ scopeLabels.project }}</option>
            <option value="work-item">{{ scopeLabels['work-item'] }}</option>
          </select>
          @if (editing) {
            <span class="hint">لا يتغير بعد الإنشاء.</span>
          }
          @if (srv()['scope']; as msg) { <span class="error" role="alert">{{ msg }}</span> }
        </div>
        <div class="field">
          <span class="lbl">اللون</span>
          <app-color-field formControlName="color" />
          @if (srv()['color']; as msg) { <span class="error" role="alert">{{ msg }}</span> }
        </div>
        <div class="field">
          <label for="s-order">الترتيب</label>
          <input id="s-order" class="input" type="number" min="0" formControlName="order" />
        </div>
        @for (d of rest(); track d[0]) {
          <p class="error span-2" role="alert">{{ d[1] }}</p>
        }
      </form>
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إلغاء</button>
        <button type="submit" form="status-form" class="btn btn--primary" [disabled]="saving()">{{ saving() ? 'جارٍ الحفظ…' : editing ? 'حفظ' : 'إنشاء الحالة' }}</button>
      </ng-container>
    </app-dialog-shell>
  `,
  styles: `
    .lbl { font-size: var(--fs-sm); font-weight: 600; color: var(--c-text-2); }
    .error { font-size: var(--fs-xs); color: var(--c-danger); }
  `,
})
export class StatusFormDialog {
  protected readonly ref = inject<DialogRef<Status>>(DialogRef);
  private readonly data = inject(DIALOG_DATA) as StatusFormData;
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(StatusesApi);
  private readonly lookup = inject(StatusLookup);
  private readonly toast = inject(ToastService);

  protected readonly editing = this.data.status;
  protected readonly categories = STATUS_CATEGORIES;
  protected readonly categoryLabels = STATUS_CATEGORY_LABELS;
  protected readonly scopeLabels = SCOPE_LABELS;
  protected readonly saving = signal(false);
  protected readonly categoryHelp = HELP.statusCategory;
  protected readonly scopeHelp = HELP.statusScope;
  private readonly serverDetails = signal<Readonly<Record<string, string>>>({});
  protected readonly srv = computed(() => splitErrors(this.serverDetails(), STATUS_CONTROLS).mapped);
  protected readonly rest = computed(() => splitErrors(this.serverDetails(), STATUS_CONTROLS).rest);

  protected readonly form = this.fb.group({
    key: this.fb.control({ value: this.editing?.key ?? '', disabled: !!this.editing }, [
      Validators.required,
      Validators.pattern(/^[a-z][a-z0-9_]{1,30}$/),
    ]),
    name: this.fb.control(this.editing?.name ?? '', Validators.required),
    description: this.fb.control(this.editing?.description ?? ''),
    color: this.fb.control(this.editing?.color ?? '#2f6fb5'),
    category: this.fb.control<StatusCategory>(this.editing?.category ?? 'active'),
    scope: this.fb.control<StatusScope>({ value: this.editing?.scope ?? this.data.scope, disabled: !!this.editing }),
    order: this.fb.control(this.editing?.order ?? this.lookup.items().length + 1),
  });

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const common = {
      name: v.name.trim(),
      description: v.description.trim(),
      color: v.color,
      category: v.category,
      order: v.order,
    };
    const create: CreateDto<Status> = { ...common, key: v.key, scope: v.scope, active: true };
    const request$ = this.editing
      ? this.api.update(this.editing.id, { ...common, version: this.editing.version })
      : this.api.create(create);

    this.saving.set(true);
    this.serverDetails.set({});
    request$.subscribe({
      next: (saved) => {
        this.lookup.reload();
        this.toast.success('تم حفظ الحالة');
        this.ref.close(saved);
      },
      error: (e: unknown) => {
        this.saving.set(false);
        if (this.editing && isApiError(e) && e.status === 409) {
          // Stale version: the interceptor toasted the message; reload and close so the next edit starts fresh.
          this.lookup.reload();
          this.ref.close();
          return;
        }
        this.serverDetails.set(fieldErrors(e));
      },
    });
  }
}
