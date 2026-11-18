import { describe, expect, it } from 'vitest';
import { progressExample, sameIds } from './progress-example';

describe('progress example', () => {
  it('explains «all types» when nothing is selected', () => {
    const e = progressExample([]);
    expect(e.scope).toContain('كل أنواع');
    expect(e.example).toContain('8 ÷ 20 = 40%');
  });

  it('names the selected types', () => {
    expect(progressExample(['مهمة', 'خلل']).scope).toBe('الأنواع المحددة فقط: مهمة، خلل');
  });

  it('compares id lists ignoring order', () => {
    expect(sameIds(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameIds(['a'], ['a', 'b'])).toBe(false);
  });
});
