import { AuthSession, LoginRequest } from '@core/auth/auth.models';
import { PermissionKey } from '@core/auth/permissions';
import { FieldChange } from '@domain/activity/activity.models';
import { User } from '@domain/users/user.models';
import { UserCreate } from '@domain/users/user.api';
import { Session, MockDatabase, setBounded } from '../../db/database';
import { body, fail, MockRouter, parseListQuery } from '../router';

/** FR-AUTH-05: a username is locked after this many failures inside the window. */
const MAX_FAILED_LOGINS = 5;
const MAX_GLOBAL_FAILED_LOGINS = 100;
const LOCKOUT_WINDOW_MS = 15 * 60_000;
const RESET_LINK_HOURS = 24;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function buildSession(db: MockDatabase, user: User, session: Session): AuthSession {
  const system = db.systemPermissions(user.id);
  const projectPermissions: Record<string, PermissionKey[]> = {};
  for (const project of db.projects.all()) {
    const grants = db.projectPermissions(user.id, project.id);
    if (grants.size) projectPermissions[project.id] = [...grants];
  }
  return {
    token: session.token,
    // FR-AUTH-06: session length comes from the organisation settings and is enforced by the session table.
    expiresAt: session.expiresAt,
    user: { id: user.id, name: user.name, email: user.email, title: user.title },
    systemPermissions: [...system.grants],
    projectPermissions,
    denied: [...system.denied],
  };
}

/** Active users who can manage roles; the organisation must always keep at least one (§2.2). */
function activeRoleManagers(db: MockDatabase): User[] {
  return db.users.where((u) => {
    if (!u.active) return false;
    const { grants, denied } = db.systemPermissions(u.id);
    return grants.has('roles.manage') && !denied.has('roles.manage');
  });
}

/** Unpredictable hex token from the platform CSPRNG (never derived from ids, time or log length). */
function randomToken(bytes = 20): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Privilege ceiling for acting ON another account (reset password, deactivate, change roles):
 * the caller must hold every permission the target holds. Otherwise a lower administrator could
 * take over, or lock out, a more powerful one.
 */
function assertOutranks(db: MockDatabase, callerId: string, targetId: string): void {
  if (callerId === targetId) return;
  const caller = db.systemPermissions(callerId).grants;
  const target = db.systemPermissions(targetId).grants;
  const above = [...target].filter((p) => !caller.has(p));
  if (above.length) fail(403, 'لا يمكنك تنفيذ هذا الإجراء على حساب يملك صلاحيات أعلى من صلاحياتك.');
}

function rolesGrantManage(db: MockDatabase, roleIds: readonly string[]): boolean {
  const roles = roleIds.map((id) => db.roles.get(id));
  return roles.some((r) => r.permissions.includes('roles.manage')) && !roles.some((r) => r.denied.includes('roles.manage'));
}

/** Directory view for callers without roles.manage: no e-mail, reporting line or role assignment. */
function publicUser(u: User): User {
  return { ...u, email: '', managerId: undefined, systemRoleIds: [] };
}

function minutesLeft(timestamps: readonly number[]): number {
  return Math.max(1, Math.ceil((Math.min(...timestamps) + LOCKOUT_WINDOW_MS - Date.now()) / 60_000));
}

function bearer(headers: { get(name: string): string | null } | undefined): string | null {
  return headers?.get('Authorization')?.replace(/^Bearer /, '') ?? null;
}

export function registerAuthUserHandlers(router: MockRouter, db: MockDatabase): void {
  router.post(
    'auth/login',
    (req, ctx) => {
      const raw = body<Partial<LoginRequest>>(req);
      if (typeof raw.username !== 'string' || typeof raw.password !== 'string') {
        fail(400, 'اسم المستخدم وكلمة المرور مطلوبان.', { username: 'نص مطلوب', password: 'نص مطلوب' });
      }
      const { password } = raw;
      const name = raw.username.trim().toLowerCase().slice(0, 64);
      const user = db.users.where((u) => u.username === name)[0];

      // Counted per username + client (X-Client-Id when sent), so a stranger cannot lock someone else out;
      // a global cap still bounds distributed guessing.
      const key = ctx.clientId ? `${name}|${ctx.clientId}` : name;
      const now = Date.now();
      const recent = (db.failedLogins.get(key) ?? []).filter((t) => now - t < LOCKOUT_WINDOW_MS).slice(-MAX_FAILED_LOGINS);
      setBounded(db.failedLogins, key, recent);
      let globalFailures = 0;
      for (const times of db.failedLogins.values()) globalFailures += times.filter((t) => now - t < LOCKOUT_WINDOW_MS).length;

      const logFailure = (reason: 'unknown_user' | 'wrong_password' | 'disabled' | 'locked'): void => {
        if (!user) {
          // Unknown names are attacker-controlled: audit each at most once a minute, and track at most 1000 of them.
          const last = db.unknownLoginLoggedAt.get(name);
          if (last !== undefined && now - last < 60_000) return;
          setBounded(db.unknownLoginLoggedAt, name, now);
        }
        db.log(user?.id ?? 'anonymous', 'auth.login_failed', { type: 'user', id: user?.id ?? '-', label: name, projectId: null }, [
          { field: 'username', from: null, to: name },
          { field: 'reason', from: null, to: reason },
        ], true, { source: 'api' });
      };

      if (recent.length >= MAX_FAILED_LOGINS || globalFailures >= MAX_GLOBAL_FAILED_LOGINS) {
        logFailure('locked');
        fail(429, `تم قفل الدخول مؤقتًا بسبب محاولات فاشلة متكررة. أعد المحاولة بعد ${minutesLeft(recent.length ? recent : [now])} دقيقة.`);
      }

      // Demo backend: any non-empty password is accepted for an active seeded account.
      const reason = !user ? 'unknown_user' : !password ? 'wrong_password' : !user.active ? 'disabled' : null;
      if (reason || !user) {
        recent.push(now);
        logFailure(reason ?? 'unknown_user');
        // One message for every cause: the response never reveals whether the account exists or is disabled.
        fail(401, 'اسم المستخدم أو كلمة المرور غير صحيحة.');
      }

      db.failedLogins.delete(key);
      db.log(user.id, 'auth.login', { type: 'user', id: user.id, label: user.username, projectId: null }, [], true);
      return buildSession(db, user, db.issueSession(user.id));
    },
    true,
  );

  router
    .post('auth/logout', (req, ctx) => {
      const token = bearer(req.headers);
      const session = db.sessions.find((s) => s.token === token && s.userId === ctx.me);
      if (session) session.revoked = true;
      const user = db.users.get(ctx.me);
      db.log(ctx.me, 'auth.logout', { type: 'user', id: user.id, label: user.username, projectId: null }, [], true);
      return null;
    })
    .get('auth/me', (req, ctx) => {
      const session = db.sessions.find((s) => s.token === bearer(req.headers) && s.userId === ctx.me) ?? db.issueSession(ctx.me);
      return buildSession(db, db.users.get(ctx.me), session);
    })
    // FR-AUTH-02 / privacy: e-mail addresses are visible only to role administrators.
    .get('users/all', (_req, ctx) => {
      const admin = ctx.can('roles.manage');
      return db.users.all().map((u) => (admin ? u : publicUser(u)));
    })
    .get('users', (req, ctx) => {
      ctx.require('roles.manage');
      return db.users.query(parseListQuery(req.query));
    })
    .get('users/:id', (req, ctx) => {
      const user = db.users.get(req.params['id']);
      return ctx.can('roles.manage') ? user : publicUser(user);
    })
    .post('users', (req, ctx) => {
      ctx.require('permissions.assign');
      ctx.require('roles.manage');
      const dto = body<UserCreate>(req);
      const username = dto.username?.trim().toLowerCase();
      const errors: Record<string, string> = {};
      if (!username || !/^[a-z][a-z0-9._-]{2,30}$/.test(username)) errors['username'] = 'أحرف إنجليزية صغيرة وأرقام (3–31)';
      else if (db.users.where((u) => u.username === username).length) errors['username'] = 'اسم المستخدم مستخدم';
      if (!dto.name?.trim()) errors['name'] = 'مطلوب';
      if (!EMAIL_PATTERN.test(dto.email ?? '')) errors['email'] = 'بريد غير صالح';
      if (Object.keys(errors).length) fail(400, 'بيانات المستخدم غير صالحة.', errors);
      // Prevent privilege escalation: only roles whose permissions the admin holds can be granted.
      const grantable = db.systemPermissions(ctx.me).grants;
      for (const roleId of dto.systemRoleIds ?? []) {
        const role = db.roles.get(roleId);
        if (role.permissions.some((p) => !grantable.has(p))) fail(403, `لا تملك حق تفويض الدور «${role.name}».`);
      }
      const user = db.users.insert({ username: username!, name: dto.name.trim(), email: dto.email.trim(), title: dto.title?.trim() ?? '', active: true, systemRoleIds: dto.systemRoleIds ?? [] });
      db.log(ctx.me, 'user.created', { type: 'user', id: user.id, label: user.username, projectId: null }, [{ field: 'الأدوار', from: null, to: user.systemRoleIds.join('، ') || '—' }], true);
      return user;
    })
    .patch('users/:id', (req, ctx) => {
      ctx.require('permissions.assign');
      const { version, active, systemRoleIds, name, email, title, managerId } = body<Partial<User> & { version: number }>(req);
      const current = db.users.get(req.params['id']);

      // Profile fields (FR-AUTH-02), validated server-side.
      const errors: Record<string, string> = {};
      if (name !== undefined && !name.trim()) errors['name'] = 'مطلوب';
      if (email !== undefined) {
        if (!EMAIL_PATTERN.test(email.trim())) errors['email'] = 'بريد غير صالح';
        else if (db.users.where((u) => u.id !== current.id && u.email.toLowerCase() === email.trim().toLowerCase()).length) errors['email'] = 'البريد مستخدم لحساب آخر';
      }
      if (title !== undefined && title.length > 100) errors['title'] = 'الحد الأقصى 100 حرف';
      if (managerId) {
        // Position-based approvers resolve through this chain, so it must be a real, active, acyclic reporting line.
        const manager = db.users.find(managerId);
        if (!manager?.active) errors['managerId'] = 'المدير يجب أن يكون مستخدمًا نشطًا';
        else if (managerId === current.id) errors['managerId'] = 'لا يمكن أن يكون المستخدم مديرًا لنفسه';
        else {
          const seen = new Set<string>([current.id]);
          for (let cursor: string | null | undefined = managerId; cursor; cursor = db.users.find(cursor)?.managerId) {
            if (seen.has(cursor)) { errors['managerId'] = 'سلسلة الإدارة تُنشئ حلقة دائرية'; break; }
            seen.add(cursor);
          }
        }
      }
      if (Object.keys(errors).length) fail(400, 'بيانات المستخدم غير صالحة.', errors);

      // Prevent self-escalation through the admin UI (SRS §2.2).
      if (current.id === ctx.me && systemRoleIds) fail(403, 'لا يمكنك تعديل أدوارك بنفسك.');
      // Deactivating or re-roling someone more powerful than the caller is a lock-out / takeover path.
      if (active !== undefined || systemRoleIds) assertOutranks(db, ctx.me, current.id);
      if (active === false && current.id === ctx.me) fail(422, 'لا يمكنك تعطيل حسابك بنفسك.');
      if (systemRoleIds) {
        const grantable = db.systemPermissions(ctx.me).grants;
        for (const roleId of systemRoleIds) {
          const role = db.roles.get(roleId);
          if (role.permissions.some((p) => !grantable.has(p))) fail(403, `لا تملك حق تفويض الدور «${role.name}».`);
        }
      }
      // The organisation must always keep an active user who can manage roles.
      const managers = activeRoleManagers(db);
      const isLastManager = managers.length === 1 && managers[0].id === current.id;
      if (isLastManager && (active === false || (systemRoleIds && !rolesGrantManage(db, systemRoleIds)))) {
        fail(422, 'لا يمكن تعطيل آخر مستخدم يملك صلاحية إدارة الأدوار أو سحب صلاحيته.');
      }

      const changes: { -readonly [K in keyof User]?: User[K] } = {};
      if (active !== undefined) changes.active = active;
      if (systemRoleIds) changes.systemRoleIds = systemRoleIds;
      if (name !== undefined) changes.name = name.trim();
      if (email !== undefined) changes.email = email.trim();
      if (title !== undefined) changes.title = title.trim();
      if (managerId !== undefined) changes.managerId = managerId || undefined;
      const next = db.users.patch(current.id, changes, version);
      // A deactivated account loses every live session immediately (FR-AUTH-06).
      if (active === false) db.revokeSessions(current.id);

      const subject = { type: 'user' as const, id: next.id, label: next.name, projectId: null };
      const roleChanges: FieldChange[] = [
        ...(active !== undefined && active !== current.active ? [{ field: 'التفعيل', from: String(current.active), to: String(next.active) }] : []),
        ...(systemRoleIds ? [{ field: 'الأدوار', from: current.systemRoleIds.join('، '), to: next.systemRoleIds.join('، ') }] : []),
      ];
      const profileChanges: FieldChange[] = [
        ...(next.name !== current.name ? [{ field: 'الاسم', from: current.name, to: next.name }] : []),
        ...(next.email !== current.email ? [{ field: 'البريد الإلكتروني', from: current.email, to: next.email }] : []),
        ...(next.title !== current.title ? [{ field: 'المسمى الوظيفي', from: current.title, to: next.title }] : []),
        ...(next.managerId !== current.managerId
          ? [{ field: 'المدير المباشر', from: db.users.find(current.managerId ?? '')?.name ?? '—', to: db.users.find(next.managerId ?? '')?.name ?? '—' }]
          : []),
      ];
      if (roleChanges.length || !profileChanges.length) db.log(ctx.me, 'role.updated', subject, roleChanges, true);
      if (profileChanges.length) db.log(ctx.me, 'user.updated', subject, profileChanges, true);
      return next;
    })
    .post('users/:id/reset-password', (req, ctx) => {
      ctx.require('permissions.assign');
      const user = db.users.get(req.params['id']);
      assertOutranks(db, ctx.me, user.id);
      // Single-use link with an unpredictable token; the password itself never exists in the mock or the log.
      // NOTE (demo only): the real server emails this link to the user and never returns it to the admin.
      const token = randomToken();
      const expiresAt = new Date(Date.now() + RESET_LINK_HOURS * 3_600_000).toISOString();
      db.revokeSessions(user.id);
      db.log(ctx.me, 'user.password_reset_requested', { type: 'user', id: user.id, label: user.name, projectId: null }, [
        { field: 'انتهاء الرابط', from: null, to: expiresAt },
      ], true);
      return { link: `https://ipm.example.local/reset/${token}`, expiresAt };
    });
}
