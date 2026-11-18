import { DashboardFilter } from '@domain/activity/activity.api';
import { STATUS_CATEGORIES, StatusCategory } from '@domain/workflow/workflow.models';
import { addDays, monthRange } from '@shared/util/org-date';

export type DashboardPeriod = 'all' | 'last30' | 'next30' | 'month' | 'custom';

export const DASHBOARD_PERIOD_LABELS: Readonly<Record<DashboardPeriod, string>> = {
  all: 'كل الفترات',
  last30: 'آخر 30 يومًا',
  next30: 'الـ 30 يومًا القادمة',
  month: 'هذا الشهر',
  custom: 'مخصص (من – إلى)',
};

export interface DashboardFilters {
  readonly projectId: string;
  readonly period: DashboardPeriod;
  /** ISO dates, used when `period === 'custom'`. */
  readonly from: string;
  readonly to: string;
  readonly category: StatusCategory | '';
  readonly assigneeId: string;
}

export const DEFAULT_DASHBOARD_FILTERS: DashboardFilters = { projectId: '', period: 'all', from: '', to: '', category: '', assigneeId: '' };

/** Resolves a period preset to org-zone calendar bounds; `undefined` = unbounded. `today` is the org-zone date. */
export function resolveDashboardPeriod(f: Pick<DashboardFilters, 'period' | 'from' | 'to'>, today: string): { from?: string; to?: string } {
  switch (f.period) {
    case 'last30': return { from: addDays(today, -30), to: today };
    case 'next30': return { from: today, to: addDays(today, 30) };
    case 'month': return monthRange(today);
    case 'custom': return { from: f.from || undefined, to: f.to || undefined };
    default: return {};
  }
}

export function toDashboardFilter(f: DashboardFilters, today: string): DashboardFilter {
  return {
    projectId: f.projectId || undefined,
    ...resolveDashboardPeriod(f, today),
    statusCategory: f.category || undefined,
    assigneeId: f.assigneeId || undefined,
  };
}

const PERIODS: readonly DashboardPeriod[] = ['last30', 'next30', 'month', 'custom'];

export function dashboardFiltersFromQuery(get: (key: string) => string | null): DashboardFilters {
  const period = get('period');
  const category = get('category');
  return {
    projectId: get('project') ?? '',
    period: PERIODS.find((p) => p === period) ?? 'all',
    from: get('from') ?? '',
    to: get('to') ?? '',
    category: STATUS_CATEGORIES.find((c) => c === category) ?? '',
    assigneeId: get('assignee') ?? '',
  };
}

export function dashboardFiltersToQuery(f: DashboardFilters): Record<string, string | null> {
  const custom = f.period === 'custom';
  return {
    project: f.projectId || null,
    period: f.period === 'all' ? null : f.period,
    from: custom && f.from ? f.from : null,
    to: custom && f.to ? f.to : null,
    category: f.category || null,
    assignee: f.assigneeId || null,
  };
}
