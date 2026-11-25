import { Entity } from '@core/models/entity.model';

export type SubjectType = 'project' | 'workItem' | 'approval' | 'user' | 'role' | 'type' | 'status' | 'relation' | 'git';

export interface FieldChange {
  readonly field: string;
  readonly from: string | null;
  readonly to: string | null;
}

/** Append-only (FR-AUD-04): the API exposes no update or delete for audit events. */
export interface AuditEvent extends Entity {
  readonly actorId: string;
  readonly action: string;
  readonly subjectType: SubjectType;
  readonly subjectId: string;
  /** Display label captured at event time so renames never rewrite history (§4.3). */
  readonly subjectLabel: string;
  readonly projectId: string | null;
  readonly at: string;
  readonly changes: readonly FieldChange[];
  readonly source: 'ui' | 'api' | 'webhook' | 'system';
  readonly correlationId: string;
  /** Security events are visible only with `audit.view`. */
  readonly security: boolean;
  /** Tamper evidence (FR-AUD-09): hash of the previous event, and SHA-256 over `prevHash` + this event's payload. */
  readonly prevHash: string;
  readonly hash: string;
}

/** Result of `GET audit/verify`: `brokenAt` is the id of the first event whose hash chain does not match. */
export interface AuditVerification {
  readonly ok: boolean;
  readonly checked: number;
  readonly brokenAt?: string;
}

export const AUDIT_ACTION_LABELS: Readonly<Record<string, string>> = {
  'project.created': 'أنشأ مشروعًا',
  'project.updated': 'عدّل مشروعًا',
  'project.archived': 'أرشف مشروعًا',
  'project.unarchived': 'ألغى أرشفة مشروع',
  'project.members': 'عدّل أعضاء مشروع',
  'workItem.created': 'أنشأ عمل',
  'workItem.updated': 'عدّل عمل',
  'workItem.transition': 'غيّر حالة عمل',
  'workItem.assigned': 'غيّر المكلّفين',
  'workItem.parent': 'غيّر العمل الأب',
  'workItem.typeChanged': 'غيّر نوع عمل',
  'relation.created': 'أنشأ رابطًا',
  'relation.deleted': 'حذف رابطًا',
  'relation.rejected': 'رُفض إنشاء رابط',
  'workItem.parent_rejected': 'رُفض تغيير العمل الأب',
  'approval.submitted': 'قدّم طلب موافقة',
  'approval.decided': 'أصدر قرار موافقة',
  'approval.superseded': 'أُبطل إصدار طلب',
  'comment.created': 'أضاف تعليقًا',
  'comment.edited': 'عدّل تعليقًا',
  'comment.deleted': 'حذف تعليقًا',
  'auth.login': 'سجّل الدخول',
  'auth.login_failed': 'محاولة دخول مرفوضة',
  'role.updated': 'عدّل دورًا',
  'type.updated': 'عدّل نوع عمل',
  'type.created': 'أنشأ نوع عمل',
  'status.updated': 'عدّل حالة',
  'workflow.updated': 'عدّل مسار العمل',
  'git.push': 'دفع Commit',
  'git.pr': 'فتح طلب دمج (PR)',
  'git.connected': 'ربط مستودع Git',
  'git.disconnected': 'فصل مستودع Git',
  'file.uploaded': 'رفع ملفًا',
  'file.downloaded': 'نزّل ملفًا',
  'file.deleted': 'حذف ملفًا',
  'file.download_denied': 'محاولة تنزيل ملف مرفوضة',
  'file.rejected_malware': 'رُفض ملف لاحتوائه محتوى ضارًا',
  'settings.updated': 'عدّل إعدادات النظام',
  'approval.reassigned': 'أعاد تعيين مُوافِق',
  'user.created': 'أنشأ مستخدمًا',
  'audit.exported': 'صدّر سجل التدقيق',
  'project.transition': 'غيّر حالة مشروع',
  'git.linked': 'ربط Commit بعمل',
  'git.unlinked': 'فك ربط Commit',
  'git.merge': 'دمج طلب دمج (PR)',
  'git.webhook_rejected': 'رُفض Webhook غير موقّع',
  'auth.logout': 'سجّل الخروج',
  'auth.permission_denied': 'محاولة بدون صلاحية',
  'user.updated': 'عدّل بيانات مستخدم',
  'user.password_reset_requested': 'طلب إعادة تعيين كلمة مرور',
};

export interface Comment extends Entity {
  readonly subjectType: 'project' | 'work-item';
  readonly subjectId: string;
  readonly authorId: string;
  readonly body: string;
  readonly edited: boolean;
  readonly deleted: boolean;
  /** Edit history; the first revision is the original text (FR-COL-02). Empty until the first edit. */
  readonly revisions: readonly CommentRevision[];
}

export interface CommentRevision {
  readonly body: string;
  readonly editedAt: string;
}

export interface Notification extends Entity {
  readonly userId: string;
  readonly title: string;
  readonly body: string;
  readonly link: string;
  readonly read: boolean;
}

export interface GitEvent extends Entity {
  readonly projectId: string;
  readonly repositoryId: string;
  readonly kind: 'push' | 'pull_request' | 'merge';
  readonly title: string;
  readonly branch: string;
  readonly sha: string;
  readonly author: string;
  readonly url: string;
  /** All linked work item refs: detected automatically (FR-GIT-03) plus manual links. */
  readonly workItemRefs: readonly string[];
  /** Subset of `workItemRefs` linked by hand rather than by the reference pattern. */
  readonly manualRefs?: readonly string[];
  /** Pull request number and state (for pull_request / merge events). */
  readonly prNumber?: number;
  readonly prState?: 'open' | 'merged' | 'closed';
  /** Provider delivery that produced this event (idempotency, FR-GIT-05). */
  readonly deliveryId?: string;
  /** When it happened on the Git server (commit / pull request time); `createdAt` is only when it was received or synced. */
  readonly occurredAt?: string;
}

/** Open/blocked dependency picture of the filtered items (§6.3). */
export interface DependencyStats {
  /** Targets of a `blocks` link whose source is not Done/Cancelled, themselves not Done/Cancelled. */
  readonly blockedItems: number;
  /** Distinct sources of such links. */
  readonly blockingItems: number;
  readonly itemsWithOpenDependencyPct: number;
}

export interface TypeStats {
  readonly typeId: string;
  /** Leaf items only, cancelled excluded. */
  readonly total: number;
  readonly done: number;
  readonly byCategory: Readonly<Record<string, number>>;
}

/**
 * Period semantics: an item is in scope when its range [startDate ?? createdAt, dueDate ?? updatedAt]
 * overlaps [from, to] (dates are org-zone calendar days).
 */
export interface DashboardStats {
  readonly activeProjects: number;
  readonly totalProjects: number;
  readonly openWorkItems: number;
  readonly overdueWorkItems: number;
  readonly pendingApprovals: number;
  /** Every item in scope (parents included) per status category. */
  readonly byCategory: Readonly<Record<string, number>>;
  /** Same as `byCategory` but leaf items only — the definition completion % uses. */
  readonly leafByCategory: Readonly<Record<string, number>>;
  readonly byType: readonly TypeStats[];
  readonly blockedItems: number;
  readonly dependencies: DependencyStats;
  /** Git events created in the period, in projects the caller can see with `git.view`. */
  readonly gitActivity: number;
}

/** Page of notifications plus the caller's total unread count. */
export interface NotificationPage {
  readonly items: readonly Notification[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly unread: number;
}
