import { FieldDefinition, FieldValue, TypeChangeConflict, WorkItem, WorkItemType } from '@domain/work-items/work-item.models';

/** A value the server treats as "no value" (null, or an empty / blank string). Booleans and 0 are real values. */
export function isBlank(value: FieldValue | undefined): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/**
 * The fields the user must fill before the item can become `target`: required by the new type and not held by the item yet.
 * Shown inside the type-change dialog so a "field is required" conflict can be fixed on the spot.
 */
export function missingRequiredFields(target: WorkItemType | undefined, item: Pick<WorkItem, 'fields'>): readonly FieldDefinition[] {
  return (target?.fields ?? [])
    .filter((d) => d.required && isBlank(item.fields[d.key]))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

/** The values to send with the type change; blanks are left out and nothing to send gives `undefined`. */
export function fieldsPayload(
  definitions: readonly FieldDefinition[],
  values: Readonly<Record<string, FieldValue | undefined>>,
): Readonly<Record<string, FieldValue>> | undefined {
  const out: Record<string, FieldValue> = {};
  for (const d of definitions) {
    const v = values[d.key];
    if (v !== undefined && !isBlank(v)) out[d.key] = typeof v === 'string' ? v.trim() : v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** The server names a field problem `fields.<key>`. */
export function conflictFieldKey(conflict: TypeChangeConflict): string | null {
  return conflict.field.startsWith('fields.') ? conflict.field.slice('fields.'.length) : null;
}

/**
 * Conflicts to list as text. A "required" conflict of an input that is still empty is not listed: the input itself,
 * marked with *, already asks for it. Once a value is typed, any conflict about it (wrong format, out of range) is listed.
 */
export function visibleConflicts(
  conflicts: readonly TypeChangeConflict[],
  inputs: readonly FieldDefinition[],
  values: Readonly<Record<string, FieldValue | undefined>>,
): readonly TypeChangeConflict[] {
  const empty = new Set(inputs.filter((d) => isBlank(values[d.key])).map((d) => d.key));
  return conflicts.filter((c) => {
    const key = conflictFieldKey(c);
    return key === null || !empty.has(key);
  });
}
