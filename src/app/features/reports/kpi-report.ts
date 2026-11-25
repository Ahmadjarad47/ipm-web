import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input, signal } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/notifications/toast.service';
import { DashboardApi } from '@domain/activity/activity.api';
import { ProjectLookup } from '@domain/projects/project.api';
import { SettingsStore } from '@domain/settings/settings.api';
import { UserLookup } from '@domain/users/user.api';
import { WorkItem } from '@domain/work-items/work-item.models';
import { WorkItemsApi, WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { StatusLookup } from '@domain/workflow/workflow.api';
import { STATUS_CATEGORIES, STATUS_CATEGORY_LABELS, StatusCategory } from '@domain/workflow/workflow.models';
import { StatusBadge, TypeChip } from '@shared/domain-ui/domain-ui';
import { AppDatePipe, UserNamesPipe } from '@shared/pipes/pipes';
import { AvatarStack } from '@shared/ui/avatar/avatar';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { HelpTip } from '@shared/ui/help-tip/help-tip';
import { Icon } from '@shared/ui/icon/icon';
import { KpiCard } from '@shared/ui/kpi-card/kpi-card';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { fetchAllPages } from './fetch-all-pages';
import { dayNumber, downloadCsv, isClosedCategory, PERIOD_LABELS, ReportFilters, resolvePeriod, todayIso } from './report-filters.model';

const PAGE_SIZE = 100;

const CATEGORY_COLORS: Record<StatusCategory, string> = {
  'not-started': 'var(--c-neutral)',
  active: 'var(--c-success)',
  blocked: 'var(--c-warning)',
  done: 'var(--c-info)',
  cancelled: 'var(--c-danger)',
};

const HELP_ALL_ITEMS = 'كل الأعمال: تشمل الأعمال الأب والطرفية معًا. تُستخدم في توزيع الفئات وعدّاد الأعمال المفتوحة والمتأخرة.';
const HELP_LEAF_ITEMS = 'الأعمال الطرفية: أعمال دون أبناء، مع استبعاد الملغاة. منها تُحسب نسبة الإنجاز حتى لا يُحتسب الأب وأبناؤه مرتين.';
const HELP_DEPENDENCY = 'محجوب: عمل مفتوح يحجبه رابط من عمل لم يكتمل. حاجب: عمل مفتوح يحجب غيره. النسبة: الأعمال ذات اعتمادية مفتوحة ÷ أعمال النطاق.';

/** KPI report (SRS §6.3, FR-UI-08): metrics, distribution by stable category, per-project progress, overdue items, export. */
@Component({
  selector: 'app-kpi-report',
  imports: [RouterLink, KpiCard, EmptyState, ErrorState, HelpTip, Skeleton, Icon, StatusBadge, TypeChip, AvatarStack, AppDatePipe, UserNamesPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './kpi-report.html',
  styleUrl: './kpi-report.scss',
})
export class KpiReport {
  private readonly dashboard = inject(DashboardApi);
  private readonly workItems = inject(WorkItemsApi);
  private readonly statuses = inject(StatusLookup);
  private readonly users = inject(UserLookup);
  private readonly types = inject(WorkItemTypeLookup);
  private readonly settings = inject(SettingsStore);
  private readonly toast = inject(ToastService);
  protected readonly projects = inject(ProjectLookup);
  private readonly auth = inject(AuthService);
  protected readonly canExport = computed(() => this.auth.can('reports.export'));

  readonly filters = input.required<ReportFilters>();

  protected readonly helpAll = HELP_ALL_ITEMS;
  protected readonly helpLeaf = HELP_LEAF_ITEMS;
  protected readonly helpDeps = HELP_DEPENDENCY;
  protected readonly categories = STATUS_CATEGORIES.map((key) => ({ key, label: STATUS_CATEGORY_LABELS[key] }));
  protected readonly generatedAt = new Date().toISOString();

  /** Calendar "today" in the organisation zone (NFR-10). */
  private readonly today = computed(() => todayIso(this.settings.value().timeZone));

  protected readonly stats = rxResource({
    params: () => {
      const f = this.filters();
      return { projectId: f.projectId || undefined, ...resolvePeriod(f, this.today()) };
    },
    stream: ({ params }) => this.dashboard.stats(params),
  });
  protected readonly statsValue = computed(() => (this.stats.hasValue() ? this.stats.value() : undefined));

  protected readonly items = rxResource({
    params: () => ({ projectId: this.filters().projectId, assigneeId: this.filters().assigneeId }),
    stream: ({ params }) => this.workItems.list(this.itemsQuery(params, 1)),
  });
  protected readonly itemsPage = computed(() => (this.items.hasValue() ? this.items.value() : undefined));

  protected readonly truncated = computed(() => {
    const page = this.itemsPage();
    return !!page && page.total > page.items.length;
  });

  private itemsQuery(params: { projectId: string; assigneeId: string }, page: number) {
    return {
      page,
      pageSize: PAGE_SIZE,
      sort: { field: 'dueDate' as const, direction: 'asc' as const },
      filters: {
        ...(params.projectId ? { projectId: params.projectId } : {}),
        ...(params.assigneeId ? { assigneeIds: [params.assigneeId] } : {}),
      },
    };
  }

  protected readonly summary = computed(() => {
    const f = this.filters();
    const { from, to } = resolvePeriod(f, this.today());
    const period = f.period === 'all' ? PERIOD_LABELS.all : from || to ? `${PERIOD_LABELS[f.period]} (${from ?? '…'} → ${to ?? '…'})` : PERIOD_LABELS[f.period];
    return [
      { label: 'المشروع', value: f.projectId ? (this.projects.get(f.projectId)?.name ?? '—') : 'كل المشاريع' },
      { label: 'الفترة', value: period },
      { label: 'فئة الحالة', value: f.category ? STATUS_CATEGORY_LABELS[f.category] : 'كل الفئات' },
      { label: 'المكلّف', value: f.assigneeId ? this.users.nameOf(f.assigneeId) : 'الجميع' },
    ];
  });

  /** All items (parents included). */
  protected readonly categoryBars = computed(() => {
    const by = this.statsValue()?.byCategory ?? {};
    const total = STATUS_CATEGORIES.reduce((sum, c) => sum + (by[c] ?? 0), 0);
    return STATUS_CATEGORIES.map((c) => ({
      key: c,
      label: STATUS_CATEGORY_LABELS[c],
      count: by[c] ?? 0,
      percent: total ? Math.round(((by[c] ?? 0) / total) * 100) : 0,
      color: CATEGORY_COLORS[c],
    }));
  });

  /** Leaf items per type with their category counts (type × category matrix). */
  protected readonly typeRows = computed(() =>
    (this.statsValue()?.byType ?? []).map((t) => ({
      ...t,
      name: this.types.get(t.typeId)?.name ?? '—',
      percent: t.total ? Math.round((t.done / t.total) * 100) : 0,
      cells: STATUS_CATEGORIES.map((c) => t.byCategory[c] ?? 0),
    })),
  );

  protected readonly projectRows = computed(() => {
    const id = this.filters().projectId;
    return this.projects.items().filter((p) => !p.archived && (!id || p.id === id));
  });

  protected readonly overdueRows = computed(() => this.overdueOf(this.itemsPage()?.items ?? []));

  private overdueOf(items: readonly WorkItem[]) {
    const cat = this.filters().category;
    const today = dayNumber(this.today());
    return items
      .filter((i) => {
        if (i.archived || !i.dueDate || dayNumber(i.dueDate) >= today) return false;
        const c = this.statuses.get(i.statusId)?.category;
        return !isClosedCategory(c) && (!cat || c === cat);
      })
      .map((i) => ({ item: i, project: this.projects.get(i.projectId) }));
  }

  protected print(): void {
    window.print();
  }

  // ---------- Export: every page, with progress and cancel ----------

  protected readonly exportProgress = signal<number | null>(null);
  private exportSub: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.exportSub?.unsubscribe());
  }

  protected cancelExport(): void {
    this.exportSub?.unsubscribe();
    this.exportSub = null;
    this.exportProgress.set(null);
  }

  protected exportCsv(): void {
    if (this.exportProgress() !== null) return;
    this.exportProgress.set(0);
    const params = { projectId: this.filters().projectId, assigneeId: this.filters().assigneeId };
    this.exportSub = fetchAllPages(
      (page) => this.workItems.list(this.itemsQuery(params, page)),
      (loaded, total) => this.exportProgress.set(total ? Math.min(99, Math.floor((loaded / total) * 100)) : 99),
    ).subscribe({
      next: (all) => {
        this.writeCsv(this.overdueOf(all));
        this.exportProgress.set(null);
        this.exportSub = null;
        this.toast.success('تم تصدير التقرير');
      },
      error: () => {
        this.exportProgress.set(null);
        this.exportSub = null;
      },
    });
  }

  private writeCsv(overdue: ReturnType<KpiReport['overdueOf']>): void {
    const s = this.statsValue();
    const rows: (string | number)[][] = [
      ['تقرير المؤشرات'],
      ...this.summary().map((x) => [x.label, x.value]),
      ['وقت الإنشاء', this.generatedAt],
      [],
      ['المؤشر', 'القيمة'],
      ['المشاريع النشطة', s?.activeProjects ?? 0],
      ['أعمال مفتوحة', s?.openWorkItems ?? 0],
      ['أعمال متأخرة', s?.overdueWorkItems ?? 0],
      ['موافقات معلّقة', s?.pendingApprovals ?? 0],
      ['أعمال محجوبة', s?.blockedItems ?? 0],
      ['نشاط Git (ليس مقياس إنجاز)', s?.gitActivity ?? 0],
      [],
      ['الاعتماديات', 'القيمة'],
      ['أعمال محجوبة', s?.dependencies.blockedItems ?? 0],
      ['أعمال حاجبة', s?.dependencies.blockingItems ?? 0],
      ['نسبة الأعمال ذات اعتمادية مفتوحة %', s?.dependencies.itemsWithOpenDependencyPct ?? 0],
      [],
      ['فئة الحالة (كل الأعمال)', 'العدد'],
      ...this.categoryBars().map((b) => [b.label, b.count]),
      [],
      ['النوع (الأعمال الطرفية)', ...this.categories.map((c) => c.label), 'منجز', 'الإجمالي'],
      ...this.typeRows().map((t) => [t.name, ...t.cells, t.done, t.total]),
      [],
      ['الرمز', 'المشروع', 'الحالة', 'التقدم %', 'أعمال منجزة', 'أعمال محسوبة', 'متأخرة'],
      ...this.projectRows().map((p) => [
        p.code, p.name, this.statuses.get(p.statusId)?.name ?? '—',
        p.progress.percent ?? 'لا توجد بيانات', p.progress.doneLeaves, p.progress.countedLeaves, p.overdueCount,
      ]),
      [],
      ['المرجع', 'العنوان', 'المشروع', 'المكلّفون', 'الاستحقاق'],
      ...overdue.map(({ item, project }) => [
        item.ref, item.title, project?.name ?? '—', item.assigneeIds.map((id) => this.users.nameOf(id)).join('، '), item.dueDate?.slice(0, 10) ?? '',
      ]),
    ];
    downloadCsv(rows, `report-${this.today()}.csv`);
  }
}
