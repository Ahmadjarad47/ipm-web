import { EMPTY, expand, map, Observable, reduce } from 'rxjs';
import { PagedResult } from '@core/models/entity.model';

/**
 * Loads every page of a paged endpoint sequentially (used by exports instead of "first 100").
 * `onProgress` receives the loaded/total counts after each page; unsubscribe to cancel between pages.
 */
export function fetchAllPages<T>(
  fetchPage: (page: number) => Observable<PagedResult<T>>,
  onProgress: (loaded: number, total: number) => void = () => undefined,
): Observable<readonly T[]> {
  let loaded = 0;
  return fetchPage(1).pipe(
    expand((res) => {
      loaded += res.items.length;
      onProgress(loaded, res.total);
      return res.items.length > 0 && loaded < res.total ? fetchPage(res.page + 1) : EMPTY;
    }),
    map((res) => res.items),
    reduce<readonly T[], readonly T[]>((all, items) => [...all, ...items], []),
  );
}
