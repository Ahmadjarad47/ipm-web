import { describe, expect, it } from 'vitest';
import { diffValues, prettyValue, truncateMiddle } from './audit-diff';

describe('audit diff', () => {
  it('marks identical text as same', () => {
    expect(diffValues('a', 'a')).toEqual([{ kind: 'same', left: 'a', right: 'a' }]);
  });

  it('pairs a replaced line as changed and keeps context', () => {
    const rows = diffValues('one\ntwo\nthree', 'one\n2\nthree');
    expect(rows.map((r) => r.kind)).toEqual(['same', 'changed', 'same']);
    expect(rows[1]).toMatchObject({ left: 'two', right: '2' });
  });

  it('shows pure additions and removals', () => {
    expect(diffValues(null, 'x')).toEqual([{ kind: 'added', left: null, right: 'x' }]);
    expect(diffValues('x', null)).toEqual([{ kind: 'removed', left: 'x', right: null }]);
    expect(diffValues(null, null)).toEqual([]);
  });

  it('pretty-prints JSON so nested changes are visible per line', () => {
    expect(prettyValue('{"a":1}')).toBe('{\n  "a": 1\n}');
    expect(prettyValue('{broken')).toBe('{broken');
    const rows = diffValues('{"a":1,"b":2}', '{"a":1,"b":3}');
    expect(rows.filter((r) => r.kind === 'changed')).toHaveLength(1);
  });

  it('truncates long hashes only', () => {
    expect(truncateMiddle('abc')).toBe('abc');
    expect(truncateMiddle('a'.repeat(64))).toBe('aaaaaaaaaa…aaaaaa');
  });
});
