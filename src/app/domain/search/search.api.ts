import { HttpClient, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { API_BASE_URL } from '@core/api/api.config';

export type SearchHitKind = 'project' | 'work-item' | 'approval' | 'user';

export interface SearchHit {
  readonly kind: SearchHitKind;
  readonly id: string;
  /** Short code shown LTR, e.g. ERP-104 or ERP. */
  readonly code: string | null;
  readonly title: string;
  readonly subtitle: string;
  readonly link: string;
  /** Work item type id, for its icon. */
  readonly typeId?: string;
}

/** Global search across everything the caller may see (permission-filtered server-side). */
@Injectable({ providedIn: 'root' })
export class SearchApi {
  private readonly http = inject(HttpClient);
  private readonly url = `${inject(API_BASE_URL)}/search`;

  search(q: string, limit = 12): Observable<readonly SearchHit[]> {
    const params = new HttpParams().set('q', q).set('limit', limit);
    return this.http.get<readonly SearchHit[]>(this.url, { params, headers: { 'X-Silent-Error': '1' } });
  }
}
