import { BoardItem, FieldValue } from '@domain/work-items/work-item.models';
import { Status, Workflow } from '@domain/workflow/workflow.models';
import { FilterMap, asList } from './work-item-filters';

/** A board card: the lean server item plus the optional values of `showOnCard` fields. */
export type BoardCard = BoardItem & { readonly fields?: Readonly<Record<string, FieldValue>> };

/**
 * Board columns: the union of the statuses of every effective workflow in use (FR-TSK-06), active only,
 * ordered by the configured status order. Each status appears once even when workflows share it.
 */
export function unionColumns(
  workflowIds: Iterable<string>,
  workflowOf: (id: string) => Workflow | undefined,
  statusOf: (id: string) => Status | undefined,
): readonly Status[] {
  const ids = new Set<string>();
  for (const id of new Set(workflowIds)) workflowOf(id)?.statusIds.forEach((s) => ids.add(s));
  return [...ids]
    .map(statusOf)
    .filter((s): s is Status => !!s && s.active)
    .sort((a, b) => a.order - b.order);
}

/** Client-side counterpart of the list filters the complete board can honour. */
export function filterBoardItems(items: readonly BoardCard[], filters: FilterMap, search: string): readonly BoardCard[] {
  const types = asList(filters['typeId']);
  const statuses = asList(filters['statusId']);
  const priorities = asList(filters['priority']);
  const assignees = asList(filters['assigneeIds']);
  const parentId = filters['parentId'] ? String(filters['parentId']) : '';
  const unassigned = filters['unassigned'] === true;
  const dueFrom = filters['dueFrom'] ? String(filters['dueFrom']) : '';
  const dueTo = filters['dueTo'] ? String(filters['dueTo']) : '';
  const q = search.trim().toLowerCase();
  return items.filter((i) => {
    if (types.length && !types.includes(i.typeId)) return false;
    if (statuses.length && !statuses.includes(i.statusId)) return false;
    if (priorities.length && !priorities.includes(i.priority)) return false;
    if (assignees.length || unassigned) {
      const match = assignees.some((a) => i.assigneeIds.includes(a)) || (unassigned && !i.assigneeIds.length);
      if (!match) return false;
    }
    if (parentId && i.parentId !== parentId) return false;
    if ((dueFrom || dueTo) && !i.dueDate) return false;
    if (dueFrom && i.dueDate && i.dueDate.slice(0, 10) < dueFrom) return false;
    if (dueTo && i.dueDate && i.dueDate.slice(0, 10) > dueTo) return false;
    if (q && !i.ref.toLowerCase().includes(q) && !i.title.toLowerCase().includes(q)) return false;
    return true;
  });
}
