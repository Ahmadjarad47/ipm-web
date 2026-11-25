import { environment } from '@env/environment';
import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, input, linkedSignal, signal, untracked, viewChild } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { RouterLink } from '@angular/router';
import { forkJoin, Observable } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { RecentItems } from '@core/layout/recent-items';
import { PageTitle } from '@core/layout/title-strategy';
import { UpdateDto } from '@core/models/entity.model';
import { ToastService } from '@core/notifications/toast.service';
import { ApprovalRequestsApi } from '@domain/approvals/approval.api';
import { APPROVER_POSITION_LABELS, ApprovalRequest, ApprovalStage, ApproverPosition } from '@domain/approvals/approval.models';
import { ProjectLookup } from '@domain/projects/project.api';
import { RoleLookup, UserLookup } from '@domain/users/user.api';
import { RelationsApi, WorkItemsApi, WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { Priority, PRIORITY_LABELS, WorkItem } from '@domain/work-items/work-item.models';
import { StatusLookup, WorkflowLookup } from '@domain/workflow/workflow.api';
import { Transition } from '@domain/workflow/workflow.models';
import { ActivityLog } from '@shared/domain-ui/activity-log';
import { AttachmentsPanel } from '@shared/domain-ui/attachments-panel';
import { CommentsPanel } from '@shared/domain-ui/comments-panel';
import { ApprovalStatusBadge, PriorityBadge, StatusBadge, TypeChip } from '@shared/domain-ui/domain-ui';
import { AppDatePipe, UserNamePipe, UserNamesPipe } from '@shared/pipes/pipes';
import { AvatarStack } from '@shared/ui/avatar/avatar';
import { Badge } from '@shared/ui/badge/badge';
import { DialogService } from '@shared/ui/dialog/dialog.service';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { Icon } from '@shared/ui/icon/icon';
import { Crumb, PageHeader } from '@shared/ui/page-header/page-header';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { TabItem, Tabs } from '@shared/ui/tabs/tabs';
import { ActionMenu, MenuEntry } from './action-menu';
import { AssigneePicker } from './assignee-picker';
import { CloseReopenData, CloseReopenDialog, CloseReopenResult } from './close-reopen-dialog';
import { formatFieldValue } from './custom-columns';
import { DevPanel } from './dev-panel';
import { HierarchyPanel } from './hierarchy-panel';
import { ItemGraphTab } from './item-graph-tab';
import { RequestApprovalData, RequestApprovalDialog } from './request-approval-dialog';
import { RelationsPanel } from './relations-panel';
import { StatusHistory } from './status-history';
import { TransitionDialog, TransitionDialogData } from './transition-dialog';
import { TypeChangeData, TypeChangeDialog } from './type-change-dialog';
import { WorkItemEditData, WorkItemEditDialog } from './work-item-edit-dialog';
import { asApiError, dateInputValue, isItemOverdue, ltr, PRIORITY_OPTIONS } from './work-item-utils';

type DetailTab = 'hierarchy' | 'relations' | 'history' | 'comments' | 'attachments' | 'graph' | 'activity';
type InlineField = 'priority' | 'assignees' | 'dueDate';

interface FieldRow {
  readonly label: string;
  readonly text: string;
}

interface ApprovalRow {
  readonly request: ApprovalRequest;
  /** «المرحلة 2 من 3» while the request is pending. */
  readonly stageText: string;
  readonly approverText: string;
}

@Component({
  selector: 'app-work-item-detail',
  imports: [
    RouterLink, PageHeader, EmptyState, ErrorState, Skeleton, Icon, Tabs, TypeChip, StatusBadge, PriorityBadge, AvatarStack, AppDatePipe, UserNamePipe,
    UserNamesPipe, CommentsPanel, ActivityLog, AttachmentsPanel, HierarchyPanel, RelationsPanel, StatusHistory, ItemGraphTab, DevPanel, ApprovalStatusBadge,
    ActionMenu, AssigneePicker, Badge,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './work-item-detail.html',
  styleUrl: './work-item-detail.scss',
})
export class WorkItemDetail {
  private readonly api = inject(WorkItemsApi);
  private readonly relationsApi = inject(RelationsApi);
  private readonly approvalsApi = inject(ApprovalRequestsApi);
  private readonly pageTitle = inject(PageTitle);
  private readonly recent = inject(RecentItems);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  private readonly toast = inject(ToastService);
  private readonly projects = inject(ProjectLookup);
  private readonly types = inject(WorkItemTypeLookup);
  private readonly statuses = inject(StatusLookup);
  private readonly workflows = inject(WorkflowLookup);
  private readonly users = inject(UserLookup);
  private readonly roles = inject(RoleLookup);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly id = input.required<string>();

  constructor() {
    effect(() => {
      const item = this.item();
      if (!item) return;
      this.pageTitle.set(`${item.ref} ${item.title}`);
      untracked(() => this.recent.add({ kind: 'workItem', id: item.id, title: item.title, code: item.ref, link: `/work-items/${item.id}`, typeId: item.typeId }));
    });
  }

  private readonly activity = viewChild(ActivityLog);

  protected readonly resource = rxResource({
    params: () => ({ id: this.id() }),
    stream: ({ params }) => this.api.getById(params.id),
  });
  protected readonly item = computed<WorkItem | undefined>(() => this.resource.value());
  protected readonly loadStatus = computed(() => {
    const err = this.resource.error();
    if (!err || this.item()) return null;
    const status = asApiError((err as { cause?: unknown }).cause ?? err)?.status;
    return status ?? 0;
  });
  protected readonly notFound = computed(() => this.loadStatus() === 404 || this.loadStatus() === 403);
  protected readonly failed = computed(() => this.loadStatus() !== null && !this.notFound());

  /** Resets to «التعليقات» when the page is reused for another work item (e.g. via the hierarchy panel). */
  protected readonly tab = linkedSignal<string, DetailTab>({ source: () => this.id(), computation: () => 'comments' });
  /** Bumped after a relation change so the graph tab reloads. */
  protected readonly graphRefresh = signal(0);
  protected readonly busy = signal(false);
  /** Last rejected status action (e.g. blocked by open dependencies); shown until the next attempt. */
  protected readonly statusError = signal('');

  protected readonly project = computed(() => this.projects.get(this.item()?.projectId));
  protected readonly type = computed(() => this.types.get(this.item()?.typeId));
  protected readonly priorityLabel = computed(() => PRIORITY_LABELS[this.item()?.priority ?? 'medium']);
  protected readonly priorities = PRIORITY_OPTIONS;
  protected readonly ltr = ltr;
  protected readonly dateInputValue = dateInputValue;
  protected readonly overdue = computed(() => {
    const item = this.item();
    return !!item && isItemOverdue(item, this.statuses);
  });

  protected readonly crumbs = computed<readonly Crumb[]>(() => {
    const item = this.item();
    if (!item) return [];
    return [
      { label: 'الأعمال', link: '/work-items' },
      { label: this.project()?.name ?? '—', link: ['/projects', item.projectId] },
      { label: item.ref },
    ];
  });

  protected readonly canEdit = computed(() => {
    const item = this.item();
    return !!item && (this.auth.can('tasks.edit', item.projectId) || this.auth.can('tasks.assign', item.projectId));
  });
  protected readonly canEditFields = computed(() => {
    const item = this.item();
    return !!item && !item.archived && this.auth.can('tasks.edit', item.projectId);
  });
  protected readonly canAssign = computed(() => {
    const item = this.item();
    return !!item && !item.archived && this.auth.can('tasks.assign', item.projectId);
  });
  protected readonly canChangeType = computed(() => {
    const item = this.item();
    return !!item && this.auth.can('workitem.types.manage', item.projectId);
  });
  protected readonly canViewRelations = computed(() => {
    const item = this.item();
    return !!item && this.auth.can('workitem.relations.view', item.projectId);
  });
  protected readonly canViewGit = computed(() => {
    const item = this.item();
    return !!item && this.auth.can('git.view', item.projectId);
  });

  // ---------- counts for the tab labels ----------
  private readonly childCount = rxResource({
    params: () => (this.item() ? { id: this.item()!.id, version: this.item()!.version } : undefined),
    stream: ({ params }) => this.api.list({ page: 1, pageSize: 1, filters: { parentId: params.id } }),
  });
  private readonly relationCount = rxResource({
    params: () => (this.item() && this.canViewRelations() ? { id: this.item()!.id, refresh: this.graphRefresh() } : undefined),
    stream: ({ params }) => this.relationsApi.forWorkItem(params.id),
  });

  protected readonly tabs = computed<readonly TabItem<DetailTab>[]>(() => {
    const all: TabItem<DetailTab>[] = [
      { key: 'hierarchy', label: 'التسلسل الهرمي', count: this.childCount.value()?.total ?? 0 },
      ...(this.canViewRelations() ? [{ key: 'relations' as const, label: 'العلاقات', count: this.relationCount.value()?.length ?? 0 }] : []),
      { key: 'history', label: 'سجل الحالة' },
      { key: 'comments', label: 'التعليقات' },
      ...(environment.features.attachments ? [{ key: 'attachments' as const, label: 'المرفقات' }] : []),
      ...(this.canViewRelations() ? [{ key: 'graph' as const, label: 'المخطط' }] : []),
      { key: 'activity', label: 'النشاط' },
    ];
    return all;
  });

  // ---------- workflow ----------
  private readonly category = computed(() => this.statuses.get(this.item()?.statusId)?.category);
  protected readonly isClosed = computed(() => this.category() === 'done' || this.category() === 'cancelled');

  /** Transitions leaving the current status in this item's workflow (FR-WF-04), if the user may transition. */
  protected readonly transitions = computed<readonly (Transition & { readonly name: string })[]>(() => {
    const item = this.item();
    if (!item || item.archived || !this.auth.can('workflow.transition', item.projectId)) return [];
    return this.workflows
      .transitionsFrom(this.type()?.workflowId, item.statusId)
      .filter((t) => this.statuses.get(t.toStatusId)?.active)
      .filter((t) => !t.permission || this.auth.can(t.permission, item.projectId))
      .filter((t) => !t.requiresAssignee || item.assigneeIds.length > 0)
      .map((t) => ({ ...t, name: this.statuses.get(t.toStatusId)?.name ?? '' }));
  });

  protected readonly statusMenu = computed<readonly MenuEntry[]>(() =>
    this.transitions().map((t) => ({ key: t.toStatusId, label: t.name, ...(t.requiresApproval ? { hint: 'يتطلب موافقة' } : {}) })),
  );
  private readonly closeTargets = computed(() => this.transitions().filter((t) => this.statuses.get(t.toStatusId)?.category === 'done'));
  private readonly reopenTargets = computed(() =>
    this.transitions().filter((t) => {
      const c = this.statuses.get(t.toStatusId)?.category;
      return c !== 'done' && c !== 'cancelled';
    }),
  );
  protected readonly canClose = computed(() => !this.isClosed() && this.closeTargets().length > 0);
  protected readonly canReopen = computed(() => this.isClosed() && this.reopenTargets().length > 0);
  protected readonly closeNeedsApproval = computed(() => this.closeTargets().some((t) => t.requiresApproval));

  /** Custom field values formatted per field type (FR-TYP-11). */
  protected readonly fieldRows = computed<readonly FieldRow[]>(() => {
    const item = this.item();
    return (this.type()?.fields ?? []).map((def) => ({ label: def.label, text: formatFieldValue(def, item?.fields[def.key], (id) => this.users.nameOf(id)) }));
  });

  // ---------- approvals ----------
  /** Approval requests about this item, merged from the three boxes (FR-APR-13). */
  private readonly approvals = rxResource({
    params: () => (this.item() ? { id: this.item()?.id ?? '' } : undefined),
    stream: () => {
      const q = { page: 1, pageSize: 20 };
      return forkJoin([this.approvalsApi.listBox('sent', q), this.approvalsApi.listBox('inbox', q), this.approvalsApi.listBox('closed', q)]);
    },
  });
  protected readonly itemApprovals = computed<readonly ApprovalRequest[]>(() => {
    const id = this.item()?.id;
    const seen = new Map<string, ApprovalRequest>();
    for (const page of this.approvals.value() ?? []) for (const r of page.items) if (r.subjectId === id) seen.set(r.id, r);
    return [...seen.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });
  protected readonly approvalRows = computed<readonly ApprovalRow[]>(() =>
    this.itemApprovals().map((request) => {
      const stage = request.stages?.find((s) => s.order === request.currentStage);
      const pending = request.status === 'pending-approval' && !!stage;
      return {
        request,
        stageText: pending ? `المرحلة ${request.currentStage} من ${request.stages.length}` : '',
        approverText: pending && stage ? `بانتظار: ${this.approverName(stage)}` : '',
      };
    }),
  );
  protected readonly hasApproved = computed(() => this.itemApprovals().some((r) => r.status === 'approved'));
  protected readonly canRequestApproval = computed(() => {
    const item = this.item();
    return !!item && this.auth.can('approvals.request', item.projectId);
  });

  private approverName(stage: ApprovalStage): string {
    switch (stage.approverKind) {
      case 'user':
        return this.users.nameOf(stage.approverId);
      case 'role':
        return this.roles.get(stage.approverId)?.name ?? stage.name;
      default:
        return APPROVER_POSITION_LABELS[stage.approverId as ApproverPosition] ?? stage.name;
    }
  }

  protected refresh(): void {
    this.resource.reload();
    this.approvals.reload();
    this.activity()?.reload();
  }

  protected relationsChanged(): void {
    this.graphRefresh.update((n) => n + 1);
    this.refresh();
  }

  protected copy(text: string, what: string): void {
    const clipboard = navigator.clipboard as Clipboard | undefined;
    if (!clipboard) {
      this.toast.error('النسخ غير متاح في هذا المتصفح.');
      return;
    }
    clipboard.writeText(text).then(
      () => this.toast.success(`تم نسخ ${what}`),
      () => this.toast.error('تعذّر النسخ.'),
    );
  }

  protected copyLink(item: WorkItem): void {
    this.copy(`${location.origin}/work-items/${item.id}`, 'الرابط');
  }

  protected requestApproval(): void {
    const item = this.item();
    if (!item) return;
    this.dialog
      .open<RequestApprovalDialog, RequestApprovalData, ApprovalRequest>(RequestApprovalDialog, {
        data: { itemId: item.id, ref: item.ref },
        width: 'min(480px, calc(100vw - 32px))',
      })
      .afterClosed.subscribe((request) => {
        if (!request) return;
        this.toast.success('تم إرسال طلب الموافقة');
        this.approvals.reload();
      });
  }

  // ---------- status actions ----------
  protected pickTransition(toStatusId: string): void {
    const t = this.transitions().find((x) => x.toStatusId === toStatusId);
    if (t) this.transition(t);
  }

  protected transition(t: Transition & { readonly name: string }): void {
    const item = this.item();
    if (!item) return;
    // Gated transition: needs an approved request first; otherwise offer to request one.
    if (t.requiresApproval && !this.hasApproved()) {
      this.requestApproval();
      return;
    }
    this.dialog
      .open<TransitionDialog, TransitionDialogData, string>(TransitionDialog, {
        data: { ref: item.ref, fromName: this.statuses.get(item.statusId)?.name ?? '—', toName: t.name },
        width: 'min(460px, calc(100vw - 32px))',
      })
      .afterClosed.subscribe((comment) => {
        if (comment === undefined) return;
        this.runStatus(this.api.transition(item.id, { toStatusId: t.toStatusId, version: item.version, ...(comment ? { comment } : {}) }), 'تم تغيير الحالة');
      });
  }

  protected close(): void {
    if (this.closeNeedsApproval() && !this.hasApproved()) {
      this.requestApproval();
      return;
    }
    this.openCloseReopen('close', false, '');
  }

  protected reopen(): void {
    this.openCloseReopen('reopen', false, '');
  }

  private openCloseReopen(mode: CloseReopenData['mode'], mustChoose: boolean, comment: string): void {
    const item = this.item();
    if (!item) return;
    const choices = (mode === 'close' ? this.closeTargets() : this.reopenTargets()).map((t) => ({ id: t.toStatusId, name: t.name }));
    this.dialog
      .open<CloseReopenDialog, CloseReopenData, CloseReopenResult>(CloseReopenDialog, {
        data: { mode, ref: item.ref, choices, mustChoose, initialComment: comment },
        width: 'min(480px, calc(100vw - 32px))',
      })
      .afterClosed.subscribe((result) => {
        if (!result) return;
        const toStatusId = result.toStatusId ? { toStatusId: result.toStatusId } : {};
        const request$ =
          mode === 'close'
            ? this.api.close(item.id, { version: item.version, ...(result.comment ? { comment: result.comment } : {}), ...toStatusId })
            : this.api.reopen(item.id, { version: item.version, comment: result.comment, ...toStatusId });
        // 400 on `toStatusId` = several valid targets and none chosen: ask again with the choice made mandatory.
        this.runStatus(request$, mode === 'close' ? 'تم إغلاق العمل' : 'تمت إعادة فتح العمل', (e) => {
          if (e.status === 400 && e.details?.['toStatusId']) {
            this.openCloseReopen(mode, true, result.comment);
            return true;
          }
          return false;
        });
      });
  }

  private runStatus(request$: Observable<WorkItem>, success: string, handled?: (e: NonNullable<ReturnType<typeof asApiError>>) => boolean): void {
    this.busy.set(true);
    this.statusError.set('');
    request$.subscribe({
      next: () => {
        this.busy.set(false);
        this.toast.success(success);
        this.refresh();
      },
      error: (e: unknown) => {
        this.busy.set(false);
        const err = asApiError(e);
        if (!err || handled?.(err)) return;
        if (err.status === 409) this.refresh();
        else this.statusError.set(err.message);
      },
    });
  }

  // ---------- inline edit (sidebar) ----------
  protected readonly editing = signal<InlineField | null>(null);
  protected readonly draftAssignees = signal<readonly string[]>([]);
  protected readonly savingInline = signal(false);
  protected readonly memberIds = computed(() => {
    const item = this.item();
    if (!item) return [];
    const members = (this.project()?.members ?? []).map((m) => m.userId);
    return [...new Set([...members, ...item.assigneeIds])];
  });

  protected startEdit(field: InlineField): void {
    const item = this.item();
    if (!item) return;
    if (field === 'assignees') this.draftAssignees.set(item.assigneeIds);
    this.editing.set(field);
    setTimeout(() => this.host.nativeElement.querySelector<HTMLElement>('[data-inline-focus]')?.focus());
  }

  protected cancelEdit(): void {
    this.editing.set(null);
  }

  /** Enter saves, Escape cancels (Escape must not reach the dialog/shell shortcuts). */
  protected onInlineKey(event: KeyboardEvent, field: InlineField): void {
    if (event.key === 'Escape') {
      event.stopPropagation();
      this.cancelEdit();
    } else if (event.key === 'Enter' && field !== 'assignees') {
      event.preventDefault();
      this.commit(field, (event.target as HTMLInputElement | HTMLSelectElement).value);
    }
  }

  protected onInlineBlur(field: InlineField, event: Event): void {
    this.commit(field, (event.target as HTMLInputElement | HTMLSelectElement).value);
  }

  /** Blur of the assignee group saves only when focus actually left it. */
  protected onAssigneesFocusOut(event: FocusEvent): void {
    const group = event.currentTarget as HTMLElement;
    if (event.relatedTarget instanceof Node && group.contains(event.relatedTarget)) return;
    this.commit('assignees', this.draftAssignees());
  }

  protected saveAssignees(): void {
    this.commit('assignees', this.draftAssignees());
  }

  private commit(field: InlineField, value: string | readonly string[]): void {
    const item = this.item();
    if (!item || this.editing() !== field) return;
    this.editing.set(null);
    let changes: Partial<UpdateDto<WorkItem>>;
    switch (field) {
      case 'priority':
        if (value === item.priority) return;
        changes = { priority: value as Priority };
        break;
      case 'dueDate': {
        const next = (value as string) || null;
        if (next === (dateInputValue(item.dueDate) || null)) return;
        changes = { dueDate: next };
        break;
      }
      case 'assignees': {
        const next = value as readonly string[];
        if (JSON.stringify([...next].sort()) === JSON.stringify([...item.assigneeIds].sort())) return;
        changes = { assigneeIds: next };
        break;
      }
    }
    this.savingInline.set(true);
    this.api.update(item.id, { ...changes, version: item.version }).subscribe({
      next: () => {
        this.savingInline.set(false);
        this.toast.success('تم الحفظ');
        this.refresh();
      },
      error: (e: unknown) => {
        this.savingInline.set(false);
        const err = asApiError(e);
        if (err?.status === 409) {
          this.toast.info('تم تعديل العمل من مستخدم آخر. جارٍ تحديث البيانات.');
          this.refresh();
        } else if (err?.details?.['code'] === 'approval_required') {
          this.toast.info('هذا الحقل محمي ويتطلب طلب تعديل حساس. استخدم زر «تعديل».');
        }
      },
    });
  }

  protected edit(): void {
    const item = this.item();
    if (!item) return;
    this.dialog
      .open<WorkItemEditDialog, WorkItemEditData, WorkItem>(WorkItemEditDialog, { data: { item }, width: 'min(720px, calc(100vw - 32px))' })
      .afterClosed.subscribe((updated) => {
        if (updated) this.refresh();
      });
  }

  protected changeType(): void {
    const item = this.item();
    if (!item) return;
    this.dialog
      .open<TypeChangeDialog, TypeChangeData, WorkItem>(TypeChangeDialog, { data: { item }, width: 'min(520px, calc(100vw - 32px))' })
      .afterClosed.subscribe((updated) => {
        if (updated) this.refresh();
      });
  }
}

