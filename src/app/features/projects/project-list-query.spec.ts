import { describe, expect, it } from 'vitest';
import { paramsToQuery, parseSort, queryToParams, ParamReader } from './project-list-query';

const reader = (values: Record<string, string>): ParamReader => ({ get: (name) => values[name] ?? null });

describe('projects list URL serialisation', () => {
  it('defaults to active projects only and omits default params', () => {
    const query = paramsToQuery(reader({}));
    expect(query.filters).toEqual({ archived: false });
    expect(query.page).toBe(1);
    const params = queryToParams(query);
    expect(Object.values(params).every((v) => v === null)).toBe(true);
  });

  it('round-trips search, filters, date range, sort and page', () => {
    const url = { q: 'erp', status: 's1', owner: 'u1', member: 'u2', archived: '1', from: '2026-01-01', to: '2026-12-31', sort: 'progress:desc', page: '3' };
    const query = paramsToQuery(reader(url), 20);
    expect(query).toMatchObject({
      page: 3,
      pageSize: 20,
      search: 'erp',
      sort: { field: 'progress', direction: 'desc' },
      filters: { statusId: 's1', ownerId: 'u1', memberId: 'u2', endFrom: '2026-01-01', startTo: '2026-12-31' },
    });
    expect((query.filters as Record<string, unknown>)['archived']).toBeUndefined();
    expect(queryToParams(query)).toEqual(url);
  });

  it('ignores unknown sort fields, bad dates and bad pages', () => {
    expect(parseSort('password:asc')).toBeUndefined();
    const query = paramsToQuery(reader({ from: 'tomorrow', page: '-2', sort: 'x:asc' }));
    expect(query.page).toBe(1);
    expect(query.sort).toBeUndefined();
    expect((query.filters as Record<string, unknown>)['endFrom']).toBeUndefined();
  });
});
