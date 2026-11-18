import { describe, expect, it } from 'vitest';
import { ageText, bulkHeadline, diffRows, slaState, slaText, summarizeBulk, validateDelegation } from './approval-logic';

const NOW = Date.parse('2026-11-18T12:00:00Z');

describe('approval-logic', () => {
  it('formats age in Arabic', () => {
    expect(ageText('2026-11-18T11:40:00Z', NOW)).toBe('منذ أقل من ساعة');
    expect(ageText('2026-11-15T12:00:00Z', NOW)).toBe('منذ 3 أيام');
    expect(ageText('2026-11-16T12:00:00Z', NOW)).toBe('منذ يومان');
  });

  it('classifies SLA state', () => {
    expect(slaState(null, true, NOW)).toBe('none');
    expect(slaState('2026-11-18T11:00:00Z', false, NOW)).toBe('none');
    expect(slaState('2026-11-18T11:00:00Z', true, NOW)).toBe('overdue');
    expect(slaState('2026-11-18T14:00:00Z', true, NOW)).toBe('soon');
    expect(slaState('2026-11-20T14:00:00Z', true, NOW)).toBe('ok');
    expect(slaText('2026-11-18T08:00:00Z', true, NOW)).toContain('تأخّر');
  });

  it('aggregates bulk results with reasons', () => {
    const s = summarizeBulk([
      { id: 'a', ok: true, message: null },
      { id: 'b', ok: false, message: 'ليست لك صلاحية' },
      { id: 'c', ok: false, message: null },
    ]);
    expect(s.okIds).toEqual(['a']);
    expect(s.failed.map((f) => f.id)).toEqual(['b', 'c']);
    expect(s.failed[0].message).toBe('ليست لك صلاحية');
    expect(s.failed[1].message).not.toBe('');
    expect(bulkHeadline(s)).toContain('1');
    expect(bulkHeadline(summarizeBulk([]))).toBe('لم يُحدَّد أي طلب.');
  });

  it('builds a before/after diff', () => {
    const rows = diffRows({ title: 'قديم', dueDate: '2026-01-01' }, { title: 'جديد', dueDate: '2026-01-01' }, (f) => f);
    expect(rows[0]).toMatchObject({ before: 'قديم', after: 'جديد', changed: true });
    expect(rows[1].changed).toBe(false);
  });

  it('validates delegations', () => {
    const base = { fromUserId: 'u1', toUserId: 'u2', from: '2026-12-01', to: '2026-12-10', reason: 'إجازة' };
    expect(validateDelegation(base)).toEqual({});
    expect(validateDelegation({ ...base, toUserId: 'u1' })['toUserId']).toBeTruthy();
    expect(validateDelegation({ ...base, to: '2026-11-01' })['to']).toBeTruthy();
    expect(validateDelegation({ ...base, to: '2027-06-01' })['to']).toContain('90');
    expect(validateDelegation({ ...base, reason: ' ' })['reason']).toBeTruthy();
  });
});
