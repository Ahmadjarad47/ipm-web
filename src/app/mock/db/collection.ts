import { Entity, PagedResult } from '@core/models/entity.model';

export class MockHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly details?: Record<string, string>,
    /** Machine-readable reason carried in the response body (e.g. `session_expired`). */
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface CollectionQuery {
  readonly page: number;
  readonly pageSize: number;
  readonly search?: string;
  readonly sort?: { field: string; direction: 'asc' | 'desc' };
  readonly filters: Readonly<Record<string, readonly string[]>>;
}

type Row = Record<string, unknown>;

/**
 * Generic in-memory table with the same semantics the real API promises:
 * paging, search, sort, "any of" filters and optimistic concurrency on `version`.
 */
export class InMemoryCollection<T extends Entity> {
  private readonly rows = new Map<string, T>();
  private seq = 0;

  constructor(
    private readonly prefix: string,
    private readonly searchable: readonly (keyof T & string)[] = [],
    seed: readonly T[] = [],
    /** With requireVersion, patch() without an expected version is rejected (428) instead of last-write-wins. */
    private readonly options: { readonly requireVersion?: boolean } = {},
  ) {
    for (const row of seed) this.rows.set(row.id, row);
    this.seq = seed.length;
  }

  all(): T[] {
    return [...this.rows.values()];
  }

  find(id: string): T | undefined {
    return this.rows.get(id);
  }

  get(id: string): T {
    const row = this.rows.get(id);
    if (!row) throw new MockHttpError(404, 'العنصر غير موجود أو لا تملك صلاحية الاطلاع عليه.');
    return row;
  }

  where(predicate: (row: T) => boolean): T[] {
    return this.all().filter(predicate);
  }

  /**
   * Creates a row. `id`, `version`, `createdAt` and `updatedAt` are server-managed: whatever a client
   * sends for them is discarded, so a request body can never choose an id and overwrite another record.
   * Only trusted server code (seeding, fixtures) may pin an id, via `options.id`, and even then it can
   * never replace an existing row.
   */
  insert(data: Omit<T, keyof Entity> & { id?: string }, options: { readonly id?: string } = {}): T {
    const { id: _clientId, version: _v, createdAt: _c, updatedAt: _u, ...fields } = data as Row;
    const id = options.id ?? `${this.prefix}-${++this.seq}-${Math.random().toString(36).slice(2, 8)}`;
    if (this.rows.has(id)) throw new MockHttpError(409, 'المعرّف مستخدم مسبقًا.');
    const now = new Date().toISOString();
    const row = { ...fields, id, version: 1, createdAt: now, updatedAt: now } as unknown as T;
    this.rows.set(id, row);
    return row;
  }

  /** Applies `changes` if `expectedVersion` matches the stored one, else 409 (FR-REL-13). */
  patch(id: string, changes: Partial<T>, expectedVersion?: number): T {
    const current = this.get(id);
    if (expectedVersion === undefined && this.options.requireVersion) throw new MockHttpError(428, 'أرسل رقم الإصدار للتحديث الآمن.');
    if (expectedVersion !== undefined && expectedVersion !== current.version) {
      throw new MockHttpError(409, 'عدّل مستخدم آخر هذا السجل. أعد التحميل ثم حاول مجددًا.');
    }
    const { id: _id, version: _v, createdAt: _c, ...safe } = changes as Row;
    const next = {
      ...current,
      ...safe,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
    } as T;
    this.rows.set(id, next);
    return next;
  }

  delete(id: string): void {
    this.rows.delete(id);
  }

  query(query: CollectionQuery, scope: (row: T) => boolean = () => true): PagedResult<T> {
    let rows = this.all().filter(scope);

    const term = query.search?.toLowerCase();
    if (term) {
      rows = rows.filter((row) =>
        this.searchable.some((field) => String((row as Row)[field] ?? '').toLowerCase().includes(term)),
      );
    }

    for (const [field, accepted] of Object.entries(query.filters)) {
      rows = rows.filter((row) => matches((row as Row)[field], accepted));
    }

    if (query.sort) {
      const { field, direction } = query.sort;
      const factor = direction === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => compare((a as Row)[field], (b as Row)[field]) * factor);
    }

    const start = (query.page - 1) * query.pageSize;
    return { items: rows.slice(start, start + query.pageSize), total: rows.length, page: query.page, pageSize: query.pageSize };
  }
}

function matches(value: unknown, accepted: readonly string[]): boolean {
  if (Array.isArray(value)) return value.some((v) => accepted.includes(String(v)));
  if (value === null || value === undefined) return accepted.includes('null');
  return accepted.includes(String(value));
}

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), 'ar');
}
