import { describe, expect, it } from 'vitest';
import { fieldLabel, formatChangeValue, idKindOf, subjectLink } from './audit-format';

describe('audit-format', () => {
  const resolve = (kind: string, id: string): string | undefined => (kind === 'user' && id === 'u1' ? 'سارة' : undefined);

  it('translates known fields and keeps unknown ones', () => {
    expect(fieldLabel('dueDate')).toBe('تاريخ الاستحقاق');
    expect(fieldLabel('custom_x')).toBe('custom_x');
  });

  it('resolves ids to names, lists included, and falls back to the raw id', () => {
    expect(formatChangeValue('assigneeIds', 'u1,u9', resolve)).toBe('سارة، u9');
    expect(formatChangeValue('title', 'u1', resolve)).toBe('u1');
    expect(formatChangeValue('title', null, resolve)).toBe('—');
    expect(formatChangeValue('archived', 'true', resolve)).toBe('نعم');
  });

  it('infers id kinds and subject links', () => {
    expect(idKindOf('statusId')).toBe('status');
    expect(idKindOf('title')).toBeNull();
    expect(subjectLink('workItem', 'w1')).toBe('/work-items/w1');
    expect(subjectLink('role', 'r1')).toBeNull();
  });
});
