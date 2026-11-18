/** Organisation time-zone helpers (NFR-10): "today" and overdue are decided in the org zone, never the server's. */

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

/** True when the runtime knows `timeZone` (IANA name). */
export function isValidTimeZone(timeZone: unknown): timeZone is string {
  if (typeof timeZone !== 'string' || !timeZone.trim()) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone });
    return true;
  } catch {
    return false;
  }
}

function formatter(zone: string): Intl.DateTimeFormat {
  const timeZone = isValidTimeZone(zone) ? zone : 'UTC'; // a corrupt stored value must never turn into a 500
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

function zoneParts(timeZone: string, at: Date): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const get: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(at)) if (p.type !== 'literal') get[p.type] = Number(p.value);
  return { y: get['year'], mo: get['month'], d: get['day'], h: get['hour'], mi: get['minute'], s: get['second'] };
}

/** Today's calendar date (YYYY-MM-DD) in the organisation time zone. */
export function orgToday(timeZone: string, now: Date = new Date()): string {
  const { y, mo, d } = zoneParts(timeZone, now);
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** The UTC instant at which calendar `date` (YYYY-MM-DD) starts in the organisation time zone. */
export function orgDayStartUtc(timeZone: string, date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let start = guess;
  // Two passes settle DST shifts: offset = zone wall clock (read as UTC) minus the real instant.
  for (let i = 0; i < 2; i++) {
    const p = zoneParts(timeZone, new Date(start));
    const wall = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    start = guess - (wall - start);
  }
  return new Date(start);
}

/** True when a due date (YYYY-MM-DD) lies before today in the organisation time zone (§6.3). */
export function isPastDue(dueDate: string | null | undefined, timeZone: string, now: Date = new Date()): boolean {
  return !!dueDate && dueDate < orgToday(timeZone, now);
}
