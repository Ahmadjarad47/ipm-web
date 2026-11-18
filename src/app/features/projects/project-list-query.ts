import { DEFAULT_PAGE_SIZE, Filters, ListQuery, Sort } from '@core/models/entity.model';
import { ProjectSummary } from '@domain/projects/project.models';

/** Filter keys the projects endpoint understands beyond the entity fields (`memberId`, date-range bounds). */
export type ProjectFilterKey = 'statusId' | 'ownerId' | 'memberId' | 'archived' | 'startTo' | 'endFrom';

export const SORTABLE_PROJECT_FIELDS: readonly (keyof ProjectSummary & string)[] = [
  'code', 'name', 'statusId', 'ownerId', 'progress', 'startDate', 'endDate',
];

/** Minimal read-only view of query params (satisfied by Angular's `ParamMap`). */
export interface ParamReader {
  get(name: string): string | null;
}

export type UrlParams = Readonly<Record<string, string | null>>;

/**
 * Query-string contract of the projects list:
 * `q` search · `status` · `owner` · `member` · `archived=1` (include archived) · `from`/`to` (projects overlapping the
 * range: end >= from, start <= to) · `sort=field:dir` · `page`. Defaults (active only, page 1) are omitted.
 */
export function queryToParams(query: ListQuery<ProjectSummary>): UrlParams {
  const f = (query.filters ?? {}) as Record<string, string | number | boolean | null | readonly (string | number)[] | undefined>;
  const text = (key: string): string | null => {
    const v = f[key];
    return typeof v === 'string' && v ? v : null;
  };
  return {
    q: query.search?.trim() || null,
    status: text('statusId'),
    owner: text('ownerId'),
    member: text('memberId'),
    archived: f['archived'] === false ? null : '1',
    from: text('endFrom'),
    to: text('startTo'),
    sort: query.sort ? `${query.sort.field}:${query.sort.direction}` : null,
    page: query.page > 1 ? String(query.page) : null,
  };
}

export function parseSort(raw: string | null): Sort<ProjectSummary> | undefined {
  if (!raw) return undefined;
  const [field, direction] = raw.split(':');
  const known = SORTABLE_PROJECT_FIELDS.find((x) => x === field);
  if (!known) return undefined;
  return { field: known, direction: direction === 'desc' ? 'desc' : 'asc' };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function paramsToQuery(params: ParamReader, pageSize = DEFAULT_PAGE_SIZE): ListQuery<ProjectSummary> {
  const filters: Record<string, string | boolean> = {};
  const set = (key: string, value: string | null): void => {
    if (value) filters[key] = value;
  };
  set('statusId', params.get('status'));
  set('ownerId', params.get('owner'));
  set('memberId', params.get('member'));
  const from = params.get('from');
  const to = params.get('to');
  if (from && ISO_DAY.test(from)) filters['endFrom'] = from;
  if (to && ISO_DAY.test(to)) filters['startTo'] = to;
  if (params.get('archived') !== '1') filters['archived'] = false;
  const page = Number(params.get('page') ?? 1);
  const sort = parseSort(params.get('sort'));
  const search = params.get('q')?.trim();
  return {
    page: Number.isInteger(page) && page > 0 ? page : 1,
    pageSize,
    ...(search ? { search } : {}),
    ...(sort ? { sort } : {}),
    filters: filters as Filters<ProjectSummary>,
  };
}

export interface ActiveFilter {
  readonly key: ProjectFilterKey | 'search';
  readonly label: string;
}
