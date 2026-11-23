import { HttpClient, HttpParams } from '@angular/common/http';
import { inject } from '@angular/core';
import { expand, map, Observable, reduce } from 'rxjs';
import { CreateDto, Entity, ListQuery, PagedResult, UpdateDto } from '@core/models/entity.model';
import { API_BASE_URL } from './api.config';
import { asPage, ifMatch, toHttpParams } from './query-params';

/** The largest page the API serves; `all()` reads lists this many at a time. */
const MAX_PAGE_SIZE = 200;

/**
 * Generic REST client for one resource of the real API.
 *
 * Every domain API extends this and only declares its `resource` path; resource-specific
 * actions (transition, decide, link...) are added as extra methods on the subclass. Where a resource's route or shape
 * differs from these conventions, the subclass overrides the method (this is the only place that knows the server).
 *
 * Conventions: lists are paged (`items`, `total`), updates are `PUT` with the record `version` sent as `If-Match`
 * (the body keeps no version), and a stale version answers 412.
 *
 * @typeParam T       the entity returned by the server
 * @typeParam TCreate payload for POST (defaults to the entity minus server-managed keys)
 * @typeParam TUpdate payload for PUT (defaults to a partial create payload + `version`)
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

  /** The query string of a list call; override where the resource names its filters differently. */
  protected toParams(query: ListQuery<T>): HttpParams {
    return toHttpParams(query);
  }

  list(query: ListQuery<T>): Observable<PagedResult<T>> {
    return this.http.get<PagedResult<T> | readonly T[]>(this.url, { params: this.toParams(query) }).pipe(map(asPage));
  }

  /** Every record of a small lookup table (statuses, types, roles...): reads page after page until the last. */
  all(): Observable<readonly T[]> {
    const page = (n: number) =>
      this.http.get<PagedResult<T> & { readonly hasNextPage?: boolean }>(this.url, { params: new HttpParams().set('page', n).set('pageSize', MAX_PAGE_SIZE) });
    return page(1).pipe(
      expand((res, index) => (res.hasNextPage ? page(index + 2) : [])),
      reduce((acc, res) => [...acc, ...(Array.isArray(res) ? (res as readonly T[]) : res.items)], [] as readonly T[]),
    );
  }

  getById(id: string): Observable<T> {
    return this.http.get<T>(`${this.url}/${encodeURIComponent(id)}`);
  }

  create(payload: TCreate): Observable<T> {
    return this.http.post<T>(this.url, payload);
  }

  update(id: string, payload: TUpdate): Observable<T> {
    const { version, ...body } = payload as { readonly version: number };
    return this.http.put<T>(`${this.url}/${encodeURIComponent(id)}`, body, { headers: ifMatch(version) });
  }

  /** Logical delete / archive (SRS never hard-deletes records with history). */
  remove(id: string, version?: number): Observable<void> {
    return this.http.delete<void>(`${this.url}/${encodeURIComponent(id)}`, version === undefined ? {} : { headers: ifMatch(version) });
  }

  /** POST to a sub-action of one record, e.g. `work-items/42/transition`. A `version` in the body goes in `If-Match` instead. */
  protected action<TBody, TResult = T>(id: string, name: string, body: TBody): Observable<TResult> {
    const { version, ...rest } = (body ?? {}) as { readonly version?: number };
    return this.http.post<TResult>(
      `${this.url}/${encodeURIComponent(id)}/${name}`,
      version === undefined ? body : rest,
      version === undefined ? {} : { headers: ifMatch(version) },
    );
  }
}
