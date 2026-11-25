import { environment } from '@env/environment';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { of } from 'rxjs';
import { CanDirective } from '@core/auth/can.directive';
import { AuthService } from '@core/auth/auth.service';
import { RecentItems } from '@core/layout/recent-items';
import { PageTitle } from '@core/layout/title-strategy';
import { isApiError } from '@core/models/api-error.model';
import { ToastService } from '@core/notifications/toast.service';
import { ApprovalRequestsApi } from '@domain/approvals/approval.api';
import { ApprovalRequest } from '@domain/approvals/approval.models';
import { AttachmentsApi } from '@domain/attachments/attachment.api';
import { Attachment } from '@domain/attachments/attachment.models';
import { ProjectLookup, ProjectsApi } from '@domain/projects/project.api';
import { ProjectSummary } from '@domain/projects/project.models';
import { StatusLookup, WorkflowLookup } from '@domain/workflow/workflow.api';
import { StatusBadge } from '@shared/domain-ui/domain-ui';
import { ActivityLog } from '@shared/domain-ui/activity-log';
import { AttachmentsPanel } from '@shared/domain-ui/attachments-panel';
import { CommentsPanel } from '@shared/domain-ui/comments-panel';
import { AppDatePipe, UserNamePipe } from '@shared/pipes/pipes';
import { Badge } from '@shared/ui/badge/badge';
import { ConfirmService } from '@shared/ui/dialog/confirm-dialog';
import { DialogService } from '@shared/ui/dialog/dialog.service';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { ErrorState } from '@shared/ui/error-state/error-state';
import { HelpTip } from '@shared/ui/help-tip/help-tip';
import { KpiCard } from '@shared/ui/kpi-card/kpi-card';
import { PageHeader } from '@shared/ui/page-header/page-header';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { TabItem, Tabs } from '@shared/ui/tabs/tabs';
import { TransitionDialog, TransitionDialogData } from './transition-dialog';
import { ProjectForm, ProjectFormData } from '../project-form/project-form';
import { ProjectProgress } from '../project-progress';
import { DecisionDialog, DecisionDialogData } from '../../approvals/decision-dialog';
import { ActionsMenu, MenuAction } from './actions-menu';
import { ApprovalRequestDialog, ApprovalRequestData } from './approval-request-dialog';
import { fetchProjectApprovals } from './project-approvals-source';
import { ProjectStatusHistory } from './project-status-history';
import { ProjectApprovalsTab } from './tabs/project-approvals-tab';
import { ProjectGraphTab } from './tabs/project-graph-tab';
import { ProjectSettingsTab } from './tabs/project-settings-tab';
import { ProjectGitTab } from './tabs/project-git-tab';
import { ProjectMembersTab } from './tabs/project-members-tab';
import { ProjectWorkItemsTab } from './tabs/project-work-items-tab';

type DetailTab = 'items' | 'graph' | 'members' | 'attachments' | 'git' | 'approvals' | 'comments' | 'activity' | 'settings';

const PROGRESS_HELP = 'تُحتسب الأعمال الطرفية فقط (التي لا أبناء لها) فلا يتكرر العدّ بين الأب وأبنائه. تُستثنى الملغاة والمؤرشفة، والموافقة لا تعني الإنجاز.';

@Component({
  selector: 'app-project-detail',
  imports: [
    CanDirective, PageHeader, EmptyState, ErrorState, Skeleton, HelpTip, StatusBadge, Badge, KpiCard, Tabs, ProjectProgress, AppDatePipe, UserNamePipe, RouterLink,
    ActionsMenu, ProjectStatusHistory,
    ProjectWorkItemsTab, ProjectGraphTab, ProjectSettingsTab, AttachmentsPanel, ProjectMembersTab, ProjectGitTab, ProjectApprovalsTab, CommentsPanel, ActivityLog,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-detail.html',
  styleUrl: './project-detail.scss',
})
export class ProjectDetail {
  /** Bound from the `:id` route param (withComponentInputBinding). */
  readonly id = input.required<string>();
  /** Bound from `?tab=`; unknown values fall back to the first tab. */
  readonly tab = input<string | undefined>(undefined);

  private readonly api = inject(ProjectsApi);
  private readonly projectLookup = inject(ProjectLookup);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(DialogService);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly pageTitle = inject(PageTitle);
  private readonly recent = inject(RecentItems);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly workflows = inject(WorkflowLookup);
  private readonly statuses = inject(StatusLookup);
  private readonly attachmentsApi = inject(AttachmentsApi);
  private readonly approvalsApi = inject(ApprovalRequestsApi);

  protected readonly progressHelp = PROGRESS_HELP;

  constructor() {
    effect(() => {
      const p = this.project();
      if (!p) return;
      this.pageTitle.set(p.name);
      untracked(() => this.recent.add({ kind: 'project', id: p.id, title: p.name, code: p.code, link: `/projects/${p.id}` }));
    });
  }

  protected readonly resource = rxResource<ProjectSummary, string>({
    params: () => this.id(),
    stream: ({ params }) => this.api.getById(params),
  });

  protected readonly project = computed(() => this.resource.value());
  protected readonly notFound = computed(() => {
    const err = this.resource.error();
    if (!err) return false;
    const cause = (err as { cause?: unknown }).cause ?? err;
    // 403 is shown as "not found" too, so a hidden project never leaks its existence.
    return isApiError(cause) && (cause.status === 404 || cause.status === 403);
  });

  protected readonly busy = signal(false);
  protected readonly approvalsKey = signal(0);

  /** Tab counts: attachments and pending approvals are fetched lazily and refreshed with the project. */
  private readonly attachments = rxResource<readonly Attachment[], string | null>({
    params: () => (this.auth.can('files.download', this.id()) ? this.id() : null),
    stream: ({ params }) => (params && environment.features.attachments ? this.attachmentsApi.forSubject('project', params) : of([])),
    defaultValue: [],
  });
  private readonly approvals = rxResource<readonly ApprovalRequest[], { id: string; key: number }>({
    params: () => ({ id: this.id(), key: this.approvalsKey() }),
    stream: ({ params }) => fetchProjectApprovals(this.approvalsApi, params.id),
    defaultValue: [],
  });

  protected readonly tabs = computed<readonly TabItem<DetailTab>[]>(() => {
    const p = this.project();
    const id = this.id();
    const attachmentCount = this.attachments.hasValue() ? this.attachments.value().length : null;
    const pending = this.approvals.hasValue() ? this.approvals.value().filter((r) => r.status === 'pending-approval').length : null;
    const tabs: TabItem<DetailTab>[] = [{ key: 'items', label: 'الأعمال', count: p?.workItemCount ?? null }];
    if (this.auth.can('workitem.relations.view', id)) tabs.push({ key: 'graph', label: 'المخطط' });
    tabs.push({ key: 'members', label: 'الأعضاء', count: p?.members.length ?? null });
    if (environment.features.attachments && this.auth.can('files.download', id)) tabs.push({ key: 'attachments', label: 'المرفقات', count: attachmentCount });
    if (this.auth.can('git.view', id)) tabs.push({ key: 'git', label: 'Git' });
    tabs.push(
      { key: 'approvals', label: 'الموافقات', count: pending },
      { key: 'comments', label: 'التعليقات' },
      { key: 'activity', label: 'السجل' },
    );
    if (this.auth.can('project.workitemtypes.configure', id)) tabs.push({ key: 'settings', label: 'الإعدادات' });
    return tabs;
  });

  protected readonly active = computed<DetailTab>(() => {
    const wanted = this.tab();
    return this.tabs().find((t) => t.key === wanted)?.key ?? 'items';
  });

  /** Workflow transitions leaving the current status (§4.3: status never changes by editing). */
  /** An approved request that no move has spent yet: the next move that needs an approval uses it. */
  protected readonly hasApprovedRequest = computed(() => this.approvals.hasValue() && this.approvals.value().some((r) => r.status === 'approved' && !r.consumedAt));

  /** A request still waiting for a decision on this project, and the one the caller may decide right now. */
  protected readonly hasPendingRequest = computed(() => this.approvals.hasValue() && this.approvals.value().some((r) => r.status === 'pending-approval'));
  protected readonly decidableRequest = computed(() => (this.approvals.hasValue() ? this.approvals.value().find((r) => r.status === 'pending-approval' && r.canDecide) : undefined) ?? null);

  /** Approving activates the project and rejecting cancels it: the server moves the status (no manual move). */
  protected approvePending(): void {
    this.decide('approve', '');
  }

  protected rejectPending(): void {
    const r = this.decidableRequest();
    if (!r || this.busy()) return;
    this.dialog
      .open<DecisionDialog, DecisionDialogData, string>(DecisionDialog, { data: { decision: 'reject', requestTitle: r.title }, width: 'min(520px, calc(100vw - 32px))' })
      .afterClosed.subscribe((comment) => {
        if (comment) this.decide('reject', comment);
      });
  }

  private decide(decision: 'approve' | 'reject', comment: string): void {
    const r = this.decidableRequest();
    if (!r || this.busy()) return;
    this.busy.set(true);
    this.approvalsApi.decide(r.id, { decision, comment, revision: r.revision }).subscribe({
      next: () => {
        this.busy.set(false);
        this.toast.success(decision === 'approve' ? 'تمت الموافقة، وأصبح المشروع نشطًا' : 'تم الرفض، وأُلغي المشروع');
        this.approvalsKey.update((k) => k + 1);
        this.refresh();
      },
      error: (err: unknown) => {
        this.busy.set(false);
        if (isApiError(err) && err.status === 409) {
          this.approvalsKey.update((k) => k + 1);
          this.refresh();
        }
      },
    });
  }

  protected readonly transitions = computed(() => {
    const p = this.project();
    if (!p) return [];
    return this.workflows.transitionsFrom(this.workflows.projectWorkflow()?.id, p.statusId).map((t) => ({
      toStatusId: t.toStatusId,
      name: this.statuses.get(t.toStatusId)?.name ?? '—',
      requiresApproval: !!t.requiresApproval,
      /** Ready to run now: it needs no approval, or an approved request is waiting to be spent. */
      ready: !t.requiresApproval || this.hasApprovedRequest(),
    }));
  });

  /**
   * Moves the user makes by hand (on hold, completed, back to active…). Leaving «قيد الإعداد» for active or cancelled is not one of them:
   * the approval decision makes that move by itself.
   */
  protected readonly manualTransitions = computed(() => {
    const p = this.project();
    if (!p) return [];
    const waiting = this.statuses.get(p.statusId)?.category === 'not-started';
    return this.transitions().filter((t) => {
      const target = this.statuses.get(t.toStatusId)?.category;
      return !(waiting && (target === 'active' || target === 'cancelled'));
    });
  });

  /**
   * An approval granted before moves became automatic (or whose automatic move could not run) leaves the project waiting: this is the way out,
   * spending the approved request on the move to the active status.
   */
  protected readonly activation = computed(() => {
    const p = this.project();
    if (!p || p.archived || !this.hasApprovedRequest() || this.statuses.get(p.statusId)?.category !== 'not-started') return null;
    return this.transitions().find((t) => this.statuses.get(t.toStatusId)?.category === 'active') ?? null;
  });

  /** Approval actions, manual moves, editing and archiving all live in the «المزيد» menu. */
  protected readonly menuActions = computed<readonly MenuAction[]>(() => {
    const p = this.project();
    if (!p) return [];
    const items: MenuAction[] = [];
    const canEdit = !p.archived && this.auth.can('projects.edit', p.id);
    if (this.decidableRequest()) {
      items.push({ key: 'approve', label: 'موافقة', icon: 'check' }, { key: 'reject', label: 'رفض', icon: 'close', danger: true });
    } else if (!this.hasApprovedRequest() && !this.hasPendingRequest() && this.auth.can('approvals.request', p.id)) {
      items.push({ key: 'request-approval', label: 'طلب موافقة', icon: 'approval' });
    }
    const activation = this.activation();
    if (canEdit && activation) items.push({ key: 'activate', label: 'تفعيل المشروع (تمت الموافقة)', icon: 'check' });
    if (canEdit) for (const t of this.manualTransitions()) items.push({ key: 't:' + t.toStatusId, label: 'نقل إلى «' + t.name + '»', icon: 'flow' });
    if (canEdit) {
      items.push({ key: 'edit', label: 'تعديل المشروع', icon: 'edit' });
    }
    if (this.auth.can('projects.archive', p.id)) {
      items.push({ key: 'archive', label: p.archived ? 'إلغاء الأرشفة' : 'أرشفة المشروع', icon: 'archive', danger: !p.archived });
    }
    return items;
  });

  protected readonly crumbs = computed(() => [
    { label: 'الرئيسية', link: '/dashboard' },
    { label: 'المشاريع', link: '/projects' },
    { label: this.project()?.name ?? '…' },
  ]);

  protected setTab(key: DetailTab): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { tab: key === 'items' ? null : key }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  protected refresh(): void {
    this.resource.reload();
    this.projectLookup.reload();
    this.attachments.reload();
  }

  protected onMenu(project: ProjectSummary, key: string): void {
    if (key === 'edit') this.edit(project);
    else if (key === 'archive') this.toggleArchive(project);
    else if (key === 'approve') this.approvePending();
    else if (key === 'reject') this.rejectPending();
    else if (key === 'request-approval') this.requestApproval(project);
    else if (key === 'activate') {
      const a = this.activation();
      if (a) this.transition(project, a);
    }
    else if (key.startsWith('t:')) {
      const t = this.transitions().find((x) => x.toStatusId === key.slice(2));
      if (t) this.transition(project, t);
    }
  }

  protected edit(project: ProjectSummary): void {
    this.dialog
      .open<ProjectForm, ProjectFormData, ProjectSummary>(ProjectForm, { data: { project }, width: 'min(680px, calc(100vw - 32px))' })
      .afterClosed.subscribe((saved) => {
        if (saved) this.toast.success('تم حفظ التعديلات');
        this.refresh();
      });
  }

  protected toggleArchive(project: ProjectSummary): void {
    const archiving = !project.archived;
    this.confirm
      .confirm({
        title: archiving ? 'أرشفة المشروع' : 'إلغاء أرشفة المشروع',
        message: archiving
          ? `سيصبح المشروع «${project.name}» للقراءة فقط. يمكنك إلغاء الأرشفة لاحقًا.`
          : `سيعود المشروع «${project.name}» إلى القائمة النشطة.`,
        confirmText: archiving ? 'أرشفة' : 'إلغاء الأرشفة',
        danger: archiving,
      })
      .subscribe((ok) => {
        if (!ok) return;
        this.busy.set(true);
        this.api.setArchived(project.id, archiving, project.version).subscribe({
          next: () => {
            this.busy.set(false);
            this.toast.success(archiving ? 'تمت أرشفة المشروع' : 'تم إلغاء أرشفة المشروع');
            this.refresh();
          },
          error: (err: unknown) => {
            this.busy.set(false);
            if (isApiError(err) && err.status === 409) this.toast.error('تغيّر المشروع. أعد تحميل الصفحة وحاول مجددًا.');
          },
        });
      });
  }

  protected transition(project: ProjectSummary, t: { toStatusId: string; name: string; requiresApproval: boolean }): void {
    this.dialog
      .open<TransitionDialog, TransitionDialogData, string>(TransitionDialog, {
        data: { projectName: project.name, toStatusName: t.name, requiresApproval: t.requiresApproval },
        width: 'min(500px, calc(100vw - 32px))',
      })
      .afterClosed.subscribe((comment) => {
        if (comment === undefined) return;
        this.busy.set(true);
        this.api.transition(project.id, { toStatusId: t.toStatusId, ...(comment ? { comment } : {}), version: project.version }).subscribe({
          next: () => {
            this.busy.set(false);
            this.toast.success(`تم نقل المشروع إلى «${t.name}»`);
            this.approvalsKey.update((k) => k + 1);
            this.refresh();
          },
          error: (err: unknown) => {
            this.busy.set(false);
            if (!isApiError(err)) return;
            if (err.status === 409) this.refresh();
            else if (err.status === 422 && err.message.includes('الموافقة')) this.offerApproval(project);
          },
        });
      });
  }

  private offerApproval(project: ProjectSummary): void {
    this.confirm
      .confirm({
        title: 'يتطلب موافقة',
        message: 'هذا الانتقال يتطلب موافقة معتمدة. هل تريد إرسال طلب موافقة الآن؟',
        confirmText: 'طلب موافقة',
      })
      .subscribe((ok) => {
        if (ok) this.requestApproval(project);
      });
  }

  protected requestApproval(project: ProjectSummary): void {
    this.dialog
      .open<ApprovalRequestDialog, ApprovalRequestData, boolean>(ApprovalRequestDialog, {
        data: { projectId: project.id, projectName: project.name },
        width: 'min(500px, calc(100vw - 32px))',
      })
      .afterClosed.subscribe((sent) => {
        if (!sent) return;
        this.toast.success('تم إرسال طلب الموافقة');
        this.approvalsKey.update((k) => k + 1);
        this.refresh();
      });
  }
}
