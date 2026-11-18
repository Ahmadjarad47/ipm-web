import { describe, expect, it } from 'vitest';
import { Notification } from '@domain/activity/activity.models';
import { groupByDay, isMention, kindOf, matchesKind } from './notification-groups';

const n = (id: string, createdAt: string, link = '/x', title = 't'): Notification =>
  ({ id, createdAt, link, title, body: '', read: false, userId: 'u', updatedAt: createdAt, version: 1 }) as Notification;

describe('notification groups', () => {
  it('derives kind from the link prefix and detects mentions', () => {
    expect(kindOf(n('1', '', '/approvals/a1'))).toBe('approvals');
    expect(kindOf(n('1', '', '/work-items/w1'))).toBe('workItems');
    expect(kindOf(n('1', '', '/projects/p1'))).toBe('projects');
    expect(kindOf(n('1', '', '/profile'))).toBe('other');
    const m = n('2', '', '/work-items/w', 'تمت الإشارة إليك في تعليق');
    expect(isMention(m)).toBe(true);
    expect(matchesKind(m, 'mention')).toBe(true);
    expect(matchesKind(m, 'approvals')).toBe(false);
    expect(matchesKind(m, 'all')).toBe(true);
  });

  it('groups by org-zone day with today / yesterday labels', () => {
    const now = new Date('2026-03-10T21:30:00Z'); // 2026-03-11 00:30 in Riyadh
    const groups = groupByDay(
      [n('a', '2026-03-10T21:10:00Z'), n('b', '2026-03-10T10:00:00Z'), n('c', '2026-03-09T12:00:00Z'), n('d', '2026-03-01T12:00:00Z')],
      'Asia/Riyadh',
      now,
    );
    expect(groups.map((g) => g.date)).toEqual(['2026-03-11', '2026-03-10', '2026-03-09', '2026-03-01']);
    expect(groups.slice(0, 3).map((g) => g.label.length > 0 && g.label)).toEqual(['اليوم', 'أمس', groups[2].label]);
    expect(groups[0].items.map((i) => i.id)).toEqual(['a']);
    expect(groups[1].items.map((i) => i.id)).toEqual(['b']);
  });
});
