import { FilterValue, Sort } from '@core/models/entity.model';
import { WorkItem } from '@domain/work-items/work-item.models';

export type FilterMap = Readonly<Record<string, FilterValue>>;
export type ViewMode = 'table' | 'kanban';

/** Everything the work item list mirrors into the URL. */
export interface ListUrlState {
  readonly filters: FilterMap;
  readonly search: string;
  readonly sort?: Sort<WorkItem>;
  readonly view?: ViewMode;
}

/** Filters whose value is a list of ids ("any of"). */
export const LIST_FILTER_KEYS = ['typeId', 'statusId', 'priority', 'assigneeIds'] as const;
/** Filters whose value is a plain string. */
export const TEXT_FILTER_KEYS = ['projectId', 'parentId', 'blockedBy', 'blocking', 'dueFrom', 'dueTo', 'createdFrom', 'createdTo'] as const;
/** Yes/no filters; `false` is meaningful for the tri-state ones. */
export const FLAG_FILTER_KEYS = ['hasChildren', 'hasDependency', 'unblocked', 'unassigned', 'overdue'] as const;
/** Tri-state flags that can also be explicitly "no". */
const TRI_STATE = new Set<string>(['hasChildren', 'hasDependency']);

export const SORTABLE_FIELDS: readonly string[] = ['ref', 'title', 'typeId', 'statusId', 'priority', 'dueDate', 'createdAt'];

/** URL query parameter name for each filter key (kept short and readable). */
const PARAM_OF: Readonly<Record<string, string>> = { assigneeIds: 'assignee' };

export function asList(value: FilterValue | undefined): readonly string[] {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

const isIsoDay = (s: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(s);

/** Reads the list state from URL query parameters. Unknown or malformed values are ignored. */
export function stateFromParams(get: (key: string) => string | null, me?: string): ListUrlState {
  const filters: Record<string, FilterValue> = {};
  for (const key of LIST_FILTER_KEYS) {
    const raw = get(PARAM_OF[key] ?? key);
    const list = raw ? raw.split(',').filter(Boolean) : [];
    if (list.length) filters[key] = list;
  }
  for (const key of TEXT_FILTER_KEYS) {
    const raw = get(key);
    if (!raw) continue;
    if ((key.endsWith('From') || key.endsWith('To')) && !isIsoDay(raw)) continue;
    filters[key] = raw;
  }
  for (const key of FLAG_FILTER_KEYS) {
    const raw = get(key);
    if (raw === 'true') filters[key] = true;
    else if (raw === 'false' && TRI_STATE.has(key)) filters[key] = false;
  }
  if (get('mine') === 'true' && me) filters['assigneeIds'] = [me];

  const sortRaw = get('sort');
  let sort: Sort<WorkItem> | undefined;
  if (sortRaw) {
    const [field, dir] = sortRaw.split(':');
    if (SORTABLE_FIELDS.includes(field)) sort = { field: field as keyof WorkItem & string, direction: dir === 'desc' ? 'desc' : 'asc' };
  }
  const view = get('view');
  return {
    filters,
    search: get('q') ?? '',
    ...(sort ? { sort } : {}),
    ...(view === 'kanban' || view === 'table' ? { view } : {}),
  };
}

/** Query parameters for the state; empty values are omitted so the URL stays clean. */
export function stateToParams(state: ListUrlState, me?: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(state.filters)) {
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) continue;
    if (key === 'assigneeIds' && me && Array.isArray(value) && value.length === 1 && value[0] === me) {
      out['mine'] = 'true';
      continue;
    }
    out[PARAM_OF[key] ?? key] = Array.isArray(value) ? value.join(',') : String(value);
  }
  if (state.search) out['q'] = state.search;
  if (state.sort) out['sort'] = `${state.sort.field}:${state.sort.direction}`;
  if (state.view === 'kanban') out['view'] = 'kanban';
  return out;
}

export interface FilterChip {
  readonly key: string;
  /** Present for list filters: only this value is removed. */
  readonly value?: string;
  readonly text: string;
}

export interface ChipLabels {
  readonly group: Readonly<Record<string, string>>;
  readonly value: (key: string, value: string) => string;
}

export const FILTER_GROUP_LABELS: Readonly<Record<string, string>> = {
  projectId: 'المشروع',
  typeId: 'النوع',
  statusId: 'الحالة',
  priority: 'الأولوية',
  assigneeIds: 'المكلّف',
  unassigned: 'غير مُكلَّف',
  dueFrom: 'الاستحقاق من',
  dueTo: 'الاستحقاق إلى',
  createdFrom: 'الإنشاء من',
  createdTo: 'الإنشاء إلى',
  parentId: 'الأب',
  hasChildren: 'له أعمال فرعية',
  hasDependency: 'له اعتماديات',
  blockedBy: 'محجوب بواسطة',
  blocking: 'يحجب',
  unblocked: 'غير محجوب',
  overdue: 'متأخر',
};

/** One chip per active filter value, e.g. «النوع: مهمة». */
export function activeChips(filters: FilterMap, resolve: (key: string, value: string) => string): readonly FilterChip[] {
  const chips: FilterChip[] = [];
  for (const [key, value] of Object.entries(filters)) {
    const label = FILTER_GROUP_LABELS[key] ?? key;
    if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) continue;
    if (typeof value === 'boolean') {
      chips.push({ key, text: TRI_STATE.has(key) ? `${label}: ${value ? 'نعم' : 'لا'}` : label });
    } else if (Array.isArray(value)) {
      for (const v of value) chips.push({ key, value: String(v), text: `${label}: ${resolve(key, String(v))}` });
    } else {
      chips.push({ key, text: `${label}: ${resolve(key, String(value))}` });
    }
  }
  return chips;
}

/** Filters after removing one chip (a single list value or the whole key). */
export function withoutChip(filters: FilterMap, chip: FilterChip): FilterMap {
  const next: Record<string, FilterValue> = { ...filters };
  const current = next[chip.key];
  if (chip.value !== undefined && Array.isArray(current)) {
    const rest = current.filter((v) => String(v) !== chip.value);
    if (rest.length) next[chip.key] = rest;
    else delete next[chip.key];
  } else {
    delete next[chip.key];
  }
  return next;
}

