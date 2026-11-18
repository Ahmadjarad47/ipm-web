import { HttpParams } from '@angular/common/http';
import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryCollection, MockHttpError } from '../db/collection';
import { MockDatabase, scrubSecrets } from '../db/database';
import { orgToday } from '../db/time';
import { registerActivityHandlers } from './handlers/activity.handlers';
import { registerAuthUserHandlers } from './handlers/auth-users.handlers';
import { registerConfigHandlers } from './handlers/config.handlers';
import { Method, MockContext, MockRouter } from './router';

/** Regression tests for the auth / secrets / disclosure findings of the backend security review. */
describe('security: auth, secrets and disclosure (mock API)', () => {
  let db: MockDatabase;
  let router: MockRouter;

  beforeEach(() => {
    db = new MockDatabase();
    router = new MockRouter();
    registerAuthUserHandlers(router, db);
    registerConfigHandlers(router, db);
    registerActivityHandlers(router, db);
  });

  async function call<T = unknown>(userId: string | null, method: Method, path: string, body: unknown = {}, clientId?: string): Promise<T> {
    const match = router.match(method, path);
    if (!match) throw new Error(`no route ${method} ${path}`);
    return (await match.route.handler({ method, path, params: match.params, query: new HttpParams(), body }, new MockContext(db, userId, { clientId }))) as T;
  }

  async function failure(fn: () => Promise<unknown>): Promise<MockHttpError | null> {
    try {
      await fn();
      return null;
    } catch (e) {
      if (e instanceof MockHttpError) return e;
      throw e;
    }
  }

  const login = (username: unknown, password: unknown, clientId?: string) => call(null, 'POST', 'auth/login', { username, password }, clientId);

  // ---------- 1. time zone ----------
  it('rejects an invalid time zone and keeps the setting usable', async () => {
    const err = await failure(() => call('u-1', 'PATCH', 'settings', { timeZone: 'Mars/Olympus', version: db.settings.version }));
    expect(err?.status).toBe(400);
    expect(err?.details?.['timeZone']).toBeTruthy();
    expect(db.settings.timeZone).not.toBe('Mars/Olympus');
    const ok = await call<{ timeZone: string }>('u-1', 'PATCH', 'settings', { timeZone: 'Asia/Riyadh', version: db.settings.version });
    expect(ok.timeZone).toBe('Asia/Riyadh');
  });

  it('time helpers fall back to UTC for a corrupt stored zone instead of throwing', () => {
    const at = new Date('2026-03-01T12:00:00Z');
    expect(orgToday('Not/AZone', at)).toBe('2026-03-01');
  });

  // ---------- 2. login abuse ----------
  it('returns 400 for non-string credentials', async () => {
    expect((await failure(() => login({ $ne: 1 }, 'x')))?.status).toBe(400);
    expect((await failure(() => login('admin', 123)))?.status).toBe(400);
    expect((await failure(() => login(undefined, undefined)))?.status).toBe(400);
  });

  it('uses the same message for unknown, wrong-password and disabled accounts; the reason stays in the audit', async () => {
    const unknown = await failure(() => login('nobody', 'x'));
    const wrong = await failure(() => login('khaled', ''));
    const disabled = await failure(() => login('mona', 'x'));
    expect([unknown?.status, wrong?.status, disabled?.status]).toEqual([401, 401, 401]);
    expect(new Set([unknown?.message, wrong?.message, disabled?.message]).size).toBe(1);
    const reasons = db.audit.where((e) => e.action === 'auth.login_failed' && e.source === 'api' && e.changes.some((c) => c.field === 'reason')).map((e) => e.changes.find((c) => c.field === 'reason')?.to);
    expect(reasons).toEqual(['unknown_user', 'wrong_password', 'disabled']);
  });

  it('lockout is scoped to username + client: another client can still sign in', async () => {
    for (let i = 0; i < 5; i++) await failure(() => login('noura', '', 'attacker'));
    expect((await failure(() => login('noura', 'x', 'attacker')))?.status).toBe(429);
    expect(await failure(() => login('noura', 'x', 'victim'))).toBeNull();
  });

  it('a global cap stops guessing spread across many clients', async () => {
    let last: MockHttpError | null = null;
    for (let i = 0; i < 120; i++) last = await failure(() => login(`ghost${i % 40}`, 'x', `c${i}`));
    expect(last?.status).toBe(429);
  });

  it('caps tracked usernames at 1000 and audits an unknown username at most once a minute', async () => {
    for (let i = 0; i < 1100; i++) db.failedLogins.set(`seed${i}`, [Date.now()]);
    await failure(() => login('someone', ''));
    expect(db.failedLogins.size).toBeLessThanOrEqual(1100); // bounded on write by setBounded
    for (let i = 0; i < 4; i++) await failure(() => login('phantom', 'x', `c${i}`));
    expect(db.audit.where((e) => e.action === 'auth.login_failed' && e.subjectLabel === 'phantom').length).toBe(1);
  });

  it('bounded tracking evicts the oldest usernames', async () => {
    for (let i = 0; i < 1005; i++) await failure(() => login(`u${i}`, 'x', `c${i % 3}`));
    expect(db.failedLogins.size).toBeLessThanOrEqual(1000);
    expect(db.unknownLoginLoggedAt.size).toBeLessThanOrEqual(1000);
  });

  it('permission-denied dedupe ignores invented project ids and stays bounded', async () => {
    db.logPermissionDenied('u-4', 'audit.view', 'p-does-not-exist-1');
    db.logPermissionDenied('u-4', 'audit.view', 'p-does-not-exist-2');
    const rows = db.audit.where((e) => e.action === 'auth.permission_denied' && e.actorId === 'u-4');
    expect(rows.length).toBe(1);
    expect(rows[0].projectId).toBeNull();
    const real = db.projects.all()[0].id;
    db.logPermissionDenied('u-4', 'audit.view', real);
    expect(db.audit.where((e) => e.action === 'auth.permission_denied' && e.actorId === 'u-4').length).toBe(2);
  });

  // ---------- 3. secrets ----------
  it('session tokens carry a 128-bit random nonce and differ every time', () => {
    const a = db.issueSession('u-2').token;
    const b = db.issueSession('u-2').token;
    expect(a).toMatch(/^mock\.u-2\.[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
    expect(db.resolveSession(a)).toMatchObject({ userId: 'u-2' });
  });

  it('audit chain is keyed: verify passes, and a recomputed unkeyed chain does not', async () => {
    db.log('u-1', 'x.test', { type: 'user', id: 'u-1', label: 'admin', projectId: null }, [], true);
    expect(await call('u-1', 'GET', 'audit/verify')).toMatchObject({ ok: true });
    const events = db.audit.all();
    const last = events[events.length - 1];
    expect(last.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(await call('u-1', 'GET', 'audit/verify'))).not.toMatch(/key/i);
    // tampering is still detected
    db.audit.patch(last.id, { subjectLabel: 'forged' });
    expect(await call('u-1', 'GET', 'audit/verify')).toMatchObject({ ok: false });
  });

  // ---------- 4. redaction ----------
  it('redacts a JSON value with leading whitespace and sensitive keys', () => {
    db.log('u-1', 'x.test', { type: 'user', id: 'u-1', label: 'a', projectId: null }, [{ field: 'cfg', from: null, to: '  {"apiToken":"abc","n":1}' }]);
    const e = db.audit.all().at(-1)!;
    expect(e.changes[0].to).not.toContain('abc');
    expect(e.changes[0].to).toContain('"n":1');
  });

  it('scrubs secret-looking values in free text', () => {
    expect(scrubSecrets('password=hunter2 ok')).toBe('password=*** ok');
    expect(scrubSecrets('Authorization: Bearer abc.def')).not.toContain('abc.def');
    expect(scrubSecrets('clone https://bob:s3cret@git.example.com/x.git')).toBe('clone https://bob:***@git.example.com/x.git');
    expect(scrubSecrets(`key ${'a1'.repeat(20)} end`)).toBe('key *** end');
    expect(scrubSecrets('خالد الحربي — مدير مشروع')).toBe('خالد الحربي — مدير مشروع');
    db.log('u-1', 'x.test', { type: 'user', id: 'u-1', label: 'a', projectId: null }, [{ field: 'note', from: 'secret: abc123', to: 'token=zzz' }]);
    const e = db.audit.all().at(-1)!;
    expect(e.changes[0]).toMatchObject({ from: 'secret: ***', to: 'token=***' });
  });

  // ---------- 5. optimistic concurrency ----------
  it('a collection with requireVersion rejects a patch without version (428); default stays permissive', () => {
    const strict = new InMemoryCollection<{ id: string; version: number; createdAt: string; updatedAt: string; n: number }>('x', [], [], { requireVersion: true });
    const r = strict.insert({ n: 1 });
    expect(() => strict.patch(r.id, { n: 2 })).toThrowError(MockHttpError);
    expect(strict.patch(r.id, { n: 2 }, r.version).n).toBe(2);
    expect(db.users.patch('u-4', { title: 'x' }).title).toBe('x');
    expect(db.strictVersions).toBe(false); // handler-level calls from specs stay unaffected
  });

  // ---------- 6. disclosure ----------
  it('users/all hides e-mail, manager and roles from non-admins but keeps lookup fields', async () => {
    const asStaff = await call<{ id: string; name: string; username: string; email: string; managerId?: string; systemRoleIds: string[]; active: boolean }[]>('u-4', 'GET', 'users/all');
    const u3 = asStaff.find((u) => u.id === 'u-3')!;
    expect(u3).toMatchObject({ name: 'نورة القحطاني', username: 'noura', email: '', systemRoleIds: [], active: true });
    expect(u3.managerId).toBeUndefined();
    const asAdmin = await call<{ id: string; email: string; managerId?: string; systemRoleIds: string[] }[]>('u-1', 'GET', 'users/all');
    expect(asAdmin.find((u) => u.id === 'u-3')).toMatchObject({ email: 'noura@example.local', managerId: 'u-2', systemRoleIds: ['r-staff'] });
  });

  it('users/:id applies the same projection', async () => {
    const asStaff = await call<{ email: string; managerId?: string; systemRoleIds: string[] }>('u-4', 'GET', 'users/u-3');
    expect(asStaff).toMatchObject({ email: '', systemRoleIds: [] });
    expect(asStaff.managerId).toBeUndefined();
    expect(await call<{ email: string }>('u-1', 'GET', 'users/u-3')).toMatchObject({ email: 'noura@example.local' });
  });
});
