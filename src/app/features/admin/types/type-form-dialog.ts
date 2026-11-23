import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { take } from 'rxjs';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '@core/auth/auth.service';
import { isApiError } from '@core/models/api-error.model';
import { ToastService } from '@core/notifications/toast.service';
import { CreateDto } from '@core/models/entity.model';
import { WorkItemTypeLookup, WorkItemTypesApi } from '@domain/work-items/work-item.api';
import { IconName, WorkItemType } from '@domain/work-items/work-item.models';
import { WorkflowLookup } from '@domain/workflow/workflow.api';
import { DIALOG_DATA, DialogRef, DialogService } from '@shared/ui/dialog/dialog.service';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { Icon } from '@shared/ui/icon/icon';
import { errorEntries, fieldErrors, isConflict } from '../shared/api-errors';
import { ColorField } from '../shared/color-field';
import { FieldsEditor } from './fields-editor';
import {
  createFieldForm,
  ICON_LABELS,
  ICON_NAMES,
  KEY_PATTERN,
  toFieldDefinition,
  uniqueFieldKeys,
  FieldForm,
  mapTypeErrors,
  MappedTypeErrors,
  sortFieldsByOrder,
} from './type-form.models';
import { TypeHistoryData, TypeHistoryDialog } from './type-history-dialog';

export interface TypeFormData {
  /** `null` creates a new type. */
  readonly type: WorkItemType | null;
}

@Component({
  selector: 'app-type-form-dialog',
  imports: [ReactiveFormsModule, DialogShell, ColorField, Icon, FieldsEditor],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './type-form-dialog.scss',
  template: `
    <app-dialog-shell [title]="editing ? 'تعديل نوع العنصر' : 'نوع جديد'" subtitle="الأنواع لا تُحذف؛ يمكن تعطيلها فقط (FR-TYP-09).">
      @if (editing && canSeeHistory()) {
        <div class="history-row">
          <button type="button" class="btn btn--outline btn--sm" (click)="openHistory()"><app-icon name="history" [size]="14" /> سجل التعديلات</button>
        </div>
      }
      <form id="type-form" [formGroup]="form" (ngSubmit)="save()" class="stack">
        <div class="form-grid">
          <div class="field">
            <label for="t-key">المفتاح الداخلي <span class="req">*</span></label>
            <input id="t-key" class="input ltr" formControlName="key" placeholder="task" autocomplete="off" />
            @if (editing) {
              <span class="hint">المفتاح ثابت ولا يمكن تغييره.</span>
            } @else {
              <span class="hint">لا يمكن تغيير المفتاح أبدًا بعد الإنشاء. حروف إنجليزية صغيرة وأرقام و_.</span>
              @if (form.controls.key.touched && form.controls.key.invalid) {
                <span class="error">استخدم أحرفًا إنجليزية صغيرة وأرقامًا و _ فقط، وابدأ بحرف (2–31 حرفًا)</span>
              }
            }
            @if (server().top['key']; as msg) { <span class="error" role="alert">{{ msg }}</span> }
          </div>
          <div class="field">
            <label for="t-name">الاسم <span class="req">*</span></label>
            <input id="t-name" class="input" formControlName="name" [attr.aria-invalid]="server().top['name'] ? 'true' : null" />
            @if (server().top['name']; as msg) { <span class="error" role="alert">{{ msg }}</span> }
          </div>
          <div class="field span-2">
            <label for="t-desc">الوصف</label>
            <textarea id="t-desc" class="textarea" formControlName="description"></textarea>
          </div>
          <div class="field">
            <span class="lbl">اللون</span>
            <app-color-field formControlName="color" />
          </div>
          <div class="field">
            <label for="t-order">الترتيب</label>
            <input id="t-order" class="input" type="number" min="0" formControlName="order" />
          </div>
          <div class="field span-2">
            <span class="lbl" id="t-icon">الأيقونة</span>
            <div class="icons" role="radiogroup" aria-labelledby="t-icon">
              @for (name of icons; track name) {
                <button type="button" class="ico" role="radio" [attr.aria-checked]="form.controls.icon.value === name"
                  [class.on]="form.controls.icon.value === name" [style.--sw]="form.controls.color.value" (click)="form.controls.icon.setValue(name)">
                  <app-icon [name]="name" [size]="18" />
                  <span>{{ iconLabels[name] }}</span>
                </button>
              }
            </div>
          </div>
          <div class="field">
            <label for="t-wf">سير العمل <span class="req">*</span></label>
            <select id="t-wf" class="select" formControlName="workflowId">
              <option value="">— اختر —</option>
              @for (w of workflows(); track w.id) {
                <option [value]="w.id">{{ w.name }}</option>
              }
            </select>
            @if (server().top['workflowId']; as msg) { <span class="error" role="alert">{{ msg }}</span> }
          </div>
          <label class="checkbox active-box"><input type="checkbox" formControlName="active" /> نشط</label>
          <fieldset class="field span-2 children">
            <legend>الأنواع المسموحة كأبناء مباشرين (FR-REL-01)</legend>
            <div class="chk-list">
              @for (t of otherTypes(); track t.id) {
                <label class="checkbox">
                  <input type="checkbox" [checked]="childIds().includes(t.id)" (change)="toggleChild(t.id, $any($event.target).checked)" />
                  {{ t.name }}
                </label>
              } @empty {
                <span class="muted">لا توجد أنواع أخرى.</span>
              }
            </div>
          </fieldset>
        </div>

        <app-fields-editor [array]="form.controls.fields" [serverErrors]="server().byField" />

        @if (conflicts().length) {
          <div class="conflicts" role="alert">
            <strong>{{ conflictMessage() }}</strong>
            <ul>
              @for (c of conflicts(); track c[0]) {
                <li>«{{ c[0] }}»: {{ c[1] }}</li>
              }
            </ul>
            <p>انقل العناصر أولًا إلى حالة موجودة في سير العمل الجديد (من لوحة العناصر أو الإجراءات الجماعية)، ثم أعد حفظ النوع.</p>
          </div>
        }
        @for (d of server().general; track d) {
          <p class="error" role="alert">{{ d }}</p>
        }
      </form>
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إلغاء</button>
        <button type="submit" form="type-form" class="btn btn--primary" [disabled]="saving()">{{ saving() ? 'جارٍ الحفظ…' : editing ? 'حفظ' : 'إنشاء النوع' }}</button>
      </ng-container>
    </app-dialog-shell>
  `,
})
export class TypeFormDialog {
  protected readonly ref = inject<DialogRef<WorkItemType>>(DialogRef);
  private readonly data = inject(DIALOG_DATA) as TypeFormData;
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(WorkItemTypesApi);
  private readonly lookup = inject(WorkItemTypeLookup);
  private readonly toast = inject(ToastService);

  protected readonly editing = this.data.type;
  protected readonly icons = ICON_NAMES;
  protected readonly iconLabels = ICON_LABELS;
  protected readonly saving = signal(false);
  protected readonly conflicts = signal<readonly (readonly [string, string])[]>([]);
  protected readonly conflictMessage = signal('');
  protected readonly server = signal<MappedTypeErrors>(mapTypeErrors(undefined));
  private readonly dialogs = inject(DialogService);
  private readonly auth = inject(AuthService);
  protected readonly canSeeHistory = computed(() => this.auth.can('audit.view'));

  private readonly workflowLookup = inject(WorkflowLookup);
  protected readonly workflows = computed(() => this.workflowLookup.items().filter((w) => w.scope === 'work-item'));
  protected readonly otherTypes = computed(() => this.lookup.items());
  protected readonly childIds = signal<readonly string[]>(this.editing?.allowedChildTypeIds ?? []);

  protected readonly form = this.fb.group({
    key: this.fb.control(
      { value: this.editing?.key ?? '', disabled: !!this.editing },
      [Validators.required, Validators.pattern(KEY_PATTERN)],
    ),
    name: this.fb.control(this.editing?.name ?? '', Validators.required),
    description: this.fb.control(this.editing?.description ?? ''),
    color: this.fb.control(this.editing?.color ?? '#14614a'),
    icon: this.fb.control<IconName>(this.editing?.icon ?? 'task'),
    order: this.fb.control(this.editing?.order ?? this.lookup.items().length + 1),
    workflowId: this.fb.control(this.editing?.workflowId ?? '', Validators.required),
    active: this.fb.control(this.editing?.active ?? true),
    fields: this.fb.array<FieldForm>(sortFieldsByOrder(this.editing?.fields ?? []).map((f) => createFieldForm(this.fb, f)), uniqueFieldKeys),
  });

  protected openHistory(): void {
    if (!this.editing) return;
    this.dialogs.open<TypeHistoryDialog, TypeHistoryData>(TypeHistoryDialog, {
      data: { typeId: this.editing.id, typeName: this.editing.name },
      width: 'min(720px, calc(100vw - 32px))',
    });
  }

  protected toggleChild(id: string, checked: boolean): void {
    this.childIds.update((ids) => (checked ? [...ids.filter((i) => i !== id), id] : ids.filter((i) => i !== id)));
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const common: Omit<CreateDto<WorkItemType>, 'key'> = {
      name: v.name.trim(),
      description: v.description.trim(),
      color: v.color,
      icon: v.icon,
      order: v.order,
      active: v.active,
      workflowId: v.workflowId,
      fields: this.form.controls.fields.controls.map((row, i) => toFieldDefinition(row, i)),
      allowedChildTypeIds: this.childIds(),
    };
    const request$ = this.editing
      ? this.api.update(this.editing.id, { ...common, version: this.editing.version })
      : this.api.create({ ...common, key: v.key });

    this.saving.set(true);
    this.server.set(mapTypeErrors(undefined));
    this.conflicts.set([]);
    request$.subscribe({
      next: (saved) => {
        this.lookup.reload();
        this.toast.success('تم حفظ نوع العنصر');
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
        if (isConflict(e) && isApiError(e)) {
          this.conflictMessage.set(e.message);
          this.conflicts.set(errorEntries(e));
          return;
        }
        this.server.set(mapTypeErrors(fieldErrors(e)));
        // Row indexes go stale as soon as the admin edits, so server hints clear on the next change.
        this.form.valueChanges.pipe(take(1)).subscribe(() => this.server.set(mapTypeErrors(undefined)));
      },
    });
  }
}
