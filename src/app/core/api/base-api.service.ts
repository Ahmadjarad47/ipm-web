import { HttpClient } from '@angular/common/http';
import { inject } from '@angular/core';
import { Observable } from 'rxjs';
import { CreateDto, Entity, ListQuery, PagedResult, UpdateDto } from '@core/models/entity.model';
import { API_BASE_URL } from './api.config';
import { toHttpParams } from './query-params';

/**
 * Generic REST client for one resource.
 *
 * Every domain API extends this and only declares its `resource` path; resource-specific
 * actions (transition, decide, link...) are added as extra methods on the subclass.
 *
 * @typeParam T       the entity returned by the server
 * @typeParam TCreate payload for POST (defaults to the entity minus server-managed keys)
 * @typeParam TUpdate payload for PATCH (defaults to a partial create payload + `version`)
 */
export abstract class BaseApiService<
  T extends Entity,
  TCreate = CreateDto<T>,
  TUpdate = UpdateDto<T>,
> {
  protected readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  /** Resource path segment, e.g. `projects` or `work-items`. */
  protected abstract readonly resource: string;

  protected get url(): string {
    return `${this.baseUrl}/${this.resource}`;
  }

  list(query: ListQuery<T>): Observable<PagedResult<T>> {
    return this.http.get<PagedResult<T>>(this.url, { params: toHttpParams(query) });
  }

  /** Unpaged list for small lookup tables (statuses, types, roles...). */
  all(): Observable<readonly T[]> {
    return this.http.get<readonly T[]>(`${this.url}/all`);
  }

  getById(id: string): Observable<T> {
    return this.http.get<T>(`${this.url}/${encodeURIComponent(id)}`);
  }

  create(payload: TCreate): Observable<T> {
    return this.http.post<T>(this.url, payload);
  }

  update(id: string, payload: TUpdate): Observable<T> {
    return this.http.patch<T>(`${this.url}/${encodeURIComponent(id)}`, payload);
  }

  /** Logical delete / archive (SRS never hard-deletes records with history). */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${this.url}/${encodeURIComponent(id)}`);
  }

  /** POST to a sub-action of one record, e.g. `work-items/42/transition`. */
  protected action<TBody, TResult = T>(id: string, name: string, body: TBody): Observable<TResult> {
    return this.http.post<TResult>(`${this.url}/${encodeURIComponent(id)}/${name}`, body);
  }
}
