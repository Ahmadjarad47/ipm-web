import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormControl, FormGroup, FormRecord, ReactiveFormsModule, Validators } from '@angular/forms';
import { AuthService } from '@core/auth/auth.service';
import { UpdateDto } from '@core/models/entity.model';
import { ToastService } from '@core/notifications/toast.service';
import { ProjectLookup } from '@domain/projects/project.api';
import { ApprovalRequestsApi } from '@domain/approvals/approval.api';
import { WorkItemsApi, WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { FieldValue, Priority, WorkItem } from '@domain/work-items/work-item.models';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { DynamicFields, DynamicFieldsGroup, syncDynamicControls } from '@shared/ui/dynamic-field/dynamic-fields';
import { AssigneePicker } from './assignee-picker';
import { asApiError, dateInputValue, ltr, PRIORITY_OPTIONS } from './work-item-utils';

export interface WorkItemEditData {
  readonly item: WorkItem;
}

interface SensitiveNeed {
  readonly templateId: string;
  readonly fields: readonly string[];
  readonly message: string;
}

let nextId = 0;

/** Edit dialog. statusId / typeId / parentId are never sent: they have dedicated actions. */
@Component({
  selector: 'app-work-item-edit-dialog',
  imports: [ReactiveFormsModule, DialogShell, DynamicFields, AssigneePicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell [title]="'تعديل ' + ltr(item.ref)">
      <form [id]="uid + '-wi-edit'" class="form-grid" [formGroup]="form" (ngSubmit)="submit()">
        <div class="field span-2">
          <label [attr.for]="uid + '-we-title'">العنوان <span class="req">*</span></label>
          <input [id]="uid + '-we-title'" class="input" type="text" formControlName="title" maxlength="200" />
          @if (errors()['title']) {
            <span class="error" role="alert">{{ errors()['title'] }}</span>
          }
        </div>
        <div class="field span-2">
          <label [attr.for]="uid + '-we-desc'">الوصف</label>
          <textarea [id]="uid + '-we-desc'" class="textarea" rows="4" formControlName="description"></textarea>
        </div>
        <div class="field">
          <label [attr.for]="uid + '-we-priority'">الأولوية</label>
          <select [id]="uid + '-we-priority'" class="select" formControlName="priority">
            @for (o of priorities; track o.value) {
              <option [value]="o.value">{{ o.label }}</option>
            }
          </select>
        </div>
        <div class="field"></div>
        <div class="field">
          <label [attr.for]="uid + '-we-start'">تاريخ البدء</label>
          <input [id]="uid + '-we-start'" class="input" type="date" formControlName="startDate" />
        </div>
        <div class="field">
          <label [attr.for]="uid + '-we-due'">تاريخ الاستحقاق</label>
          <input [id]="uid + '-we-due'" class="input" type="date" formControlName="dueDate" />
          @if (errors()['dueDate']) {
            <span class="error" role="alert">{{ errors()['dueDate'] }}</span>
          }
        </div>
        <div class="field span-2">
          <span class="label">المكلّفون</span>
          <app-assignee-picker
            [userIds]="memberIds()"
            [disabled]="!canAssign"
            [value]="form.controls.assigneeIds.value"
            (valueChange)="form.controls.assigneeIds.setValue($event)"
          />
        </div>
      </form>
      @if (approval(); as need) {
        <div class="alert" role="alert">
          <strong>هذا التعديل حساس</strong>
          <span>{{ need.message }}</span>
          <button type="button" class="btn btn--primary" [disabled]="saving()" (click)="requestSensitiveChange(need)">إرسال طلب تعديل حساس</button>
        </div>
      }
      @if (type(); as t) {
        @if (t.fields.length) {
          <h3 class="section-title fields-title">حقول {{ t.name }}</h3>
          <app-dynamic-fields [definitions]="t.fields" [group]="fieldsGroup" [serverErrors]="errors()" />
        }
      }
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إلغاء</button>
        <button type="submit" [attr.form]="uid + '-wi-edit'" class="btn btn--primary" [disabled]="saving()">حفظ</button>
      </ng-container>
    </app-dialog-shell>
  `,
  styles: `
    :host { display: block; max-inline-size: calc(100vw - 32px); }
    .form-grid { grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr)); }
    .form-grid .span-2 { grid-column: 1 / -1; }
    .fields-title { margin-block: var(--s-4) var(--s-2); }
    .alert { display: flex; flex-direction: column; align-items: flex-start; gap: var(--s-2); margin-block-start: var(--s-3); padding: var(--s-3); border-radius: var(--r-md); background: var(--c-warning-bg); color: var(--c-warning); border: 1px solid var(--c-warning); }
  `,
})
export class WorkItemEditDialog {
  protected readonly uid = `wedit${++nextId}`;
  protected readonly ref = inject(DialogRef<WorkItem>);
  protected readonly item = (inject(DIALOG_DATA) as WorkItemEditData).item;
  private readonly auth = inject(AuthService);
  private readonly api = inject(WorkItemsApi);
  private readonly toast = inject(ToastService);
  private readonly approvals = inject(ApprovalRequestsApi);
  private readonly projects = inject(ProjectLookup);
  private readonly types = inject(WorkItemTypeLookup);

  protected readonly ltr = ltr;
  protected readonly priorities = PRIORITY_OPTIONS;
  protected readonly canEdit = this.auth.can('tasks.edit', this.item.projectId);
  protected readonly canAssign = this.auth.can('tasks.assign', this.item.projectId);

  protected readonly form = new FormGroup({
    title: new FormControl(this.item.title, { nonNullable: true, validators: [Validators.required, Validators.maxLength(200)] }),
    description: new FormControl(this.item.description, { nonNullable: true }),
    priority: new FormControl<Priority>(this.item.priority, { nonNullable: true }),
    assigneeIds: new FormControl<readonly string[]>(this.item.assigneeIds, { nonNullable: true }),
    startDate: new FormControl<string | null>(dateInputValue(this.item.startDate) || null),
    dueDate: new FormControl<string | null>(dateInputValue(this.item.dueDate) || null),
  });
  protected readonly fieldsGroup: DynamicFieldsGroup = new FormRecord<FormControl<FieldValue>>({});

  protected readonly saving = signal(false);
  /** Set when the server refuses a direct edit of protected fields (FR-APR-10): offer a sensitive-change request instead. */
  protected readonly approval = signal<SensitiveNeed | null>(null);
  private lastPayload: UpdateDto<WorkItem> | null = null;
  protected readonly errors = signal<Readonly<Record<string, string>>>({});
  protected readonly type = computed(() => this.types.get(this.item.typeId));
  protected readonly memberIds = computed(() => {
    const members = (this.projects.get(this.item.projectId)?.members ?? []).map((m) => m.userId);
    // Keep current assignees selectable even if they left the project.
    return [...new Set([...members, ...this.item.assigneeIds])];
  });

  constructor() {
    if (!this.canEdit) {
      for (const control of Object.values(this.form.controls)) control.disable();
      if (this.canAssign) this.form.controls.assigneeIds.enable();
    }
    effect(() => {
      const fields = this.type()?.fields ?? [];
      untracked(() => {
        syncDynamicControls(this.fieldsGroup, fields, this.item.fields);
        if (!this.canEdit) this.fieldsGroup.disable();
      });
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
    const base: UpdateDto<WorkItem> = { version: this.item.version };
    const edits: UpdateDto<WorkItem> = this.canEdit
      ? {
          ...base,
          title: v.title.trim(),
          description: v.description,
          priority: v.priority,
          startDate: v.startDate || null,
          dueDate: v.dueDate || null,
          fields: this.fieldsGroup.getRawValue(),
        }
      : base;
    const assigneesChanged = JSON.stringify(v.assigneeIds) !== JSON.stringify(this.item.assigneeIds);
    const payload: UpdateDto<WorkItem> = this.canAssign && assigneesChanged ? { ...edits, assigneeIds: v.assigneeIds } : edits;

    this.saving.set(true);
    this.approval.set(null);
    this.lastPayload = payload;
    this.api.update(this.item.id, payload).subscribe({
      next: (updated) => {
        this.toast.success('تم حفظ التعديلات');
        this.ref.close(updated);
      },
      error: (e: unknown) => {
        this.saving.set(false);
        const err = asApiError(e);
        if (err?.status === 409) {
          // Stale version: close so the detail page reloads the item; retrying with the old version would 409 forever.
          this.toast.info('تم تعديل العنصر من مستخدم آخر. جارٍ تحديث البيانات.');
          this.ref.close(this.item);
          return;
        }
        if (err?.status === 422 && err.details?.['code'] === 'approval_required') {
          this.approval.set({ templateId: err.details['templateId'] ?? '', fields: (err.details['fields'] ?? '').split(',').filter(Boolean), message: err.message });
          return;
        }
        this.errors.set(err?.details ?? {});
      },
    });
  }

  /** Sends the protected edits as a request instead; they are applied only when the last stage approves. */
  protected requestSensitiveChange(need: SensitiveNeed): void {
    const payload = (this.lastPayload ?? {}) as Readonly<Record<string, unknown>>;
    const proposedChanges: Record<string, string | number | null> = {};
    for (const field of need.fields) {
      const value = payload[field];
      proposedChanges[field] = Array.isArray(value) ? value.join(',') : (value as string | number | null | undefined) ?? null;
    }
    this.saving.set(true);
    this.approvals.create({ templateId: need.templateId, subjectType: 'workItem', subjectId: this.item.id, proposedChanges }).subscribe({
      next: () => {
        this.toast.success('تم إرسال طلب التعديل الحساس');
        this.ref.close(this.item);
      },
      error: () => this.saving.set(false),
    });
  }
}
