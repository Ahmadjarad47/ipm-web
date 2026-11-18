import { HttpHeaders, HttpParams } from '@angular/common/http';
import { beforeEach, describe, expect, it } from 'vitest';
import { MockHttpError } from '../db/collection';
import { MockDatabase } from '../db/database';
import { registerApprovalHandlers } from './handlers/approvals.handlers';
import { registerConfigHandlers } from './handlers/config.handlers';
import { registerExtraHandlers } from './handlers/extras.handlers';
import { registerGitHandlers, signedHeaders } from './handlers/git.handlers';
import { registerProjectHandlers } from './handlers/projects.handlers';
import { registerWorkItemHandlers } from './handlers/work-items.handlers';
import { Method, MockContext, MockRouter } from './router';

describe('Git integration, bulk actions, reassignment and project workflow (mock API)', () => {
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

  async function status(fn: () => Promise<unknown>): Promise<number> {
    try {
      await fn();
      return 200;
    } catch (e) {
      if (e instanceof MockHttpError) return e.status;
      throw e;
    }
  }

  const push = (message: string, branch = 'feature/x') =>
    JSON.stringify({ ref: `refs/heads/${branch}`, commits: [{ id: 'abc1234def5678', message, url: 'https://git.example.local/c/abc1234', author: { username: 'fahad' } }] });

  it('AT-10: a commit mentioning a valid task ref is linked to that task', async () => {
    const raw = push('ERP-108 إضافة نموذج المورد');
    await call(null, 'POST', 'webhooks/gitea/repo-1', raw, await signedHeaders('demo-secret-erp-web-0001', raw, 'push', 'd-1'));
    const linked = db.gitEvents.where((g) => g.workItemRefs.includes('ERP-108'));
    expect(linked.length).toBe(1);
    expect(linked[0].url).toContain('https://');
  });

  it('FR-GIT-03: refs are also detected in the branch name, and only for this project', async () => {
    const raw = push('تحسينات عامة SSP-101', 'bugfix/ERP-110');
    await call(null, 'POST', 'webhooks/gitea/repo-1', raw, await signedHeaders('demo-secret-erp-web-0001', raw, 'push', 'd-2'));
    const event = db.gitEvents.where((g) => g.sha === 'abc1234')[0];
    expect(event.workItemRefs).toEqual(['ERP-110']); // SSP-101 belongs to another project
  });

  it('AT-09: a duplicate delivery is processed once; an unsigned one is rejected', async () => {
    const raw = push('ERP-108 commit');
    const headers = await signedHeaders('demo-secret-erp-web-0001', raw, 'push', 'same-delivery');
    await call(null, 'POST', 'webhooks/gitea/repo-1', raw, headers);
    const second = await call<{ outcome: string }>(null, 'POST', 'webhooks/gitea/repo-1', raw, headers);
    expect(second.outcome).toBe('duplicate');
    expect(db.gitEvents.where((g) => g.sha === 'abc1234').length).toBe(1);

    const forged = new HttpHeaders({ 'X-Delivery-Timestamp': new Date().toISOString(), 'X-Gitea-Event': 'push', 'X-Gitea-Delivery': 'd-x', 'X-Gitea-Signature': 'deadbeef' });
    expect(await status(() => call(null, 'POST', 'webhooks/gitea/repo-1', push('ERP-109 forged'), forged))).toBe(401);
    expect(db.audit.where((e) => e.action === 'git.webhook_rejected' && e.security).length).toBe(1);
  });

  it('FR-GIT-08: merging a PR does not complete the work item', async () => {
    const before = db.workItems.get('p-erp-wi-4').statusId;
    const raw = JSON.stringify({ action: 'closed', pull_request: { number: 77, title: 'ERP-104 ربط الموافقات', html_url: 'https://git.example.local/pulls/77', merged: true, merge_commit_sha: '9999999aaa', head: { ref: 'feature/ERP-104', sha: '1111111' }, user: { login: 'fahad' } } });
    await call(null, 'POST', 'webhooks/gitea/repo-1', raw, await signedHeaders('demo-secret-erp-web-0001', raw, 'pull_request', 'd-pr'));
    expect(db.workItems.get('p-erp-wi-4').statusId).toBe(before);
    expect(db.gitEvents.where((g) => g.prNumber === 77)[0].prState).toBe('merged');
  });

  it('simulator runs the real verification path and can show rejection and idempotency', async () => {
    const ok = await call<{ outcome: string; linkedRefs: string[] }>('u-2', 'POST', 'git/simulate', { repositoryId: 'repo-1', event: 'push', branch: 'feature/ERP-112', message: 'تحسين الأداء', author: 'fahad' });
    expect(ok.outcome).toBe('processed');
    expect(ok.linkedRefs).toEqual(['ERP-112']);
    const replay = await call<{ outcome: string }>('u-2', 'POST', 'git/simulate', { repositoryId: 'repo-1', event: 'push', branch: 'x', message: 'x', author: 'x', replayLast: true });
    expect(replay.outcome).toBe('duplicate');
    const bad = await call<{ outcome: string }>('u-2', 'POST', 'git/simulate', { repositoryId: 'repo-1', event: 'push', branch: 'x', message: 'ERP-112', author: 'x', unsigned: true });
    expect(bad.outcome).toBe('rejected');
  });

  it('manual link works for any work item type and is audited', async () => {
    await call('u-2', 'POST', 'git-events/g-1/link', { ref: 'ERP-101' }); // a milestone
    expect(db.gitEvents.get('g-1').workItemRefs).toContain('ERP-101');
    expect(db.gitEvents.get('g-1').manualRefs).toContain('ERP-101');
    await call('u-2', 'POST', 'git-events/g-1/unlink', { ref: 'ERP-101' });
    expect(db.gitEvents.get('g-1').workItemRefs).not.toContain('ERP-101');
  });

  it('bulk actions report per-item results and enforce each item’s rules', async () => {
    // ERP-108 pending→in progress needs an assignee; ERP-104 (has assignees) is already in progress
    const results = await call<{ ref: string; ok: boolean }[]>('u-2', 'POST', 'work-items/bulk', { ids: ['p-erp-wi-8', 'p-erp-wi-7'], action: { kind: 'transition', toStatusId: 's-progress' } });
    expect(results.find((r) => r.ref === 'ERP-108')!.ok).toBe(false);
    expect(results.find((r) => r.ref === 'ERP-107')!.ok).toBe(true);
    const prio = await call<{ ok: boolean }[]>('u-6', 'POST', 'work-items/bulk', { ids: ['p-erp-wi-3'], action: { kind: 'priority', priority: 'low' } });
    expect(prio[0].ok).toBe(false); // viewer
  });

  it('FR-APR-11: reassigning the active approver needs approvals.configure and a reason', async () => {
    expect(await status(() => call('u-2', 'POST', 'approvals/apr-1/reassign', { approverId: 'u-5', reason: 'إجازة' }))).toBe(403);
    expect(await status(() => call('u-1', 'POST', 'approvals/apr-1/reassign', { approverId: 'u-5', reason: ' ' }))).toBe(400);
    // reem (u-5) is not a member of BI, so she could neither see nor decide it
    expect(await status(() => call('u-1', 'POST', 'approvals/apr-1/reassign', { approverId: 'u-5', reason: 'إجازة' }))).toBe(422);
    await call('u-1', 'POST', 'approvals/apr-1/reassign', { approverId: 'u-1', reason: 'إجازة المعتمد الأصلي' });
    expect(db.approvals.get('apr-1').stages[0].approverId).toBe('u-1');
    expect(db.templates.get('tpl-project').stages[0].approverId).toBe('u-3'); // template untouched
  });

  it('§4.3 / FR-APR-08: project status cannot be edited directly and activation needs an approval', async () => {
    const v = db.projects.get('p-bi').version;
    expect(await status(() => call('u-3', 'PATCH', 'projects/p-bi', { statusId: 'ps-active', version: v }))).toBe(422);
    expect(await status(() => call('u-3', 'POST', 'projects/p-bi/transition', { toStatusId: 'ps-active', version: v }))).toBe(422);
    // approve apr-1 through its three stages, then activation is allowed
    // On BI the project-manager role (stage 2) is held by noura (u-3); khaled (u-2) is the requester.
    for (const decider of ['u-3', 'u-3', 'u-1']) await call(decider, 'POST', 'approvals/apr-1/decide', { decision: 'Approve', comment: '', revision: 1 });
    await call('u-3', 'POST', 'projects/p-bi/transition', { toStatusId: 'ps-active', version: db.projects.get('p-bi').version });
    expect(db.projects.get('p-bi').statusId).toBe('ps-active');
  });

  it('FR-PRJ-10: a template presets types and the project always starts in the initial status', async () => {
    const p = await call<{ allowedTypeIds: string[]; statusId: string }>('u-2', 'POST', 'projects', {
      code: 'OPS', name: 'دعم تشغيلي', description: '', ownerId: 'u-2', startDate: '2026-12-01', endDate: '2027-01-15', templateId: 'ptpl-ops', statusId: 'ps-active',
    });
    expect(p.allowedTypeIds).toEqual(['t-task', 't-bug']);
    expect(p.statusId).toBe('ps-pending');
  });

  it('settings drive policy: cross-project links stay blocked until enabled', async () => {
    const body = { sourceId: 'p-erp-wi-3', targetId: 'p-ssp-wi-5', relationTypeId: 'rt-relates' };
    expect(await status(() => call('u-2', 'POST', 'relations', body))).toBe(422);
    await call('u-1', 'PATCH', 'settings', { allowCrossProjectRelations: true, version: db.settings.version });
    expect(await status(() => call('u-2', 'POST', 'relations', body))).toBe(200);
    expect(await status(() => call('u-1', 'PATCH', 'settings', { attachmentExtensions: ['exe'], version: db.settings.version }))).toBe(400);
  });

  it('security: project PATCH rejects fields that have their own guarded actions', async () => {
    const v = db.projects.get('p-erp').version;
    for (const patch of [{ archived: true }, { members: [] }, { repositories: [] }]) {
      expect(await status(() => call('u-2', 'PATCH', 'projects/p-erp', { ...patch, version: v }))).toBe(422);
    }
  });

  it('security: an approval authorises one transition only', async () => {
    for (const decider of ['u-3', 'u-3', 'u-1']) await call(decider, 'POST', 'approvals/apr-1/decide', { decision: 'Approve', comment: '', revision: 1 });
    const t = (to: string) => call('u-3', 'POST', 'projects/p-bi/transition', { toStatusId: to, version: db.projects.get('p-bi').version });
    await t('ps-active');
    await t('ps-hold');
    // ps-hold → ps-active has no approval requirement in the seed workflow, so check re-use on a fresh pending project instead
    const project = db.projects.get('p-bi');
    db.projects.patch(project.id, { statusId: 'ps-pending' });
    expect(await status(() => t('ps-active'))).toBe(422); // the earlier approval is already consumed
  });

  it('security: deliveries require exactly one visible project', async () => {
    const q = new HttpParams().set('filter.projectId', 'p-erp,p-ssp');
    expect(await status(() => call('u-4', 'GET', 'git/deliveries', {}, undefined, q))).toBe(400);
  });

  it('security: templates cannot start projects past the initial status', async () => {
    const t = db.projectTemplates.get('ptpl-ops');
    expect(await status(() => call('u-1', 'PATCH', 'project-templates/ptpl-ops', { initialStatusId: 'ps-active', version: t.version }))).toBe(422);
  });

  it('global search respects visibility', async () => {
    const q = (s: string) => new HttpParams().set('q', s);
    const fahad = await call<{ code: string }[]>('u-4', 'GET', 'search', {}, undefined, q('SSP'));
    expect(fahad.some((h) => h.code?.startsWith('SSP'))).toBe(false); // not a member of SSP
    const khaled = await call<{ code: string }[]>('u-2', 'GET', 'search', {}, undefined, q('ERP-104'));
    expect(khaled[0].code).toBe('ERP-104');
  });
});
