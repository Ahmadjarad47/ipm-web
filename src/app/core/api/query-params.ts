import { HttpHeaders, HttpParams } from '@angular/common/http';
import { ListQuery, PagedResult } from '@core/models/entity.model';

/**
 * Serialises a typed `ListQuery<T>` into the query string the API reads:
 * `page`, `pageSize`, `search`, `sort=<field>` with `descending=true`, and every filter as a plain parameter (`statusId=…`,
 * an array becomes a comma list).
 */
export function toHttpParams<T>(query: ListQuery<T>): HttpParams {
  let params = new HttpParams().set('page', query.page).set('pageSize', query.pageSize);
  if (query.search?.trim()) {
    params = params.set('search', query.search.trim());
  }
  if (query.sort) {
    params = params.set('sort', query.sort.field);
    if (query.sort.direction === 'desc') params = params.set('descending', true);
  }
  for (const [field, value] of Object.entries(query.filters ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    params = params.set(field, Array.isArray(value) ? value.join(',') : String(value));
  }
  return params;
}

/** `If-Match` for an update: the API's ETag is the record `version`, in quotes. */
export function ifMatch(version: number): HttpHeaders {
  return new HttpHeaders({ 'If-Match': `"${version}"` });
}

/** The API pages lists (`items`, `total`…); a few small lookups answer a plain array. Both become a page. */
export function asPage<T>(response: PagedResult<T> | readonly T[]): PagedResult<T> {
  return Array.isArray(response)
    ? { items: response as readonly T[], total: response.length, page: 1, pageSize: Math.max(response.length, 1) }
    : (response as PagedResult<T>);
}
