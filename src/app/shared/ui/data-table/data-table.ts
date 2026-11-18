import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, linkedSignal, output, signal } from '@angular/core';
import { Sort } from '@core/models/entity.model';
import { PreferencesStore } from '@core/preferences/preferences.store';
import { EmptyState } from '../empty-state/empty-state';
import { Icon } from '../icon/icon';
import { Paginator } from '../paginator/paginator';
import { CellContext, ColumnDef, loadTablePrefs, saveTablePrefs, TableDensity, TablePrefs } from './data-table.models';

/**
 * Generic, typed data table: columns, sorting, paging, loading and empty states.
 *
 *   <app-data-table tableId="work-items" [rows]="store.items()" [columns]="columns" [total]="store.total()"
 *     [page]="store.query().page" [pageSize]="store.query().pageSize" [sort]="store.query().sort"
 *     (sortChange)="store.setSort($event)" (pageChange)="store.setPage($event)"
 *     (pageSizeChange)="store.setPageSize($event)" (rowClick)="open($event)">
 *     <button toolbar class="btn btn--sm">extra tool</button>
 *   </app-data-table>
 *
 * It is stateless about data: the parent (usually an `EntityListStore`) owns paging and sort.
 * With `tableId` it also remembers the visible columns, density and page size per browser
 * (read the saved page size with `loadTablePrefs(id).pageSize`).
 */
@Component({
  selector: 'app-data-table',
  imports: [NgTemplateOutlet, Paginator, EmptyState, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './data-table.html',
  styleUrl: './data-table.scss',
  host: { '(document:click)': 'onDocumentClick($event)', '(keydown.escape)': 'closeChooser(true)' },
})
export class DataTable<T extends { id: string }> {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly defaults = inject(PreferencesStore, { optional: true });

  readonly rows = input.required<readonly T[]>();
  readonly columns = input.required<readonly ColumnDef<T>[]>();
  readonly loading = input(false);
  readonly total = input<number | null>(null);
  readonly page = input(1);
  readonly pageSize = input(10);
  readonly sort = input<Sort<T> | undefined>(undefined);
  readonly clickable = input(true);
  readonly emptyTitle = input('لا توجد بيانات');
  readonly emptyText = input('جرّب تعديل الفلاتر أو البحث.');
  readonly caption = input<string>('');
  /** Enables persistent column / density / page-size preferences. Unique per table. */
  readonly tableId = input<string | null>(null);

  readonly sortChange = output<Sort<T> | undefined>();
  readonly pageChange = output<number>();
  readonly pageSizeChange = output<number>();
  readonly rowClick = output<T>();

  protected readonly prefs = linkedSignal<TablePrefs>(() =>
    loadTablePrefs(this.tableId(), this.defaults?.prefs().tableDensity ?? 'comfortable'),
  );
  protected readonly chooserOpen = signal(false);

  protected readonly visibleColumns = computed(() => this.columns().filter((c) => this.isVisible(c)));
  protected readonly chooserColumns = computed(() => this.columns().filter((c) => !c.required));
  protected readonly skeletonRows = computed(() => Array.from({ length: Math.min(this.pageSize(), 6) }, (_, i) => i));
  protected readonly showPaginator = computed(() => (this.total() ?? 0) > Math.min(this.pageSize(), 10));
  protected readonly rowCount = computed(() => (this.total() ?? this.rows().length) + 1);

  protected isVisible(col: ColumnDef<T>): boolean {
    if (col.required) return true;
    return this.prefs().columns[col.key] ?? !col.hidden;
  }

  protected toggleColumn(col: ColumnDef<T>): void {
    this.update({ columns: { ...this.prefs().columns, [col.key]: !this.isVisible(col) } });
  }

  protected resetColumns(): void {
    this.update({ columns: {} });
  }

  protected setDensity(density: TableDensity): void {
    this.update({ density });
  }

  protected changePageSize(size: number): void {
    this.update({ pageSize: size });
    this.pageSizeChange.emit(size);
  }

  protected closeChooser(restoreFocus = false): void {
    if (!this.chooserOpen()) return;
    this.chooserOpen.set(false);
    if (restoreFocus) this.host.nativeElement.querySelector<HTMLElement>('.chooser-btn')?.focus();
  }

  protected onDocumentClick(event: Event): void {
    if (this.chooserOpen() && !this.host.nativeElement.querySelector('.chooser')?.contains(event.target as Node)) this.closeChooser();
  }

  private update(patch: Partial<TablePrefs>): void {
    const next = { ...this.prefs(), ...patch };
    this.prefs.set(next);
    saveTablePrefs(this.tableId(), next);
  }

  protected value(row: T, col: ColumnDef<T>): unknown {
    return col.key.startsWith('_') ? null : row[col.key as keyof T];
  }

  protected text(row: T, col: ColumnDef<T>): string {
    if (col.format) return col.format(row);
    const v = this.value(row, col);
    return v === null || v === undefined || v === '' ? '—' : String(v);
  }

  protected context(row: T, col: ColumnDef<T>, index: number): CellContext<T> {
    return { $implicit: row, value: this.value(row, col), index };
  }

  protected label(col: ColumnDef<T>): string | null {
    return col.mobileLabel ?? (col.header || null);
  }

  protected ariaSort(col: ColumnDef<T>): 'ascending' | 'descending' | 'none' | null {
    if (!col.sortable) return null;
    const s = this.sort();
    if (s?.field !== col.key) return 'none';
    return s.direction === 'asc' ? 'ascending' : 'descending';
  }

  /** Cycles asc → desc → none. */
  protected toggleSort(col: ColumnDef<T>): void {
    if (!col.sortable) return;
    const field = col.key as keyof T & string;
    const current = this.sort();
    if (current?.field !== field) this.sortChange.emit({ field, direction: 'asc' });
    else if (current.direction === 'asc') this.sortChange.emit({ field, direction: 'desc' });
    else this.sortChange.emit(undefined);
  }

  protected onRowKey(event: KeyboardEvent, row: T): void {
    // Only when the row itself is focused, not a button/link inside a cell.
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      this.rowClick.emit(row);
    }
  }

  protected trackRow = (_: number, row: T): string => row.id;
}
