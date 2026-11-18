import { FieldDefinition, FieldValue, WorkItemType } from '@domain/work-items/work-item.models';

/** A list column backed by an admin-defined field (FR-TYP `showInList`). */
export interface CustomColumn {
  readonly key: string;
  readonly label: string;
  readonly def: FieldDefinition;
}

/**
 * The types whose fields may become columns: the selected types, else the single project's types.
 * Without either there is no single context and no custom column is shown.
 */
export function contextTypes(
  types: readonly WorkItemType[],
  selectedTypeIds: readonly string[],
  projectTypeIds: readonly string[] | null,
): readonly WorkItemType[] {
  const ids = selectedTypeIds.length ? selectedTypeIds : (projectTypeIds ?? []);
  return types.filter((t) => ids.includes(t.id));
}

/**
 * Columns for `showInList` fields, ordered by `order`. With several types only fields that every type
 * defines (same key and same field type) are kept, so no column is mostly empty by construction.
 */
export function buildCustomColumns(context: readonly WorkItemType[]): readonly CustomColumn[] {
  if (!context.length) return [];
  const [first, ...rest] = context;
  return (first.fields ?? [])
    .filter((f) => f.showInList)
    .filter((f) => rest.every((t) => t.fields.some((g) => g.key === f.key && g.type === f.type && g.showInList)))
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((def) => ({ key: `_cf_${def.key}`, label: def.label, def }));
}

/** Display text of one custom field value, by field type. */
export function formatFieldValue(def: FieldDefinition, value: FieldValue | undefined, userName: (id: string) => string): string {
  if (value === undefined || value === null || value === '') return def.type === 'boolean' ? 'لا' : '—';
  switch (def.type) {
    case 'boolean':
      return value ? 'نعم' : 'لا';
    case 'user':
      return userName(String(value));
    case 'select':
      return def.options?.find((o) => o.value === value)?.label ?? String(value);
    case 'date':
      return String(value).slice(0, 10);
    default:
      return String(value);
  }
}
