import { HttpHeaders, HttpParams } from '@angular/common/http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuditVerification, Comment, DashboardStats, NotificationPage } from '@domain/activity/activity.models';
import { AuthSession } from '@core/auth/auth.models';
import { MockHttpError } from '../db/collection';
import { MockDatabase } from '../db/database';
import { sha256 } from '../db/hash';
import { orgDayStartUtc, orgToday } from '../db/time';
import { registerActivityHandlers } from './handlers/activity.handlers';
import { registerAttachmentHandlers } from './handlers/attachments.handlers';
import { registerAuthUserHandlers } from './handlers/auth-users.handlers';
import { registerProjectHandlers } from './handlers/projects.handlers';
import { registerWorkItemHandlers } from './handlers/work-items.handlers';
import { Method, MockContext, MockRouter } from './router';

describe('Platform rules: sessions, login, users, audit, time zone, dashboard, files (mock API)', () => {
  let db: MockDatabase;
  let router: MockRouter;

  beforeEach(() => {
    db = new MockDatabase();
    router = new MockRouter();
    registerAuthUserHandlers(router, db);
    registerProjectHandlers(router, db);
    registerWorkItemHandlers(router, db);
    registerActivityHandlers(router, db);
    registerAttachmentHandlers(router, db);
  });

  afterEach(() => vi.useRealTimers());

  async function call<T = unknown>(userId: string | null, method: Method, path: string, body: unknown = {}, query = new HttpParams(), headers?: HttpHeaders): Promise<T> {
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

  const q = (params: Record<string, string>) => new HttpParams({ fromObject: params });

  function form(subjectId: string, file: File, subjectType = 'workItem'): FormData {
    const f = new FormData();
    f.append('subjectType', subjectType);
    f.append('subjectId', subjectId);
    f.append('file', file);
    return f;
  }

  // ---------- Sessions (FR-AUTH-01/06) ----------

  it('login issues a stored session; unknown and expired tokens are session_expired', async () => {
    const session = await call<AuthSession>(null, 'POST', 'auth/login', { username: 'khaled', password: 'x' });
    expect(session.token).toMatch(/^mock\.u-2\.[0-9a-f]+$/);
    expect(db.sessions.length).toBe(1);
    expect(db.resolveSession(session.token)).toMatchObject({ userId: 'u-2' });
    expect(db.resolveSession('mock.u-2.forged')).toEqual({ error: 'session_expired' });
    expect(db.resolveSession(null)).toEqual({ error: 'session_expired' });

    const hours = db.settings.sessionHours;
    expect(new Date(session.expiresAt).getTime() - Date.now()).toBeGreaterThan((hours - 0.01) * 3_600_000);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + (hours + 1) * 3_600_000);
    expect(db.resolveSession(session.token)).toEqual({ error: 'session_expired' });
  });

  it('logout revokes the token and is audited', async () => {
    const session = await call<AuthSession>(null, 'POST', 'auth/login', { username: 'khaled', password: 'x' });
    await call('u-2', 'POST', 'auth/logout', {}, new HttpParams(), new HttpHeaders({ Authorization: `Bearer ${session.token}` }));
    expect(db.resolveSession(session.token)).toEqual({ error: 'session_expired' });
    expect(db.audit.where((e) => e.action === 'auth.logout' && e.actorId === 'u-2').length).toBe(1);
  });

  it('deactivating a user revokes their sessions and the token reports account_disabled', async () => {
    const session = await call<AuthSession>(null, 'POST', 'auth/login', { username: 'noura', password: 'x' });
    const u3 = db.users.get('u-3');
    await call('u-1', 'PATCH', 'users/u-3', { active: false, version: u3.version });
    expect(db.sessions.find((s) => s.token === session.token)?.revoked).toBe(true);
    expect(db.resolveSession(session.token)).toEqual({ error: 'account_disabled' });
  });

  // ---------- Login hardening (FR-AUTH-05) ----------

  it('locks a username after 5 failures (429, minutes in message), logs reasons, clears on success', async () => {
    for (let i = 0; i < 5; i++) expect(await status(() => call(null, 'POST', 'auth/login', { username: 'reem', password: '' }))).toBe(401);
    // Even the right password is refused while locked.
    let message = '';
    try {
      await call(null, 'POST', 'auth/login', { username: 'reem', password: 'good' });
    } catch (e) {
      if (e instanceof MockHttpError) { expect(e.status).toBe(429); message = e.message; }
    }
    expect(message).toMatch(/\d+ دقيقة/);
    const failed = db.audit.where((e) => e.action === 'auth.login_failed' && e.changes.some((c) => c.to === 'reem'));
    expect(failed.length).toBe(6);
    expect(failed.every((e) => e.source === 'api' && e.security)).toBe(true);
    expect(failed[0].changes.find((c) => c.field === 'reason')?.to).toBe('wrong_password');
    expect(failed[5].changes.find((c) => c.field === 'reason')?.to).toBe('locked');

    // Counted per username only: another account is unaffected, and success clears the counter.
    expect(await status(() => call(null, 'POST', 'auth/login', { username: 'fahad', password: 'x' }))).toBe(200);
    for (let i = 0; i < 3; i++) await status(() => call(null, 'POST', 'auth/login', { username: 'noura', password: '' }));
    await call(null, 'POST', 'auth/login', { username: 'noura', password: 'x' });
    expect(db.failedLogins.has('noura')).toBe(false);
  });

  it('distinguishes unknown user, wrong password and disabled account in the security log', async () => {
    await status(() => call(null, 'POST', 'auth/login', { username: 'nobody', password: 'x' }));
    await status(() => call(null, 'POST', 'auth/login', { username: 'khaled', password: '' }));
    await status(() => call(null, 'POST', 'auth/login', { username: 'mona', password: 'x' }));
    const reasons = db.audit.where((e) => e.action === 'auth.login_failed').slice(-3)
      .map((e) => e.changes.find((c) => c.field === 'reason')?.to);
    expect(reasons).toEqual(['unknown_user', 'wrong_password', 'disabled']);
  });

  it('logs permission_denied once per identical event within 60 s', async () => {
    expect(await status(() => call('u-4', 'PATCH', 'users/u-5', { active: false, version: 1 }))).toBe(403);
    expect(await status(() => call('u-4', 'PATCH', 'users/u-5', { active: false, version: 1 }))).toBe(403);
    const denied = db.audit.where((e) => e.action === 'auth.permission_denied');
    expect(denied.length).toBe(1);
    expect(denied[0]).toMatchObject({ actorId: 'u-4', security: true });
    expect(denied[0].changes.map((c) => c.to)).toContain('permissions.assign');
  });

  // ---------- User management (FR-AUTH-02, §2.2) ----------

  it('refuses self-deactivation and deactivating the last role manager', async () => {
    expect(await status(() => call('u-1', 'PATCH', 'users/u-1', { active: false, version: db.users.get('u-1').version }))).toBe(422);
    // A delegate who can assign but not manage roles tries to remove the only role manager: refused, because
    // nobody may deactivate an account that holds more permissions than they do (privilege ceiling).
    db.roles.insert({ key: 'assigner', name: 'مفوّض', description: '', scope: 'system', permissions: ['permissions.assign'], denied: [], builtIn: false }, { id: 'r-assigner' });
    db.users.patch('u-3', { systemRoleIds: ['r-assigner'] });
    expect(await status(() => call('u-3', 'PATCH', 'users/u-1', { active: false, version: db.users.get('u-1').version }))).toBe(403);
    expect(db.users.get('u-1').active).toBe(true);
    // An equally powerful second administrator may deactivate the first.
    db.users.patch('u-2', { systemRoleIds: ['r-admin'] });
    expect(await status(() => call('u-2', 'PATCH', 'users/u-1', { active: false, version: db.users.get('u-1').version }))).toBe(200);
  });

  it('PATCH users edits profile fields with validation and field-diff audit', async () => {
    expect(await status(() => call('u-1', 'PATCH', 'users/u-4', { email: 'bad', version: 1 }))).toBe(400);
    await call('u-1', 'PATCH', 'users/u-4', { name: 'فهد الجديد', title: 'قائد فريق', version: db.users.get('u-4').version });
    const event = db.audit.where((e) => e.action === 'user.updated')[0];
    expect(event.changes.map((c) => c.field)).toEqual(['الاسم', 'المسمى الوظيفي']);
  });

  it('reset-password returns a link, revokes sessions and never records a password', async () => {
    const session = await call<AuthSession>(null, 'POST', 'auth/login', { username: 'fahad', password: 'topsecret' });
    const result = await call<{ link: string; expiresAt: string }>('u-1', 'POST', 'users/u-4/reset-password');
    expect(result.link).toMatch(/^https:\/\/ipm\.example\.local\/reset\/[0-9a-f]{40}$/);
    expect(db.resolveSession(session.token)).toEqual({ error: 'session_expired' });
    expect(JSON.stringify(db.audit.all())).not.toContain('topsecret');
    expect(JSON.stringify(db.audit.all())).not.toContain(result.link.split('/').pop());
    expect(db.audit.where((e) => e.action === 'user.password_reset_requested').length).toBe(1);
    expect(await status(() => call('u-4', 'POST', 'users/u-5/reset-password'))).toBe(403);
  });

  it('e-mail addresses are returned only to holders of roles.manage; creation needs both permissions', async () => {
    const forAdmin = await call<{ email: string }[]>('u-1', 'GET', 'users/all');
    const forMember = await call<{ email: string }[]>('u-4', 'GET', 'users/all');
    expect(forAdmin.every((u) => u.email)).toBe(true);
    expect(forMember.every((u) => u.email === '')).toBe(true);
    expect((await call<{ email: string }>('u-4', 'GET', 'users/u-5')).email).toBe('');
    expect((await call<{ email: string }>('u-1', 'GET', 'users/u-5')).email).toBe('reem@example.local');

    const dto = { username: 'newbie', name: 'جديد', email: 'n@example.local', title: '', systemRoleIds: [] };
    db.roles.insert({ key: 'roles_only', name: 'أدوار فقط', description: '', scope: 'system', permissions: ['roles.manage'], denied: [], builtIn: false }, { id: 'r-roles' });
    db.users.patch('u-3', { systemRoleIds: ['r-roles'] });
    expect(await status(() => call('u-3', 'POST', 'users', dto))).toBe(403);
    expect(await status(() => call('u-1', 'POST', 'users', dto))).toBe(200);
  });

  // ---------- Audit core (FR-AUD) ----------

  it('stamps source and correlation id from the request context', async () => {
    const ctx = new MockContext(db, 'u-5', { source: 'api', correlationId: 'corr-abc' });
    db.log(ctx.me, 'x.test', { type: 'user', id: 'u-5', label: 'reem', projectId: null });
    expect(db.audit.all().at(-1)).toMatchObject({ source: 'api', correlationId: 'corr-abc' });
    db.log('system', 'x.test2', { type: 'git', id: 'r', label: 'r', projectId: null }, [], false, { source: 'webhook' });
    expect(db.audit.all().at(-1)?.source).toBe('webhook');
  });

  it('redacts sensitive fields and JSON keys centrally', () => {
    db.log('u-1', 'git.connected', { type: 'git', id: 'r1', label: 'repo', projectId: null }, [
      { field: 'Webhook Secret', from: 'old-value', to: 'new-value' },
      { field: 'الإعدادات', from: null, to: JSON.stringify({ url: 'https://x', accessToken: 'abc', nested: { password: 'p' } }) },
      { field: 'الاسم', from: 'a', to: 'b' },
    ]);
    const e = db.audit.all().at(-1)!;
    expect(e.changes[0]).toEqual({ field: 'Webhook Secret', from: '***', to: '***' });
    expect(JSON.parse(e.changes[1].to ?? '{}')).toEqual({ url: 'https://x', accessToken: '***', nested: { password: '***' } });
    expect(e.changes[2]).toEqual({ field: 'الاسم', from: 'a', to: 'b' });
  });

  it('hash chain: verify passes, and detects a tampered event', async () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    await call('u-1', 'POST', 'auth/logout');
    const ok = await call<AuditVerification>('u-1', 'GET', 'audit/verify');
    expect(ok).toMatchObject({ ok: true });
    expect(ok.checked).toBe(db.audit.all().length);
    expect(await status(() => call('u-4', 'GET', 'audit/verify'))).toBe(403);

    const victim = db.audit.all()[3];
    db.audit.patch(victim.id, { actorId: 'u-6' });
    const broken = await call<AuditVerification>('u-1', 'GET', 'audit/verify');
    expect(broken).toMatchObject({ ok: false, brokenAt: victim.id, checked: 4 });
  });

  it('audit list filters by subjectId, correlationId and free text over label and action', async () => {
    db.log('u-1', 'workItem.updated', { type: 'workItem', id: 'wi-x', label: 'ERP-999', projectId: 'p-erp' }, [], false, { correlationId: 'corr-find-me' });
    const bySubject = await call<{ items: { subjectId: string }[] }>('u-1', 'GET', 'audit', {}, q({ 'filter.subjectId': 'wi-x' }));
    expect(bySubject.items.map((e) => e.subjectId)).toEqual(['wi-x']);
    const byCorr = await call<{ total: number }>('u-1', 'GET', 'audit', {}, q({ 'filter.correlationId': 'corr-find-me' }));
    expect(byCorr.total).toBe(1);
    expect((await call<{ total: number }>('u-1', 'GET', 'audit', {}, q({ search: 'ERP-999' }))).total).toBe(1);
    expect((await call<{ total: number }>('u-1', 'GET', 'audit', {}, q({ search: 'workItem.updated' }))).total).toBe(1);
  });

  it('comment edit/delete audit uses the real subject type and project', async () => {
    const c = await call<Comment>('u-5', 'POST', 'comments', { subjectType: 'project', subjectId: 'p-erp', body: 'مرحبا' });
    await call('u-5', 'PATCH', `comments/${c.id}`, { body: 'معدّل', version: c.version });
    await call('u-5', 'DELETE', `comments/${c.id}`);
    const events = db.audit.where((e) => e.action === 'comment.edited' || e.action === 'comment.deleted');
    expect(events.length).toBe(2);
    expect(events.every((e) => e.subjectType === 'project' && e.projectId === 'p-erp' && e.subjectId === 'p-erp')).toBe(true);
  });

  // ---------- Comments & notifications ----------

  it('keeps comment revisions (first = original) and exposes them to viewers', async () => {
    const c = await call<Comment>('u-5', 'POST', 'comments', { subjectType: 'workItem', subjectId: 'p-erp-wi-4', body: 'الأول' });
    const edited = await call<Comment>('u-5', 'PATCH', `comments/${c.id}`, { body: 'الثاني', version: c.version });
    await call('u-5', 'PATCH', `comments/${c.id}`, { body: 'الثالث', version: edited.version });
    const revisions = await call<{ body: string }[]>('u-4', 'GET', `comments/${c.id}/revisions`);
    expect(revisions.map((r) => r.body)).toEqual(['الأول', 'الثاني', 'الثالث']);
    expect(await status(() => call('u-7', 'GET', `comments/${c.id}/revisions`))).toBe(404);
  });

  it('pages notifications with an unread count', async () => {
    for (let i = 0; i < 35; i++) db.notify(['u-4'], `n${i}`, 'b', '/x');
    const first = await call<NotificationPage>('u-4', 'GET', 'notifications/all');
    expect(first.pageSize).toBe(30);
    expect(first.items.length).toBe(30);
    expect(first.total).toBeGreaterThanOrEqual(35);
    expect(first.unread).toBe(db.notifications.where((n) => n.userId === 'u-4' && !n.read).length);
    const second = await call<NotificationPage>('u-4', 'GET', 'notifications/all', {}, q({ page: '2' }));
    expect(second.items.length).toBe(first.total - 30);
  });

  it('rejects comment and attachment writes on an archived project (422)', async () => {
    const c = await call<Comment>('u-5', 'POST', 'comments', { subjectType: 'workItem', subjectId: 'p-erp-wi-4', body: 'قبل الأرشفة' });
    db.projects.patch('p-erp', { archived: true });
    expect(await status(() => call('u-5', 'POST', 'comments', { subjectType: 'workItem', subjectId: 'p-erp-wi-4', body: 'بعد' }))).toBe(422);
    expect(await status(() => call('u-5', 'PATCH', `comments/${c.id}`, { body: 'تعديل', version: c.version }))).toBe(422);
    expect(await status(() => call('u-5', 'DELETE', `comments/${c.id}`))).toBe(422);
    const pdf = new File([new TextEncoder().encode('%PDF-1.4 x')], 'a.pdf');
    expect(await status(() => call('u-4', 'POST', 'attachments', form('p-erp-wi-4', pdf)))).toBe(422);
  });

  // ---------- Time zone (NFR-10, §6.3) ----------

  it('orgToday / orgDayStartUtc follow the organisation zone', () => {
    const instant = new Date('2026-05-01T22:00:00Z');
    expect(orgToday('UTC', instant)).toBe('2026-05-01');
    expect(orgToday('Asia/Riyadh', instant)).toBe('2026-05-02');
    expect(orgToday('America/Los_Angeles', instant)).toBe('2026-05-01');
    expect(orgDayStartUtc('Asia/Riyadh', '2026-05-02').toISOString()).toBe('2026-05-01T21:00:00.000Z');
    expect(orgDayStartUtc('America/Los_Angeles', '2026-05-01').toISOString()).toBe('2026-05-01T07:00:00.000Z');
  });

  it('overdue is decided against today in the org zone', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-05-01T22:00:00Z')); // already May 2nd in Riyadh
    const template = db.workItems.get('p-erp-wi-4');
    db.workItems.insert({ ...template, ref: 'ERP-777', title: 'tz', dueDate: '2026-05-01', startDate: '2026-04-01', statusId: db.statuses.where((s) => s.category === 'Active')[0].id, parentId: null, assigneeIds: [] });
    const overdue = async () => (await call<DashboardStats>('u-1', 'GET', 'dashboard/stats', {}, q({ projectId: 'p-erp' }))).overdueWorkItems;
    db.settingsTable.patch('settings', { timeZone: 'America/Los_Angeles' });
    const inLosAngeles = await overdue();
    db.settingsTable.patch('settings', { timeZone: 'Asia/Riyadh' });
    expect(await overdue()).toBe(inLosAngeles + 1);
  });

  // ---------- Dashboard (§6.3) ----------

  it('dashboard filters by category, assignee and period overlap; leaf-only byType', async () => {
    const stats = (params: Record<string, string>) => call<DashboardStats>('u-1', 'GET', 'dashboard/stats', {}, q(params));
    const all = await stats({ projectId: 'p-erp' });
    expect(Object.values(all.byCategory).reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
    expect(Object.values(all.leafByCategory).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(Object.values(all.byCategory).reduce((a, b) => a + b, 0));

    const doneOnly = await stats({ projectId: 'p-erp', statusCategory: 'Done' });
    expect(Object.entries(doneOnly.byCategory).filter(([k]) => k !== 'Done').every(([, v]) => v === 0)).toBe(true);
    expect(doneOnly.byCategory['Done']).toBe(all.byCategory['Done']);

    const mine = await stats({ projectId: 'p-erp', assigneeId: 'u-4' });
    const expected = db.workItems.where((w) => w.projectId === 'p-erp' && !w.archived && w.assigneeIds.includes('u-4')).length;
    expect(Object.values(mine.byCategory).reduce((a, b) => a + b, 0)).toBe(expected);

    // Period overlap: an item spanning the whole window is in; a window far in the future is empty.
    const none = await stats({ projectId: 'p-erp', from: '2099-01-01', to: '2099-12-31' });
    expect(Object.values(none.byCategory).reduce((a, b) => a + b, 0)).toBe(0);
    const wide = await stats({ projectId: 'p-erp', from: '2000-01-01', to: '2099-12-31' });
    expect(wide.byCategory).toEqual(all.byCategory);

    for (const t of all.byType) {
      expect(t.byCategory['Cancelled']).toBe(0);
      expect(Object.values(t.byCategory).reduce((a, b) => a + b, 0)).toBe(t.total);
      expect(t.done).toBe(t.byCategory['Done']);
    }
  });

  it('dependencies: blocked = open target of a blocks link with an open source', async () => {
    const stats = () => call<DashboardStats>('u-1', 'GET', 'dashboard/stats', {}, q({ projectId: 'p-erp' }));
    const before = await stats();
    expect(before.blockedItems).toBe(before.dependencies.blockedItems);
    const done = db.statuses.where((s) => s.category === 'Done')[0].id;
    // Closing the blocking source (ERP-105) unblocks its target.
    db.workItems.patch('p-erp-wi-5', { statusId: done });
    const after = await stats();
    expect(after.dependencies.blockedItems).toBeLessThan(before.dependencies.blockedItems);
    expect(after.dependencies.itemsWithOpenDependencyPct).toBeGreaterThanOrEqual(0);
  });

  it('gitActivity counts only events the caller may see (git.view) inside the period', async () => {
    const withGit = await call<DashboardStats>('u-1', 'GET', 'dashboard/stats', {}, q({}));
    expect(withGit.gitActivity).toBe(db.gitEvents.all().length);
    const future = await call<DashboardStats>('u-1', 'GET', 'dashboard/stats', {}, q({ from: '2099-01-01' }));
    expect(future.gitActivity).toBe(0);
    const stranger = await call<DashboardStats>('u-6', 'GET', 'dashboard/stats', {}, q({}));
    expect(stranger.gitActivity).toBeLessThanOrEqual(withGit.gitActivity);
  });

  // ---------- Attachments (FR-COL-05) ----------

  it('rejects content that does not match the extension, accepts a real one', async () => {
    const fake = new File(['not really a pdf'], 'x.pdf');
    let message = '';
    try {
      await call('u-4', 'POST', 'attachments', form('p-erp-wi-4', fake));
    } catch (e) {
      if (e instanceof MockHttpError) { expect(e.status).toBe(422); message = e.message; }
    }
    expect(message).toBe('محتوى الملف لا يطابق امتداده.');
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])], 'p.png');
    const jpg = new File([new Uint8Array([0xff, 0xd8, 0xff, 1])], 'p.jpg');
    const gif = new File([new TextEncoder().encode('GIF89a..')], 'p.gif');
    const docx = new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 9])], 'p.docx');
    for (const f of [png, jpg, gif, docx]) expect(await status(() => call('u-4', 'POST', 'attachments', form('p-erp-wi-4', f)))).toBe(200);
    expect(await status(() => call('u-4', 'POST', 'attachments', form('p-erp-wi-4', new File([new Uint8Array([1, 2, 3, 4])], 'bad.png'))))).toBe(422);
    expect(await status(() => call('u-4', 'POST', 'attachments', form('p-erp-wi-4', new File(['plain'], 'ok.txt'))))).toBe(200);
  });

  it('records sha256 and rejects an identical file on the same subject (409)', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.4 same');
    const first = await call<{ sha256: string }>('u-4', 'POST', 'attachments', form('p-erp-wi-4', new File([bytes], 'one.pdf')));
    expect(first.sha256).toBe(sha256(bytes));
    expect(await status(() => call('u-4', 'POST', 'attachments', form('p-erp-wi-4', new File([bytes], 'two.pdf'))))).toBe(409);
    // Another subject may hold the same content.
    expect(await status(() => call('u-4', 'POST', 'attachments', form('p-erp-wi-3', new File([bytes], 'two.pdf'))))).toBe(200);
  });
});
