import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '@core/api/api.config';

/** What the work report is made for: a period (ISO days in the organisation zone), some projects (none = all the caller may export), and optionally one person. */
export interface WorkReportQuery {
  readonly from: string;
  readonly to: string;
  readonly projectIds: readonly string[];
  readonly assigneeId: string;
}

/** The work report as an Excel file, built by the server from the data the caller may see and export (`reports.export`). */
@Injectable({ providedIn: 'root' })
export class WorkReportApi {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  download(query: WorkReportQuery): Observable<Blob> {
    let params = new HttpParams().set('from', query.from).set('to', query.to);
    if (query.projectIds.length) params = params.set('projectIds', query.projectIds.join(','));
    if (query.assigneeId) params = params.set('assigneeId', query.assigneeId);
    return this.http.get(`${this.baseUrl}/reports/work`, { params, responseType: 'blob' });
  }
}
