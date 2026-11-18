import { computed, inject, Injectable } from '@angular/core';
import { FilterValue } from '@core/models/entity.model';
import { EntityListStore } from '@core/state/entity-list.store';
import { WorkItemsApi } from '@domain/work-items/work-item.api';
import { WorkItem } from '@domain/work-items/work-item.models';

@Injectable()
export class WorkItemListStore extends EntityListStore<WorkItem> {
  protected readonly api = inject(WorkItemsApi);

  readonly filters = computed(() => (this.query().filters ?? {}) as Readonly<Record<string, FilterValue>>);

  /** For server filters that are not WorkItem fields (e.g. `overdue`). The cast is safe: filters are serialised by key. */
  setFilterByKey(key: string, value: FilterValue | undefined): void {
    this.setFilter(key as keyof WorkItem & string, value);
  }

  /** Makes the active filters exactly `next`: removes keys that are gone, sets the rest. */
  replaceFilters(next: Readonly<Record<string, FilterValue>>): void {
    for (const key of Object.keys(this.filters())) if (!(key in next)) this.setFilterByKey(key, undefined);
    for (const [key, value] of Object.entries(next)) this.setFilterByKey(key, value);
  }
}
