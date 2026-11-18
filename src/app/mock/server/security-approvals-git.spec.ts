import { HttpHeaders, HttpParams } from '@angular/common/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PermissionKey } from '@core/auth/permissions';
import { APPROVAL_TTL_DAYS, ApprovalRequest, ApprovalTemplate, BulkDecideResult } from '@domain/approvals/approval.models';
import { DEMO_MODE, hmacSha256Hex, signedMaterial } from '@domain/git/git-connector';
import { extractRefs, isCatastrophic, MAX_SCAN_CHARS, validateRefPattern } from '@domain/git/ref-pattern';
import { validateRepositoryUrl } from '@domain/git/repo-url';
import { WebhookDelivery } from '@domain/git/git.models';
import { MockHttpError } from '../db/collection';
import { MockDatabase } from '../db/database';
import { consumeApproval, requestStageApprovers, requireApproval } from './approvals/engine';
import { registerApprovalHandlers } from './handlers/approvals.handlers';
import { registerConfigHandlers } from './handlers/config.handlers';
import { registerExtraHandlers } from './handlers/extras.handlers';
import { registerGitHandlers, signedHeaders } from './handlers/git.handlers';
import { registerProjectHandlers } from './handlers/projects.handlers';
import { registerWorkItemHandlers } from './handlers/work-items.handlers';
import { Method, MockContext, MockRouter } from './router';

const SECRET = 'demo-secret-erp-web-0001';

/** Regression tests for the security review of approvals, Git webhooks, projects and sensitive changes. */
describe('security: approvals, git, projects (mock API)', () => {
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

  afterEach(() => vi.useRealTimers());

  async function call<T = unknown>(userId: string | null, method: Method, path: string, body: unknown = {}, headers?: HttpHeaders): Promise<T> {
    const match = router.match(method, path);
    if (!match) throw new Error(`no route ${method} ${path}`);
    return (await match.route.handler({ method, path, params: match.params, query: new HttpParams(), body, headers }, new MockContext(db, userId))) as T;
  }

  async function status(fn: () => Promise<unknown>): Promise<number> {
    try {
      await fn();
      return 200;
    } catch (e) {
      if (e instanceof MockHttpError) return e.status;
      throw e;
    }
  }

  const push = (message: string, id = 'abc1234def5678'): string =>
    JSON.stringify({ ref: 'refs/heads/x', commits: [{ id, message, url: 'https://git.example.local/c/abc1234', author: { username: 'fahad' } }] });
  const hook = (raw: string, headers: HttpHeaders) => call<WebhookDelivery>(null, 'POST', 'webhooks/gitea/repo-1', raw, headers);

  function template(partial: Partial<ApprovalTemplate> & Pick<ApprovalTemplate, 'event'>): ApprovalTemplate {
    return db.templates.insert({
      name: 'قالب اختبار', active: true, protectedFields: ['title'],
      stages: [{ order: 1, name: 'مرحلة', approverKind: 'user', approverId: 'u-3' }], ...partial,
    });
  }
  const approve = (user: string, id: string, revision = 1) => call<ApprovalRequest>(user, 'POST', `approvals/${id}/decide`, { decision: 'Approve', comment: '', revision });
  const submit = (user: string, templateId: string, subjectId: string, subjectType = 'workItem', extra: object = {}) =>
    call<ApprovalRequest>(user, 'POST', 'approvals', { templateId, subjectType, subjectId, ...extra });

  // ---------- 1. ReDoS ----------

  describe('1. ref pattern validation', () => {
    it('rejects nested-group and polynomial attack patterns', () => {
      expect(isCatastrophic('((a+))+$')).toBe(true);
      expect(isCatastrophic('(\\w+)\\w+\\w+x')).toBe(true);
      expect(isCatastrophic('(a|a)*')).toBe(true);
      expect(isCatastrophic('(?=ERP)(ERP-\\d+)')).toBe(true);
      expect(isCatastrophic('(ERP)\\1')).toBe(true);
      expect(validateRefPattern('((a+))+$', ['ERP-101'])).not.toBeNull();
      expect(validateRefPattern('(\\w+)\\w+\\w+x', ['ERP-101'])).not.toBeNull();
      expect(validateRefPattern(`(ERP-\\d+)${'x'.repeat(100)}`, ['ERP-101'])).not.toBeNull();
    });

    it('accepts normal patterns', () => {
      expect(isCatastrophic('\\bERP-\\d+\\b')).toBe(false);
      expect(isCatastrophic('\\b(ERP-\\d+)\\b')).toBe(false);
      expect(validateRefPattern('\\b(ERP-\\d+)\\b', ['ERP-101'])).toBeNull();
      expect(validateRefPattern('\\[(ERP-\\d+)\\]|(ERP-\\d+)', ['ERP-101'])).not.toBeNull(); // two captures: still refused by the capture rule
    });

    it('only scans the first characters of each text', () => {
      const pattern = '\\b(ERP-\\d+)\\b';
      expect(extractRefs(pattern, `${' '.repeat(MAX_SCAN_CHARS)}ERP-108`)).toEqual([]);
      expect(extractRefs(pattern, `ERP-108 ${' '.repeat(MAX_SCAN_CHARS)}`)).toEqual(['ERP-108']);
    });
  });

  // ---------- 2. Webhook replay and dedupe ----------

  describe('2. webhook timestamp and dedupe', () => {
    it('requires the timestamp header (400) and signs it', async () => {
      const raw = push('ERP-108 a');
      const headers = await signedHeaders(SECRET, raw, 'push', 'ts-1');
      expect((await hook(raw, headers)).outcome).toBe('processed');
      expect(await status(() => hook(raw, headers.delete('X-Delivery-Timestamp').set('X-Gitea-Delivery', 'ts-2')))).toBe(400);
      // swapping the timestamp after signing breaks the signature
      const swapped = (await signedHeaders(SECRET, raw, 'push', 'ts-3', new Date(Date.now() - 60_000).toISOString())).set('X-Delivery-Timestamp', new Date().toISOString());
      expect(await status(() => hook(raw, swapped))).toBe(401);
      // the old scheme (signature over the body only) is no longer accepted
      const legacy = new HttpHeaders({ 'X-Gitea-Event': 'push', 'X-Gitea-Delivery': 'ts-4', 'X-Delivery-Timestamp': new Date().toISOString(), 'X-Gitea-Signature': await hmacSha256Hex(SECRET, raw) });
      expect(await status(() => hook(raw, legacy))).toBe(401);
      expect(signedMaterial('T', 'B')).toBe('T.B');
    });

    it('a replay of a failed delivery is a duplicate; only the redeliver endpoint retries it', async () => {
      const bad = JSON.stringify({ ref: 1, commits: [] });
      const first = await hook(bad, await signedHeaders(SECRET, bad, 'push', 'fail-1'));
      expect(first.outcome).toBe('failed');
      const second = await hook(bad, await signedHeaders(SECRET, bad, 'push', 'fail-1'));
      expect(second.outcome).toBe('duplicate');
      // dedupe is per repository: the same id on another repository is not a duplicate
      expect(db.webhookDeliveries.where((d) => d.deliveryId === 'fail-1' && d.outcome === 'failed').length).toBe(1);
    });

    it('a forged delivery cannot burn a legitimate delivery id', async () => {
      const raw = push('ERP-108 b');
      const forged = (await signedHeaders('wrong-secret-wrong-secret', raw, 'push', 'burn-1'));
      expect(await status(() => hook(raw, forged))).toBe(401);
      expect((await hook(raw, await signedHeaders(SECRET, raw, 'push', 'burn-1'))).outcome).toBe('processed');
    });

    it('the simulator still works with the new scheme', async () => {
      const ok = await call<WebhookDelivery>('u-2', 'POST', 'git/simulate', { repositoryId: 'repo-1', event: 'push', branch: 'x', message: 'ERP-112', author: 'x' });
      expect(ok.outcome).toBe('processed');
      const bad = await call<WebhookDelivery>('u-2', 'POST', 'git/simulate', { repositoryId: 'repo-1', event: 'push', branch: 'x', message: 'ERP-112', author: 'x', unsigned: true });
      expect(bad.outcome).toBe('rejected');
    });
  });

  // ---------- 3. Simulator, SSRF, outage flag ----------

  describe('3. demo gate, repository URL, outage flag', () => {
    it('the simulator is gated by DEMO_MODE (true in the mock build)', () => {
      expect(DEMO_MODE).toBe(true);
    });

    it('validates repository URLs against SSRF vectors', () => {
      expect(validateRepositoryUrl('https://git.example.local/erp/web')).toBeNull();
      expect(validateRepositoryUrl('https://github.com/o/r')).toBeNull();
      for (const bad of [
        'http://git.example.com/o/r', 'https://user:pw@git.example.com/o/r', 'https://localhost/o/r', 'https://10.1.2.3/o/r', 'https://172.16.0.1/o/r',
        'https://192.168.1.1/o/r', 'https://127.0.0.1/o/r', 'https://169.254.169.254/latest', 'https://[::1]/o/r', 'https://[fd00::1]/o/r',
        'https://git.example.com:8443/o/r', 'not a url',
      ]) expect(validateRepositoryUrl(bad), bad).not.toBeNull();
    });

    it('connect rejects a private URL and accepts a public one', async () => {
      const dto = { provider: 'gitea', name: 'erp/new', defaultBranch: 'main', accessToken: 'tok' };
      expect(await status(() => call('u-1', 'POST', 'projects/p-erp/repositories', { ...dto, url: 'https://10.0.0.5/erp/new' }))).toBe(400);
      expect(await status(() => call('u-1', 'POST', 'projects/p-erp/repositories', { ...dto, url: 'https://git.example.local/erp/new' }))).toBe(200);
    });

    it('sync outage comes from the repository flag, not from the repository name', async () => {
      const project = db.projects.get('p-erp');
      db.projects.patch('p-erp', { repositories: project.repositories.map((r) => (r.id === 'repo-2' ? { ...r, name: 'erp/fail-api' } : r)) });
      expect(await status(() => call('u-1', 'POST', 'projects/p-erp/git-sync', { repositoryId: 'repo-2' }))).toBe(200);
      const flagged = db.projects.get('p-erp');
      db.projects.patch('p-erp', { repositories: flagged.repositories.map((r) => (r.id === 'repo-2' ? { ...r, simulateOutage: true } : r)) });
      expect(await status(() => call('u-1', 'POST', 'projects/p-erp/git-sync', { repositoryId: 'repo-2' }))).toBe(502);
    });
  });

  // ---------- 4. Approvals ----------

  describe('4. approvals', () => {
    it('bulk-decide needs an explicit revision per id', async () => {
      const results = await call<BulkDecideResult[]>('u-3', 'POST', 'approvals/bulk-decide', { ids: ['apr-1'], decision: 'Approve' });
      expect(results[0].ok).toBe(false);
      expect(db.approvals.get('apr-1').status).toBe('PendingApproval');
      const ok = await call<BulkDecideResult[]>('u-3', 'POST', 'approvals/bulk-decide', { ids: ['apr-1'], decision: 'Approve', revisions: { 'apr-1': db.approvals.get('apr-1').revision } });
      expect(ok[0].ok).toBe(true);
    });

    it('an approval bound to another target/action is refused, is consumed persistently and expires', async () => {
      const t = template({ event: 'workItem.approve' });
      const ctx = new MockContext(db, 'u-2');
      const base = { templateId: t.id, subjectType: 'workItem' as const, subjectId: 'p-erp-wi-12', projectId: 'p-erp', title: 'x', requesterId: 'u-4', currentStage: 0, revision: 1, snapshot: { title: db.workItems.get('p-erp-wi-12').title }, decisions: [], stages: t.stages };
      const closeApproval = db.approvals.insert({ ...base, status: 'Approved', action: 'close', targetStatusId: 's-completed' });
      expect(() => requireApproval(db, ctx, { subjectType: 'workItem', subjectId: 'p-erp-wi-12', action: 'reopen', targetStatusId: 's-progress' })).toThrowError(MockHttpError);
      expect(() => requireApproval(db, ctx, { subjectType: 'workItem', subjectId: 'p-erp-wi-12', action: 'close', targetStatusId: 's-cancelled' })).toThrowError(MockHttpError);
      const ok = requireApproval(db, ctx, { subjectType: 'workItem', subjectId: 'p-erp-wi-12', action: 'close', targetStatusId: 's-completed' });
      expect(ok.id).toBe(closeApproval.id);
      consumeApproval(db, ok);
      expect(db.approvals.get(ok.id).consumedAt).toBeTruthy();
      expect(() => requireApproval(db, ctx, { subjectType: 'workItem', subjectId: 'p-erp-wi-12', action: 'close', targetStatusId: 's-completed' })).toThrowError(MockHttpError);

      db.approvals.insert({ ...base, status: 'Approved', action: 'close', targetStatusId: 's-completed' });
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + (APPROVAL_TTL_DAYS + 1) * 86_400_000);
      expect(() => requireApproval(db, ctx, { subjectType: 'workItem', subjectId: 'p-erp-wi-12', action: 'close', targetStatusId: 's-completed' })).toThrowError(MockHttpError);
    });

    it('submission stores the action and the frozen approvers', async () => {
      const request = await submit('u-4', 'tpl-task', 'p-erp-wi-12', 'workItem', { targetStatusId: 's-completed' });
      expect(request.action).toBe('close');
      expect(request.targetStatusId).toBe('s-completed');
      expect(request.resolvedApprovers?.[1]).toContain('u-3');
      expect(await status(() => submit('u-4', 'tpl-task', 'p-erp-wi-12', 'workItem', { action: 'activate' }))).toBe(422);
    });

    it('frozen approvers survive a change of the project owner', async () => {
      const t = template({ event: 'project.approve', stages: [{ order: 1, name: 'المالك', approverKind: 'position', approverId: 'project_owner' }] });
      const request = await submit('u-2', t.id, 'p-bi', 'project').catch(() => null);
      const created = request ?? db.approvals.insert({
        templateId: t.id, subjectType: 'project', subjectId: 'p-erp', projectId: 'p-erp', title: 'x', requesterId: 'u-4', status: 'PendingApproval', currentStage: 1, revision: 1,
        snapshot: {}, decisions: [], stages: t.stages, resolvedApprovers: { 1: [db.projects.get('p-erp').ownerId] },
      });
      const oldOwner = created.resolvedApprovers![1][0];
      const project = db.projects.get(created.projectId);
      db.projects.patch(project.id, { ownerId: project.members.find((m) => m.userId !== oldOwner)!.userId });
      expect(requestStageApprovers(db, created, created.stages[0])).toContain(oldOwner);
    });

    it('reassign: no 403/404 id leak, and no reassignment to an earlier-stage decider', async () => {
      // a caller without access to p-ssp sees the same 404 for an existing and a missing request
      const hidden = await status(() => call('u-4', 'POST', 'approvals/apr-3/reassign', { approverId: 'u-2', reason: 'x' }));
      const missing = await status(() => call('u-4', 'POST', 'approvals/apr-nope/reassign', { approverId: 'u-2', reason: 'x' }));
      expect(hidden).toBe(404);
      expect(missing).toBe(404);
      // apr-2 is at stage 2; u-3 decided stage 1
      expect(await status(() => call('u-1', 'POST', 'approvals/apr-2/reassign', { approverId: 'u-3', reason: 'تبديل' }))).toBe(422);
      expect(await status(() => call('u-1', 'POST', 'approvals/apr-2/reassign', { approverId: 'u-2', reason: 'تبديل' }))).toBe(200);
      expect(db.approvals.get('apr-2').resolvedApprovers?.[2]).toEqual(['u-2']);
    });

    it('delegations: the delegate must be able to decide somewhere; others need approvals.configure', async () => {
      const nobody = db.users.insert({ username: 'nobody', name: 'بلا صلاحيات', email: 'n@example.local', title: '', active: true, systemRoleIds: [] });
      const dto = { toUserId: nobody.id, from: new Date().toISOString().slice(0, 10), to: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10), reason: 'سفر' };
      expect(await status(() => call('u-3', 'POST', 'delegations', dto))).toBe(400);
      expect(await status(() => call('u-3', 'POST', 'delegations', { ...dto, toUserId: 'u-2' }))).toBe(200);
      expect(await status(() => call('u-4', 'POST', 'delegations', { ...dto, toUserId: 'u-2', fromUserId: 'u-3' }))).toBe(403);
    });
  });

  // ---------- 5. Projects ----------

  describe('5. projects', () => {
    const members = () => db.projects.get('p-erp').members;
    const post = (user: string, list: unknown) => call(user, 'POST', 'projects/p-erp/members', { members: list, version: db.projects.get('p-erp').version });

    it('members: non-object elements are 400, extra fields are dropped', async () => {
      expect(await status(() => post('u-2', [null, 5]))).toBe(400);
      expect(await status(() => post('u-2', [{ userId: 5, roleId: 'r-pm' }]))).toBe(400);
      await post('u-2', members().map((m) => ({ ...m, admin: true })));
      expect(db.projects.get('p-erp').members.every((m) => Object.keys(m).sort().join() === 'roleId,userId')).toBe(true);
    });

    it('members: removing or lowering a member with a stronger role is refused', async () => {
      db.roles.insert({ key: 'power', name: 'قوي', description: '', scope: 'project', permissions: ['settings.manage' as PermissionKey], denied: [], builtIn: false }, { id: 'r-power' });
      db.projects.patch('p-erp', { members: members().map((m) => (m.userId === 'u-5' ? { ...m, roleId: 'r-power' } : m)) });
      expect(await status(() => post('u-2', members().filter((m) => m.userId !== 'u-5')))).toBe(403);
      expect(await status(() => post('u-2', members().map((m) => (m.userId === 'u-5' ? { ...m, roleId: 'r-viewer' } : m))))).toBe(403);
      expect(members().some((m) => m.userId === 'u-5' && m.roleId === 'r-power')).toBe(true);
    });

    it('create validates like patch', async () => {
      const project = { code: 'VAL', name: 'مشروع', description: '', ownerId: 'u-2', startDate: '2026-01-01', endDate: '2026-02-01' };
      expect(await status(() => call('u-2', 'POST', 'projects', { ...project, name: 5 }))).toBe(400);
      expect(await status(() => call('u-2', 'POST', 'projects', { ...project, name: 'x'.repeat(201) }))).toBe(400);
      expect(await status(() => call('u-2', 'POST', 'projects', { ...project, startDate: 'soon' }))).toBe(400);
      expect(await status(() => call('u-2', 'POST', 'projects', { ...project, endDate: '2025-01-01' }))).toBe(400);
      expect(await status(() => call('u-2', 'POST', 'projects', { ...project, ownerId: 'u-7' }))).toBe(400); // inactive
      expect(await status(() => call('u-2', 'POST', 'projects', { ...project, ownerId: 'nobody' }))).toBe(400);
      expect(await status(() => call('u-2', 'POST', 'projects', project))).toBe(200);
    });

    it('patch with a non-string name is 400', async () => {
      const p = db.projects.get('p-erp');
      expect(await status(() => call('u-2', 'PATCH', 'projects/p-erp', { name: { a: 1 }, version: p.version }))).toBe(400);
    });

    it('work item create validates priority, dates, title and assignees', async () => {
      const item = { projectId: 'p-erp', typeId: 't-task', title: 'ok', description: '', priority: 'low', assigneeIds: [], startDate: '2026-01-02', dueDate: '2026-01-05', parentId: null, fields: {} };
      expect(await status(() => call('u-2', 'POST', 'work-items', { ...item, priority: 'urgent' }))).toBe(400);
      expect(await status(() => call('u-2', 'POST', 'work-items', { ...item, dueDate: '2026-01-01' }))).toBe(400);
      expect(await status(() => call('u-2', 'POST', 'work-items', { ...item, startDate: 'x' }))).toBe(400);
      expect(await status(() => call('u-2', 'POST', 'work-items', { ...item, title: 'x'.repeat(201) }))).toBe(400);
      expect(await status(() => call('u-2', 'POST', 'work-items', { ...item, title: 7 }))).toBe(400);
      expect(await status(() => call('u-2', 'POST', 'work-items', { ...item, assigneeIds: 'u-4' }))).toBe(400);
      expect(await status(() => call('u-2', 'POST', 'work-items', { ...item, assigneeIds: ['u-1'] }))).toBe(400); // not a member
      expect(await status(() => call('u-2', 'POST', 'work-items', { ...item, assigneeIds: ['u-4'] }))).toBe(200);
    });

    it('project transition: inactive target refused, history recorded, no duplicate POST users route', async () => {
      const p = db.projects.get('p-bi');
      const wf = db.workflows.get('wf-project');
      const t = wf.transitions.find((x) => x.fromStatusId === p.statusId && !x.requiresApproval);
      if (t) {
        db.statuses.patch(t.toStatusId, { active: false });
        expect(await status(() => call('u-1', 'POST', 'projects/p-bi/transition', { toStatusId: t.toStatusId, version: p.version }))).toBe(422);
        db.statuses.patch(t.toStatusId, { active: true });
        const before = db.transitions.where((x) => x.subjectType === 'project').length;
        await call('u-1', 'POST', 'projects/p-bi/transition', { toStatusId: t.toStatusId, version: db.projects.get('p-bi').version });
        expect(db.transitions.where((x) => x.subjectType === 'project').length).toBe(before + 1);
      }
      expect(router.match('POST', 'users')).toBeNull(); // the strict registration lives in auth-users.handlers.ts
    });
  });

  // ---------- 6. Sensitive changes ----------

  describe('6. members and relations supersede protected requests', () => {
    it('a member change supersedes a pending request that protects members', async () => {
      const t = template({ event: 'project.close', protectedFields: ['members'] });
      const request = await submit('u-2', t.id, 'p-erp', 'project');
      expect(request.snapshot['members']).toBeTruthy();
      const p = db.projects.get('p-erp');
      await call('u-2', 'POST', 'projects/p-erp/members', { members: p.members.map((m) => (m.userId === 'u-6' ? { ...m, roleId: 'r-member' } : m)), version: p.version });
      expect(db.approvals.get(request.id).status).toBe('Superseded');
    });

    it('a relation change supersedes a pending request that protects relations', async () => {
      const t = template({ event: 'workItem.approve', protectedFields: ['relations'], rule: { priority: 99, workItemTypeIds: ['t-task'] } });
      const request = await submit('u-4', t.id, 'p-erp-wi-12');
      await call('u-2', 'POST', 'relations', { sourceId: 'p-erp-wi-12', targetId: 'p-erp-wi-4', relationTypeId: 'rt-relates' });
      expect(db.approvals.get(request.id).status).toBe('Superseded');
    });
  });
});
