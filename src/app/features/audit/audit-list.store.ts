import { inject, Injectable } from '@angular/core';
import { ListQuery } from '@core/models/entity.model';
import { EntityListStore } from '@core/state/entity-list.store';
import { AuditApi } from '@domain/activity/activity.api';
import { AuditEvent } from '@domain/activity/activity.models';

/** Read-only, append-only audit list (FR-AUD-04): newest first, 20 per page. Provide at component level. */
@Injectable()
export class AuditListStore extends EntityListStore<AuditEvent> {
  protected readonly api = inject(AuditApi);

  protected override initialQuery(): ListQuery<AuditEvent> {
    return { page: 1, pageSize: 20, sort: { field: 'at', direction: 'desc' } };
  }

  /** `from` / `to` are server-side date filters, not AuditEvent fields, hence the cast to the filter key type. */
  setDateFilter(key: 'from' | 'to', value: string): void {
    this.setFilter(key as unknown as keyof AuditEvent & string, value || undefined);
  }
}
