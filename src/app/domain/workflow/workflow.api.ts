import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '@core/api/api.config';
import { BaseApiService } from '@core/api/base-api.service';
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

@Injectable({ providedIn: 'root' })
export class TransitionsApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** Status history of one work item or project, oldest first. */
  bySubject(subjectType: TransitionRecord['subjectType'], subjectId: string): Observable<readonly TransitionRecord[]> {
    const params = new HttpParams().set('subjectType', subjectType).set('subjectId', subjectId);
    return this.http.get<readonly TransitionRecord[]>(`${this.baseUrl}/transitions/by-subject`, { params });
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

  /** Transitions leaving `statusId` inside `workflowId`. */
  transitionsFrom(workflowId: string | undefined, statusId: string): readonly Transition[] {
    return this.get(workflowId)?.transitions.filter((t) => t.fromStatusId === statusId) ?? [];
  }
}
