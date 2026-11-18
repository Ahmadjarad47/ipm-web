import { describe, expect, it } from 'vitest';
import { activeChips, EMPTY_AUDIT_FILTERS } from './audit-filters';

describe('audit filter chips', () => {
  it('lists only active filters', () => {
    expect(activeChips(EMPTY_AUDIT_FILTERS, (_k, v) => v)).toEqual([]);
    const chips = activeChips({ ...EMPTY_AUDIT_FILTERS, search: 'x', security: true, correlationId: 'c1' }, (_k, v) => v.toUpperCase());
    expect(chips.map((c) => c.key)).toEqual(['search', 'correlationId', 'security']);
    expect(chips[0].label).toBe('بحث: X');
    expect(chips[2].label).toBe('أحداث أمنية: نعم');
  });
});
