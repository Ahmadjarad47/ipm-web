import { Entity } from '@core/models/entity.model';
import { GitEvent } from '@domain/activity/activity.models';

export type WebhookOutcome = 'processed' | 'duplicate' | 'rejected' | 'failed';

export const WEBHOOK_OUTCOME_LABELS: Record<WebhookOutcome, string> = {
  processed: 'عولج',
  duplicate: 'مكرر (تُجوهل)',
  rejected: 'مرفوض',
  failed: 'فشل',
};

/** One received webhook call (FR-GIT-04/05): kept for auditing, idempotency and redelivery. */
export interface WebhookDelivery extends Entity {
  readonly projectId: string;
  readonly repositoryId: string;
  readonly provider: 'gitea' | 'github' | 'gitlab';
  /** Provider delivery id (X-Gitea-Delivery / X-GitHub-Delivery); the idempotency key. */
  readonly deliveryId: string;
  readonly event: string;
  readonly signatureValid: boolean;
  readonly outcome: WebhookOutcome;
  readonly message: string | null;
  /** Work item refs linked by this delivery. */
  readonly linkedRefs: readonly string[];
}

/** A commit that exists on the Git server (what a manual sync fetches), whether or not a webhook delivered it. */
export interface RemoteCommit {
  readonly sha: string;
  readonly message: string;
  readonly branch: string;
  readonly author: string;
  readonly url: string;
}

export type SimulatedGitEvent = 'push' | 'pr_open' | 'pr_merge';

/** Demo-only: builds a provider-shaped payload, signs it with the repository secret and posts it to the real webhook path. */
export interface SimulateWebhookRequest {
  readonly repositoryId: string;
  readonly event: SimulatedGitEvent;
  readonly branch: string;
  readonly message: string;
  readonly author: string;
  /** Send without a valid signature to see the rejection path (AT-09). */
  readonly unsigned?: boolean;
  /** Re-send the previous delivery id to see idempotency (AT-09). */
  readonly replayLast?: boolean;
}

export interface DevSummary {
  readonly branches: readonly string[];
  readonly commits: readonly GitEvent[];
  readonly pullRequests: readonly GitEvent[];
}

/** The declared reference pattern: `<PROJECT CODE>-<number>` anywhere in a message, branch or PR title (FR-GIT-03). */
export const WORK_ITEM_REF_PATTERN = /\b([A-Z][A-Z0-9]{1,9}-\d+)\b/g;

/** Branch prefix per work item type key; anything else uses `work/`. */
const BRANCH_PREFIX: Readonly<Record<string, string>> = { bug: 'bugfix', feature: 'feature', task: 'task', subtask: 'task', milestone: 'release' };

/** Suggested branch name containing the ref so pushes link automatically, e.g. `feature/ERP-104`. */
export function suggestedBranch(ref: string, typeKey: string | undefined): string {
  return `${BRANCH_PREFIX[typeKey ?? ''] ?? 'work'}/${ref}`;
}

export function summarizeDev(events: readonly GitEvent[]): DevSummary {
  return {
    branches: [...new Set(events.map((e) => e.branch).filter((b) => b && b !== 'main'))],
    commits: events.filter((e) => e.kind === 'push'),
    pullRequests: events.filter((e) => e.kind === 'pull_request' || e.kind === 'merge'),
  };
}
