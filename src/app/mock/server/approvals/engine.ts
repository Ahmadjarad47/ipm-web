import {
  APPROVAL_TTL_DAYS, ApprovalAction, ApprovalEvent, ApprovalRequest, ApprovalRule, ApprovalStage, ApprovalSubject, ApprovalTemplate, APPROVAL_EVENT_LABELS, ApproverPosition, RuleCondition,
} from '@domain/approvals/approval.models';
import { Priority, WorkItem } from '@domain/work-items/work-item.models';
import { Project } from '@domain/projects/project.models';
import { MockDatabase } from '../../db/database';
import { fail, MockContext } from '../router';

/** Approval rule engine (FR-APR-01/13, §4.3): which template governs a subject, and when an approval is still valid. */

export interface SubjectRef {
  readonly subjectType: ApprovalSubject;
  readonly subjectId: string;
}

type FieldValue = string | number | null;
export type ProposedChanges = Readonly<Record<string, FieldValue>>;

/** Fields a `sensitive.change` template may protect, per subject type; also decides which subject a template is for. */
export const SUBJECT_FIELDS: Readonly<Record<ApprovalSubject, readonly string[]>> = {
  project: ['name', 'description', 'startDate', 'endDate', 'ownerId', 'members'],
  workItem: ['title', 'description', 'dueDate', 'startDate', 'parentId', 'priority', 'typeId', 'assigneeIds', 'relations'],
};

/** Protected fields that are observed (snapshot / supersede) but can never be proposed through a sensitive-change request. */
const NON_PROPOSABLE: readonly string[] = ['members', 'relations'];

export const FIELD_LABELS: Readonly<Record<string, string>> = {
  title: 'العنوان', description: 'الوصف', dueDate: 'تاريخ الاستحقاق', startDate: 'تاريخ البداية', endDate: 'تاريخ النهاية', parentId: 'العنصر الأب',
  priority: 'الأولوية', typeId: 'النوع', assigneeIds: 'المسؤولون', members: 'الأعضاء', relations: 'العلاقات', name: 'الاسم', ownerId: 'المالك',
};

const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high', 'critical'];
const ACTIONS: readonly ApprovalAction[] = ['close', 'reopen', 'change', 'activate'];
const EVENTS = Object.keys(APPROVAL_EVENT_LABELS) as ApprovalEvent[];
const POSITIONS: readonly ApproverPosition[] = ['project_owner', 'direct_manager', 'project_manager'];

export const fieldLabel = (field: string): string => FIELD_LABELS[field] ?? field;

export function projectIdOf(db: MockDatabase, subject: SubjectRef): string {
  return subject.subjectType === 'project' ? db.projects.get(subject.subjectId).id : db.workItems.get(subject.subjectId).projectId;
}

function recordOf(db: MockDatabase, subject: SubjectRef): Record<string, unknown> {
  return (subject.subjectType === 'project' ? db.projects.get(subject.subjectId) : db.workItems.get(subject.subjectId)) as unknown as Record<string, unknown>;
}

/** Comparable value of a subject field: ids that users read as names/refs stay readable in the frozen copy. */
function snapshotValue(db: MockDatabase, field: string, raw: unknown): FieldValue {
  if (field === 'ownerId') return db.users.find(String(raw))?.name ?? null;
  if (field === 'parentId') return db.workItems.find(String(raw))?.ref ?? null;
  if (field === 'assigneeIds') return (typeof raw === 'string' ? raw.split(',').filter(Boolean) : [...((raw as readonly string[] | undefined) ?? [])]).sort().join(',');
  return (raw as FieldValue | undefined) ?? null;
}

/** Comparable value of a field that is derived from other collections (project members, work item relations). */
function derivedValue(db: MockDatabase, subject: SubjectRef, field: string): FieldValue {
  if (field === 'members' && subject.subjectType === 'project') {
    return db.projects.get(subject.subjectId).members.map((m) => `${m.userId}:${m.roleId}`).sort().join(',');
  }
  if (field === 'relations' && subject.subjectType === 'workItem') {
    return db.relations.where((x) => x.sourceId === subject.subjectId || x.targetId === subject.subjectId).map((x) => `${x.relationTypeId}:${x.sourceId}>${x.targetId}`).sort().join(',');
  }
  return null;
}

/** Frozen copy of the protected fields at submission time (FR-APR-03). */
export function snapshotOf(db: MockDatabase, subject: SubjectRef, fields: readonly string[]): Record<string, FieldValue> {
  const record = recordOf(db, subject);
  const snapshot: Record<string, FieldValue> = {};
  for (const f of fields) snapshot[f] = f === 'members' || f === 'relations' ? derivedValue(db, subject, f) : snapshotValue(db, f, record[f]);
  return snapshot;
}

/** Protected fields whose live value differs from the request's frozen copy. */
export function changedSinceSnapshot(db: MockDatabase, request: ApprovalRequest, template: ApprovalTemplate | undefined): string[] {
  const fields = template?.protectedFields ?? Object.keys(request.snapshot);
  const live = snapshotOf(db, request, fields);
  return fields.filter((f) => f in request.snapshot && live[f] !== request.snapshot[f]);
}

/** The template event an action on a subject needs. */
export function eventFor(subjectType: ApprovalSubject, action: ApprovalAction): ApprovalEvent {
  if (action === 'change') return 'sensitive.change';
  if (subjectType === 'project') return action === 'close' ? 'project.close' : 'project.approve';
  return 'workItem.approve';
}

function compatibleWithSubject(template: ApprovalTemplate, subjectType: ApprovalSubject): boolean {
  if (template.event === 'project.approve' || template.event === 'project.close') return subjectType === 'project';
  if (template.event === 'workItem.approve') return subjectType === 'workItem';
  // sensitive.change: the protected fields tell which kind of subject it is for.
  return template.protectedFields.length > 0 && template.protectedFields.every((f) => SUBJECT_FIELDS[subjectType].includes(f));
}

function conditionHolds(c: RuleCondition, actual: unknown): boolean {
  switch (c.op) {
    case 'eq': return String(actual ?? '') === String(c.value);
    case 'neq': return String(actual ?? '') !== String(c.value);
    case 'gt': return typeof actual === 'number' || typeof c.value === 'number' ? Number(actual) > Number(c.value) : String(actual ?? '') > String(c.value);
    case 'lt': return typeof actual === 'number' || typeof c.value === 'number' ? Number(actual) < Number(c.value) : String(actual ?? '') < String(c.value);
    case 'in': return Array.isArray(c.value) && c.value.map(String).includes(String(actual ?? ''));
  }
}

/**
 * Does `template` govern this subject? `action` narrows by the rule's `actions` (omitted = any action);
 * `changes` (for `sensitive.change`) must touch a protected field.
 */
export function templateMatches(db: MockDatabase, template: ApprovalTemplate, subject: SubjectRef, action?: ApprovalAction, changes?: ProposedChanges): boolean {
  if (!compatibleWithSubject(template, subject.subjectType)) return false;
  if (action && template.event !== eventFor(subject.subjectType, action)) return false;
  if (template.event === 'sensitive.change' && changes && !Object.keys(changes).some((k) => template.protectedFields.includes(k))) return false;
  const rule: ApprovalRule = template.rule ?? {};
  const record = recordOf(db, subject);
  const projectId = projectIdOf(db, subject);
  if (rule.projectIds?.length && !rule.projectIds.includes(projectId)) return false;
  if (rule.workItemTypeIds?.length && (subject.subjectType !== 'workItem' || !rule.workItemTypeIds.includes((record as unknown as WorkItem).typeId))) return false;
  if (rule.priorities?.length && (subject.subjectType !== 'workItem' || !rule.priorities.includes((record as unknown as WorkItem).priority))) return false;
  if (action && rule.actions?.length && !rule.actions.includes(action)) return false;
  return (rule.conditions ?? []).every((c) => conditionHolds(c, record[c.field]));
}

function specificity(rule: ApprovalRule | undefined): number {
  if (!rule) return 0;
  return [rule.workItemTypeIds?.length, rule.projectIds?.length, rule.priorities?.length, rule.actions?.length, rule.conditions?.length].filter(Boolean).length;
}

/** Active template governing `action` on the subject: highest rule priority, then most specific, then oldest. */
export function matchTemplate(db: MockDatabase, subject: SubjectRef, action: ApprovalAction, changes?: ProposedChanges): ApprovalTemplate | null {
  const candidates = db.templates.where((t) => t.active && templateMatches(db, t, subject, action, changes));
  candidates.sort((a, b) =>
    (b.rule?.priority ?? 0) - (a.rule?.priority ?? 0) || specificity(b.rule) - specificity(a.rule) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  return candidates[0] ?? null;
}

export interface RequireApprovalOptions extends SubjectRef {
  readonly action: ApprovalAction;
  /** Target status of the gated transition; an approval bound to another target is refused. */
  readonly targetStatusId?: string;
}

const DAY_MS = 86_400_000;

/** Is this approval spent (persistent `consumedAt`, or the legacy in-memory set)? */
export const isConsumed = (db: MockDatabase, a: ApprovalRequest): boolean => !!a.consumedAt || db.consumedApprovals.has(a.id);

/** Approved requests authorise their action for {@link APPROVAL_TTL_DAYS} days only. */
export const isExpired = (a: ApprovalRequest, now: number = Date.now()): boolean => now - Date.parse(a.updatedAt) > APPROVAL_TTL_DAYS * DAY_MS;

/**
 * Gate for a protected transition (FR-APR-08/10, §4.3): needs an Approved, not yet consumed request of the
 * right event whose protected fields still equal the live values. The caller consumes it after success.
 */
export function requireApproval(db: MockDatabase, ctx: MockContext, opts: RequireApprovalOptions): ApprovalRequest {
  const event = eventFor(opts.subjectType, opts.action);
  const candidates = db.approvals
    .where((a) => a.subjectType === opts.subjectType && a.subjectId === opts.subjectId && a.status === 'Approved' && db.templates.find(a.templateId)?.event === event && !isConsumed(db, a)
      && !isExpired(a) && (!a.action || a.action === opts.action) && (!a.targetStatusId || a.targetStatusId === opts.targetStatusId))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!candidates.length) {
    fail(422, opts.subjectType === 'project'
      ? `يتطلب هذا الانتقال موافقة معتمدة جديدة من نوع «${APPROVAL_EVENT_LABELS[event]}» أولًا.`
      : 'يتطلب هذا الانتقال اكتمال الموافقة أولًا.');
  }
  const stale = new Map<string, string[]>();
  for (const c of candidates) {
    const changed = changedSinceSnapshot(db, c, db.templates.find(c.templateId));
    if (!changed.length) return c;
    stale.set(c.id, changed);
  }
  const first = candidates[0];
  db.log(ctx.me, 'approval.gate_blocked', { type: 'approval', id: first.id, label: first.title, projectId: first.projectId }, [
    { field: 'الحقول المتغيرة بعد الموافقة', from: null, to: (stale.get(first.id) ?? []).map(fieldLabel).join('، ') },
  ]);
  return fail(422, 'تغيّرت بيانات محمية بعد الموافقة؛ أُبطلت الموافقة ويلزم طلب جديد.');
}

/** An approval authorises exactly one protected action. */
export function consumeApproval(db: MockDatabase, request: ApprovalRequest): void {
  db.consumedApprovals.add(request.id);
  db.approvals.patch(request.id, { consumedAt: new Date().toISOString() });
}

/** Direct approvers of a stage for this request: the list frozen at submission, else resolved live (legacy requests). */
function frozenOrLive(db: MockDatabase, request: Pick<ApprovalRequest, 'resolvedApprovers' | 'projectId' | 'requesterId'>, stage: ApprovalStage): { direct: string[]; delegates: Map<string, string> } {
  const frozen = request.resolvedApprovers?.[stage.order];
  if (!frozen) return db.resolveStageApprovers(stage, request.projectId, request.requesterId);
  // Delegations stay dynamic: resolve each frozen user as a plain user stage and merge the delegates.
  const direct = [...new Set(frozen)];
  const delegates = new Map<string, string>();
  for (const id of direct) {
    for (const [to, from] of db.resolveStageApprovers({ approverKind: 'user', approverId: id }, request.projectId, request.requesterId).delegates) {
      if (!direct.includes(to)) delegates.set(to, from);
    }
  }
  return { direct, delegates };
}

/** Same shape as `db.resolveStageApprovers`, honouring the approvers frozen when the request was submitted. */
export function resolveRequestStage(db: MockDatabase, request: Pick<ApprovalRequest, 'resolvedApprovers' | 'projectId' | 'requesterId'>, stage: ApprovalStage): { direct: string[]; delegates: Map<string, string> } {
  return frozenOrLive(db, request, stage);
}

export function requestStageApprovers(db: MockDatabase, request: Pick<ApprovalRequest, 'resolvedApprovers' | 'projectId' | 'requesterId'>, stage: ApprovalStage): string[] {
  const { direct, delegates } = frozenOrLive(db, request, stage);
  return [...new Set([...direct, ...delegates.keys()])];
}

/** Resolves every stage once (positions and roles included) so later org changes don't alter who may decide. */
export function freezeApprovers(db: MockDatabase, stages: readonly ApprovalStage[], projectId: string, requesterId: string): Record<number, string[]> {
  const frozen: Record<number, string[]> = {};
  for (const stage of stages) frozen[stage.order] = db.resolveStageApprovers(stage, projectId, requesterId).direct;
  return frozen;
}

/** Direct edit of a protected field is refused while an active `sensitive.change` template governs the subject. */
export function assertNoDirectSensitiveChange(db: MockDatabase, subject: SubjectRef, changes: ProposedChanges): void {
  const current = recordOf(db, subject);
  const changed: Record<string, FieldValue> = {};
  for (const [k, v] of Object.entries(changes)) {
    if (JSON.stringify(current[k] ?? null) !== JSON.stringify(v ?? null)) changed[k] = v;
  }
  if (!Object.keys(changed).length) return;
  const template = matchTemplate(db, subject, 'change', changed);
  if (!template) return;
  const fields = Object.keys(changed).filter((k) => template.protectedFields.includes(k));
  fail(422, `تعديل ${fields.map(fieldLabel).join('، ')} يتطلب طلب موافقة «${template.name}» ولا يُنفَّذ مباشرة.`, { code: 'approval_required', templateId: template.id, fields: fields.join(',') });
}

// ---------- Sensitive change: validation and atomic apply ----------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parentCycles(db: MockDatabase, itemId: string, parentId: string): boolean {
  const seen = new Set<string>();
  for (let cursor: string | null = parentId; cursor; cursor = db.workItems.find(cursor)?.parentId ?? null) {
    if (cursor === itemId || seen.has(cursor)) return true;
    seen.add(cursor);
  }
  return false;
}

/** Validates what a requester proposes before the request exists, so a doomed change never reaches approvers. */
export function validateProposedChanges(db: MockDatabase, template: ApprovalTemplate, subject: SubjectRef, changes: ProposedChanges | undefined): ProposedChanges {
  const keys = Object.keys(changes ?? {});
  if (!changes || !keys.length) fail(422, 'حدّد القيم المقترحة للحقول المحمية.', { proposedChanges: 'مطلوب' });
  const bad = keys.filter((k) => NON_PROPOSABLE.includes(k) || !template.protectedFields.includes(k) || !SUBJECT_FIELDS[subject.subjectType].includes(k));
  if (bad.length) fail(422, `حقول غير محمية بهذا القالب: ${bad.map(fieldLabel).join('، ')}.`, { proposedChanges: 'حقول غير مسموحة' });
  const errors: Record<string, string> = {};
  const record = recordOf(db, subject);
  const merged = { ...record, ...changes } as Record<string, unknown>;
  for (const [k, v] of Object.entries(changes)) {
    if (k === 'title' || k === 'name') {
      if (typeof v !== 'string' || !v.trim()) errors[k] = 'مطلوب';
    } else if (k === 'priority') {
      if (!PRIORITIES.includes(v as Priority)) errors[k] = 'أولوية غير صالحة';
    } else if (k === 'dueDate' || k === 'startDate' || k === 'endDate') {
      if (v !== null && !(typeof v === 'string' && ISO_DATE.test(v))) errors[k] = 'تاريخ غير صالح';
    } else if (k === 'assigneeIds') {
      const ids = typeof v === 'string' && v ? v.split(',') : [];
      if (typeof v !== 'string' || ids.some((id) => !db.users.find(id)?.active)) errors[k] = 'مستخدمون غير صالحين';
    } else if (k === 'ownerId') {
      const project = db.projects.get(subject.subjectId);
      if (typeof v !== 'string' || !db.users.find(v)?.active || !project.members.some((m) => m.userId === v)) errors[k] = 'يجب أن يكون المالك عضوًا نشطًا';
    } else if (k === 'parentId') {
      const item = db.workItems.get(subject.subjectId);
      const parent = typeof v === 'string' ? db.workItems.find(v) : null;
      if (v !== null && (!parent || parent.projectId !== item.projectId || parentCycles(db, item.id, parent.id) || !db.types.find(parent.typeId)?.allowedChildTypeIds.includes(item.typeId))) errors[k] = 'أب غير صالح';
    } else if (k === 'typeId') {
      const item = db.workItems.get(subject.subjectId);
      const type = typeof v === 'string' ? db.types.find(v) : undefined;
      if (!type?.active || !db.projects.get(item.projectId).allowedTypeIds.includes(type.id) || !db.workflows.find(type.workflowId)?.statusIds.includes(item.statusId)) errors[k] = 'نوع غير صالح';
    }
  }
  if (subject.subjectType === 'project' && !errors['endDate'] && merged['startDate'] && merged['endDate'] && String(merged['endDate']) < String(merged['startDate'])) errors['endDate'] = 'يسبق البداية';
  if (Object.keys(errors).length) fail(422, 'القيم المقترحة غير صالحة.', errors);
  const unchanged = keys.every((k) => snapshotValue(db, k, record[k]) === snapshotValue(db, k, changes[k]) || JSON.stringify(record[k] ?? null) === JSON.stringify(changes[k] ?? null));
  if (unchanged) fail(422, 'القيم المقترحة مطابقة للحالية؛ لا يوجد تعديل لطلبه.');
  return changes;
}

export interface AppliedChange {
  readonly field: string;
  readonly from: string | null;
  readonly to: string | null;
}

/** Applies the approved proposal atomically (all fields in one patch); returns readable change rows for the audit. */
export function applyProposedChanges(db: MockDatabase, request: ApprovalRequest): AppliedChange[] {
  const proposed = request.proposedChanges ?? {};
  const subject: SubjectRef = request;
  const before = recordOf(db, subject);
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(proposed)) patch[k] = k === 'assigneeIds' ? (typeof v === 'string' && v ? v.split(',') : []) : v;
  const rows: AppliedChange[] = Object.keys(proposed).map((k) => ({
    field: fieldLabel(k),
    from: k === 'ownerId' || k === 'parentId' || k === 'assigneeIds' ? String(snapshotValue(db, k, before[k]) ?? '') || null : before[k] === null || before[k] === undefined ? null : String(before[k]),
    to: k === 'ownerId' ? db.users.find(String(proposed[k]))?.name ?? null : k === 'parentId' ? db.workItems.find(String(proposed[k]))?.ref ?? null : proposed[k] === null ? null : String(proposed[k]),
  }));
  if (subject.subjectType === 'project') db.projects.patch(subject.subjectId, patch as Partial<Project>);
  else db.workItems.patch(subject.subjectId, patch as Partial<WorkItem>);
  return rows;
}

// ---------- Stages: due dates and template validation ----------

/** When a stage that just became active goes overdue (FR-APR-07); null without `dueHours`. */
export function stageDueAt(stage: ApprovalStage | undefined, now: Date = new Date()): string | null {
  return stage?.dueHours ? new Date(now.getTime() + stage.dueHours * 3_600_000).toISOString() : null;
}

export function isOverdue(request: ApprovalRequest, now: Date = new Date()): boolean {
  return request.status === 'PendingApproval' && !!request.stageDueAt && request.stageDueAt < now.toISOString();
}

/** Server-side validation of a template on save (FR-APR-01/02): stages, approvers and rule. */
export function validateApprovalTemplate(db: MockDatabase, t: Pick<ApprovalTemplate, 'name' | 'event' | 'stages' | 'protectedFields' | 'rule' | 'allowSelfApproval'>): void {
  const errors: Record<string, string> = {};
  if (!t.name?.trim()) errors['name'] = 'مطلوب';
  if (!EVENTS.includes(t.event)) errors['event'] = 'حدث غير معروف';
  if (!Array.isArray(t.protectedFields)) errors['protectedFields'] = 'قائمة حقول مطلوبة';
  else if (t.event === 'sensitive.change' && (!t.protectedFields.length || !(['project', 'workItem'] as const).some((s) => t.protectedFields.every((f) => SUBJECT_FIELDS[s].includes(f))))) {
    errors['protectedFields'] = 'التعديل الحساس يتطلب حقولًا محمية صالحة لنوع واحد (مشروع أو عنصر عمل)';
  }
  if (t.allowSelfApproval !== undefined && typeof t.allowSelfApproval !== 'boolean') errors['allowSelfApproval'] = 'قيمة منطقية مطلوبة';
  const stages = t.stages ?? [];
  if (!Array.isArray(stages) || !stages.length) errors['stages'] = 'مرحلة واحدة على الأقل';
  else {
    const orders = stages.map((s) => s.order).sort((a, b) => a - b);
    if (orders.some((o, i) => o !== i + 1)) errors['stages'] = 'ترتيب المراحل يجب أن يكون متسلسلًا وفريدًا يبدأ من 1';
    const sorted = [...stages].sort((a, b) => a.order - b.order);
    sorted.forEach((s, i) => {
      const where = `المرحلة ${s.order}`;
      if (!s.name?.trim()) errors['stages'] = `${where}: الاسم مطلوب`;
      if (s.dueHours !== undefined && (!Number.isInteger(s.dueHours) || s.dueHours < 1 || s.dueHours > 720)) errors['stages'] = `${where}: المهلة بين 1 و720 ساعة`;
      if (s.approverKind === 'user') {
        const user = db.users.find(s.approverId);
        if (!user) errors['stages'] = `${where}: المعتمد غير موجود`;
        else if (!user.active) errors['stages'] = `${where}: المعتمد «${user.name}» غير نشط`;
      } else if (s.approverKind === 'role') {
        if (!db.roles.find(s.approverId)) errors['stages'] = `${where}: الدور غير موجود`;
      } else if (s.approverKind === 'position') {
        if (!POSITIONS.includes(s.approverId as ApproverPosition)) errors['stages'] = `${where}: منصب غير صالح`;
      } else errors['stages'] = `${where}: نوع المعتمد غير صالح`;
      const prev = sorted[i - 1];
      if (prev && prev.approverKind === s.approverKind && prev.approverId === s.approverId) errors['stages'] = `${where}: المعتمد نفسه في مرحلتين متتاليتين`;
    });
  }
  const rule = t.rule;
  if (rule) {
    if (rule.workItemTypeIds?.some((id) => !db.types.find(id))) errors['rule'] = 'نوع عنصر عمل غير معروف في القاعدة';
    else if (rule.projectIds?.some((id) => !db.projects.find(id))) errors['rule'] = 'مشروع غير معروف في القاعدة';
    else if (rule.priorities?.some((p) => !PRIORITIES.includes(p))) errors['rule'] = 'أولوية غير صالحة في القاعدة';
    else if (rule.actions?.some((a) => !ACTIONS.includes(a))) errors['rule'] = 'إجراء غير صالح في القاعدة';
    else if (rule.priority !== undefined && !Number.isInteger(rule.priority)) errors['rule'] = 'أولوية القاعدة عدد صحيح';
    else if (rule.conditions?.some((c) => !c.field?.trim() || !['eq', 'neq', 'gt', 'lt', 'in'].includes(c.op) || (c.op === 'in' ? !Array.isArray(c.value) : Array.isArray(c.value)))) errors['rule'] = 'شرط غير صالح في القاعدة';
  }
  if (Object.keys(errors).length) fail(422, 'قالب الموافقة غير صالح: ' + Object.values(errors).join('؛ ') + '.', errors);
}
