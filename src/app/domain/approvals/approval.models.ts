import { Entity } from '@core/models/entity.model';
import { Priority } from '@domain/work-items/work-item.models';

/** Approval state is separate from work status (FR-APR-13). */
export type ApprovalStatus = 'Draft' | 'PendingApproval' | 'Approved' | 'Rejected' | 'Returned' | 'Superseded';

export const APPROVAL_STATUS_LABELS: Record<ApprovalStatus, string> = {
  Draft: 'مسودة',
  PendingApproval: 'بانتظار الموافقة',
  Approved: 'معتمد',
  Rejected: 'مرفوض',
  Returned: 'مُعاد للتعديل',
  Superseded: 'مُلغى بإصدار أحدث',
};

export type ApprovalEvent = 'project.approve' | 'project.close' | 'workItem.approve' | 'sensitive.change';

export const APPROVAL_EVENT_LABELS: Record<ApprovalEvent, string> = {
  'project.approve': 'اعتماد مشروع',
  'project.close': 'إغلاق مشروع',
  'workItem.approve': 'موافقة على عنصر عمل',
  'sensitive.change': 'تعديل حساس',
};

export type ApproverKind = 'user' | 'role' | 'position';

/** Organisation positions resolved per request (FR-APR-02). */
export type ApproverPosition = 'project_owner' | 'direct_manager' | 'project_manager';

export const APPROVER_POSITION_LABELS: Record<ApproverPosition, string> = {
  project_owner: 'مالك المشروع',
  direct_manager: 'المدير المباشر لمقدّم الطلب',
  project_manager: 'مدير المشروع',
};

export interface ApprovalStage {
  readonly order: number;
  readonly name: string;
  readonly approverKind: ApproverKind;
  /** userId, roleId or an `ApproverPosition` depending on `approverKind`. */
  readonly approverId: string;
  /** Hours the stage may stay pending before it is reported overdue (FR-APR-07). */
  readonly dueHours?: number;
}

/** What the template is being applied to (FR-APR-01/13). */
export type ApprovalAction = 'close' | 'reopen' | 'change' | 'activate';

export interface RuleCondition {
  readonly field: string;
  readonly op: 'eq' | 'neq' | 'gt' | 'lt' | 'in';
  readonly value: string | number | readonly string[];
}

/** Selects which subjects a template governs; the most specific / highest `priority` template wins. */
export interface ApprovalRule {
  readonly workItemTypeIds?: readonly string[];
  readonly projectIds?: readonly string[];
  readonly priorities?: readonly Priority[];
  readonly actions?: readonly ApprovalAction[];
  readonly conditions?: readonly RuleCondition[];
  readonly priority?: number;
}

export interface ApprovalTemplate extends Entity {
  readonly name: string;
  readonly event: ApprovalEvent;
  readonly active: boolean;
  readonly stages: readonly ApprovalStage[];
  /** Field keys whose change during review supersedes the request (FR-APR-10). */
  readonly protectedFields: readonly string[];
  /** Which subjects/actions this template applies to; absent = every subject of its event. */
  readonly rule?: ApprovalRule;
  /** FR-APR-06: per-template half of the self-approval exception (the global setting must also be on). */
  readonly allowSelfApproval?: boolean;
}

export type Decision = 'Approve' | 'Reject' | 'Return';

export const DECISION_LABELS: Record<Decision, string> = {
  Approve: 'موافقة',
  Reject: 'رفض',
  Return: 'إرجاع للتعديل',
};

export interface ApprovalDecision {
  readonly stageOrder: number;
  readonly deciderId: string;
  readonly decision: Decision;
  readonly comment: string;
  readonly at: string;
  /** Request revision the decision applied to. */
  readonly revision: number;
  /** FR-APR-11: set when the decider acted as a delegate of this user. */
  readonly onBehalfOf?: string;
}

/** An approved request can authorise its action for this many days only. */
export const APPROVAL_TTL_DAYS = 14;

export type ApprovalSubject = 'project' | 'workItem';

export interface ApprovalRequest extends Entity {
  readonly templateId: string;
  readonly subjectType: ApprovalSubject;
  readonly subjectId: string;
  readonly projectId: string;
  readonly title: string;
  readonly requesterId: string;
  readonly status: ApprovalStatus;
  /** Active stage order (1-based); 0 when not pending. */
  readonly currentStage: number;
  readonly revision: number;
  /** Frozen copy of approved fields (FR-APR-03). */
  readonly snapshot: Readonly<Record<string, string | number | null>>;
  readonly decisions: readonly ApprovalDecision[];
  readonly stages: readonly ApprovalStage[];
  /** `sensitive.change` only: values applied to the subject atomically on the final approval. */
  readonly proposedChanges?: Readonly<Record<string, string | number | null>>;
  /** When the active stage becomes overdue (set only when the stage has `dueHours`). */
  readonly stageDueAt?: string | null;
  /** Last reminder sent to the current approvers (rate limit: one per hour). */
  readonly lastRemindedAt?: string | null;
  /** Gated transitions: the action this approval authorises (close / reopen / activate); inferred by the server when omitted. */
  readonly action?: ApprovalAction;
  /** Gated transitions: the exact target status this approval authorises; when set, a transition to any other status is refused. */
  readonly targetStatusId?: string;
  /** Approvers resolved once at submission (positions/roles frozen); delegations stay dynamic. Keyed by stage order. */
  readonly resolvedApprovers?: Readonly<Record<number, readonly string[]>>;
  /** Set when the approval was spent on its one protected action (single use, persistent). */
  readonly consumedAt?: string;
  /** Computed by the server: the active stage is past `stageDueAt`. */
  readonly overdue?: boolean;
  /** Returned by list/detail endpoints: may the caller decide the active stage right now? */
  readonly canDecide?: boolean;
}

export interface DecideRequest {
  readonly decision: Decision;
  readonly comment: string;
  readonly revision: number;
}

export type ApprovalBox = 'inbox' | 'sent' | 'closed';

/** FR-APR-11: temporary delegation of approval authority. */
export interface Delegation extends Entity {
  readonly fromUserId: string;
  readonly toUserId: string;
  /** Inclusive window, YYYY-MM-DD in the organisation time zone (max 90 days). */
  readonly from: string;
  readonly to: string;
  readonly reason: string;
  readonly active: boolean;
}

export interface DelegationCreate {
  /** Defaults to the caller; another user needs `approvals.configure`. */
  readonly fromUserId?: string;
  readonly toUserId: string;
  readonly from: string;
  readonly to: string;
  readonly reason: string;
}

export interface BulkDecideResult {
  readonly id: string;
  readonly ok: boolean;
  readonly message: string | null;
}
