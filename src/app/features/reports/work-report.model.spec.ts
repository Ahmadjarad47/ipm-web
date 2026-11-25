import { describe, expect, it } from 'vitest';
import { MAX_REPORT_DAYS, rangeProblem, reportFileName, resolveRange } from './work-report.model';

const none = { from: '', to: '' };

describe('work report periods', () => {
  it('this month runs from the first of the month to today', () => {
    expect(resolveRange('this-month', '2026-11-24', none)).toEqual({ from: '2026-11-01', to: '2026-11-24' });
  });

  it('last month is the whole previous month, also across a year and in a short February', () => {
    expect(resolveRange('last-month', '2026-11-24', none)).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(resolveRange('last-month', '2026-01-05', none)).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(resolveRange('last-month', '2026-03-31', none)).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('the last 30 and 90 days include today', () => {
    expect(resolveRange('last-30', '2026-11-24', none)).toEqual({ from: '2026-10-26', to: '2026-11-24' });
    expect(resolveRange('last-90', '2026-11-24', none)).toEqual({ from: '2026-08-27', to: '2026-11-24' });
  });

  it('a custom range is exactly what was typed', () => {
    expect(resolveRange('custom', '2026-11-24', { from: '2026-01-10', to: '2026-02-03' })).toEqual({ from: '2026-01-10', to: '2026-02-03' });
  });

  it('refuses a missing, reversed or too long period and accepts a day or a full year', () => {
    expect(rangeProblem({ from: '', to: '2026-01-01' })).toMatch(/حدّد/);
    expect(rangeProblem({ from: '2026-02-01', to: '2026-01-01' })).toMatch(/قبل البداية/);
    expect(rangeProblem({ from: '2025-01-01', to: '2026-12-31' })).toMatch(String(MAX_REPORT_DAYS));
    expect(rangeProblem({ from: '2026-05-05', to: '2026-05-05' })).toBeNull();
    expect(rangeProblem({ from: '2026-01-01', to: '2026-12-31' })).toBeNull();
  });

  it('names the file after its period', () => {
    expect(reportFileName({ from: '2026-10-01', to: '2026-10-31' })).toBe('تقرير-العمل-2026-10-01_2026-10-31.xlsx');
  });
});
