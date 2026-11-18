import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { isApiError } from '@core/models/api-error.model';
import { CreateDto } from '@core/models/entity.model';
import { ToastService } from '@core/notifications/toast.service';
import { RelationTypeLookup, RelationTypesApi, WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { RelationType } from '@domain/work-items/work-item.models';
import { HELP } from '@shared/help/help-texts';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { HelpTip } from '@shared/ui/help-tip/help-tip';
import { Icon } from '@shared/ui/icon/icon';
import { ADMIN_HELP } from '../shared/admin-help';
import { fieldErrors, splitErrors } from '../shared/api-errors';
import { AdminNotice } from '../shared/admin-notice';
import {
  AllowedSet,
  allowedKey,
  allowedPairsError,
  buildAllowedPairs,
  isAnyType,
  mirror,
  pairsToAllowedSet,
  toggleAllowed,
} from './allowed-pairs';
import { KEY_PATTERN } from './type-form.models';

export interface RelationTypeDialogData {
  /** `null` creates a new relation type. */
  readonly relation: RelationType | null;
  /** The type is known to be used by existing links (learned from an earlier 422). */
  readonly locked: boolean;
  /** Called when the server tells us the type is in use, so the list can show the lock badge. */
  readonly onLocked: () => void;
}

const LOCKED_KEYS = ['key', 'directed', 'acyclic'] as const;
const KNOWN = ['key', 'name', 'inverseName', 'directed', 'acyclic', 'allowedPairs'];

/** Create / edit a relation type: names, direction, cycle rule and the allowed type pairs (FR-REL-04). */
@Component({
  selector: 'app-relation-type-dialog',
  imports: [ReactiveFormsModule, DialogShell, HelpTip, Icon, AdminNotice],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrls: ['../shared/matrix.scss'],
  styles: `
    .lock { display: inline-flex; align-items: center; gap: 6px; padding: 2px 10px; border-radius: var(--r-pill); background: var(--c-warning-bg); color: var(--c-warning); font-size: var(--fs-xs); font-weight: 700; }
    .alert { margin: 0; padding: var(--s-3); border-radius: var(--r-sm); background: var(--c-danger-bg); color: var(--c-danger); font-size: var(--fs-sm); }
    .alert ul { margin: var(--s-1) 0 0; padding-inline-start: var(--s-5); }
    .flags { display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-5); align-items: center; }
    .pairs { margin: 0; padding: var(--s-3); border: 1px solid var(--c-border); border-radius: var(--r-md); }
    .pairs legend { padding-inline: var(--s-2); font-weight: 600; font-size: var(--fs-sm); }
  `,
  template: `
    <app-dialog-shell [title]="relation ? 'تعديل نوع الرابط' : 'نوع رابط جديد'" subtitle="يمنع تعطيل نوع الرابط إنشاء روابط جديدة منه فقط.">
      <form id="rel-form" [formGroup]="form" (ngSubmit)="save()" class="stack">
        @if (locked()) {
          <app-admin-notice tone="warning">
            <span class="lock"><app-icon name="lock" [size]="13" /> مقفل بعد الاستخدام</span>
            {{ lockHelp }}
          </app-admin-notice>
        }

        <div class="form-grid">
          <div class="field">
            <label for="r-key">المفتاح الداخلي <span class="req">*</span></label>
            <input id="r-key" class="input ltr" formControlName="key" autocomplete="off" placeholder="blocks" [attr.aria-invalid]="keyError() ? 'true' : null" />
            <span class="hint">{{ relation ? 'المفتاح ثابت ولا يتغير.' : 'حروف إنجليزية صغيرة وأرقام و_، تبدأ بحرف (2–31). لا يتغير بعد الإنشاء.' }}</span>
            @if (keyError(); as msg) { <span class="error" role="alert">{{ msg }}</span> }
          </div>
          <div class="field">
            <label for="r-name">الاسم <span class="req">*</span></label>
            <input id="r-name" class="input" formControlName="name" [attr.aria-invalid]="srv()['name'] ? 'true' : null" />
            @if (form.controls.name.touched && form.controls.name.invalid) { <span class="error">الاسم مطلوب.</span> }
            @if (srv()['name']; as msg) { <span class="error" role="alert">{{ msg }}</span> }
          </div>
          <div class="field">
            <label for="r-inv">الاسم العكسي <span class="req">*</span></label>
            <input id="r-inv" class="input" formControlName="inverseName" [attr.aria-invalid]="srv()['inverseName'] ? 'true' : null" />
            <span class="hint">{{ symmetric() ? 'الرابط متماثل: يطابق الاسم العكسي الاسمَ تلقائيًا.' : 'يظهر من جهة العنصر الهدف.' }}</span>
            @if (!symmetric() && form.controls.inverseName.touched && form.controls.inverseName.invalid) { <span class="error">الاسم العكسي مطلوب.</span> }
            @if (srv()['inverseName']; as msg) { <span class="error" role="alert">{{ msg }}</span> }
          </div>
          <div class="field flags">
            <label class="checkbox">
              <input type="checkbox" formControlName="directed" /> موجَّه
            </label>
            <app-help-tip [text]="directedHelp" />
            <label class="checkbox">
              <input type="checkbox" formControlName="acyclic" /> يمنع الحلقات
            </label>
            <app-help-tip [text]="acyclicHelp" />
            @if (locked()) { <span class="lock"><app-icon name="lock" [size]="13" /> مقفل</span> }
            @if (symmetric()) { <span class="hint">{{ symmetricHelp }}</span> }
            @if (srv()['directed']; as msg) { <span class="error" role="alert">{{ msg }}</span> }
            @if (srv()['acyclic']; as msg) { <span class="error" role="alert">{{ msg }}</span> }
          </div>
        </div>

        <fieldset class="pairs">
          <legend>الأزواج المسموحة بين الأنواع <app-help-tip [text]="pairsHelp" /></legend>
          <label class="checkbox">
            <input type="checkbox" [checked]="anyType()" (change)="anyType.set($any($event.target).checked)" /> أي نوع (بلا تقييد)
          </label>
          @if (!anyType()) {
            <p class="muted">صفوف: النوع المصدر · أعمدة: النوع الهدف@if (symmetric()) { · الرابط متماثل فيُطابَق الزوج في الاتجاهين }.</p>
            <div class="mx-scroll" tabindex="0" role="region" aria-label="مصفوفة الأزواج المسموحة">
              <table class="mx">
                <caption class="sr-only">الصفوف هي النوع المصدر والأعمدة هي النوع الهدف</caption>
                <thead>
                  <tr>
                    <th scope="col" class="corner">المصدر / الهدف</th>
                    @for (t of types(); track t.id) { <th scope="col" [style.--sw]="t.color"><span class="dot"></span>{{ t.name }}</th> }
                  </tr>
                </thead>
                <tbody>
                  @for (s of types(); track s.id) {
                    <tr>
                      <th scope="row" [style.--sw]="s.color"><span class="dot"></span>{{ s.name }}</th>
                      @for (t of types(); track t.id) {
                        <td [class.on]="has(s.id, t.id)">
                          <label class="hit">
                            <input type="checkbox" [checked]="has(s.id, t.id)" (change)="toggle(s.id, t.id, $any($event.target).checked)"
                              [attr.aria-label]="'السماح بربط ' + s.name + ' بـ ' + t.name" />
                          </label>
                        </td>
                      }
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
          @if (pairsError(); as msg) { <p class="error" role="alert">{{ msg }}</p> }
          @if (srv()['allowedPairs']; as msg) { <p class="error" role="alert">{{ msg }}</p> }
        </fieldset>

        @if (serverMessage() || rest().length) {
          <div class="alert" role="alert">
            @if (serverMessage(); as m) { <strong>{{ m }}</strong> }
            @if (rest().length) {
              <ul>
                @for (e of rest(); track e[0]) { <li><span class="ltr">{{ e[0] }}</span>: {{ e[1] }}</li> }
              </ul>
            }
          </div>
        }
      </form>
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إلغاء</button>
        <button type="submit" form="rel-form" class="btn btn--primary" [disabled]="saving()">{{ saving() ? 'جارٍ الحفظ…' : relation ? 'حفظ' : 'إنشاء نوع الرابط' }}</button>
      </ng-container>
    </app-dialog-shell>
  `,
})
export class RelationTypeDialog {
  protected readonly ref = inject<DialogRef<RelationType>>(DialogRef);
  private readonly data = inject(DIALOG_DATA) as RelationTypeDialogData;
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(RelationTypesApi);
  private readonly lookup = inject(RelationTypeLookup);
  private readonly typeLookup = inject(WorkItemTypeLookup);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly relation = this.data.relation;
  protected readonly directedHelp = HELP.relationDirected;
  protected readonly acyclicHelp = HELP.relationAcyclic;
  protected readonly pairsHelp = ADMIN_HELP.relationPairs;
  protected readonly symmetricHelp = ADMIN_HELP.relationSymmetric;
  protected readonly lockHelp = ADMIN_HELP.relationLocked;

  protected readonly saving = signal(false);
  protected readonly locked = signal(this.data.locked);
  protected readonly serverMessage = signal('');
  private readonly serverDetails = signal<Readonly<Record<string, string>>>({});
  protected readonly srv = computed(() => splitErrors(this.serverDetails(), KNOWN).mapped);
  protected readonly rest = computed(() => splitErrors(this.serverDetails(), KNOWN).rest);

  protected readonly types = computed(() => [...this.typeLookup.items()].sort((a, b) => a.order - b.order));
  protected readonly anyType = signal(isAnyType(this.relation?.allowedPairs));
  private readonly selected = signal<AllowedSet>(pairsToAllowedSet(this.relation?.allowedPairs));
  protected readonly submitted = signal(false);
  protected readonly pairsError = computed(() => (this.submitted() ? allowedPairsError(this.anyType(), this.selected()) : null));

  protected readonly form = this.fb.group({
    key: this.fb.control({ value: this.relation?.key ?? '', disabled: !!this.relation }, [Validators.required, Validators.pattern(KEY_PATTERN)]),
    name: this.fb.control(this.relation?.name ?? '', Validators.required),
    inverseName: this.fb.control(this.relation?.inverseName ?? '', Validators.required),
    directed: this.fb.control({ value: this.relation?.directed ?? true, disabled: this.data.locked }),
    acyclic: this.fb.control({ value: this.relation?.acyclic ?? false, disabled: this.data.locked }),
  });

  protected readonly symmetric = signal(!this.form.controls.directed.value);

  protected readonly keyError = computed(() => {
    const server = this.srv()['key'];
    if (server) return server;
    const c = this.form.controls.key;
    return !this.relation && this.submitted() && c.invalid ? 'مفتاح غير صالح: حروف إنجليزية صغيرة وأرقام و_، تبدأ بحرف (2–31).' : null;
  });

  constructor() {
    this.syncSymmetric();
    this.form.controls.directed.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((directed) => {
      this.symmetric.set(!directed);
      if (!directed) this.selected.update(mirror);
      this.syncSymmetric();
    });
    this.form.controls.name.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.syncSymmetric());
  }

  /** Symmetric links have one name: the inverse follows the name and cannot diverge. */
  private syncSymmetric(): void {
    const { name, inverseName, directed } = this.form.controls;
    if (!directed.value) {
      inverseName.setValue(name.value, { emitEvent: false });
      inverseName.disable({ emitEvent: false });
    } else if (inverseName.disabled) {
      inverseName.enable({ emitEvent: false });
    }
  }

  protected has(sourceId: string, targetId: string): boolean {
    return this.selected().has(allowedKey(sourceId, targetId));
  }

  protected toggle(sourceId: string, targetId: string, on: boolean): void {
    this.selected.update((set) => toggleAllowed(set, sourceId, targetId, on, this.symmetric()));
  }

  protected save(): void {
    this.submitted.set(true);
    if (this.form.invalid || allowedPairsError(this.anyType(), this.selected())) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const name = v.name.trim();
    const common = {
      name,
      inverseName: v.directed ? v.inverseName.trim() : name,
      allowedPairs: buildAllowedPairs(
        this.types().map((t) => t.id),
        this.anyType(),
        this.selected(),
      ),
    };
    const relation = this.relation;
    const request$ = relation
      ? this.api.update(relation.id, { ...common, ...(this.locked() ? {} : { directed: v.directed, acyclic: v.acyclic }), version: relation.version })
      : this.api.create({ ...common, key: v.key, directed: v.directed, acyclic: v.acyclic, active: true } satisfies CreateDto<RelationType>);

    this.saving.set(true);
    this.serverMessage.set('');
    this.serverDetails.set({});
    request$.subscribe({
      next: (saved) => {
        this.lookup.reload();
        this.toast.success(relation ? 'تم حفظ نوع الرابط' : 'تم إنشاء نوع الرابط');
        this.ref.close(saved);
      },
      error: (e: unknown) => {
        this.saving.set(false);
        if (!isApiError(e)) return;
        if (relation && e.status === 409) {
          // Stale version: the interceptor toasted the message; reload and close so the next edit starts fresh.
          this.lookup.reload();
          this.ref.close();
          return;
        }
        const details = fieldErrors(e);
        this.serverMessage.set(e.message);
        this.serverDetails.set(details);
        if (relation && e.status === 422 && LOCKED_KEYS.some((k) => k in details)) this.lockAfterRejection(relation);
      },
    });
  }

  /** The server says links already use this type: freeze the semantic controls and restore their saved values. */
  private lockAfterRejection(relation: RelationType): void {
    this.locked.set(true);
    this.form.controls.directed.setValue(relation.directed);
    this.form.controls.acyclic.setValue(relation.acyclic);
    this.form.controls.directed.disable();
    this.form.controls.acyclic.disable();
    this.data.onLocked();
  }
}
