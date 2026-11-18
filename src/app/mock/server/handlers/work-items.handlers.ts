import { PagedResult, UpdateDto } from '@core/models/entity.model';
import { BoardItem, FieldDefinition, FieldValue, Priority, TypeChangeConflict, WorkItem, WorkItemCreate, WorkItemRelation } from '@domain/work-items/work-item.models';
import { CloseRequest, ReopenRequest, Status, TransitionRequest } from '@domain/workflow/workflow.models';
import { MockDatabase } from '../../db/database';
import { assertNoDirectSensitiveChange, consumeApproval, requireApproval } from '../approvals/engine';
import { effectiveWorkflow, effectiveWorkflowId, relationPairAllowed } from '../definitions';
import { body, fail, MockContext, MockRouter, parseListQuery } from '../router';
import { recordTransition } from '../transitions';
import { devIndicator } from './git.handlers';
import { isOverdue, supersedeIfProtected } from './projects.handlers';
import { registerWorkflowExtras } from './workflow-extras.handlers';

const isClosed = (db: MockDatabase, statusId: string): boolean => {
  const category = db.statuses.find(statusId)?.category;
  return category === 'Done' || category === 'Cancelled';
};

/** Adds the development summary only for callers allowed to see Git data. */
function withDev(db: MockDatabase, ctx: MockContext, item: WorkItem): WorkItem {
  return ctx.can('git.view', item.projectId) ? { ...item, dev: devIndicator(db, item) } : item;
}

function visibleItem(db: MockDatabase, ctx: MockContext, id: string): WorkItem {
  const item = db.workItems.get(id);
  ctx.requireProjectVisible(item.projectId);
  ctx.require('tasks.view', item.projectId);
  return item;
}

function assertProjectWritable(db: MockDatabase, projectId: string): void {
  if (db.projects.get(projectId).archived) fail(422, 'المشروع مؤرشف ولا يمكن تعديل عناصره.');
}

function validateFields(defs: readonly FieldDefinition[], values: Readonly<Record<string, FieldValue>>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const def of defs) {
    const value = values[def.key];
    const empty = value === undefined || value === null || value === '';
    if (def.required && empty) errors[def.key] = `${def.label} مطلوب`;
    if (empty) continue;
    if (def.type === 'number') {
      const n = Number(value);
      if (Number.isNaN(n)) errors[def.key] = 'قيمة رقمية مطلوبة';
      else if (def.min !== undefined && n < def.min) errors[def.key] = `الحد الأدنى ${def.min}`;
      else if (def.max !== undefined && n > def.max) errors[def.key] = `الحد الأعلى ${def.max}`;
    }
    if (def.type === 'select' && !def.options?.some((o) => o.value === value)) errors[def.key] = 'خيار غير صالح';
  }
  return errors;
}

/** True when making `parentId` the parent of `itemId` would create a cycle (direct or indirect). */
function createsHierarchyCycle(db: MockDatabase, itemId: string, parentId: string): boolean {
  let cursor: string | null = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === itemId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = db.workItems.find(cursor)?.parentId ?? null;
  }
  return false;
}

function validateParent(db: MockDatabase, item: Pick<WorkItem, 'projectId' | 'typeId'> & { id?: string }, parentId: string | null): void {
  if (!parentId) return;
  const parent = db.workItems.get(parentId);
  if (parent.projectId !== item.projectId) fail(422, 'يجب أن يكون العنصر الأب ضمن نفس المشروع.');
  if (item.id && (parentId === item.id || createsHierarchyCycle(db, item.id, parentId))) {
    fail(422, 'لا يمكن إنشاء دورة في شجرة الآباء والأبناء.');
  }
  const parentType = db.types.get(parent.typeId);
  if (!parentType.allowedChildTypeIds.includes(item.typeId)) {
    fail(422, `النوع «${db.types.find(item.typeId)?.name}» غير مسموح كابن لـ «${parentType.name}».`);
  }
}

const EDITABLE_KEYS = ['title', 'description', 'priority', 'startDate', 'dueDate', 'assigneeIds', 'fields'] as const;
const PRIORITIES: readonly Priority[] = ['low', 'medium', 'high', 'critical'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

const isDate = (v: unknown): v is string => typeof v === 'string' && ISO_DATE.test(v) && !Number.isNaN(Date.parse(v));

/** Whitelisted, validated PATCH payload (TSK-01/03/04). Throws 422 for forbidden keys, 400 for bad values. */
function validatePatch(db: MockDatabase, current: WorkItem, raw: Record<string, unknown>): Partial<WorkItem> {
  const { dev: _dev, ...changes } = raw;
  const rejected = Object.keys(changes).filter(
    (k) => !(EDITABLE_KEYS as readonly string[]).includes(k) && !(k in current && JSON.stringify(changes[k]) === JSON.stringify((current as unknown as Record<string, unknown>)[k])),
  );
  if (rejected.length) {
    fail(422, `حقول غير قابلة للتعديل بهذا الطلب: ${rejected.join('، ')}. الحالة والنوع والأب تُغيَّر عبر إجراءات مخصصة.`, Object.fromEntries(rejected.map((k) => [k, 'غير مسموح'])));
  }
  const edits: Record<string, unknown> = {};
  for (const key of EDITABLE_KEYS) if (key in changes) edits[key] = changes[key];

  const errors: Record<string, string> = {};
  if ('title' in edits) {
    if (typeof edits['title'] !== 'string' || !edits['title'].trim()) errors['title'] = 'العنوان مطلوب';
    else if (edits['title'].trim().length > 200) errors['title'] = 'الحد الأقصى 200 حرف';
    else edits['title'] = edits['title'].trim();
  }
  if ('description' in edits && typeof edits['description'] !== 'string') errors['description'] = 'نص مطلوب';
  if ('priority' in edits && !PRIORITIES.includes(edits['priority'] as Priority)) errors['priority'] = 'أولوية غير صالحة';
  for (const key of ['startDate', 'dueDate']) {
    if (key in edits && edits[key] !== null && !isDate(edits[key])) errors[key] = 'تاريخ غير صالح';
  }
  const start = ('startDate' in edits ? edits['startDate'] : current.startDate) as string | null;
  const due = ('dueDate' in edits ? edits['dueDate'] : current.dueDate) as string | null;
  if (!errors['startDate'] && !errors['dueDate'] && start && due && due.slice(0, 10) < start.slice(0, 10)) errors['dueDate'] = 'تاريخ الاستحقاق يجب ألا يسبق تاريخ البدء';
  if ('assigneeIds' in edits) {
    const ids = edits['assigneeIds'];
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) errors['assigneeIds'] = 'قائمة غير صالحة';
    else if (new Set(ids).size !== ids.length) errors['assigneeIds'] = 'مسؤول مكرر';
    else {
      const members = new Set(db.projects.get(current.projectId).members.filter((m) => db.users.find(m.userId)?.active).map((m) => m.userId));
      const outsiders = (ids as string[]).filter((id) => !members.has(id) && !current.assigneeIds.includes(id));
      if (outsiders.length) errors['assigneeIds'] = `ليسوا أعضاء نشطين في المشروع: ${outsiders.map((id) => db.users.find(id)?.name ?? id).join('، ')}`;
    }
  }
  if ('fields' in edits) {
    const f = edits['fields'];
    if (!f || typeof f !== 'object' || Array.isArray(f)) errors['fields'] = 'كائن غير صالح';
    else Object.assign(errors, validateFields(db.types.get(current.typeId).fields, f as Record<string, FieldValue>));
  }
  if (Object.keys(errors).length) fail(400, 'قيم الحقول غير صالحة.', errors);
  return edits as Partial<WorkItem>;
}

const display = (v: unknown): string => (typeof v === 'string' ? v : JSON.stringify(v ?? null));

/** Predicate for the relation, hierarchy, assignee and date list filters (FR-REL-14, FR-TSK-05). */
function listFilters(db: MockDatabase, filters: Readonly<Record<string, readonly string[]>>): (w: WorkItem) => boolean {
  const flag = (key: string): boolean | undefined => (filters[key]?.[0] === 'true' ? true : filters[key]?.[0] === 'false' ? false : undefined);
  const blocksIds = new Set(db.relationTypes.where((r) => r.key === 'blocks').map((r) => r.id));
  const blockRels = db.relations.where((r) => blocksIds.has(r.relationTypeId));
  const openBlocked = new Set(
    blockRels.filter((r) => {
      const blocker = db.workItems.find(r.sourceId);
      return !!blocker && !isClosed(db, blocker.statusId);
    }).map((r) => r.targetId),
  );
  const inRelation = new Set(db.relations.all().flatMap((r) => [r.sourceId, r.targetId]));
  const parents = new Set(db.workItems.where((w) => !w.archived && !!w.parentId).map((w) => w.parentId as string));
  const blockedByX = filters['blockedBy'] ? new Set(blockRels.filter((r) => filters['blockedBy'].includes(r.sourceId)).map((r) => r.targetId)) : null;
  const blockingX = filters['blocking'] ? new Set(blockRels.filter((r) => filters['blocking'].includes(r.targetId)).map((r) => r.sourceId)) : null;
  const hasChildren = flag('hasChildren');
  const hasDependency = flag('hasDependency');
  const unblocked = flag('unblocked');
  const unassigned = flag('unassigned');
  const assignees = filters['assigneeIds'] ?? [];
  const createdFrom = filters['createdFrom']?.[0];
  const createdTo = filters['createdTo']?.[0];
  const dueFrom = filters['dueFrom']?.[0];
  const dueTo = filters['dueTo']?.[0];
  return (w) => {
    if (hasChildren !== undefined && parents.has(w.id) !== hasChildren) return false;
    if (hasDependency !== undefined && inRelation.has(w.id) !== hasDependency) return false;
    if (unblocked !== undefined && !openBlocked.has(w.id) !== unblocked) return false;
    if (blockedByX && !blockedByX.has(w.id)) return false;
    if (blockingX && !blockingX.has(w.id)) return false;
    if (assignees.length || unassigned === true) {
      const anyOf = assignees.some((id) => w.assigneeIds.includes(id));
      if (!(anyOf || (unassigned === true && !w.assigneeIds.length))) return false;
    } else if (unassigned === false && !w.assigneeIds.length) return false;
    if (createdFrom && w.createdAt.slice(0, 10) < createdFrom) return false;
    if (createdTo && w.createdAt.slice(0, 10) > createdTo) return false;
    if ((dueFrom || dueTo) && !w.dueDate) return false;
    if (dueFrom && w.dueDate && w.dueDate.slice(0, 10) < dueFrom) return false;
    if (dueTo && w.dueDate && w.dueDate.slice(0, 10) > dueTo) return false;
    return true;
  };
}

const LIST_ONLY_FILTERS = ['overdue', 'includeArchived', 'hasChildren', 'hasDependency', 'blockedBy', 'blocking', 'unblocked', 'createdFrom', 'createdTo', 'dueFrom', 'dueTo', 'unassigned', 'assigneeIds'];

export function registerWorkItemHandlers(router: MockRouter, db: MockDatabase): void {
  router
    .get('work-items', (req, ctx) => {
      const query = parseListQuery(req.query);
      const visible = new Set([...db.visibleProjectIds(ctx.me)].filter((p) => ctx.can('tasks.view', p)));
      const generic = Object.fromEntries(Object.entries(query.filters).filter(([k]) => !LIST_ONLY_FILTERS.includes(k)));
      const { overdue, includeArchived } = query.filters;
      const extra = listFilters(db, query.filters);
      const scope = (w: WorkItem): boolean =>
        visible.has(w.projectId) && (includeArchived?.[0] === 'true' || !w.archived) && (overdue?.[0] !== 'true' || isOverdue(db, w)) && extra(w);
      const sortField = query.sort?.field;
      let page: PagedResult<WorkItem>;
      if (query.sort && (sortField === 'statusId' || sortField === 'typeId')) {
        // Sort by the configured order of the status / type rather than by its opaque id.
        const all = db.workItems.query({ ...query, sort: undefined, filters: generic, page: 1, pageSize: Number.MAX_SAFE_INTEGER }, scope).items;
        const rank = (w: WorkItem): number => (sortField === 'statusId' ? db.statuses.find(w.statusId)?.order : db.types.find(w.typeId)?.order) ?? 0;
        const factor = query.sort.direction === 'desc' ? -1 : 1;
        const sorted = [...all].sort((a, b) => (rank(a) - rank(b)) * factor);
        const start = (query.page - 1) * query.pageSize;
        page = { items: sorted.slice(start, start + query.pageSize), total: sorted.length, page: query.page, pageSize: query.pageSize };
      } else {
        page = db.workItems.query({ ...query, filters: generic }, scope);
      }
      return { ...page, items: page.items.map((w) => withDev(db, ctx, w)) };
    })
    // Registered before `work-items/:id` so "board" is not read as an id.
    .get('work-items/board', (req, ctx) => {
      const projectId = req.query.get('projectId') ?? '';
      if (!projectId) fail(400, 'المشروع مطلوب.', { projectId: 'مطلوب' });
      ctx.requireProjectVisible(projectId);
      ctx.require('tasks.view', projectId);
      const withGit = ctx.can('git.view', projectId);
      // Only the custom fields an admin marked "show on card" travel with the board (FR-TYP-06), keeping the payload lean.
      const cardKeys = new Map(db.types.all().map((t) => [t.id, new Set(t.fields.filter((f) => f.showOnCard).map((f) => f.key))]));
      const cardFields = (w: WorkItem): Record<string, FieldValue> => {
        const keys = cardKeys.get(w.typeId);
        return keys ? Object.fromEntries(Object.entries(w.fields).filter(([k]) => keys.has(k))) : {};
      };
      return db.workItems.where((w) => w.projectId === projectId && !w.archived).map((w): BoardItem => ({
        id: w.id, ref: w.ref, title: w.title, typeId: w.typeId, statusId: w.statusId, priority: w.priority, assigneeIds: w.assigneeIds,
        dueDate: w.dueDate, parentId: w.parentId, version: w.version, workflowId: effectiveWorkflowId(db, w.projectId, w.typeId),
        fields: cardFields(w),
        ...(withGit ? { dev: devIndicator(db, w) } : {}),
      }));
    })
    .get('work-items/:id', (req, ctx) => withDev(db, ctx, visibleItem(db, ctx, req.params['id'])))
    .post('work-items', (req, ctx) => {
      const dto = body<WorkItemCreate>(req);
      ctx.requireProjectVisible(dto.projectId);
      ctx.require('tasks.create', dto.projectId);
      assertProjectWritable(db, dto.projectId);
      const project = db.projects.get(dto.projectId);
      const type = db.types.get(dto.typeId);
      if (!type.active || !project.allowedTypeIds.includes(type.id)) fail(422, 'هذا النوع غير متاح في المشروع.');
      if (typeof dto.title !== 'string' || !dto.title.trim()) fail(400, 'العنوان مطلوب.', { title: 'مطلوب' });
      if (dto.assigneeIds?.length) ctx.require('tasks.assign', dto.projectId);
      // Same validators as PATCH (priority enum, ISO dates, due >= start, title length, assignees = active project members).
      const supplied: Record<string, unknown> = {};
      for (const key of ['title', 'description', 'priority', 'startDate', 'dueDate', 'assigneeIds'] as const) if (dto[key] !== undefined) supplied[key] = dto[key];
      const checked = validatePatch(db, { projectId: dto.projectId, typeId: dto.typeId, assigneeIds: [], startDate: null, dueDate: null } as unknown as WorkItem, supplied);
      const fieldErrors = validateFields(type.fields, dto.fields ?? {});
      if (Object.keys(fieldErrors).length) fail(400, 'يرجى استكمال حقول النوع المطلوبة.', fieldErrors);
      validateParent(db, dto, dto.parentId);

      const next = Math.max(100, ...db.workItems.where((w) => w.projectId === project.id).map((w) => Number(w.ref.split('-')[1]) || 0)) + 1;
      const item = db.workItems.insert({
        ...dto,
        ...checked,
        priority: checked.priority ?? 'medium',
        ref: `${project.code}-${next}`,
        statusId: effectiveWorkflow(db, project.id, type.id).initialStatusId,
        fields: dto.fields ?? {},
        assigneeIds: dto.assigneeIds ?? [],
        archived: false,
        createdBy: ctx.me,
      });
      db.log(ctx.me, 'workItem.created', { type: 'workItem', id: item.id, label: item.ref, projectId: item.projectId });
      db.notify(item.assigneeIds, 'تم تكليفك بعنصر عمل', `${item.ref} ${item.title}`, `/work-items/${item.id}`, ctx.me);
      return item;
    })
    .patch('work-items/:id', (req, ctx) => {
      const current = visibleItem(db, ctx, req.params['id']);
      assertProjectWritable(db, current.projectId);
      const { version, ...raw } = body<UpdateDto<WorkItem> & Record<string, unknown>>(req);
      const edits = validatePatch(db, current, raw);
      const changedKeys = Object.keys(edits).filter(
        (k) => JSON.stringify((edits as Record<string, unknown>)[k]) !== JSON.stringify((current as unknown as Record<string, unknown>)[k]),
      );
      const assigning = changedKeys.includes('assigneeIds');
      const editing = changedKeys.some((k) => k !== 'assigneeIds');
      // Assignees need tasks.assign; title, description, dates, priority and fields need tasks.edit.
      if (assigning) ctx.require('tasks.assign', current.projectId);
      if (editing) ctx.require('tasks.edit', current.projectId);
      // APPROVAL-GATE:start
      // FR-APR-10 / §4.3: a protected field governed by an active sensitive.change template is never edited directly.
      assertNoDirectSensitiveChange(
        db, { subjectType: 'workItem', subjectId: current.id },
        Object.fromEntries(changedKeys.map((k) => [k, (edits as Record<string, unknown>)[k]])) as Record<string, string | number | null>,
      );
      // APPROVAL-GATE:end
      const changes = Object.fromEntries(changedKeys.map((k) => [k, (edits as Record<string, unknown>)[k]])) as Partial<WorkItem>;
      const next = db.workItems.patch(current.id, changes, version);
      const userNames = (ids: readonly string[]): string => ids.map((id) => db.users.find(id)?.name ?? id).join('، ') || '—';
      const diff = changedKeys.map((k) => {
        const before = (current as unknown as Record<string, unknown>)[k];
        const after = (next as unknown as Record<string, unknown>)[k];
        return k === 'assigneeIds'
          ? { field: k, from: userNames(before as readonly string[]), to: userNames(after as readonly string[]) }
          : { field: k, from: display(before), to: display(after) };
      });
      if (diff.length) {
        db.log(ctx.me, assigning && !editing ? 'workItem.assigned' : 'workItem.updated', { type: 'workItem', id: next.id, label: next.ref, projectId: next.projectId }, diff);
      }
      if (assigning) {
        const added = next.assigneeIds.filter((u) => !current.assigneeIds.includes(u));
        const removed = current.assigneeIds.filter((u) => !next.assigneeIds.includes(u));
        db.notify(added, 'تم تكليفك بعنصر عمل', `${next.ref} ${next.title}`, `/work-items/${next.id}`, ctx.me);
        db.notify(removed, 'أُزيل تكليفك من عنصر عمل', `${next.ref} ${next.title}`, `/work-items/${next.id}`, ctx.me);
      }
      supersedeIfProtected(db, ctx.me, 'workItem', next.id, diff.map((d) => d.field));
      return next;
    })
    .delete('work-items/:id', (req, ctx) => {
      const current = visibleItem(db, ctx, req.params['id']);
      ctx.require('tasks.delete', current.projectId);
      assertProjectWritable(db, current.projectId);
      // Logical delete; children are never cascaded silently (FR-REL-10).
      if (db.workItems.where((w) => w.parentId === current.id && !w.archived).length) {
        fail(422, 'لا يمكن أرشفة عنصر له أبناء نشطون؛ انقل الأبناء أولًا.');
      }
      db.workItems.patch(current.id, { archived: true });
      db.log(ctx.me, 'workItem.updated', { type: 'workItem', id: current.id, label: current.ref, projectId: current.projectId }, [{ field: 'archived', from: 'false', to: 'true' }]);
      return null;
    })
    .post('work-items/:id/transition', (req, ctx) => performTransition(db, ctx, req.params['id'], body<TransitionRequest>(req)))
    .post('work-items/:id/close', (req, ctx) => {
      const { toStatusId, comment, version } = body<CloseRequest>(req);
      const item = visibleItem(db, ctx, req.params['id']);
      const target = pickTarget(db, item, toStatusId, (s) => s.category === 'Done', 'الإغلاق');
      return performTransition(db, ctx, item.id, { toStatusId: target, comment, version });
    })
    .post('work-items/:id/reopen', (req, ctx) => {
      const { toStatusId, comment, version } = body<ReopenRequest>(req);
      const item = visibleItem(db, ctx, req.params['id']);
      if (!comment?.trim()) fail(400, 'سبب إعادة الفتح مطلوب.', { comment: 'مطلوب' });
      if (!isClosed(db, item.statusId)) fail(422, 'يمكن إعادة فتح العناصر المنجزة أو الملغاة فقط.');
      const target = pickTarget(db, item, toStatusId, (s) => s.category !== 'Done' && s.category !== 'Cancelled', 'إعادة الفتح');
      return performTransition(db, ctx, item.id, { toStatusId: target, comment, version });
    })
    .post('work-items/:id/parent', (req, ctx) => {
      const item = visibleItem(db, ctx, req.params['id']);
      assertProjectWritable(db, item.projectId);
      ctx.require('tasks.edit', item.projectId);
      const { parentId, version } = body<{ parentId: string | null; version: number }>(req);
      try {
        validateParent(db, item, parentId);
      } catch (e) {
        // AT-17 / FR-REL-02: a refused hierarchy change (cycle, wrong project, type pair) is itself an audit event,
        // like a refused relation. The audit row is written before re-throwing so the 422 still reaches the client.
        const parent = db.workItems.find(parentId ?? '');
        db.log(ctx.me, 'workItem.parent_rejected', { type: 'workItem', id: item.id, label: item.ref, projectId: item.projectId }, [
          { field: 'الأب المقترح', from: null, to: parent?.ref ?? parentId },
          { field: 'السبب', from: null, to: e instanceof Error ? e.message : 'مرفوض' },
        ], true);
        throw e;
      }
      assertNoDirectSensitiveChange(db, { subjectType: 'workItem', subjectId: item.id }, { parentId }); // APPROVAL-GATE: sensitive.change
      const next = db.workItems.patch(item.id, { parentId }, version);
      db.log(ctx.me, 'workItem.parent', { type: 'workItem', id: item.id, label: item.ref, projectId: item.projectId }, [
        { field: 'الأب', from: db.workItems.find(item.parentId ?? '')?.ref ?? null, to: db.workItems.find(parentId ?? '')?.ref ?? null },
      ]);
      supersedeIfProtected(db, ctx.me, 'workItem', item.id, ['parentId']);
      return next;
    })
    .post('work-items/:id/type-change/check', (req, ctx) => {
      const item = visibleItem(db, ctx, req.params['id']);
      ctx.require('workitem.types.manage', item.projectId);
      return typeChangeConflicts(db, item, body<{ typeId: string }>(req).typeId);
    })
    .post('work-items/:id/type-change', (req, ctx) => {
      const item = visibleItem(db, ctx, req.params['id']);
      assertProjectWritable(db, item.projectId);
      ctx.require('workitem.types.manage', item.projectId);
      const { typeId, version } = body<{ typeId: string; version: number }>(req);
      const conflicts = typeChangeConflicts(db, item, typeId);
      if (conflicts.length) fail(422, `لا يمكن التحويل: ${conflicts.map((c) => c.reason).join('؛ ')}`);
      assertNoDirectSensitiveChange(db, { subjectType: 'workItem', subjectId: item.id }, { typeId }); // APPROVAL-GATE: sensitive.change
      const next = db.workItems.patch(item.id, { typeId }, version);
      supersedeIfProtected(db, ctx.me, 'workItem', item.id, ['typeId']); // FR-APR-10: a type change invalidates pending/approved requests that protect it
      db.log(ctx.me, 'workItem.typeChanged', { type: 'workItem', id: item.id, label: item.ref, projectId: item.projectId }, [
        { field: 'النوع', from: db.types.find(item.typeId)?.key ?? null, to: db.types.find(typeId)?.key ?? null },
      ]);
      return next;
    });

  registerRelationHandlers(router, db);
  registerWorkflowExtras(router, db);
}

/** Defined, active targets from the item's current status that satisfy `accept`; the unique one, or the explicit choice. */
function pickTarget(db: MockDatabase, item: WorkItem, explicit: string | undefined, accept: (s: Status) => boolean, verb: string): string {
  const workflow = effectiveWorkflow(db, item.projectId, item.typeId);
  const candidates = workflow.transitions
    .filter((t) => t.fromStatusId === item.statusId)
    .map((t) => db.statuses.find(t.toStatusId))
    .filter((s): s is Status => !!s && s.active && accept(s));
  if (explicit) {
    if (!candidates.some((s) => s.id === explicit)) fail(422, `الحالة المطلوبة ليست هدفًا صالحًا لـ${verb} من الحالة الحالية.`, { toStatusId: 'غير صالح' });
    return explicit;
  }
  if (candidates.length === 1) return candidates[0].id;
  const message = candidates.length
    ? `يوجد أكثر من حالة ممكنة لـ${verb} (${candidates.map((s) => s.name).join('، ')})؛ حدّد الحالة المطلوبة.`
    : `لا توجد حالة معرّفة لـ${verb} من الحالة الحالية في سير العمل.`;
  return fail(400, message, { toStatusId: 'مطلوب' });
}

/**
 * The one status-change code path (transition, close, reopen): workflow rules, permissions,
 * blocking dependencies, approvals, audit, history record and notifications.
 */
function performTransition(
  db: MockDatabase,
  ctx: MockContext,
  itemId: string,
  { toStatusId, comment, version }: TransitionRequest,
  action = 'workItem.transition',
): WorkItem {
  const item = visibleItem(db, ctx, itemId);
  assertProjectWritable(db, item.projectId);
  ctx.require('workflow.transition', item.projectId);
  const workflow = effectiveWorkflow(db, item.projectId, item.typeId);
  const transition = workflow.transitions.find((t) => t.fromStatusId === item.statusId && t.toStatusId === toStatusId);
  const from = db.statuses.get(item.statusId);
  const to = db.statuses.get(toStatusId);
  if (!transition) fail(422, `الانتقال من «${from.name}» إلى «${to.name}» غير معرّف في سير العمل.`);
  if (!to.active) fail(422, 'الحالة المطلوبة معطّلة.');
  if (transition.permission) ctx.require(transition.permission, item.projectId);
  if (transition.requiresAssignee && !item.assigneeIds.length) fail(422, 'يتطلب هذا الانتقال وجود مسؤول للعنصر.');
  if (transition.blockedByOpenDependencies) {
    const blockers = db.relations
      .where((r) => r.targetId === item.id && db.relationTypes.find(r.relationTypeId)?.key === 'blocks')
      .map((r) => db.workItems.find(r.sourceId))
      .filter((w): w is WorkItem => !!w && !isClosed(db, w.statusId));
    if (blockers.length) fail(422, `لا يمكن الإغلاق: العنصر محجوب بواسطة ${blockers.map((b) => b.ref).join('، ')}.`);
  }
  // APPROVAL-GATE:start
  // FR-APR-08/10: needs an Approved, unconsumed workItem.approve request whose protected fields are unchanged.
  const gate = transition.requiresApproval
    ? requireApproval(db, ctx, { subjectType: 'workItem', subjectId: item.id, action: isClosed(db, from.id) ? 'reopen' : 'close', targetStatusId: to.id })
    : null;
  // APPROVAL-GATE:end
  const next = db.workItems.patch(item.id, { statusId: toStatusId }, version);
  if (gate) consumeApproval(db, gate); // single use: the approval authorised exactly this transition
  db.log(ctx.me, action, { type: 'workItem', id: item.id, label: item.ref, projectId: item.projectId }, [
    { field: 'الحالة', from: `${from.name} (${from.key})`, to: `${to.name} (${to.key})` },
    ...(comment ? [{ field: 'تعليق', from: null, to: comment }] : []),
  ]);
  recordTransition(db, { subjectType: 'workItem', itemId: item.id, projectId: item.projectId, fromStatusId: from.id, toStatusId: to.id, actorId: ctx.me, comment });
  db.notify(item.assigneeIds, 'تغيّرت حالة عنصر عمل', `${item.ref}: ${from.name} ← ${to.name}`, `/work-items/${item.id}`, ctx.me);
  return next;
}

/** FR-TYP-08: report every incompatibility instead of silently dropping data. */
function typeChangeConflicts(db: MockDatabase, item: WorkItem, typeId: string): TypeChangeConflict[] {
  const target = db.types.get(typeId);
  const conflicts: TypeChangeConflict[] = [];
  const project = db.projects.get(item.projectId);
  if (!target.active || !project.allowedTypeIds.includes(typeId)) conflicts.push({ field: 'type', reason: 'النوع غير متاح في المشروع' });
  const workflow = effectiveWorkflow(db, item.projectId, typeId);
  if (!workflow.statusIds.includes(item.statusId)) {
    conflicts.push({ field: 'status', reason: `الحالة «${db.statuses.find(item.statusId)?.name}» غير موجودة في سير عمل «${target.name}»` });
  }
  for (const [key, msg] of Object.entries(validateFields(target.fields, item.fields))) conflicts.push({ field: key, reason: msg });
  const lost = Object.keys(item.fields).filter((k) => item.fields[k] !== null && !target.fields.some((f) => f.key === k));
  for (const key of lost) conflicts.push({ field: key, reason: `الحقل «${key}» سيُفقد لأنه غير معرّف في النوع الجديد` });
  if (item.parentId) {
    const parentType = db.types.find(db.workItems.find(item.parentId)?.typeId ?? '');
    if (parentType && !parentType.allowedChildTypeIds.includes(typeId)) conflicts.push({ field: 'parent', reason: `«${target.name}» غير مسموح كابن لـ «${parentType.name}»` });
  }
  for (const child of db.workItems.where((w) => w.parentId === item.id && !w.archived)) {
    if (!target.allowedChildTypeIds.includes(child.typeId)) conflicts.push({ field: 'children', reason: `الابن ${child.ref} غير مسموح تحت «${target.name}»` });
  }
  if (db.approvals.where((a) => a.subjectId === item.id && a.status === 'PendingApproval').length) {
    conflicts.push({ field: 'approval', reason: 'يوجد طلب موافقة معلّق على العنصر' });
  }
  return conflicts;
}

/** True when adding source→target to an acyclic relation type closes a loop. */
function createsRelationCycle(db: MockDatabase, relationTypeId: string, sourceId: string, targetId: string): boolean {
  const edges = db.relations.where((r) => r.relationTypeId === relationTypeId);
  const stack = [targetId];
  const seen = new Set<string>();
  while (stack.length) {
    const node = stack.pop()!;
    if (node === sourceId) return true;
    if (seen.has(node)) continue;
    seen.add(node);
    for (const edge of edges) if (edge.sourceId === node) stack.push(edge.targetId);
  }
  return false;
}

function registerRelationHandlers(router: MockRouter, db: MockDatabase): void {
  router
    .get('relations/by-item/:id', (req, ctx) => {
      const item = visibleItem(db, ctx, req.params['id']);
      ctx.require('workitem.relations.view', item.projectId);
      // Only relations whose other side the caller may also see (FR-REL-06).
      return db.relations.where((r) => {
        if (r.sourceId !== item.id && r.targetId !== item.id) return false;
        const other = db.workItems.find(r.sourceId === item.id ? r.targetId : r.sourceId);
        return !!other && db.canSeeProject(ctx.me, other.projectId);
      });
    })
    .get('relations/by-project/:projectId', (req, ctx) => {
      const projectId = req.params['projectId'];
      ctx.requireProjectVisible(projectId);
      ctx.require('workitem.relations.view', projectId);
      const ids = new Set(db.workItems.where((w) => w.projectId === projectId && !w.archived).map((w) => w.id));
      // Both ends inside the project (cross-project links are disabled by policy, FR-REL-07).
      return db.relations.where((r) => ids.has(r.sourceId) && ids.has(r.targetId));
    })
    .post('relations', (req, ctx) => {
      const { sourceId, targetId, relationTypeId, sourceVersion, targetVersion } = body<
        Pick<WorkItemRelation, 'sourceId' | 'targetId' | 'relationTypeId'> & { sourceVersion?: number; targetVersion?: number }
      >(req);
      const source = visibleItem(db, ctx, sourceId);
      ctx.require('workitem.relations.create', source.projectId);
      const target = visibleItem(db, ctx, targetId);
      const type = db.relationTypes.get(relationTypeId);
      const reject = (message: string): never => {
        db.log(ctx.me, 'relation.rejected', { type: 'relation', id: '-', label: `${source.ref} → ${target.ref}`, projectId: source.projectId }, [{ field: 'السبب', from: null, to: message }]);
        return fail(422, message);
      };
      if (!type.active) reject('نوع الرابط معطّل.');
      if (source.id === target.id) reject('لا يمكن ربط العنصر بنفسه.');
      if (source.projectId !== target.projectId) {
        // FR-REL-07: only when the organisation allows it AND the caller may link in both projects.
        if (!db.settings.allowCrossProjectRelations) reject('الروابط بين المشاريع غير مسموحة وفق سياسة المؤسسة الحالية.');
        ctx.require('workitem.relations.create', target.projectId);
      }
      assertProjectWritable(db, source.projectId);
      assertProjectWritable(db, target.projectId);
      // FR-REL-13: optimistic concurrency on both ends.
      if ((sourceVersion !== undefined && sourceVersion !== source.version) || (targetVersion !== undefined && targetVersion !== target.version)) {
        fail(409, 'عدّل مستخدم آخر أحد العنصرين. أعد التحميل ثم حاول مجددًا.');
      }
      if (!relationPairAllowed(type, source.typeId, target.typeId)) {
        const sourceType = db.types.find(source.typeId)?.name;
        const targetType = db.types.find(target.typeId)?.name;
        reject(`نوع الرابط «${type.name}» لا يسمح بالربط بين «${sourceType}» و«${targetType}».`);
      }
      const duplicate = db.relations.where(
        (r) => r.relationTypeId === type.id &&
          ((r.sourceId === source.id && r.targetId === target.id) || (r.sourceId === target.id && r.targetId === source.id)),
      ).length;
      if (duplicate) reject(type.directed ? 'هذا الرابط أو عكسه موجود مسبقًا.' : 'هذا الرابط موجود مسبقًا.');
      if (type.acyclic && createsRelationCycle(db, type.id, source.id, target.id)) reject(`الرابط يُنشئ حلقة «${type.name}» دائرية.`);
      const relation = db.relations.insert({ sourceId, targetId, relationTypeId, createdBy: ctx.me });
      logRelation(db, ctx.me, 'relation.created', relation.id, `${source.ref} ${type.name} ${target.ref}`, source, target);
      supersedeIfProtected(db, ctx.me, 'workItem', source.id, ['relations']);
      supersedeIfProtected(db, ctx.me, 'workItem', target.id, ['relations']);
      return relation;
    })
    .delete('relations/:id', (req, ctx) => {
      const relation = db.relations.get(req.params['id']);
      const source = visibleItem(db, ctx, relation.sourceId);
      ctx.require('workitem.relations.delete', source.projectId);
      const target = db.workItems.find(relation.targetId);
      if (target && target.projectId !== source.projectId) ctx.require('workitem.relations.delete', target.projectId);
      assertProjectWritable(db, source.projectId);
      if (target) assertProjectWritable(db, target.projectId);
      db.relations.delete(relation.id);
      logRelation(db, ctx.me, 'relation.deleted', relation.id, `${source.ref} → ${target?.ref ?? '?'}`, source, target);
      supersedeIfProtected(db, ctx.me, 'workItem', source.id, ['relations']);
      if (target) supersedeIfProtected(db, ctx.me, 'workItem', target.id, ['relations']);
      return null;
    });
}

/** Audit row on the project of each end (once when both ends share a project) naming both refs (FR-REL-06). */
function logRelation(db: MockDatabase, actorId: string, action: string, relationId: string, label: string, source: WorkItem, target: WorkItem | undefined): void {
  const projectIds = [...new Set([source.projectId, target?.projectId ?? source.projectId])];
  for (const projectId of projectIds) db.log(actorId, action, { type: 'relation', id: relationId, label, projectId });
}
