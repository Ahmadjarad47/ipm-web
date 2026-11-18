import { ALL_PERMISSIONS, PermissionKey } from '@core/auth/permissions';
import { Entity } from '@core/models/entity.model';
import { FieldChange, SubjectType } from '@domain/activity/activity.models';
import { HierarchyPair } from '@domain/work-items/work-item.models';
import { isValidTimeZone } from '../../db/time';
import { DEFAULT_SETTINGS, SettingsUpdate } from '@domain/settings/settings.models';
import { InMemoryCollection } from '../../db/collection';
import { MockDatabase } from '../../db/database';
import { validateApprovalTemplate } from '../approvals/engine';
import {
  relationTypeChanges, statusChanges, statusImpact, typeChanges, typeImpact, validateRelationType, validateStatus, validateType, validateWorkflow, workflowChanges,
} from '../definitions';
import { body, fail, MockContext, MockRouter, parseListQuery } from '../router';
import { Role } from '@domain/users/user.models';

interface ConfigResource<T extends Entity> {
  readonly path: string;
  readonly collection: InMemoryCollection<T>;
  readonly managePermission: PermissionKey;
  readonly subjectType: SubjectType;
  readonly label: (row: T) => string;
  /** Fields that may never change after creation (stable keys, FR-TYP-02 / FR-WF-02). */
  readonly immutable?: readonly (keyof T & string)[];
  /** Server-side validation of the full resulting record (create and update; `current` only on update). */
  readonly validate?: (row: T, current?: T) => void;
  /** Permission needed for an update that really changes `changedKeys` (default: `managePermission`). */
  readonly permissionFor?: (changedKeys: readonly string[]) => PermissionKey;
  /** Caller-aware rules (privilege ceilings, invariants) run after `validate`, on create and update. */
  readonly guard?: (ctx: MockContext, next: T, current?: T) => void;
  /** Human-readable per-change audit rows; falls back to a JSON diff of the changed keys. */
  readonly describe?: (current: T, next: T) => FieldChange[];
}

/**
 * Generic CRUD for admin-configured lookup tables. Reading is open to any signed-in user
 * (the UI needs names and colours); every write needs the resource's manage permission and is audited.
 * There is no hard delete: config with history is deactivated instead (FR-TYP-09, FR-WF-06).
 */
function registerConfig<T extends Entity>(router: MockRouter, db: MockDatabase, cfg: ConfigResource<T>): void {
  router
    .get(`${cfg.path}/all`, () => cfg.collection.all())
    .get(cfg.path, (req) => cfg.collection.query(parseListQuery(req.query)))
    .get(`${cfg.path}/:id`, (req) => cfg.collection.get(req.params['id']))
    .post(cfg.path, (req, ctx) => {
      ctx.require(cfg.managePermission);
      const data = body<Omit<T, keyof Entity>>(req);
      cfg.validate?.(data as T);
      cfg.guard?.(ctx, data as T);
      const row = cfg.collection.insert(data);
      db.log(ctx.me, `${cfg.subjectType}.created`, { type: cfg.subjectType, id: row.id, label: cfg.label(row), projectId: null }, [], true);
      return row;
    })
    .patch(`${cfg.path}/:id`, (req, ctx) => {
      const { version, ...changes } = body<Partial<T> & { version: number }>(req);
      const current = cfg.collection.get(req.params['id']);
      const changed = Object.keys(changes).filter(
        (k) => JSON.stringify((changes as Record<string, unknown>)[k] ?? null) !== JSON.stringify((current as Record<string, unknown>)[k] ?? null),
      );
      ctx.require(cfg.permissionFor?.(changed) ?? cfg.managePermission);
      for (const key of cfg.immutable ?? []) {
        if (key in changes && (changes as Partial<T>)[key] !== current[key]) fail(422, 'لا يمكن تغيير المفتاح الداخلي الثابت.');
      }
      cfg.validate?.({ ...current, ...changes } as T, current);
      cfg.guard?.(ctx, { ...current, ...changes } as T, current);
      const next = cfg.collection.patch(current.id, changes as Partial<T>, version);
      const diff: FieldChange[] = cfg.describe
        ? cfg.describe(current, next)
        : Object.keys(changes).map((field) => ({
            field,
            from: JSON.stringify((current as Record<string, unknown>)[field] ?? null),
            to: JSON.stringify((next as Record<string, unknown>)[field] ?? null),
          }));
      db.log(ctx.me, `${cfg.subjectType}.updated`, { type: cfg.subjectType, id: next.id, label: cfg.label(next), projectId: null }, diff, true);
      return next;
    })
    .delete(`${cfg.path}/:id`, () => fail(422, 'لا يُسمح بالحذف النهائي لعنصر له سجل تاريخي؛ استخدم التعطيل.'));
}

export function registerConfigHandlers(router: MockRouter, db: MockDatabase): void {
  registerConfig(router, db, {
    path: 'statuses', collection: db.statuses, managePermission: 'statuses.manage', subjectType: 'status', label: (s) => s.name, immutable: ['key'],
    validate: (s, current) => validateStatus(db, s, current), describe: statusChanges,
  });
  registerConfig(router, db, {
    path: 'workflows', collection: db.workflows, managePermission: 'workflows.manage', subjectType: 'status', label: (w) => w.name, immutable: ['key'],
    validate: (w, current) => validateWorkflow(db, w, current), describe: (a, b) => workflowChanges(db, a, b),
  });
  registerConfig(router, db, {
    path: 'work-item-types', collection: db.types, managePermission: 'workitem.types.manage', subjectType: 'type', label: (t) => t.name, immutable: ['key'],
    validate: (t, current) => validateType(db, t, current), describe: (a, b) => typeChanges(db, a, b),
    // FR-TYP-06: field definitions have their own permission; anything else on the type needs types.manage.
    permissionFor: (keys) => (keys.length && keys.every((k) => k === 'fields') ? 'workitem.fields.manage' : 'workitem.types.manage'),
  });
  // Key/directed/acyclic are locked once a relation uses the type (validateRelationType), not unconditionally.
  registerConfig(router, db, {
    path: 'relation-types', collection: db.relationTypes, managePermission: 'workitem.relationtypes.manage', subjectType: 'relation', label: (r) => r.name,
    validate: (r, current) => validateRelationType(db, r, current), describe: (a, b) => relationTypeChanges(db, a, b),
  });
  registerImpactAndHierarchy(router, db);
  registerConfig(router, db, {
    path: 'roles', collection: db.roles, managePermission: 'roles.manage', subjectType: 'role', label: (r) => r.name,
    // scope and builtIn decide how a role is granted and whether it can be removed — never editable after creation.
    immutable: ['key', 'scope', 'builtIn'],
    validate: validateRole,
    guard: (ctx, next, current) => guardRole(db, ctx, next, current),
  });
  registerConfig(router, db, { path: 'approval-templates', collection: db.templates, managePermission: 'approvals.configure', subjectType: 'approval', label: (t) => t.name, validate: (t) => { if (t.active !== false) validateApprovalTemplate(db, t); } });
  registerConfig(router, db, {
    path: 'project-templates', collection: db.projectTemplates, managePermission: 'settings.manage', subjectType: 'project', label: (t) => t.name,
    validate: (t) => {
      // A template can never start projects past the workflow's initial status (that would skip activation approval).
      if (t.initialStatusId !== db.workflows.get('wf-project').initialStatusId) fail(422, 'الحالة الابتدائية للقالب يجب أن تكون الحالة الابتدائية لسير عمل المشاريع.', { initialStatusId: 'غير مسموح' });
      if (!t.allowedTypeIds.length || t.allowedTypeIds.some((id) => !db.types.find(id))) fail(422, 'أنواع القالب غير صالحة.', { allowedTypeIds: 'غير صالح' });
      if (!t.allowedTypeIds.includes(t.defaultTypeId)) fail(422, 'النوع الافتراضي يجب أن يكون من الأنواع المسموحة.', { defaultTypeId: 'غير مسموح' });
      if (!Number.isInteger(t.durationDays) || t.durationDays < 1) fail(400, 'المدة يجب أن تكون يومًا على الأقل.', { durationDays: 'غير صالح' });
    },
  });

  // ---------- Organisation settings (single record) ----------
  router
    .get('settings', () => db.settings)
    .patch('settings', (req, ctx) => {
      ctx.require('settings.manage');
      const { version, ...raw } = body<SettingsUpdate>(req);
      // Whitelist known keys only; unknown keys are rejected rather than stored.
      const unknown = Object.keys(raw).filter((k) => !(k in DEFAULT_SETTINGS));
      if (unknown.length) fail(400, `إعدادات غير معروفة: ${unknown.join('، ')}`);
      const changes = { ...raw } as Record<string, unknown>;
      if (Array.isArray(changes['attachmentExtensions'])) {
        changes['attachmentExtensions'] = [...new Set((changes['attachmentExtensions'] as string[]).map((e) => String(e).trim().toLowerCase().replace(/^\./, '')))];
      }
      const errors: Record<string, string> = {};
      const int = (key: string, min: number, max: number, msg: string) => {
        if (key in changes && (!Number.isInteger(changes[key]) || (changes[key] as number) < min || (changes[key] as number) > max)) errors[key] = msg;
      };
      int('sessionHours', 1, 24, 'عدد صحيح بين 1 و24 ساعة');
      int('commentEditHours', 0, 168, 'عدد صحيح بين 0 و168 ساعة');
      int('attachmentMaxMb', 1, 100, 'عدد صحيح بين 1 و100 م.ب');
      int('auditRetentionDays', 365, 36_500, 'سنة على الأقل');
      for (const flag of ['allowCrossProjectRelations', 'allowSelfApproval', 'projectsPrivateByDefault']) {
        if (flag in changes && typeof changes[flag] !== 'boolean') errors[flag] = 'قيمة منطقية مطلوبة';
      }
      const included = changes['progressIncludedTypeIds'];
      if ('progressIncludedTypeIds' in changes && (!Array.isArray(included) || included.some((id) => typeof id !== 'string' || !db.types.find(id)))) errors['progressIncludedTypeIds'] = 'أنواع عمل غير معروفة';
      if ('timeZone' in changes && !isValidTimeZone(changes['timeZone'])) errors['timeZone'] = 'منطقة زمنية غير صالحة (مثال: Asia/Riyadh)';
      const exts = changes['attachmentExtensions'] as string[] | undefined;
      if (exts !== undefined) {
        if (!Array.isArray(exts) || !exts.length) errors['attachmentExtensions'] = 'نوع واحد على الأقل';
        else if (exts.some((e) => BLOCKED_EXTENSIONS.includes(e) || !/^[a-z0-9]{1,10}$/.test(e))) errors['attachmentExtensions'] = 'لا يُسمح بالملفات التنفيذية أو الامتدادات غير الصالحة';
      }
      if (Object.keys(errors).length) fail(400, 'قيم الإعدادات غير صالحة.', errors);
      const current = db.settings;
      const next = db.settingsTable.patch('settings', changes as SettingsUpdate, version);
      const diff = Object.keys(changes).map((field) => ({
        field,
        from: JSON.stringify((current as unknown as Record<string, unknown>)[field] ?? null),
        to: JSON.stringify((next as unknown as Record<string, unknown>)[field] ?? null),
      }));
      db.log(ctx.me, 'settings.updated', { type: 'status', id: 'settings', label: 'إعدادات النظام', projectId: null }, diff, true);
      return next;
    });
}

/** Executable/script types can never be allowed, whatever the settings say. */
const BLOCKED_EXTENSIONS = ['exe', 'bat', 'cmd', 'sh', 'ps1', 'msi', 'js', 'vbs', 'jar', 'scr', 'dll', 'com'];

/** FR-TYP-09 / FR-WF-06 impact previews and FR-REL-01 hierarchy rules as explicit pairs. */
function registerImpactAndHierarchy(router: MockRouter, db: MockDatabase): void {
  const pairsOf = (): HierarchyPair[] =>
    db.types.all().flatMap((parent) => parent.allowedChildTypeIds.map((childTypeId) => ({ parentTypeId: parent.id, childTypeId })));

  router
    .get('work-item-types/:id/impact', (req, ctx) => {
      ctx.require('workitem.types.manage');
      return typeImpact(db, db.types.get(req.params['id']));
    })
    .get('statuses/:id/impact', (req, ctx) => {
      ctx.require('statuses.manage');
      return statusImpact(db, db.statuses.get(req.params['id']));
    })
    .get('hierarchy-rules', () => ({ pairs: pairsOf() }))
    .put('hierarchy-rules', (req, ctx) => {
      ctx.require('workitem.types.manage');
      const { pairs } = body<{ pairs?: HierarchyPair[] }>(req);
      if (!Array.isArray(pairs)) fail(400, 'قائمة القواعد مطلوبة.', { pairs: 'مطلوب' });
      const errors: Record<string, string> = {};
      const seen = new Set<string>();
      pairs.forEach((p, i) => {
        if (!db.types.find(p.parentTypeId) || !db.types.find(p.childTypeId)) errors[`pairs[${i}]`] = 'نوع غير موجود';
        seen.add(`${p.parentTypeId}>${p.childTypeId}`);
      });
      if (Object.keys(errors).length) fail(400, 'قواعد التسلسل الهرمي غير صالحة.', errors);

      const before = new Set(pairsOf().map((p) => `${p.parentTypeId}>${p.childTypeId}`));
      for (const type of db.types.all()) {
        const children = [...new Set(pairs.filter((p) => p.parentTypeId === type.id).map((p) => p.childTypeId))];
        if (JSON.stringify(children) !== JSON.stringify(type.allowedChildTypeIds)) db.types.patch(type.id, { allowedChildTypeIds: children });
      }
      const name = (id: string): string => db.types.find(id)?.name ?? id;
      const label = (key: string): string => key.split('>').map(name).join(' ← ');
      const diff: FieldChange[] = [
        ...[...seen].filter((k) => !before.has(k)).map((k) => ({ field: 'قواعد التسلسل', from: null, to: `قاعدة مضافة: ${label(k)}` })),
        ...[...before].filter((k) => !seen.has(k)).map((k) => ({ field: 'قواعد التسلسل', from: label(k), to: 'قاعدة محذوفة' })),
      ];
      db.log(ctx.me, 'type.hierarchyUpdated', { type: 'type', id: 'hierarchy-rules', label: 'قواعد التسلسل الهرمي', projectId: null }, diff, true);
      return { pairs: pairsOf() };
    });
}

// ---------- Role administration (SRS §2.2: no privilege escalation, always one role manager) ----------

const KNOWN_PERMISSIONS: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

function validateRole(role: Role): void {
  const errors: Record<string, string> = {};
  if (!role.name?.trim()) errors['name'] = 'مطلوب';
  if (!['system', 'project'].includes(role.scope)) errors['scope'] = 'نطاق غير صالح';
  for (const field of ['permissions', 'denied'] as const) {
    const list = role[field];
    if (!Array.isArray(list)) errors[field] = 'قائمة صلاحيات مطلوبة';
    else if (list.some((p) => !KNOWN_PERMISSIONS.has(p))) errors[field] = 'يحتوي مفاتيح صلاحيات غير معروفة';
  }
  if (Array.isArray(role.permissions) && Array.isArray(role.denied) && role.permissions.some((p) => role.denied.includes(p))) {
    errors['denied'] = 'لا يمكن منح صلاحية وحظرها معًا';
  }
  if (Object.keys(errors).length) fail(400, 'بيانات الدور غير صالحة.', errors);
}

/**
 * A role editor can only add permissions they hold themselves; otherwise editing a role they already
 * hold would be a way around the grant ceiling enforced for members and users. Removing or denying
 * permissions is always allowed, except that the organisation must keep at least one active user
 * who can still manage roles.
 */
function guardRole(db: MockDatabase, ctx: MockContext, next: Role, current?: Role): void {
  const held = db.systemPermissions(ctx.me).grants;
  const before = new Set<PermissionKey>(current?.permissions ?? []);
  const added = next.permissions.filter((p) => !before.has(p));
  const missing = added.filter((p) => !held.has(p));
  if (missing.length) fail(403, 'لا تملك حق تفويض الصلاحيات: ' + missing.join('، ') + '.', { permissions: 'تتجاوز صلاحياتك' });

  if (current) {
    const managers = db.users.where((u) => u.active && u.systemRoleIds.some((id) => {
      const role = id === next.id ? next : db.roles.find(id);
      return !!role && role.permissions.includes('roles.manage') && !role.denied.includes('roles.manage');
    }));
    if (!managers.length) fail(422, 'لا يمكن حفظ هذا التعديل: يجب أن يبقى مستخدم نشط واحد على الأقل يملك صلاحية إدارة الأدوار.');
  }
}
