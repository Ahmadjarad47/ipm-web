import { describe, expect, it } from 'vitest';
import { FieldDefinition, WorkItemType } from '@domain/work-items/work-item.models';
import { Status, Workflow } from '@domain/workflow/workflow.models';
import { buildCustomColumns, contextTypes, formatFieldValue } from './custom-columns';
import { BoardCard, filterBoardItems, unionColumns } from './kanban-columns';
import { activeChips, stateFromParams, stateToParams, withoutChip } from './work-item-filters';

const params = (o: Record<string, string>) => (k: string): string | null => o[k] ?? null;

describe('work item filters <-> URL', () => {
  it('reads lists, flags, dates and sort', () => {
    const s = stateFromParams(params({ typeId: 'a,b', hasChildren: 'false', overdue: 'true', dueFrom: '2026-01-01', dueTo: 'bad', sort: 'dueDate:desc', q: 'x', view: 'kanban' }));
    expect(s.filters).toEqual({ typeId: ['a', 'b'], hasChildren: false, overdue: true, dueFrom: '2026-01-01' });
    expect(s.sort).toEqual({ field: 'dueDate', direction: 'desc' });
    expect(s.search).toBe('x');
    expect(s.view).toBe('kanban');
  });

  it('ignores unknown sort fields and false on non tri-state flags', () => {
    const s = stateFromParams(params({ sort: 'evil:asc', overdue: 'false' }));
    expect(s.sort).toBeUndefined();
    expect(s.filters).toEqual({});
  });

  it('round-trips', () => {
    const state = { filters: { projectId: 'p1', assigneeIds: ['u1', 'u2'], unassigned: true, hasDependency: false }, search: 'ab', sort: { field: 'ref' as const, direction: 'asc' as const }, view: 'table' as const };
    const out = stateToParams(state);
    expect(out).toEqual({ projectId: 'p1', assignee: 'u1,u2', unassigned: 'true', hasDependency: 'false', q: 'ab', sort: 'ref:asc' });
    const back = stateFromParams(params(out));
    expect(back.filters).toEqual(state.filters);
    expect(back.search).toBe('ab');
  });

  it('maps a single own assignee to mine', () => {
    expect(stateToParams({ filters: { assigneeIds: ['me'] }, search: '' }, 'me')).toEqual({ mine: 'true' });
    expect(stateFromParams(params({ mine: 'true' }), 'me').filters).toEqual({ assigneeIds: ['me'] });
  });

  it('builds and removes chips', () => {
    const filters = { typeId: ['t1', 't2'], overdue: true };
    const chips = activeChips(filters, (k, v) => `${k}=${v}`);
    expect(chips.map((c) => c.text)).toEqual(['النوع: typeId=t1', 'النوع: typeId=t2', 'متأخر']);
    expect(withoutChip(filters, chips[0])).toEqual({ typeId: ['t2'], overdue: true });
    expect(withoutChip(withoutChip(filters, chips[0]), chips[1])).toEqual({ overdue: true });
  });
});

const field = (key: string, extra: Partial<FieldDefinition> = {}): FieldDefinition => ({ key, label: key, type: 'text', required: false, showInList: true, ...extra });
const type = (id: string, fields: FieldDefinition[]): WorkItemType => ({ id, fields } as unknown as WorkItemType);

describe('custom columns', () => {
  const a = type('a', [field('z', { order: 2 }), field('y', { order: 1 }), field('hidden', { showInList: false })]);
  const b = type('b', [field('y'), field('w')]);

  it('needs a context', () => {
    expect(contextTypes([a, b], [], null)).toEqual([]);
    expect(buildCustomColumns([])).toEqual([]);
  });

  it('uses selected types, else the project types', () => {
    expect(contextTypes([a, b], ['b'], ['a'])).toEqual([b]);
    expect(contextTypes([a, b], [], ['a'])).toEqual([a]);
  });

  it('orders a single type by order and drops hidden fields', () => {
    expect(buildCustomColumns([a]).map((c) => c.def.key)).toEqual(['y', 'z']);
  });

  it('keeps only fields shared by all types', () => {
    expect(buildCustomColumns([a, b]).map((c) => c.def.key)).toEqual(['y']);
    expect(buildCustomColumns([a, type('c', [field('y', { type: 'number' })])])).toEqual([]);
  });

  it('formats by type', () => {
    const name = (id: string): string => `U:${id}`;
    expect(formatFieldValue(field('b', { type: 'boolean' }), true, name)).toBe('نعم');
    expect(formatFieldValue(field('b', { type: 'boolean' }), undefined, name)).toBe('لا');
    expect(formatFieldValue(field('u', { type: 'user' }), 'u1', name)).toBe('U:u1');
    expect(formatFieldValue(field('s', { type: 'select', options: [{ value: 'x', label: 'X' }] }), 'x', name)).toBe('X');
    expect(formatFieldValue(field('d', { type: 'date' }), '2026-03-04T00:00:00Z', name)).toBe('2026-03-04');
    expect(formatFieldValue(field('n', { type: 'number' }), 0, name)).toBe('0');
    expect(formatFieldValue(field('t'), null, name)).toBe('—');
  });
});

describe('kanban columns', () => {
  const st = (id: string, order: number, active = true): Status => ({ id, order, active } as unknown as Status);
  const wf = (id: string, statusIds: string[]): Workflow => ({ id, statusIds } as unknown as Workflow);
  const statuses = new Map([['s1', st('s1', 1)], ['s2', st('s2', 2)], ['s3', st('s3', 3)], ['s4', st('s4', 0, false)]]);
  const workflows = new Map([['w1', wf('w1', ['s1', 's2', 's4'])], ['w2', wf('w2', ['s2', 's3'])]]);

  it('unions statuses once, ordered, active only', () => {
    const cols = unionColumns(['w2', 'w1', 'w1'], (id) => workflows.get(id), (id) => statuses.get(id));
    expect(cols.map((c) => c.id)).toEqual(['s1', 's2', 's3']);
  });

  it('ignores unknown workflows', () => {
    expect(unionColumns(['nope'], (id) => workflows.get(id), (id) => statuses.get(id))).toEqual([]);
  });

  it('filters cards client-side', () => {
    const card = (id: string, o: Partial<BoardCard>): BoardCard => ({ id, ref: id, title: 't' + id, typeId: 'a', statusId: 's1', priority: 'low', assigneeIds: [], dueDate: null, parentId: null, version: 1, workflowId: 'w1', ...o });
    const items = [card('A-1', { assigneeIds: ['u1'] }), card('A-2', { priority: 'high' }), card('A-3', { typeId: 'b' })];
    expect(filterBoardItems(items, { assigneeIds: ['u1'] }, '').map((i) => i.id)).toEqual(['A-1']);
    expect(filterBoardItems(items, { unassigned: true }, '').map((i) => i.id)).toEqual(['A-2', 'A-3']);
    expect(filterBoardItems(items, { typeId: ['b'] }, '').map((i) => i.id)).toEqual(['A-3']);
    expect(filterBoardItems(items, {}, 'a-2').map((i) => i.id)).toEqual(['A-2']);
  });
});
