import { ApiError, isApiError } from '@core/models/api-error.model';
import { Filters, FilterValue, ListQuery } from '@core/models/entity.model';
import { GitEvent } from '@domain/activity/activity.models';
import { Priority, PRIORITY_LABELS, WorkItem } from '@domain/work-items/work-item.models';
import { StatusLookup } from '@domain/workflow/workflow.api';

export const PRIORITY_OPTIONS: readonly { readonly value: Priority; readonly label: string }[] = (
  Object.keys(PRIORITY_LABELS) as Priority[]
).map((value) => ({ value, label: PRIORITY_LABELS[value] }));

/** Wraps a Latin token (ref, code) in Unicode LTR isolates so it renders correctly inside Arabic text. */
export const ltr = (s: string): string => '⁦' + s + '⁩';

function todayIso(): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Overdue = past due date and not in a closed status category (uses stable categories, not names). */
export function isItemOverdue(item: WorkItem, statuses: StatusLookup): boolean {
  if (!item.dueDate) return false;
  const category = statuses.get(item.statusId)?.category;
  if (category === 'done' || category === 'cancelled') return false;
  return item.dueDate.slice(0, 10) < todayIso();
}

/** `<input type="date">` value from an ISO date. */
export function dateInputValue(value: string | null): string {
  return value ? value.slice(0, 10) : '';
}

export function asApiError(error: unknown): ApiError | null {
  return isApiError(error) ? error : null;
}

/** Git events mentioning a work item ref; `workItemRef` is a server-side filter that is not a GitEvent field. */
export function gitEventsQuery(ref: string): ListQuery<GitEvent> {
  const filters: Record<string, FilterValue> = { workItemRef: [ref] };
  return { page: 1, pageSize: 10, filters: filters as Filters<GitEvent> };
}

/** Allowed (source type, target type) pairs of a relation type; none configured means any pair (FR-REL-04). */
export function relationPairAllowed(
  pairs: readonly { readonly sourceTypeId: string; readonly targetTypeId: string }[] | undefined,
  sourceTypeId: string,
  targetTypeId: string,
): boolean {
  return !pairs?.length || pairs.some((p) => p.sourceTypeId === sourceTypeId && p.targetTypeId === targetTypeId);
}
