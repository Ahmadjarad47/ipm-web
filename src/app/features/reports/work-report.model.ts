import { addDays, monthRange } from '@shared/util/org-date';

export type ReportRange = 'this-month' | 'last-month' | 'last-30' | 'last-90' | 'custom';

export const RANGE_LABELS: Record<ReportRange, string> = {
  'this-month': 'الشهر الحالي',
  'last-month': 'الشهر الماضي',
  'last-30': 'آخر 30 يومًا',
  'last-90': 'آخر 3 أشهر',
  custom: 'فترة أحددها بنفسي',
};

/** The longest period the server accepts in one report. */
export const MAX_REPORT_DAYS = 366;

const DAY_MS = 86_400_000;

/** Concrete ISO bounds of a range relative to today (the organisation-zone date); a custom range is what the user typed. */
export function resolveRange(range: ReportRange, today: string, custom: { from: string; to: string }): { from: string; to: string } {
  switch (range) {
    case 'this-month':
      return { from: monthRange(today).from, to: today };
    case 'last-month': {
      const lastDayBefore = addDays(monthRange(today).from, -1);
      return monthRange(lastDayBefore);
    }
    case 'last-30':
      return { from: addDays(today, -29), to: today };
    case 'last-90':
      return { from: addDays(today, -89), to: today };
    default:
      return custom;
  }
}

/** Why a period cannot be downloaded, or null when it can. */
export function rangeProblem(bounds: { from: string; to: string }): string | null {
  if (!bounds.from || !bounds.to) return 'حدّد تاريخ البداية والنهاية.';
  const days = (Date.parse(`${bounds.to}T00:00:00Z`) - Date.parse(`${bounds.from}T00:00:00Z`)) / DAY_MS;
  if (Number.isNaN(days) || days < 0) return 'تاريخ النهاية قبل البداية.';
  if (days + 1 > MAX_REPORT_DAYS) return `الفترة أطول من ${MAX_REPORT_DAYS} يومًا. قسّمها إلى فترات أقصر.`;
  return null;
}

export function reportFileName(bounds: { from: string; to: string }): string {
  return `تقرير-العمل-${bounds.from}_${bounds.to}.xlsx`;
}
