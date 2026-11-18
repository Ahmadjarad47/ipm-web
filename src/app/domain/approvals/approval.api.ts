import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { API_BASE_URL } from '@core/api/api.config';
import { Observable } from 'rxjs';
import { BaseApiService } from '@core/api/base-api.service';
import { toHttpParams } from '@core/api/query-params';
import { ListQuery, PagedResult } from '@core/models/entity.model';
import { ApprovalAction, ApprovalBox, ApprovalRequest, ApprovalSubject, ApprovalTemplate, BulkDecideResult, DecideRequest, Delegation, DelegationCreate } from './approval.models';

export interface SubmitApprovalRequest {
  readonly templateId: string;
  readonly subjectType: ApprovalSubject;
  readonly subjectId: string;
  /** `sensitive.change`: the values to apply when the final stage approves. */
  readonly proposedChanges?: Readonly<Record<string, string | number | null>>;
  /** Gated transitions: what the approval will authorise (the server infers `action` when omitted). */
  readonly action?: ApprovalAction;
  readonly targetStatusId?: string;
}

@Injectable({ providedIn: 'root' })
export class ApprovalRequestsApi extends BaseApiService<ApprovalRequest, SubmitApprovalRequest> {
  protected readonly resource = 'approvals';

  /** inbox = waiting for my decision, sent = submitted by me, closed = finished requests I may see. */
  listBox(box: ApprovalBox, query: ListQuery<ApprovalRequest>): Observable<PagedResult<ApprovalRequest>> {
    const params = toHttpParams(query).set('filter.box', box);
    return this.http.get<PagedResult<ApprovalRequest>>(this.url, { params });
  }

  /** Server enforces stage order, self-approval ban and revision match (FR-APR-04/06, §4.3). */
  decide(id: string, request: DecideRequest): Observable<ApprovalRequest> {
    return this.action(id, 'decide', request);
  }

  resubmit(id: string): Observable<ApprovalRequest> {
    return this.action(id, 'resubmit', {});
  }

  /** FR-APR-07: notify the current approvers (one reminder per hour). */
  remind(id: string): Observable<ApprovalRequest> {
    return this.action(id, 'remind', {});
  }

  /** Approve many pending requests at once; reject/return are never bulk (comment is mandatory). */
  bulkApprove(ids: readonly string[], comment?: string, revisions?: Readonly<Record<string, number>>): Observable<BulkDecideResult[]> {
    return this.http.post<BulkDecideResult[]>(`${this.url}/bulk-decide`, { ids, decision: 'Approve', comment, revisions });
  }

  /** FR-APR-11: substitute the active stage's approver (absence), with a mandatory reason; needs `approvals.configure`. */
  reassign(id: string, approverId: string, reason: string): Observable<ApprovalRequest> {
    return this.action(id, 'reassign', { approverId, reason });
  }
}

@Injectable({ providedIn: 'root' })
export class ApprovalTemplatesApi extends BaseApiService<ApprovalTemplate> {
  protected readonly resource = 'approval-templates';

  /** FR-APR-01/13: the active template governing this subject and action, or null. */
  matchTemplate(subjectType: ApprovalSubject, subjectId: string, action: ApprovalAction): Observable<ApprovalTemplate | null> {
    const params = new HttpParams().set('subjectType', subjectType).set('subjectId', subjectId).set('action', action);
    return this.http.get<ApprovalTemplate | null>(`${this.url}/match`, { params });
  }
}

@Injectable({ providedIn: 'root' })
export class DelegationsApi {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_BASE_URL)}/delegations`;

  list(): Observable<Delegation[]> {
    return this.http.get<Delegation[]>(this.url);
  }

  create(dto: DelegationCreate): Observable<Delegation> {
    return this.http.post<Delegation>(this.url, dto);
  }

  revoke(id: string): Observable<null> {
    return this.http.delete<null>(`${this.url}/${encodeURIComponent(id)}`);
  }
}
