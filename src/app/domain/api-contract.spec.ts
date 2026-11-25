import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApprovalRequestsApi } from './approvals/approval.api';
import { NotificationsApi } from './activity/activity.api';
import { ProjectsApi } from './projects/project.api';
import { WorkReportApi } from './reports/report.api';
import { UsersApi } from './users/user.api';
import { WorkItemsApi } from './work-items/work-item.api';

/**
 * What the web app sends the real API (docs/INTEGRATION.md in the backend repository): routes, verbs and the `If-Match` header.
 * Each test fails if a screen would call an endpoint the server does not have.
 */
describe('API contract of the domain services', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const url = (path: string) => (r: { url: string }) => r.url.endsWith(path);

  it('updates a record with PUT: reads it, merges the changes, and sends the screen version as If-Match', () => {
    TestBed.inject(WorkItemsApi).update('w1', { title: 'new', version: 7 }).subscribe();

    http.expectOne(url('/work-items/w1')).flush({ id: 'w1', title: 'old', description: 'd', priority: 'high', startDate: null, dueDate: null, assigneeIds: [], fields: {}, version: 9 });
    const put = http.expectOne((r) => r.method === 'PUT' && r.url.endsWith('/work-items/w1'));
    expect(put.request.headers.get('If-Match')).toBe('"7"');
    expect(put.request.body).toEqual({ title: 'new', description: 'd', priority: 'high', startDate: null, dueDate: null, assigneeIds: [], fields: {} });
    put.flush({});
    http.match(url('/work-items/w1')); // a failed PUT never overwrites: the version is the user's, not the fresh one
  });

  it('falls back to the fresh version when a list row did not carry one', () => {
    TestBed.inject(ProjectsApi).update('p1', { name: 'n', version: 0 }).subscribe();

    http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/projects/p1')).flush({ id: 'p1', name: 'o', version: 12, repositories: [] });
    expect(http.expectOne((r) => r.method === 'PUT').request.headers.get('If-Match')).toBe('"12"');
  });

  it('reads every page of a lookup', () => {
    let received: readonly unknown[] = [];
    TestBed.inject(UsersApi).all().subscribe((all) => (received = all));

    http.expectOne(url('/users/directory')).flush([{ id: 'u1', username: 'a', name: 'A', title: null, isActive: true }]);
    expect(received).toEqual([expect.objectContaining({ id: 'u1', active: true, title: '' })]);
  });

  it('names the assignee filter the way the API does', () => {
    TestBed.inject(WorkItemsApi).list({ page: 1, pageSize: 10, search: 'x', sort: { field: 'dueDate', direction: 'desc' }, filters: { assigneeIds: ['a', 'b'], projectId: 'p' } }).subscribe();

    const request = http.expectOne((r) => r.url.endsWith('/work-items') && r.method === 'GET');
    expect(request.request.params.get('assigneeId')).toBe('a,b');
    expect(request.request.params.get('projectId')).toBe('p');
    expect(request.request.params.get('q')).toBe('x');
    expect(request.request.params.get('sort')).toBe('dueDate');
    expect(request.request.params.get('desc')).toBe('true');
    request.flush({ items: [], total: 0, page: 1, pageSize: 10 });
  });

  it('moves a work item to another parent with PUT and If-Match', () => {
    TestBed.inject(WorkItemsApi).setParent('w1', 'w2', 5).subscribe();

    const put = http.expectOne((r) => r.method === 'PUT' && r.url.endsWith('/work-items/w1/parent'));
    expect(put.request.headers.get('If-Match')).toBe('"5"');
    expect(put.request.body).toEqual({ parentId: 'w2' });
  });

  it('gives every board card the workflow of its type', () => {
    let cards: readonly { workflowId: string }[] = [];
    TestBed.inject(WorkItemsApi).board('p1').subscribe((items) => (cards = items));

    http.expectOne((r) => r.url.endsWith('/work-items/board')).flush({
      projectId: 'p1',
      workflows: [{ typeId: 't1', workflowId: 'wf1', statusIds: [] }],
      items: [{ id: 'w1', typeId: 't1' }],
    });
    expect(cards).toEqual([expect.objectContaining({ id: 'w1', workflowId: 'wf1' })]);
  });

  it('asks about a type change and returns the conflicts list', () => {
    let conflicts: readonly unknown[] = [];
    TestBed.inject(WorkItemsApi).checkTypeChange('w1', 't2').subscribe((c) => (conflicts = c));

    http.expectOne((r) => r.url.endsWith('/work-items/w1/type-change/check')).flush({ conflicts: [{ field: 'f', reason: 'r' }] });
    expect(conflicts).toEqual([{ field: 'f', reason: 'r' }]);
  });

  it('sends a decision with the revision in the body and the record version in If-Match', () => {
    TestBed.inject(ApprovalRequestsApi).decide('a1', { decision: 'approve', comment: '', revision: 2 }).subscribe();

    http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/approvals/a1')).flush({ id: 'a1', version: 33 });
    const post = http.expectOne((r) => r.method === 'POST' && r.url.endsWith('/approvals/a1/decide'));
    expect(post.request.headers.get('If-Match')).toBe('"33"');
    expect(post.request.body).toEqual({ decision: 'approve', comment: '', revision: 2 });
  });

  it('reads an inbox with the box parameter', () => {
    TestBed.inject(ApprovalRequestsApi).listBox('inbox', { page: 1, pageSize: 5 }).subscribe();

    expect(http.expectOne((r) => r.url.endsWith('/approvals')).request.params.get('box')).toBe('inbox');
  });

  it('marks a notification read with PATCH', () => {
    TestBed.inject(NotificationsApi).markRead('n1').subscribe();

    expect(http.expectOne((r) => r.method === 'PATCH' && r.url.endsWith('/notifications/n1/read'))).toBeTruthy();
  });

  it('replaces the members of a project with PUT and then reads the project again', () => {
    TestBed.inject(ProjectsApi).setMembers('p1', [{ userId: 'u', roleId: 'r' }], 4).subscribe();

    const put = http.expectOne((r) => r.method === 'PUT' && r.url.endsWith('/projects/p1/members'));
    expect(put.request.headers.get('If-Match')).toBe('"4"');
    expect(put.request.body).toEqual({ members: [{ userId: 'u', roleId: 'r' }] });
    put.flush({ project: { id: 'p1' }, warnings: [] });
    http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/projects/p1')).flush({ id: 'p1', version: 5 });
  });

  it('edits a user in the order the API allows: profile, roles, then activation', () => {
    TestBed.inject(UsersApi).update('u1', { name: 'N', systemRoleIds: ['r1'], active: false, version: 3 }).subscribe();

    http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/users/u1')).flush({ id: 'u1', username: 'x', name: 'o', email: 'e', isActive: true, systemRoleIds: [], version: 3 });
    const profile = http.expectOne((r) => r.method === 'PUT' && r.url.endsWith('/users/u1'));
    expect(profile.request.headers.get('If-Match')).toBe('"3"');
    expect(profile.request.body).toEqual({ name: 'N', email: 'e', title: '', managerId: null });
  });

  it('asks for the work report as a file with the period, the projects as a list, and the person', () => {
    TestBed.inject(WorkReportApi).download({ from: '2026-10-01', to: '2026-10-31', projectIds: ['p1', 'p2'], assigneeId: 'u1' }).subscribe();

    const req = http.expectOne((r) => r.method === 'GET' && r.url.endsWith('/reports/work'));
    expect(req.request.responseType).toBe('blob');
    expect(req.request.params.get('from')).toBe('2026-10-01');
    expect(req.request.params.get('to')).toBe('2026-10-31');
    expect(req.request.params.get('projectIds')).toBe('p1,p2');
    expect(req.request.params.get('assigneeId')).toBe('u1');
    req.flush(new Blob());
  });

  it('leaves the project list and the person out when they are not chosen', () => {
    TestBed.inject(WorkReportApi).download({ from: '2026-10-01', to: '2026-10-31', projectIds: [], assigneeId: '' }).subscribe();

    const req = http.expectOne((r) => r.url.endsWith('/reports/work'));
    expect(req.request.params.has('projectIds')).toBe(false);
    expect(req.request.params.has('assigneeId')).toBe(false);
    req.flush(new Blob());
  });
});
