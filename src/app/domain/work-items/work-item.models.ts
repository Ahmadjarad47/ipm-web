import { Entity } from '@core/models/entity.model';

// ---------- Dynamic types (FR-TYP) ----------

export type FieldType = 'text' | 'number' | 'date' | 'boolean' | 'select' | 'user';

export interface FieldOption {
  readonly value: string;
  readonly label: string;
}

/** Admin-defined extra field; values live in `WorkItem.fields` — no table change per field. */
export interface FieldDefinition {
  readonly key: string;
  readonly label: string;
  readonly type: FieldType;
  readonly required: boolean;
  readonly options?: readonly FieldOption[];
  readonly min?: number;
  readonly max?: number;
  readonly hint?: string;
  /** Show the value as a column in work item lists (FR-TYP-06 display). Default false. */
  readonly showInList?: boolean;
  /** Show the value on board cards. Default false. */
  readonly showOnCard?: boolean;
  /** Display order among the type's fields (ascending). */
  readonly order?: number;
}

export const FIELD_TYPES: readonly FieldType[] = ['text', 'number', 'date', 'boolean', 'select', 'user'];

export interface WorkItemType extends Entity {
  /** Immutable key; renaming never rewrites history (FR-TYP-02). */
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly color: string;
  readonly icon: IconName;
  readonly order: number;
  readonly active: boolean;
  readonly workflowId: string;
  readonly fields: readonly FieldDefinition[];
  /** Types allowed as direct children (FR-REL-01). */
  readonly allowedChildTypeIds: readonly string[];
}

export type IconName = 'feature' | 'task' | 'bug' | 'subtask' | 'milestone' | 'epic' | 'story';

export const WORK_ITEM_ICON_NAMES: readonly IconName[] = ['feature', 'task', 'bug', 'subtask', 'milestone', 'epic', 'story'];

/** One allowed parent -> child type combination (FR-REL-01). */
export interface HierarchyPair {
  readonly parentTypeId: string;
  readonly childTypeId: string;
}

/** Server-computed impact of disabling / re-binding a type or status (FR-TYP-09, FR-WF-06). */
export interface ImpactInfo {
  /** Non-archived work items (projects, for project statuses) that use it. */
  readonly items: number;
  readonly projects: number;
  readonly workflows: number;
  /** Projects (for a type) or workflows (for a status) where it is the default / initial one. */
  readonly asDefaultIn: readonly { readonly id: string; readonly name: string }[];
}

/** Lean card shape returned by the complete board endpoint (FR-TSK-05). */
export interface BoardItem {
  readonly id: string;
  readonly ref: string;
  readonly title: string;
  readonly typeId: string;
  readonly statusId: string;
  readonly priority: Priority;
  readonly assigneeIds: readonly string[];
  readonly dueDate: string | null;
  readonly parentId: string | null;
  readonly version: number;
  /** Effective workflow (project override or type workflow). */
  readonly workflowId: string;
  /** Only the custom fields flagged `showOnCard` on the item's type. */
  readonly fields?: Readonly<Record<string, FieldValue>>;
  readonly dev?: DevIndicator;
}

// ---------- Work items (FR-TSK) ----------

export type Priority = 'low' | 'medium' | 'high' | 'critical';

export const PRIORITY_LABELS: Record<Priority, string> = {
  low: 'منخفضة',
  medium: 'متوسطة',
  high: 'عالية',
  critical: 'حرجة',
};

export type FieldValue = string | number | boolean | null;

export interface WorkItem extends Entity {
  /** Human reference `<PROJECT>-<n>`, unique per project (FR-TSK-02). */
  readonly ref: string;
  readonly projectId: string;
  readonly typeId: string;
  readonly title: string;
  readonly description: string;
  readonly statusId: string;
  readonly priority: Priority;
  readonly assigneeIds: readonly string[];
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly parentId: string | null;
  readonly fields: Readonly<Record<string, FieldValue>>;
  readonly archived: boolean;
  readonly createdBy: string;
  /** Development activity summary computed by the server (FR-GIT-02); absent when the caller lacks git.view. */
  readonly dev?: DevIndicator;
}

export interface DevIndicator {
  readonly commits: number;
  readonly openPrs: number;
  readonly mergedPrs: number;
}

export type WorkItemCreate = Pick<
  WorkItem,
  'projectId' | 'typeId' | 'title' | 'description' | 'priority' | 'assigneeIds' | 'startDate' | 'dueDate' | 'parentId' | 'fields'
>;

// ---------- Relations (FR-REL) ----------

export interface RelationType extends Entity {
  readonly key: 'blocks' | 'relates' | 'duplicates' | string;
  /** Label from the source side, e.g. "يحجب". */
  readonly name: string;
  /** Label from the target side, e.g. "محجوب بواسطة". Same as `name` for symmetric links. */
  readonly inverseName: string;
  readonly directed: boolean;
  readonly active: boolean;
  /** Reject cycles (blocks chains). */
  readonly acyclic: boolean;
  /** Allowed (source type, target type) pairs; empty or absent = any (FR-REL-04). */
  readonly allowedPairs?: readonly { readonly sourceTypeId: string; readonly targetTypeId: string }[];
}

export interface WorkItemRelation extends Entity {
  readonly sourceId: string;
  readonly targetId: string;
  readonly relationTypeId: string;
  readonly createdBy: string;
}

/** A relation as seen from one work item. */
export interface RelationView {
  readonly relation: WorkItemRelation;
  readonly label: string;
  readonly other: WorkItem;
  readonly outgoing: boolean;
}

export interface TypeChangeConflict {
  readonly field: string;
  readonly reason: string;
}
