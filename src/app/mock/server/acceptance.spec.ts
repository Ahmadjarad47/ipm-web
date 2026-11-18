import { HttpHeaders, HttpParams } from '@angular/common/http';
import { beforeEach, describe, expect, it } from 'vitest';
import { MockHttpError } from '../db/collection';
import { MockDatabase } from '../db/database';
import { daysFromNow } from '../db/seed';
import { registerActivityHandlers } from './handlers/activity.handlers';
import { registerApprovalHandlers } from './handlers/approvals.handlers';
import { registerAttachmentHandlers } from './handlers/attachments.handlers';
import { registerAuthUserHandlers } from './handlers/auth-users.handlers';
import { registerConfigHandlers } from './handlers/config.handlers';
import { registerExtraHandlers } from './handlers/extras.handlers';
import { registerGitHandlers, signedHeaders } from './handlers/git.handlers';
import { registerProjectHandlers } from './handlers/projects.handlers';
import { registerWorkItemHandlers } from './handlers/work-items.handlers';
import { Method, MockContext, MockRouter } from './router';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

const ADMIN = 'u-1'; // sara
const PM = 'u-2'; // khaled
const APPROVER = 'u-3'; // noura
const FAHAD = 'u-4';
const REEM = 'u-5';
const VIEWER = 'u-6'; // abdullah

/** SRS §8 acceptance tests AT-01..AT-22 exercised through the mock API (the same cases must pass on the real server). */
describe('SRS §8 acceptance', () => {
  let db: MockDatabase;
  let router: MockRouter;
  const titles: string[] = [];

  beforeEach(() => {
    db = new MockDatabase();
    router = new MockRouter();
    registerAuthUserHandlers(router, db);
    registerConfigHandlers(router, db);
    registerProjectHandlers(router, db);
    registerWorkItemHandlers(router, db);
    registerApprovalHandlers(router, db);
    registerActivityHandlers(router, db);
    registerAttachmentHandlers(router, db);
    registerExtraHandlers(router, db);
    registerGitHandlers(router, db);
  });

  async function call(userId: string | null, method: Method, path: string, body: unknown = {}, query = new HttpParams(), headers?: HttpHeaders): Promise<Json> {
    const match = router.match(method, path);
    if (!match) throw new Error(`no route ${method} ${path}`);
    return match.route.handler({ method, path, params: match.params, query, body, headers }, new MockContext(db, userId));
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

  async function status(fn: () => Promise<unknown>): Promise<number> {
    return (await failure(fn))?.status ?? 200;
  }

  const q = (params: Record<string, string>): HttpParams => Object.entries(params).reduce((p, [k, v]) => p.set(k, v), new HttpParams());
  const wiVer = (id: string): number => db.workItems.get(id).version;
  const prVer = (id: string): number => db.projects.get(id).version;
  const transition = (user: string, id: string, toStatusId: string, comment?: string) =>
    call(user, 'POST', `work-items/${id}/transition`, { toStatusId, comment, version: wiVer(id) });
  const decide = (user: string, id: string, decision: string, revision = 1, comment = '') =>
    call(user, 'POST', `approvals/${id}/decide`, { decision, comment, revision });

  const form = (subjectId: string, file: File, subjectType = 'workItem'): FormData => {
    const f = new FormData();
    f.append('subjectType', subjectType);
    f.append('subjectId', subjectId);
    f.append('file', file);
    return f;
  };
  const push = (message: string, branch = 'feature/x'): string =>
    JSON.stringify({ ref: `refs/heads/${branch}`, commits: [{ id: 'abc1234def5678', message, url: 'https://git.example.local/c/abc1234', author: { username: 'fahad' } }] });

  /** Registers one acceptance test and remembers its title for the coverage check. */
  function at(title: string, fn: () => Promise<void> | void): void {
    titles.push(title);
    it(title, fn);
  }

  /** Runs the three-stage project activation approval apr-1 (BI) to its end. */
  async function approveProjectActivation(): Promise<void> {
    await decide(APPROVER, 'apr-1', 'Approve'); // stage 1: direct manager (noura)
    await decide(APPROVER, 'apr-1', 'Approve'); // stage 2: project-manager role (noura is PM of BI)
    await decide(ADMIN, 'apr-1', 'Approve'); // stage 3: final approval (sara)
  }

  const newFeatureBody = (projectId: string, over: Record<string, unknown> = {}) => ({
    projectId, typeId: 't-feature', title: 'ميزة جديدة', description: '', priority: 'medium', assigneeIds: [], startDate: null, dueDate: null,
    parentId: null, fields: { business_value: 'high' }, ...over,
  });

  at('AT-01: مستخدم دون projects.view يفتح رابط مشروع مباشر فيُرفض (404) دون تسريب بيانات', async () => {
    // fahad (u-4) is not a member of SSP
    const hidden = await failure(() => call(FAHAD, 'GET', 'projects/p-ssp'));
    const missing = await failure(() => call(FAHAD, 'GET', 'projects/p-nope'));
    expect(hidden?.status).toBe(404);
    // Indistinguishable from a record that does not exist, and it names nothing.
    expect(hidden?.message).toBe(missing?.message);
    expect(JSON.stringify(hidden)).not.toContain('SSP');
    expect(hidden?.message).not.toContain('بوابة الخدمات');
    // The child resources of the hidden project are closed too.
    expect(await status(() => call(FAHAD, 'GET', 'work-items/p-ssp-wi-1'))).toBe(404);
    expect(await status(() => call(FAHAD, 'GET', 'work-items/board', {}, q({ projectId: 'p-ssp' })))).toBe(404);
    const visible = (await call(FAHAD, 'GET', 'projects/all')) as { id: string }[];
    expect(visible.map((p) => p.id)).not.toContain('p-ssp');
  });

  at('AT-02: إنشاء مشروع وتعديل وصفه وحالته من مستخدم مخول وتوثيق القيم القديمة والجديدة', async () => {
    const created = await call(PM, 'POST', 'projects', { code: 'NEWP', name: 'مشروع اختبار', description: 'الوصف القديم', ownerId: PM, startDate: '2026-01-01', endDate: '2026-06-30' });
    const updated = await call(PM, 'PATCH', `projects/${created.id}`, { description: 'الوصف الجديد', version: created.version });
    expect(updated.description).toBe('الوصف الجديد'); // UI: the project page shows the new description
    const moved = await call(PM, 'POST', `projects/${created.id}/transition`, { toStatusId: 'ps-cancelled', comment: 'إلغاء قبل البدء', version: updated.version });
    expect(moved.statusId).toBe('ps-cancelled');
    const edit = db.audit.where((e) => e.action === 'project.updated' && e.subjectId === created.id)[0];
    expect(edit.changes).toContainEqual({ field: 'description', from: 'الوصف القديم', to: 'الوصف الجديد' });
    const change = db.audit.where((e) => e.action === 'project.transition' && e.subjectId === created.id)[0];
    expect(change.changes[0].from).toContain('pending');
    expect(change.changes[0].to).toContain('cancelled');
    // an unauthorised user (viewer) cannot do the same
    expect(await status(() => call(VIEWER, 'PATCH', 'projects/p-erp', { description: 'x', version: prVer('p-erp') }))).toBe(403);
  });

  at('AT-03: إضافة حالة جديدة وربطها بانتقال مسموح فتظهر في الفلتر واللوحة ويمكن اختيارها وفق الانتقال فقط', async () => {
    const qa = await call(ADMIN, 'POST', 'statuses', { key: 'qa', name: 'اختبار الجودة', description: '', color: '#123456', category: 'Active', scope: 'workItem', order: 8, active: true });
    const wf = db.workflows.get('wf-standard');
    await call(ADMIN, 'PATCH', 'workflows/wf-standard', {
      statusIds: [...wf.statusIds, qa.id],
      transitions: [...wf.transitions, { fromStatusId: 's-review', toStatusId: qa.id }, { fromStatusId: qa.id, toStatusId: 's-progress' }],
      version: wf.version,
    });
    // UI: the status filter and the board column list read statuses/workflows lookups, so the new status shows up
    expect(((await call(PM, 'GET', 'statuses/all')) as { id: string }[]).map((s) => s.id)).toContain(qa.id);
    expect(db.workflows.get('wf-standard').statusIds).toContain(qa.id);
    // selectable only along the defined transition: review -> qa works, progress -> qa does not
    expect(await status(() => transition(PM, 'p-erp-wi-4', qa.id))).toBe(422);
    expect(await status(() => transition(PM, 'p-erp-wi-12', qa.id))).toBe(200);
    const filtered = await call(PM, 'GET', 'work-items', {}, q({ 'filter.statusId': qa.id, pageSize: '100' }));
    expect(filtered.items.map((w: { id: string }) => w.id)).toEqual(['p-erp-wi-12']);
    const board = (await call(PM, 'GET', 'work-items/board', {}, q({ projectId: 'p-erp' }))) as { id: string; statusId: string }[];
    expect(board.find((w) => w.id === 'p-erp-wi-12')?.statusId).toBe(qa.id);
  });

  at('AT-04: محاولة تغيير الحالة من غير مخول تُرفض من API حتى لو تم الطلب يدويًا', async () => {
    const id = 'p-erp-wi-12';
    const before = db.workItems.get(id).statusId;
    // abdullah is a viewer; a non-member gets 404; a direct PATCH of the status field is refused as well
    expect(await status(() => transition(VIEWER, id, 's-progress'))).toBe(403);
    expect(await status(() => transition('u-7', id, 's-progress'))).toBe(404);
    expect(await status(() => call(PM, 'PATCH', `work-items/${id}`, { statusId: 's-completed', version: wiVer(id) }))).toBe(422);
    expect(db.workItems.get(id).statusId).toBe(before);
    expect(db.audit.where((e) => e.action === 'auth.permission_denied' && e.actorId === VIEWER).length).toBe(1);
  });

  at('AT-05: طلب موافقة بثلاث مراحل لا تُنفَّذ عمليته حتى موافقة الجهات الثلاث بالترتيب', async () => {
    const activate = () => call(APPROVER, 'POST', 'projects/p-bi/transition', { toStatusId: 'ps-active', version: prVer('p-bi') });
    expect(await status(activate)).toBe(422); // nothing approved yet
    expect(await status(() => decide(ADMIN, 'apr-1', 'Approve'))).toBe(403); // stage 3 cannot jump the queue
    expect(await status(() => decide(PM, 'apr-1', 'Approve'))).toBe(403); // the requester cannot approve
    await decide(APPROVER, 'apr-1', 'Approve');
    expect(db.approvals.get('apr-1').currentStage).toBe(2);
    expect(await status(activate)).toBe(422);
    await decide(APPROVER, 'apr-1', 'Approve');
    expect(db.approvals.get('apr-1').currentStage).toBe(3);
    expect(await status(activate)).toBe(422);
    await decide(ADMIN, 'apr-1', 'Approve');
    expect(db.approvals.get('apr-1').status).toBe('Approved');
    expect(db.approvals.get('apr-1').decisions.map((d) => d.stageOrder)).toEqual([1, 2, 3]);
    expect((await activate()).statusId).toBe('ps-active');
    // single use: the same approval does not authorise a second protected transition
    expect(db.consumedApprovals.has('apr-1')).toBe(true);
  });

  at('AT-06: رفض الطلب في المرحلة الثانية يوقف التسلسل ويحفظ السبب والتوقيت والجهة', async () => {
    await decide(APPROVER, 'apr-1', 'Approve');
    expect(await status(() => decide(APPROVER, 'apr-1', 'Reject', 1, '  '))).toBe(400); // a reason is mandatory
    await decide(APPROVER, 'apr-1', 'Reject', 1, 'الجدول الزمني غير واقعي');
    const request = db.approvals.get('apr-1');
    expect(request.status).toBe('Rejected');
    expect(request.currentStage).toBe(0);
    const rejection = request.decisions[1];
    expect(rejection).toMatchObject({ stageOrder: 2, deciderId: APPROVER, decision: 'Reject', comment: 'الجدول الزمني غير واقعي' });
    expect(Number.isNaN(Date.parse(rejection.at))).toBe(false);
    // the sequence stopped: stage 3 cannot decide, and the protected action stays blocked
    expect(await status(() => decide(ADMIN, 'apr-1', 'Approve'))).toBe(422);
    expect(await status(() => call(APPROVER, 'POST', 'projects/p-bi/transition', { toStatusId: 'ps-active', version: prVer('p-bi') }))).toBe(422);
    expect(db.audit.where((e) => e.action === 'approval.decided' && e.subjectId === 'apr-1').length).toBe(2);
  });

  at('AT-07: تغيير حقل محمي أثناء الموافقة يجعل النسخة السابقة غير صالحة ولا يُقبل قرار متأخر عليها', async () => {
    // (a) pending request: apr-2 protects title/dueDate/parentId of ERP-103
    const id = 'p-erp-wi-3';
    await call(PM, 'PATCH', `work-items/${id}`, { title: 'عنوان معدل', version: wiVer(id) });
    expect(db.approvals.get('apr-2').status).toBe('Superseded');
    expect(await status(() => decide(PM, 'apr-2', 'Approve', 1))).toBe(409);
    // (b) approved request: a protected change after approval blocks the gated action
    await approveProjectActivation();
    await call(APPROVER, 'PATCH', 'projects/p-bi', { name: 'اسم معدل بعد الاعتماد', version: prVer('p-bi') });
    expect(await status(() => call(APPROVER, 'POST', 'projects/p-bi/transition', { toStatusId: 'ps-active', version: prVer('p-bi') }))).toBe(422);
    expect(db.audit.where((e) => e.action === 'approval.gate_blocked').length).toBe(1);
    expect(db.audit.where((e) => e.action === 'approval.superseded').length).toBe(1);
  });

  at('AT-08: رفع ملف على مهمة ثم طلب الملف بواسطة غير عضو يرفض التنزيل ويرصد الإجراء الأمني', async () => {
    // reem uploads to SSP-103; fahad is not a member of SSP
    const file = new File(['hello'], 'notes.txt', { type: 'text/plain' });
    const att = await call(REEM, 'POST', 'attachments', form('p-ssp-wi-3', file));
    const err = await failure(() => call(FAHAD, 'GET', `attachments/${att.id}/download`));
    expect(err?.status).toBe(404);
    expect(await status(() => call(FAHAD, 'GET', 'attachments/by-subject', {}, q({ subjectType: 'workItem', subjectId: 'p-ssp-wi-3' })))).toBe(404);
    const denied = db.audit.where((e) => e.action === 'file.download_denied' && e.security && e.actorId === FAHAD);
    expect(denied.length).toBe(1);
    expect(await (await call(REEM, 'GET', `attachments/${att.id}/download`) as Blob).text()).toBe('hello'); // a member still downloads
  });

  at('AT-09: إرسال Webhook Git مكرر ثم Webhook غير موقع فيعالج الأول مرة واحدة ويرفض غير الصحيح', async () => {
    const raw = push('ERP-108 commit');
    const headers = await signedHeaders('demo-secret-erp-web-0001', raw, 'push', 'same-delivery');
    await call(null, 'POST', 'webhooks/gitea/repo-1', raw, new HttpParams(), headers);
    const second = await call(null, 'POST', 'webhooks/gitea/repo-1', raw, new HttpParams(), headers);
    expect(second.outcome).toBe('duplicate');
    expect(db.gitEvents.where((g) => g.sha === 'abc1234').length).toBe(1);
    const forged = new HttpHeaders({ 'X-Delivery-Timestamp': new Date().toISOString(), 'X-Gitea-Event': 'push', 'X-Gitea-Delivery': 'd-x', 'X-Gitea-Signature': 'deadbeef' });
    expect(await status(() => call(null, 'POST', 'webhooks/gitea/repo-1', push('ERP-109 forged'), new HttpParams(), forged))).toBe(401);
    const unsigned = new HttpHeaders({ 'X-Delivery-Timestamp': new Date().toISOString(), 'X-Gitea-Event': 'push', 'X-Gitea-Delivery': 'd-y' });
    expect(await status(() => call(null, 'POST', 'webhooks/gitea/repo-1', push('ERP-109 unsigned'), new HttpParams(), unsigned))).toBe(401);
    expect(db.gitEvents.where((g) => g.title.includes('ERP-109 forged') || g.title.includes('ERP-109 unsigned')).length).toBe(0);
    expect(db.audit.where((e) => e.action === 'git.webhook_rejected' && e.security).length).toBe(2);
  });

  at('AT-10: إنشاء Commit بعنوان يتضمن معرف مهمة صالح فتظهر إحالة Commit في المهمة مع رابط المصدر', async () => {
    const raw = push('ERP-108 إضافة نموذج المورد');
    await call(null, 'POST', 'webhooks/gitea/repo-1', raw, new HttpParams(), await signedHeaders('demo-secret-erp-web-0001', raw, 'push', 'd-1'));
    const events = await call(PM, 'GET', 'git-events', {}, q({ 'filter.workItemRef': 'ERP-108' }));
    const hit = events.items.find((g: { sha: string }) => g.sha === 'abc1234');
    expect(hit.url).toBe('https://git.example.local/c/abc1234'); // UI: the task's development panel lists the commit with this link
    expect((await call(PM, 'GET', 'work-items/p-erp-wi-8')).dev.commits).toBe(1);
    // an unknown reference links nothing
    const other = push('ERP-999 مهمة غير موجودة');
    const rawOther = other.replace('abc1234def5678', 'fff1234def5678');
    await call(null, 'POST', 'webhooks/gitea/repo-1', rawOther, new HttpParams(), await signedHeaders('demo-secret-erp-web-0001', rawOther, 'push', 'd-2'));
    expect(db.gitEvents.where((g) => g.sha === 'fff1234')[0].workItemRefs).toEqual([]);
  });

  at('AT-11: تغيير صلاحية مستخدم في مشروع واحد تسري على ذلك المشروع فقط دون غيره ويُسجَّل', async () => {
    // fahad: member in ERP and in BI. Before: he can transition in ERP.
    expect(await status(() => transition(FAHAD, 'p-erp-wi-10', 's-review'))).toBe(200);
    const project = db.projects.get('p-erp');
    await call(PM, 'POST', 'projects/p-erp/members', { members: project.members.map((m) => (m.userId === FAHAD ? { ...m, roleId: 'r-viewer' } : m)), version: project.version });
    expect(await status(() => transition(FAHAD, 'p-erp-wi-4', 's-review'))).toBe(403); // ERP: now a viewer
    expect(await status(() => transition(FAHAD, 'p-bi-wi-3', 's-review'))).toBe(200); // BI untouched
    const event = db.audit.where((e) => e.action === 'project.members' && e.subjectId === 'p-erp')[0];
    expect(event.security).toBe(true);
    expect(event.changes[0].field).toContain('فهد');
    expect(event.changes[0].from).toBe('عضو فريق');
    expect(event.changes[0].to).toBe('قارئ');
  });

  at('AT-12: استعراض Audit بعد إعادة تسمية الحالة تبقى تفاصيل انتقالاتها السابقة مفهومة مع المعرّفات الدائمة', async () => {
    const id = 'p-erp-wi-10';
    await transition(PM, id, 's-review'); // "قيد المراجعة"
    await call(ADMIN, 'PATCH', 'statuses/s-review', { name: 'قيد التدقيق', version: db.statuses.get('s-review').version });
    const history = (await call(PM, 'GET', 'transitions/by-subject', {}, q({ subjectType: 'workItem', subjectId: id }))) as { toStatusId: string; toName: string }[];
    expect(history[0].toStatusId).toBe('s-review'); // permanent link by id
    expect(history[0].toName).toBe('قيد المراجعة'); // what it was called when it happened
    expect(db.statuses.get('s-review').key).toBe('in_review'); // permanent key
    const audit = await call(ADMIN, 'GET', 'audit', {}, q({ 'filter.subjectId': id }));
    const row = audit.items.find((e: { action: string }) => e.action === 'workItem.transition');
    expect(row.changes[0].to).toContain('in_review'); // UI: the audit row shows name and permanent key
    const rename = db.audit.where((e) => e.subjectId === 's-review' && e.action === 'status.updated')[0];
    expect(rename.changes).toContainEqual({ field: 'الاسم', from: 'قيد المراجعة', to: 'قيد التدقيق' });
  });

  at('AT-13: تطبيق فلاتر لوحة القيادة على فترة محددة تتطابق الأعداد مع البيانات المصدرية حسب الفئات النظامية', async () => {
    const from = daysFromNow(-3);
    const to = daysFromNow(3);
    const stats = await call(ADMIN, 'GET', 'dashboard/stats', {}, q({ projectId: 'p-erp', from, to }));
    const all = db.workItems.where((w) => w.projectId === 'p-erp' && !w.archived);
    const parents = new Set(all.map((w) => w.parentId).filter(Boolean));
    const inPeriod = all.filter((w) => (w.startDate as string).slice(0, 10) <= to && (w.dueDate as string).slice(0, 10) >= from);
    const category = (statusId: string): string => db.statuses.get(statusId).category;
    for (const c of ['NotStarted', 'Active', 'Blocked', 'Done', 'Cancelled']) {
      expect(stats.byCategory[c]).toBe(inPeriod.filter((w) => category(w.statusId) === c).length);
      expect(stats.leafByCategory[c]).toBe(inPeriod.filter((w) => !parents.has(w.id) && category(w.statusId) === c).length);
    }
    expect(inPeriod.length).toBeGreaterThan(0);
    expect(inPeriod.length).toBeLessThan(all.length); // the period really filtered something
    const done = await call(ADMIN, 'GET', 'dashboard/stats', {}, q({ projectId: 'p-erp', from, to, statusCategory: 'Done' }));
    expect(done.byCategory['Done']).toBe(stats.byCategory['Done']);
    expect(done.byCategory['Active']).toBe(0);
  });

  at('AT-14: أرشفة مشروع يحوي ملفات ومهام لا تختفي السجلات ويُمنع تعديلها ما لم تسمح السياسة', async () => {
    const items = db.workItems.where((w) => w.projectId === 'p-erp').length;
    await call(PM, 'POST', 'projects/p-erp/archive', { version: prVer('p-erp') });
    expect(db.audit.where((e) => e.action === 'project.archived').length).toBe(1);
    // records remain readable
    expect(db.workItems.where((w) => w.projectId === 'p-erp').length).toBe(items);
    expect((await call(PM, 'GET', 'work-items/p-erp-wi-4')).title).toBeTruthy();
    expect(((await call(PM, 'GET', 'attachments/by-subject', {}, q({ subjectType: 'workItem', subjectId: 'p-erp-wi-3' }))) as unknown[]).length).toBe(1);
    // ...and read-only
    expect(await status(() => call(PM, 'PATCH', 'work-items/p-erp-wi-4', { title: 'x', version: wiVer('p-erp-wi-4') }))).toBe(422);
    expect(await status(() => call(PM, 'POST', 'work-items', newFeatureBody('p-erp')))).toBe(422);
    expect(await status(() => transition(PM, 'p-erp-wi-4', 's-review'))).toBe(422);
    expect(await status(() => call(PM, 'PATCH', 'projects/p-erp', { description: 'x', version: prVer('p-erp') }))).toBe(422);
    expect(await status(() => call(REEM, 'POST', 'comments', { subjectType: 'workItem', subjectId: 'p-erp-wi-4', body: 'x' }))).toBe(422);
    expect(await status(() => call(FAHAD, 'POST', 'attachments', form('p-erp-wi-4', new File(['x'], 'a.txt'))))).toBe(422);
    expect(await status(() => call(FAHAD, 'DELETE', 'attachments/f-2'))).toBe(422);
    // policy: after the permitted user un-archives, editing works again
    await call(PM, 'POST', 'projects/p-erp/unarchive', { version: prVer('p-erp') });
    expect(await status(() => call(PM, 'PATCH', 'work-items/p-erp-wi-4', { title: 'x', version: wiVer('p-erp-wi-4') }))).toBe(200);
  });

  at('AT-15: إنشاء نوع Feature من لوحة الإدارة بحقوله وحالاته ثم عنصر منه في مشروع يسمح بالنوع بلا نشر كود', async () => {
    const type = await call(ADMIN, 'POST', 'work-item-types', {
      key: 'epic_feature', name: 'ميزة موسعة', description: '', color: '#7c5cbf', icon: 'feature', order: 9, active: true, workflowId: 'wf-standard',
      allowedChildTypeIds: ['t-task', 't-bug'],
      fields: [{ key: 'sponsor', label: 'الراعي', type: 'text', required: true }],
    });
    expect(((await call(REEM, 'GET', 'work-item-types/all')) as { id: string }[]).map((t) => t.id)).toContain(type.id); // UI: the type appears with its fields, no deployment
    const create = (over: Record<string, unknown> = {}) =>
      call(REEM, 'POST', 'work-items', newFeatureBody('p-ssp', { typeId: type.id, fields: { sponsor: 'الإدارة' }, ...over }));
    expect(await status(() => create())).toBe(422); // SSP does not allow the type yet
    await call(PM, 'PATCH', 'projects/p-ssp', { allowedTypeIds: [...db.projects.get('p-ssp').allowedTypeIds, type.id], defaultTypeId: 't-task', version: prVer('p-ssp') });
    const missing = await failure(() => create({ fields: {} }));
    expect(missing?.status).toBe(400);
    expect(missing?.details).toHaveProperty('sponsor'); // its fields are enforced
    const item = await create();
    expect(item.statusId).toBe('s-pending'); // its workflow's initial status
    expect(await status(() => transition(PM, item.id, 's-review'))).toBe(422); // its transitions apply
    const child = await call(REEM, 'POST', 'work-items', { ...newFeatureBody('p-ssp'), typeId: 't-task', parentId: item.id, fields: {} });
    expect(child.parentId).toBe(item.id); // its hierarchy rules apply
    expect(await status(() => call(VIEWER, 'POST', 'work-items', newFeatureBody('p-ssp')))).toBe(404); // its permissions apply
  });

  at('AT-16: إعادة تسمية Feature مع وجود عناصر وسجلات تاريخية يبقى الربط بالمعرف الثابت وتظل الأحداث القديمة مفهومة', async () => {
    await transition(PM, 'p-erp-wi-2', 's-review'); // historical event on a Feature item
    await call(ADMIN, 'PATCH', 'work-item-types/t-feature', { name: 'قدرة', version: db.types.get('t-feature').version });
    expect(db.types.get('t-feature')).toMatchObject({ key: 'feature', name: 'قدرة' });
    expect(await status(() => call(ADMIN, 'PATCH', 'work-item-types/t-feature', { key: 'capability', version: db.types.get('t-feature').version }))).toBe(422);
    const features = await call(PM, 'GET', 'work-items', {}, q({ 'filter.typeId': 't-feature', pageSize: '100' }));
    expect(features.items.map((w: { id: string }) => w.id)).toEqual(expect.arrayContaining(['p-erp-wi-2', 'p-erp-wi-7', 'p-ssp-wi-1']));
    expect(features.items.length).toBe(db.workItems.where((w) => w.typeId === 't-feature').length);
    const old = await call(ADMIN, 'GET', 'audit', {}, q({ 'filter.subjectId': 'p-erp-wi-2' }));
    expect(old.items.some((e: { action: string }) => e.action === 'workItem.transition')).toBe(true); // UI: old events still read and filter by type
    const rename = db.audit.where((e) => e.action === 'type.updated' && e.subjectId === 't-feature')[0];
    expect(rename.changes).toContainEqual({ field: 'الاسم', from: 'ميزة', to: 'قدرة' });
  });

  at('AT-17: ربط Feature بأبناء Task وBug ثم محاولة جعل Feature أحد أحفاده تُرفض الدورة ذريًا مع تسجيل الرفض', async () => {
    const feature = await call(PM, 'POST', 'work-items', newFeatureBody('p-erp'));
    const sub = (typeId: string, parentId: string, fields: Record<string, unknown>) =>
      call(PM, 'POST', 'work-items', { ...newFeatureBody('p-erp'), typeId, title: typeId, parentId, fields });
    const task = await sub('t-task', feature.id, {});
    const bug = await sub('t-bug', feature.id, { severity: 'minor' });
    const subtask = await sub('t-subtask', task.id, {});
    expect([task.parentId, bug.parentId, subtask.parentId]).toEqual([feature.id, feature.id, task.id]);
    const err = await failure(() => call(PM, 'POST', `work-items/${feature.id}/parent`, { parentId: subtask.id, version: wiVer(feature.id) }));
    expect(err?.status).toBe(422);
    expect(err?.message).toContain('دورة');
    expect(db.workItems.get(feature.id).parentId).toBeNull(); // atomic: nothing changed
    expect(db.workItems.get(feature.id).version).toBe(feature.version);
    const rejected = db.audit.where((e) => e.subjectId === feature.id && /rejected/.test(e.action));
    expect(rejected.length).toBe(1); // the rejection is recorded
  });

  at('AT-18: إنشاء A Blocks B وB Blocks C ثم C Blocks A تُرفض الدورة وتُعرض العلاقات الموجهة ومقابلاتها', async () => {
    const [a, b, c] = ['p-erp-wi-10', 'p-erp-wi-11', 'p-erp-wi-12'];
    const rel = (s: string, t: string) => call(PM, 'POST', 'relations', { sourceId: s, targetId: t, relationTypeId: 'rt-blocks' });
    await rel(a, b);
    await rel(b, c);
    const err = await failure(() => rel(c, a));
    expect(err?.status).toBe(422);
    expect(db.relations.where((r) => [a, b, c].includes(r.sourceId) && [a, b, c].includes(r.targetId)).length).toBe(2);
    expect(db.audit.where((e) => e.action === 'relation.rejected').length).toBe(1);
    const ofB = (await call(PM, 'GET', `relations/by-item/${b}`)) as { sourceId: string; targetId: string }[];
    expect(ofB.filter((r) => r.sourceId === b).map((r) => r.targetId)).toEqual([c]); // B "blocks" C
    expect(ofB.filter((r) => r.targetId === b).map((r) => r.sourceId)).toEqual([a]); // B "is blocked by" A
    expect(db.relationTypes.get('rt-blocks').inverseName).toBe('محجوب بواسطة'); // UI: shows the inverse label on the target side
  });

  at('AT-19: مستخدم يملك تعديل العنصر ولا يملك workitem.relations.create يحاول ربط عنصرين فيرفض الخادم دون كشف طرف غير مخول', async () => {
    const member = db.roles.get('r-member');
    const noLink = db.roles.insert({
      key: 'member_nolink', name: 'عضو بلا ربط', description: '', scope: 'project',
      permissions: member.permissions.filter((p) => p !== 'workitem.relations.create'), denied: [], builtIn: false,
    });
    const erp = db.projects.get('p-erp');
    db.projects.patch('p-erp', { members: erp.members.map((m) => (m.userId === FAHAD ? { ...m, roleId: noLink.id } : m)) });
    expect(await status(() => call(FAHAD, 'PATCH', 'work-items/p-erp-wi-4', { title: 'تعديل مسموح', version: wiVer('p-erp-wi-4') }))).toBe(200);
    const before = db.relations.all().length;
    const err = await failure(() => call(FAHAD, 'POST', 'relations', { sourceId: 'p-erp-wi-4', targetId: 'p-erp-wi-7', relationTypeId: 'rt-relates' }));
    expect(err?.status).toBe(403);
    expect(db.relations.all().length).toBe(before);
    expect(db.audit.where((e) => e.action === 'auth.permission_denied' && e.actorId === FAHAD && e.security).length).toBe(1);
    // an unauthorised counterpart is not revealed either: fahad may link in BI but cannot see SSP
    const hidden = await failure(() => call(FAHAD, 'POST', 'relations', { sourceId: 'p-bi-wi-3', targetId: 'p-ssp-wi-1', relationTypeId: 'rt-relates' }));
    expect(hidden?.status).toBe(404);
    expect(JSON.stringify(hidden)).not.toContain('SSP');
    expect(JSON.stringify(hidden)).not.toContain('طلب إجازة');
    expect(db.relations.all().length).toBe(before);
  });

  at('AT-20: تغيير والد عنصر أثناء طلب موافقة معلق ثم محاولة اعتماد النسخة القديمة تُطبق سياسة الإبطال/إعادة التقديم', async () => {
    const id = 'p-erp-wi-3'; // apr-2 (stage 2 pending) protects parentId
    await call(PM, 'POST', `work-items/${id}/parent`, { parentId: 'p-erp-wi-7', version: wiVer(id) });
    expect(db.approvals.get('apr-2').status).toBe('Superseded');
    expect(await status(() => decide(PM, 'apr-2', 'Approve', 1))).toBe(409); // the old version cannot be approved
    expect(db.workItems.get(id).parentId).toBe('p-erp-wi-7');
    const resubmitted = await call(FAHAD, 'POST', 'approvals/apr-2/resubmit');
    expect(resubmitted).toMatchObject({ status: 'PendingApproval', revision: 2, currentStage: 1 });
    expect(resubmitted.snapshot['parentId']).toBe('ERP-107'); // re-frozen on the changed data
    expect(await status(() => decide(APPROVER, 'apr-2', 'Approve', 1))).toBe(409);
    await decide(APPROVER, 'apr-2', 'Approve', 2);
    await decide(PM, 'apr-2', 'Approve', 2);
    expect(db.approvals.get('apr-2').status).toBe('Approved');
  });

  at('AT-21: التحويل من Bug إلى Feature مع حقول إلزامية مفقودة أو حالة غير متوافقة يُرفض حتى تسويتها دون فقد بيانات', async () => {
    const id = 'p-erp-wi-10'; // bug with severity/environment, no business_value
    const conflicts = (await call(ADMIN, 'POST', `work-items/${id}/type-change/check`, { typeId: 't-feature' })) as { field: string; reason: string }[];
    expect(conflicts.map((c) => c.field)).toEqual(expect.arrayContaining(['business_value', 'severity'])); // UI: lists each reason
    const before = JSON.stringify(db.workItems.get(id));
    const err = await failure(() => call(ADMIN, 'POST', `work-items/${id}/type-change`, { typeId: 't-feature', version: wiVer(id) }));
    expect(err?.status).toBe(422);
    expect(JSON.stringify(db.workItems.get(id))).toBe(before); // no data lost
    // incompatible parent: ERP-105 is a bug under a feature
    const parentConflict = (await call(ADMIN, 'POST', 'work-items/p-erp-wi-5/type-change/check', { typeId: 't-feature' })) as { field: string }[];
    expect(parentConflict.map((c) => c.field)).toContain('parent');
    // incompatible status: a rejected bug has no equivalent in the standard workflow
    const bug = await call(PM, 'POST', 'work-items', { ...newFeatureBody('p-erp'), typeId: 't-bug', parentId: null, fields: { severity: 'minor' } });
    await transition(PM, bug.id, 's-rejected');
    const statusConflict = (await call(ADMIN, 'POST', `work-items/${bug.id}/type-change/check`, { typeId: 't-feature' })) as { field: string }[];
    expect(statusConflict.map((c) => c.field)).toContain('status');
    expect(await status(() => call(ADMIN, 'POST', `work-items/${bug.id}/type-change`, { typeId: 't-feature', version: wiVer(bug.id) }))).toBe(422);
    expect(db.workItems.get(bug.id).typeId).toBe('t-bug');
  });

  at('AT-22: إنجاز Feature أب وله Task مكتملة وBug مفتوحة ثم استعراض تقرير التقدم يحتسب الأوراق دون احتساب الأب مرتين', async () => {
    const project = await call(PM, 'POST', 'projects', { code: 'PRG', name: 'مشروع التقدم', description: '', ownerId: PM, startDate: '2026-01-01', endDate: '2026-06-30' });
    const make = (typeId: string, parentId: string | null, fields: Record<string, unknown>, assigneeIds: string[] = []) =>
      call(PM, 'POST', 'work-items', { ...newFeatureBody(project.id), typeId, parentId, fields, assigneeIds });
    const feature = await make('t-feature', null, { business_value: 'high' });
    const task = await make('t-task', feature.id, {}, [PM]);
    await make('t-bug', feature.id, { severity: 'minor' });
    await transition(PM, task.id, 's-progress');
    await transition(PM, task.id, 's-review');
    await transition(PM, task.id, 's-completed');
    const progress = (await call(PM, 'GET', `projects/${project.id}`)).progress;
    expect(progress).toMatchObject({ countedLeaves: 2, doneLeaves: 1, percent: 50 }); // the parent is not counted again
    expect(progress.rule).toContain('الأب لا يُحتسب'); // UI: the report states the declared policy
    const stats = await call(PM, 'GET', 'dashboard/stats', {}, q({ projectId: project.id }));
    expect(stats.leafByCategory).toMatchObject({ Done: 1, NotStarted: 1 });
    expect(stats.byType.find((t: { typeId: string }) => t.typeId === 't-feature')).toBeUndefined();
  });

  it('coverage: all 22 acceptance tests are present', () => {
    for (let n = 1; n <= 22; n++) {
      const id = `AT-${String(n).padStart(2, '0')}`;
      expect(titles.filter((t) => t.startsWith(`${id}:`) || t.startsWith(`${id} (DEFECT):`)), id).toHaveLength(1);
    }
    expect(titles).toHaveLength(22);
  });
});
