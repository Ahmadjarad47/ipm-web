import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormArray, FormControl, FormGroup, NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { map, startWith } from 'rxjs';
import { isApiError } from '@core/models/api-error.model';
import { ToastService } from '@core/notifications/toast.service';
import { ApprovalTemplatesApi } from '@domain/approvals/approval.api';
import {
  APPROVAL_EVENT_LABELS,
  APPROVER_POSITION_LABELS,
  ApprovalEvent,
  ApprovalRule,
  ApprovalStage,
  ApprovalSubject,
  ApprovalTemplate,
  ApproverKind,
  ApproverPosition,
} from '@domain/approvals/approval.models';
import { ProjectLookup } from '@domain/projects/project.api';
import { RoleLookup, UserLookup } from '@domain/users/user.api';
import { WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { PRIORITY_LABELS } from '@domain/work-items/work-item.models';
import { HELP } from '@shared/help/help-texts';
import { ConfirmService } from '@shared/ui/dialog/confirm-dialog';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { HelpTip } from '@shared/ui/help-tip/help-tip';
import { Icon } from '@shared/ui/icon/icon';
import { AdminNotice } from '../shared/admin-notice';
import { moveControl } from '../shared/reorder';
import { RuleEditor } from './rule-editor';
import { summarizeRule } from './rule-summary';
import { StageStepper, StepperStep } from './stage-stepper';
import { TemplateTester } from './template-tester';

export interface TemplateFormData {
  readonly template: ApprovalTemplate | null;
}

export interface ProtectableField {
  readonly key: string;
  readonly label: string;
  readonly subject: ApprovalSubject;
}

/** Fields whose change during review supersedes an approval (FR-APR-10). Mirrors `SUBJECT_FIELDS` of the engine. */
export const PROTECTABLE_FIELDS: readonly ProtectableField[] = [
  { key: 'name', label: 'الاسم', subject: 'project' },
  { key: 'description', label: 'الوصف', subject: 'project' },
  { key: 'startDate', label: 'تاريخ البداية', subject: 'project' },
  { key: 'endDate', label: 'تاريخ النهاية', subject: 'project' },
  { key: 'ownerId', label: 'المالك', subject: 'project' },
  { key: 'title', label: 'العنوان', subject: 'work-item' },
  { key: 'description', label: 'الوصف', subject: 'work-item' },
  { key: 'dueDate', label: 'تاريخ الاستحقاق', subject: 'work-item' },
  { key: 'startDate', label: 'تاريخ البداية', subject: 'work-item' },
  { key: 'parentId', label: 'العمل الأب', subject: 'work-item' },
  { key: 'priority', label: 'الأولوية', subject: 'work-item' },
  { key: 'typeId', label: 'النوع', subject: 'work-item' },
  { key: 'assigneeIds', label: 'المكلَّفون', subject: 'work-item' },
];

const SUBJECT_TITLES: Record<ApprovalSubject, string> = { project: 'حقول المشروع', 'work-item': 'حقول العمل' };

type StageForm = FormGroup<{
  name: FormControl<string>;
  approverKind: FormControl<ApproverKind>;
  approverId: FormControl<string>;
  dueHours: FormControl<number | null>;
}>;

const POSITIONS = Object.keys(APPROVER_POSITION_LABELS) as ApproverPosition[];
const POSITION_SHORT: Record<ApproverPosition, string> = { project_owner: 'مالك المشروع', direct_manager: 'المدير المباشر', project_manager: 'مدير المشروع' };

@Component({
  selector: 'app-template-form-dialog',
  imports: [ReactiveFormsModule, DialogShell, Icon, AdminNotice, StageStepper, RuleEditor, TemplateTester, HelpTip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './template-form-dialog.scss',
  template: `
    <app-dialog-shell [title]="editing ? 'تعديل قالب موافقة' : 'قالب موافقة جديد'">
      <div class="stack">
        <app-admin-notice>التغييرات تنطبق على الطلبات الجديدة فقط؛ الطلبات الجارية تحتفظ بمراحلها وقت التقديم (§4.3).</app-admin-notice>
        <form id="tpl-form" [formGroup]="form" (ngSubmit)="save()" class="stack">
          <div class="form-grid">
            <div class="field">
              <label for="a-name">اسم القالب <span class="req">*</span></label>
              <input id="a-name" class="input" formControlName="name" [attr.aria-invalid]="!!serverErrors()['name']" />
              @if (serverErrors()['name']; as e) {
                <span class="error" role="alert">{{ e }}</span>
              }
            </div>
            <div class="field">
              <label for="a-event">الحدث <span class="req">*</span></label>
              <select id="a-event" class="select" formControlName="event">
                @for (e of events; track e.key) {
                  <option [value]="e.key">{{ e.label }}</option>
                }
              </select>
              @if (serverErrors()['event']; as e) {
                <span class="error" role="alert">{{ e }}</span>
              }
            </div>
            <label class="checkbox span-2"><input type="checkbox" formControlName="active" /> قالب نشط</label>
          </div>

          <section class="stack" aria-labelledby="rule-title">
            <div class="row">
              <strong id="rule-title">متى يُطبَّق هذا القالب؟</strong>
            </div>
            <p class="summary" role="status"><app-icon name="info" [size]="16" /> {{ summary() }}</p>
            <app-rule-editor [(rule)]="rule" [event]="eventValue()" />
            @if (serverErrors()['rule']; as e) {
              <p class="error" role="alert">{{ e }}</p>
            }
          </section>

          <fieldset class="prot">
            <legend>الحقول المحمية (تغييرها أثناء المراجعة يُلغي الطلب ويُعيده) <app-help-tip [text]="help.protectedFields" /></legend>
            @for (g of fieldGroups(); track g.subject) {
              <div class="grp">
                <small class="muted">{{ g.title }}</small>
                <div class="chk-list">
                  @for (f of g.fields; track f.key) {
                    <label class="checkbox">
                      <input type="checkbox" [checked]="protectedFields().includes(f.key)" (change)="toggleProtected(f.key, $any($event.target).checked)" />
                      {{ f.label }} <span class="ltr muted">{{ f.key }}</span>
                    </label>
                  }
                </div>
              </div>
            }
            @if (eventValue() === 'sensitive-change') {
              <small class="muted">التعديل الحساس يتطلب حقولًا من نوع واحد فقط (مشروع أو عمل).</small>
            }
            @if (serverErrors()['protectedFields']; as e) {
              <p class="error" role="alert">{{ e }}</p>
            }
          </fieldset>

          <section aria-labelledby="stg-title" class="stack">
            <div class="row">
              <strong id="stg-title">مراحل الموافقة بالترتيب</strong>
              <app-help-tip [text]="help.approverKinds" />
              <span class="spacer"></span>
              <button type="button" class="btn btn--outline btn--sm" (click)="addStage()"><app-icon name="plus" [size]="14" /> مرحلة</button>
            </div>
            @if (form.controls.stages.errors?.['minStages'] && form.controls.stages.touched) {
              <p class="error" role="alert">يجب وجود مرحلة واحدة على الأقل.</p>
            }
            @if (serverErrors()['stages']; as e) {
              <p class="error" role="alert">{{ e }}</p>
            }
            @for (stage of form.controls.stages.controls; track stage; let i = $index) {
              <div class="stage" [formGroup]="stage">
                <span class="n">{{ i + 1 }}</span>
                <input class="input" formControlName="name" placeholder="اسم المرحلة" [attr.aria-label]="'اسم المرحلة ' + (i + 1)" [attr.aria-invalid]="stage.controls.name.invalid && stage.controls.name.touched" />
                <select class="select" formControlName="approverKind" [attr.aria-label]="'نوع المعتمِد ' + (i + 1)" (change)="onKindChange(stage)">
                  <option value="user">مستخدم</option>
                  <option value="role">دور</option>
                  <option value="position">منصب</option>
                </select>
                <select class="select" formControlName="approverId" [attr.aria-label]="'المعتمِد ' + (i + 1)">
                  <option value="">— اختر —</option>
                  @switch (stage.controls.approverKind.value) {
                    @case ('user') {
                      @for (u of activeUsers(); track u.id) {
                        <option [value]="u.id">{{ u.name }}</option>
                      }
                    }
                    @case ('role') {
                      @for (r of roles.items(); track r.id) {
                        <option [value]="r.id">{{ r.name }}</option>
                      }
                    }
                    @default {
                      @for (p of positions; track p) {
                        <option [value]="p">{{ positionLabels[p] }}</option>
                      }
                    }
                  }
                </select>
                <input class="input ltr due" type="number" min="1" max="720" step="1" formControlName="dueHours" placeholder="المهلة (ساعات)" [attr.aria-label]="'مهلة المرحلة ' + (i + 1) + ' بالساعات'" />
                <div class="ops">
                  <button type="button" class="btn btn--ghost btn--sm btn--icon" [disabled]="i === 0" (click)="move(i, -1)" aria-label="تحريك للأعلى">▲</button>
                  <button type="button" class="btn btn--ghost btn--sm btn--icon" [disabled]="i === form.controls.stages.length - 1" (click)="move(i, 1)" aria-label="تحريك للأسفل">▼</button>
                  <button type="button" class="btn btn--ghost btn--sm btn--icon" (click)="removeStage(i)" aria-label="حذف المرحلة"><app-icon name="trash" [size]="15" /></button>
                </div>
              </div>
            }
            @if (steps().length) {
              <div class="preview">
                <strong>معاينة التسلسل</strong>
                <app-stage-stepper [steps]="steps()" />
              </div>
            }
          </section>

          <div class="selfapp">
            <label class="checkbox"><input type="checkbox" formControlName="allowSelfApproval" /> السماح لمقدّم الطلب بالموافقة على طلبه (استثناء)</label>
            <p class="danger-note" role="note">
              <app-icon name="alert" [size]="16" />
              تحذير: يتجاوز هذا الخيار مبدأ فصل المهام. لا يسري إلا إذا كان الإعداد العام «السماح بالموافقة الذاتية» مفعّلًا أيضًا في إعدادات النظام، ويُسجَّل كل قرار ذاتي في التدقيق.
            </p>
            @if (serverErrors()['allowSelfApproval']; as e) {
              <p class="error" role="alert">{{ e }}</p>
            }
          </div>

          @for (d of otherErrors(); track d) {
            <p class="error" role="alert">{{ d }}</p>
          }
        </form>

        <details class="tester">
          <summary>اختبر القالب</summary>
          <app-template-tester [subject]="subject()" [event]="eventValue()" [templateId]="editing?.id ?? null" />
        </details>
      </div>
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إلغاء</button>
        <button type="submit" form="tpl-form" class="btn btn--primary" [disabled]="saving()">{{ saving() ? 'جارٍ الحفظ…' : editing ? 'حفظ' : 'إنشاء القالب' }}</button>
      </ng-container>
    </app-dialog-shell>
  `,
})
export class TemplateFormDialog {
  protected readonly ref = inject<DialogRef<ApprovalTemplate>>(DialogRef);
  private readonly data = inject(DIALOG_DATA) as TemplateFormData;
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly api = inject(ApprovalTemplatesApi);
  private readonly users = inject(UserLookup);
  protected readonly roles = inject(RoleLookup);
  private readonly types = inject(WorkItemTypeLookup);
  private readonly projects = inject(ProjectLookup);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected readonly help = HELP;
  protected readonly editing = this.data.template;
  protected readonly events = (Object.keys(APPROVAL_EVENT_LABELS) as ApprovalEvent[]).map((key) => ({ key, label: APPROVAL_EVENT_LABELS[key] }));
  protected readonly positions = POSITIONS;
  protected readonly positionLabels = POSITION_SHORT;
  protected readonly saving = signal(false);
  protected readonly serverErrors = signal<Readonly<Record<string, string>>>({});
  protected readonly otherErrors = signal<readonly string[]>([]);
  protected readonly protectedFields = signal<readonly string[]>(this.editing?.protectedFields ?? []);
  protected readonly rule = signal<ApprovalRule>(this.editing?.rule ?? {});
  protected readonly activeUsers = computed(() => this.users.items().filter((u) => u.active));

  protected readonly form = this.fb.group({
    name: this.fb.control(this.editing?.name ?? '', Validators.required),
    event: this.fb.control<ApprovalEvent>(this.editing?.event ?? 'project-approve'),
    active: this.fb.control(this.editing?.active ?? true),
    allowSelfApproval: this.fb.control(this.editing?.allowSelfApproval ?? false),
    stages: this.fb.array<StageForm>(
      (this.editing?.stages ?? [{ order: 1, name: '', approverKind: 'role', approverId: '' } as ApprovalStage]).map((s) => this.stageForm(s)),
      (c) => ((c as FormArray).length ? null : { minStages: true }),
    ),
  });

  private readonly value = toSignal(this.form.valueChanges.pipe(startWith(null), map(() => this.form.getRawValue())), {
    initialValue: this.form.getRawValue(),
  });

  protected readonly eventValue = computed(() => this.value().event);

  /** Which kind of subject the template is for (decided by its event, or by the protected fields of a sensitive change). */
  protected readonly subject = computed<ApprovalSubject>(() => {
    const event = this.eventValue();
    if (event === 'project-approve' || event === 'project-close') return 'project';
    if (event === 'work-item-approve') return 'work-item';
    const fields = this.protectedFields();
    const projectOnly = fields.length > 0 && fields.every((f) => PROTECTABLE_FIELDS.some((p) => p.subject === 'project' && p.key === f)) && fields.some((f) => !PROTECTABLE_FIELDS.some((p) => p.subject === 'work-item' && p.key === f));
    return projectOnly ? 'project' : 'work-item';
  });

  protected readonly fieldGroups = computed(() => {
    const event = this.eventValue();
    const subjects: readonly ApprovalSubject[] = event === 'sensitive-change' ? ['work-item', 'project'] : [this.subject()];
    return subjects.map((subject) => ({ subject, title: SUBJECT_TITLES[subject], fields: PROTECTABLE_FIELDS.filter((f) => f.subject === subject) }));
  });

  protected readonly summary = computed(() =>
    summarizeRule(this.rule(), {
      event: this.eventValue(),
      typeName: (id) => this.types.get(id)?.name ?? id,
      projectName: (id) => this.projects.get(id)?.name ?? id,
      priorityLabel: (p) => PRIORITY_LABELS[p],
    }),
  );

  protected readonly steps = computed<readonly StepperStep[]>(() =>
    this.value().stages.map((s) => ({
      name: s.name,
      approver: this.approverName(s.approverKind, s.approverId),
      due: s.dueHours ? `${s.dueHours} ساعة` : undefined,
    })),
  );

  private approverName(kind: ApproverKind, id: string): string {
    const name = kind === 'user' ? this.users.get(id)?.name : kind === 'role' ? this.roles.get(id)?.name : POSITION_SHORT[id as ApproverPosition];
    return name ?? 'لم يُحدَّد المعتمِد';
  }

  private stageForm(stage: ApprovalStage): StageForm {
    return this.fb.group({
      name: this.fb.control(stage.name, Validators.required),
      approverKind: this.fb.control<ApproverKind>(stage.approverKind),
      approverId: this.fb.control(stage.approverId, Validators.required),
      dueHours: this.fb.control<number | null>(stage.dueHours ?? null, [Validators.min(1), Validators.max(720)]),
    });
  }

  protected onKindChange(stage: StageForm): void {
    stage.controls.approverId.setValue('');
  }

  protected addStage(): void {
    this.form.controls.stages.push(this.stageForm({ order: 0, name: '', approverKind: 'role', approverId: '' }));
  }

  protected removeStage(index: number): void {
    const name = this.form.controls.stages.at(index).controls.name.value.trim();
    this.confirm
      .confirm({
        title: 'حذف المرحلة',
        message: name ? `سيتم حذف المرحلة «${name}» من القالب. هل تريد المتابعة؟` : 'سيتم حذف المرحلة من القالب. هل تريد المتابعة؟',
        confirmText: 'حذف',
        danger: true,
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.form.controls.stages.removeAt(index);
        this.form.controls.stages.markAsTouched();
      });
  }

  protected move(index: number, delta: number): void {
    moveControl(this.form.controls.stages, index, index + delta);
  }

  protected toggleProtected(key: string, checked: boolean): void {
    this.protectedFields.update((keys) => (checked ? [...keys.filter((k) => k !== key), key] : keys.filter((k) => k !== key)));
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const v = this.form.getRawValue();
    const payload = {
      name: v.name.trim(),
      event: v.event,
      active: v.active,
      allowSelfApproval: v.allowSelfApproval,
      protectedFields: this.protectedFields(),
      rule: this.cleanRule(),
      stages: v.stages.map((s, i): ApprovalStage => ({
        order: i + 1,
        name: s.name.trim(),
        approverKind: s.approverKind,
        approverId: s.approverId,
        ...(s.dueHours ? { dueHours: Math.trunc(s.dueHours) } : {}),
      })),
    };
    const request$ = this.editing ? this.api.update(this.editing.id, { ...payload, version: this.editing.version }) : this.api.create(payload);

    this.saving.set(true);
    this.serverErrors.set({});
    this.otherErrors.set([]);
    request$.subscribe({
      next: (saved) => {
        this.toast.success('تم حفظ قالب الموافقة');
        this.ref.close(saved);
      },
      error: (e: unknown) => {
        this.saving.set(false);
        if (this.editing && isApiError(e) && e.status === 409) {
          // Stale version: the interceptor toasted the message; the page reloads the list on close.
          this.ref.close();
          return;
        }
        this.mapErrors(e);
      },
    });
  }

  /** Field keys from `validateApprovalTemplate` map to sections; anything else is listed at the bottom. */
  private mapErrors(e: unknown): void {
    if (!isApiError(e) || !e.details) return;
    const known = ['name', 'event', 'protectedFields', 'stages', 'rule', 'allowSelfApproval'];
    const mapped: Record<string, string> = {};
    const other: string[] = [];
    for (const [k, msg] of Object.entries(e.details)) {
      if (known.includes(k)) mapped[k] = msg;
      else other.push(msg);
    }
    this.serverErrors.set(mapped);
    this.otherErrors.set(other);
  }

  /** Drops empty parts so a rule with no restrictions is stored as `{}`. */
  private cleanRule(): ApprovalRule {
    const r = this.rule();
    const isWork = this.eventValue() === 'work-item-approve' || this.eventValue() === 'sensitive-change';
    const out: { -readonly [K in keyof ApprovalRule]: ApprovalRule[K] } = {};
    if (isWork && r.workItemTypeIds?.length) out.workItemTypeIds = r.workItemTypeIds;
    if (r.projectIds?.length) out.projectIds = r.projectIds;
    if (isWork && r.priorities?.length) out.priorities = r.priorities;
    if (r.actions?.length) out.actions = r.actions;
    if (r.conditions?.length) out.conditions = r.conditions;
    if (r.priority !== undefined) out.priority = r.priority;
    return out;
  }
}
