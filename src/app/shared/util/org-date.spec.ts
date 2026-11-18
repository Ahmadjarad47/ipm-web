import { describe, expect, it } from 'vitest';
import { addDays, isPastDue, monthRange, orgDateOf, orgToday } from './org-date';

describe('org-date', () => {
  it('uses the org zone, not UTC, to decide today', () => {
    const at = new Date('2026-03-10T22:30:00Z');
    expect(orgToday('UTC', at)).toBe('2026-03-10');
    expect(orgToday('Asia/Riyadh', at)).toBe('2026-03-11'); // UTC+3
    expect(orgToday('America/Los_Angeles', at)).toBe('2026-03-10');
  });

  it('handles the DST switch (US spring forward 2026-03-08)', () => {
    // 07:30Z is 23:30 PST the day before; 08:30Z is 00:30 PST/01:30 PDT still 3-8 in LA.
    expect(orgDateOf('America/Los_Angeles', '2026-03-08T07:30:00Z')).toBe('2026-03-07');
    expect(orgDateOf('America/Los_Angeles', '2026-03-08T08:30:00Z')).toBe('2026-03-08');
    // 06:59Z on the 9th is 23:59 PDT (UTC-7) on the 8th; 07:00Z is the 9th.
    expect(orgDateOf('America/Los_Angeles', '2026-03-09T06:59:00Z')).toBe('2026-03-08');
    expect(orgDateOf('America/Los_Angeles', '2026-03-09T07:00:00Z')).toBe('2026-03-09');
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('computes month ranges incl. leap February', () => {
    expect(monthRange('2028-02-10')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange('2026-11-18')).toEqual({ from: '2026-11-01', to: '2026-11-30' });
  });

  it('flags overdue by org date', () => {
    const now = new Date('2026-03-10T22:30:00Z');
    expect(isPastDue('2026-03-10', 'Asia/Riyadh', now)).toBe(true);
    expect(isPastDue('2026-03-10', 'UTC', now)).toBe(false);
    expect(isPastDue(null, 'UTC', now)).toBe(false);
  });
});
