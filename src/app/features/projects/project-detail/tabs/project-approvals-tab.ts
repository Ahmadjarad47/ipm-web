import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { RouterLink } from '@angular/router';
import { ApprovalRequestsApi } from '@domain/approvals/approval.api';
import { ApprovalRequest } from '@domain/approvals/approval.models';
import { ApprovalStatusBadge } from '@shared/domain-ui/domain-ui';
import { RelativeTimePipe, UserNamePipe } from '@shared/pipes/pipes';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { fetchProjectApprovals } from '../project-approvals-source';

/** The API is per-user per box, so the project's requests are merged from every box (unique by id). */
@Component({
  selector: 'app-project-approvals-tab',
  imports: [RouterLink, ApprovalStatusBadge, EmptyState, ErrorState, Skeleton, RelativeTimePipe, UserNamePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (resource.error()) {
      <app-error-state title="تعذّر تحميل الموافقات" text="حدث خطأ أثناء جلب طلبات الموافقة." (retry)="resource.reload()" />
    } @else if (resource.isLoading() && !requests().length) {
      <app-skeleton variant="lines" [count]="4" />
    } @else if (requests().length) {
      <ul class="list">
        @for (r of requests(); track r.id) {
          <li>
            <a [routerLink]="['/approvals', r.id]" class="title">{{ r.title }}</a>
            <app-approval-status [status]="r.status" />
            @if (r.currentStage > 0) {
              <span class="muted">المرحلة {{ r.currentStage }}/{{ r.stages.length }}</span>
            }
            <span class="spacer"></span>
            <span class="muted">{{ r.requesterId | userName }} · {{ r.createdAt | relativeTime }}</span>
          </li>
        }
      </ul>
    } @else if (!resource.isLoading()) {
      <app-empty-state icon="approval" title="لا توجد طلبات موافقة" text="لم تُرسل طلبات موافقة لهذا المشروع بعد." />
    }
  `,
  styles: `
    .list { list-style: none; margin: 0; padding: 0; }
    .list li { display: flex; align-items: center; gap: var(--s-3); padding: var(--s-3) 0; border-bottom: 1px solid var(--c-border); flex-wrap: wrap; }
    .title { font-weight: 600; color: var(--c-emerald-700); overflow-wrap: anywhere; min-inline-size: 0; }
    @media (max-width: 768px) { .spacer { display: none; } }
    @media (pointer: coarse), (max-width: 768px) { .title { display: inline-flex; align-items: center; min-block-size: 44px; } }
  `,
})
export class ProjectApprovalsTab {
  readonly projectId = input.required<string>();
  /** Incremented by the parent to force a reload (e.g. after a new request is sent). */
  readonly refreshKey = input(0);

  private readonly api = inject(ApprovalRequestsApi);

  protected readonly resource = rxResource<readonly ApprovalRequest[], { projectId: string; key: number }>({
    params: () => ({ projectId: this.projectId(), key: this.refreshKey() }),
    stream: ({ params }) => fetchProjectApprovals(this.api, params.projectId),
    defaultValue: [],
  });

  protected readonly requests = computed(() => this.resource.value());
}
