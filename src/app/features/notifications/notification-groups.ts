import { Notification } from '@domain/activity/activity.models';
import { addDays, orgDateOf } from '@shared/util/org-date';

export type NotificationKind = 'approvals' | 'workItems' | 'projects' | 'other';
export type KindFilter = NotificationKind | 'mention' | 'all';

/** Title the backend gives to @mention notifications (FR-COL-07). */
export const MENTION_LABEL = 'الإشارة إليك';

export const KIND_LABELS: Readonly<Record<KindFilter, string>> = {
  all: 'الكل',
  approvals: 'الموافقات',
  workItems: 'الأعمال',
  projects: 'المشاريع',
  mention: 'منشن',
  other: 'أخرى',
};

/** Kind derived from the link's path prefix. */
export function kindOf(n: Pick<Notification, 'link'>): NotificationKind {
  const link = n.link;
  if (link.startsWith('/approvals')) return 'approvals';
  if (link.startsWith('/work-items')) return 'workItems';
  if (link.startsWith('/projects')) return 'projects';
  return 'other';
}

export function isMention(n: Pick<Notification, 'title'>): boolean {
  return n.title.includes(MENTION_LABEL);
}

export function matchesKind(n: Notification, kind: KindFilter): boolean {
  if (kind === 'all') return true;
  return kind === 'mention' ? isMention(n) : kindOf(n) === kind;
}

export interface DayGroup {
  /** Org-zone calendar date (YYYY-MM-DD). */
  readonly date: string;
  readonly label: string;
  readonly items: readonly Notification[];
}

const dateFmt = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Groups notifications by org-zone day, newest day first, labelled اليوم / أمس / full date. Order inside a day is kept. */
export function groupByDay(items: readonly Notification[], timeZone: string, now: Date = new Date()): readonly DayGroup[] {
  const today = orgDateOf(timeZone, now);
  const yesterday = addDays(today, -1);
  const groups = new Map<string, Notification[]>();
  for (const n of items) {
    const key = orgDateOf(timeZone, n.createdAt);
    const list = groups.get(key);
    if (list) list.push(n);
    else groups.set(key, [n]);
  }
  return [...groups]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, list]) => ({
      date,
      label: date === today ? 'اليوم' : date === yesterday ? 'أمس' : dateFmt.format(new Date(`${date}T00:00:00Z`)),
      items: list,
    }));
}
