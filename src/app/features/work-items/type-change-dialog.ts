import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormRecord } from '@angular/forms';
import { debounceTime, tap } from 'rxjs';
import { rxResource } from '@core/state/safe-resource';
import { ToastService } from '@core/notifications/toast.service';
import { ProjectLookup } from '@domain/projects/project.api';
import { WorkItemsApi, WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { FieldValue, WorkItem } from '@domain/work-items/work-item.models';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { DynamicFields, syncDynamicControls } from '@shared/ui/dynamic-field/dynamic-fields';
import { fieldsPayload, missingRequiredFields, visibleConflicts } from './type-change-logic';
import { ltr } from './work-item-utils';

export interface TypeChangeData {
  readonly item: WorkItem;
}

let nextId = 0;

/** FR-TYP-08 / AT-21: dry-run the conversion, list every conflict, enable it only when there are none. */
@Component({
  selector: 'app-type-change-dialog',
  imports: [DialogShell, DynamicFields],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell title="تحويل نوع العمل" [subtitle]="ltr(item.ref)">
      <div class="field">
        <label [attr.for]="uid + '-tc-type'">النوع الجديد</label>
        <select [id]="uid + '-tc-type'" class="select" (change)="pick($event)">
          <option value="">— اختر نوعًا —</option>
          @for (t of targets(); track t.id) {
            <option [value]="t.id">{{ t.name }}</option>
          }
        </select>
      </div>
      @if (inputs().length) {
        <section class="needed" aria-labelledby="{{ uid }}-needed">
          <p class="needed__title" [id]="uid + '-needed'">يتطلب النوع الجديد حقولًا غير معبّأة — أدخلها للمتابعة:</p>
          <app-dynamic-fields [definitions]="inputs()" [group]="form" />
        </section>
      }
      @if (targetId()) {
        <div class="result" aria-live="polite">
          @if (check.isLoading()) {
            <p class="muted">جارٍ فحص التوافق…</p>
          } @else if (check.error()) {
            <p class="error" role="alert">تعذّر فحص التوافق.</p>
          } @else if (shown().length) {
            <p class="error"><strong>لا يمكن التحويل بسبب التعارضات التالية:</strong></p>
            <ul>
              @for (c of shown(); track $index) {
                <li>{{ c.reason }}</li>
              }
            </ul>
          } @else if (conflicts().length) {
            <p class="muted">عبّئ الحقول المطلوبة أعلاه لإتمام التحويل.</p>
          } @else {
            <p class="ok">لا توجد تعارضات، يمكن التحويل.</p>
          }
        </div>
      }
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إلغاء</button>
        <button type="button" class="btn btn--primary" [disabled]="!canConvert()" (click)="convert()">تحويل</button>
      </ng-container>
    </app-dialog-shell>
  `,
  styles: `
    .result { margin-top: var(--s-4); }
    .needed { margin-top: var(--s-4); }
    .needed__title { margin: 0 0 var(--s-2); font-weight: 600; }
    ul { margin: var(--s-2) 0 0; padding-inline-start: var(--s-5); color: var(--c-danger); }
    .ok { color: var(--c-success); font-weight: 600; }
    :host { display: block; max-inline-size: calc(100vw - 32px); }
    li { overflow-wrap: anywhere; }
  `,
})
export class TypeChangeDialog {
  protected readonly uid = `type${++nextId}`;
  protected readonly item = (inject(DIALOG_DATA) as TypeChangeData).item;
  protected readonly ref = inject(DialogRef<WorkItem>);
  protected readonly ltr = ltr;
  private readonly api = inject(WorkItemsApi);
  private readonly toast = inject(ToastService);
  private readonly types = inject(WorkItemTypeLookup);
  private readonly projects = inject(ProjectLookup);

  protected readonly targetId = signal('');
  private readonly saving = signal(false);
  /** Values typed for the new type's missing required fields; the check re-runs when they settle. */
  protected readonly form = new FormRecord<FormControl<FieldValue>>({});
  private readonly supplied = signal<Readonly<Record<string, FieldValue>> | undefined>(undefined);
  private readonly settling = signal(false);

  protected readonly targets = computed(() => {
    const allowed = this.projects.get(this.item.projectId)?.allowedTypeIds ?? [];
    return this.types.items().filter((t) => t.active && t.id !== this.item.typeId && allowed.includes(t.id));
  });

  /** Fields of the chosen type that are required and still empty on the item. */
  protected readonly inputs = computed(() =>
    missingRequiredFields(this.types.items().find((t) => t.id === this.targetId()), this.item),
  );

  protected readonly check = rxResource({
    params: () => (this.targetId() ? { typeId: this.targetId(), fields: this.supplied() } : undefined),
    stream: ({ params }) => this.api.checkTypeChange(this.item.id, params.typeId, params.fields),
  });
  protected readonly conflicts = computed(() => this.check.value() ?? []);
  protected readonly shown = computed(() => visibleConflicts(this.conflicts(), this.inputs(), this.form.getRawValue()));
  protected readonly canConvert = computed(
    () => !!this.targetId() && !this.check.isLoading() && !this.check.error() && this.check.hasValue() && !this.conflicts().length && !this.settling() && !this.saving(),
  );

  constructor() {
    // A new type brings its own required fields: rebuild the inputs and forget values typed for the previous one.
    effect(() => {
      const definitions = this.inputs();
      untracked(() => {
        syncDynamicControls(this.form, definitions);
        this.pushValues();
      });
    });
    this.form.valueChanges
      .pipe(
        tap(() => this.settling.set(true)),
        debounceTime(350),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.pushValues());
  }

  protected pick(event: Event): void {
    this.targetId.set((event.target as HTMLSelectElement).value);
  }

  /** Hands the typed values to the check (only when they really changed, to avoid a request per keystroke). */
  private pushValues(): void {
    const next = fieldsPayload(this.inputs(), this.form.getRawValue());
    if (JSON.stringify(next) !== JSON.stringify(this.supplied())) this.supplied.set(next);
    this.settling.set(false);
  }

  protected convert(): void {
    if (!this.canConvert()) return;
    this.saving.set(true);
    this.api.changeType(this.item.id, this.targetId(), this.item.version, this.supplied()).subscribe({
      next: (updated) => {
        this.toast.success('تم تحويل النوع');
        this.ref.close(updated);
      },
      error: () => this.saving.set(false),
    });
  }
}
