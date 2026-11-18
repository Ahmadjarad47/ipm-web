/** Pure helpers behind the relation type «allowed pairs» editor (FR-REL-04): source types × target types, or any. */
export interface TypePair {
  readonly sourceTypeId: string;
  readonly targetTypeId: string;
}

export type AllowedSet = ReadonlySet<string>;

export const allowedKey = (sourceTypeId: string, targetTypeId: string): string => `${sourceTypeId}>${targetTypeId}`;

/** Empty or absent pairs mean «any type» on the server. */
export function isAnyType(pairs: readonly TypePair[] | undefined): boolean {
  return !pairs?.length;
}

export function pairsToAllowedSet(pairs: readonly TypePair[] | undefined): AllowedSet {
  return new Set((pairs ?? []).map((p) => allowedKey(p.sourceTypeId, p.targetTypeId)));
}

/**
 * Toggles one cell. For a symmetric (undirected) relation the server accepts a pair in both directions,
 * so the editor keeps the matrix mirrored to avoid showing a pair as «off» that would still be accepted.
 */
export function toggleAllowed(set: AllowedSet, sourceTypeId: string, targetTypeId: string, on: boolean, symmetric: boolean): AllowedSet {
  const next = new Set(set);
  const keys = [allowedKey(sourceTypeId, targetTypeId), ...(symmetric ? [allowedKey(targetTypeId, sourceTypeId)] : [])];
  for (const k of keys) {
    if (on) next.add(k);
    else next.delete(k);
  }
  return next;
}

/** Pair list to send: `[]` for «any type», otherwise the selected cells in matrix order (unknown types dropped). */
export function buildAllowedPairs(orderedTypeIds: readonly string[], anyType: boolean, selected: AllowedSet): TypePair[] {
  if (anyType) return [];
  const pairs: TypePair[] = [];
  for (const sourceTypeId of orderedTypeIds) {
    for (const targetTypeId of orderedTypeIds) {
      if (selected.has(allowedKey(sourceTypeId, targetTypeId))) pairs.push({ sourceTypeId, targetTypeId });
    }
  }
  return pairs;
}

/** «Specific types» with nothing selected would silently become «any», so it is rejected before saving. */
export function allowedPairsError(anyType: boolean, selected: AllowedSet): string | null {
  return !anyType && selected.size === 0 ? 'اختر زوجًا واحدًا على الأقل، أو فعّل «أي نوع».' : null;
}

/** Makes a selection symmetric (used when a relation type is switched to undirected). */
export function mirror(set: AllowedSet): AllowedSet {
  const next = new Set(set);
  for (const k of set) {
    const [s, t] = k.split('>');
    next.add(allowedKey(t, s));
  }
  return next;
}
