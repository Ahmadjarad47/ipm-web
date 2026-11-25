import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/notifications/toast.service';
import { ProjectSummary } from '@domain/projects/project.models';
import { UserLookup } from '@domain/users/user.api';
import { WorkItemsApi, WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { WorkItem } from '@domain/work-items/work-item.models';
import { Status } from '@domain/workflow/workflow.models';
import { StatusLookup, WorkflowLookup } from '@domain/workflow/workflow.api';
import { PriorityBadge, TypeChip } from '@shared/domain-ui/domain-ui';
import { AvatarStack } from '@shared/ui/avatar/avatar';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { AppDatePipe, UserNamesPipe } from '@shared/pipes/pipes';
import { ActionMenu, MenuEntry } from './action-menu';
import { DevIndicatorView } from './dev-indicator';
import { BoardCard, filterBoardItems, unionColumns } from './kanban-columns';
import { formatFieldValue } from './custom-columns';
import { FilterMap } from './work-item-filters';
import { ltr } from './work-item-utils';

interface CardField {
  readonly label: string;
  readonly text: string;
}

const todayIso = (): string => {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * Kanban board (FR-TSK-06). Loads every non-archived item of the project through `WorkItemsApi.board`,
 * so it is complete. Columns are the union of the statuses of the workflows actually in use (each item
 * carries its effective `workflowId`). Moves go through `WorkItemsApi.transition`; nothing is changed
 * locally, the board reloads after each attempt so a rejected move leaves the card where it was.
 */
@Component({
  selector: 'app-kanban-board',
  imports: [NgTemplateOutlet, RouterLink, TypeChip, PriorityBadge, AvatarStack, AppDatePipe, UserNamesPipe, DevIndicatorView, ActionMenu, Skeleton, ErrorState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './kanban-board.html',
  styleUrl: './kanban-board.scss',
})
export class KanbanBoard {
  private readonly api = inject(WorkItemsApi);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly types = inject(WorkItemTypeLookup);
  private readonly workflows = inject(WorkflowLookup);
  private readonly statuses = inject(StatusLookup);
  private readonly users = inject(UserLookup);

  readonly project = input.required<ProjectSummary>();
  /** List filters the complete board can honour client-side. */
  readonly filters = input<FilterMap>({});
  readonly search = input('');
  /** Change to force a reload (the owner created or bulk-edited items). */
  readonly refreshKey = input(0);

  protected readonly ltr = ltr;
  protected readonly dragging = signal<BoardCard | null>(null);
  protected readonly busyId = signal<string | null>(null);
  /** Screen-reader announcement of the last move result (aria-live). */
  protected readonly announcement = signal('');

  protected readonly board = rxResource({
    params: () => ({ projectId: this.project().id, refresh: this.refreshKey() }),
    stream: ({ params }) => this.api.board(params.projectId),
  });
  private readonly all = computed<readonly BoardCard[]>(() => this.board.value() ?? []);
  protected readonly items = computed(() => filterBoardItems(this.all(), this.filters(), this.search()));
  protected readonly failed = computed(() => !!this.board.error() && !this.board.hasValue());

  /** Workflows in use: those of the loaded items plus the effective one of each type the project allows. */
  protected readonly columns = computed<readonly Status[]>(() => {
    const ids = new Set(this.all().map((i) => i.workflowId));
    const project = this.project();
    for (const typeId of project.allowedTypeIds) {
      const id = project.workflowOverrides?.[typeId] ?? this.types.get(typeId)?.workflowId;
      if (id) ids.add(id);
    }
    return unionColumns(ids, (id) => this.workflows.get(id), (id) => this.statuses.get(id));
  });

  protected readonly byStatus = computed(() => {
    const map = new Map<string, BoardCard[]>();
    for (const item of this.items()) map.set(item.statusId, [...(map.get(item.statusId) ?? []), item]);
    return map;
  });

  /** Items whose status has no column (inactive or unmapped), so no card disappears. */
  protected readonly orphans = computed(() => {
    const ids = new Set(this.columns().map((c) => c.id));
    return this.items().filter((i) => !ids.has(i.statusId));
  });

  private readonly canMove = computed(() => this.auth.can('workflow.transition', this.project().id));

  /** Status ids each item may move to, by the effective workflow of that item. */
  protected readonly targets = computed(() => {
    const map = new Map<string, readonly string[]>();
    if (!this.canMove()) return map;
    for (const item of this.items()) map.set(item.id, this.allowedTargets(item, item.statusId));
    return map;
  });

  protected readonly menus = computed(() => {
    const map = new Map<string, readonly MenuEntry[]>();
    const inColumns = new Set(this.columns().map((c) => c.id));
    for (const item of this.items()) {
      map.set(
        item.id,
        (this.targets().get(item.id) ?? [])
          .filter((id) => inColumns.has(id))
          .map((id) => ({ key: id, label: this.statuses.get(id)?.name ?? '' })),
      );
    }
    return map;
  });

  private allowedTargets(item: BoardCard, fromStatusId: string): readonly string[] {
    return this.workflows
      .transitionsFrom(item.workflowId, fromStatusId)
      .filter((t) => !t.permission || this.auth.can(t.permission, this.project().id))
      .filter((t) => !t.requiresAssignee || item.assigneeIds.length > 0)
      .map((t) => t.toStatusId)
      .filter((id) => this.statuses.get(id)?.active);
  }

  protected cardFields(item: BoardCard): readonly CardField[] {
    const values = item.fields;
    if (!values) return [];
    return (this.types.get(item.typeId)?.fields ?? [])
      .filter((f) => f.showOnCard)
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .map((def) => ({ label: def.label, text: formatFieldValue(def, values[def.key], (id) => this.users.nameOf(id)) }));
  }

  protected isDropAllowed(statusId: string): boolean {
    const item = this.dragging();
    return !!item && (this.targets().get(item.id) ?? []).includes(statusId);
  }

  protected overdue(item: BoardCard): boolean {
    if (!item.dueDate) return false;
    const category = this.statuses.get(item.statusId)?.category;
    return category !== 'done' && category !== 'cancelled' && item.dueDate.slice(0, 10) < todayIso();
  }

  protected onDragStart(event: DragEvent, item: BoardCard): void {
    if (!this.canMove()) {
      event.preventDefault();
      return;
    }
    event.dataTransfer?.setData('text/plain', item.id);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    this.dragging.set(item);
  }

  protected onDragOver(event: DragEvent, statusId: string): void {
    if (this.isDropAllowed(statusId)) event.preventDefault();
  }

  protected onDrop(event: DragEvent, statusId: string): void {
    event.preventDefault();
    const item = this.dragging();
    this.dragging.set(null);
    if (item && item.statusId !== statusId) this.move(item, statusId);
  }

  protected move(item: BoardCard, statusId: string): void {
    if (this.busyId()) return;
    // Local pre-check against the item's workflow; the server remains the authority.
    if (!(this.targets().get(item.id) ?? []).includes(statusId)) {
      this.toast.info('هذا الانتقال غير متاح لهذا العمل.');
      return;
    }
    const fromId = item.statusId;
    const toName = this.statuses.get(statusId)?.name ?? '';
    this.busyId.set(item.id);
    this.api.transition(item.id, { toStatusId: statusId, version: item.version }).subscribe({
      next: (updated) => {
        this.busyId.set(null);
        this.announcement.set(`تم نقل ${item.ref} إلى ${toName}`);
        this.toast.undoable(`تم نقل ${ltr(item.ref)} إلى ${toName}`, () => this.undo(item, updated, fromId));
        this.board.reload();
      },
      // Rejection (422/403/409) is toasted by the interceptor; the card never moved.
      error: () => {
        this.busyId.set(null);
        this.announcement.set(`تعذّر نقل ${item.ref} إلى ${toName}`);
        this.board.reload();
      },
    });
  }

  /** Moves the item back when the workflow still allows it from where it is now. */
  private undo(item: BoardCard, current: WorkItem, backTo: string): void {
    if (!this.canMove() || !this.allowedTargets(item, current.statusId).includes(backTo)) {
      this.toast.info('لا يمكن التراجع: الانتقال العكسي غير متاح.');
      return;
    }
    const name = this.statuses.get(backTo)?.name ?? '';
    this.api.transition(item.id, { toStatusId: backTo, version: current.version }).subscribe({
      next: () => {
        this.announcement.set(`تم إرجاع ${item.ref} إلى ${name}`);
        this.board.reload();
      },
      error: () => this.board.reload(),
    });
  }
}
