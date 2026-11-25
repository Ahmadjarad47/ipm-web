import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { TransitionsApi } from '@domain/workflow/workflow.api';
import { AppDatePipe, UserNamePipe } from '@shared/pipes/pipes';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { Skeleton } from '@shared/ui/skeleton/skeleton';

/** «سجل الحالة»: every status change of the item, newest first (FR-WF-08). */
@Component({
  selector: 'app-status-history',
  imports: [AppDatePipe, UserNamePipe, EmptyState, ErrorState, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (history.error()) {
      <app-error-state text="تعذّر تحميل سجل الحالة." (retry)="history.reload()" />
    } @else if (history.isLoading() && !history.hasValue()) {
      <app-skeleton variant="table" [count]="4" />
    } @else if (rows().length) {
      <div class="scroll">
        <table class="history">
          <caption class="sr-only">سجل تغيّر الحالة</caption>
          <thead>
            <tr><th scope="col">من ← إلى</th><th scope="col">التعليق</th><th scope="col">بواسطة</th><th scope="col">الوقت</th></tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.id) {
              <tr>
                <td>{{ r.fromName }} ← {{ r.toName }}</td>
                <td>{{ r.comment || '—' }}</td>
                <td>{{ r.actorId | userName }}</td>
                <td>{{ r.at | appDate: true }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    } @else {
      <app-empty-state icon="history" title="لا يوجد سجل حالة" text="لم تتغير حالة هذا العمل بعد." />
    }
  `,
  styles: `
    .scroll { overflow-x: auto; }
    .history { inline-size: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
    th, td { padding: var(--s-2) var(--s-3); text-align: start; border-block-end: 1px solid var(--c-border); }
    th { color: var(--c-muted); font-weight: 600; white-space: nowrap; }
    td { overflow-wrap: anywhere; vertical-align: top; }
    @media (max-width: 768px) { td:nth-child(2) { min-inline-size: 160px; } }
  `,
})
export class StatusHistory {
  private readonly api = inject(TransitionsApi);

  readonly itemId = input.required<string>();
  /** Changes when the item reloads, so a new transition shows up. */
  readonly version = input(0);

  protected readonly history = rxResource({
    params: () => ({ id: this.itemId(), version: this.version() }),
    stream: ({ params }) => this.api.bySubject('workItem', params.id),
  });
  protected readonly rows = () => [...(this.history.value() ?? [])].reverse();
}
