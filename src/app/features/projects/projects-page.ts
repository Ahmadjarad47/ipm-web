import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, TemplateRef, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { CanDirective } from '@core/auth/can.directive';
import { ToastService } from '@core/notifications/toast.service';
import { ProjectLookup } from '@domain/projects/project.api';
import { ProjectSummary } from '@domain/projects/project.models';
import { UserLookup } from '@domain/users/user.api';
import { StatusLookup } from '@domain/workflow/workflow.api';
import { StatusBadge } from '@shared/domain-ui/domain-ui';
import { AppDatePipe, UserNamePipe } from '@shared/pipes/pipes';
import { Avatar } from '@shared/ui/avatar/avatar';
import { Badge } from '@shared/ui/badge/badge';
import { DataTable } from '@shared/ui/data-table/data-table';
import { CellContext, ColumnDef } from '@shared/ui/data-table/data-table.models';
import { DialogService } from '@shared/ui/dialog/dialog.service';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { Icon } from '@shared/ui/icon/icon';
import { PageHeader } from '@shared/ui/page-header/page-header';
import { Paginator } from '@shared/ui/paginator/paginator';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { ProjectForm, ProjectFormData } from './project-form/project-form';
import { ActiveFilter, queryToParams } from './project-list-query';
import { PROJECTS_TABLE_ID, ProjectListStore } from './project-list-store';
import { ProjectProgress } from './project-progress';

type ViewMode = 'table' | 'cards';

const VIEW_KEY = 'ipm.projects.view';

function loadView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'cards' ? 'cards' : 'table';
  } catch {
    return 'table';
  }
}

@Component({
  selector: 'app-projects-page',
  imports: [
    CanDirective, DataTable, PageHeader, Icon, StatusBadge, Badge, Avatar, AppDatePipe, UserNamePipe,
    ProjectProgress, EmptyState, ErrorState, Skeleton, Paginator, RouterLink,
  ],
  providers: [ProjectListStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './projects-page.html',
  styleUrl: './projects-page.scss',
})
export class ProjectsPage {
  protected readonly store = inject(ProjectListStore);
  protected readonly tableId = PROJECTS_TABLE_ID;
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly projectLookup = inject(ProjectLookup);
  private readonly statuses = inject(StatusLookup);
  private readonly users = inject(UserLookup);
  private readonly auth = inject(AuthService);
  private readonly search$ = new Subject<string>();

  constructor() {
    this.search$.pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed()).subscribe((s) => this.store.setSearch(s));

    // Keep the URL in sync with the query (replaceUrl: filters never pollute browser history).
    effect(() => {
      const params = queryToParams(this.store.query());
      void this.router.navigate([], { relativeTo: this.route, queryParams: params, queryParamsHandling: 'merge', replaceUrl: true });
    });

    // Deep link: /projects?create=true opens the create dialog once.
    if (this.route.snapshot.queryParamMap.get('create') === 'true' && this.auth.can('projects.create')) {
      void this.router.navigate([], { relativeTo: this.route, queryParams: { create: null }, queryParamsHandling: 'merge', replaceUrl: true });
      queueMicrotask(() => this.create());
    }
  }

  protected readonly view = signal<ViewMode>(loadView());
  protected readonly projectStatuses = computed(() => this.statuses.items().filter((s) => s.scope === 'project'));
  protected readonly activeUsers = computed(() => this.users.items().filter((u) => u.active));
  protected readonly filters = computed(() => (this.store.query().filters ?? {}) as Readonly<Record<string, string | boolean | undefined>>);
  protected readonly search = computed(() => this.store.query().search ?? '');
  protected readonly showArchived = computed(() => this.filters()['archived'] !== false);
  protected readonly firstLoad = computed(() => this.store.loading() && this.store.items().length === 0);

  /** Chips for every filter that differs from the default view. */
  protected readonly activeFilters = computed<readonly ActiveFilter[]>(() => {
    const f = this.filters();
    const list: ActiveFilter[] = [];
    const text = (key: string): string | undefined => (typeof f[key] === 'string' && f[key] ? (f[key] as string) : undefined);
    if (this.search()) list.push({ key: 'search', label: `بحث: ${this.search()}` });
    const status = text('statusId');
    if (status) list.push({ key: 'statusId', label: `الحالة: ${this.statuses.get(status)?.name ?? status}` });
    const owner = text('ownerId');
    if (owner) list.push({ key: 'ownerId', label: `المالك: ${this.users.nameOf(owner)}` });
    const member = text('memberId');
    if (member) list.push({ key: 'memberId', label: `العضو: ${this.users.nameOf(member)}` });
    if (this.showArchived()) list.push({ key: 'archived', label: 'يشمل المؤرشف' });
    if (text('endFrom')) list.push({ key: 'endFrom', label: `من: ${text('endFrom')}` });
    if (text('startTo')) list.push({ key: 'startTo', label: `إلى: ${text('startTo')}` });
    return list;
  });

  private readonly statusTpl = viewChild.required<TemplateRef<CellContext<ProjectSummary>>>('statusTpl');
  private readonly progressTpl = viewChild.required<TemplateRef<CellContext<ProjectSummary>>>('progressTpl');
  private readonly ownerTpl = viewChild.required<TemplateRef<CellContext<ProjectSummary>>>('ownerTpl');
  private readonly startTpl = viewChild.required<TemplateRef<CellContext<ProjectSummary>>>('startTpl');
  private readonly endTpl = viewChild.required<TemplateRef<CellContext<ProjectSummary>>>('endTpl');
  private readonly nameTpl = viewChild.required<TemplateRef<CellContext<ProjectSummary>>>('nameTpl');
  private readonly codeTpl = viewChild.required<TemplateRef<CellContext<ProjectSummary>>>('codeTpl');

  protected readonly columns = computed<readonly ColumnDef<ProjectSummary>[]>(() => [
    { key: 'code', header: 'الرمز', sortable: true, width: '110px', template: this.codeTpl() },
    { key: 'name', header: 'المشروع', sortable: true, required: true, template: this.nameTpl() },
    { key: 'statusId', header: 'الحالة', sortable: true, template: this.statusTpl() },
    { key: 'progress', header: 'التقدّم', sortable: true, width: '180px', template: this.progressTpl() },
    { key: 'ownerId', header: 'المالك', sortable: true, template: this.ownerTpl() },
    { key: 'startDate', header: 'البداية', sortable: true, hideOnMobile: true, template: this.startTpl() },
    { key: 'endDate', header: 'النهاية', sortable: true, hideOnMobile: true, template: this.endTpl() },
  ]);

  protected value(event: Event): string {
    return (event.target as HTMLInputElement | HTMLSelectElement).value;
  }

  protected onSearch(event: Event): void {
    this.search$.next(this.value(event));
  }

  protected onFilter(key: 'statusId' | 'ownerId' | 'memberId' | 'endFrom' | 'startTo', event: Event): void {
    this.store.setProjectFilter(key, this.value(event) || undefined);
  }

  /** Checked = show archived too (filter removed); unchecked = active projects only. */
  protected onArchived(event: Event): void {
    this.store.setProjectFilter('archived', (event.target as HTMLInputElement).checked ? undefined : false);
  }

  protected removeFilter(filter: ActiveFilter): void {
    if (filter.key === 'search') this.store.setSearch('');
    else if (filter.key === 'archived') this.store.setProjectFilter('archived', false);
    else this.store.setProjectFilter(filter.key, undefined);
  }

  protected setView(mode: ViewMode): void {
    this.view.set(mode);
    try {
      localStorage.setItem(VIEW_KEY, mode);
    } catch {
      /* preference just does not persist */
    }
  }

  protected open(project: ProjectSummary): void {
    void this.router.navigate(['/projects', project.id]);
  }

  protected create(): void {
    this.dialog
      .open<ProjectForm, ProjectFormData, ProjectSummary>(ProjectForm, { data: {}, width: 'min(680px, calc(100vw - 32px))' })
      .afterClosed.subscribe((created) => {
        if (!created) return;
        this.toast.success('تم إنشاء المشروع');
        this.auth.refreshSession().subscribe();
        this.projectLookup.reload();
        this.store.reload();
      });
  }
}
