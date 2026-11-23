import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable, Injector } from '@angular/core';
import { map, Observable } from 'rxjs';
import { API_BASE_URL } from '@core/api/api.config';
import { BaseApiService } from '@core/api/base-api.service';
import { PagedResult } from '@core/models/entity.model';
import { LookupStore } from '@core/state/lookup.store';
import { ImpactInfo } from '@domain/work-items/work-item.models';
import { Status, Transition, TransitionRecord, Workflow } from './workflow.models';

@Injectable({ providedIn: 'root' })
export class StatusesApi extends BaseApiService<Status> {
  protected readonly resource = 'statuses';

  /** Read-only preview before disabling (FR-WF-06). */
  impact(id: string): Observable<ImpactInfo> {
    return this.http.get<ImpactInfo>(`${this.url}/${encodeURIComponent(id)}/impact`);
  }
}

/** One status change as the API returns it (the screen also shows the names, which the lookup knows). */
interface ServerTransition {
  readonly at: string;
  readonly fromStatusId: string;
  readonly toStatusId: string;
  readonly actorId: string;
  readonly comment: string | null;
}

@Injectable({ providedIn: 'root' })
export class TransitionsApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);
  private readonly injector = inject(Injector);

  /** Status history of one work item or project, oldest first. */
  bySubject(subjectType: TransitionRecord['subjectType'], subjectId: string): Observable<readonly TransitionRecord[]> {
    const path = subjectType === 'project' ? 'projects' : 'work-items';
    const params = new HttpParams().set('page', 1).set('pageSize', 200);
    return this.http.get<PagedResult<ServerTransition>>(`${this.baseUrl}/${path}/${encodeURIComponent(subjectId)}/status-history`, { params }).pipe(
      map((page) => {
        const statuses = this.injector.get(StatusLookup);
        return [...page.items].reverse().map((t, i) => ({
          id: `${subjectId}:${i}`,
          version: 0,
          createdAt: t.at,
          updatedAt: t.at,
          subjectType,
          itemId: subjectId,
          projectId: '',
          fromStatusId: t.fromStatusId,
          toStatusId: t.toStatusId,
          fromName: statuses.get(t.fromStatusId)?.name ?? '—',
          toName: statuses.get(t.toStatusId)?.name ?? '—',
          actorId: t.actorId,
          comment: t.comment,
          at: t.at,
        }));
      }),
    );
  }
}

@Injectable({ providedIn: 'root' })
export class WorkflowsApi extends BaseApiService<Workflow> {
  protected readonly resource = 'workflows';
}

@Injectable({ providedIn: 'root' })
export class StatusLookup extends LookupStore<Status> {
  protected readonly api = inject(StatusesApi);
}

@Injectable({ providedIn: 'root' })
export class WorkflowLookup extends LookupStore<Workflow> {
  protected readonly api = inject(WorkflowsApi);
  protected override readonly alsoDependsOn = ['statuses'];

  /** Transitions leaving `statusId` inside `workflowId`. */
  transitionsFrom(workflowId: string | undefined, statusId: string): readonly Transition[] {
    return this.get(workflowId)?.transitions.filter((t) => t.fromStatusId === statusId) ?? [];
  }
}
