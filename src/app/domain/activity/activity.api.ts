import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { API_BASE_URL } from '@core/api/api.config';
import { BaseApiService } from '@core/api/base-api.service';
import { asPage, ifMatch, toHttpParams } from '@core/api/query-params';
import { ListQuery, PagedResult } from '@core/models/entity.model';
import { AuditEvent, AuditVerification, Comment, CommentRevision, DashboardStats, GitEvent, Notification, NotificationPage } from './activity.models';

/** An audit event as the API returns it; the hash chain stays on the server (`GET audit/verify` checks it). */
type ServerAuditEvent = Omit<AuditEvent, 'version' | 'createdAt' | 'updatedAt' | 'prevHash' | 'hash'>;

const toAuditEvent = (e: ServerAuditEvent): AuditEvent => ({ ...e, version: 0, createdAt: e.at, updatedAt: e.at, prevHash: '', hash: '' });

@Injectable({ providedIn: 'root' })
export class AuditApi extends BaseApiService<AuditEvent> {
  protected readonly resource = 'audit';
  protected override readonly searchParam = 'search';

  override list(query: ListQuery<AuditEvent>): Observable<PagedResult<AuditEvent>> {
    return this.http
      .get<PagedResult<ServerAuditEvent>>(this.url, { params: this.toParams(query) })
      .pipe(map((page) => ({ ...page, items: page.items.map(toAuditEvent) })));
  }

  /**
   * FR-AUD-08: the matching events as a CSV file, built by the server (for holders of `audit.export`); the export itself is
   * recorded as an audit event. Up to 50,000 rows: beyond that the server asks for narrower filters.
   */
  exportCsv(query: ListQuery<AuditEvent>): Observable<Blob> {
    const params = this.toParams({ ...query, page: 1, pageSize: 1 }).delete('page').delete('pageSize').set('format', 'csv');
    return this.http.get(`${this.url}/export`, { params, responseType: 'blob' });
  }

  /** FR-AUD-09: recomputes the tamper-evidence hash chain server-side (needs `audit.view`). */
  verify(): Observable<AuditVerification> {
    return this.http.get<AuditVerification>(`${this.url}/verify`);
  }
}

/** A comment as the API returns it; the edit history is a separate read (`revisions`). */
type ServerComment = Omit<Comment, 'revisions' | 'updatedAt'>;

const toComment = (c: ServerComment): Comment => ({ ...c, revisions: [], updatedAt: c.createdAt });

@Injectable({ providedIn: 'root' })
export class CommentsApi extends BaseApiService<Comment, Pick<Comment, 'subjectType' | 'subjectId' | 'body'>> {
  protected readonly resource = 'comments';

  override create(payload: Pick<Comment, 'subjectType' | 'subjectId' | 'body'>): Observable<Comment> {
    return this.http.post<ServerComment>(this.url, payload).pipe(map(toComment));
  }

  forSubject(subjectType: Comment['subjectType'], subjectId: string): Observable<readonly Comment[]> {
    const params = new HttpParams().set('subjectType', subjectType).set('subjectId', subjectId).set('page', 1).set('pageSize', 200);
    return this.http.get<PagedResult<ServerComment> | readonly ServerComment[]>(this.url, { params }).pipe(map((r) => asPage(r).items.map(toComment)));
  }

  /** A comment has no read of its own: the edit goes straight to the server with the version the screen holds. */
  override update(id: string, payload: { readonly body?: string; readonly version: number }): Observable<Comment> {
    return this.http.put<ServerComment>(`${this.url}/${encodeURIComponent(id)}`, { body: payload.body }, { headers: ifMatch(payload.version) }).pipe(map(toComment));
  }

  /** Deleting needs the version of the comment the screen shows (a comment has no read of its own). */
  override remove(id: string, version = 0): Observable<void> {
    return this.http.delete<void>(`${this.url}/${encodeURIComponent(id)}`, { headers: ifMatch(version) });
  }

  revisions(id: string): Observable<readonly CommentRevision[]> {
    return this.http.get<readonly CommentRevision[]>(`${this.url}/${encodeURIComponent(id)}/revisions`);
  }
}

/** A notification as the API returns it (the list is always the caller's own, so it carries no owner). */
type ServerNotification = Omit<Notification, 'userId' | 'version' | 'updatedAt'>;

const toNotification = (n: ServerNotification): Notification => ({ ...n, userId: '', version: 0, updatedAt: n.createdAt });

@Injectable({ providedIn: 'root' })
export class NotificationsApi extends BaseApiService<Notification> {
  protected readonly resource = 'notifications';

  /** One page of the caller's notifications (newest first) with the total unread count. */
  page(page = 1, pageSize = 30): Observable<NotificationPage> {
    const params = new HttpParams().set('page', page).set('pageSize', pageSize);
    return this.http
      .get<Omit<NotificationPage, 'items'> & { readonly items: readonly ServerNotification[] }>(this.url, { params })
      .pipe(map((p) => ({ ...p, items: p.items.map(toNotification) })));
  }

  markRead(id: string): Observable<Notification> {
    return this.http.patch<ServerNotification>(`${this.url}/${encodeURIComponent(id)}/read`, {}).pipe(map(toNotification));
  }

  markAllRead(): Observable<void> {
    return this.http.post<void>(`${this.url}/read-all`, {});
  }
}

@Injectable({ providedIn: 'root' })
export class GitEventsApi extends BaseApiService<GitEvent> {
  protected readonly resource = 'git-events';
  protected override readonly searchParam = 'search';

  /** Commits, branches and PRs linked to one work item ref (FR-GIT-02). Git events are read per project. */
  forWorkItem(projectId: string, ref: string): Observable<readonly GitEvent[]> {
    const params = new HttpParams().set('page', 1).set('pageSize', 100).set('projectId', projectId).set('workItemRef', ref);
    return this.http.get<{ items: readonly GitEvent[] }>(this.url, { params }).pipe(map((p) => p.items));
  }

  /** Manual link for commits/PRs whose message lacks the ref (FR-GIT-03, any type — FR-GIT-11). */
  link(eventId: string, ref: string): Observable<GitEvent> {
    return this.http.post<GitEvent>(`${this.url}/${encodeURIComponent(eventId)}/link`, { ref });
  }

  unlink(eventId: string, ref: string): Observable<GitEvent> {
    return this.http.post<GitEvent>(`${this.url}/${encodeURIComponent(eventId)}/unlink`, { ref });
  }
}

export interface DashboardFilter {
  readonly projectId?: string;
  readonly from?: string;
  readonly to?: string;
  /** Status category key, or a comma-separated list. */
  readonly statusCategory?: string;
  readonly assigneeId?: string;
}

/** Read-only aggregates computed server-side from stable status categories (SRS §6.3). */
@Injectable({ providedIn: 'root' })
export class DashboardApi {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_BASE_URL)}/dashboard`;

  stats(filter: DashboardFilter = {}): Observable<DashboardStats> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filter)) {
      if (value) params = params.set(key, value);
    }
    return this.http.get<DashboardStats>(`${this.url}/stats`, { params });
  }
}

export { toHttpParams };
