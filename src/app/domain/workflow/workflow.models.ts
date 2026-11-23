import { PermissionKey } from '@core/auth/permissions';
import { Entity } from '@core/models/entity.model';

/** Stable reporting categories; display names may change freely (FR-WF-03). */
export type StatusCategory = 'not-started' | 'active' | 'blocked' | 'done' | 'cancelled';

export const STATUS_CATEGORIES: readonly StatusCategory[] = ['not-started', 'active', 'blocked', 'done', 'cancelled'];

export const STATUS_CATEGORY_LABELS: Record<StatusCategory, string> = {
  'not-started': 'لم يبدأ',
  active: 'نشط',
  blocked: 'محجوب',
  done: 'منجز',
  cancelled: 'ملغى',
};

export type StatusScope = 'project' | 'work-item';

export interface Status extends Entity {
  /** Immutable internal key — history and integrations reference this, never the name. */
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly category: StatusCategory;
  readonly scope: StatusScope;
  readonly order: number;
  readonly active: boolean;
}

export interface Transition {
  readonly fromStatusId: string;
  readonly toStatusId: string;
  /** Extra permission beyond `workflow.transition`, if any. */
  readonly permission?: PermissionKey;
  readonly requiresAssignee?: boolean;
  readonly requiresApproval?: boolean;
  /** Reject when an open "blocks" dependency exists (FR-REL-08). */
  readonly blockedByOpenDependencies?: boolean;
}

export interface Workflow extends Entity {
  readonly key: string;
  readonly name: string;
  readonly scope: StatusScope;
  readonly statusIds: readonly string[];
  readonly initialStatusId: string;
  readonly transitions: readonly Transition[];
}

/** One executed status change of a work item or project (FR-WF-08, TSK-08). */
export interface TransitionRecord extends Entity {
  readonly subjectType: 'workItem' | 'project';
  readonly itemId: string;
  readonly projectId: string;
  readonly fromStatusId: string;
  readonly toStatusId: string;
  readonly fromName: string;
  readonly toName: string;
  readonly actorId: string;
  readonly comment: string | null;
  readonly at: string;
}

export interface CloseRequest {
  /** Required only when several Done targets exist from the current status. */
  readonly toStatusId?: string;
  readonly comment?: string;
  readonly version: number;
}

export interface ReopenRequest {
  readonly toStatusId?: string;
  /** Mandatory: a reopen must be explained. */
  readonly comment: string;
  readonly version: number;
}

export interface TransitionRequest {
  readonly toStatusId: string;
  readonly comment?: string;
  readonly version: number;
}
