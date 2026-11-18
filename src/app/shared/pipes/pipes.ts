import { inject, Pipe, PipeTransform } from '@angular/core';
import { SettingsStore } from '@domain/settings/settings.api';
import { UserLookup } from '@domain/users/user.api';

const LOCALE = 'ar-SA-u-ca-gregory-nu-latn';
const relFmt = new Intl.RelativeTimeFormat('ar', { numeric: 'auto' });
const formatters = new Map<string, Intl.DateTimeFormat>();

/** One `Intl.DateTimeFormat` per (zone, shape), created lazily and cached. */
function formatterFor(timeZone: string, withTime: boolean): Intl.DateTimeFormat {
  const key = `${timeZone}|${withTime}`;
  let fmt = formatters.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(LOCALE, withTime
      ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone }
      : { day: 'numeric', month: 'short', year: 'numeric', timeZone });
    formatters.set(key, fmt);
  }
  return fmt;
}

/**
 * Dates are stored in UTC and shown in the organisation time zone from the settings (NFR-10).
 * A bare calendar date (YYYY-MM-DD) has no time of day, so it is never shifted by the zone.
 * Impure so a change of the org time zone re-renders existing cells.
 */
@Pipe({ name: 'appDate', pure: false })
export class AppDatePipe implements PipeTransform {
  private readonly settings = inject(SettingsStore);

  transform(value: string | null | undefined, withTime = false): string {
    if (!value) return '—';
    const dateOnly = value.length === 10;
    const d = new Date(dateOnly ? `${value}T00:00:00Z` : value);
    if (Number.isNaN(d.getTime())) return '—';
    return formatterFor(dateOnly ? 'UTC' : this.settings.value().timeZone, withTime && !dateOnly).format(d);
  }
}

@Pipe({ name: 'relativeTime' })
export class RelativeTimePipe implements PipeTransform {
  private readonly settings = inject(SettingsStore);

  transform(value: string | null | undefined): string {
    if (!value) return '—';
    const diffSec = (new Date(value).getTime() - Date.now()) / 1000;
    const abs = Math.abs(diffSec);
    if (abs < 60) return 'الآن';
    if (abs < 3600) return relFmt.format(Math.round(diffSec / 60), 'minute');
    if (abs < 86400) return relFmt.format(Math.round(diffSec / 3600), 'hour');
    if (abs < 86400 * 30) return relFmt.format(Math.round(diffSec / 86400), 'day');
    return formatterFor(this.settings.value().timeZone, false).format(new Date(value));
  }
}

/** `userId | userName` → display name from the cached user lookup. */
// Impure on purpose: the user lookup loads asynchronously, and a pure pipe would keep showing
// "—" for rows rendered before it arrived. Both pipes are O(1) map reads, and `userNames`
// memoises its array so OnPush children only see a new reference when names actually change.
@Pipe({ name: 'userName', pure: false })
export class UserNamePipe implements PipeTransform {
  private readonly users = inject(UserLookup);
  transform(id: string | null | undefined): string {
    return this.users.nameOf(id);
  }
}

/** `ids | userNames` → names array (for avatar stacks). */
@Pipe({ name: 'userNames', pure: false })
export class UserNamesPipe implements PipeTransform {
  private readonly users = inject(UserLookup);
  private last: string[] = [];

  transform(ids: readonly string[] | null | undefined): string[] {
    const next = (ids ?? []).map((id) => this.users.nameOf(id));
    const same = next.length === this.last.length && next.every((n, i) => n === this.last[i]);
    if (!same) this.last = next;
    return this.last;
  }
}
