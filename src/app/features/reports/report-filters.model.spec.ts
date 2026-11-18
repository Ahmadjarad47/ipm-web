import { describe, expect, it } from 'vitest';
import { csvCell, DEFAULT_FILTERS, filtersFromQuery, filtersToQuery, resolvePeriod } from './report-filters.model';

describe('report filters', () => {
  const today = '2026-11-18';

  it('resolves periods from the org-zone today', () => {
    expect(resolvePeriod({ ...DEFAULT_FILTERS, period: 'all' }, today)).toEqual({});
    expect(resolvePeriod({ ...DEFAULT_FILTERS, period: 'month' }, today)).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    // next 3 months crosses the year end
    expect(resolvePeriod({ ...DEFAULT_FILTERS, period: 'next3' }, today)).toEqual({ from: '2026-11-01', to: '2027-01-31' });
    expect(resolvePeriod({ ...DEFAULT_FILTERS, period: 'custom', from: '2026-01-05' }, today)).toEqual({ from: '2026-01-05', to: undefined });
  });

  it('round-trips URL params', () => {
    const f = { projectId: 'p1', period: 'custom' as const, from: '2026-01-01', to: '2026-02-01', category: 'Active' as const, assigneeId: 'u1' };
    const q = filtersToQuery(f);
    expect(filtersFromQuery((k) => q[k] ?? null)).toEqual(f);
    expect(filtersFromQuery(() => null)).toEqual(DEFAULT_FILTERS);
  });

  it('neutralises CSV formulas', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('a,b')).toBe('"a,b"');
  });
});
