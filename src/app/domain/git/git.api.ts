import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '@core/api/api.config';
import { toHttpParams } from '@core/api/query-params';
import { ListQuery, PagedResult } from '@core/models/entity.model';
import { SimulateWebhookRequest, WebhookDelivery } from './git.models';

/** Git integration administration: webhook delivery log, redelivery and the demo simulator. */
@Injectable({ providedIn: 'root' })
export class GitIntegrationApi {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_BASE_URL)}/git`;

  /** FR-GIT-05/06: received deliveries with outcome, newest first. */
  deliveries(projectId: string, query: ListQuery<WebhookDelivery>): Observable<PagedResult<WebhookDelivery>> {
    const params: HttpParams = toHttpParams(query).set('filter.projectId', projectId);
    return this.http.get<PagedResult<WebhookDelivery>>(`${this.url}/deliveries`, { params });
  }

  /** Re-process a failed delivery from its stored payload (idempotent per work item link). */
  redeliver(deliveryId: string): Observable<WebhookDelivery> {
    return this.http.post<WebhookDelivery>(`${this.url}/deliveries/${encodeURIComponent(deliveryId)}/redeliver`, {});
  }

  /**
   * Demo mode only: signs a provider-shaped payload with the repository secret and posts it to the
   * real webhook endpoint, so signature checks, dedupe and auto-linking all run for real.
   */
  simulate(request: SimulateWebhookRequest): Observable<WebhookDelivery> {
    return this.http.post<WebhookDelivery>(`${this.url}/simulate`, request);
  }
}
