import { TemplateRef } from '@angular/core';

/** Context passed to a custom cell template: `<ng-template #x let-row let-value="value">`. */
export interface CellContext<T> {
  readonly $implicit: T;
  readonly value: unknown;
  readonly index: number;
}

/**
 * Column definition for `<app-data-table>`. Fully typed against the row:
 * `key` must be a real property of T unless the column only renders a template.
 */
export interface ColumnDef<T> {
  /** Unique column id; also the sort field when `sortable`. */
  readonly key: (keyof T & string) | `_${string}`;
  readonly header: string;
  /** Plain-text formatter. Ignored when `template` is set. */
  readonly format?: (row: T) => string;
  readonly template?: TemplateRef<CellContext<T>>;
  readonly sortable?: boolean;
  readonly width?: string;
  readonly align?: 'start' | 'center' | 'end';
  /** Hide below 640px (stacked mode). */
  readonly hideOnMobile?: boolean;
  /** Hidden by default; the user can turn it on in the column chooser. */
  readonly hidden?: boolean;
  /** Always visible; not listed in the column chooser. */
  readonly required?: boolean;
  /** Screen-reader-only header for columns with an empty `header` (e.g. a checkbox column). */
  readonly srHeader?: string;
  /** Label shown next to the value in the stacked-cards layout (defaults to `header`). */
  readonly mobileLabel?: string;
}

export type TableDensity = 'compact' | 'comfortable';

/** Per-table preferences persisted in localStorage under `ipm.table.<tableId>`. */
export interface TablePrefs {
  /** column key → visible. Missing keys fall back to `!ColumnDef.hidden`. */
  readonly columns: Readonly<Record<string, boolean>>;
  readonly density: TableDensity;
  readonly pageSize: number | null;
}

export const PAGE_SIZE_OPTIONS: readonly number[] = [10, 20, 50, 100];

export const DEFAULT_TABLE_PREFS: TablePrefs = { columns: {}, density: 'comfortable', pageSize: null };

const prefix = 'ipm.table.';

export function loadTablePrefs(tableId: string | null | undefined, defaultDensity: TableDensity = 'comfortable'): TablePrefs {
  const base: TablePrefs = { ...DEFAULT_TABLE_PREFS, density: defaultDensity };
  if (!tableId) return base;
  try {
    const raw = localStorage.getItem(prefix + tableId);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<TablePrefs>;
    return {
      columns: p.columns && typeof p.columns === 'object' ? p.columns : {},
      density: p.density === 'compact' || p.density === 'comfortable' ? p.density : defaultDensity,
      pageSize: typeof p.pageSize === 'number' && PAGE_SIZE_OPTIONS.includes(p.pageSize) ? p.pageSize : null,
    };
  } catch {
    return base;
  }
}

export function saveTablePrefs(tableId: string | null | undefined, prefs: TablePrefs): void {
  if (!tableId) return;
  try {
    localStorage.setItem(prefix + tableId, JSON.stringify(prefs));
  } catch {
    /* storage unavailable or full — preferences just don't persist */
  }
}
