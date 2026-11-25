import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { rxResource } from '@core/state/safe-resource';
import { FormControl, FormGroup, FormRecord, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '@core/auth/auth.service';
import { ProjectLookup } from '@domain/projects/project.api';
import { WorkItemsApi, WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { FieldValue, Priority, WorkItem, WorkItemCreate } from '@domain/work-items/work-item.models';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { DynamicFields, DynamicFieldsGroup, syncDynamicControls } from '@shared/ui/dynamic-field/dynamic-fields';
import { AssigneePicker } from './assignee-picker';
import { asApiError, ltr, PRIORITY_OPTIONS } from './work-item-utils';

export interface WorkItemFormData {
  readonly projectId?: string;
}

let nextId = 0;

/** Create dialog (FR-TSK-01). Type-specific fields come from the selected type definition (FR-TYP-11). */
@Component({
  selector: 'app-work-item-form',
  imports: [ReactiveFormsModule, DialogShell, DynamicFields, AssigneePicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell title="عمل جديد">
      <form [id]="uid + '-wi-create'" class="form-grid" [formGroup]="form" (ngSubmit)="submit()">
        <div class="field">
          <label [attr.for]="uid + '-wi-project'">المشروع <span class="req">*</span></label>
          <select [id]="uid + '-wi-project'" class="select" formControlName="projectId">
            <option value="">— اختر مشروعًا —</option>
            @for (p of projects(); track p.id) {
              <option [value]="p.id">{{ ltr(p.code) }} — {{ p.name }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label [attr.for]="uid + '-wi-type'">النوع <span class="req">*</span></label>
          <select [id]="uid + '-wi-type'" class="select" formControlName="typeId">
            @for (t of allowedTypes(); track t.id) {
              <option [value]="t.id">{{ t.name }}</option>
            }
          </select>
        </div>
        <div class="field span-2">
          <label [attr.for]="uid + '-wi-title'">العنوان <span class="req">*</span></label>
          <input [id]="uid + '-wi-title'" class="input" type="text" formControlName="title" maxlength="200" />
          @if (errors()['title']) {
            <span class="error" role="alert">{{ errors()['title'] }}</span>
          }
        </div>
        <div class="field span-2">
          <label [attr.for]="uid + '-wi-desc'">الوصف</label>
          <textarea [id]="uid + '-wi-desc'" class="textarea" rows="3" formControlName="description"></textarea>
        </div>
        <div class="field">
          <label [attr.for]="uid + '-wi-priority'">الأولوية</label>
          <select [id]="uid + '-wi-priority'" class="select" formControlName="priority">
            @for (o of priorities; track o.value) {
              <option [value]="o.value">{{ o.label }}</option>
            }
          </select>
        </div>
        <div class="field">
          <label [attr.for]="uid + '-wi-parent'">العمل الأب</label>
          <select [id]="uid + '-wi-parent'" class="select" formControlName="parentId">
            <option [ngValue]="null">— بدون —</option>
            @for (c of parentCandidates(); track c.id) {
              <option [ngValue]="c.id">{{ ltr(c.ref) }} — {{ c.title }}</option>
            }
          </select>
          @if (errors()['parentId']) {
            <span class="error" role="alert">{{ errors()['parentId'] }}</span>
          }
        </div>
        <div class="field">
          <label [attr.for]="uid + '-wi-start'">تاريخ البدء</label>
          <input [id]="uid + '-wi-start'" class="input" type="date" formControlName="startDate" />
        </div>
        <div class="field">
          <label [attr.for]="uid + '-wi-due'">تاريخ الاستحقاق</label>
          <input [id]="uid + '-wi-due'" class="input" type="date" formControlName="dueDate" />
          @if (errors()['dueDate']) {
            <span class="error" role="alert">{{ errors()['dueDate'] }}</span>
          }
        </div>
        @if (canAssign()) {
          <div class="field span-2">
            <span class="label">المكلّفون</span>
            <app-assignee-picker
              [userIds]="memberIds()"
              [value]="form.controls.assigneeIds.value"
              (valueChange)="form.controls.assigneeIds.setValue($event)"
            />
          </div>
        }
      </form>
      @if (type(); as t) {
        @if (t.fields.length) {
          <h3 class="section-title fields-title">حقول {{ t.name }}</h3>
          <app-dynamic-fields [definitions]="t.fields" [group]="fieldsGroup" [serverErrors]="errors()" />
        }
      }
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إلغاء</button>
        <button type="submit" [attr.form]="uid + '-wi-create'" class="btn btn--primary" [disabled]="saving()">إنشاء</button>
      </ng-container>
    </app-dialog-shell>
  `,
  styles: `
    :host { display: block; max-inline-size: calc(100vw - 32px); }
    .fields-title { margin-block: var(--s-4) var(--s-2); }
    .form-grid { grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); }
    .form-grid .span-2 { grid-column: 1 / -1; }
  `,
})
export class WorkItemForm {
  protected readonly uid = `wform${++nextId}`;
  protected readonly ref = inject(DialogRef<WorkItem>);
  private readonly data = (inject(DIALOG_DATA) as WorkItemFormData | undefined) ?? {};
  private readonly auth = inject(AuthService);
  private readonly api = inject(WorkItemsApi);
  private readonly projectLookup = inject(ProjectLookup);
  private readonly typeLookup = inject(WorkItemTypeLookup);

  protected readonly ltr = ltr;
  protected readonly priorities = PRIORITY_OPTIONS;
  protected readonly form = new FormGroup({
    projectId: new FormControl(this.data.projectId ?? '', { nonNullable: true, validators: [Validators.required] }),
    typeId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    title: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(200)] }),
    description: new FormControl('', { nonNullable: true }),
    priority: new FormControl<Priority>('medium', { nonNullable: true }),
    assigneeIds: new FormControl<readonly string[]>([], { nonNullable: true }),
    startDate: new FormControl<string | null>(null),
    dueDate: new FormControl<string | null>(null),
    parentId: new FormControl<string | null>(null),
  });
  protected readonly fieldsGroup: DynamicFieldsGroup = new FormRecord<FormControl<FieldValue>>({});

  protected readonly saving = signal(false);
  protected readonly errors = signal<Readonly<Record<string, string>>>({});

  private readonly projectId = toSignal(this.form.controls.projectId.valueChanges, { initialValue: this.form.controls.projectId.value });
  private readonly typeId = toSignal(this.form.controls.typeId.valueChanges, { initialValue: this.form.controls.typeId.value });

  protected readonly projects = computed(() =>
    this.projectLookup.items().filter((p) => !p.archived && this.auth.can('tasks.create', p.id)),
  );
  private readonly project = computed(() => this.projectLookup.get(this.projectId()));
  protected readonly allowedTypes = computed(() =>
    (this.project()?.allowedTypeIds ?? [])
      .map((id) => this.typeLookup.get(id))
      .filter((t): t is NonNullable<typeof t> => !!t && t.active),
  );
  protected readonly type = computed(() => this.typeLookup.get(this.typeId()));
  protected readonly canAssign = computed(() => this.auth.can('tasks.assign', this.projectId()));
  protected readonly memberIds = computed(() => (this.project()?.members ?? []).map((m) => m.userId));

  private readonly candidates = rxResource({
    params: () => this.projectId() || undefined,
    stream: ({ params }) => this.api.list({ page: 1, pageSize: 100, filters: { projectId: params } }),
  });
  /** Parent must be in the same project and its type must allow the selected type as a child (FR-REL-01). */
  protected readonly parentCandidates = computed(() => {
    const typeId = this.typeId();
    return (this.candidates.value()?.items ?? []).filter(
      (w) => !w.archived && this.typeLookup.get(w.typeId)?.allowedChildTypeIds.includes(typeId),
    );
  });

  constructor() {
    // Default type for the chosen project (only allowed, active types).
    effect(() => {
      const types = this.allowedTypes();
      const project = this.project();
      untracked(() => {
        const control = this.form.controls.typeId;
        if (types.some((t) => t.id === control.value)) return;
        const preferred = types.find((t) => t.id === project?.defaultTypeId) ?? types[0];
        control.setValue(preferred?.id ?? '');
      });
    });
    // Dynamic fields follow the type (FR-TYP-11).
    effect(() => {
      const fields = this.type()?.fields ?? [];
      untracked(() => syncDynamicControls(this.fieldsGroup, fields));
    });
    // Drop a parent that no longer qualifies.
    effect(() => {
      const ids = new Set(this.parentCandidates().map((c) => c.id));
      untracked(() => {
        const current = this.form.controls.parentId.value;
        if (current && !ids.has(current)) this.form.controls.parentId.setValue(null);
      });
    });
    // Assignees belong to the project; reset when it changes.
    effect(() => {
      this.projectId();
      untracked(() => this.form.controls.assigneeIds.setValue([]));
    });
  }

  protected submit(): void {
    this.errors.set({});
    this.form.markAllAsTouched();
    this.fieldsGroup.markAllAsTouched();
    if (this.form.invalid || this.fieldsGroup.invalid) {
      if (this.form.controls.title.invalid) this.errors.set({ title: 'العنوان مطلوب' });
      return;
    }
    const v = this.form.getRawValue();
    const payload: WorkItemCreate = {
      projectId: v.projectId,
      typeId: v.typeId,
      title: v.title.trim(),
      description: v.description,
      priority: v.priority,
      assigneeIds: this.canAssign() ? v.assigneeIds : [],
      startDate: v.startDate || null,
      dueDate: v.dueDate || null,
      parentId: v.parentId || null,
      fields: this.fieldsGroup.getRawValue(),
    };
    this.saving.set(true);
    this.api.create(payload).subscribe({
      next: (item) => {
        this.ref.close(item);
      },
      error: (e: unknown) => {
        this.saving.set(false);
        this.errors.set(asApiError(e)?.details ?? {});
      },
    });
  }
}
