import { UpdateDto } from '@core/models/entity.model';
import { validateRefPattern } from '@domain/git/ref-pattern';
import { validateRepositoryUrl } from '@domain/git/repo-url';
import { MemberWarning, Project, ProjectCreate, ProjectMember, ProjectMembersResult, ProjectSummary, ProgressInfo, ProjectTransitionRequest, RepositoryConnect } from '@domain/projects/project.models';
import { MockDatabase } from '../../db/database';
import { isPastDue } from '../../db/time';
import { assertNoDirectSensitiveChange, consumeApproval, requireApproval } from '../approvals/engine';
import { recordTransition } from '../transitions';
import { body, fail, MockContext, MockRouter, parseListQuery } from '../router';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const validIso = (v: unknown): v is string => typeof v === 'string' && ISO_DATE.test(v) && new Date(v).toISOString().slice(0, 10) === v;

/** Shared create/patch validation of the plain project fields (types first, so a bad payload is a 400, not a crash). */
function validateProjectFields(f: Partial<Record<'name' | 'description' | 'startDate' | 'endDate', unknown>>, mode: 'create' | 'patch'): void {
  const errors: Record<string, string> = {};
  if (mode === 'create' || 'name' in f) {
    if (typeof f.name !== 'string' || !f.name.trim()) errors['name'] = 'مطلوب';
    else if (f.name.trim().length > 200) errors['name'] = 'الحد الأقصى 200 حرف';
  }
  if ('description' in f && f.description !== undefined && typeof f.description !== 'string') errors['description'] = 'نص مطلوب';
  for (const k of ['startDate', 'endDate'] as const) if ((mode === 'create' || k in f) && !validIso(f[k])) errors[k] = 'تاريخ غير صالح';
  if (!errors['startDate'] && !errors['endDate'] && typeof f.startDate === 'string' && typeof f.endDate === 'string' && f.endDate < f.startDate) errors['endDate'] = 'يسبق البداية';
  if (Object.keys(errors).length) fail(400, 'بيانات المشروع غير صالحة.', errors);
}

/** Fields a plain project edit may change; everything else has its own guarded action. */
const PATCHABLE_PROJECT_FIELDS: readonly (keyof Project)[] = ['name', 'description', 'startDate', 'endDate', 'ownerId', 'allowedTypeIds', 'defaultTypeId'];

/**
 * SRS §4.4: progress counts leaf items only (no double counting of parent + children),
 * excludes cancelled or archived items, and Approved ≠ Done.
 */
export function projectProgress(db: MockDatabase, projectId: string): ProgressInfo {
  const items = db.workItems.where((w) => w.projectId === projectId && !w.archived);
  const parents = new Set(items.map((w) => w.parentId).filter(Boolean));
  // Organisation policy: only leaves of the included types count (empty = every type).
  const included = db.settings.progressIncludedTypeIds ?? [];
  const scope = included.length ? `الأنواع المحتسبة: ${included.map((id) => db.types.find(id)?.name ?? id).join('، ')}` : 'جميع الأنواع';
  const rule = `التقدم = العناصر الورقية المنجزة ÷ العناصر الورقية المحتسبة (الأب لا يُحتسب مع أبنائه). ${scope}. تُستثنى الملغاة والمؤرشفة، والموافقة لا تعني الإنجاز.`;
  let counted = 0;
  let done = 0;
  for (const item of items) {
    if (parents.has(item.id)) continue;
    if (included.length && !included.includes(item.typeId)) continue;
    const category = db.statuses.find(item.statusId)?.category;
    if (category === 'Cancelled') continue;
    counted++;
    if (category === 'Done') done++;
  }
  return { percent: counted ? Math.round((done / counted) * 100) : null, doneLeaves: done, countedLeaves: counted, rule };
}

export function isOverdue(db: MockDatabase, item: { dueDate: string | null; statusId: string }): boolean {
  const category = db.statuses.find(item.statusId)?.category;
  return isPastDue(item.dueDate, db.settings.timeZone) && category !== 'Done' && category !== 'Cancelled';
}

export function summarize(db: MockDatabase, project: Project): ProjectSummary {
  const items = db.workItems.where((w) => w.projectId === project.id && !w.archived);
  return {
    ...project,
    progress: projectProgress(db, project.id),
    workItemCount: items.length,
    overdueCount: items.filter((w) => isOverdue(db, w)).length,
  };
}

function editable(ctx: MockContext, project: Project): void {
  // Archived projects are read-only (AT-14).
  if (project.archived) fail(422, 'المشروع مؤرشف ولا يمكن تعديله.');
  ctx.require('projects.edit', project.id);
}

export function registerProjectHandlers(router: MockRouter, db: MockDatabase): void {
  router
    .get('projects/all', (_req, ctx) => {
      const visible = db.visibleProjectIds(ctx.me);
      return db.projects.where((p) => visible.has(p.id)).map((p) => summarize(db, p));
    })
    .get('projects', (req, ctx) => {
      const visible = db.visibleProjectIds(ctx.me);
      const query = parseListQuery(req.query);
      const member = query.filters['memberId'];
      // Date-range filters (ISO strings compare lexicographically): a project overlaps [from, to] when end >= from and start <= to.
      const first = (key: string): string | undefined => query.filters[key]?.[0];
      const startFrom = first('startFrom');
      const startTo = first('startTo');
      const endFrom = first('endFrom');
      const endTo = first('endTo');
      const { memberId: _m, startFrom: _a, startTo: _b, endFrom: _c, endTo: _d, ...filters } = query.filters;
      const scope = (p: Project): boolean =>
        visible.has(p.id) &&
        (!member || p.members.some((m) => member.includes(m.userId))) &&
        (!startFrom || p.startDate >= startFrom) &&
        (!startTo || p.startDate <= startTo) &&
        (!endFrom || p.endDate >= endFrom) &&
        (!endTo || p.endDate <= endTo);
      // Derived/lookup columns cannot be sorted on the raw row: sort summaries by value, then page.
      if (query.sort && ['progress', 'ownerId', 'statusId'].includes(query.sort.field)) {
        const { field, direction } = query.sort;
        const all = db.projects.query({ ...query, sort: undefined, page: 1, pageSize: Number.MAX_SAFE_INTEGER, filters }, scope);
        const key = (p: ProjectSummary): string | number =>
          field === 'progress' ? (p.progress.percent ?? -1) : field === 'ownerId' ? (db.users.find(p.ownerId)?.name ?? '') : (db.statuses.find(p.statusId)?.name ?? '');
        const factor = direction === 'asc' ? 1 : -1;
        const sorted = all.items.map((p) => summarize(db, p)).sort((a, b) => {
          const ka = key(a);
          const kb = key(b);
          return (typeof ka === 'number' && typeof kb === 'number' ? ka - kb : String(ka).localeCompare(String(kb), 'ar')) * factor;
        });
        const start = (query.page - 1) * query.pageSize;
        return { items: sorted.slice(start, start + query.pageSize), total: sorted.length, page: query.page, pageSize: query.pageSize };
      }
      const page = db.projects.query({ ...query, filters }, scope);
      return { ...page, items: page.items.map((p) => summarize(db, p)) };
    })
    .get('projects/:id', (req, ctx) => {
      ctx.requireProjectVisible(req.params['id']);
      return summarize(db, db.projects.get(req.params['id']));
    })
    .post('projects', (req, ctx) => {
      ctx.require('projects.create');
      const dto = body<ProjectCreate>(req);
      const code = dto.code?.trim().toUpperCase();
      if (!code || !/^[A-Z][A-Z0-9]{1,9}$/.test(code)) fail(400, 'رمز المشروع يجب أن يبدأ بحرف لاتيني (2–10 أحرف).', { code: 'رمز غير صالح' });
      if (db.projects.where((p) => p.code === code).length) fail(409, 'رمز المشروع مستخدم مسبقًا.', { code: 'الرمز مستخدم' });
      validateProjectFields(dto, 'create');
      const owner = typeof dto.ownerId === 'string' ? db.users.find(dto.ownerId) : undefined;
      if (!owner?.active) fail(400, 'المالك يجب أن يكون مستخدمًا نشطًا موجودًا.', { ownerId: 'غير صالح' });
      const template = dto.templateId ? db.projectTemplates.get(dto.templateId) : null;
      if (template && !template.active) fail(422, 'قالب المشروع معطّل.');
      // A project always starts in the workflow's initial status: starting "Active" would skip
      // the activation approval (§4.3). Templates may only pick an initial status of the workflow.
      const workflow = db.workflows.get('wf-project');
      const initialStatusId = workflow.initialStatusId;
      const { templateId: _t, statusId: _s, ...fields } = dto;
      const members: ProjectMember[] = [{ userId: dto.ownerId, roleId: 'r-pm' }, ...(dto.ownerId === ctx.me ? [] : [{ userId: ctx.me, roleId: 'r-pm' }])];
      const suggestionRows: { field: string; from: string | null; to: string | null }[] = [];
      for (const s of template?.suggestedMembers ?? []) {
        if (!s.userId) continue;
        const user = db.users.find(s.userId);
        const role = db.roles.find(s.roleId);
        if (!user?.active || role?.scope !== 'project') suggestionRows.push({ field: `عضو مقترح متخطّى: ${user?.name ?? s.userId}`, from: null, to: 'غير نشط أو دور غير صالح' });
        else if (!members.some((m) => m.userId === user.id)) {
          members.push({ userId: user.id, roleId: role.id });
          suggestionRows.push({ field: `عضو من القالب: ${user.name}`, from: null, to: role.name });
        }
      }
      const project = db.projects.insert({
        ...fields,
        code,
        statusId: initialStatusId,
        archived: false,
        members,
        allowedTypeIds: template?.allowedTypeIds ?? db.types.where((t) => t.active).map((t) => t.id),
        defaultTypeId: template?.defaultTypeId ?? 't-task',
        repositories: [],
      });
      db.log(ctx.me, 'project.created', { type: 'project', id: project.id, label: project.name, projectId: project.id }, suggestionRows);
      return summarize(db, project);
    })
    .patch('projects/:id', (req, ctx) => {
      ctx.requireProjectVisible(req.params['id']);
      const current = db.projects.get(req.params['id']);
      editable(ctx, current);
      const { version, ...raw } = body<UpdateDto<Project>>(req);
      if ('code' in raw && raw.code !== current.code) fail(422, 'لا يمكن تغيير رمز المشروع بعد إنشائه.');
      if ('statusId' in raw && raw.statusId !== current.statusId) fail(422, 'تُغيَّر حالة المشروع عبر انتقالات سير العمل فقط.');
      // Whitelist: archive, members and repositories have dedicated, separately-permissioned actions.
      const forbidden = Object.keys(raw).filter((k) => !PATCHABLE_PROJECT_FIELDS.includes(k as keyof Project) && k !== 'code' && k !== 'statusId');
      if (forbidden.length) fail(422, `لا يمكن تعديل هذه الحقول هنا: ${forbidden.join('، ')}.`);
      const changes: Partial<Project> = Object.fromEntries(Object.entries(raw).filter(([k]) => PATCHABLE_PROJECT_FIELDS.includes(k as keyof Project)));
      validateProjectFields(changes, 'patch');
      // FR-APR-10 / §4.3: protected fields of a governed project change only through an approved sensitive.change request.
      assertNoDirectSensitiveChange(db, { subjectType: 'project', subjectId: current.id }, changes as Record<string, string | number | null>);
      const startDate = changes.startDate ?? current.startDate;
      const endDate = changes.endDate ?? current.endDate;
      if (startDate && endDate && endDate < startDate) fail(400, 'تاريخ النهاية يسبق تاريخ البداية.', { endDate: 'يسبق البداية' });
      if ('ownerId' in changes && changes.ownerId !== current.ownerId) {
        const owner = db.users.find(changes.ownerId ?? '');
        if (!owner?.active) fail(400, 'المالك يجب أن يكون مستخدمًا نشطًا.', { ownerId: 'غير صالح' });
        if (!current.members.some((m) => m.userId === owner.id)) fail(422, 'أضف المالك الجديد إلى أعضاء المشروع أولًا.', { ownerId: 'ليس عضوًا' });
      }
      if ('allowedTypeIds' in changes || 'defaultTypeId' in changes) {
        ctx.require('project.workitemtypes.configure', current.id);
        // FR-TYP-04: the default must be one of the allowed, active types. Removing a type only
        // stops new items of it; existing ones stay readable (§4.3).
        const allowed = changes.allowedTypeIds ?? current.allowedTypeIds;
        const defaultTypeId = changes.defaultTypeId ?? current.defaultTypeId;
        if (!allowed.length) fail(422, 'يجب السماح بنوع واحد على الأقل.');
        for (const id of allowed) if (!db.types.find(id)) fail(422, 'نوع غير معروف.');
        if (!allowed.includes(defaultTypeId)) fail(422, 'النوع الافتراضي يجب أن يكون من الأنواع المسموحة.', { defaultTypeId: 'غير مسموح' });
        if (!db.types.get(defaultTypeId).active) fail(422, 'النوع الافتراضي معطّل.', { defaultTypeId: 'معطّل' });
      }
      const next = db.projects.patch(current.id, changes as Partial<Project>, version);
      const diff = (Object.keys(changes) as (keyof Project)[])
        .filter((k) => JSON.stringify(current[k]) !== JSON.stringify(next[k]))
        .map((k) => ({ field: String(k), from: String(current[k] ?? ''), to: String(next[k] ?? '') }));
      db.log(ctx.me, 'project.updated', { type: 'project', id: next.id, label: next.name, projectId: next.id }, diff);
      supersedeIfProtected(db, ctx.me, 'project', next.id, diff.map((d) => d.field));
      return summarize(db, next);
    })
    .post('projects/:id/transition', (req, ctx) => {
      ctx.requireProjectVisible(req.params['id']);
      const current = db.projects.get(req.params['id']);
      editable(ctx, current);
      const { toStatusId, comment, version } = body<ProjectTransitionRequest>(req);
      const workflow = db.workflows.get('wf-project');
      const from = db.statuses.get(current.statusId);
      const to = db.statuses.get(toStatusId);
      const transition = workflow.transitions.find((t) => t.fromStatusId === current.statusId && t.toStatusId === toStatusId);
      if (!transition) fail(422, `الانتقال من «${from.name}» إلى «${to.name}» غير معرّف في سير عمل المشاريع.`);
      if (!to.active) fail(422, 'الحالة المطلوبة معطّلة.');
      if (transition.permission) ctx.require(transition.permission, current.id);
      let approval: ReturnType<typeof requireApproval> | undefined;
      if (transition.requiresApproval) {
        // FR-APR-08: activation needs an approved "project.approve" request; closing needs "project.close".
        // An approval authorises ONE transition and only while its protected fields are unchanged (§4.3).
        approval = requireApproval(db, ctx, { subjectType: 'project', subjectId: current.id, action: to.category === 'Done' ? 'close' : 'activate', targetStatusId: to.id });
      }
      const next = db.projects.patch(current.id, { statusId: toStatusId }, version);
      if (approval) consumeApproval(db, approval);
      recordTransition(db, { subjectType: 'project', itemId: current.id, projectId: current.id, fromStatusId: from.id, toStatusId: to.id, actorId: ctx.me, comment });
      db.log(ctx.me, 'project.transition', { type: 'project', id: current.id, label: current.name, projectId: current.id }, [
        { field: 'الحالة', from: `${from.name} (${from.key})`, to: `${to.name} (${to.key})` },
        ...(comment ? [{ field: 'تعليق', from: null, to: comment }] : []),
      ]);
      db.notify(current.members.map((m) => m.userId), 'تغيّرت حالة مشروع', `${current.name}: ${from.name} ← ${to.name}`, `/projects/${current.id}`, ctx.me);
      return summarize(db, next);
    })
    .post('projects/:id/archive', (req, ctx) => setArchived(db, ctx, req.params['id'], true, body<{ version: number }>(req).version))
    .post('projects/:id/unarchive', (req, ctx) => setArchived(db, ctx, req.params['id'], false, body<{ version: number }>(req).version))
    .post('projects/:id/members', (req, ctx) => {
      const current = db.projects.get(req.params['id']);
      ctx.requireProjectVisible(current.id);
      ctx.require('projects.members.manage', current.id);
      if (current.archived) fail(422, 'المشروع مؤرشف ولا يمكن تعديله.');
      const { members: rawMembers, version } = body<{ members: unknown; version: number }>(req);
      if (!Array.isArray(rawMembers)) fail(400, 'قائمة الأعضاء مطلوبة.', { members: 'مطلوب' });
      // Whitelist {userId, roleId}; anything that isn't an object with string ids is a 400, never a 500.
      const members: ProjectMember[] = rawMembers.map((m: unknown) => {
        const o = m as Record<string, unknown> | null;
        if (!o || typeof o !== 'object' || Array.isArray(o) || typeof o['userId'] !== 'string' || typeof o['roleId'] !== 'string') {
          return fail(400, 'عنصر عضو غير صالح؛ المطلوب {userId, roleId}.', { members: 'عنصر غير صالح' });
        }
        return { userId: o['userId'], roleId: o['roleId'] };
      });
      const nameOf = (id: string): string => db.users.find(id)?.name ?? id;
      const roleName = (id: string): string => db.roles.find(id)?.name ?? id;
      const seen = new Set<string>();
      for (const m of members) {
        if (seen.has(m.userId)) fail(422, `المستخدم «${nameOf(m.userId)}» مكرر في قائمة الأعضاء.`, { members: 'تكرار' });
        seen.add(m.userId);
      }
      if (!members.some((m) => m.userId === current.ownerId)) fail(422, 'لا يمكن إزالة مالك المشروع من الأعضاء.');
      const before = new Map(current.members.map((m) => [m.userId, m.roleId]));
      const added = members.filter((m) => !before.has(m.userId));
      const changedRole = members.filter((m) => before.has(m.userId) && before.get(m.userId) !== m.roleId);
      const removed = current.members.filter((m) => !seen.has(m.userId));
      // New or re-roled members: active user, a project-scope role, and a role the caller may hand out (no privilege escalation).
      for (const m of [...added, ...changedRole]) {
        const user = db.users.find(m.userId);
        if (!user) fail(422, 'مستخدم غير موجود.', { members: 'مستخدم غير موجود' });
        if (!user.active) fail(422, `المستخدم «${user.name}» غير نشط.`, { members: 'مستخدم غير نشط' });
        const role = db.roles.find(m.roleId);
        if (!role) fail(422, 'دور غير موجود.', { members: 'دور غير موجود' });
        if (role.scope !== 'project') fail(422, `الدور «${role.name}» ليس دور مشروع.`, { members: 'دور غير صالح' });
        const missing = role.permissions.filter((perm) => !db.can(ctx.me, perm, current.id));
        if (missing.length) fail(403, `لا تملك حق منح الدور «${role.name}»؛ يتضمن صلاحيات لا تملكها (${missing.length}).`, { members: 'تصعيد صلاحيات' });
      }
      // Removing or lowering a member is bound by the same rule: the caller can't touch a role holding permissions they lack.
      for (const m of [...removed, ...changedRole.map((c) => ({ userId: c.userId, roleId: before.get(c.userId)! }))]) {
        const oldRole = db.roles.find(m.roleId);
        const missing = oldRole?.permissions.filter((perm) => !db.can(ctx.me, perm, current.id)) ?? [];
        if (missing.length) fail(403, `لا تملك حق تعديل أو إزالة عضو بدور «${oldRole?.name}»؛ يتضمن صلاحيات لا تملكها (${missing.length}).`, { members: 'تصعيد صلاحيات' });
      }
      const next = db.projects.patch(current.id, { members }, version);
      supersedeIfProtected(db, ctx.me, 'project', current.id, ['members']);
      db.log(ctx.me, 'project.members', { type: 'project', id: next.id, label: next.name, projectId: next.id }, [
        ...added.map((m) => ({ field: `إضافة عضو: ${nameOf(m.userId)}`, from: null, to: roleName(m.roleId) })),
        ...removed.map((m) => ({ field: `إزالة عضو: ${nameOf(m.userId)}`, from: roleName(m.roleId), to: null })),
        ...changedRole.map((m) => ({ field: `تغيير دور: ${nameOf(m.userId)}`, from: roleName(before.get(m.userId)!), to: roleName(m.roleId) })),
      ], true);
      db.notify(added.map((m) => m.userId), 'أُضفت إلى مشروع', next.name, `/projects/${next.id}`, ctx.me);
      db.notify(removed.map((m) => m.userId), 'أُزيلت من مشروع', next.name, '/projects', ctx.me);
      // Open work still assigned to a removed member stays as it is; the caller is told so it can be re-assigned.
      const warnings: MemberWarning[] = [];
      for (const m of removed) {
        const refs = db.workItems
          .where((w) => w.projectId === current.id && !w.archived && w.assigneeIds.includes(m.userId) && !['Done', 'Cancelled'].includes(db.statuses.find(w.statusId)?.category ?? ''))
          .map((w) => w.ref);
        if (refs.length) warnings.push({ userId: m.userId, userName: nameOf(m.userId), refs, message: `${nameOf(m.userId)} ما زال مسؤولًا عن ${refs.length} عنصر مفتوح: ${refs.join('، ')}` });
      }
      const result: ProjectMembersResult = { ...summarize(db, next), warnings };
      return result;
    })
    .post('projects/:id/ref-pattern', (req, ctx) => {
      const current = db.projects.get(req.params['id']);
      ctx.requireProjectVisible(current.id);
      ctx.require('git.manage', current.id);
      if (current.archived) fail(422, 'المشروع مؤرشف ولا يمكن تعديله.');
      const { refPattern, version } = body<{ refPattern: string | null; version?: number }>(req);
      const pattern = refPattern?.trim() || undefined;
      if (pattern) {
        // Must recognise the project's own refs, so a typo can't silently stop all auto-linking.
        const samples = db.workItems.where((w) => w.projectId === current.id).map((w) => w.ref).slice(0, 5);
        const error = validateRefPattern(pattern, samples.length ? samples : [`${current.code}-101`]);
        if (error) fail(422, error, { refPattern: error });
      }
      const next = db.projects.patch(current.id, { refPattern: pattern }, version);
      db.log(ctx.me, 'project.refPattern', { type: 'project', id: next.id, label: next.name, projectId: next.id }, [
        { field: 'نمط رمز العنصر في Git', from: current.refPattern ?? 'الافتراضي', to: pattern ?? 'الافتراضي' },
      ], true);
      return summarize(db, next);
    })
    .post('projects/:id/repositories', (req, ctx) => {
      const current = db.projects.get(req.params['id']);
      ctx.requireProjectVisible(current.id);
      ctx.require('git.manage', current.id);
      if (current.archived) fail(422, 'المشروع مؤرشف ولا يمكن تعديله.');
      const dto = body<RepositoryConnect>(req);
      const errors: Record<string, string> = {};
      if (!['gitea', 'github', 'gitlab'].includes(dto.provider)) errors['provider'] = 'مزوّد غير مدعوم';
      if (!/^[\w.-]+\/[\w.-]+$/.test(dto.name ?? '')) errors['name'] = 'الصيغة: owner/repository';
      // Private/loopback hosts, userinfo, non-https and odd ports are SSRF vectors.
      const urlError = validateRepositoryUrl(dto.url);
      if (urlError) errors['url'] = urlError;
      if (!dto.defaultBranch?.trim()) errors['defaultBranch'] = 'مطلوب';
      if (!dto.accessToken?.trim()) errors['accessToken'] = 'مطلوب';
      if (dto.webhookSecret !== undefined && dto.webhookSecret.length < 16) errors['webhookSecret'] = '16 حرفًا على الأقل';
      if (Object.keys(errors).length) fail(400, 'بيانات الاتصال غير مكتملة.', errors);
      if (current.repositories.some((r) => r.connected && r.name === dto.name)) fail(409, 'هذا المستودع مربوط بالمشروع مسبقًا.');
      const id = `repo-${crypto.randomUUID().slice(0, 8)}`;
      db.webhookSecrets.set(id, dto.webhookSecret ?? crypto.randomUUID().replace(/-/g, ''));
      // The token is "stored in the secret store": never kept on the returned record or in the audit log (NFR-04, FR-AUD-07).
      const repository = {
        id, provider: dto.provider, name: dto.name, url: dto.url, defaultBranch: dto.defaultBranch.trim(),
        lastSyncAt: null, lastSyncError: null, connected: true, hasCredential: true,
        webhookUrl: `https://ipm.example.local/api/v1/webhooks/${dto.provider}/${id}`,
      };
      const next = db.projects.patch(current.id, { repositories: [...current.repositories, repository] });
      db.log(ctx.me, 'git.connected', { type: 'git', id, label: dto.name, projectId: current.id }, [{ field: 'المزوّد', from: null, to: dto.provider }], true);
      return summarize(db, next);
    })
    .post('projects/:id/repositories/:repoId/disconnect', (req, ctx) => {
      const current = db.projects.get(req.params['id']);
      ctx.requireProjectVisible(current.id);
      ctx.require('git.manage', current.id);
      const repo = current.repositories.find((r) => r.id === req.params['repoId']);
      if (!repo) fail(404, 'المستودع غير موجود.');
      // FR-GIT-09: keep the record and its events; only the connection and credential go.
      const repositories = current.repositories.map((r) => (r.id === repo.id ? { ...r, connected: false, hasCredential: false } : r));
      const next = db.projects.patch(current.id, { repositories });
      // The signing secret goes with the connection: a disconnected repository can no longer authenticate deliveries.
      db.webhookSecrets.delete(repo.id);
      db.log(ctx.me, 'git.disconnected', { type: 'git', id: repo.id, label: repo.name, projectId: current.id }, [], true);
      return summarize(db, next);
    });
}

function setArchived(db: MockDatabase, ctx: MockContext, id: string, archived: boolean, version: number): ProjectSummary {
  ctx.requireProjectVisible(id);
  ctx.require('projects.archive', id);
  const next = db.projects.patch(id, { archived }, version);
  db.log(ctx.me, archived ? 'project.archived' : 'project.unarchived', { type: 'project', id, label: next.name, projectId: id });
  return summarize(db, next);
}

/** FR-APR-10: changing a protected field while a request is pending supersedes that revision. */
export function supersedeIfProtected(
  db: MockDatabase,
  actorId: string,
  subjectType: 'project' | 'workItem',
  subjectId: string,
  changedFields: readonly string[],
): void {
  for (const request of db.approvals.where((a) => a.subjectId === subjectId && a.subjectType === subjectType && a.status === 'PendingApproval')) {
    const template = db.templates.find(request.templateId);
    if (!template?.protectedFields.some((f) => changedFields.includes(f))) continue;
    db.approvals.patch(request.id, { status: 'Superseded', currentStage: 0 });
    db.log(actorId, 'approval.superseded', { type: 'approval', id: request.id, label: request.title, projectId: request.projectId }, [
      { field: 'الحالة', from: 'بانتظار الموافقة', to: 'مُلغى بإصدار أحدث' },
    ]);
    db.notify([request.requesterId], 'أُبطل طلب موافقة', `${request.title} — تغيّر حقل محمي، يلزم إعادة التقديم.`, `/approvals/${request.id}`, actorId);
  }
}
