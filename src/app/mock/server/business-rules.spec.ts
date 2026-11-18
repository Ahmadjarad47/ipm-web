import { HttpParams } from '@angular/common/http';
import { beforeEach, describe, expect, it } from 'vitest';
import { MockHttpError } from '../db/collection';
import { MockDatabase } from '../db/database';
import { registerActivityHandlers } from './handlers/activity.handlers';
import { registerApprovalHandlers } from './handlers/approvals.handlers';
import { registerAuthUserHandlers } from './handlers/auth-users.handlers';
import { registerConfigHandlers } from './handlers/config.handlers';
import { registerProjectHandlers } from './handlers/projects.handlers';
import { registerWorkItemHandlers } from './handlers/work-items.handlers';
import { Method, MockContext, MockRouter } from './router';

/**
 * Acceptance scenarios from SRS §8 exercised against the mock API.
 * The same cases must pass against the real ASP.NET Core API.
 */
describe('SRS acceptance rules (mock API)', () => {
  let db: MockDatabase;
  let router: MockRouter;

  beforeEach(() => {
    db = new MockDatabase();
    router = new MockRouter();
    registerAuthUserHandlers(router, db);
    registerConfigHandlers(router, db);
    registerProjectHandlers(router, db);
    registerWorkItemHandlers(router, db);
    registerApprovalHandlers(router, db);
    registerActivityHandlers(router, db);
  });

  function call<T = unknown>(userId: string, method: Method, path: string, body: unknown = {}, query = new HttpParams()): T {
    const match = router.match(method, path);
    if (!match) throw new Error(`no route ${method} ${path}`);
    return match.route.handler({ method, path, params: match.params, query, body }, new MockContext(db, userId)) as T;
  }

  function status(fn: () => unknown): number {
    try {
      fn();
      return 200;
    } catch (e) {
      if (e instanceof MockHttpError) return e.status;
      throw e;
    }
  }

  const version = (id: string) => db.workItems.get(id).version;

  it('AT-01: a non-member opening a project link gets 404 without data', () => {
    // fahad (u-4) is not a member of SSP
    expect(status(() => call('u-4', 'GET', 'projects/p-ssp'))).toBe(404);
  });

  it('AT-04: a viewer cannot change status even through the API', () => {
    // abdullah (u-6) is a viewer on ERP
    const id = 'p-erp-wi-12';
    expect(status(() => call('u-6', 'POST', `work-items/${id}/transition`, { toStatusId: 's-progress', version: version(id) }))).toBe(403);
  });

  it('FR-WF-05: an undefined transition is rejected with a reason', () => {
    const id = 'p-erp-wi-8'; // pending → completed is not defined
    expect(status(() => call('u-2', 'POST', `work-items/${id}/transition`, { toStatusId: 's-completed', version: version(id) }))).toBe(422);
  });

  it('FR-REL-08: closing an item blocked by an open dependency is rejected', () => {
    const id = 'p-erp-wi-4'; // blocked by ERP-105 (in review)
    call('u-2', 'POST', `work-items/${id}/transition`, { toStatusId: 's-review', version: version(id) });
    expect(status(() => call('u-2', 'POST', `work-items/${id}/transition`, { toStatusId: 's-completed', version: version(id) }))).toBe(422);
  });

  it('AT-17: making a feature a child of its own grandchild is rejected', () => {
    // ERP-102 (feature) → ERP-104 (task) → ERP-106 (subtask)
    const id = 'p-erp-wi-2';
    expect(status(() => call('u-2', 'POST', `work-items/${id}/parent`, { parentId: 'p-erp-wi-6', version: version(id) }))).toBe(422);
    expect(db.workItems.get(id).parentId).toBe('p-erp-wi-1');
  });

  it('AT-18: A blocks B, B blocks C, then C blocks A is rejected', () => {
    const [a, b, c] = ['p-erp-wi-10', 'p-erp-wi-11', 'p-erp-wi-12'];
    call('u-2', 'POST', 'relations', { sourceId: a, targetId: b, relationTypeId: 'rt-blocks' });
    call('u-2', 'POST', 'relations', { sourceId: b, targetId: c, relationTypeId: 'rt-blocks' });
    expect(status(() => call('u-2', 'POST', 'relations', { sourceId: c, targetId: a, relationTypeId: 'rt-blocks' }))).toBe(422);
  });

  it('FR-REL-02/05: self links and duplicates are rejected', () => {
    expect(status(() => call('u-2', 'POST', 'relations', { sourceId: 'p-erp-wi-3', targetId: 'p-erp-wi-3', relationTypeId: 'rt-relates' }))).toBe(422);
    expect(status(() => call('u-2', 'POST', 'relations', { sourceId: 'p-erp-wi-9', targetId: 'p-erp-wi-8', relationTypeId: 'rt-blocks' }))).toBe(422);
  });

  it('AT-19: editing rights alone do not allow creating relations', () => {
    // A viewer has no workitem.relations.create
    expect(status(() => call('u-6', 'POST', 'relations', { sourceId: 'p-erp-wi-3', targetId: 'p-erp-wi-7', relationTypeId: 'rt-relates' }))).toBe(403);
  });

  it('AT-05/06: three sequential stages; the requester cannot approve; rejection stops the flow', () => {
    const request = call<{ id: string; revision: number }>('u-4', 'POST', 'approvals', { templateId: 'tpl-project', subjectType: 'project', subjectId: 'p-erp' });
    // stage 2 approver (project manager role) cannot jump ahead of stage 1
    expect(status(() => call('u-2', 'POST', `approvals/${request.id}/decide`, { decision: 'Approve', comment: '', revision: 1 }))).toBe(403);
    call('u-3', 'POST', `approvals/${request.id}/decide`, { decision: 'Approve', comment: '', revision: 1 });
    expect(db.approvals.get(request.id).currentStage).toBe(2);
    // rejection needs a reason
    expect(status(() => call('u-2', 'POST', `approvals/${request.id}/decide`, { decision: 'Reject', comment: ' ', revision: 1 }))).toBe(400);
    call('u-2', 'POST', `approvals/${request.id}/decide`, { decision: 'Reject', comment: 'التواريخ غير واقعية', revision: 1 });
    expect(db.approvals.get(request.id).status).toBe('Rejected');
  });

  it('FR-APR-06: a user cannot approve their own request', () => {
    // tpl-close stage 1 is the project-manager role, which the requester (khaled) holds on ERP.
    const request = call<{ id: string }>('u-2', 'POST', 'approvals', { templateId: 'tpl-close', subjectType: 'project', subjectId: 'p-erp' });
    expect(status(() => call('u-2', 'POST', `approvals/${request.id}/decide`, { decision: 'Approve', comment: '', revision: 1 }))).toBe(403);
    expect(db.approvals.get(request.id).currentStage).toBe(1);
  });

  it('AT-07/20: changing a protected field supersedes the pending revision; late decisions are refused', () => {
    // apr-2 protects title/dueDate/parentId of ERP-103
    const id = 'p-erp-wi-3';
    call('u-2', 'PATCH', `work-items/${id}`, { title: 'عنوان معدل', version: version(id) });
    expect(db.approvals.get('apr-2').status).toBe('Superseded');
    expect(status(() => call('u-2', 'POST', 'approvals/apr-2/decide', { decision: 'Approve', comment: '', revision: 1 }))).toBe(409);
  });

  it('AT-11: a role granted in one project does not apply to another', () => {
    expect(db.can('u-5', 'tasks.create', 'p-ssp')).toBe(true);
    expect(db.can('u-5', 'tasks.create', 'p-bi')).toBe(false);
  });

  it('AT-14: an archived project keeps its records but blocks edits', () => {
    const p = db.projects.get('p-mail');
    expect(call<{ id: string }>('u-2', 'GET', 'projects/p-mail').id).toBe('p-mail');
    expect(status(() => call('u-2', 'PATCH', 'projects/p-mail', { description: 'x', version: p.version }))).toBe(422);
  });

  it('AT-16: renaming a type keeps its immutable key', () => {
    const t = db.types.get('t-feature');
    call('u-1', 'PATCH', 'work-item-types/t-feature', { name: 'قدرة', version: t.version });
    expect(db.types.get('t-feature').key).toBe('feature');
    expect(status(() => call('u-1', 'PATCH', 'work-item-types/t-feature', { key: 'capability', version: db.types.get('t-feature').version }))).toBe(422);
  });

  it('AT-21: converting a bug to a feature with missing required fields reports conflicts and refuses', () => {
    const id = 'p-erp-wi-10'; // bug with severity; feature needs business_value
    const conflicts = call<{ field: string }[]>('u-1', 'POST', `work-items/${id}/type-change/check`, { typeId: 't-feature' });
    expect(conflicts.some((c) => c.field === 'business_value')).toBe(true);
    expect(status(() => call('u-1', 'POST', `work-items/${id}/type-change`, { typeId: 't-feature', version: version(id) }))).toBe(422);
    expect(db.workItems.get(id).typeId).toBe('t-bug');
  });

  it('AT-22: progress counts leaves only, without double counting the parent', () => {
    // SSP: feature SSP-101 has children 102 (done), 103 (active), 104 (pending); SSP-105 leaf pending → 1/4
    const p = call<{ progress: { percent: number; countedLeaves: number } }>('u-2', 'GET', 'projects/p-ssp');
    expect(p.progress.countedLeaves).toBe(4);
    expect(p.progress.percent).toBe(25);
  });

  it('FR-REL-13: a stale version is rejected with 409', () => {
    const id = 'p-erp-wi-7';
    const stale = version(id);
    call('u-2', 'PATCH', `work-items/${id}`, { description: 'تحديث 1', version: stale });
    expect(status(() => call('u-2', 'PATCH', `work-items/${id}`, { description: 'تحديث 2', version: stale }))).toBe(409);
  });
});
