import { AUDIT_ACTION_LABELS, AuditEvent, AuditVerification, Comment, DashboardStats, NotificationPage, TypeStats } from '@domain/activity/activity.models';
import { STATUS_CATEGORIES } from '@domain/workflow/workflow.models';
import { WorkItem } from '@domain/work-items/work-item.models';
import { MockDatabase } from '../../db/database';
import { isPastDue, orgToday } from '../../db/time';
import { body, fail, MockContext, MockRouter, parseListQuery } from '../router';


/** Whole-token @mention: "@ali" must not match inside "@alice". */
function mentions(text: string, username: string): boolean {
  const escaped = username.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  return new RegExp(`(^|\\s)@${escaped}(?![\\w.-])`).test(text);
}

function subjectProjectId(db: MockDatabase, subjectType: Comment['subjectType'], subjectId: string): string {
  if (subjectType === 'project') return db.projects.get(subjectId).id;
  if (subjectType === 'workItem') return db.workItems.get(subjectId).projectId;
  return db.approvals.get(subjectId).projectId;
}

/** Display label of a comment's subject, captured into the audit event. */
function subjectLabel(db: MockDatabase, subjectType: Comment['subjectType'], subjectId: string): string {
  if (subjectType === 'project') return db.projects.get(subjectId).name;
  if (subjectType === 'workItem') return db.workItems.get(subjectId).ref;
  return db.approvals.get(subjectId).title;
}

/** Writes on an archived project are refused server-side (AT-14). */
function requireWritable(db: MockDatabase, projectId: string): void {
  if (db.projects.get(projectId).archived) fail(422, 'المشروع مؤرشف ولا يقبل تغييرات على تعليقاته.');
}

function requireSubject(db: MockDatabase, ctx: MockContext, subjectType: Comment['subjectType'], subjectId: string): string {
  const projectId = subjectProjectId(db, subjectType, subjectId);
  ctx.requireProjectVisible(projectId);
  return projectId;
}

export function registerActivityHandlers(router: MockRouter, db: MockDatabase): void {
  // ---------- Comments ----------
  router
    .get('comments/by-subject', (req, ctx) => {
      const subjectType = req.query.get('subjectType') as Comment['subjectType'];
      const subjectId = req.query.get('subjectId') ?? '';
      requireSubject(db, ctx, subjectType, subjectId);
      return db.comments
        .where((c) => c.subjectType === subjectType && c.subjectId === subjectId)
        .map((c) => (c.deleted ? { ...c, body: '', revisions: [] } : c))
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    })
    .post('comments', (req, ctx) => {
      const { subjectType, subjectId, body: text } = body<Pick<Comment, 'subjectType' | 'subjectId' | 'body'>>(req);
      const projectId = requireSubject(db, ctx, subjectType, subjectId);
      ctx.require('comments.create', projectId);
      requireWritable(db, projectId);
      if (!text?.trim()) fail(400, 'نص التعليق مطلوب.', { body: 'مطلوب' });
      const comment = db.comments.insert({
        subjectType, subjectId, authorId: ctx.me, body: text.trim(), edited: false, deleted: false,
        revisions: [{ body: text.trim(), editedAt: new Date().toISOString() }],
      });
      db.log(ctx.me, 'comment.created', { type: subjectType, id: subjectId, label: subjectLabel(db, subjectType, subjectId), projectId });
      // @mentions (FR-COL-07): notify mentioned users who can see the project.
      const mentioned = db.users.where((u) => mentions(text, u.username) && db.canSeeProject(u.id, projectId)).map((u) => u.id);
      db.notify(mentioned, 'تمت الإشارة إليك في تعليق', text.slice(0, 80), subjectType === 'workItem' ? `/work-items/${subjectId}` : `/projects/${projectId}`, ctx.me);
      return comment;
    })
    .patch('comments/:id', (req, ctx) => {
      const current = db.comments.get(req.params['id']);
      const projectId = requireSubject(db, ctx, current.subjectType, current.subjectId);
      ctx.require('comments.edit_own', projectId);
      requireWritable(db, projectId);
      if (current.authorId !== ctx.me) fail(403, 'يمكنك تعديل تعليقاتك فقط.');
      const hours = db.settings.commentEditHours;
      if (Date.now() - new Date(current.createdAt).getTime() > hours * 3_600_000) fail(422, `انتهت مدة تعديل التعليق (${hours} ساعة).`);
      const { body: text, version } = body<{ body: string; version: number }>(req);
      if (!text?.trim()) fail(400, 'نص التعليق مطلوب.', { body: 'مطلوب' });
      // The first revision is the original text; every edit appends one (FR-COL-02).
      const history = current.revisions.length ? current.revisions : [{ body: current.body, editedAt: current.createdAt }];
      const next = db.comments.patch(
        current.id,
        { body: text.trim(), edited: true, revisions: [...history, { body: text.trim(), editedAt: new Date().toISOString() }] },
        version,
      );
      db.log(ctx.me, 'comment.edited', { type: current.subjectType, id: current.subjectId, label: subjectLabel(db, current.subjectType, current.subjectId), projectId }, [
        { field: 'النص', from: current.body, to: text.trim() },
      ]);
      return next;
    })
    .delete('comments/:id', (req, ctx) => {
      const current = db.comments.get(req.params['id']);
      const projectId = requireSubject(db, ctx, current.subjectType, current.subjectId);
      requireWritable(db, projectId);
      if (current.authorId !== ctx.me) ctx.require('files.delete', projectId);
      db.comments.patch(current.id, { deleted: true });
      db.log(ctx.me, 'comment.deleted', { type: current.subjectType, id: current.subjectId, label: subjectLabel(db, current.subjectType, current.subjectId), projectId });
      return null;
    })
    .get('comments/:id/revisions', (req, ctx) => {
      const current = db.comments.get(req.params['id']);
      requireSubject(db, ctx, current.subjectType, current.subjectId);
      if (current.deleted) return [];
      return current.revisions.length ? current.revisions : [{ body: current.body, editedAt: current.createdAt }];
    });

  // ---------- Audit (read-only, append-only) ----------
  /** FR-AUD-09: recompute the hash chain; reports the first event that no longer matches. */
  router.get('audit/verify', (_req, ctx): AuditVerification => {
    ctx.require('audit.view');
    const events = db.audit.all();
    let prev = '';
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.prevHash !== prev || e.hash !== db.auditHashOf(prev, e)) return { ok: false, checked: i + 1, brokenAt: e.id };
      prev = e.hash;
    }
    return { ok: true, checked: events.length };
  });

  // Filters: from, to, plus equality on any field (subjectId, correlationId, actorId, action, subjectType, source…).
  // `search` is free text over subject label, action key and the action's Arabic label.
  router.get('audit', (req, ctx) => {
    const { search, ...query } = parseListQuery(req.query);
    const { from, to, ...filters } = query.filters;
    const visible = db.visibleProjectIds(ctx.me);
    const securityAccess = ctx.can('audit.view');
    const term = search?.trim().toLowerCase();
    const matchesText = (e: AuditEvent): boolean =>
      !term || [e.subjectLabel, e.action, AUDIT_ACTION_LABELS[e.action] ?? ''].some((v) => v.toLowerCase().includes(term));
    return db.audit.query({ ...query, filters, sort: query.sort ?? { field: 'at', direction: 'desc' } }, (e) => {
      // Security log only for audit.view; activity feed limited to visible projects (FR-AUD-03).
      if (e.security && !securityAccess) return false;
      if (!securityAccess && (!e.projectId || !visible.has(e.projectId))) return false;
      if (from?.[0] && e.at < from[0]) return false;
      if (to?.[0] && e.at.slice(0, 10) > to[0]) return false;
      return matchesText(e);
    });
  });

  // ---------- Notifications ----------
  router
    .get('notifications/all', (req, ctx): NotificationPage => {
      const page = Math.max(1, Number(req.query.get('page') ?? 1));
      const pageSize = Math.min(100, Math.max(1, Number(req.query.get('pageSize') ?? 30)));
      const mine = db.notifications.where((n) => n.userId === ctx.me).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { items: mine.slice((page - 1) * pageSize, page * pageSize), total: mine.length, page, pageSize, unread: mine.filter((n) => !n.read).length };
    })
    .patch('notifications/:id', (req, ctx) => {
      const n = db.notifications.get(req.params['id']);
      if (n.userId !== ctx.me) fail(404, 'غير موجود');
      return db.notifications.patch(n.id, { read: true });
    })
    .post('notifications/read-all', (_req, ctx) => {
      for (const n of db.notifications.where((x) => x.userId === ctx.me && !x.read)) db.notifications.patch(n.id, { read: true });
      return null;
    });

  // ---------- Git events ----------
  router.get('git-events', (req, ctx) => {
    const query = parseListQuery(req.query);
    const visible = new Set([...db.visibleProjectIds(ctx.me)].filter((p) => ctx.can('git.view', p)));
    const { workItemRef, ...filters } = query.filters;
    return db.gitEvents.query({ ...query, filters, sort: query.sort ?? { field: 'createdAt', direction: 'desc' } }, (g) =>
      visible.has(g.projectId) && (!workItemRef || g.workItemRefs.some((r) => workItemRef.includes(r))),
    );
  });

  // ---------- Dashboard ----------
  // Query: projectId, from, to (YYYY-MM-DD, org zone), statusCategory (comma list), assigneeId.
  // Period = items whose range [startDate ?? createdAt, dueDate ?? updatedAt] OVERLAPS [from, to].
  router.get('dashboard/stats', (req, ctx): DashboardStats => {
    const tz = db.settings.timeZone;
    const projectFilter = req.query.get('projectId');
    const from = req.query.get('from');
    const to = req.query.get('to');
    const categories = (req.query.get('statusCategory') ?? '').split(',').filter(Boolean);
    const assigneeId = req.query.get('assigneeId');
    const visible = db.visibleProjectIds(ctx.me);
    const projects = db.projects.where((p) => visible.has(p.id) && !p.archived && (!projectFilter || p.id === projectFilter));
    const projectIds = new Set(projects.map((p) => p.id));
    const category = (statusId: string): string => db.statuses.find(statusId)?.category ?? 'NotStarted';
    const isClosed = (statusId: string): boolean => ['Done', 'Cancelled'].includes(category(statusId));
    const day = (iso: string): string => orgToday(tz, new Date(iso));
    const overlaps = (w: WorkItem): boolean => {
      const start = w.startDate ?? day(w.createdAt);
      const end = w.dueDate ?? day(w.updatedAt);
      const [lo, hi] = start <= end ? [start, end] : [end, start];
      return (!from || hi >= from) && (!to || lo <= to);
    };

    const all = db.workItems.where((w) => projectIds.has(w.projectId) && !w.archived);
    const items = all.filter(
      (w) => overlaps(w) && (!categories.length || categories.includes(category(w.statusId))) && (!assigneeId || w.assigneeIds.includes(assigneeId)),
    );
    const emptyCategories = (): Record<string, number> => Object.fromEntries(STATUS_CATEGORIES.map((c) => [c, 0]));

    // byCategory counts every item (parents too); leafByCategory counts leaves only, the completion definition (§4.4).
    const parents = new Set(all.map((w) => w.parentId).filter(Boolean));
    const byCategory = emptyCategories();
    const leafByCategory = emptyCategories();
    for (const w of items) {
      byCategory[category(w.statusId)]++;
      if (!parents.has(w.id)) leafByCategory[category(w.statusId)]++;
    }

    // Leaves only, cancelled excluded from the total, so nothing is counted twice.
    const byType: TypeStats[] = db.types.all().map((t) => {
      const leaves = items.filter((w) => w.typeId === t.id && !parents.has(w.id) && category(w.statusId) !== 'Cancelled');
      const perCategory = emptyCategories();
      leaves.forEach((w) => perCategory[category(w.statusId)]++);
      return { typeId: t.id, total: leaves.length, done: perCategory['Done'], byCategory: perCategory };
    }).filter((t) => t.total > 0);

    // Blocked = target of a "blocks" link whose source is still open, while the target itself is open.
    const itemIds = new Set(items.map((w) => w.id));
    const openBlocks = db.relations
      .where((r) => db.relationTypes.find(r.relationTypeId)?.key === 'blocks' && itemIds.has(r.targetId))
      .filter((r) => {
        const source = db.workItems.find(r.sourceId);
        const target = db.workItems.find(r.targetId);
        return !!source && !!target && !isClosed(source.statusId) && !isClosed(target.statusId);
      });
    const blockedIds = new Set(openBlocks.map((r) => r.targetId));
    const blockingIds = new Set(openBlocks.map((r) => r.sourceId));
    const open = items.filter((w) => !isClosed(w.statusId));

    const gitProjects = new Set([...projectIds].filter((id) => ctx.can('git.view', id)));
    const gitActivity = db.gitEvents.where((g) => {
      if (!gitProjects.has(g.projectId)) return false;
      const d = day(g.createdAt);
      return (!from || d >= from) && (!to || d <= to);
    }).length;

    return {
      activeProjects: projects.filter((p) => db.statuses.find(p.statusId)?.category === 'Active').length,
      totalProjects: projects.length,
      openWorkItems: open.length,
      overdueWorkItems: open.filter((w) => isPastDue(w.dueDate, tz)).length,
      pendingApprovals: db.approvals.where((a) => a.status === 'PendingApproval' && a.requesterId !== ctx.me && db.stageApprovers(a.stages.find((s) => s.order === a.currentStage)!, a.projectId).includes(ctx.me)).length,
      byCategory,
      leafByCategory,
      byType,
      blockedItems: blockedIds.size,
      dependencies: {
        blockedItems: blockedIds.size,
        blockingItems: blockingIds.size,
        // Share of open items in scope that wait on an open blocker.
        itemsWithOpenDependencyPct: open.length ? Math.round((blockedIds.size / open.length) * 100) : 0,
      },
      gitActivity,
    };
  });
}
