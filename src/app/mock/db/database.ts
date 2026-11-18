import { PermissionKey } from '@core/auth/permissions';
import { AuditEvent, Comment, FieldChange, GitEvent, Notification, SubjectType } from '@domain/activity/activity.models';
import { ApprovalRequest, ApprovalStage, ApprovalTemplate, ApproverPosition, Delegation } from '@domain/approvals/approval.models';
import { Attachment } from '@domain/attachments/attachment.models';
import { ProjectTemplate } from '@domain/projects/project-template';
import { SystemSettings } from '@domain/settings/settings.models';
import { RemoteCommit, WebhookDelivery } from '@domain/git/git.models';
import { Project } from '@domain/projects/project.models';
import { Role, User } from '@domain/users/user.models';
import { RelationType, WorkItem, WorkItemRelation, WorkItemType } from '@domain/work-items/work-item.models';
import { Status, TransitionRecord, Workflow } from '@domain/workflow/workflow.models';
import { InMemoryCollection } from './collection';
import { hmacSha256 } from './hash';
import { orgToday } from './time';
import * as seed from './seed';

export interface Session {
  readonly token: string;
  readonly userId: string;
  readonly expiresAt: string;
  revoked: boolean;
}

/** Where the current request came from; stamped on every audit event it produces (FR-AUD-02). */
export interface RequestOrigin {
  readonly source: AuditEvent['source'];
  readonly correlationId: string;
}

const SENSITIVE_KEY = /token|secret|password|credential/i;
const REDACTED = '***';

/** Secret-looking fragments inside free text: key=value pairs, URL credentials and long hex/base64 runs. */
const SECRET_PAIR = /\b(token|secret|password|passwd|authorization|bearer)(\s*[:=]\s*)((?:bearer\s+)?\S+)/gi;
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]+)(@)/gi;
const LONG_SECRET_RUN = /[A-Fa-f0-9]{32,}|[A-Za-z0-9+/_-]{32,}={0,2}/g;

/** Replaces the secret part of anything that looks like a credential. */
export function scrubSecrets(value: string): string {
  return value
    .replace(SECRET_PAIR, (_m, k: string, sep: string) => k + sep + REDACTED)
    .replace(URL_CREDENTIALS, (_m, head: string, _pw: string, at: string) => head + REDACTED + at)
    .replace(LONG_SECRET_RUN, REDACTED);
}

const scrub = (value: string | null): string | null => (value === null ? null : scrubSecrets(value));

/** Replaces the values of sensitive keys inside a JSON string; non-JSON text is returned unchanged. */
function redactJson(value: string | null): string | null {
  if (value === null || !/^\s*[{[]/.test(value)) return value;
  try {
    const walk = (node: unknown): unknown => {
      if (Array.isArray(node)) return node.map(walk);
      if (node && typeof node === 'object') {
        return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? REDACTED : walk(v)]));
      }
      return node;
    };
    return JSON.stringify(walk(JSON.parse(value)));
  } catch {
    return value;
  }
}

export function redactChanges(changes: readonly FieldChange[]): FieldChange[] {
  return changes.map((c) =>
    SENSITIVE_KEY.test(c.field) ? { field: c.field, from: c.from === null ? null : REDACTED, to: c.to === null ? null : REDACTED } : { field: c.field, from: scrub(redactJson(c.from)), to: scrub(redactJson(c.to)) },
  );
}

/** Canonical payload an audit hash covers: every field except id/version bookkeeping. */
export function auditPayload(e: Omit<AuditEvent, 'id' | 'version' | 'createdAt' | 'updatedAt' | 'prevHash' | 'hash'>): string {
  return JSON.stringify([e.actorId, e.action, e.subjectType, e.subjectId, e.subjectLabel, e.projectId, e.at, e.changes.map((c) => [c.field, c.from, c.to]), e.source, e.correlationId, e.security]);
}

/** Keyed (HMAC-SHA256) chain link: without the per-database key an attacker cannot forge or recompute the chain. */
export function auditHash(key: string, prevHash: string, e: Parameters<typeof auditPayload>[0]): string {
  return hmacSha256(key, prevHash + auditPayload(e));
}

/** Gives seeded events a valid hash chain (the seed file predates tamper evidence). */
function chainSeed(key: string, events: readonly Omit<AuditEvent, 'prevHash' | 'hash'>[]): AuditEvent[] {
  let prev = '';
  return events.map((e) => {
    const hash = auditHash(key, prev, e);
    const row: AuditEvent = { ...e, prevHash: prev, hash };
    prev = hash;
    return row;
  });
}

/** All mock tables plus cross-cutting helpers (audit, notifications, effective permissions). */
const MAX_TRACKED = 1000;

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Inserts into an insertion-ordered map, evicting the oldest entries beyond max. */
export function setBounded<K, V>(map: Map<K, V>, key: K, value: V, max = MAX_TRACKED): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

export class MockDatabase {
  /** Random per-database HMAC key of the audit chain; never exposed by any route. */
  private readonly auditKey = randomHex(32);
  /** Set by the HTTP layer: writes over HTTP must then carry the record version (428 otherwise). */
  strictVersions = false;
  readonly users = new InMemoryCollection<User>('u', ['name', 'email', 'username', 'title'], seed.USERS);
  readonly roles = new InMemoryCollection<Role>('r', ['name', 'key'], seed.ROLES);
  readonly statuses = new InMemoryCollection<Status>('s', ['name', 'key'], seed.STATUSES);
  readonly workflows = new InMemoryCollection<Workflow>('wf', ['name'], seed.WORKFLOWS);
  readonly types = new InMemoryCollection<WorkItemType>('t', ['name', 'key'], seed.WORK_ITEM_TYPES);
  readonly relationTypes = new InMemoryCollection<RelationType>('rt', ['name'], seed.RELATION_TYPES);
  readonly projects = new InMemoryCollection<Project>('p', ['name', 'code', 'description'], seed.PROJECTS);
  readonly workItems = new InMemoryCollection<WorkItem>('wi', ['title', 'ref', 'description'], seed.WORK_ITEMS);
  readonly relations = new InMemoryCollection<WorkItemRelation>('rel', [], seed.RELATIONS);
  readonly templates = new InMemoryCollection<ApprovalTemplate>('tpl', ['name'], seed.APPROVAL_TEMPLATES);
  readonly approvals = new InMemoryCollection<ApprovalRequest>('apr', ['title'], seed.APPROVAL_REQUESTS);
  readonly comments = new InMemoryCollection<Comment>('c', ['body'], seed.COMMENTS);
  readonly audit = new InMemoryCollection<AuditEvent>('a', ['subjectLabel', 'action'], chainSeed(this.auditKey, seed.AUDIT_EVENTS));
  readonly gitEvents = new InMemoryCollection<GitEvent>('g', ['title', 'branch'], seed.GIT_EVENTS);
  readonly notifications = new InMemoryCollection<Notification>('n', ['title', 'body'], seed.NOTIFICATIONS);
  readonly attachments = new InMemoryCollection<Attachment>('f', ['fileName'], seed.ATTACHMENTS);
  /** File bytes kept apart from metadata, like object storage (S3-compatible in production). */
  readonly fileContents = new Map<string, Blob>();
  readonly settingsTable = new InMemoryCollection<SystemSettings>('settings', [], seed.SETTINGS);
  readonly projectTemplates = new InMemoryCollection<ProjectTemplate>('ptpl', ['name'], seed.PROJECT_TEMPLATES);
  /** Executed status changes of work items and projects (FR-WF-08). */
  readonly transitions = new InMemoryCollection<TransitionRecord>('tr', [], []);

  readonly webhookDeliveries = new InMemoryCollection<WebhookDelivery>('wh', ['deliveryId', 'event'], []);
  /** Raw payloads of failed deliveries, kept for redelivery (FR-GIT-05/06). */
  readonly webhookPayloads = new Map<string, { raw: string; event: string }>();
  /** Webhook signing secrets per repository — the "secret store" (NFR-04); never returned by any route. */
  readonly webhookSecrets = new Map<string, string>([['repo-1', 'demo-secret-erp-web-0001'], ['repo-2', 'demo-secret-erp-api-0002'], ['repo-3', 'demo-secret-ssp-0003']]);

  /** FR-APR-11: temporary approval delegations. */
  readonly delegations = new InMemoryCollection<Delegation>('dlg', ['reason'], seed.DELEGATIONS);
  /** What each Git server holds per repository: lets a manual sync fetch commits no webhook delivered (FR-GIT-06). */
  readonly remoteCommits = new Map<string, RemoteCommit[]>(Object.entries(seed.REMOTE_COMMITS).map(([repo, commits]) => [repo, commits.map((c) => ({ ...c }))]));

  /** Server-side session table (FR-AUTH-01/06): a bearer token is only valid while a live row exists. */
  readonly sessions: Session[] = [];
  /** Failed-login timestamps per username+client (FR-AUTH-05 lockout); at most 1000 keys, oldest evicted. */
  readonly failedLogins = new Map<string, number[]>();
  /** Last time a failed login for an unknown username was audited (once per minute per name). */
  readonly unknownLoginLoggedAt = new Map<string, number>();
  /** Last time an identical permission_denied event was written (de-duplication window). */
  private readonly deniedLoggedAt = new Map<string, number>();
  private sessionSeq = 0;
  private correlationSeq = 0;
  /** Origin of the request being served; set by `MockContext`. */
  origin: RequestOrigin = { source: 'ui', correlationId: 'none' };

  /** Approvals already used to authorise a protected transition (single use). */
  readonly consumedApprovals = new Set<string>();

  /** The single organisation settings record. */
  get settings(): SystemSettings {
    return this.settingsTable.get('settings');
  }

  // ---------- Permissions ----------

  private rolePerms(roleIds: readonly string[]): { grants: Set<PermissionKey>; denied: Set<PermissionKey> } {
    const grants = new Set<PermissionKey>();
    const denied = new Set<PermissionKey>();
    for (const id of roleIds) {
      const role = this.roles.find(id);
      role?.permissions.forEach((p) => grants.add(p));
      role?.denied.forEach((p) => denied.add(p));
    }
    return { grants, denied };
  }

  systemPermissions(userId: string): { grants: Set<PermissionKey>; denied: Set<PermissionKey> } {
    return this.rolePerms(this.users.find(userId)?.systemRoleIds ?? []);
  }

  projectPermissions(userId: string, projectId: string): Set<PermissionKey> {
    const member = this.projects.find(projectId)?.members.find((m) => m.userId === userId);
    return member ? this.rolePerms([member.roleId]).grants : new Set();
  }

  /** Default deny; explicit deny wins; project grants never leak to other projects. */
  can(userId: string, permission: PermissionKey, projectId?: string | null): boolean {
    const system = this.systemPermissions(userId);
    if (system.denied.has(permission)) return false;
    if (system.grants.has(permission)) return true;
    return !!projectId && this.projectPermissions(userId, projectId).has(permission);
  }

  canSeeProject(userId: string, projectId: string): boolean {
    return this.can(userId, 'projects.view', projectId);
  }

  visibleProjectIds(userId: string): Set<string> {
    return new Set(this.projects.all().filter((p) => this.canSeeProject(userId, p.id)).map((p) => p.id));
  }

  // ---------- Sessions ----------

  issueSession(userId: string): Session {
    this.sessionSeq++;
    const nonce = randomHex(16); // 128 bits from the platform CSPRNG
    const session: Session = {
      token: `mock.${userId}.${nonce}`,
      userId,
      expiresAt: new Date(Date.now() + this.settings.sessionHours * 3_600_000).toISOString(),
      revoked: false,
    };
    this.sessions.push(session);
    return session;
  }

  /** Resolves a bearer token to its user, or the reason it is no longer valid. */
  resolveSession(token: string | null): { userId: string; session: Session } | { error: 'session_expired' | 'account_disabled' } {
    const session = token ? this.sessions.find((x) => x.token === token) : undefined;
    if (!session) return { error: 'session_expired' };
    const user = this.users.find(session.userId);
    if (!user?.active) return { error: 'account_disabled' };
    if (session.revoked || new Date(session.expiresAt).getTime() <= Date.now()) return { error: 'session_expired' };
    return { userId: user.id, session };
  }

  revokeSessions(userId: string): void {
    for (const s of this.sessions) if (s.userId === userId) s.revoked = true;
  }

  // ---------- Side effects ----------

  nextCorrelationId(): string {
    return `corr-${String(++this.correlationSeq).padStart(6, '0')}`;
  }

  /**
   * Appends an audit event (FR-AUD-04: never updated or deleted). Sensitive values are redacted here, centrally
   * (FR-AUD-07), `source`/`correlationId` default to the current request, and each event is chained to the
   * previous one by hash (FR-AUD-09).
   */
  /** Recomputes the keyed hash of an audit event (used by audit/verify). */
  auditHashOf(prevHash: string, e: Parameters<typeof auditPayload>[0]): string {
    return auditHash(this.auditKey, prevHash, e);
  }

  log(
    actorId: string,
    action: string,
    subject: { type: SubjectType; id: string; label: string; projectId: string | null },
    changes: FieldChange[] = [],
    security = false,
    origin: Partial<RequestOrigin> = {},
  ): void {
    const events = this.audit.all();
    const prevHash = events.length ? events[events.length - 1].hash : '';
    const payload = {
      actorId,
      action,
      subjectType: subject.type,
      subjectId: subject.id,
      subjectLabel: subject.label,
      projectId: subject.projectId,
      at: new Date().toISOString(),
      changes: redactChanges(changes),
      source: origin.source ?? this.origin.source,
      correlationId: origin.correlationId ?? this.origin.correlationId,
      security,
    };
    this.audit.insert({ ...payload, prevHash, hash: this.auditHashOf(prevHash, payload) });
  }

  /** Records a 403 as a security event, once per identical (user, permission, project) per minute (FR-AUTH-05). */
  logPermissionDenied(userId: string, permission: PermissionKey, projectId?: string | null): void {
    // Only real project ids count, so a caller cannot grow the map (or the log) with invented ids.
    projectId = projectId && this.projects.find(projectId) ? projectId : null;
    const key = `${userId}|${permission}|${projectId ?? ''}`;
    const now = Date.now();
    const last = this.deniedLoggedAt.get(key);
    if (last !== undefined && now - last < 60_000) return;
    setBounded(this.deniedLoggedAt, key, now);
    this.log(userId, 'auth.permission_denied', { type: 'user', id: userId, label: this.users.find(userId)?.username ?? userId, projectId }, [
      { field: 'الإذن', from: null, to: permission },
      { field: 'المشروع', from: null, to: projectId },
    ], true);
  }

  notify(userIds: Iterable<string>, title: string, body: string, link: string, exceptUserId?: string): void {
    for (const userId of new Set(userIds)) {
      if (userId === exceptUserId) continue;
      this.notifications.insert({ userId, title, body, link, read: false });
    }
  }

  /**
   * Users who can act on an approval stage inside a project (FR-APR-02/11): the resolved approvers
   * (user / role / position) plus active delegates inside their delegation window.
   */
  stageApprovers(stage: Pick<ApprovalStage, 'approverKind' | 'approverId'>, projectId: string, requesterId?: string): string[] {
    const { direct, delegates } = this.resolveStageApprovers(stage, projectId, requesterId);
    return [...new Set([...direct, ...delegates.keys()])];
  }

  /** Same as `stageApprovers`, but keeps who each delegate acts for (stored as `onBehalfOf`). */
  resolveStageApprovers(
    stage: Pick<ApprovalStage, 'approverKind' | 'approverId'>,
    projectId: string,
    requesterId?: string,
  ): { direct: string[]; delegates: Map<string, string> } {
    const project = this.projects.find(projectId);
    let direct: string[];
    if (stage.approverKind === 'user') {
      direct = [stage.approverId];
    } else if (stage.approverKind === 'position') {
      const position = stage.approverId as ApproverPosition;
      if (position === 'project_owner') direct = project ? [project.ownerId] : [];
      else if (position === 'direct_manager') direct = [this.users.find(requesterId ?? '')?.managerId].filter((id): id is string => !!id);
      else {
        const pmRoleIds = this.roles.where((r) => r.key === 'project_manager').map((r) => r.id);
        direct = project?.members.filter((m) => pmRoleIds.includes(m.roleId)).map((m) => m.userId) ?? [];
      }
    } else {
      const members = project?.members.filter((m) => m.roleId === stage.approverId).map((m) => m.userId) ?? [];
      const system = this.users.where((u) => u.systemRoleIds.includes(stage.approverId)).map((u) => u.id);
      direct = [...members, ...system];
    }
    direct = [...new Set(direct)];
    const today = orgToday(this.settings.timeZone);
    const delegates = new Map<string, string>();
    for (const d of this.delegations.where((x) => x.active && x.from <= today && today <= x.to && direct.includes(x.fromUserId))) {
      if (this.users.find(d.toUserId)?.active && !direct.includes(d.toUserId)) delegates.set(d.toUserId, d.fromUserId);
    }
    return { direct, delegates };
  }
}
