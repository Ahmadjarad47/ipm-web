import { HttpHeaders, HttpParams } from '@angular/common/http';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApprovalRequest, ApprovalTemplate, BulkDecideResult, Delegation } from '@domain/approvals/approval.models';
import { GIT_CONNECTORS, gitConnector } from '@domain/git/git-connector';
import { validateRefPattern } from '@domain/git/ref-pattern';
import { ProjectMembersResult, ProjectSummary, RotatedSecret } from '@domain/projects/project.models';
import { MockHttpError } from '../db/collection';
import { MockDatabase } from '../db/database';
import { orgToday } from '../db/time';
import { matchTemplate } from './approvals/engine';
import { registerApprovalHandlers } from './handlers/approvals.handlers';
import { registerConfigHandlers } from './handlers/config.handlers';
import { registerExtraHandlers } from './handlers/extras.handlers';
import { registerGitHandlers, signedHeaders } from './handlers/git.handlers';
import { registerProjectHandlers } from './handlers/projects.handlers';
import { registerWorkItemHandlers } from './handlers/work-items.handlers';
import { Method, MockContext, MockRouter } from './router';

describe('Approvals engine, delegation, project rules and Git hardening (mock API)', () => {
  let db: MockDatabase;
  let router: MockRouter;

  beforeEach(() => {
    db = new MockDatabase();
    router = new MockRouter();
    registerConfigHandlers(router, db);
    registerProjectHandlers(router, db);
    registerWorkItemHandlers(router, db);
    registerApprovalHandlers(router, db);
    registerExtraHandlers(router, db);
    registerGitHandlers(router, db);
  });

  async function call<T = unknown>(userId: string | null, method: Method, path: string, body: unknown = {}, headers?: HttpHeaders, query = new HttpParams()): Promise<T> {
    const match = router.match(method, path);
    if (!match) throw new Error(`no route ${method} ${path}`);
    return (await match.route.handler({ method, path, params: match.params, query, body, headers }, new MockContext(db, userId))) as T;
  }

  async function error(fn: () => Promise<unknown>): Promise<MockHttpError | null> {
    try {
      await fn();
      return null;
    } catch (e) {
      if (e instanceof MockHttpError) return e;
      throw e;
    }
  }

  const status = async (fn: () => Promise<unknown>): Promise<number> => (await error(fn))?.status ?? 200;
  const day = (offset: number): string => orgToday(db.settings.timeZone, new Date(Date.now() + offset * 86_400_000));
  const approve = (user: string, id: string, revision = 1) => call<ApprovalRequest>(user, 'POST', `approvals/${id}/decide`, { decision: 'Approve', comment: '', revision });
  const submit = (user: string, templateId: string, subjectId: string, subjectType = 'workItem', extra: object = {}) =>
    call<ApprovalRequest>(user, 'POST', 'approvals', { templateId, subjectType, subjectId, ...extra });

  function template(partial: Partial<ApprovalTemplate> & Pick<ApprovalTemplate, 'event'>): ApprovalTemplate {
    return db.templates.insert({
      name: 'قالب اختبار', active: true, protectedFields: ['title'],
      stages: [{ order: 1, name: 'مرحلة', approverKind: 'user', approverId: 'u-3' }], ...partial,
    });
  }

  // ---------- 1. Rule engine ----------

  describe('FR-APR-01/13 rule engine', () => {
    it('matches by type, action and project; a non-matching type gets no template', () => {
      expect(matchTemplate(db, { subjectType: 'workItem', subjectId: 'p-erp-wi-12' }, 'close')?.id).toBe('tpl-task');
      expect(matchTemplate(db, { subjectType: 'workItem', subjectId: 'p-erp-wi-1' }, 'close')).toBeNull(); // milestone is not in the rule
      expect(matchTemplate(db, { subjectType: 'project', subjectId: 'p-bi' }, 'activate')?.id).toBe('tpl-project');
      expect(matchTemplate(db, { subjectType: 'project', subjectId: 'p-erp' }, 'close')?.id).toBe('tpl-close');
    });

    it('sensitive.change applies only to critical tasks, and only when a protected key changes', () => {
      const subject = { subjectType: 'workItem', subjectId: 'p-erp-wi-8' } as const;
      expect(matchTemplate(db, subject, 'change')).toBeNull(); // medium priority
      db.workItems.patch('p-erp-wi-8', { priority: 'critical' });
      expect(matchTemplate(db, subject, 'change', { title: 'x' })?.id).toBe('tpl-sensitive-task');
      expect(matchTemplate(db, subject, 'change', { description: 'x' })).toBeNull();
    });

    it('the higher rule priority wins, then the more specific rule', () => {
      const broad = template({ event: 'workItem.approve', name: 'عام', rule: { actions: ['close'] } });
      const specific = template({ event: 'workItem.approve', name: 'محدد', rule: { actions: ['close'], workItemTypeIds: ['t-task'], projectIds: ['p-erp'] } });
      const forced = template({ event: 'workItem.approve', name: 'مفروض', rule: { actions: ['close'], priority: 9 } });
      const subject = { subjectType: 'workItem', subjectId: 'p-erp-wi-12' } as const;
      expect(matchTemplate(db, subject, 'close')?.id).toBe(forced.id);
      db.templates.patch(forced.id, { active: false });
      expect(matchTemplate(db, subject, 'close')?.id).toBe(specific.id);
      expect(broad.id).not.toBe(specific.id);
    });

    it('conditions are evaluated against the subject', () => {
      const t = template({ event: 'workItem.approve', rule: { actions: ['close'], priority: 5, conditions: [{ field: 'priority', op: 'in', value: ['high', 'critical'] }] } });
      expect(matchTemplate(db, { subjectType: 'workItem', subjectId: 'p-erp-wi-12' }, 'close')?.id).toBe('tpl-task'); // medium: condition fails
      expect(matchTemplate(db, { subjectType: 'workItem', subjectId: 'p-erp-wi-4' }, 'close')?.id).toBe(t.id); // high
    });

    it('GET approval-templates/match returns the template or null', async () => {
      const q = new HttpParams().set('subjectType', 'workItem').set('subjectId', 'p-erp-wi-12').set('action', 'close');
      expect((await call<ApprovalTemplate>('u-4', 'GET', 'approval-templates/match', {}, undefined, q)).id).toBe('tpl-task');
      const none = new HttpParams().set('subjectType', 'workItem').set('subjectId', 'p-erp-wi-1').set('action', 'close');
      expect(await call('u-4', 'GET', 'approval-templates/match', {}, undefined, none)).toBeNull();
      expect(await status(() => call('u-4', 'GET', 'approval-templates/match', {}, undefined, new HttpParams().set('subjectType', 'workItem')))).toBe(400);
      // a project the caller cannot see is not leaked
      const hidden = new HttpParams().set('subjectType', 'workItem').set('subjectId', 'p-ssp-wi-2').set('action', 'close');
      expect(await status(() => call('u-4', 'GET', 'approval-templates/match', {}, undefined, hidden))).toBe(404);
    });

    it('POST approvals rejects a template whose rule does not match the subject', async () => {
      expect(await status(() => submit('u-4', 'tpl-task', 'p-erp-wi-1'))).toBe(422); // milestone
      expect(await status(() => submit('u-4', 'tpl-project', 'p-erp-wi-12'))).toBe(422); // project template on a work item
      expect((await submit('u-4', 'tpl-task', 'p-erp-wi-12')).status).toBe('PendingApproval');
    });
  });

  // ---------- 2. Approver kinds ----------

  describe('FR-APR-02 approver positions and template validation', () => {
    it('resolves positions per project and requester', () => {
      const pos = (id: string, requester?: string) => db.stageApprovers({ approverKind: 'position', approverId: id }, 'p-erp', requester);
      expect(pos('direct_manager', 'u-4')).toEqual(['u-3']);
      expect(pos('direct_manager', 'u-3')).toEqual(['u-2']);
      expect(pos('direct_manager', 'u-1')).toEqual([]); // no manager
      expect(pos('project_owner')).toEqual(['u-2']);
      expect(pos('project_manager')).toEqual(['u-2']);
      expect(db.stageApprovers({ approverKind: 'position', approverId: 'project_owner' }, 'p-bi')).toEqual(['u-3']);
    });

    it('a position template runs through its stages', async () => {
      const t = template({
        event: 'workItem.approve',
        stages: [
          { order: 1, name: 'المدير المباشر', approverKind: 'position', approverId: 'direct_manager' },
          { order: 2, name: 'مالك المشروع', approverKind: 'position', approverId: 'project_owner' },
        ],
      });
      const request = await submit('u-4', t.id, 'p-erp-wi-12');
      expect(await status(() => approve('u-2', request.id))).toBe(403); // owner is not the stage-1 approver
      await approve('u-3', request.id); // fahad's manager is noura
      expect((await approve('u-2', request.id)).status).toBe('Approved');
      // admin has no manager: the position cannot resolve, so the request is refused up front
      expect(await status(() => submit('u-1', t.id, 'p-erp-wi-12'))).toBe(422);
    });

    const base = { name: 'قالب', event: 'workItem.approve', active: true, protectedFields: ['title'] };
    const stage = (order: number, approverId: string, approverKind = 'user') => ({ order, name: `م${order}`, approverKind, approverId });

    it('validates stages on save', async () => {
      const bad = async (stages: object[]) => status(() => call('u-1', 'POST', 'approval-templates', { ...base, stages }));
      expect(await bad([])).toBe(422); // at least one stage
      expect(await bad([stage(1, 'u-3'), stage(3, 'u-2')])).toBe(422); // not consecutive
      expect(await bad([stage(1, 'u-3'), stage(1, 'u-2')])).toBe(422); // duplicate order
      expect(await bad([stage(1, 'u-7')])).toBe(422); // inactive approver
      expect(await bad([stage(1, 'nobody')])).toBe(422); // unknown approver
      expect(await bad([stage(1, 'r-none', 'role')])).toBe(422);
      expect(await bad([stage(1, 'chief', 'position')])).toBe(422); // unknown position
      expect(await bad([stage(1, 'u-3'), stage(2, 'u-3')])).toBe(422); // same approver twice in a row
      expect(await bad([{ ...stage(1, 'u-3'), dueHours: 0 }])).toBe(422);
      expect(await bad([stage(1, 'u-3'), stage(2, 'direct_manager', 'position'), stage(3, 'u-3')])).toBe(200);
      expect(await status(() => call('u-4', 'POST', 'approval-templates', { ...base, stages: [stage(1, 'u-3')] }))).toBe(403);
    });

    it('validates the rule and the sensitive.change field set', async () => {
      const s = [stage(1, 'u-3')];
      expect(await status(() => call('u-1', 'POST', 'approval-templates', { ...base, stages: s, rule: { workItemTypeIds: ['t-nope'] } }))).toBe(422);
      expect(await status(() => call('u-1', 'POST', 'approval-templates', { ...base, stages: s, rule: { actions: ['explode'] } }))).toBe(422);
      expect(await status(() => call('u-1', 'POST', 'approval-templates', { ...base, event: 'sensitive.change', stages: s, protectedFields: [] }))).toBe(422);
      expect(await status(() => call('u-1', 'POST', 'approval-templates', { ...base, event: 'sensitive.change', stages: s, protectedFields: ['title', 'ownerId'] }))).toBe(422); // mixes subjects
    });
  });

  // ---------- 3. Gating & integrity ----------

  describe('FR-APR-08/10 gating', () => {
    beforeEach(() => {
      // Put a "needs approval" gate on review -> completed for the standard workflow.
      const wf = db.workflows.get('wf-standard');
      db.workflows.patch('wf-standard', { transitions: wf.transitions.map((t) => (t.fromStatusId === 's-review' && t.toStatusId === 's-completed' ? { ...t, requiresApproval: true } : t)) });
    });
    const id = 'p-erp-wi-12';
    const v = () => db.workItems.get(id).version;
    const close = () => call('u-2', 'POST', `work-items/${id}/transition`, { toStatusId: 's-completed', version: v() });

    async function approved(): Promise<ApprovalRequest> {
      const request = await submit('u-4', 'tpl-task', id);
      await approve('u-3', request.id);
      return approve('u-2', request.id);
    }

    it('refuses without an approval, accepts with one, and the approval is single-use', async () => {
      expect(await status(close)).toBe(422);
      const request = await approved();
      await close();
      expect(db.workItems.get(id).statusId).toBe('s-completed');
      expect(db.consumedApprovals.has(request.id)).toBe(true);
      await call('u-2', 'POST', `work-items/${id}/transition`, { toStatusId: 's-progress', version: v() }); // reopen
      await call('u-2', 'POST', `work-items/${id}/transition`, { toStatusId: 's-review', version: v() });
      expect(await status(close)).toBe(422); // the consumed approval cannot be replayed
    });

    it('a protected field changed after approval invalidates it (revision gating)', async () => {
      await approved();
      await call('u-2', 'PATCH', `work-items/${id}`, { title: 'عنوان تغيّر بعد الموافقة', version: v() });
      const err = await error(close);
      expect(err?.status).toBe(422);
      expect(err?.message).toContain('تغيّرت بيانات محمية');
      expect(db.audit.where((e) => e.action === 'approval.gate_blocked').length).toBe(1);
    });

    it('an approval of another event does not authorise the transition', async () => {
      const request = db.approvals.insert({
        templateId: 'tpl-sensitive-task', subjectType: 'workItem', subjectId: id, projectId: 'p-erp', title: 't', requesterId: 'u-4', status: 'Approved', currentStage: 0,
        revision: 1, snapshot: {}, decisions: [], stages: [],
      });
      expect(request.status).toBe('Approved');
      expect(await status(close)).toBe(422);
    });

    describe('sensitive.change', () => {
      const wi = 'p-erp-wi-8';
      beforeEach(() => db.workItems.patch(wi, { priority: 'critical' }));

      it('a direct PATCH of a protected field is refused with approval_required', async () => {
        const err = await error(() => call('u-2', 'PATCH', `work-items/${wi}`, { title: 'عنوان جديد', version: db.workItems.get(wi).version }));
        expect(err?.status).toBe(422);
        expect(err?.details?.['code']).toBe('approval_required');
        expect(err?.details?.['templateId']).toBe('tpl-sensitive-task');
        // unprotected fields stay editable
        await call('u-2', 'PATCH', `work-items/${wi}`, { description: 'وصف جديد', version: db.workItems.get(wi).version });
        // and non-critical items are not governed
        db.workItems.patch('p-erp-wi-3', { priority: 'low' });
        await call('u-2', 'PATCH', 'work-items/p-erp-wi-3', { title: 'عنوان حر', version: db.workItems.get('p-erp-wi-3').version });
      });

      it('validates the proposal before the request exists', async () => {
        expect(await status(() => submit('u-4', 'tpl-sensitive-task', wi))).toBe(422); // no proposal
        expect(await status(() => submit('u-4', 'tpl-sensitive-task', wi, 'workItem', { proposedChanges: { description: 'x' } }))).toBe(422); // not protected
        expect(await status(() => submit('u-4', 'tpl-sensitive-task', wi, 'workItem', { proposedChanges: { priority: 'urgent' } }))).toBe(422);
        expect(await status(() => submit('u-4', 'tpl-sensitive-task', wi, 'workItem', { proposedChanges: { title: db.workItems.get(wi).title } }))).toBe(422); // no-op
        expect(await status(() => submit('u-4', 'tpl-task', wi, 'workItem', { proposedChanges: { title: 'x' } }))).toBe(422); // wrong event
      });

      it('applies the proposal atomically on the final approval and audits it', async () => {
        const request = await submit('u-4', 'tpl-sensitive-task', wi, 'workItem', { proposedChanges: { title: 'عنوان معتمد', priority: 'high' } });
        expect(db.workItems.get(wi).title).not.toBe('عنوان معتمد'); // nothing applied while pending
        const done = await approve('u-2', request.id);
        expect(done.status).toBe('Approved');
        expect(db.workItems.get(wi).title).toBe('عنوان معتمد');
        expect(db.workItems.get(wi).priority).toBe('high');
        expect(db.consumedApprovals.has(request.id)).toBe(true);
        const applied = db.audit.where((e) => e.action === 'approval.applied')[0];
        expect(applied.changes.map((c) => c.field)).toEqual(['العنوان', 'الأولوية']);
        expect(applied.projectId).toBe('p-erp');
      });

      it('supersedes other pending requests that protect the changed fields', async () => {
        const other = await submit('u-4', 'tpl-task', wi); // protects title
        const request = await submit('u-4', 'tpl-sensitive-task', wi, 'workItem', { proposedChanges: { title: 'عنوان آخر' } });
        await approve('u-2', request.id);
        expect(db.approvals.get(other.id).status).toBe('Superseded');
      });

      it('a type change or assignee change supersedes a pending request that protects it', async () => {
        const t = template({ event: 'workItem.approve', protectedFields: ['typeId', 'assigneeIds'] });
        const request = await submit('u-4', t.id, 'p-erp-wi-12');
        await call('u-2', 'PATCH', 'work-items/p-erp-wi-12', { assigneeIds: ['u-5'], version: v() });
        expect(db.approvals.get(request.id).status).toBe('Superseded');
      });

      it('project protected fields need an approved sensitive.change too', async () => {
        const err = await error(() => call('u-2', 'PATCH', 'projects/p-erp', { name: 'اسم جديد', version: db.projects.get('p-erp').version }));
        expect(err?.details?.['code']).toBe('approval_required');
        await call('u-2', 'PATCH', 'projects/p-erp', { description: 'وصف جديد', version: db.projects.get('p-erp').version }); // unprotected
        const request = await submit('u-2', 'tpl-sensitive-project', 'p-erp', 'project', { proposedChanges: { name: 'اسم معتمد' } });
        await approve('u-1', request.id);
        expect(db.projects.get('p-erp').name).toBe('اسم معتمد');
      });
    });

    it('a project activation approval is single-use and invalidated by a protected change', async () => {
      const request = db.approvals.get('apr-1'); // seeded pending activation request for BI
      await approve('u-3', request.id);
      await approve('u-3', request.id);
      await approve('u-1', request.id);
      db.projects.patch('p-bi', { endDate: day(300) });
      expect((await error(() => call('u-3', 'POST', 'projects/p-bi/transition', { toStatusId: 'ps-active', version: db.projects.get('p-bi').version })))?.message).toContain('تغيّرت');
    });
  });

  // ---------- 4. Self approval, reminders, delegation ----------

  describe('FR-APR-06/07/11', () => {
    it('self approval needs the global setting AND the template flag, and is audited', async () => {
      const request = await submit('u-2', 'tpl-close', 'p-erp', 'project'); // khaled is the only stage-1 approver
      db.settingsTable.patch('settings', { allowSelfApproval: true });
      expect(await status(() => approve('u-2', request.id))).toBe(403); // template flag still off
      expect((await call<ApprovalRequest>('u-2', 'GET', `approvals/${request.id}`)).canDecide).toBe(false);
      db.templates.patch('tpl-close', { allowSelfApproval: true });
      expect((await call<ApprovalRequest>('u-2', 'GET', `approvals/${request.id}`)).canDecide).toBe(true);
      await approve('u-2', request.id);
      const event = db.audit.where((e) => e.action === 'approval.self_decided')[0];
      expect(event.security).toBe(true);
      expect(event.projectId).toBe('p-erp');
      db.settingsTable.patch('settings', { allowSelfApproval: false });
      expect(await status(() => approve('u-2', request.id))).toBe(403);
    });

    it('decisions are audited with the stage name and the approver', async () => {
      const request = await submit('u-4', 'tpl-task', 'p-erp-wi-12');
      await approve('u-3', request.id);
      const event = db.audit.where((e) => e.action === 'approval.decided').slice(-1)[0];
      expect(event.changes[0].field).toContain('المشرف التقني');
      expect(event.changes[0].to).toContain('نورة القحطاني');
    });

    it('stage due date, overdue flag and the inbox', async () => {
      db.workItems.patch('p-erp-wi-8', { priority: 'critical' });
      const request = await submit('u-4', 'tpl-sensitive-task', 'p-erp-wi-8', 'workItem', { proposedChanges: { title: 'جديد' } });
      expect(Date.parse(request.stageDueAt!) - Date.now()).toBeGreaterThan(47 * 3_600_000);
      expect((await call<ApprovalRequest>('u-2', 'GET', `approvals/${request.id}`)).overdue).toBe(false);
      db.approvals.patch(request.id, { stageDueAt: new Date(Date.now() - 1000).toISOString() });
      const inbox = await call<{ items: ApprovalRequest[] }>('u-2', 'GET', 'approvals', {}, undefined, new HttpParams().set('filter.box', 'inbox'));
      expect(inbox.items.find((a) => a.id === request.id)?.overdue).toBe(true);
      expect(inbox.items.find((a) => a.id === request.id)?.canDecide).toBe(true);
    });

    it('reminders notify current approvers once an hour, for the requester or a configurator only', async () => {
      const request = await submit('u-4', 'tpl-task', 'p-erp-wi-12');
      const before = db.notifications.where((n) => n.userId === 'u-3' && n.title.includes('تذكير')).length;
      await call('u-4', 'POST', `approvals/${request.id}/remind`);
      expect(db.notifications.where((n) => n.userId === 'u-3' && n.title.includes('تذكير')).length).toBe(before + 1);
      expect(await status(() => call('u-4', 'POST', `approvals/${request.id}/remind`))).toBe(429);
      expect(await status(() => call('u-5', 'POST', `approvals/${request.id}/remind`))).toBe(403); // member who is not the requester
      db.approvals.patch(request.id, { lastRemindedAt: new Date(Date.now() - 2 * 3_600_000).toISOString() });
      await call('u-1', 'POST', `approvals/${request.id}/remind`); // approvals.configure
      await approve('u-3', request.id);
      await approve('u-2', request.id);
      expect(await status(() => call('u-4', 'POST', `approvals/${request.id}/remind`))).toBe(422); // no longer pending
    });

    describe('delegation', () => {
      const create = (user: string, dto: object) => call<Delegation>(user, 'POST', 'delegations', dto);

      it('a delegate decides inside the window, on behalf of the approver', async () => {
        const request = await submit('u-4', 'tpl-task', 'p-erp-wi-12');
        expect(await status(() => approve('u-2', request.id))).toBe(403); // not an approver of stage 1
        await create('u-3', { toUserId: 'u-2', from: day(0), to: day(3), reason: 'إجازة' });
        expect((await call<ApprovalRequest>('u-2', 'GET', `approvals/${request.id}`)).canDecide).toBe(true);
        const next = await approve('u-2', request.id);
        expect(next.decisions[0].onBehalfOf).toBe('u-3');
        expect(db.audit.where((e) => e.action === 'approval.decided').slice(-1)[0].changes[0].to).toContain('نيابةً عن نورة القحطاني');
        expect(db.audit.where((e) => e.action === 'delegation.created').length).toBe(1);
      });

      it('a delegation outside its window or revoked gives no authority', async () => {
        const request = await submit('u-4', 'tpl-task', 'p-erp-wi-12');
        const future = await create('u-3', { toUserId: 'u-2', from: day(2), to: day(5), reason: 'لاحقًا' });
        expect(await status(() => approve('u-2', request.id))).toBe(403);
        db.delegations.patch(future.id, { from: day(-1), to: day(1) });
        expect((await call<ApprovalRequest>('u-2', 'GET', `approvals/${request.id}`)).canDecide).toBe(true);
        await call('u-3', 'DELETE', `delegations/${future.id}`);
        expect(db.delegations.get(future.id).active).toBe(false);
        expect(await status(() => approve('u-2', request.id))).toBe(403);
      });

      it('validates the delegation', async () => {
        const ok = { toUserId: 'u-2', from: day(0), to: day(3), reason: 'إجازة' };
        expect(await status(() => create('u-3', { ...ok, from: day(5), to: day(1) }))).toBe(400);
        expect(await status(() => create('u-3', { ...ok, toUserId: 'u-3' }))).toBe(400); // self
        expect(await status(() => create('u-3', { ...ok, toUserId: 'u-7' }))).toBe(400); // inactive
        expect(await status(() => create('u-3', { ...ok, toUserId: 'nobody' }))).toBe(400);
        expect(await status(() => create('u-3', { ...ok, to: day(95) }))).toBe(400); // longer than 90 days
        expect(await status(() => create('u-3', { ...ok, from: day(-10), to: day(-5) }))).toBe(400); // already over
        expect(await status(() => create('u-3', { ...ok, reason: ' ' }))).toBe(400);
        expect(await status(() => create('u-3', { ...ok, to: day(89) }))).toBe(200); // 90 days inclusive
      });

      it('users manage their own; approvals.configure manages all', async () => {
        const own = await create('u-3', { toUserId: 'u-2', from: day(0), to: day(1), reason: 'خاص' });
        expect(await status(() => create('u-4', { fromUserId: 'u-3', toUserId: 'u-2', from: day(0), to: day(1), reason: 'x' }))).toBe(403);
        expect(await status(() => call('u-4', 'DELETE', `delegations/${own.id}`))).toBe(403);
        expect((await call<Delegation[]>('u-4', 'GET', 'delegations')).length).toBe(0);
        expect((await call<Delegation[]>('u-3', 'GET', 'delegations')).length).toBe(1);
        const byAdmin = await create('u-1', { fromUserId: 'u-5', toUserId: 'u-3', from: day(0), to: day(1), reason: 'نيابة إدارية' });
        expect((await call<Delegation[]>('u-1', 'GET', 'delegations')).length).toBe(2);
        await call('u-1', 'DELETE', `delegations/${byAdmin.id}`);
        expect(await status(() => create('u-3', { toUserId: 'u-2', from: day(0), to: day(1), reason: 'مكرر' }))).toBe(409); // overlapping
      });

      it('reassignment still works and keeps its security audit', async () => {
        const request = await submit('u-4', 'tpl-task', 'p-erp-wi-12');
        await call('u-1', 'POST', `approvals/${request.id}/reassign`, { approverId: 'u-2', reason: 'غياب' });
        expect((await approve('u-2', request.id)).currentStage).toBe(2);
        expect(db.audit.where((e) => e.action === 'approval.reassigned')[0].security).toBe(true);
      });
    });
  });

  // ---------- 5. Bulk decide ----------

  describe('bulk approve', () => {
    it('returns a result per request using the normal decision rules', async () => {
      const results = await call<BulkDecideResult[]>('u-3', 'POST', 'approvals/bulk-decide', { ids: ['apr-1', 'apr-2', 'apr-missing'], decision: 'Approve', revisions: { 'apr-1': 1, 'apr-2': 1, 'apr-missing': 1 } });
      expect(results.map((r) => [r.id, r.ok])).toEqual([['apr-1', true], ['apr-2', false], ['apr-missing', false]]);
      expect(results[1].message).toBeTruthy();
      expect(db.approvals.get('apr-1').currentStage).toBe(2);
      expect(db.approvals.get('apr-2').currentStage).toBe(2); // untouched
    });

    it('rejects Reject/Return and bad input; stale revisions fail per item', async () => {
      expect(await status(() => call('u-3', 'POST', 'approvals/bulk-decide', { ids: ['apr-1'], decision: 'Reject', comment: 'x' }))).toBe(400);
      expect(await status(() => call('u-3', 'POST', 'approvals/bulk-decide', { ids: ['apr-1'], decision: 'Return', comment: 'x' }))).toBe(400);
      expect(await status(() => call('u-3', 'POST', 'approvals/bulk-decide', { ids: [], decision: 'Approve' }))).toBe(400);
      const stale = await call<BulkDecideResult[]>('u-3', 'POST', 'approvals/bulk-decide', { ids: ['apr-1'], decision: 'Approve', revisions: { 'apr-1': 7 } });
      expect(stale[0].ok).toBe(false);
      expect(db.approvals.get('apr-1').currentStage).toBe(1);
    });
  });

  // ---------- 6. Project rules ----------

  describe('FR-PRJ project rules', () => {
    const members = (...extra: { userId: string; roleId: string }[]) => [...db.projects.get('p-erp').members, ...extra];
    const setMembers = (user: string, list: { userId: string; roleId: string }[]) =>
      call<ProjectMembersResult>(user, 'POST', 'projects/p-erp/members', { members: list, version: db.projects.get('p-erp').version });

    it('validates users, project-scope roles, duplicates and the owner', async () => {
      expect(await status(() => setMembers('u-2', members({ userId: 'u-7', roleId: 'r-member' })))).toBe(422); // inactive
      expect(await status(() => setMembers('u-2', members({ userId: 'ghost', roleId: 'r-member' })))).toBe(422);
      expect(await status(() => setMembers('u-2', members({ userId: 'u-1', roleId: 'r-admin' })))).toBe(422); // system-scope role
      expect(await status(() => setMembers('u-2', members({ userId: 'u-1', roleId: 'r-none' })))).toBe(422);
      expect(await status(() => setMembers('u-2', members({ userId: 'u-4', roleId: 'r-viewer' })))).toBe(422); // duplicate user
      expect(await status(() => setMembers('u-2', db.projects.get('p-erp').members.filter((m) => m.userId !== 'u-2')))).toBe(422); // owner
      expect(await status(() => setMembers('u-4', members({ userId: 'u-1', roleId: 'r-viewer' })))).toBe(403); // no members.manage
    });

    it('a caller cannot hand out a role holding permissions they lack', async () => {
      const custom = db.roles.insert({
        key: 'custom', name: 'مسؤول أعضاء', description: '', scope: 'project', denied: [], builtIn: false,
        permissions: ['projects.view', 'projects.members.manage', 'tasks.view', 'dashboard.view', 'workitem.relations.view'],
      });
      db.projects.patch('p-erp', { members: [...db.projects.get('p-erp').members.filter((m) => m.userId !== 'u-5'), { userId: 'u-5', roleId: custom.id }] });
      expect(await status(() => setMembers('u-5', members({ userId: 'u-1', roleId: 'r-pm' })))).toBe(403); // pm role > custom role
      expect(await status(() => setMembers('u-5', members({ userId: 'u-1', roleId: 'r-viewer' })))).toBe(200); // a subset is fine
    });

    it('audits one change row per member (names) and notifies the removed', async () => {
      const list = db.projects.get('p-erp').members.filter((m) => m.userId !== 'u-6').map((m) => (m.userId === 'u-5' ? { ...m, roleId: 'r-viewer' } : m));
      await setMembers('u-2', [...list, { userId: 'u-1', roleId: 'r-viewer' }]);
      const event = db.audit.where((e) => e.action === 'project.members').slice(-1)[0];
      expect(event.projectId).toBe('p-erp');
      expect(event.changes.map((c) => c.field)).toEqual(['إضافة عضو: سارة العتيبي', 'إزالة عضو: عبدالله الشهري', 'تغيير دور: ريم الزهراني']);
      expect(db.notifications.where((n) => n.userId === 'u-6' && n.title.includes('أُزيلت')).length).toBe(1);
    });

    it('removing a member leaves their open items and reports them as warnings', async () => {
      const before = db.workItems.where((w) => w.projectId === 'p-erp' && w.assigneeIds.includes('u-4')).map((w) => w.ref).sort();
      const result = await setMembers('u-2', db.projects.get('p-erp').members.filter((m) => m.userId !== 'u-4'));
      const warning = result.warnings!.find((w) => w.userId === 'u-4')!;
      expect(warning.userName).toBe('فهد الدوسري');
      expect(warning.refs.length).toBeGreaterThan(0);
      expect(db.workItems.where((w) => w.projectId === 'p-erp' && w.assigneeIds.includes('u-4')).map((w) => w.ref).sort()).toEqual(before);
    });

    it('progress counts only leaves of the included types and explains the rule', async () => {
      const all = await call<ProjectSummary>('u-2', 'GET', 'projects/p-erp');
      expect(all.progress.rule).toContain('جميع الأنواع');
      const bugs = db.workItems.where((w) => w.projectId === 'p-erp' && w.typeId === 't-bug' && !w.archived).length;
      await call('u-1', 'PATCH', 'settings', { progressIncludedTypeIds: ['t-bug'], version: db.settings.version });
      const onlyBugs = await call<ProjectSummary>('u-2', 'GET', 'projects/p-erp');
      expect(onlyBugs.progress.countedLeaves).toBe(bugs);
      expect(onlyBugs.progress.countedLeaves).toBeLessThan(all.progress.countedLeaves);
      expect(onlyBugs.progress.rule).toContain('الأنواع المحتسبة');
      expect(await status(() => call('u-1', 'PATCH', 'settings', { progressIncludedTypeIds: ['t-nope'], version: db.settings.version }))).toBe(400);
    });

    it('a project template applies its suggested members; inactive ones are skipped', async () => {
      const tpl = db.projectTemplates.insert({
        name: 'قالب بأعضاء', description: '', active: true, allowedTypeIds: ['t-task'], defaultTypeId: 't-task', initialStatusId: 'ps-pending',
        suggestedRoleIds: ['r-member'], durationDays: 30, suggestedMembers: [{ userId: 'u-5', roleId: 'r-member' }, { userId: 'u-7', roleId: 'r-member' }, { userId: 'u-6', roleId: 'r-admin' }],
      });
      const created = await call<ProjectSummary>('u-2', 'POST', 'projects', { code: 'TPL', name: 'مشروع', description: '', ownerId: 'u-2', startDate: day(0), endDate: day(30), templateId: tpl.id });
      expect(created.members.map((m) => m.userId).sort()).toEqual(['u-2', 'u-5']);
      const log = db.audit.where((e) => e.action === 'project.created').slice(-1)[0];
      expect(log.changes.length).toBe(3);
    });
  });

  // ---------- 7. Git ----------

  describe('FR-GIT', () => {
    const push = (message: string, id = 'abc1234def5678', branch = 'feature/x') =>
      JSON.stringify({ ref: `refs/heads/${branch}`, commits: [{ id, message, url: 'https://git.example.local/c/abc1234', author: { username: 'fahad' } }] });
    const setPattern = (user: string, refPattern: string | null) => call<ProjectSummary>(user, 'POST', 'projects/p-erp/ref-pattern', { refPattern });

    it('ref pattern: validation rejects unsafe or wrong patterns', async () => {
      expect(await status(() => setPattern('u-4', '(ERP-\\d+)'))).toBe(403);
      expect(await status(() => setPattern('u-1', '(ERP-\\d+)+'))).toBe(422); // nested quantifier
      expect(await status(() => setPattern('u-1', '((ERP)-\\d+)'))).toBe(422); // two groups
      expect(await status(() => setPattern('u-1', 'ERP-\\d+'))).toBe(422); // no group
      expect(await status(() => setPattern('u-1', '(a+)+$'))).toBe(422); // catastrophic
      expect(await status(() => setPattern('u-1', '(a|aa)*(ERP-\\d+)'))).toBe(422); // overlapping alternation
      expect(await status(() => setPattern('u-1', '(ERP-\\d+)\\1'))).toBe(422); // back-reference
      expect(await status(() => setPattern('u-1', '('))).toBe(422); // does not compile
      expect(await status(() => setPattern('u-1', `(ERP-\\d+)${'x?'.repeat(60)}`))).toBe(422); // too long
      expect(await status(() => setPattern('u-1', '(XYZ-\\d+)'))).toBe(422); // does not match this project's own refs
      expect(validateRefPattern('(ERP-\\d+)', ['ERP-101'])).toBeNull();
    });

    it('ref pattern: a valid custom pattern drives auto-linking and is audited', async () => {
      await setPattern('u-1', '\\[(ERP-\\d+)\\]');
      expect(db.projects.get('p-erp').refPattern).toBe('\\[(ERP-\\d+)\\]');
      const plain = push('ERP-108 بدون أقواس', 'aaaa111aaaa111');
      await call(null, 'POST', 'webhooks/gitea/repo-1', plain, await signedHeaders('demo-secret-erp-web-0001', plain, 'push', 'rp-1'));
      expect(db.gitEvents.where((g) => g.sha === 'aaaa111')[0].workItemRefs).toEqual([]);
      const bracket = push('[ERP-108] بأقواس', 'bbbb222bbbb222');
      await call(null, 'POST', 'webhooks/gitea/repo-1', bracket, await signedHeaders('demo-secret-erp-web-0001', bracket, 'push', 'rp-2'));
      expect(db.gitEvents.where((g) => g.sha === 'bbbb222')[0].workItemRefs).toEqual(['ERP-108']);
      expect(db.audit.where((e) => e.action === 'project.refPattern').length).toBe(1);
      await setPattern('u-1', null); // reset to the derived default
      expect(db.projects.get('p-erp').refPattern).toBeUndefined();
    });

    it('manual sync ingests missed commits once, links refs, and audits the counts', async () => {
      const before = db.gitEvents.where((g) => g.repositoryId === 'repo-1').length;
      await call('u-1', 'POST', 'projects/p-erp/git-sync', { repositoryId: 'repo-1' });
      const events = db.gitEvents.where((g) => g.repositoryId === 'repo-1');
      expect(events.length - before).toBe(3); // 4 remote commits, 1 already received by webhook
      expect(events.find((g) => g.sha === '3d5e7f1')?.workItemRefs).toEqual(['ERP-106']);
      const repo = db.projects.get('p-erp').repositories.find((r) => r.id === 'repo-1')!;
      expect(repo.lastSyncError).toBeNull();
      const audit = db.audit.where((e) => e.action === 'git.synced').slice(-1)[0];
      expect(audit.changes.map((c) => c.to)).toEqual(['4', '3', '1']);
      await call('u-1', 'POST', 'projects/p-erp/git-sync', { repositoryId: 'repo-1' });
      expect(db.gitEvents.where((g) => g.repositoryId === 'repo-1').length).toBe(events.length); // idempotent
      expect(db.audit.where((e) => e.action === 'git.synced').slice(-1)[0].changes.map((c) => c.to)).toEqual(['4', '0', '0']);
    });

    it('sync failure sets lastSyncError and is still audited', async () => {
      const project = db.projects.get('p-erp');
      db.projects.patch('p-erp', { repositories: project.repositories.map((r) => (r.id === 'repo-2' ? { ...r, simulateOutage: true } : r)) });
      const err = await error(() => call('u-1', 'POST', 'projects/p-erp/git-sync', { repositoryId: 'repo-2' }));
      expect(err?.status).toBe(502);
      const repo = db.projects.get('p-erp').repositories.find((r) => r.id === 'repo-2')!;
      expect(repo.lastSyncError).toContain('تعذّر الاتصال');
      expect(db.audit.where((e) => e.action === 'git.synced' && e.changes.some((c) => c.field === 'الخطأ')).length).toBe(1);
      expect(db.gitEvents.where((g) => g.repositoryId === 'repo-2').length).toBe(1); // seed event only
    });

    it('syncing a disconnected repository records the error and fails', async () => {
      await call('u-1', 'POST', 'projects/p-erp/repositories/repo-1/disconnect');
      expect(await status(() => call('u-1', 'POST', 'projects/p-erp/git-sync', { repositoryId: 'repo-1' }))).toBe(422);
      expect(db.projects.get('p-erp').repositories.find((r) => r.id === 'repo-1')!.lastSyncError).toContain('مفصول');
      expect(db.audit.where((e) => e.action === 'git.synced').length).toBe(1);
      expect(await status(() => call('u-4', 'POST', 'projects/p-erp/git-sync', { repositoryId: 'repo-2' }))).toBe(403);
    });

    it('rotating the secret returns it once, switches verification and never audits the value', async () => {
      const raw = push('ERP-108 اختبار');
      const { secret, repositoryId } = await call<RotatedSecret>('u-1', 'POST', 'projects/p-erp/repositories/repo-1/rotate-secret');
      expect(repositoryId).toBe('repo-1');
      expect(secret.length).toBeGreaterThanOrEqual(16);
      expect(db.webhookSecrets.get('repo-1')).toBe(secret);
      expect(await status(() => call(null, 'POST', 'webhooks/gitea/repo-1', raw, undefined))).toBe(400); // no delivery id
      expect(await status(async () => call(null, 'POST', 'webhooks/gitea/repo-1', raw, await signedHeaders('demo-secret-erp-web-0001', raw, 'push', 'rot-1')))).toBe(401); // old secret
      expect((await call<{ outcome: string }>(null, 'POST', 'webhooks/gitea/repo-1', raw, await signedHeaders(secret, raw, 'push', 'rot-2'))).outcome).toBe('processed');
      const event = db.audit.where((e) => e.action === 'git.secretRotated')[0];
      expect(JSON.stringify(event)).not.toContain(secret);
      expect(event.security).toBe(true);
      expect(await status(() => call('u-4', 'POST', 'projects/p-erp/repositories/repo-1/rotate-secret'))).toBe(403);
    });

    it('disconnect deletes the webhook secret', async () => {
      expect(db.webhookSecrets.has('repo-1')).toBe(true);
      await call('u-1', 'POST', 'projects/p-erp/repositories/repo-1/disconnect');
      expect(db.webhookSecrets.has('repo-1')).toBe(false);
      expect(await status(() => call('u-1', 'POST', 'projects/p-erp/repositories/repo-1/rotate-secret'))).toBe(422);
    });

    it('replay protection: stale or malformed X-Delivery-Timestamp is rejected and logged', async () => {
      const send = async (id: string, stamp: string | null, message = 'ERP-108 إعادة') => {
        const raw = push(message, `${id}`.padEnd(14, '0'));
        const headers = await signedHeaders('demo-secret-erp-web-0001', raw, 'push', id, stamp ?? undefined);
        return call(null, 'POST', 'webhooks/gitea/repo-1', raw, stamp === null ? headers.delete('X-Delivery-Timestamp') : headers);
      };
      expect(await status(() => send('fresh1', new Date().toISOString()))).toBe(200);
      expect(await status(() => send('epoch1', String(Math.floor(Date.now() / 1000))))).toBe(200); // epoch seconds
      expect(await status(() => send('none1', null))).toBe(400); // header is mandatory
      expect(await status(() => send('old1', new Date(Date.now() - 10 * 60_000).toISOString()))).toBe(401);
      expect(await status(() => send('future1', new Date(Date.now() + 10 * 60_000).toISOString()))).toBe(401);
      expect(await status(() => send('junk1', 'yesterday-ish'))).toBe(401);
      const rejected = db.webhookDeliveries.where((d) => d.outcome === 'rejected');
      expect(rejected.map((d) => d.deliveryId).sort()).toEqual(['future1', 'junk1', 'none1', 'old1']);
      expect(db.audit.where((e) => e.action === 'git.webhook_rejected' && e.security).length).toBe(4);
    });

    it('connector registry: per-provider headers, signatures, events and URLs', async () => {
      expect(Object.keys(GIT_CONNECTORS).sort()).toEqual(['gitea', 'github', 'gitlab']);
      expect(() => gitConnector('bitbucket')).toThrow();
      const raw = '{"a":1}';
      for (const provider of ['gitea', 'github'] as const) {
        const c = gitConnector(provider);
        const ts = new Date().toISOString();
        const ok = new HttpHeaders({ [c.signatureHeader]: await c.sign('s3cret-s3cret-s3cret', raw, ts), 'X-Delivery-Timestamp': ts });
        expect(await c.verify('s3cret-s3cret-s3cret', raw, ok)).toBe(true);
        expect(await c.verify('another-secret-value!', raw, ok)).toBe(false);
        expect(await c.verify('s3cret-s3cret-s3cret', '{"a":2}', ok)).toBe(false);
        expect(await c.verify('s3cret-s3cret-s3cret', raw, new HttpHeaders())).toBe(false);
        expect(await c.verify('s3cret-s3cret-s3cret', raw, ok.set('X-Delivery-Timestamp', '2020-01-01T00:00:00Z'))).toBe(false); // timestamp is signed
      }
      const lab = gitConnector('gitlab');
      expect(await lab.verify('tok', raw, new HttpHeaders({ 'X-Gitlab-Token': 'tok', 'X-Delivery-Timestamp': new Date().toISOString() }))).toBe(true);
      expect(await lab.verify('tok', raw, new HttpHeaders({ 'X-Gitlab-Token': 'tok' }))).toBe(false); // timestamp required
      expect(await lab.verify('tok', raw, new HttpHeaders({ 'X-Gitlab-Token': 'bad', 'X-Delivery-Timestamp': new Date().toISOString() }))).toBe(false);
      expect(gitConnector('github').signatureHeader).toBe('X-Hub-Signature-256');
      expect(lab.normalizeEvent('Push Hook')).toBe('push');
      expect(lab.normalizeEvent('Merge Request Hook')).toBe('pull_request');
      expect(gitConnector('gitea').normalizeEvent('push')).toBe('push');
      expect(gitConnector('gitea').commitUrl('https://g.example/o/r/', 'abc')).toBe('https://g.example/o/r/commit/abc');
      expect(gitConnector('github').prUrl('https://g.example/o/r', 7)).toBe('https://g.example/o/r/pull/7');
      expect(lab.prUrl('https://g.example/o/r', 7)).toBe('https://g.example/o/r/-/merge_requests/7');
    });

    it('an unsupported provider in the webhook URL is a 400, not a crash', async () => {
      expect(await status(() => call(null, 'POST', 'webhooks/bitbucket/repo-1', '{}', new HttpHeaders({ 'X-Event-Key': 'x' })))).toBe(400);
    });
  });
});
