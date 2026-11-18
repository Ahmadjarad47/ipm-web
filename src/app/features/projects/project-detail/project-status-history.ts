import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { TransitionRecord } from '@domain/workflow/workflow.models';
import { TransitionsApi } from '@domain/workflow/workflow.api';
import { AppDatePipe, UserNamePipe } from '@shared/pipes/pipes';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { Skeleton } from '@shared/ui/skeleton/skeleton';

/** «سجل الحالة» (FR-WF-08): every executed status change of the project, newest first. */
@Component({
  selector: 'app-project-status-history',
  imports: [AppDatePipe, UserNamePipe, EmptyState, ErrorState, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h3 class="section-title">سجل الحالة</h3>
    @if (resource.error()) {
      <app-error-state title="تعذّر تحميل سجل الحالة" (retry)="resource.reload()" />
    } @else if (resource.isLoading() && !rows().length) {
      <app-skeleton variant="lines" [count]="3" />
    } @else if (!rows().length) {
      <app-empty-state icon="history" title="لا توجد انتقالات بعد" text="ستظهر هنا كل تغييرات حالة المشروع مع الملاحظة ومن أجراها." />
    } @else {
      <div class="scroll">
        <table class="tbl">
          <caption class="sr-only">سجل تغييرات حالة المشروع</caption>
          <thead>
            <tr><th scope="col">من ← إلى</th><th scope="col">الملاحظة</th><th scope="col">بواسطة</th><th scope="col">الوقت</th></tr>
          </thead>
          <tbody>
            @for (r of rows(); track r.id) {
              <tr>
                <td>{{ r.fromName }} ← <strong>{{ r.toName }}</strong></td>
                <td>{{ r.comment || '—' }}</td>
                <td>{{ r.actorId | userName }}</td>
                <td>{{ r.at | appDate: true }}</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: `
    :host { display: block; margin-block-end: var(--s-6); }
    .scroll { overflow-x: auto; }
    .tbl { width: 100%; border-collapse: collapse; font-size: var(--fs-sm); }
    .tbl th { text-align: start; padding: var(--s-2) var(--s-3); color: var(--c-muted); font-weight: 600; border-bottom: 1px solid var(--c-border-strong); white-space: nowrap; }
    .tbl td { padding: var(--s-2) var(--s-3); border-bottom: 1px solid var(--c-border); vertical-align: top; overflow-wrap: anywhere; }
    @media (max-width: 768px) { .tbl td:nth-child(2) { min-inline-size: 160px; } }
  `,
})
export class ProjectStatusHistory {
  readonly projectId = input.required<string>();
  /** Bumped by the parent after a transition so the table reloads. */
  readonly refreshKey = input(0);

  private readonly api = inject(TransitionsApi);

  protected readonly resource = rxResource<readonly TransitionRecord[], { id: string; key: number }>({
    params: () => ({ id: this.projectId(), key: this.refreshKey() }),
    stream: ({ params }) => this.api.bySubject('project', params.id),
    defaultValue: [],
  });

  /** The API returns oldest first; show newest first. */
  protected readonly rows = (): readonly TransitionRecord[] => [...this.resource.value()].sort((a, b) => b.at.localeCompare(a.at));
}
