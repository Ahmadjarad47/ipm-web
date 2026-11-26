import { describe, expect, it } from 'vitest';
import { FieldDefinition, WorkItemType } from '@domain/work-items/work-item.models';
import { conflictFieldKey, fieldsPayload, isBlank, missingRequiredFields, visibleConflicts } from './type-change-logic';

const def = (key: string, over: Partial<FieldDefinition> = {}): FieldDefinition => ({ key, label: key, type: 'text', required: false, ...over });
const bug = { fields: [def('severity', { type: 'select', required: true, order: 1 }), def('env', { required: true, order: 0 }), def('note')] } as unknown as WorkItemType;

describe('type change: fields the user must fill', () => {
  it('treats null, empty and blank text as no value, but not 0 or false', () => {
    expect([null, undefined, '', '  '].every(isBlank)).toBe(true);
    expect([0, false, 'x'].some(isBlank)).toBe(false);
  });

  it('asks only for required fields the item does not hold, in field order', () => {
    expect(missingRequiredFields(bug, { fields: {} }).map((d) => d.key)).toEqual(['env', 'severity']);
    expect(missingRequiredFields(bug, { fields: { env: 'prod', note: 'x' } }).map((d) => d.key)).toEqual(['severity']);
    expect(missingRequiredFields(bug, { fields: { env: 'prod', severity: 'major' } })).toEqual([]);
  });

  it('counts a blank stored value as missing and a stored 0 or false as present', () => {
    const t = { fields: [def('n', { type: 'number', required: true }), def('b', { type: 'boolean', required: true })] } as unknown as WorkItemType;
    expect(missingRequiredFields(t, { fields: { n: '', b: null } }).map((d) => d.key)).toEqual(['n', 'b']);
    expect(missingRequiredFields(t, { fields: { n: 0, b: false } })).toEqual([]);
  });

  it('has nothing to ask before a type is chosen', () => {
    expect(missingRequiredFields(undefined, { fields: {} })).toEqual([]);
  });
});

describe('type change: values sent with the request', () => {
  const defs = [def('a'), def('n', { type: 'number' }), def('b', { type: 'boolean' })];

  it('drops blanks, trims text and keeps 0 and false', () => {
    expect(fieldsPayload(defs, { a: '  hi ', n: 0, b: false })).toEqual({ a: 'hi', n: 0, b: false });
    expect(fieldsPayload(defs, { a: ' ', n: null })).toBeUndefined();
  });

  it('ignores keys that are not inputs', () => {
    expect(fieldsPayload(defs, { other: 'x', a: 'y' })).toEqual({ a: 'y' });
  });
});

describe('type change: which conflicts are listed', () => {
  const conflicts = [
    { field: 'fields.severity', reason: 'required' },
    { field: 'fields.env', reason: 'bad value' },
    { field: 'parentId', reason: 'parent' },
  ];
  const inputs = [def('severity'), def('env')];

  it('reads the key out of a field path', () => {
    expect(conflictFieldKey(conflicts[0])).toBe('severity');
    expect(conflictFieldKey(conflicts[2])).toBeNull();
  });

  it('hides conflicts of inputs that are still empty (the input itself asks) and keeps the others', () => {
    expect(visibleConflicts(conflicts, inputs, { severity: null, env: null }).map((c) => c.field)).toEqual(['parentId']);
  });

  it('lists a conflict about a value the user did type, such as a wrong format', () => {
    expect(visibleConflicts(conflicts, inputs, { severity: null, env: 'zzz' }).map((c) => c.field)).toEqual(['fields.env', 'parentId']);
  });

  it('never hides conflicts of fields that are not inputs (e.g. values that would be dropped)', () => {
    const dropped = [{ field: 'fields.estimate_hours', reason: 'lost' }];
    expect(visibleConflicts(dropped, inputs, {})).toEqual(dropped);
  });
});
