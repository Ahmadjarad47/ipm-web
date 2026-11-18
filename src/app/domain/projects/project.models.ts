import { Entity } from '@core/models/entity.model';

export interface ProjectMember {
  readonly userId: string;
  /** Project-scope role; grants nothing outside this project (FR-PRJ-05). */
  readonly roleId: string;
}

export interface Repository {
  readonly id: string;
  readonly provider: 'gitea' | 'github' | 'gitlab';
  readonly name: string;
  readonly url: string;
  readonly defaultBranch: string;
  readonly lastSyncAt: string | null;
  readonly lastSyncError: string | null;
  readonly connected: boolean;
  /** True when an access token is stored server-side. The token itself is never returned (NFR-04). */
  readonly hasCredential?: boolean;
  /** Endpoint the Git server must call; its signing secret is configured on the Git side only. */
  readonly webhookUrl?: string;
  /** Demo/test flag: manual sync fails as if the Git server timed out (replaces the old name-based hook). */
  readonly simulateOutage?: boolean;
}

/** Write-only connection settings (FR-GIT-01). `accessToken` is sent once and never read back. */
export interface RepositoryConnect {
  readonly provider: Repository['provider'];
  readonly name: string;
  readonly url: string;
  readonly defaultBranch: string;
  readonly accessToken: string;
  /** HMAC secret also entered in the Git provider webhook settings; write-only, min 16 chars. Generated server-side when omitted. */
  readonly webhookSecret?: string;
}

export interface Project extends Entity {
  /** Unique short code; prefixes every work item ref, e.g. PRJ-104 (FR-TSK-02). */
  readonly code: string;
  readonly name: string;
  readonly description: string;
  readonly ownerId: string;
  readonly statusId: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly archived: boolean;
  readonly members: readonly ProjectMember[];
  readonly allowedTypeIds: readonly string[];
  readonly defaultTypeId: string;
  /** Per-project workflow override: work item type id -> workflow id (FR-WF-10). */
  readonly workflowOverrides?: Readonly<Record<string, string>>;
  readonly repositories: readonly Repository[];
  /** FR-GIT-03: custom ref regex with exactly one capture group; default derived from `code`. */
  readonly refPattern?: string;
}

export type ProjectCreate = Pick<Project, 'code' | 'name' | 'description' | 'ownerId' | 'startDate' | 'endDate'> & {
  /** Optional initial status; otherwise the workflow's (or template's) initial status. */
  readonly statusId?: string;
  /** FR-PRJ-10: presets for types, default type and initial status. */
  readonly templateId?: string;
};

/**
 * Project status changes go through the project workflow, never a field edit (§4.3):
 * some transitions require a completed approval (e.g. activation, closure).
 */
export interface ProjectTransitionRequest {
  readonly toStatusId: string;
  readonly comment?: string;
  readonly version: number;
}

/** Project with server-computed progress (SRS §4.4). */
export interface ProjectSummary extends Project {
  readonly progress: ProgressInfo;
  readonly workItemCount: number;
  readonly overdueCount: number;
}

export interface ProgressInfo {
  /** 0–100, or null when there are no countable leaf items ("لا توجد بيانات"). */
  readonly percent: number | null;
  readonly doneLeaves: number;
  readonly countedLeaves: number;
  /** Human-readable formula and counted scope, so the UI can explain the number (§4.4). */
  readonly rule: string;
}

/** Open work still assigned to a member who was just removed (data is left intact). */
export interface MemberWarning {
  readonly userId: string;
  readonly userName: string;
  readonly refs: readonly string[];
  readonly message: string;
}

/** Response of the members action: the project plus non-blocking warnings. */
export interface ProjectMembersResult extends ProjectSummary {
  readonly warnings?: readonly MemberWarning[];
}

/** One-time result of rotating a repository webhook secret: shown once, never stored in clear on the client. */
export interface RotatedSecret {
  readonly repositoryId: string;
  readonly secret: string;
}
