import { describe, expect, it } from 'vitest';
import { buildOverrideMap, conflictRows, sameOverrides } from './project-workflow-overrides';

describe('workflow override helpers', () => {
  it('keeps only rows with an explicit workflow', () => {
    const map = buildOverrideMap([
      { typeId: 't-bug', workflowId: 'wf-bug' },
      { typeId: 't-task', workflowId: '' },
      { typeId: '', workflowId: 'wf-x' },
    ]);
    expect(map).toEqual({ 't-bug': 'wf-bug' });
  });

  it('returns an empty map (clears overrides) when every row uses the default', () => {
    expect(buildOverrideMap([{ typeId: 't-task', workflowId: '' }])).toEqual({});
  });

  it('compares override maps regardless of order or undefined', () => {
    expect(sameOverrides(undefined, {})).toBe(true);
    expect(sameOverrides({ a: '1', b: '2' }, { b: '2', a: '1' })).toBe(true);
    expect(sameOverrides({ a: '1' }, { a: '2' })).toBe(false);
    expect(sameOverrides({ a: '1' }, {})).toBe(false);
  });

  it('turns 422 details into rows sorted by count', () => {
    const rows = conflictRows({ 'مهمة / قيد المراجعة': '2', 'خطأ / جديد': '5', 'غير رقمي': 'x' });
    expect(rows.map((r) => r.count)).toEqual([5, 2, 1]);
    expect(rows[0].label).toBe('خطأ / جديد');
  });
});
