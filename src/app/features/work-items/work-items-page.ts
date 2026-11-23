import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, TemplateRef, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { debounceTime, Subject } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { FilterValue } from '@core/models/entity.model';
import { ToastService } from '@core/notifications/toast.service';
import { ProjectLookup } from '@domain/projects/project.api';
import { UserLookup } from '@domain/users/user.api';
import { BulkAction, BulkResult, WorkItemsApi, WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { PRIORITY_LABELS, Priority, WorkItem } from '@domain/work-items/work-item.models';
import { StatusLookup, WorkflowLookup } from '@domain/workflow/workflow.api';
import { PriorityBadge, StatusBadge, TypeChip } from '@shared/domain-ui/domain-ui';
import { AppDatePipe, UserNamesPipe } from '@shared/pipes/pipes';
import { AvatarStack } from '@shared/ui/avatar/avatar';
import { CellContext, ColumnDef, loadTablePrefs } from '@shared/ui/data-table/data-table.models';
import { DataTable } from '@shared/ui/data-table/data-table';
import { DialogService } from '@shared/ui/dialog/dialog.service';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { Icon } from '@shared/ui/icon/icon';
import { PageHeader } from '@shared/ui/page-header/page-header';
import { BulkActionData, BulkActionDialog, BulkResultDialog, NamedOption } from './bulk-dialogs';
import { buildCustomColumns, contextTypes, formatFieldValue } from './custom-columns';
import { DevIndicatorView } from './dev-indicator';
import { FiltersPopover, PickedItem } from './filters-popover';
import { KanbanBoard } from './kanban-board';
import { activeChips, asList, FilterChip, FilterMap, stateFromParams, stateToParams, withoutChip } from './work-item-filters';
import { WorkItemForm, WorkItemFormData } from './work-item-form';
import { WorkItemListStore } from './work-item-list.store';
import { isItemOverdue, ltr } from './work-item-utils';
import { loadDefaultView, ViewMode, ViewsMenu, ViewState } from './views-menu';

const VIEW_KEY = 'ipm.workItems.view';
const TABLE_ID = 'work-items';
const ITEM_FILTER_KEYS = ['parentId', 'blockedBy', 'blocking'] as const;

function loadView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'kanban' ? 'kanban' : 'table';
  } catch {
    return 'table';
  }
}

@Component({
  selector: 'app-work-items-page',
  imports: [
    PageHeader, DataTable, ErrorState, Icon, KanbanBoard, TypeChip, StatusBadge, PriorityBadge, AvatarStack, AppDatePipe, UserNamesPipe,
    ViewsMenu, DevIndicatorView, FiltersPopover,
  ],
  providers: [WorkItemListStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './work-items-page.html',
  styleUrl: './work-items-page.scss',
})
export class WorkItemsPage {
  protected readonly store = inject(WorkItemListStore);
  protected readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly api = inject(WorkItemsApi);
  private readonly workflows = inject(WorkflowLookup);
  protected readonly projects = inject(ProjectLookup);
  protected readonly types = inject(WorkItemTypeLookup);
  protected readonly statusLookup = inject(StatusLookup);
  protected readonly users = inject(UserLookup);

  protected readonly ltr = ltr;
  protected readonly view = signal<ViewMode>(loadView());

  protected readonly workItemStatuses = computed(() =>
    this.statusLookup.items().filter((s) => s.scope === 'work-item' && s.active).sort((a, b) => a.order - b.order),
  );
  protected readonly activeUsers = computed(() => this.users.items().filter((u) => u.active));

  protected readonly selectedProjectId = computed(() => String(this.store.filters()['projectId'] ?? ''));
  protected readonly selectedProject = computed(() => this.projects.get(this.selectedProjectId()));
  protected readonly canCreate = computed(() => this.auth.canSomewhere('tasks.create'));

  /** Display text of picked parent / blocker items (id -> ref). */
  protected readonly itemLabels = signal<Readonly<Record<string, string>>>({});
  private readonly requestedLabels = new Set<string>();

  protected readonly chips = computed<readonly FilterChip[]>(() => activeChips(this.store.filters(), (key, value) => this.chipValue(key, value)));

  private readonly refCell = viewChild.required<TemplateRef<CellContext<WorkItem>>>('refCell');
  private readonly typeCell = viewChild.required<TemplateRef<CellContext<WorkItem>>>('typeCell');
  private readonly projectCell = viewChild.required<TemplateRef<CellContext<WorkItem>>>('projectCell');
  private readonly statusCell = viewChild.required<TemplateRef<CellContext<WorkItem>>>('statusCell');
  private readonly priorityCell = viewChild.required<TemplateRef<CellContext<WorkItem>>>('priorityCell');
  private readonly assigneesCell = viewChild.required<TemplateRef<CellContext<WorkItem>>>('assigneesCell');
  private readonly dueCell = viewChild.required<TemplateRef<CellContext<WorkItem>>>('dueCell');
  private readonly createdCell = viewChild.required<TemplateRef<CellContext<WorkItem>>>('createdCell');
  private readonly selectCell = viewChild.required<TemplateRef<CellContext<WorkItem>>>('selectCell');
  private readonly devCell = viewChild.required<TemplateRef<CellContext<WorkItem>>>('devCell');

  /** Types whose `showInList` fields become columns: the selected types, else the selected project's types. */
  private readonly customColumns = computed(() => {
    const selected = asList(this.store.filters()['typeId']);
    const projectTypes = this.selectedProject()?.allowedTypeIds ?? null;
    return buildCustomColumns(contextTypes(this.types.items(), selected, projectTypes));
  });

  protected readonly columns = computed<readonly ColumnDef<WorkItem>[]>(() => {
    const base: ColumnDef<WorkItem>[] = [
      { key: '_select', header: '', srHeader: 'تحديد', width: '56px', required: true, template: this.selectCell() },
      { key: 'ref', header: 'المرجع', sortable: true, width: '110px', template: this.refCell() },
      { key: 'typeId', header: 'النوع', sortable: true, template: this.typeCell(), hideOnMobile: true },
      { key: 'title', header: 'العنوان', sortable: true },
      { key: 'projectId', header: 'المشروع', template: this.projectCell(), hideOnMobile: true },
      { key: 'statusId', header: 'الحالة', sortable: true, template: this.statusCell() },
      { key: 'priority', header: 'الأولوية', sortable: true, template: this.priorityCell(), hideOnMobile: true },
      { key: 'assigneeIds', header: 'المكلّفون', template: this.assigneesCell(), hideOnMobile: true },
      { key: 'dueDate', header: 'الاستحقاق', sortable: true, template: this.dueCell() },
      { key: 'createdAt', header: 'تاريخ الإنشاء', sortable: true, template: this.createdCell(), hidden: true, hideOnMobile: true },
    ];
    const custom: ColumnDef<WorkItem>[] = this.customColumns().map((c) => ({
      key: c.key as `_${string}`,
      header: c.label,
      hideOnMobile: true,
      format: (row: WorkItem) => formatFieldValue(c.def, row.fields[c.def.key], (id) => this.users.nameOf(id)),
    }));
    return [...base, ...custom, { key: '_dev', header: 'التطوير', width: '120px', template: this.devCell(), hideOnMobile: true }];
  });

  // ---------- selection (bulk actions) ----------
  /** Selected items by id; the objects are kept so selection can span pages. */
  protected readonly selection = signal<ReadonlyMap<string, WorkItem>>(new Map());
  protected readonly selectedCount = computed(() => this.selection().size);
  protected readonly pageAllSelected = computed(() => this.store.items().length > 0 && this.store.items().every((i) => this.selection().has(i.id)));
  protected readonly bulkBusy = signal(false);
  /** Bumped to make the board reload after a change made on this page. */
  protected readonly boardRefresh = signal(0);

  protected readonly currentView = computed<ViewState>(() => {
    const q = this.store.query();
    return { filters: this.store.filters(), view: this.view(), ...(q.sort ? { sort: q.sort } : {}), ...(q.search ? { search: q.search } : {}) };
  });
  protected readonly userId = computed(() => this.auth.user()?.id ?? 'anonymous');

  private readonly search$ = new Subject<string>();
  private pendingCreate: string | null = null;
  private wantsCreate = false;

  constructor() {
    this.search$.pipe(debounceTime(300), takeUntilDestroyed()).subscribe((s) => this.store.setSearch(s));

    const params = this.route.snapshot.queryParamMap;
    const me = this.auth.user()?.id;
    const hasUrlState = params.keys.some((k) => k !== 'create');
    const fromUrl = stateFromParams((k) => params.get(k), me);
    if (hasUrlState) {
      this.applyState({ filters: fromUrl.filters, view: fromUrl.view ?? this.view(), ...(fromUrl.sort ? { sort: fromUrl.sort } : {}), search: fromUrl.search });
    } else {
      const saved = me ? loadDefaultView(me) : null;
      if (saved) this.applyState(saved);
    }
    if (params.get('create') === 'true') {
      this.wantsCreate = true;
      this.pendingCreate = params.get('projectId');
    }
    this.store.setPageSize(loadTablePrefs(TABLE_ID).pageSize ?? 10);

    // Mirror every filter, search, sort and the view mode to the URL (replaceUrl: no history entry per keystroke).
    effect(() => {
      const q = this.store.query();
      const view = this.view();
      const queryParams = stateToParams({ filters: this.store.filters(), search: q.search ?? '', ...(q.sort ? { sort: q.sort } : {}), view }, this.auth.user()?.id);
      untracked(() => void this.router.navigate([], { relativeTo: this.route, queryParams, replaceUrl: true }));
    });

    // Resolve refs of picked items (e.g. from a shared link) for the chips.
    effect(() => {
      const filters = this.store.filters();
      const ids = ITEM_FILTER_KEYS.map((k) => filters[k]).filter((v): v is string => typeof v === 'string' && !!v);
      untracked(() => {
        for (const id of ids) {
          if (this.itemLabels()[id] || this.requestedLabels.has(id)) continue;
          this.requestedLabels.add(id);
          this.api.getById(id).subscribe({ next: (w) => this.rememberItem({ id, ref: w.ref }), error: () => undefined });
        }
      });
    });

    // Keep selected objects fresh after a reload (version, status). Tracks only the list:
    // the selection is read untracked and written only when a selected item actually changed,
    // otherwise writing it would re-trigger this effect forever.
    effect(() => {
      const items = this.store.items();
      untracked(() => {
        const current = this.selection();
        const changed = items.filter((i) => current.has(i.id) && current.get(i.id)!.version !== i.version);
        if (!changed.length) return;
        const next = new Map(current);
        for (const i of changed) next.set(i.id, i);
        this.selection.set(next);
      });
    });

    // Open the create dialog once lookups are available (deep link `?create=true`).
    effect(() => {
      if (!this.wantsCreate || !this.projects.items().length || !this.types.items().length) return;
      this.wantsCreate = false;
      this.openCreate(this.pendingCreate ?? undefined);
    });
  }

  protected onSearch(event: Event): void {
    this.search$.next((event.target as HTMLInputElement).value);
  }

  protected setFilters(next: FilterMap): void {
    this.store.replaceFilters(next);
  }

  protected pickBoardProject(event: Event): void {
    const projectId = (event.target as HTMLSelectElement).value;
    this.store.replaceFilters(projectId ? { ...this.store.filters(), projectId } : this.store.filters());
  }

  protected removeChip(chip: FilterChip): void {
    this.store.replaceFilters(withoutChip(this.store.filters(), chip));
  }

  protected clearFilters(): void {
    this.store.replaceFilters({});
  }

  protected rememberItem(item: PickedItem): void {
    this.itemLabels.update((m) => ({ ...m, [item.id]: item.ref }));
  }

  private chipValue(key: string, value: string): string {
    switch (key) {
      case 'projectId':
        return ltr(this.projects.get(value)?.code ?? value);
      case 'typeId':
        return this.types.get(value)?.name ?? value;
      case 'statusId':
        return this.statusLookup.get(value)?.name ?? value;
      case 'priority':
        return PRIORITY_LABELS[value as Priority] ?? value;
      case 'assigneeIds':
        return this.users.nameOf(value);
      case 'parentId':
      case 'blockedBy':
      case 'blocking':
        return ltr(this.itemLabels()[value] ?? '…');
      default:
        return value;
    }
  }

  protected setView(mode: ViewMode): void {
    this.view.set(mode);
    try {
      localStorage.setItem(VIEW_KEY, mode);
    } catch {
      /* storage unavailable: the choice just is not persisted */
    }
  }

  protected overdue(item: WorkItem): boolean {
    return isItemOverdue(item, this.statusLookup);
  }

  protected open(item: WorkItem): void {
    void this.router.navigate(['/work-items', item.id]);
  }

  protected openCreate(projectId?: string): void {
    this.dialog
      .open<WorkItemForm, WorkItemFormData, WorkItem>(WorkItemForm, {
        data: { projectId: projectId ?? (this.selectedProjectId() || undefined) },
        width: 'min(760px, calc(100vw - 32px))',
      })
      .afterClosed.subscribe((item) => {
        if (!item) return;
        this.toast.success(`تم إنشاء ${ltr(item.ref)}`);
        this.store.reload();
        this.boardRefresh.update((n) => n + 1);
      });
  }

  protected isSelected(item: WorkItem): boolean {
    return this.selection().has(item.id);
  }

  protected toggleSelected(item: WorkItem): void {
    const next = new Map(this.selection());
    if (!next.delete(item.id)) next.set(item.id, item);
    this.selection.set(next);
  }

  protected togglePage(): void {
    const next = new Map(this.selection());
    if (this.pageAllSelected()) this.store.items().forEach((i) => next.delete(i.id));
    else this.store.items().forEach((i) => next.set(i.id, i));
    this.selection.set(next);
  }

  protected clearSelection(): void {
    this.selection.set(new Map());
  }

  protected applyView(state: ViewState): void {
    this.applyState(state);
    this.setView(state.view);
    this.clearSelection();
  }

  private applyState(state: ViewState): void {
    this.store.replaceFilters(state.filters as Readonly<Record<string, FilterValue>>);
    this.store.setSearch(state.search ?? '');
    this.store.setSort(state.sort);
    this.view.set(state.view);
  }

  protected bulk(kind: BulkAction['kind']): void {
    const items = [...this.selection().values()];
    if (!items.length) return;
    const memberIds = new Set<string>();
    for (const id of new Set(items.map((i) => i.projectId))) this.projects.get(id)?.members.forEach((m) => memberIds.add(m.userId));
    const users: NamedOption[] = this.activeUsers().filter((u) => memberIds.has(u.id)).map((u) => ({ id: u.id, name: u.name }));

    // Statuses that exist in every selected item's workflow.
    let common: ReadonlySet<string> | undefined;
    for (const item of items) {
      const ids = new Set(this.workflows.get(this.types.get(item.typeId)?.workflowId)?.statusIds ?? []);
      common = common ? new Set([...common].filter((id) => ids.has(id))) : ids;
    }
    const shared: ReadonlySet<string> = common ?? new Set<string>();
    const statuses: NamedOption[] = this.workItemStatuses().filter((s) => shared.has(s.id)).map((s) => ({ id: s.id, name: s.name }));

    this.dialog
      .open<BulkActionDialog, BulkActionData, BulkAction>(BulkActionDialog, {
        data: { kind, count: items.length, users, statuses },
        width: 'min(480px, calc(100vw - 32px))',
      })
      .afterClosed.subscribe((action) => {
        if (action) this.runBulk(items.map((i) => i.id), action);
      });
  }

  private runBulk(ids: readonly string[], action: BulkAction): void {
    this.bulkBusy.set(true);
    this.api.bulk({ ids, action }).subscribe({
      next: (results) => {
        this.bulkBusy.set(false);
        const failed = new Set(results.filter((r) => !r.ok).map((r) => r.id));
        // Failed items stay selected so the user can fix the cause and retry.
        const next = new Map<string, WorkItem>();
        for (const [id, item] of this.selection()) if (failed.has(id)) next.set(id, item);
        this.selection.set(next);
        this.reportBulk(results);
        this.store.reload();
        this.boardRefresh.update((n) => n + 1);
      },
      error: () => this.bulkBusy.set(false),
    });
  }

  private reportBulk(results: readonly BulkResult[]): void {
    const failed = results.filter((r) => !r.ok).length;
    const ok = results.length - failed;
    if (!failed) {
      this.toast.success(`تم تحديث ${ok} من ${results.length}`);
      return;
    }
    const show = (): void => {
      this.dialog.open<BulkResultDialog, readonly BulkResult[]>(BulkResultDialog, { data: results, width: 'min(520px, calc(100vw - 32px))' });
    };
    const message = `تم تحديث ${ok} من ${results.length} — ${failed} فشلت`;
    const options = { action: { label: 'عرض التفاصيل', run: show }, ttl: 10000 };
    if (ok) this.toast.info(message, options);
    else this.toast.error(message, options);
  }
}
