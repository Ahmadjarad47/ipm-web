import { PermissionKey } from '@core/auth/permissions';
import { SubmitApprovalRequest } from '@domain/approvals/approval.api';
import { ApprovalAction, ApprovalRequest, BulkDecideResult, DecideRequest, Delegation, DelegationCreate, DECISION_LABELS } from '@domain/approvals/approval.models';
import { MockHttpError } from '../../db/collection';
import { MockDatabase } from '../../db/database';
import { orgToday } from '../../db/time';
import {
  applyProposedChanges, changedSinceSnapshot, consumeApproval, eventFor, freezeApprovers, isOverdue, matchTemplate, projectIdOf, requestStageApprovers, resolveRequestStage,
  snapshotOf, stageDueAt, templateMatches, validateProposedChanges,
} from '../approvals/engine';
import { body, fail, MockContext, MockRouter, parseListQuery } from '../router';
import { supersedeIfProtected } from './projects.handlers';

const HOUR = 3_600_000;
const MAX_BULK = 50;
const MAX_DELEGATION_DAYS = 90;

/** FR-APR-06: the self-approval exception needs BOTH the global setting and the template flag. */
function selfApprovalAllowed(db: MockDatabase, request: ApprovalRequest): boolean {
  return db.settings.allowSelfApproval && !!db.templates.find(request.templateId)?.allowSelfApproval;
}

function canDecideNow(db: MockDatabase, userId: string, request: ApprovalRequest): boolean {
  if (request.status !== 'PendingApproval') return false;
  if (userId === request.requesterId && !selfApprovalAllowed(db, request)) return false;
  const stage = request.stages.find((s) => s.order === request.currentStage);
  return !!stage && requestStageApprovers(db, request, stage).includes(userId);
}

/** Adds the computed, per-caller flags (`overdue`, `canDecide`) to a stored request. */
function decorate(db: MockDatabase, ctx: MockContext, request: ApprovalRequest): ApprovalRequest {
  return { ...request, overdue: isOverdue(request), canDecide: canDecideNow(db, ctx.me, request) };
}

function visibleRequest(db: MockDatabase, ctx: MockContext, id: string): ApprovalRequest {
  const request = db.approvals.get(id);
  // Hidden from anyone without approvals.view in that project, unless they are the requester or current approver (FR-APR-07).
  const allowed = request.requesterId === ctx.me || canDecideNow(db, ctx.me, request) || ctx.can('approvals.view', request.projectId);
  if (!allowed) fail(404, 'العنصر غير موجود أو لا تملك صلاحية الاطلاع عليه.');
  return request;
}

const userName = (db: MockDatabase, id: string): string => db.users.find(id)?.name ?? id;

/** Every stage must resolve to at least one approver, or the request could never complete. */
function assertStagesResolvable(db: MockDatabase, request: Pick<ApprovalRequest, 'stages' | 'projectId' | 'requesterId' | 'templateId'>): void {
  for (const stage of request.stages) {
    const approvers = db.stageApprovers(stage, request.projectId, request.requesterId);
    if (!approvers.length) fail(422, `تعذّر تحديد معتمد للمرحلة ${stage.order} «${stage.name}» لهذا الطلب.`);
  }
}

function notifyStage(db: MockDatabase, request: ApprovalRequest, stageOrder: number, title: string, except: string): void {
  const stage = request.stages.find((s) => s.order === stageOrder);
  if (stage) db.notify(requestStageApprovers(db, request, stage), title, request.title, `/approvals/${request.id}`, except);
}

/** One decision, used by both the single and the bulk endpoint so every rule applies identically. */
function decideRequest(db: MockDatabase, ctx: MockContext, id: string, dto: DecideRequest): ApprovalRequest {
  const request = visibleRequest(db, ctx, id);
  const { decision, comment, revision } = dto;
  ctx.require('approvals.decide', request.projectId);
  if (!(decision in DECISION_LABELS)) fail(400, 'قرار غير صالح.', { decision: 'غير صالح' });
  if (request.status === 'Superseded' || revision !== request.revision) fail(409, 'هذا الإصدار من الطلب أُبطل؛ لا يُقبل قرار متأخر عليه.');
  if (request.status !== 'PendingApproval') fail(422, 'الطلب ليس بانتظار قرار.');
  const selfDecision = request.requesterId === ctx.me;
  // FR-APR-06: banned unless the global setting AND the template both allow it; the exception is audited.
  if (selfDecision && !selfApprovalAllowed(db, request)) fail(403, 'لا يمكنك اعتماد طلب قدّمته بنفسك.');
  const stage = request.stages.find((s) => s.order === request.currentStage)!;
  const { direct, delegates } = resolveRequestStage(db, request, stage);
  if (!direct.includes(ctx.me) && !delegates.has(ctx.me)) fail(403, 'ليست لك صلاحية القرار في المرحلة الحالية.');
  if (decision !== 'Approve' && !comment?.trim()) fail(400, 'التعليق إلزامي عند الرفض أو الإرجاع.', { comment: 'مطلوب' });
  const onBehalfOf = direct.includes(ctx.me) ? undefined : delegates.get(ctx.me);
  const template = db.templates.find(request.templateId);
  const last = request.currentStage >= request.stages.length;
  const applyNow = decision === 'Approve' && last && template?.event === 'sensitive.change' && !!request.proposedChanges;
  if (applyNow && db.projects.get(request.projectId).archived) fail(422, 'المشروع مؤرشف؛ لا يمكن تطبيق التعديل.');
  if (applyNow) {
    // The world may have moved since submission (owner removed, assignee deactivated, parent now cyclic, type unfit):
    // re-run the same validation on the live data, and refuse when the protected values drifted from what approvers saw.
    const drift = changedSinceSnapshot(db, request, template);
    if (drift.length) fail(409, 'تغيّرت بيانات محمية بعد تقديم الطلب؛ أعد تقديمه ليُراجَع من جديد.', { snapshot: drift.join('،') });
    validateProposedChanges(db, template!, request, request.proposedChanges);
    // The requester must still be allowed to make this change when it lands.
    requireEditRights(new MockContext(db, request.requesterId), request.projectId, request.subjectType, Object.keys(request.proposedChanges ?? {}));
  }

  const entry = { stageOrder: request.currentStage, deciderId: ctx.me, decision, comment: comment ?? '', at: new Date().toISOString(), revision, ...(onBehalfOf ? { onBehalfOf } : {}) };
  const decisions = [...request.decisions, entry];
  const nextStage = request.stages.find((s) => s.order === request.currentStage + 1);
  const changes: Partial<ApprovalRequest> =
    decision === 'Approve'
      ? last
        ? { decisions, status: 'Approved', currentStage: 0, stageDueAt: null }
        : { decisions, currentStage: request.currentStage + 1, stageDueAt: stageDueAt(nextStage), lastRemindedAt: null }
      : { decisions, status: decision === 'Reject' ? 'Rejected' : 'Returned', currentStage: 0, stageDueAt: null };
  let next = db.approvals.patch(request.id, changes);

  const who = onBehalfOf ? `${userName(db, ctx.me)} (نيابةً عن ${userName(db, onBehalfOf)})` : userName(db, ctx.me);
  const audit = { type: 'approval' as const, id: request.id, label: request.title, projectId: request.projectId };
  db.log(ctx.me, 'approval.decided', audit, [
    { field: `المرحلة ${stage.order} «${stage.name}»`, from: null, to: `${DECISION_LABELS[decision]} — ${who}` },
    ...(comment?.trim() ? [{ field: 'تعليق', from: null, to: comment.trim() }] : []),
  ]);
  if (selfDecision) {
    db.log(ctx.me, 'approval.self_decided', audit, [
      { field: 'استثناء اعتماد الذات', from: null, to: `${userName(db, ctx.me)} قرّر على طلبه (${DECISION_LABELS[decision]}) في المرحلة ${stage.order}` },
    ], true);
  }
  db.notify([request.requesterId], `قرار على طلبك: ${DECISION_LABELS[decision]}`, request.title, `/approvals/${request.id}`, ctx.me);
  if (decision === 'Approve' && !last) notifyStage(db, next, request.currentStage + 1, 'طلب موافقة بانتظارك', ctx.me);

  if (applyNow) {
    // Final approval of a sensitive change: apply it atomically, then the approval is spent (single use).
    const rows = applyProposedChanges(db, next);
    consumeApproval(db, next);
    next = db.approvals.patch(next.id, { snapshot: snapshotOf(db, next, template!.protectedFields) });
    db.log(ctx.me, 'approval.applied', audit, rows);
    supersedeIfProtected(db, ctx.me, next.subjectType, next.subjectId, Object.keys(next.proposedChanges ?? {}));
  }
  return next;
}

function subjectLabel(db: MockDatabase, request: Pick<ApprovalRequest, 'subjectType' | 'subjectId'>): string {
  if (request.subjectType === 'project') return db.projects.get(request.subjectId).name;
  const item = db.workItems.get(request.subjectId);
  return `${item.ref} ${item.title}`;
}

// ---------- Delegations (FR-APR-11) ----------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: unknown): s is string => typeof s === 'string' && ISO_DATE.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;

function validateDelegation(db: MockDatabase, dto: DelegationCreate, fromUserId: string): void {
  const errors: Record<string, string> = {};
  if (!validDate(dto.from)) errors['from'] = 'تاريخ غير صالح';
  if (!validDate(dto.to)) errors['to'] = 'تاريخ غير صالح';
  if (!errors['from'] && !errors['to']) {
    if (dto.from > dto.to) errors['to'] = 'تاريخ النهاية يسبق البداية';
    else if ((Date.parse(dto.to) - Date.parse(dto.from)) / 86_400_000 + 1 > MAX_DELEGATION_DAYS) errors['to'] = `الحد الأقصى ${MAX_DELEGATION_DAYS} يومًا`;
    else if (dto.to < orgToday(db.settings.timeZone)) errors['to'] = 'الفترة منتهية مسبقًا';
  }
  const to = db.users.find(dto.toUserId ?? '');
  if (!to) errors['toUserId'] = 'المستخدم غير موجود';
  else if (!to.active) errors['toUserId'] = 'المستخدم غير نشط';
  else if (to.id === fromUserId) errors['toUserId'] = 'لا يمكن التفويض لنفسك';
  else if (!db.projects.all().some((p) => db.can(to.id, 'approvals.decide', p.id))) errors['toUserId'] = 'المفوَّض إليه لا يملك صلاحية القرار في أي مشروع';
  if (!dto.reason?.trim()) errors['reason'] = 'السبب مطلوب';
  if (Object.keys(errors).length) fail(400, 'بيانات التفويض غير صالحة.', errors);
}

function registerDelegationHandlers(router: MockRouter, db: MockDatabase): void {
  router
    .get('delegations', (_req, ctx) => {
      const all = ctx.can('approvals.configure');
      return db.delegations.where((d) => all || d.fromUserId === ctx.me || d.toUserId === ctx.me).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    })
    .post('delegations', (req, ctx) => {
      const dto = body<DelegationCreate>(req);
      const fromUserId = dto.fromUserId ?? ctx.me;
      if (fromUserId !== ctx.me) ctx.require('approvals.configure');
      const from = db.users.find(fromUserId);
      if (!from?.active) fail(422, 'المفوِّض غير موجود أو غير نشط.');
      validateDelegation(db, dto, fromUserId);
      if (db.delegations.where((d) => d.active && d.fromUserId === fromUserId && d.toUserId === dto.toUserId && d.from <= dto.to && dto.from <= d.to).length) {
        fail(409, 'يوجد تفويض فعّال متداخل لنفس المستخدم.');
      }
      const row: Omit<Delegation, 'id' | 'version' | 'createdAt' | 'updatedAt'> = { fromUserId, toUserId: dto.toUserId, from: dto.from, to: dto.to, reason: dto.reason.trim(), active: true };
      const delegation = db.delegations.insert(row);
      db.log(ctx.me, 'delegation.created', { type: 'user', id: fromUserId, label: from.name, projectId: null }, [
        { field: 'المفوَّض إليه', from: null, to: userName(db, dto.toUserId) },
        { field: 'الفترة', from: null, to: `${dto.from} ← ${dto.to}` },
        { field: 'السبب', from: null, to: row.reason },
      ], true);
      db.notify([dto.toUserId], 'فُوّضت إليك صلاحية الموافقة', `${from.name}: ${dto.from} ← ${dto.to}`, '/approvals', ctx.me);
      return delegation;
    })
    .delete('delegations/:id', (req, ctx) => {
      const delegation = db.delegations.get(req.params['id']);
      if (delegation.fromUserId !== ctx.me) ctx.require('approvals.configure');
      if (!delegation.active) fail(422, 'التفويض ملغى مسبقًا.');
      db.delegations.patch(delegation.id, { active: false });
      db.log(ctx.me, 'delegation.revoked', { type: 'user', id: delegation.fromUserId, label: userName(db, delegation.fromUserId), projectId: null }, [
        { field: 'المفوَّض إليه', from: userName(db, delegation.toUserId), to: null },
        { field: 'الفترة', from: `${delegation.from} ← ${delegation.to}`, to: null },
      ], true);
      return null;
    });
}

export function registerApprovalHandlers(router: MockRouter, db: MockDatabase): void {
  registerDelegationHandlers(router, db);

  router
    .get('approval-templates/match', (req, ctx) => {
      const subjectType = req.query.get('subjectType');
      const subjectId = req.query.get('subjectId') ?? '';
      const action = req.query.get('action') as ApprovalAction | null;
      if ((subjectType !== 'project' && subjectType !== 'workItem') || !subjectId) fail(400, 'حدّد نوع العنصر ومعرّفه.');
      if (!action || !['close', 'reopen', 'change', 'activate'].includes(action)) fail(400, 'إجراء غير صالح.', { action: 'غير صالح' });
      ctx.requireProjectVisible(projectIdOf(db, { subjectType, subjectId }));
      return matchTemplate(db, { subjectType, subjectId }, action);
    })
    .get('approvals', (req, ctx) => {
      const query = parseListQuery(req.query);
      const { box, overdue, ...filters } = query.filters;
      const which = box?.[0] ?? 'inbox';
      const page = db.approvals.query({ ...query, filters, sort: query.sort ?? { field: 'updatedAt', direction: 'desc' } }, (a) => {
        if (overdue?.[0] === 'true' && !isOverdue(a)) return false;
        if (which === 'inbox') return canDecideNow(db, ctx.me, a);
        if (which === 'sent') return a.requesterId === ctx.me;
        const involved = a.requesterId === ctx.me || a.decisions.some((d) => d.deciderId === ctx.me) || ctx.can('approvals.view', a.projectId);
        return a.status !== 'PendingApproval' && involved;
      });
      return { ...page, items: page.items.map((a) => decorate(db, ctx, a)) };
    })
    .get('approvals/:id', (req, ctx) => decorate(db, ctx, visibleRequest(db, ctx, req.params['id'])))
    .post('approvals', (req, ctx) => {
      const { templateId, subjectType, subjectId, proposedChanges, action: requestedAction, targetStatusId } = body<SubmitApprovalRequest>(req);
      if (subjectType !== 'project' && subjectType !== 'workItem') fail(400, 'نوع العنصر غير صالح.', { subjectType: 'غير صالح' });
      const template = db.templates.get(templateId);
      if (!template.active) fail(422, 'قالب الموافقة معطّل.');
      const projectId = projectIdOf(db, { subjectType, subjectId });
      ctx.requireProjectVisible(projectId);
      ctx.require('approvals.request', projectId);
      // FR-APR-01/13: the template must govern this subject by its own rule, not merely exist.
      if (!templateMatches(db, template, { subjectType, subjectId })) fail(422, 'قالب الموافقة لا ينطبق على هذا العنصر وفق قواعده.', { templateId: 'لا ينطبق' });
      if (template.event === 'sensitive.change') {
        validateProposedChanges(db, template, { subjectType, subjectId }, proposedChanges);
        requireEditRights(ctx, projectId, subjectType, Object.keys(proposedChanges ?? {}));
      } else if (proposedChanges && Object.keys(proposedChanges).length) fail(422, 'القيم المقترحة متاحة لقوالب التعديل الحساس فقط.', { proposedChanges: 'غير مسموح' });
      // Bind the approval to what it authorises (action + target status), so it can't be spent on another transition.
      let action: ApprovalAction | undefined;
      if (template.event !== 'sensitive.change') {
        if (targetStatusId !== undefined && (typeof targetStatusId !== 'string' || !db.statuses.find(targetStatusId))) fail(400, 'الحالة المستهدفة غير صالحة.', { targetStatusId: 'غير صالح' });
        if (requestedAction !== undefined && !(['close', 'reopen', 'activate'] as const).includes(requestedAction as 'close')) fail(400, 'إجراء غير صالح.', { action: 'غير صالح' });
        const inferred: ApprovalAction = subjectType === 'project'
          ? (template.event === 'project.close' ? 'close' : 'activate')
          : (['Done', 'Cancelled'].includes(db.statuses.find(db.workItems.get(subjectId).statusId)?.category ?? '') ? 'reopen' : 'close');
        action = requestedAction ?? inferred;
        if (eventFor(subjectType, action) !== template.event || !templateMatches(db, template, { subjectType, subjectId }, action)) fail(422, 'الإجراء لا يتوافق مع قالب الموافقة.', { action: 'غير متوافق' });
      }
      const open = db.approvals.where((a) => a.subjectId === subjectId && a.templateId === templateId && a.status === 'PendingApproval');
      if (open.length) fail(409, 'يوجد طلب موافقة معلّق لهذا العنصر.');
      assertStagesResolvable(db, { stages: template.stages, projectId, requesterId: ctx.me, templateId });
      const request = db.approvals.insert({
        templateId, subjectType, subjectId, projectId,
        title: `${template.name}: ${subjectLabel(db, { subjectType, subjectId })}`,
        requesterId: ctx.me, status: 'PendingApproval', currentStage: 1, revision: 1,
        snapshot: snapshotOf(db, { subjectType, subjectId }, template.protectedFields),
        decisions: [], stages: template.stages, // frozen: later template edits don't touch running requests (§4.3)
        resolvedApprovers: freezeApprovers(db, template.stages, projectId, ctx.me), // positions/roles resolved once
        ...(action ? { action } : {}), ...(targetStatusId ? { targetStatusId } : {}),
        stageDueAt: stageDueAt(template.stages[0]), lastRemindedAt: null,
        ...(template.event === 'sensitive.change' ? { proposedChanges } : {}),
      });
      db.log(ctx.me, 'approval.submitted', { type: 'approval', id: request.id, label: request.title, projectId }, [
        { field: 'القالب', from: null, to: template.name },
        ...Object.entries(request.proposedChanges ?? {}).map(([field, to]) => ({ field: `مقترح: ${field}`, from: null, to: to === null ? null : String(to) })),
      ]);
      notifyStage(db, request, 1, 'طلب موافقة بانتظارك', ctx.me);
      return request;
    })
    .post('approvals/bulk-decide', (req, ctx) => {
      const { ids, decision, comment, revisions } = body<{ ids: string[]; decision: string; comment?: string; revisions?: Record<string, number> }>(req);
      if (decision !== 'Approve') fail(400, 'القرار الجماعي متاح للموافقة فقط؛ الرفض والإرجاع يتطلبان تعليقًا لكل طلب.', { decision: 'غير مسموح' });
      if (!Array.isArray(ids) || !ids.length || ids.length > MAX_BULK) fail(400, `اختر من 1 إلى ${MAX_BULK} طلبًا.`, { ids: 'غير صالح' });
      const results: BulkDecideResult[] = [];
      for (const id of [...new Set(ids)]) {
        try {
          // The caller must state the revision they reviewed; guessing the current one would approve unseen changes.
          const revision = revisions?.[id];
          if (typeof revision !== 'number' || !Number.isInteger(revision)) fail(400, 'يجب تحديد رقم الإصدار الذي راجعته لكل طلب.', { revisions: 'مطلوب' });
          decideRequest(db, ctx, id, { decision: 'Approve', comment: comment ?? '', revision });
          results.push({ id, ok: true, message: null });
        } catch (e) {
          if (!(e instanceof MockHttpError)) throw e;
          results.push({ id, ok: false, message: e.message });
        }
      }
      db.log(ctx.me, 'approval.bulk_decided', { type: 'user', id: ctx.me, label: `${results.filter((r) => r.ok).length}/${results.length}`, projectId: null }, [
        { field: 'الطلبات', from: null, to: results.map((r) => `${r.id}: ${r.ok ? 'تمت' : 'رُفضت'}`).join('، ') },
      ]);
      return results;
    })
    .post('approvals/:id/decide', (req, ctx) => decideRequest(db, ctx, req.params['id'], body<DecideRequest>(req)))
    .post('approvals/:id/remind', (req, ctx) => {
      const request = visibleRequest(db, ctx, req.params['id']);
      if (request.requesterId !== ctx.me && !ctx.can('approvals.configure', request.projectId)) fail(403, 'التذكير متاح لمقدّم الطلب أو مدير الموافقات.');
      if (request.status !== 'PendingApproval') fail(422, 'لا يُرسل تذكير إلا لطلب معلّق.');
      if (request.lastRemindedAt && Date.now() - Date.parse(request.lastRemindedAt) < HOUR) fail(429, 'أُرسل تذكير خلال الساعة الماضية؛ حاول لاحقًا.');
      const stage = request.stages.find((s) => s.order === request.currentStage)!;
      const approvers = requestStageApprovers(db, request, stage);
      db.notify(approvers, 'تذكير بطلب موافقة بانتظارك', request.title, `/approvals/${request.id}`, ctx.me);
      const next = db.approvals.patch(request.id, { lastRemindedAt: new Date().toISOString() });
      db.log(ctx.me, 'approval.reminded', { type: 'approval', id: request.id, label: request.title, projectId: request.projectId }, [
        { field: `المرحلة ${stage.order} «${stage.name}»`, from: null, to: approvers.map((a) => userName(db, a)).join('، ') || '—' },
      ]);
      return decorate(db, ctx, next);
    })
    .post('approvals/:id/resubmit', (req, ctx) => {
      const request = visibleRequest(db, ctx, req.params['id']);
      if (request.requesterId !== ctx.me) fail(403, 'إعادة التقديم متاحة لصاحب الطلب فقط.');
      if (request.status !== 'Returned' && request.status !== 'Superseded') fail(422, 'لا يمكن إعادة تقديم هذا الطلب.');
      const template = db.templates.get(request.templateId);
      if (template.event === 'sensitive.change') validateProposedChanges(db, template, request, request.proposedChanges);
      assertStagesResolvable(db, request);
      const next = db.approvals.patch(request.id, {
        resolvedApprovers: freezeApprovers(db, request.stages, request.projectId, request.requesterId),
        status: 'PendingApproval', currentStage: 1, revision: request.revision + 1,
        snapshot: snapshotOf(db, request, template.protectedFields),
        stageDueAt: stageDueAt(request.stages[0]), lastRemindedAt: null,
      });
      db.log(ctx.me, 'approval.submitted', { type: 'approval', id: next.id, label: next.title, projectId: next.projectId }, [
        { field: 'الإصدار', from: String(request.revision), to: String(next.revision) },
      ]);
      notifyStage(db, next, 1, 'طلب موافقة بانتظارك', ctx.me);
      return next;
    });
}

/** Permission a direct edit of each field needs; a sensitive-change request must not be a way around it. */
const EDIT_PERMISSION: Readonly<Record<string, PermissionKey>> = {
  assigneeIds: 'tasks.assign', ownerId: 'projects.edit', name: 'projects.edit', startDate: 'projects.edit', endDate: 'projects.edit',
};

function requireEditRights(ctx: MockContext, projectId: string, subjectType: 'project' | 'workItem', keys: readonly string[]): void {
  const fallback: PermissionKey = subjectType === 'project' ? 'projects.edit' : 'tasks.edit';
  for (const key of keys) ctx.require(key === 'typeId' ? 'tasks.edit' : EDIT_PERMISSION[key] ?? fallback, projectId);
}
