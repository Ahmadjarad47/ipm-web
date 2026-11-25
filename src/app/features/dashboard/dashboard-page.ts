import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { AuditApi, DashboardApi } from '@domain/activity/activity.api';
import { AUDIT_ACTION_LABELS, AuditEvent } from '@domain/activity/activity.models';
import { ApprovalRequestsApi } from '@domain/approvals/approval.api';
import { ProjectLookup } from '@domain/projects/project.api';
import { SettingsStore } from '@domain/settings/settings.api';
import { UserLookup } from '@domain/users/user.api';
import { WorkItemsApi, WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { STATUS_CATEGORIES, STATUS_CATEGORY_LABELS, StatusCategory } from '@domain/workflow/workflow.models';
import { ApprovalStatusBadge, PriorityBadge, StatusBadge, TypeChip } from '@shared/domain-ui/domain-ui';
import { AppDatePipe, RelativeTimePipe, UserNamePipe } from '@shared/pipes/pipes';
import { Avatar } from '@shared/ui/avatar/avatar';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { HelpTip } from '@shared/ui/help-tip/help-tip';
import { KpiCard } from '@shared/ui/kpi-card/kpi-card';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { AuditFormatter, subjectLink } from '@shared/util/audit-format';
import { orgToday } from '@shared/util/org-date';
import {
  DASHBOARD_PERIOD_LABELS, DashboardFilters, dashboardFiltersFromQuery, dashboardFiltersToQuery, DashboardPeriod, toDashboardFilter,
} from './dashboard-filters';

/** Stable system categories map to semantic design tokens (status display colours stay admin-configured). */
const CATEGORY_COLORS: Record<StatusCategory, string> = {
  'not-started': 'var(--c-neutral)',
  active: 'var(--c-success)',
  blocked: 'var(--c-warning)',
  done: 'var(--c-info)',
  cancelled: 'var(--c-danger)',
};

const PERIOD_HELP =
  'يُحتسب العمل إذا تقاطع نطاقه (من تاريخ البدء أو الإنشاء إلى تاريخ الاستحقاق أو آخر تحديث) مع الفترة المختارة؛ يكفي تقاطع جزئي. التواريخ حسب المنطقة الزمنية للمؤسسة.';

/** FR-UI-01..07: KPIs, status distribution by stable category, project progress, my work, my approvals, recent activity. */
@Component({
  selector: 'app-dashboard-page',
  imports: [
    FormsModule, RouterLink, KpiCard, EmptyState, ErrorState, HelpTip, Skeleton, Avatar,
    StatusBadge, TypeChip, PriorityBadge, ApprovalStatusBadge, AppDatePipe, RelativeTimePipe, UserNamePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './dashboard-page.html',
  styleUrl: './dashboard-page.scss',
})
export class DashboardPage {
  private readonly auth = inject(AuthService);
  private readonly dashboardApi = inject(DashboardApi);
  private readonly workItemsApi = inject(WorkItemsApi);
  private readonly approvalsApi = inject(ApprovalRequestsApi);
  private readonly auditApi = inject(AuditApi);
  private readonly settings = inject(SettingsStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly format = inject(AuditFormatter);
  protected readonly projects = inject(ProjectLookup);
  protected readonly users = inject(UserLookup);
  protected readonly types = inject(WorkItemTypeLookup);

  protected readonly user = this.auth.user;
  protected readonly periodHelp = PERIOD_HELP;
  protected readonly periods = (Object.keys(DASHBOARD_PERIOD_LABELS) as DashboardPeriod[]).map((key) => ({ key, label: DASHBOARD_PERIOD_LABELS[key] }));
  protected readonly categories = STATUS_CATEGORIES.map((key) => ({ key, label: STATUS_CATEGORY_LABELS[key] }));

  protected readonly filters = signal<DashboardFilters>(dashboardFiltersFromQuery((k) => this.route.snapshot.queryParamMap.get(k)));
  protected readonly projectId = computed(() => this.filters().projectId);

  private readonly apiFilter = computed(() => toDashboardFilter(this.filters(), orgToday(this.settings.value().timeZone)));

  protected readonly stats = rxResource({ params: () => this.apiFilter(), stream: ({ params }) => this.dashboardApi.stats(params) });
  /** `value()` is only read when the resource really has data, so a failure never renders as zero. */
  protected readonly statsValue = computed(() => (this.stats.hasValue() ? this.stats.value() : undefined));

  protected readonly myItems = rxResource({
    params: () => ({ me: this.user()?.id ?? '', projectId: this.projectId() }),
    stream: ({ params }) =>
      this.workItemsApi
        .list({
          page: 1,
          pageSize: 6,
          sort: { field: 'dueDate', direction: 'asc' },
          filters: { assigneeIds: [params.me], ...(params.projectId ? { projectId: params.projectId } : {}) },
        })
        .pipe(map((p) => p.items)),
  });
  protected readonly myItemsValue = computed(() => (this.myItems.hasValue() ? this.myItems.value() : []));

  protected readonly myApprovals = rxResource({
    params: () => true,
    stream: () => this.approvalsApi.listBox('inbox', { page: 1, pageSize: 5 }).pipe(map((p) => p.items)),
  });
  protected readonly myApprovalsValue = computed(() => (this.myApprovals.hasValue() ? this.myApprovals.value() : []));

  protected readonly activity = rxResource({
    params: () => this.projectId(),
    stream: ({ params }) =>
      this.auditApi.list({ page: 1, pageSize: 8, filters: params ? { projectId: params } : {} }).pipe(map((p) => p.items)),
  });
  protected readonly activityValue = computed(() => (this.activity.hasValue() ? this.activity.value() : []));

  protected readonly activeProjects = computed(() =>
    this.projects.items().filter((p) => !p.archived && (!this.projectId() || p.id === this.projectId())),
  );

  /** All items in scope (parents included) per stable category, so renaming a status never distorts the chart. */
  protected readonly categoryBars = computed(() => {
    const by = this.statsValue()?.byCategory ?? {};
    const total = STATUS_CATEGORIES.reduce((a, c) => a + (by[c] ?? 0), 0);
    return STATUS_CATEGORIES.map((c) => ({
      key: c,
      label: STATUS_CATEGORY_LABELS[c],
      count: by[c] ?? 0,
      percent: total ? Math.round(((by[c] ?? 0) / total) * 100) : 0,
      color: CATEGORY_COLORS[c],
    }));
  });

  protected readonly totalItems = computed(() => this.categoryBars().reduce((a, b) => a + b.count, 0));

  protected readonly donut = computed(() => {
    const total = this.totalItems();
    let offset = 0;
    return this.categoryBars()
      .filter((b) => b.count > 0)
      .map((b) => {
        const share = (b.count / total) * 100;
        const seg = { ...b, dash: `${share} ${100 - share}`, offset: -offset };
        offset += share;
        return seg;
      });
  });

  /** Leaf-only completion by type with the per-category stacked breakdown. */
  protected readonly typeRows = computed(() =>
    (this.statsValue()?.byType ?? []).map((t) => ({
      ...t,
      name: this.types.get(t.typeId)?.name ?? '—',
      percent: t.total ? Math.round((t.done / t.total) * 100) : 0,
      segments: STATUS_CATEGORIES.map((c) => ({
        key: c,
        label: STATUS_CATEGORY_LABELS[c],
        count: t.byCategory[c] ?? 0,
        width: t.total ? ((t.byCategory[c] ?? 0) / t.total) * 100 : 0,
        color: CATEGORY_COLORS[c],
      })).filter((s) => s.count > 0),
    })),
  );

  protected readonly greeting = computed(() => {
    const h = new Date().getHours();
    return h < 12 ? 'صباح الخير' : 'مساء الخير';
  });

  constructor() {
    effect(() => {
      void this.router.navigate([], { relativeTo: this.route, queryParams: dashboardFiltersToQuery(this.filters()), replaceUrl: true });
    });
  }

  protected patch(change: Partial<DashboardFilters>): void {
    this.filters.update((f) => ({ ...f, ...change }));
  }

  protected asPeriod(v: string): DashboardPeriod {
    return this.periods.find((p) => p.key === v)?.key ?? 'all';
  }

  protected asCategory(v: string): StatusCategory | '' {
    return STATUS_CATEGORIES.find((c) => c === v) ?? '';
  }

  protected actionLabel(e: AuditEvent): string {
    return AUDIT_ACTION_LABELS[e.action] ?? e.action;
  }

  protected activityLink(e: AuditEvent): string | null {
    return subjectLink(e.subjectType, e.subjectId);
  }
}
