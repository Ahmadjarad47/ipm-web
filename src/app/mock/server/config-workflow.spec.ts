import { HttpParams } from '@angular/common/http';
import { beforeEach, describe, expect, it } from 'vitest';
import { PagedResult } from '@core/models/entity.model';
import { FieldDefinition, HierarchyPair, RelationType, WorkItem, WorkItemType } from '@domain/work-items/work-item.models';
import { Status, TransitionRecord, Workflow } from '@domain/workflow/workflow.models';
import { MockHttpError } from '../db/collection';
import { MockDatabase } from '../db/database';
import { registerApprovalHandlers } from './handlers/approvals.handlers';
import { registerConfigHandlers } from './handlers/config.handlers';
import { registerExtraHandlers } from './handlers/extras.handlers';
import { registerGitHandlers } from './handlers/git.handlers';
import { registerProjectHandlers } from './handlers/projects.handlers';
import { registerWorkItemHandlers } from './handlers/work-items.handlers';
import { Method, MockContext, MockRouter } from './router';

describe('Types, workflows, relations, PATCH, close/reopen, filters and overrides (mock API)', () => {
  let db: MockDatabase;
  let router: MockRouter;

  beforeEach(() => {
    db = new MockDatabase();
    router = new MockRouter();
    registerConfigHandlers(router, db);
    registerProjectHandlers(router, db);
    registerWorkItemHandlers(router, db);
    registerApprovalHandlers(router, db);
    registerExtraHandlers(router, db);
    registerGitHandlers(router, db);
  });

  function call<T = unknown>(userId: string | null, method: Method, path: string, body: unknown = {}, query = new HttpParams()): T {
    const match = router.match(method, path);
    if (!match) throw new Error(`no route ${method} ${path}`);
    return match.route.handler({ method, path, params: match.params, query, body }, new MockContext(db, userId)) as T;
  }

  function failure(fn: () => unknown): MockHttpError {
    try {
      fn();
    } catch (e) {
      if (e instanceof MockHttpError) return e;
      throw e;
    }
    throw new Error('expected the call to fail');
  }

  const status = (fn: () => unknown): number => {
    try {
      fn();
      return 200;
    } catch (e) {
      if (e instanceof MockHttpError) return e.status;
      throw e;
    }
  };

  const ADMIN = 'u-1';
  const PM = 'u-2';
  const version = (id: string): number => db.workItems.get(id).version;
  const list = (filters: Record<string, string>, extra: Record<string, string> = {}): WorkItem[] => {
    let q = new HttpParams().set('pageSize', '100');
    for (const [k, v] of Object.entries(filters)) q = q.set(`filter.${k}`, v);
    for (const [k, v] of Object.entries(extra)) q = q.set(k, v);
    return call<PagedResult<WorkItem>>(PM, 'GET', 'work-items', {}, q).items.filter((w) => w.projectId === 'p-erp');
  };
  const newType = (over: Partial<WorkItemType> = {}) => ({
    key: 'risk', name: 'مخاطرة', description: '', color: '#aa3300', icon: 'task', order: 9, active: true,
    workflowId: 'wf-standard', allowedChildTypeIds: [], fields: [], ...over,
  });

  // ---------- 1. validation ----------

  it('FR-TYP-01/02/06: work item types are validated server-side', () => {
    expect(call<WorkItemType>(ADMIN, 'POST', 'work-item-types', newType()).key).toBe('risk');
    expect(status(() => call(ADMIN, 'POST', 'work-item-types', newType({ key: 'risk' })))).toBe(400); // duplicate
    expect(status(() => call(ADMIN, 'POST', 'work-item-types', newType({ key: '1bad' })))).toBe(400);
    expect(status(() => call(ADMIN, 'POST', 'work-item-types', newType({ key: 'ok2', name: ' ' })))).toBe(400);
    expect(status(() => call(ADMIN, 'POST', 'work-item-types', newType({ key: 'ok3', color: 'red' })))).toBe(400);
    expect(status(() => call(ADMIN, 'POST', 'work-item-types', newType({ key: 'ok4', icon: 'rocket' as WorkItemType['icon'] })))).toBe(400);
    expect(status(() => call(ADMIN, 'POST', 'work-item-types', newType({ key: 'ok5', workflowId: 'wf-project' })))).toBe(400);
    expect(status(() => call(ADMIN, 'POST', 'work-item-types', newType({ key: 'ok6', allowedChildTypeIds: ['nope'] })))).toBe(400);
    const f = (over: Partial<FieldDefinition>): FieldDefinition => ({ key: 'f1', label: 'حقل', type: 'text', required: false, ...over });
    const withFields = (fields: FieldDefinition[]) => newType({ key: 'ok7', fields });
    expect(status(() => call(ADMIN, 'POST', 'work-item-types', withFields([f({}), f({})])))).toBe(400); // duplicate key
    expect(status(() => call(ADMIN, 'POST', 'work-item-types', withFields([f({ type: 'select' })])))).toBe(400); // no options
    expect(status(() => call(ADMIN, 'POST', 'work-item-types', withFields([f({ type: 'number', min: 5, max: 1 })])))).toBe(400);
    expect(status(() => call(ADMIN, 'POST', 'work-item-types', withFields([f({ label: '' })])))).toBe(400);
    expect(status(() => call(ADMIN, 'POST', 'work-item-types', withFields([f({ showInList: 'yes' as unknown as boolean })])))).toBe(400);
    expect(status(() => call(ADMIN, 'POST', 'work-item-types', withFields([f({ type: 'select', options: [{ value: 'a', label: 'A' }, { value: 'a', label: 'B' }] })])))).toBe(400);
    expect(call<WorkItemType>(ADMIN, 'POST', 'work-item-types', withFields([f({ type: 'select', options: [{ value: 'a', label: 'A' }], showInList: true, order: 1 })])).fields.length).toBe(1);
  });

  it('FR-TYP-10: the field display config is seeded for business_value and severity', () => {
    expect(db.types.get('t-feature').fields.find((x) => x.key === 'business_value')?.showOnCard).toBe(true);
    expect(db.types.get('t-bug').fields.find((x) => x.key === 'severity')?.showInList).toBe(true);
  });

  it('FR-WF-01/03: statuses are validated and their scope is immutable', () => {
    const base = { key: 'qa', name: 'اختبار', description: '', color: '#123456', category: 'Active', scope: 'workItem', order: 9, active: true };
    expect(call<Status>(ADMIN, 'POST', 'statuses', base).key).toBe('qa');
    expect(status(() => call(ADMIN, 'POST', 'statuses', base))).toBe(400); // duplicate in scope
    expect(call<Status>(ADMIN, 'POST', 'statuses', { ...base, scope: 'project' }).scope).toBe('project'); // same key, other scope
    expect(status(() => call(ADMIN, 'POST', 'statuses', { ...base, key: 'qb', category: 'Weird' }))).toBe(400);
    expect(status(() => call(ADMIN, 'POST', 'statuses', { ...base, key: 'qc', color: '12' }))).toBe(400);
    expect(status(() => call(ADMIN, 'PATCH', 'statuses/s-pending', { scope: 'project', version: 1 }))).toBe(422);
  });

  it('FR-WF-07: workflows need a valid initial status, same-scope statuses and sane transitions', () => {
    const wf = { key: 'mini', name: 'مصغر', scope: 'workItem', statusIds: ['s-pending', 's-progress'], initialStatusId: 's-pending', transitions: [{ fromStatusId: 's-pending', toStatusId: 's-progress' }] };
    expect(call<Workflow>(ADMIN, 'POST', 'workflows', wf).key).toBe('mini');
    expect(status(() => call(ADMIN, 'POST', 'workflows', { ...wf, key: 'm2', initialStatusId: 's-review' }))).toBe(400);
    expect(status(() => call(ADMIN, 'POST', 'workflows', { ...wf, key: 'm3', statusIds: ['s-pending', 'ps-active'] }))).toBe(400);
    expect(status(() => call(ADMIN, 'POST', 'workflows', { ...wf, key: 'm4', transitions: [{ fromStatusId: 's-pending', toStatusId: 's-pending' }] }))).toBe(400);
    expect(status(() => call(ADMIN, 'POST', 'workflows', { ...wf, key: 'm5', transitions: [{ fromStatusId: 's-pending', toStatusId: 's-review' }] }))).toBe(400);
    expect(status(() => call(ADMIN, 'POST', 'workflows', { ...wf, key: 'm6', transitions: wf.transitions.concat(wf.transitions) }))).toBe(400);
  });

  it('FR-REL: relation types need valid keys and symmetric names for undirected links', () => {
    const rt = { key: 'causes', name: 'يسبب', inverseName: 'ناتج عن', directed: true, active: true, acyclic: false };
    expect(call<RelationType>(ADMIN, 'POST', 'relation-types', rt).key).toBe('causes');
    expect(status(() => call(ADMIN, 'POST', 'relation-types', rt))).toBe(400);
    expect(status(() => call(ADMIN, 'POST', 'relation-types', { ...rt, key: 'sym', directed: false }))).toBe(400);
    expect(call<RelationType>(ADMIN, 'POST', 'relation-types', { ...rt, key: 'sym', directed: false, inverseName: 'يسبب' }).directed).toBe(false);
  });

  // ---------- 2. impact-checked deactivation & re-binding ----------

  it('FR-TYP-09: a project default type cannot be deactivated; impact endpoint lists it', () => {
    const impact = call<{ items: number; asDefaultIn: { id: string }[] }>(ADMIN, 'GET', 'work-item-types/t-task/impact');
    expect(impact.asDefaultIn.map((p) => p.id)).toContain('p-erp');
    expect(impact.items).toBeGreaterThan(0);
    const e = failure(() => call(ADMIN, 'PATCH', 'work-item-types/t-task', { active: false, version: 1 }));
    expect(e.status).toBe(422);
    expect(e.details).toHaveProperty('ERP');
    expect(call<WorkItemType>(ADMIN, 'PATCH', 'work-item-types/t-subtask', { active: false, version: 1 }).active).toBe(false);
  });

  it('FR-WF-06: an initial status cannot be deactivated; removing a used status lists counts', () => {
    expect(call<{ asDefaultIn: { id: string }[] }>(ADMIN, 'GET', 'statuses/s-pending/impact').asDefaultIn.map((w) => w.id)).toContain('wf-standard');
    expect(status(() => call(ADMIN, 'PATCH', 'statuses/s-pending', { active: false, version: 1 }))).toBe(422);
    expect(call<Status>(ADMIN, 'PATCH', 'statuses/s-rejected', { active: false, version: 1 }).active).toBe(false);

    const wf = db.workflows.get('wf-standard');
    const e = failure(() =>
      call(ADMIN, 'PATCH', 'workflows/wf-standard', {
        statusIds: wf.statusIds.filter((s) => s !== 's-blocked'),
        transitions: wf.transitions.filter((t) => t.fromStatusId !== 's-blocked' && t.toStatusId !== 's-blocked'),
        version: wf.version,
      }),
    );
    expect(e.status).toBe(422);
    expect(e.details?.['محجوب']).toBe('1');
  });

  it('FR-TYP-05: re-binding a type to a workflow lacking the status of existing items is rejected', () => {
    const e = failure(() => call(ADMIN, 'PATCH', 'work-item-types/t-task', { workflowId: 'wf-bug', version: 1 }));
    expect(e.status).toBe(422);
    expect(e.details?.['محجوب']).toBe('1');
    expect(call<WorkItemType>(ADMIN, 'PATCH', 'work-item-types/t-bug', { workflowId: 'wf-standard', version: 1 }).workflowId).toBe('wf-standard');
  });

  // ---------- 3. audit + permission split ----------

  it('FR-TYP-10: field changes are audited one readable row each', () => {
    const fields: FieldDefinition[] = [...db.types.get('t-bug').fields.filter((f) => f.key !== 'environment'), { key: 'impact', label: 'الأثر', type: 'text', required: false }];
    call(ADMIN, 'PATCH', 'work-item-types/t-bug', { fields, version: 1 });
    const event = db.audit.where((a) => a.subjectId === 't-bug' && a.action === 'type.updated').at(-1)!;
    const to = event.changes.map((c) => c.to);
    expect(to.some((t) => t?.startsWith('حقل مضاف: impact'))).toBe(true);
    expect(to).toContain('حقل محذوف: environment');
    expect(event.changes.every((c) => !c.to?.startsWith('['))).toBe(true);
  });

  it('FR-TYP-10: workflow transitions and statuses are audited readably', () => {
    const wf = db.workflows.get('wf-standard');
    call(ADMIN, 'PATCH', 'workflows/wf-standard', { transitions: [...wf.transitions, { fromStatusId: 's-review', toStatusId: 's-cancelled' }], version: wf.version });
    const event = db.audit.where((a) => a.subjectId === 'wf-standard' && a.action === 'status.updated').at(-1)!;
    expect(event.changes.map((c) => c.to)).toContain('انتقال مضاف: قيد المراجعة ← ملغى');
  });

  it('workitem.fields.manage alone edits fields only; type-change/check needs workitem.types.manage', () => {
    db.roles.insert({ key: 'fields_admin', name: 'مدير حقول', description: '', scope: 'system', permissions: ['workitem.fields.manage'], denied: [], builtIn: false }, { id: 'r-fields' });
    db.users.patch('u-4', { systemRoleIds: ['r-staff', 'r-fields'] });
    const fields = [...db.types.get('t-task').fields, { key: 'extra', label: 'إضافي', type: 'text' as const, required: false }];
    expect(status(() => call('u-4', 'PATCH', 'work-item-types/t-task', { name: 'x', version: 1 }))).toBe(403);
    expect(status(() => call('u-4', 'PATCH', 'work-item-types/t-task', { fields, version: 1 }))).toBe(200);
    expect(status(() => call(PM, 'POST', 'work-items/p-erp-wi-4/type-change/check', { typeId: 't-bug' }))).toBe(403);
    expect(status(() => call(ADMIN, 'POST', 'work-items/p-erp-wi-4/type-change/check', { typeId: 't-bug' }))).toBe(200);
  });

  // ---------- 4. hierarchy rules ----------

  it('FR-REL-01: hierarchy rules are read and replaced as parent/child pairs', () => {
    const { pairs } = call<{ pairs: HierarchyPair[] }>(PM, 'GET', 'hierarchy-rules');
    expect(pairs).toContainEqual({ parentTypeId: 't-task', childTypeId: 't-subtask' });
    const next = pairs.filter((p) => !(p.parentTypeId === 't-task' && p.childTypeId === 't-subtask')).concat({ parentTypeId: 't-milestone', childTypeId: 't-bug' });
    expect(status(() => call(PM, 'PUT', 'hierarchy-rules', { pairs: next }))).toBe(403);
    expect(status(() => call(ADMIN, 'PUT', 'hierarchy-rules', { pairs: [{ parentTypeId: 't-task', childTypeId: 'nope' }] }))).toBe(400);
    call(ADMIN, 'PUT', 'hierarchy-rules', { pairs: next });
    expect(db.types.get('t-task').allowedChildTypeIds).not.toContain('t-subtask');
    expect(db.types.get('t-milestone').allowedChildTypeIds).toContain('t-bug');
    const event = db.audit.where((a) => a.action === 'type.hierarchyUpdated').at(-1)!;
    expect(event.changes.map((c) => c.to)).toContain('قاعدة مضافة: معلم رئيسي ← خطأ');
    expect(event.changes.map((c) => c.to)).toContain('قاعدة محذوفة');
  });

  // ---------- 5. relation types & links ----------

  it('FR-REL-04/05: allowed pairs are enforced; a used relation type is locked', () => {
    const rt = call<RelationType>(ADMIN, 'POST', 'relation-types', {
      key: 'causes', name: 'يسبب', inverseName: 'يسبب', directed: false, active: true, acyclic: false,
      allowedPairs: [{ sourceTypeId: 't-bug', targetTypeId: 't-task' }],
    });
    // bug -> task fine; task -> bug fine because the type is symmetric; task -> task not allowed.
    const link = call<{ id: string }>(PM, 'POST', 'relations', { sourceId: 'p-erp-wi-10', targetId: 'p-erp-wi-4', relationTypeId: rt.id });
    expect(status(() => call(PM, 'POST', 'relations', { sourceId: 'p-erp-wi-12', targetId: 'p-erp-wi-5', relationTypeId: rt.id }))).toBe(200);
    expect(status(() => call(PM, 'POST', 'relations', { sourceId: 'p-erp-wi-3', targetId: 'p-erp-wi-11', relationTypeId: rt.id }))).toBe(422);
    // locked once used
    expect(status(() => call(ADMIN, 'PATCH', `relation-types/${rt.id}`, { acyclic: true, version: rt.version }))).toBe(422);
    expect(status(() => call(ADMIN, 'PATCH', `relation-types/${rt.id}`, { key: 'other', version: rt.version }))).toBe(422);
    const narrow = failure(() => call(ADMIN, 'PATCH', `relation-types/${rt.id}`, { allowedPairs: [{ sourceTypeId: 't-task', targetTypeId: 't-task' }], version: rt.version }));
    expect(narrow.status).toBe(422);
    expect(Object.keys(narrow.details ?? {}).length).toBeGreaterThan(0);
    expect(status(() => call(ADMIN, 'PATCH', `relation-types/${rt.id}`, { name: 'يؤدي إلى', inverseName: 'يؤدي إلى', version: rt.version }))).toBe(200);
    expect(status(() => call(PM, 'DELETE', `relations/${link.id}`))).toBe(200);
  });

  it('FR-REL-05/13: inverse duplicates, version mismatch and archived projects are rejected', () => {
    // A directed, non-acyclic type: the inverse of an existing link is a duplicate, not a cycle.
    const rt = call<RelationType>(ADMIN, 'POST', 'relation-types', { key: 'causes', name: 'يسبب', inverseName: 'ناتج عن', directed: true, active: true, acyclic: false });
    expect(status(() => call(PM, 'POST', 'relations', { sourceId: 'p-erp-wi-8', targetId: 'p-erp-wi-9', relationTypeId: rt.id }))).toBe(200);
    expect(failure(() => call(PM, 'POST', 'relations', { sourceId: 'p-erp-wi-9', targetId: 'p-erp-wi-8', relationTypeId: rt.id })).message).toContain('عكسه');
    expect(status(() => call(PM, 'POST', 'relations', { sourceId: 'p-erp-wi-1', targetId: 'p-erp-wi-12', relationTypeId: 'rt-relates', sourceVersion: 99 }))).toBe(409);
    expect(status(() => call(PM, 'POST', 'relations', { sourceId: 'p-mail-wi-1', targetId: 'p-mail-wi-2', relationTypeId: 'rt-relates' }))).toBe(422);
  });

  it('FR-REL-06: cross-project links are logged on both projects with both refs', () => {
    db.settingsTable.patch('settings', { allowCrossProjectRelations: true });
    call(PM, 'POST', 'relations', { sourceId: 'p-erp-wi-3', targetId: 'p-ssp-wi-5', relationTypeId: 'rt-relates' });
    const events = db.audit.where((a) => a.action === 'relation.created');
    expect(events.map((e) => e.projectId).sort()).toEqual(['p-erp', 'p-ssp']);
    expect(events[0].subjectLabel).toContain('ERP-103');
    expect(events[0].subjectLabel).toContain('SSP-105');
  });

  // ---------- 6. PATCH hardening ----------

  it('TSK-01/03: PATCH whitelists keys and validates values', () => {
    const id = 'p-erp-wi-4';
    const v = (): number => version(id);
    const e = failure(() => call(PM, 'PATCH', `work-items/${id}`, { foo: 1, statusId: 's-completed', version: v() }));
    expect(e.status).toBe(422);
    expect(Object.keys(e.details ?? {})).toEqual(expect.arrayContaining(['foo', 'statusId']));
    expect(status(() => call(PM, 'PATCH', `work-items/${id}`, { priority: 'urgent', version: v() }))).toBe(400);
    expect(status(() => call(PM, 'PATCH', `work-items/${id}`, { title: ' ', version: v() }))).toBe(400);
    expect(status(() => call(PM, 'PATCH', `work-items/${id}`, { title: 'x'.repeat(201), version: v() }))).toBe(400);
    expect(status(() => call(PM, 'PATCH', `work-items/${id}`, { startDate: '2026-05-10', dueDate: '2026-05-01', version: v() }))).toBe(400);
    expect(status(() => call(PM, 'PATCH', `work-items/${id}`, { assigneeIds: ['u-1'], version: v() }))).toBe(400); // not a member
    expect(status(() => call(PM, 'PATCH', `work-items/${id}`, { assigneeIds: ['u-5', 'u-5'], version: v() }))).toBe(400);
    expect(call<WorkItem>(PM, 'PATCH', `work-items/${id}`, { title: 'عنوان جديد', priority: 'low', version: v() }).title).toBe('عنوان جديد');
    expect(status(() => call('u-4', 'PATCH', `work-items/${id}`, { assigneeIds: ['u-4'], version: v() }))).toBe(403); // member has no tasks.assign
  });

  it('TSK-04: both added and removed assignees are notified and the audit uses names', () => {
    const id = 'p-erp-wi-4'; // assignees u-4, u-5
    call(PM, 'PATCH', `work-items/${id}`, { assigneeIds: ['u-5', 'u-6'], version: version(id) });
    expect(db.notifications.where((n) => n.userId === 'u-6' && n.title.includes('تكليفك بعنصر')).length).toBe(1);
    expect(db.notifications.where((n) => n.userId === 'u-4' && n.title.includes('أُزيل')).length).toBe(1);
    const event = db.audit.where((a) => a.subjectId === id && a.action === 'workItem.assigned').at(-1)!;
    expect(event.changes[0].to).toContain('عبدالله الشهري');
    expect(event.changes[0].from).toContain('فهد الدوسري');
  });

  it('AT-14: deleting an item of an archived project is rejected', () => {
    expect(status(() => call(PM, 'DELETE', 'work-items/p-mail-wi-1'))).toBe(422);
    expect(status(() => call(PM, 'PATCH', 'work-items/p-mail-wi-1', { title: 'x', version: 1 }))).toBe(422);
  });

  // ---------- 7. close / reopen / history ----------

  it('TSK-08: close uses the unique Done target, asks when ambiguous, and writes a transition record', () => {
    const id = 'p-erp-wi-5'; // bug in review
    const closed = call<WorkItem>(PM, 'POST', `work-items/${id}/close`, { comment: 'تم الإصلاح', version: version(id) });
    expect(closed.statusId).toBe('s-completed');
    const history = call<TransitionRecord[]>(PM, 'GET', 'transitions/by-subject', {}, new HttpParams().set('subjectType', 'workItem').set('subjectId', id));
    expect(history.length).toBe(1);
    expect(history[0]).toMatchObject({ fromStatusId: 's-review', toStatusId: 's-completed', comment: 'تم الإصلاح', actorId: PM });

    // Ambiguity: a second Done status reachable from the same status.
    db.statuses.insert({ key: 'done2', name: 'منجز جزئيًا', description: '', color: '#445566', category: 'Done', scope: 'workItem', order: 9, active: true }, { id: 's-done2' });
    const wf = db.workflows.get('wf-standard');
    db.workflows.patch('wf-standard', { statusIds: [...wf.statusIds, 's-done2'], transitions: [...wf.transitions, { fromStatusId: 's-review', toStatusId: 's-done2' }] });
    const other = 'p-erp-wi-12'; // task in review
    const e = failure(() => call(PM, 'POST', `work-items/${other}/close`, { version: version(other) }));
    expect(e.status).toBe(400);
    expect(e.details).toHaveProperty('toStatusId');
    expect(call<WorkItem>(PM, 'POST', `work-items/${other}/close`, { toStatusId: 's-done2', version: version(other) }).statusId).toBe('s-done2');
  });

  it('TSK-08: reopen needs a comment, a closed item and a defined transition', () => {
    const id = 'p-erp-wi-3'; // completed task
    expect(status(() => call(PM, 'POST', `work-items/${id}/reopen`, { version: version(id) }))).toBe(400);
    expect(status(() => call(PM, 'POST', 'work-items/p-erp-wi-4/reopen', { comment: 'x', version: version('p-erp-wi-4') }))).toBe(422); // not closed
    const reopened = call<WorkItem>(PM, 'POST', `work-items/${id}/reopen`, { comment: 'ظهر خلل', version: version(id) });
    expect(reopened.statusId).toBe('s-progress');
    expect(db.transitions.where((t) => t.itemId === id).length).toBe(1);
  });

  it('FR-WF-08: a plain transition also writes a history record', () => {
    const id = 'p-erp-wi-4';
    call(PM, 'POST', `work-items/${id}/transition`, { toStatusId: 's-review', version: version(id) });
    expect(db.transitions.where((t) => t.itemId === id && t.toName === 'قيد المراجعة').length).toBe(1);
    expect(status(() => call('u-6', 'GET', 'transitions/by-subject', {}, new HttpParams().set('subjectType', 'workItem').set('subjectId', 'p-bi-wi-1')))).toBe(404);
  });

  // ---------- 8. list filters & board ----------

  it('FR-REL-14: relation, hierarchy, assignee and date filters', () => {
    expect(list({ parentId: 'p-erp-wi-2' }).map((w) => w.id).sort()).toEqual(['p-erp-wi-3', 'p-erp-wi-4', 'p-erp-wi-5']);
    expect(list({ hasChildren: 'true' }).every((w) => db.workItems.where((c) => c.parentId === w.id).length > 0)).toBe(true);
    expect(list({ hasChildren: 'false' }).some((w) => w.id === 'p-erp-wi-12')).toBe(true);
    expect(list({ blockedBy: 'p-erp-wi-9' }).map((w) => w.id)).toEqual(['p-erp-wi-8']);
    expect(list({ blocking: 'p-erp-wi-8' }).map((w) => w.id)).toEqual(['p-erp-wi-9']);
    expect(list({ unblocked: 'false' }).map((w) => w.id).sort()).toEqual(['p-erp-wi-4', 'p-erp-wi-8']);
    expect(list({ hasDependency: 'true' }).length).toBeGreaterThan(0);
    expect(list({ unassigned: 'true' }).every((w) => !w.assigneeIds.length)).toBe(true);
    expect(list({ assigneeIds: 'u-2,u-5' }).every((w) => w.assigneeIds.some((a) => ['u-2', 'u-5'].includes(a)))).toBe(true);
    const due = list({ dueFrom: new Date(Date.now() + 25 * 86_400_000).toISOString().slice(0, 10) });
    expect(due.map((w) => w.id).sort()).toEqual(['p-erp-wi-1', 'p-erp-wi-7', 'p-erp-wi-8']);
    expect(list({ createdFrom: '2100-01-01' }).length).toBe(0);
  });

  it('FR-REL-14: sort by status order and type order', () => {
    const byStatus = list({}, { sort: 'statusId:asc' }).map((w) => db.statuses.get(w.statusId).order);
    expect(byStatus).toEqual([...byStatus].sort((a, b) => a - b));
    const byType = list({}, { sort: 'typeId:desc' }).map((w) => db.types.get(w.typeId).order);
    expect(byType).toEqual([...byType].sort((a, b) => b - a));
  });

  it('FR-TSK-05: the board returns every non-archived item of the project, lean', () => {
    const board = call<{ id: string; title: string; workflowId: string; description?: string }[]>(PM, 'GET', 'work-items/board', {}, new HttpParams().set('projectId', 'p-erp'));
    expect(board.length).toBe(db.workItems.where((w) => w.projectId === 'p-erp' && !w.archived).length);
    expect(board[0].description).toBeUndefined();
    expect(board[0].workflowId).toBeTruthy();
    expect(status(() => call('u-6', 'GET', 'work-items/board', {}, new HttpParams().set('projectId', 'p-bi')))).toBe(404);
  });

  // ---------- 9. per-project workflow override ----------

  it('FR-WF-10: workflow overrides need both permissions, existing statuses, and drive new items', () => {
    const alt = call<Workflow>(ADMIN, 'POST', 'workflows', {
      key: 'alt', name: 'بديل', scope: 'workItem', statusIds: ['s-pending', 's-progress', 's-completed'], initialStatusId: 's-progress',
      transitions: [{ fromStatusId: 's-pending', toStatusId: 's-progress' }, { fromStatusId: 's-progress', toStatusId: 's-completed' }],
    });
    const erp = (): number => db.projects.get('p-erp').version;
    expect(status(() => call(PM, 'POST', 'projects/p-erp/workflow-overrides', { overrides: { 't-subtask': alt.id }, version: erp() }))).toBe(403);
    // Tasks sit in "blocked"/"review" which the alternative workflow lacks.
    const e = failure(() => call(ADMIN, 'POST', 'projects/p-erp/workflow-overrides', { overrides: { 't-task': alt.id }, version: erp() }));
    expect(e.status).toBe(422);
    expect(Object.keys(e.details ?? {}).some((k) => k.includes('محجوب'))).toBe(true);
    expect(status(() => call(ADMIN, 'POST', 'projects/p-erp/workflow-overrides', { overrides: { 't-subtask': 'wf-project' }, version: erp() }))).toBe(400);

    const saved = call<{ workflowOverrides?: Record<string, string> }>(ADMIN, 'POST', 'projects/p-erp/workflow-overrides', { overrides: { 't-subtask': alt.id }, version: erp() });
    expect(saved.workflowOverrides).toEqual({ 't-subtask': alt.id });
    const created = call<WorkItem>(PM, 'POST', 'work-items', {
      projectId: 'p-erp', typeId: 't-subtask', title: 'مهمة فرعية', description: '', priority: 'low', assigneeIds: [], startDate: null, dueDate: null, parentId: 'p-erp-wi-4', fields: {},
    });
    expect(created.statusId).toBe('s-progress'); // initial status of the override, not the type's workflow
    // The old workflow's transitions no longer apply to this item.
    expect(status(() => call(PM, 'POST', `work-items/${created.id}/transition`, { toStatusId: 's-review', version: created.version }))).toBe(422);
    expect(status(() => call(PM, 'POST', `work-items/${created.id}/close`, { version: created.version }))).toBe(200);
    // Clearing the override while items sit in a status the type's workflow has is fine.
    expect(call<{ workflowOverrides?: Record<string, string> }>(ADMIN, 'POST', 'projects/p-erp/workflow-overrides', { overrides: {}, version: erp() }).workflowOverrides).toEqual({});
  });
});
