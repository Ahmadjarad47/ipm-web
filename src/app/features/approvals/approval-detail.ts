import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '@core/auth/auth.service';
import { PageTitle } from '@core/layout/title-strategy';
import { RecentItems } from '@core/layout/recent-items';
import { isApiError } from '@core/models/api-error.model';
import { ToastService } from '@core/notifications/toast.service';
import { ApprovalRequestsApi } from '@domain/approvals/approval.api';
import {
  APPROVER_POSITION_LABELS,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalStage,
  ApproverPosition,
  Decision,
  DECISION_LABELS,
} from '@domain/approvals/approval.models';
import { ProjectLookup } from '@domain/projects/project.api';
import { RoleLookup, UserLookup } from '@domain/users/user.api';
import { WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { PRIORITY_LABELS, Priority } from '@domain/work-items/work-item.models';
import { ApprovalStatusBadge } from '@shared/domain-ui/domain-ui';
import { CommentsPanel } from '@shared/domain-ui/comments-panel';
import { AppDatePipe, UserNamePipe } from '@shared/pipes/pipes';
import { Avatar } from '@shared/ui/avatar/avatar';
import { Badge } from '@shared/ui/badge/badge';
import { DialogService } from '@shared/ui/dialog/dialog.service';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { Icon } from '@shared/ui/icon/icon';
import { PageHeader } from '@shared/ui/page-header/page-header';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { ageText, diffRows, slaText } from './approval-logic';
import { DecisionDialog, DecisionDialogData } from './decision-dialog';
import { ReassignData, ReassignDialog } from './reassign-dialog';

type StageState = 'done' | 'active' | 'pending' | 'stopped';

interface StageView {
  readonly stage: ApprovalStage;
  readonly state: StageState;
  /** «المدير المباشر» / «الدور» / «المعتمد». */
  readonly kindLabel: string;
  /** Resolved people (positions and roles resolve to names). */
  readonly approver: string;
  readonly decision: ApprovalDecision | null;
}

const FIELD_LABELS: Readonly<Record<string, string>> = {
  name: 'الاسم',
  title: 'العنوان',
  description: 'الوصف',
  startDate: 'تاريخ البدء',
  endDate: 'تاريخ الانتهاء',
  dueDate: 'تاريخ الاستحقاق',
  ownerId: 'المالك',
  parentId: 'العنصر الأب',
  priority: 'الأولوية',
  typeId: 'النوع',
  assigneeIds: 'المكلَّفون',
};

const POSITION_NAMES: Record<ApproverPosition, string> = {
  project_owner: 'مالك المشروع',
  direct_manager: 'المدير المباشر',
  project_manager: 'مدير المشروع',
};

const STATE_LABELS: Record<StageState, string> = { done: 'تم', active: 'الحالية', pending: 'بانتظار', stopped: 'متوقفة' };

/** Approval request detail: stage stepper, frozen snapshot, proposed changes, decision panel (FR-APR-03..13). */
@Component({
  selector: 'app-approval-detail',
  imports: [FormsModule, RouterLink, PageHeader, ApprovalStatusBadge, EmptyState, ErrorState, Skeleton, Badge, Avatar, Icon, CommentsPanel, AppDatePipe, UserNamePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './approval-detail.html',
  styleUrl: './approval-detail.scss',
})
export class ApprovalDetail {
  readonly id = input.required<string>();

  private readonly api = inject(ApprovalRequestsApi);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly users = inject(UserLookup);
  private readonly roles = inject(RoleLookup);
  private readonly projects = inject(ProjectLookup);
  private readonly types = inject(WorkItemTypeLookup);
  private readonly dialog = inject(DialogService);
  private readonly pageTitle = inject(PageTitle);
  private readonly recent = inject(RecentItems);

  protected readonly resource = rxResource<ApprovalRequest, string>({
    params: () => this.id(),
    stream: ({ params }) => this.api.getById(params),
  });

  protected readonly request = computed(() => (this.resource.hasValue() ? this.resource.value() : null));
  protected readonly notFound = computed(() => {
    const err = this.resource.error();
    const cause = (err as { cause?: unknown } | undefined)?.cause ?? err;
    return isApiError(cause) && (cause.status === 404 || cause.status === 403);
  });

  constructor() {
    effect(() => {
      const r = this.request();
      if (!r) return;
      // Side effects on shared services run untracked: this effect must depend only on the request.
      untracked(() => {
        this.pageTitle.set(r.title);
        this.recent.add({ kind: 'approval', id: r.id, title: r.title, link: `/approvals/${r.id}` });
      });
    });
  }

  protected readonly canReassign = computed(() => {
    const r = this.request();
    return !!r && r.status === 'PendingApproval' && this.auth.can('approvals.configure', r.projectId);
  });

  protected readonly busy = signal(false);
  protected readonly comment = signal('');
  protected readonly remindMessage = signal('');
  protected readonly stateLabels = STATE_LABELS;

  protected readonly isRequester = computed(() => this.request()?.requesterId === this.auth.user()?.id);
  protected readonly isPending = computed(() => this.request()?.status === 'PendingApproval');
  protected readonly showDecisionPanel = computed(() => !!this.request()?.canDecide && !this.isRequester());
  protected readonly canRemind = computed(() => {
    const r = this.request();
    return !!r && r.status === 'PendingApproval' && (this.isRequester() || this.auth.can('approvals.configure', r.projectId));
  });
  protected readonly showResubmit = computed(() => {
    const status = this.request()?.status;
    return this.isRequester() && (status === 'Returned' || status === 'Superseded');
  });

  protected readonly subjectLink = computed(() => {
    const r = this.request();
    if (!r) return [];
    return [r.subjectType === 'project' ? '/projects' : '/work-items', r.subjectId];
  });

  protected readonly age = computed(() => {
    const r = this.request();
    return r ? ageText(r.createdAt) : '';
  });
  protected readonly sla = computed(() => {
    const r = this.request();
    return r ? slaText(r.stageDueAt, r.status === 'PendingApproval') : '';
  });

  protected readonly stages = computed<readonly StageView[]>(() => {
    const r = this.request();
    if (!r) return [];
    return [...r.stages]
      .sort((a, b) => a.order - b.order)
      .map((stage) => {
        const decision = [...r.decisions].reverse().find((d) => d.stageOrder === stage.order && d.revision === r.revision) ?? null;
        let state: StageState;
        if (decision) state = decision.decision === 'Approve' ? 'done' : 'stopped';
        else if (r.status === 'PendingApproval') state = stage.order === r.currentStage ? 'active' : 'pending';
        else state = r.status === 'Draft' ? 'pending' : 'stopped';
        return { stage, state, decision, ...this.approverView(r, stage) };
      });
  });

  protected readonly pastDecisions = computed(() => {
    const r = this.request();
    return r ? r.decisions.filter((d) => d.revision !== r.revision).sort((a, b) => a.at.localeCompare(b.at)) : [];
  });

  protected readonly snapshot = computed(() => {
    const r = this.request();
    if (!r) return [];
    return Object.entries(r.snapshot).map(([key, value]) => ({
      label: FIELD_LABELS[key] ?? key,
      // Snapshot values are frozen display values (names/refs at submit time), never re-resolved.
      value: value === null || value === '' ? '—' : String(value),
      known: key in FIELD_LABELS,
    }));
  });

  protected readonly proposed = computed(() => {
    const r = this.request();
    if (!r?.proposedChanges || !Object.keys(r.proposedChanges).length) return [];
    return diffRows(r.snapshot, r.proposedChanges, (f) => FIELD_LABELS[f] ?? f, (f, v, side) => this.displayValue(f, v, side));
  });

  protected selfDecided(d: ApprovalDecision): boolean {
    return d.deciderId === this.request()?.requesterId;
  }

  protected decisionLabel(d: Decision): string {
    return DECISION_LABELS[d];
  }

  protected stageIcon(state: StageState): string {
    return state === 'done' ? 'check' : state === 'stopped' ? 'close' : 'approval';
  }

  protected approve(): void {
    this.submitDecision('Approve', this.comment().trim());
  }

  protected openDecision(decision: 'Reject' | 'Return'): void {
    const r = this.request();
    if (!r || this.busy()) return;
    this.dialog
      .open<DecisionDialog, DecisionDialogData, string>(DecisionDialog, {
        data: { decision, requestTitle: r.title },
        width: 'min(520px, calc(100vw - 32px))',
      })
      .afterClosed.subscribe((comment) => {
        if (comment) this.submitDecision(decision, comment);
      });
  }

  private submitDecision(decision: Decision, comment: string): void {
    const r = this.request();
    if (!r || this.busy()) return;
    this.busy.set(true);
    this.api.decide(r.id, { decision, comment, revision: r.revision }).subscribe({
      next: () => {
        this.busy.set(false);
        this.comment.set('');
        this.toast.success(`تم تسجيل القرار: ${DECISION_LABELS[decision]}`);
        this.resource.reload();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        // 409 = stale revision: the interceptor already toasts the message; refresh to the latest revision.
        if (isApiError(err) && err.status === 409) this.resource.reload();
      },
    });
  }

  protected remind(): void {
    const r = this.request();
    if (!r || this.busy()) return;
    this.busy.set(true);
    this.remindMessage.set('');
    this.api.remind(r.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.toast.success('أُرسل تذكير إلى المعتمدين الحاليين');
        this.resource.reload();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        if (isApiError(err)) this.remindMessage.set(err.message);
      },
    });
  }

  protected resubmit(): void {
    const r = this.request();
    if (!r || this.busy()) return;
    this.busy.set(true);
    this.api.resubmit(r.id).subscribe({
      next: () => {
        this.busy.set(false);
        this.toast.success('أُعيد تقديم الطلب.');
        this.resource.reload();
      },
      error: () => this.busy.set(false),
    });
  }

  protected reassign(stage: ApprovalStage): void {
    const r = this.request();
    if (!r) return;
    this.dialog
      .open<ReassignDialog, ReassignData, boolean>(ReassignDialog, {
        data: { request: r, stageName: stage.name },
        width: 'min(500px, calc(100vw - 32px))',
      })
      .afterClosed.subscribe((done) => {
        if (!done) return;
        this.toast.success('تمت إعادة تعيين المعتمد');
        this.resource.reload();
      });
  }

  private displayValue(field: string, value: string | number | null | undefined, side: 'before' | 'after'): string {
    if (value === null || value === undefined || value === '') return '—';
    const text = String(value);
    switch (field) {
      // The frozen snapshot already holds the owner's name; a proposal holds the user id.
      case 'ownerId':
        return side === 'before' ? text : this.users.nameOf(text);
      case 'typeId':
        return this.types.get(text)?.name ?? text;
      case 'assigneeIds':
        return text.split(',').filter(Boolean).map((id) => this.users.nameOf(id)).join('، ') || '—';
      case 'priority':
        return PRIORITY_LABELS[text as Priority] ?? text;
      default:
        return text;
    }
  }

  private approverView(r: ApprovalRequest, stage: ApprovalStage): { kindLabel: string; approver: string } {
    if (stage.approverKind === 'user') return { kindLabel: 'المعتمد', approver: this.users.nameOf(stage.approverId) };
    if (stage.approverKind === 'role') return { kindLabel: 'الدور', approver: this.roles.get(stage.approverId)?.name ?? '—' };
    const position = stage.approverId as ApproverPosition;
    const kindLabel = POSITION_NAMES[position] ?? APPROVER_POSITION_LABELS[position] ?? 'منصب';
    const project = this.projects.get(r.projectId);
    // The server resolves positions once at submission and freezes them; prefer that over recomputing from live
    // data (which also needs `managerId`, hidden from users without `roles.manage`).
    const frozen = r.resolvedApprovers?.[stage.order];
    let ids: readonly string[] = frozen ?? [];
    if (frozen) {
      /* use the frozen list */
    } else if (position === 'project_owner') ids = project ? [project.ownerId] : [];
    else if (position === 'direct_manager') ids = [this.users.get(r.requesterId)?.managerId].filter((id): id is string => !!id);
    else {
      const pmRoles = this.roles.items().filter((x) => x.key === 'project_manager').map((x) => x.id);
      ids = project?.members.filter((m) => pmRoles.includes(m.roleId)).map((m) => m.userId) ?? [];
    }
    return { kindLabel, approver: ids.length ? ids.map((id) => this.users.nameOf(id)).join('، ') : 'لم يُحدَّد بعد' };
  }
}
