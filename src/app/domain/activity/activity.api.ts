import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { API_BASE_URL } from '@core/api/api.config';
import { BaseApiService } from '@core/api/base-api.service';
import { toHttpParams } from '@core/api/query-params';
import { ListQuery } from '@core/models/entity.model';
import { AuditEvent, AuditVerification, Comment, CommentRevision, DashboardStats, GitEvent, Notification, NotificationPage } from './activity.models';

@Injectable({ providedIn: 'root' })
export class AuditApi extends BaseApiService<AuditEvent> {
  protected readonly resource = 'audit';

  /**
   * FR-AUD-08: every matching event (not just one page), for holders of `audit.export`.
   * The export itself is recorded as an audit event server-side.
   */
  export(query: ListQuery<AuditEvent>): Observable<readonly AuditEvent[]> {
    return this.http.get<readonly AuditEvent[]>(`${this.url}/export`, { params: toHttpParams(query) });
  }

  /** FR-AUD-09: recomputes the tamper-evidence hash chain server-side (needs `audit.view`). */
  verify(): Observable<AuditVerification> {
    return this.http.get<AuditVerification>(`${this.url}/verify`);
  }
}

@Injectable({ providedIn: 'root' })
export class CommentsApi extends BaseApiService<Comment, Pick<Comment, 'subjectType' | 'subjectId' | 'body'>> {
  protected readonly resource = 'comments';

  forSubject(subjectType: Comment['subjectType'], subjectId: string): Observable<readonly Comment[]> {
    const params = new HttpParams().set('subjectType', subjectType).set('subjectId', subjectId);
    return this.http.get<readonly Comment[]>(`${this.url}/by-subject`, { params });
  }

  revisions(id: string): Observable<readonly CommentRevision[]> {
    return this.http.get<readonly CommentRevision[]>(`${this.url}/${encodeURIComponent(id)}/revisions`);
  }
}

@Injectable({ providedIn: 'root' })
export class NotificationsApi extends BaseApiService<Notification> {
  protected readonly resource = 'notifications';

  /** One page of the caller's notifications (newest first) with the total unread count. */
  page(page = 1, pageSize = 30): Observable<NotificationPage> {
    const params = new HttpParams().set('page', page).set('pageSize', pageSize);
    return this.http.get<NotificationPage>(`${this.url}/all`, { params });
  }

  markAllRead(): Observable<void> {
    return this.http.post<void>(`${this.url}/read-all`, {});
  }
}

@Injectable({ providedIn: 'root' })
export class GitEventsApi extends BaseApiService<GitEvent> {
  protected readonly resource = 'git-events';

  /** Commits, branches and PRs linked to one work item ref (FR-GIT-02). */
  forWorkItem(ref: string): Observable<readonly GitEvent[]> {
    const params = new HttpParams().set('page', 1).set('pageSize', 100).set('filter.workItemRef', ref);
    return this.http.get<{ items: readonly GitEvent[] }>(this.url, { params }).pipe(map((p) => p.items));
  }

  /** Manual link for commits/PRs whose message lacks the ref (FR-GIT-03, any type — FR-GIT-11). */
  link(eventId: string, ref: string): Observable<GitEvent> {
    return this.action(eventId, 'link', { ref });
  }

  unlink(eventId: string, ref: string): Observable<GitEvent> {
    return this.action(eventId, 'unlink', { ref });
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
