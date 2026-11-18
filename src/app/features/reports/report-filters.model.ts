import { STATUS_CATEGORIES, StatusCategory } from '@domain/workflow/workflow.models';
import { monthRange, orgToday } from '@shared/util/org-date';

export type ReportPeriod = 'all' | 'month' | 'next3' | 'custom';

export const PERIOD_LABELS: Record<ReportPeriod, string> = {
  all: 'كل الفترات',
  month: 'هذا الشهر',
  next3: 'الأشهر الثلاثة القادمة',
  custom: 'فترة مخصصة',
};

export interface ReportFilters {
  readonly projectId: string;
  readonly period: ReportPeriod;
  /** ISO dates (YYYY-MM-DD), used when `period === 'custom'`. */
  readonly from: string;
  readonly to: string;
  readonly category: StatusCategory | '';
  readonly assigneeId: string;
}

export const DEFAULT_FILTERS: ReportFilters = { projectId: '', period: 'all', from: '', to: '', category: '', assigneeId: '' };

const DAY_MS = 86_400_000;

/** Today's date in the ORGANISATION time zone (NFR-10), not the browser's. */
export function todayIso(timeZone: string): string {
  return orgToday(timeZone);
}

/** Whole days since the epoch for an ISO date or datetime (UTC). */
export function dayNumber(iso: string): number {
  return Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / DAY_MS);
}

export function isoFromDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** First day of the month N months after the one containing the date. */
function plusMonths(date: string, months: number): string {
  const [y, m] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 10);
}

/** Resolves the period to concrete ISO bounds relative to today (org-zone date); undefined means unbounded. */
export function resolvePeriod(filters: ReportFilters, today: string): { from?: string; to?: string } {
  switch (filters.period) {
    case 'month':
      return monthRange(today);
    case 'next3':
      return { from: monthRange(today).from, to: monthRange(plusMonths(today, 2)).to };
    case 'custom':
      return { from: filters.from || undefined, to: filters.to || undefined };
    default:
      return {};
  }
}

export function filtersFromQuery(get: (key: string) => string | null): ReportFilters {
  const period = get('period');
  const category = get('category');
  return {
    projectId: get('project') ?? '',
    period: period === 'month' || period === 'next3' || period === 'custom' ? period : 'all',
    from: get('from') ?? '',
    to: get('to') ?? '',
    category: STATUS_CATEGORIES.find((c) => c === category) ?? '',
    assigneeId: get('assignee') ?? '',
  };
}

export function filtersToQuery(f: ReportFilters): Record<string, string | null> {
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

export function isClosedCategory(category: StatusCategory | undefined): boolean {
  return category === 'Done' || category === 'Cancelled';
}

/** Neutralises spreadsheet formulas (CSV injection) and quotes cells that need it. */
export function csvCell(value: string | number): string {
  if (typeof value === 'number') return String(value);
  const safe = /^[\s=+\-@]/.test(value) ? "'" + value : value;
  return /[",\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}

export function downloadCsv(rows: readonly (readonly (string | number)[])[], filename: string): void {
  const text = '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
