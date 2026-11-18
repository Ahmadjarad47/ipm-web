import { HttpParams } from '@angular/common/http';
import { beforeEach, describe, expect, it } from 'vitest';
import { MockHttpError } from '../db/collection';
import { MockDatabase } from '../db/database';
import { registerAuthUserHandlers } from './handlers/auth-users.handlers';
import { registerConfigHandlers } from './handlers/config.handlers';
import { registerProjectHandlers } from './handlers/projects.handlers';
import { registerWorkItemHandlers } from './handlers/work-items.handlers';
import { Method, MockContext, MockRouter } from './router';

/** Regression tests for findings of the backend security review. */
describe('security hardening (mock API)', () => {
  let db: MockDatabase;
  let router: MockRouter;

  beforeEach(() => {
    db = new MockDatabase();
    router = new MockRouter();
    registerAuthUserHandlers(router, db);
    registerConfigHandlers(router, db);
    registerProjectHandlers(router, db);
    registerWorkItemHandlers(router, db);
  });

  async function call<T = unknown>(userId: string, method: Method, path: string, body: unknown = {}): Promise<T> {
    const match = router.match(method, path);
    if (!match) throw new Error(`no route ${method} ${path}`);
    return (await match.route.handler({ method, path, params: match.params, query: new HttpParams(), body }, new MockContext(db, userId))) as T;
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

  it('a client can never choose the id of a new record or overwrite an existing one', async () => {
    const victim = db.workItems.get('p-erp-wi-3');
    const created = await call<{ id: string }>('u-2', 'POST', 'work-items', {
      id: victim.id, projectId: 'p-erp', typeId: 't-task', title: 'محاولة استبدال', description: '', priority: 'low',
      assigneeIds: [], startDate: null, dueDate: null, parentId: null, fields: {},
    });
    expect(created.id).not.toBe(victim.id);
    expect(db.workItems.get(victim.id).title).toBe(victim.title); // untouched
    // the collection itself refuses to replace an existing row even for trusted callers
    expect(() => db.workItems.insert({ ...victim }, { id: victim.id })).toThrowError(MockHttpError);
  });

  it('a role editor cannot add permissions they do not hold themselves', async () => {
    // a limited role manager: has roles.manage but not settings.manage
    db.roles.insert({ key: 'roles_only', name: 'أدوار فقط', description: '', scope: 'system', permissions: ['roles.manage'], denied: [], builtIn: false }, { id: 'r-roles-only' });
    db.users.patch('u-5', { systemRoleIds: ['r-roles-only'] });
    const staff = db.roles.get('r-staff');
    expect(await status(() => call('u-5', 'PATCH', 'roles/r-staff', { permissions: [...staff.permissions, 'settings.manage'], version: staff.version }))).toBe(403);
    // unknown permission keys are rejected outright
    expect(await status(() => call('u-1', 'PATCH', 'roles/r-staff', { permissions: ['hack.everything'], version: staff.version }))).toBe(400);
    // removing a permission is fine
    expect(await status(() => call('u-5', 'PATCH', 'roles/r-staff', { permissions: [], version: staff.version }))).toBe(200);
  });

  it('role scope and builtIn flags can not be changed after creation', async () => {
    const pm = db.roles.get('r-pm');
    expect(await status(() => call('u-1', 'PATCH', 'roles/r-pm', { scope: 'system', version: pm.version }))).toBe(422);
    expect(await status(() => call('u-1', 'PATCH', 'roles/r-pm', { builtIn: false, version: pm.version }))).toBe(422);
  });

  it('the organisation always keeps one active user who can manage roles', async () => {
    const admin = db.roles.get('r-admin');
    const withoutManage = admin.permissions.filter((p) => p !== 'roles.manage');
    expect(await status(() => call('u-1', 'PATCH', 'roles/r-admin', { permissions: withoutManage, version: admin.version }))).toBe(422);
  });

  it('a lower administrator cannot reset, deactivate or re-role a more powerful account', async () => {
    db.roles.insert({ key: 'assigner', name: 'مفوّض', description: '', scope: 'system', permissions: ['permissions.assign'], denied: [], builtIn: false }, { id: 'r-assigner' });
    db.users.patch('u-5', { systemRoleIds: ['r-staff', 'r-assigner'] });
    const sara = db.users.get('u-1');
    expect(await status(() => call('u-5', 'POST', 'users/u-1/reset-password'))).toBe(403);
    expect(await status(() => call('u-5', 'PATCH', 'users/u-1', { active: false, version: sara.version }))).toBe(403);
    // the same account can still manage someone below them
    expect(await status(() => call('u-5', 'POST', 'users/u-6/reset-password'))).toBe(200);
  });

  it('reset links are unpredictable', async () => {
    const a = await call<{ link: string }>('u-1', 'POST', 'users/u-6/reset-password');
    const b = await call<{ link: string }>('u-1', 'POST', 'users/u-6/reset-password');
    expect(a.link).not.toBe(b.link);
    expect(a.link).toMatch(/\/reset\/[0-9a-f]{40}$/);
  });

  it('AT-17: a refused hierarchy change is itself audited', async () => {
    const feature = db.workItems.get('p-erp-wi-2');
    expect(await status(() => call('u-2', 'POST', 'work-items/p-erp-wi-2/parent', { parentId: 'p-erp-wi-6', version: feature.version }))).toBe(422);
    expect(db.audit.where((e) => e.action === 'workItem.parent_rejected' && e.subjectId === feature.id && e.security).length).toBe(1);
  });
});
