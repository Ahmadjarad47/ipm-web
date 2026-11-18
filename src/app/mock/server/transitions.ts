import { TransitionRecord } from '@domain/workflow/workflow.models';
import { MockDatabase } from '../db/database';

export interface TransitionInput {
  readonly subjectType: TransitionRecord['subjectType'];
  /** Id of the work item or project that changed status. */
  readonly itemId: string;
  readonly projectId: string;
  readonly fromStatusId: string;
  readonly toStatusId: string;
  readonly actorId: string;
  readonly comment?: string | null;
}

/** Appends one row to the status history (FR-WF-08). Used for work items and, by the project handlers, for projects. */
export function recordTransition(db: MockDatabase, input: TransitionInput): TransitionRecord {
  return db.transitions.insert({
    subjectType: input.subjectType,
    itemId: input.itemId,
    projectId: input.projectId,
    fromStatusId: input.fromStatusId,
    toStatusId: input.toStatusId,
    fromName: db.statuses.find(input.fromStatusId)?.name ?? input.fromStatusId,
    toName: db.statuses.find(input.toStatusId)?.name ?? input.toStatusId,
    actorId: input.actorId,
    comment: input.comment?.trim() ? input.comment.trim() : null,
    at: new Date().toISOString(),
  });
}
