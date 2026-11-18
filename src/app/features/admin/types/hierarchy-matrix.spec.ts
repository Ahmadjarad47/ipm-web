import { describe, expect, it } from 'vitest';
import { diffSets, pairKey, pairsToSet, sameSet, setToPairs, toggleCell } from './hierarchy-matrix';
import { allowedPairsError, buildAllowedPairs, isAnyType, mirror, pairsToAllowedSet, toggleAllowed } from './allowed-pairs';
import { duplicateKeyIndexes, mapTypeErrors, sortFieldsByOrder } from './type-form.models';

describe('hierarchy matrix <-> pairs', () => {
  const order = ['epic', 'feature', 'task'];

  it('round-trips pairs through the set in matrix order', () => {
    const pairs = [
      { parentTypeId: 'feature', childTypeId: 'task' },
      { parentTypeId: 'epic', childTypeId: 'feature' },
    ];
    expect(setToPairs(order, pairsToSet(pairs))).toEqual([
      { parentTypeId: 'epic', childTypeId: 'feature' },
      { parentTypeId: 'feature', childTypeId: 'task' },
    ]);
  });

  it('toggles cells immutably and drops unknown types when serialising', () => {
    const base = pairsToSet([{ parentTypeId: 'epic', childTypeId: 'feature' }]);
    const next = toggleCell(base, 'feature', 'task', true);
    expect(base.has(pairKey('feature', 'task'))).toBe(false);
    expect(next.has(pairKey('feature', 'task'))).toBe(true);
    expect(setToPairs(['epic', 'feature'], next)).toEqual([{ parentTypeId: 'epic', childTypeId: 'feature' }]);
    expect(toggleCell(next, 'feature', 'task', false).has(pairKey('feature', 'task'))).toBe(false);
  });

  it('detects dirty state and counts additions and removals', () => {
    const saved = pairsToSet([{ parentTypeId: 'a', childTypeId: 'b' }, { parentTypeId: 'a', childTypeId: 'c' }]);
    const draft = toggleCell(toggleCell(saved, 'a', 'c', false), 'b', 'c', true);
    expect(sameSet(saved, saved)).toBe(true);
    expect(sameSet(saved, draft)).toBe(false);
    expect(diffSets(saved, draft)).toEqual({ added: 1, removed: 1 });
  });
});

describe('relation allowed pairs builder', () => {
  const order = ['epic', 'feature', 'task'];

  it('treats empty pairs as any type and serialises «any» as an empty list', () => {
    expect(isAnyType(undefined)).toBe(true);
    expect(isAnyType([])).toBe(true);
    expect(buildAllowedPairs(order, true, pairsToAllowedSet([{ sourceTypeId: 'epic', targetTypeId: 'task' }]))).toEqual([]);
  });

  it('keeps symmetric relations mirrored and emits pairs in matrix order', () => {
    const set = toggleAllowed(new Set(), 'task', 'epic', true, true);
    expect(buildAllowedPairs(order, false, set)).toEqual([
      { sourceTypeId: 'epic', targetTypeId: 'task' },
      { sourceTypeId: 'task', targetTypeId: 'epic' },
    ]);
    expect(toggleAllowed(set, 'epic', 'task', false, true).size).toBe(0);
    expect(buildAllowedPairs(order, false, mirror(pairsToAllowedSet([{ sourceTypeId: 'epic', targetTypeId: 'feature' }]))).length).toBe(2);
  });

  it('rejects «specific types» with nothing selected', () => {
    expect(allowedPairsError(false, new Set())).not.toBeNull();
    expect(allowedPairsError(true, new Set())).toBeNull();
    expect(allowedPairsError(false, new Set(['a>b']))).toBeNull();
  });
});

describe('type form helpers', () => {
  it('maps server details onto field rows and controls', () => {
    const mapped = mapTypeErrors({ name: 'الاسم مطلوب', 'fields[2].key': 'مكرر', 'fields[2].options': 'خيار', 'fields[0].max': 'خطأ', other: 'عام' });
    expect(mapped.top['name']).toBe('الاسم مطلوب');
    expect(mapped.byField.get(2)).toEqual({ key: 'مكرر', options: 'خيار' });
    expect(mapped.byField.get(0)).toEqual({ max: 'خطأ' });
    expect(mapped.general).toEqual(['عام']);
  });

  it('orders fields by `order` and finds duplicate keys', () => {
    const f = (key: string, order?: number) => ({ key, label: key, type: 'text' as const, required: false, ...(order === undefined ? {} : { order }) });
    expect(sortFieldsByOrder([f('b', 1), f('a', 0), f('c')]).map((x) => x.key)).toEqual(['a', 'b', 'c']);
    expect([...duplicateKeyIndexes(['a', 'b', 'a', '', ''])]).toEqual([2]);
  });
});
