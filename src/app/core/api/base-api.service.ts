import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { concat, defer, expand, last, map, Observable, reduce, switchMap, tap } from 'rxjs';
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

  /** The query parameter that carries the search text; a few resources call it `search` instead of `q`. */
  protected readonly searchParam: string = 'q';

  /** The query string of a list call; override where the resource names its filters differently. */
  protected toParams(query: ListQuery<T>): HttpParams {
    return toHttpParams(query, this.searchParam);
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

  /**
   * The API replaces a record with PUT, while screens send only what changed. So the current record is read, the changes are laid
   * over it, and the whole is sent with the caller's `version` as `If-Match` (a stale version is refused with 412, never overwritten).
   */
  update(id: string, payload: TUpdate): Observable<T> {
    const { version, ...changes } = payload as { readonly version: number };
    return this.getById(id).pipe(
      switchMap((current) =>
        this.http.put<T>(`${this.url}/${encodeURIComponent(id)}`, this.toUpdateBody({ ...current, ...changes } as T), { headers: ifMatch(version ?? current.version) }),
      ),
    );
  }

  /** The PUT body for a merged record; override where the API's names or shape differ from the entity's. */
  protected toUpdateBody(merged: T): unknown {
    return merged;
  }

  /**
   * One screen edit that the API splits into several calls (a record's fields, its children, its activation…). Each call moves the
   * record's version, so they run in order and each one carries the version the call before it produced (the `ETag` of its answer).
   */
  protected sequence(id: string, version: number, steps: readonly SequenceStep[]): Observable<T> {
    let current = version;
    return concat(
      ...steps.map((step) =>
        defer(() => {
          const url = `${this.url}/${encodeURIComponent(id)}${step.path}`;
          const options = { headers: ifMatch(current), observe: 'response' as const };
          const call = step.method === 'PUT' ? this.http.put<unknown>(url, step.body, options) : this.http.post<unknown>(url, step.body, options);
          return call.pipe(tap((r: HttpResponse<unknown>) => (current = Number(r.headers.get('ETag')?.replaceAll('"', '') ?? current))));
        }),
      ),
    ).pipe(last(), switchMap(() => this.getById(id)));
  }

  /** Logical delete / archive (SRS never hard-deletes records with history). */
  remove(id: string, version?: number): Observable<void> {
    const call = (v: number) => this.http.delete<void>(`${this.url}/${encodeURIComponent(id)}`, { headers: ifMatch(v) });
    return version === undefined ? this.getById(id).pipe(switchMap((current) => call(current.version))) : call(version);
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

/** One call of a multi-call edit (see `BaseApiService.sequence`); `path` is relative to the record, e.g. `/fields`. */
export interface SequenceStep {
  readonly method: 'PUT' | 'POST';
  readonly path: string;
  readonly body: unknown;
}
