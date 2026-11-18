import { HttpParams } from '@angular/common/http';
import { beforeEach, describe, expect, it } from 'vitest';
import { MockHttpError } from '../db/collection';
import { MockDatabase } from '../db/database';
import { registerAttachmentHandlers } from './handlers/attachments.handlers';
import { registerGitHandlers } from './handlers/git.handlers';
import { registerProjectHandlers } from './handlers/projects.handlers';
import { registerWorkItemHandlers } from './handlers/work-items.handlers';
import { Method, MockContext, MockRouter } from './router';

describe('Attachments, Git connections and project types (mock API)', () => {
  let db: MockDatabase;
  let router: MockRouter;

  beforeEach(() => {
    db = new MockDatabase();
    router = new MockRouter();
    registerProjectHandlers(router, db);
    registerWorkItemHandlers(router, db);
    registerAttachmentHandlers(router, db);
    registerGitHandlers(router, db); // projects/:id/git-sync lives with the Git handlers
  });

  async function call<T = unknown>(userId: string, method: Method, path: string, body: unknown = {}, query = new HttpParams()): Promise<T> {
    const match = router.match(method, path);
    if (!match) throw new Error(`no route ${method} ${path}`);
    return (await match.route.handler({ method, path, params: match.params, query, body }, new MockContext(db, userId))) as T;
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

  function form(subjectId: string, file: File, subjectType = 'workItem'): FormData {
    const f = new FormData();
    f.append('subjectType', subjectType);
    f.append('subjectId', subjectId);
    f.append('file', file);
    return f;
  }

  const textFile = (name: string, content = 'hello') => new File([content], name, { type: 'text/plain' });

  // ---------- Attachments ----------

  it('AT-08: a non-member cannot download a work item file, and the attempt is a security event', async () => {
    // reem (u-5) uploads to ERP-104; abdullah is a viewer on ERP (no files.download); mona is no member at all
    const att = await call<{ id: string }>('u-5', 'POST', 'attachments', form('p-erp-wi-4', textFile('notes.txt')));
    expect(await status(() => call('u-6', 'GET', `attachments/${att.id}/download`))).toBe(404);
    const denied = db.audit.where((e) => e.action === 'file.download_denied' && e.security);
    expect(denied.length).toBe(1);
    // a member with files.download succeeds
    const blob = await call<Blob>('u-4', 'GET', `attachments/${att.id}/download`);
    expect(await blob.text()).toBe('hello');
  });

  it('FR-COL-05: rejects disallowed types, oversize files and malware', async () => {
    expect(await status(() => call('u-4', 'POST', 'attachments', form('p-erp-wi-4', textFile('run.exe'))))).toBe(422);
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.pdf');
    expect(await status(() => call('u-4', 'POST', 'attachments', form('p-erp-wi-4', big)))).toBe(422);
    const eicar = textFile('report.txt', 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
    expect(await status(() => call('u-4', 'POST', 'attachments', form('p-erp-wi-4', eicar)))).toBe(422);
    expect(db.attachments.where((a) => a.subjectId === 'p-erp-wi-4').length).toBe(0);
  });

  it('FR-COL-06: deletion is logical and audited', async () => {
    const att = await call<{ id: string }>('u-4', 'POST', 'attachments', form('p-erp-wi-4', textFile('a.txt')));
    await call('u-4', 'DELETE', `attachments/${att.id}`);
    expect(db.attachments.get(att.id).deleted).toBe(true);
    expect(db.audit.where((e) => e.action === 'file.deleted').length).toBe(1);
    expect(await status(() => call('u-4', 'GET', `attachments/${att.id}/download`))).toBe(404);
  });

  it('a member cannot delete someone else’s file without files.delete', async () => {
    // f-3 was uploaded by reem; fahad (member) lacks files.delete
    expect(await status(() => call('u-4', 'DELETE', 'attachments/f-3'))).toBe(403);
  });

  // ---------- Git ----------

  const repo = { provider: 'gitea', name: 'erp/reports', url: 'https://git.example.local/erp/reports', defaultBranch: 'main', accessToken: 'secret-token' };

  it('FR-GIT-01 / NFR-04: connecting needs git.manage and never returns or logs the token', async () => {
    expect(await status(() => call('u-2', 'POST', 'projects/p-erp/repositories', repo))).toBe(403); // PM lacks git.manage
    const project = await call<{ repositories: object[] }>('u-1', 'POST', 'projects/p-erp/repositories', repo);
    expect(JSON.stringify(project)).not.toContain('secret-token');
    expect(JSON.stringify(db.audit.all())).not.toContain('secret-token');
    expect(project.repositories.length).toBe(3);
  });

  it('FR-GIT-09: disconnecting keeps the repository record and past events, and blocks sync', async () => {
    const before = db.gitEvents.where((g) => g.repositoryId === 'repo-1').length;
    await call('u-1', 'POST', 'projects/p-erp/repositories/repo-1/disconnect');
    const r = db.projects.get('p-erp').repositories.find((x) => x.id === 'repo-1')!;
    expect(r.connected).toBe(false);
    expect(db.gitEvents.where((g) => g.repositoryId === 'repo-1').length).toBe(before);
    expect(await status(() => call('u-2', 'POST', 'projects/p-erp/git-sync', { repositoryId: 'repo-1' }))).toBe(422);
  });

  // ---------- Project types ----------

  it('FR-TYP-04: the default type must be one of the allowed types', async () => {
    const v = db.projects.get('p-ssp').version;
    expect(await status(() => call('u-2', 'PATCH', 'projects/p-ssp', { allowedTypeIds: ['t-task'], defaultTypeId: 't-bug', version: v }))).toBe(422);
    await call('u-2', 'PATCH', 'projects/p-ssp', { allowedTypeIds: ['t-task', 't-bug'], defaultTypeId: 't-bug', version: v });
    expect(db.projects.get('p-ssp').defaultTypeId).toBe('t-bug');
  });

  it('FR-TYP-04 / §4.3: a type removed from a project blocks new items but keeps existing ones', async () => {
    const v = db.projects.get('p-ssp').version;
    await call('u-2', 'PATCH', 'projects/p-ssp', { allowedTypeIds: ['t-task'], defaultTypeId: 't-task', version: v });
    expect(db.workItems.get('p-ssp-wi-1').typeId).toBe('t-feature');
    const create = { projectId: 'p-ssp', typeId: 't-feature', title: 'x', description: '', priority: 'low', assigneeIds: [], startDate: null, dueDate: null, parentId: null, fields: { business_value: 'low' } };
    expect(await status(() => call('u-2', 'POST', 'work-items', create))).toBe(422);
  });

  it('a viewer without project.workitemtypes.configure cannot change project types', async () => {
    // reem is a member (no configure permission) on SSP
    expect(await status(() => call('u-5', 'PATCH', 'projects/p-ssp', { allowedTypeIds: ['t-task'], defaultTypeId: 't-task', version: db.projects.get('p-ssp').version }))).toBe(403);
  });

  // ---------- Graph data ----------

  it('FR-REL-09: project relations endpoint returns only links inside that project', async () => {
    const rels = await call<{ sourceId: string; targetId: string }[]>('u-2', 'GET', 'relations/by-project/p-erp');
    expect(rels.length).toBe(3);
    expect(rels.every((r) => r.sourceId.startsWith('p-erp') && r.targetId.startsWith('p-erp'))).toBe(true);
  });
});
