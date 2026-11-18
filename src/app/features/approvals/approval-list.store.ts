import { inject, Injectable, signal } from '@angular/core';
import { Observable } from 'rxjs';
import { ListQuery, PagedResult } from '@core/models/entity.model';
import { EntityListStore } from '@core/state/entity-list.store';
import { ApprovalRequestsApi } from '@domain/approvals/approval.api';
import { ApprovalBox, ApprovalRequest } from '@domain/approvals/approval.models';

/** Paged list of approval requests for one box (inbox / sent / closed). Provide at component level. */
@Injectable()
export class ApprovalListStore extends EntityListStore<ApprovalRequest> {
  protected readonly api = inject(ApprovalRequestsApi);

  /** Read inside `fetch` only; `setBox` replaces the query so the resource re-fetches. */
  readonly box = signal<ApprovalBox>('inbox');

  protected override fetch(query: ListQuery<ApprovalRequest>): Observable<PagedResult<ApprovalRequest>> {
    return this.api.listBox(this.box(), query);
  }

  setBox(box: ApprovalBox): void {
    if (box === this.box()) return;
    this.box.set(box);
    // A fresh query object changes the resource params, which cancels the old request and loads the new box.
    this.resetFilters();
  }
}
