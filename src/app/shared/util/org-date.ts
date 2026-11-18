/** Organisation time-zone helpers (NFR-10): "today" and overdue are decided in the org zone, never the browser's. */

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Wall-clock parts of an instant in a time zone. */
export function zoneParts(timeZone: string, at: Date): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const get: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(at)) if (p.type !== 'literal') get[p.type] = Number(p.value);
  return { y: get['year'], mo: get['month'], d: get['day'], h: get['hour'], mi: get['minute'], s: get['second'] };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Calendar date (YYYY-MM-DD) of an instant in the organisation time zone. */
export function orgDateOf(timeZone: string, at: Date | string): string {
  const { y, mo, d } = zoneParts(timeZone, typeof at === 'string' ? new Date(at) : at);
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** Today's calendar date (YYYY-MM-DD) in the organisation time zone. */
export function orgToday(timeZone: string, now: Date = new Date()): string {
  return orgDateOf(timeZone, now);
}

/** Adds whole calendar days to a YYYY-MM-DD date (zone independent). */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** First and last day of the month containing `date`. */
export function monthRange(date: string): { from: string; to: string } {
  const [y, m] = date.split('-').map(Number);
  return { from: `${y}-${pad(m)}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) };
}

/** True when a due date (YYYY-MM-DD or ISO) lies before today in the organisation time zone. */
export function isPastDue(dueDate: string | null | undefined, timeZone: string, now: Date = new Date()): boolean {
  return !!dueDate && dueDate.slice(0, 10) < orgToday(timeZone, now);
}
