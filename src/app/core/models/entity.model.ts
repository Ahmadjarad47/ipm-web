/** Every persisted record shares this shape. `version` drives optimistic concurrency (FR-REL-13). */
export interface Entity {
  readonly id: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Server-managed keys a client never sends when creating a record. */
export type EntityKeys = keyof Entity;

/** Default create payload for any entity: everything except the server-managed keys. */
export type CreateDto<T extends Entity> = Omit<T, EntityKeys>;

/** Default update payload: a partial create payload plus the version the client last saw. */
export type UpdateDto<T extends Entity> = Partial<CreateDto<T>> & { readonly version: number };

export type SortDirection = 'asc' | 'desc';

export interface Sort<T> {
  readonly field: keyof T & string;
  readonly direction: SortDirection;
}

/** Filter values a list endpoint understands; arrays mean "any of". */
export type FilterValue = string | number | boolean | null | readonly (string | number)[];

export type Filters<T> = Partial<Record<keyof T & string, FilterValue>>;

export interface ListQuery<T> {
  readonly page: number;
  readonly pageSize: number;
  readonly search?: string;
  readonly sort?: Sort<T>;
  readonly filters?: Filters<T>;
}

export interface PagedResult<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export const DEFAULT_PAGE_SIZE = 10;

export function emptyPage<T>(pageSize = DEFAULT_PAGE_SIZE): PagedResult<T> {
  return { items: [], total: 0, page: 1, pageSize };
}
