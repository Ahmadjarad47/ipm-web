import { describe, expect, it } from 'vitest';
import { DEFAULT_DASHBOARD_FILTERS, dashboardFiltersFromQuery, dashboardFiltersToQuery, resolveDashboardPeriod, toDashboardFilter } from './dashboard-filters';

describe('dashboard filters', () => {
  const today = '2026-03-15';

  it('maps presets to from/to', () => {
    const base = DEFAULT_DASHBOARD_FILTERS;
    expect(resolveDashboardPeriod({ ...base, period: 'all' }, today)).toEqual({});
    expect(resolveDashboardPeriod({ ...base, period: 'last30' }, today)).toEqual({ from: '2026-02-13', to: today });
    expect(resolveDashboardPeriod({ ...base, period: 'next30' }, today)).toEqual({ from: today, to: '2026-04-14' });
    expect(resolveDashboardPeriod({ ...base, period: 'month' }, today)).toEqual({ from: '2026-03-01', to: '2026-03-31' });
    expect(resolveDashboardPeriod({ ...base, period: 'custom', from: '2026-01-01', to: '' }, today)).toEqual({ from: '2026-01-01', to: undefined });
  });

  it('builds the API filter and omits empty values', () => {
    const f = toDashboardFilter({ ...DEFAULT_DASHBOARD_FILTERS, projectId: 'p1', category: 'active' }, today);
    expect(f).toEqual({ projectId: 'p1', statusCategory: 'active', assigneeId: undefined });
  });

  it('round-trips through the URL and ignores junk', () => {
    const f = { projectId: 'p1', period: 'custom' as const, from: '2026-01-01', to: '2026-02-01', category: 'done' as const, assigneeId: 'u2' };
    const q = dashboardFiltersToQuery(f);
    expect(dashboardFiltersFromQuery((k) => q[k] ?? null)).toEqual(f);
    expect(dashboardFiltersToQuery(DEFAULT_DASHBOARD_FILTERS)).toEqual({ project: null, period: null, from: null, to: null, category: null, assignee: null });
    expect(dashboardFiltersFromQuery((k) => (k === 'period' ? 'zzz' : k === 'category' ? 'x' : null))).toEqual(DEFAULT_DASHBOARD_FILTERS);
  });

  it('does not serialise custom dates for presets', () => {
    expect(dashboardFiltersToQuery({ ...DEFAULT_DASHBOARD_FILTERS, period: 'month', from: '2026-01-01' })['from']).toBeNull();
  });
});
