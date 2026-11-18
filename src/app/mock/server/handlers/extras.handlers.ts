import { HttpParams } from '@angular/common/http';
import { AuditEvent } from '@domain/activity/activity.models';
import { APPROVER_POSITION_LABELS, ApproverPosition } from '@domain/approvals/approval.models';
import { BulkRequest, BulkResult } from '@domain/work-items/work-item.api';
import { SearchHit } from '@domain/search/search.api';
import { MockHttpError } from '../../db/collection';
import { MockDatabase } from '../../db/database';
import { body, fail, Method, MockContext, MockRouter, parseListQuery } from '../router';

/** Runs another registered route in-process, so composite endpoints reuse every rule unchanged. */
async function dispatch(router: MockRouter, ctx: MockContext, method: Method, path: string, payload: unknown): Promise<unknown> {
  const match = router.match(method, path);
  if (!match) throw new MockHttpError(404, 'route');
  return match.route.handler({ method, path, params: match.params, query: new HttpParams(), body: payload }, ctx);
}

export function registerExtraHandlers(router: MockRouter, db: MockDatabase): void {
  // ---------- Global search (permission-filtered) ----------
  router.get('search', (req, ctx) => {
    const q = (req.query.get('q') ?? '').trim().toLowerCase();
    const limit = Math.min(30, Number(req.query.get('limit') ?? 12));
    if (q.length < 2) return [];
    const visible = db.visibleProjectIds(ctx.me);
    const has = (...values: (string | null | undefined)[]) => values.some((v) => v?.toLowerCase().includes(q));
    const hits: SearchHit[] = [];

    for (const p of db.projects.all()) {
      if (visible.has(p.id) && has(p.name, p.code, p.description)) {
        hits.push({ kind: 'project', id: p.id, code: p.code, title: p.name, subtitle: p.archived ? 'مشروع مؤرشف' : 'مشروع', link: `/projects/${p.id}` });
      }
    }
    for (const w of db.workItems.all()) {
      if (!w.archived && visible.has(w.projectId) && ctx.can('tasks.view', w.projectId) && has(w.ref, w.title)) {
        hits.push({ kind: 'workItem', id: w.id, code: w.ref, title: w.title, subtitle: db.projects.find(w.projectId)?.name ?? '', link: `/work-items/${w.id}`, typeId: w.typeId });
      }
    }
    for (const a of db.approvals.all()) {
      const involved = a.requesterId === ctx.me || ctx.can('approvals.view', a.projectId);
      if (involved && has(a.title)) hits.push({ kind: 'approval', id: a.id, code: null, title: a.title, subtitle: 'طلب موافقة', link: `/approvals/${a.id}` });
    }
    if (ctx.can('roles.manage')) {
      for (const u of db.users.all()) {
        if (has(u.name, u.username, u.email)) hits.push({ kind: 'user', id: u.id, code: u.username, title: u.name, subtitle: u.title, link: '/admin/access' });
      }
    }
    // Exact code matches first (typing "ERP-104" jumps straight to it).
    return hits.sort((a, b) => Number(b.code?.toLowerCase() === q) - Number(a.code?.toLowerCase() === q)).slice(0, limit);
  });

  // ---------- Bulk work item actions ----------
  router.post('work-items/bulk', async (req, ctx) => {
    const { ids, action } = body<BulkRequest>(req);
    if (!ids?.length) fail(400, 'لم تُحدَّد عناصر.');
    if (ids.length > 100) fail(400, 'الحد الأقصى 100 عنصر في العملية الواحدة.');
    const results: BulkResult[] = [];
    for (const id of ids) {
      const item = db.workItems.find(id);
      const ref = item?.ref ?? id;
      try {
        if (!item) throw new MockHttpError(404, 'غير موجود');
        const version = item.version;
        switch (action.kind) {
          case 'assign':
            await dispatch(router, ctx, 'PATCH', `work-items/${id}`, { assigneeIds: action.assigneeIds, version });
            break;
          case 'priority':
            await dispatch(router, ctx, 'PATCH', `work-items/${id}`, { priority: action.priority, version });
            break;
          case 'dueDate':
            await dispatch(router, ctx, 'PATCH', `work-items/${id}`, { dueDate: action.dueDate, version });
            break;
          case 'transition':
            await dispatch(router, ctx, 'POST', `work-items/${id}/transition`, { toStatusId: action.toStatusId, version, comment: 'إجراء جماعي' });
            break;
        }
        results.push({ id, ref, ok: true, message: null });
      } catch (e) {
        results.push({ id, ref, ok: false, message: e instanceof MockHttpError ? e.message : 'خطأ غير متوقع' });
      }
    }
    return results;
  });

  // ---------- Approver reassignment (FR-APR-11) ----------
  router.post('approvals/:id/reassign', (req, ctx) => {
    // Visibility and permission are checked BEFORE anything about the request is revealed (no 403-vs-404 id leak).
    const request = db.approvals.find(req.params['id']);
    if (!request) return fail(404, 'العنصر غير موجود أو لا تملك صلاحية الاطلاع عليه.');
    ctx.requireProjectVisible(request.projectId);
    ctx.require('approvals.configure', request.projectId);
    if (request.status !== 'PendingApproval') fail(422, 'يمكن إعادة التعيين للطلبات المعلّقة فقط.');
    const { approverId, reason } = body<{ approverId: string; reason: string }>(req);
    if (!reason?.trim()) fail(400, 'سبب إعادة التعيين إلزامي.', { reason: 'مطلوب' });
    const substitute = db.users.get(approverId);
    if (!substitute.active) fail(422, 'المستخدم البديل غير نشط.');
    // The substitute must be able to see the project and decide there, or the request would leak and stall.
    if (!db.canSeeProject(approverId, request.projectId) || !db.can(approverId, 'approvals.decide', request.projectId)) {
      fail(422, 'المستخدم البديل لا يملك صلاحية الاطلاع والقرار في هذا المشروع.');
    }
    if (approverId === request.requesterId) fail(422, 'لا يمكن تعيين صاحب الطلب معتمدًا لطلبه.');
    const stage = request.stages.find((s) => s.order === request.currentStage);
    if (!stage) fail(422, 'لا توجد مرحلة نشطة لإعادة تعيينها.');
    // Separation of duties: someone who already decided an earlier stage can't also take this one.
    if (request.decisions.some((d) => d.stageOrder < stage.order && (d.deciderId === approverId || d.onBehalfOf === approverId))) {
      fail(422, 'لا يمكن إسناد المرحلة لمن قرّر في مرحلة سابقة من الطلب نفسه.');
    }
    const original = stage.approverKind === 'user' ? db.users.find(stage.approverId)?.name ?? stage.approverId
      : stage.approverKind === 'position' ? `المنصب: ${APPROVER_POSITION_LABELS[stage.approverId as ApproverPosition] ?? stage.approverId}`
      : `الدور: ${db.roles.find(stage.approverId)?.name ?? stage.approverId}`;
    // Only this request's frozen stage copy changes; the template is untouched (§4.3).
    const stages = request.stages.map((s) => (s.order === stage.order ? { ...s, approverKind: 'user' as const, approverId } : s));
    const next = db.approvals.patch(request.id, { stages, resolvedApprovers: { ...(request.resolvedApprovers ?? {}), [stage.order]: [approverId] } });
    db.log(ctx.me, 'approval.reassigned', { type: 'approval', id: request.id, label: request.title, projectId: request.projectId }, [
      { field: `معتمد المرحلة ${stage.order} «${stage.name}»`, from: original, to: substitute.name },
      { field: 'السبب', from: null, to: reason.trim() },
    ], true);
    db.notify([approverId], 'أُسند إليك طلب موافقة', request.title, `/approvals/${request.id}`, ctx.me);
    return next;
  });

  // ---------- Audit export (FR-AUD-08) ----------
  router.get('audit/export', (req, ctx) => {
    ctx.require('audit.export');
    const query = parseListQuery(req.query);
    const { from, to, ...filters } = query.filters;
    const all = db.audit.query({ ...query, page: 1, pageSize: 100_000, filters, sort: { field: 'at', direction: 'desc' } }, (e: AuditEvent) =>
      (!from?.[0] || e.at >= from[0]) && (!to?.[0] || e.at.slice(0, 10) <= to[0]),
    ).items;
    // The export itself is an audited security event, with the filters used.
    db.log(ctx.me, 'audit.exported', { type: 'user', id: ctx.me, label: `${all.length} سجل`, projectId: null }, [
      { field: 'الفلاتر', from: null, to: JSON.stringify(query.filters) },
    ], true);
    return all;
  });
}
