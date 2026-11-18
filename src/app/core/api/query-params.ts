import { HttpParams } from '@angular/common/http';
import { ListQuery } from '@core/models/entity.model';

/**
 * Serialises a typed `ListQuery<T>` into query-string params.
 * Contract: `page`, `pageSize`, `search`, `sort=field:dir`, `filter.<field>=v1,v2`.
 */
export function toHttpParams<T>(query: ListQuery<T>): HttpParams {
  let params = new HttpParams().set('page', query.page).set('pageSize', query.pageSize);

  if (query.search?.trim()) {
    params = params.set('search', query.search.trim());
  }
  if (query.sort) {
    params = params.set('sort', `${query.sort.field}:${query.sort.direction}`);
  }
  for (const [field, value] of Object.entries(query.filters ?? {})) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    params = params.set(`filter.${field}`, Array.isArray(value) ? value.join(',') : String(value));
  }
  return params;
}
