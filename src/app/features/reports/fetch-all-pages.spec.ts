import { of } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { PagedResult } from '@core/models/entity.model';
import { fetchAllPages } from './fetch-all-pages';

describe('fetchAllPages', () => {
  const data = Array.from({ length: 250 }, (_, i) => i);
  const page = (n: number): PagedResult<number> => ({ items: data.slice((n - 1) * 100, n * 100), total: 250, page: n, pageSize: 100 });

  it('walks every page and reports progress', () => {
    const progress: number[] = [];
    let result: readonly number[] = [];
    fetchAllPages((n) => of(page(n)), (loaded) => progress.push(loaded)).subscribe((r) => (result = r));
    expect(result).toHaveLength(250);
    expect(progress).toEqual([100, 200, 250]);
  });
});
