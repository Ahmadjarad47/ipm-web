import { describe, expect, it } from 'vitest';
import { Entity } from '@core/models/entity.model';
import { InMemoryCollection, MockHttpError } from './collection';

interface Row extends Entity {
  readonly name: string;
  readonly tags: readonly string[];
  readonly score: number;
}

const row = (id: string, name: string, score: number, tags: string[] = []): Row => ({
  id, name, score, tags, version: 1, createdAt: '', updatedAt: '',
});

describe('InMemoryCollection<T>', () => {
  const make = () =>
    new InMemoryCollection<Row>('r', ['name'], [row('1', 'ألف', 3, ['a']), row('2', 'باء', 1, ['b']), row('3', 'جيم', 2, ['a', 'b'])]);

  it('searches, filters ("any of", arrays intersect), sorts and pages', () => {
    const c = make();
    expect(c.query({ page: 1, pageSize: 10, search: 'باء', filters: {} }).items.map((r) => r.id)).toEqual(['2']);
    expect(c.query({ page: 1, pageSize: 10, filters: { tags: ['a'] } }).total).toBe(2);
    const sorted = c.query({ page: 1, pageSize: 2, sort: { field: 'score', direction: 'desc' }, filters: {} });
    expect(sorted.items.map((r) => r.id)).toEqual(['1', '3']);
    expect(sorted.total).toBe(3);
  });

  it('bumps version on patch and rejects a stale version with 409', () => {
    const c = make();
    const next = c.patch('1', { name: 'جديد' }, 1);
    expect(next.version).toBe(2);
    expect(() => c.patch('1', { name: 'قديم' }, 1)).toThrowError(MockHttpError);
  });

  it('never lets a patch overwrite server-managed keys', () => {
    const c = make();
    const next = c.patch('2', { id: 'hack', version: 99 } as Partial<Row>);
    expect(next.id).toBe('2');
    expect(next.version).toBe(2);
  });
});
