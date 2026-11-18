import { Entity } from '@core/models/entity.model';

/**
 * Organisation-wide policies the SRS leaves configurable (§9.2 open decisions).
 * One record; edited by holders of `settings.manage`; every change is audited.
 */
export interface SystemSettings extends Entity {
  /** FR-AUTH-06 */
  readonly sessionHours: number;
  /** FR-COL-02: how long an author may edit their comment. */
  readonly commentEditHours: number;
  /** FR-COL-05 */
  readonly attachmentMaxMb: number;
  readonly attachmentExtensions: readonly string[];
  /** FR-REL-07: links between projects (default off). */
  readonly allowCrossProjectRelations: boolean;
  /** FR-APR-06: explicit, audited exception to the self-approval ban. */
  readonly allowSelfApproval: boolean;
  /** NFR-10 */
  readonly timeZone: string;
  /** NFR-13 */
  readonly auditRetentionDays: number;
  /** §9.2 visibility: new projects private by default. */
  readonly projectsPrivateByDefault: boolean;
  /** §4.4: work item types counted in project progress; empty = all types. */
  readonly progressIncludedTypeIds: readonly string[];
}

export type SettingsUpdate = Partial<Omit<SystemSettings, keyof Entity>> & { readonly version: number };

export const DEFAULT_SETTINGS: Omit<SystemSettings, keyof Entity> = {
  sessionHours: 8,
  commentEditHours: 24,
  attachmentMaxMb: 10,
  attachmentExtensions: ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'txt', 'csv', 'docx', 'xlsx', 'pptx', 'zip'],
  allowCrossProjectRelations: false,
  allowSelfApproval: false,
  timeZone: 'Asia/Riyadh',
  auditRetentionDays: 2555,
  projectsPrivateByDefault: true,
  progressIncludedTypeIds: [],
};
