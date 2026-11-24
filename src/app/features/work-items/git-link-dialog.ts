import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { Filters, FilterValue } from '@core/models/entity.model';
import { GitEventsApi } from '@domain/activity/activity.api';
import { GitEvent } from '@domain/activity/activity.models';
import { RelativeTimePipe } from '@shared/pipes/pipes';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { DIALOG_DATA, DialogRef } from '@shared/ui/dialog/dialog.service';
import { DialogShell } from '@shared/ui/dialog/dialog-shell';
import { ltr } from './work-item-utils';

export interface GitLinkDialogData {
  readonly projectId: string;
  readonly ref: string;
}

/** Manual link (FR-GIT-03): pick a recent project Git event not yet linked to the item. Closes with the chosen event. */
@Component({
  selector: 'app-git-link-dialog',
  imports: [DialogShell, RelativeTimePipe, ErrorState, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-dialog-shell title="ربط Commit يدويًا" [subtitle]="'اختر نشاطًا لربطه بـ ' + ltr(data.ref)">
      @if (events.isLoading()) {
        <app-skeleton variant="lines" [count]="3" />
      } @else if (events.error()) {
        <app-error-state title="تعذّر تحميل أنشطة Git" (retry)="events.reload()" />
      } @else {
        <ul class="list" aria-label="أنشطة Git غير المرتبطة">
          @for (e of candidates(); track e.id) {
            <li>
              <button type="button" class="pick" (click)="ref.close(e)">
                <span class="ltr sha">{{ e.sha.slice(0, 7) || e.branch }}</span>
                <span class="t">{{ e.title }}</span>
                <span class="muted m">{{ e.author }} · {{ (e.occurredAt ?? e.createdAt) | relativeTime }}</span>
              </button>
            </li>
          } @empty {
            <li class="muted">لا توجد أنشطة غير مرتبطة.</li>
          }
        </ul>
      }
      <ng-container dialog-actions>
        <button type="button" class="btn btn--outline" (click)="ref.close()">إلغاء</button>
      </ng-container>
    </app-dialog-shell>
  `,
  styles: `
    .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s-2); }
    .pick { display: grid; grid-template-columns: auto 1fr; gap: 2px var(--s-3); width: 100%; text-align: start; padding: var(--s-2) var(--s-3); border: 1px solid var(--c-border); border-radius: var(--r-md); background: var(--c-surface); cursor: pointer; }
    .pick:hover, .pick:focus-visible { border-color: var(--c-emerald-600); background: var(--c-emerald-50); }
    .m { grid-column: 2; font-size: var(--fs-xs); }
    .sha { color: var(--c-muted); }
    .t, .m { overflow-wrap: anywhere; min-width: 0; }
    :host { display: block; max-width: calc(100vw - 32px); }
    @media (pointer: coarse), (max-width: 768px) {
      .pick { min-height: 44px; }
    }
    @media (max-width: 480px) {
      .pick { grid-template-columns: 1fr; }
      .m { grid-column: 1; }
    }
  `,
})
export class GitLinkDialog {
  protected readonly data = inject(DIALOG_DATA) as GitLinkDialogData;
  protected readonly ref = inject(DialogRef<GitEvent>);
  private readonly api = inject(GitEventsApi);
  protected readonly ltr = ltr;

  protected readonly events = rxResource({
    stream: () => {
      const filters: Record<string, FilterValue> = { projectId: this.data.projectId };
      return this.api.list({ page: 1, pageSize: 30, filters: filters as Filters<GitEvent> });
    },
  });
  protected readonly candidates = computed(() => (this.events.value()?.items ?? []).filter((e) => !e.workItemRefs.includes(this.data.ref)));
}
