import { computed, Directive, signal } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { Observable } from 'rxjs';
import { BaseApiService } from '@core/api/base-api.service';
import { isApiError } from '@core/models/api-error.model';
import {
  DEFAULT_PAGE_SIZE,
  emptyPage,
  Entity,
  FilterValue,
  Filters,
  ListQuery,
  PagedResult,
  Sort,
} from '@core/models/entity.model';

/**
 * Generic, signal-based state for any paginated list screen.
 *
 * Concrete stores extend it and supply the API (`protected readonly api = inject(ProjectsApi)`).
 * The query is a signal; changing page, sort, search or a filter re-fetches automatically and
 * cancels the previous request (rxResource switch semantics).
 *
 * Provide concrete stores at component level so each screen owns its own state.
 */
@Directive()
export abstract class EntityListStore<T extends Entity> {
  protected abstract readonly api: BaseApiService<T, unknown, unknown>;

  /** Override to give a screen different initial paging, sort or filters. */
  protected initialQuery(): ListQuery<T> {
    return { page: 1, pageSize: DEFAULT_PAGE_SIZE };
  }

  private readonly _query = signal<ListQuery<T> | null>(null);

  /** The active query; lazily initialised so subclasses can override `initialQuery`. */
  readonly query = computed(() => this._query() ?? this.initialQuery());

  private readonly resource = rxResource<PagedResult<T>, ListQuery<T>>({
    params: () => this.query(),
    stream: ({ params }) => this.fetch(params),
    defaultValue: emptyPage<T>(),
  });

  readonly page = computed(() => this.resource.value());
  readonly items = computed(() => this.page().items);
  readonly total = computed(() => this.page().total);
  readonly loading = this.resource.isLoading;
  readonly isEmpty = computed(() => !this.loading() && this.items().length === 0);
  readonly error = computed(() => {
    const err = this.resource.error();
    if (!err) return null;
    const cause = (err as { cause?: unknown }).cause ?? err;
    return isApiError(cause) ? cause.message : 'تعذّر تحميل البيانات';
  });

  /** Hook for stores that need a custom endpoint for the list. */
  protected fetch(query: ListQuery<T>): Observable<PagedResult<T>> {
    return this.api.list(query);
  }

  setPage(page: number): void {
    this.patch({ page });
  }

  setPageSize(pageSize: number): void {
    this.patch({ pageSize, page: 1 });
  }

  setSearch(search: string): void {
    this.patch({ search, page: 1 });
  }

  setSort(sort: Sort<T> | undefined): void {
    this.patch({ sort });
  }

  setFilter(field: keyof T & string, value: FilterValue | undefined): void {
    const filters = { ...this.query().filters } as Record<string, FilterValue>;
    if (value === undefined || value === '' || (Array.isArray(value) && !value.length)) {
      delete filters[field];
    } else {
      filters[field] = value;
    }
    this.patch({ filters: filters as Filters<T>, page: 1 });
  }

  resetFilters(): void {
    this._query.set(this.initialQuery());
  }

  reload(): void {
    this.resource.reload();
  }

  private patch(changes: Partial<ListQuery<T>>): void {
    this._query.set({ ...this.query(), ...changes });
  }
}
