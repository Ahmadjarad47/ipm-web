import { HierarchyPair } from '@domain/work-items/work-item.models';

/** Pure helpers behind the hierarchy-rules matrix (FR-REL-01): rows = parent types, columns = child types. */
export type PairSet = ReadonlySet<string>;

export const pairKey = (parentTypeId: string, childTypeId: string): string => `${parentTypeId}>${childTypeId}`;

export function pairsToSet(pairs: readonly HierarchyPair[]): PairSet {
  return new Set(pairs.map((p) => pairKey(p.parentTypeId, p.childTypeId)));
}

export function toggleCell(set: PairSet, parentTypeId: string, childTypeId: string, on: boolean): PairSet {
  const next = new Set(set);
  const key = pairKey(parentTypeId, childTypeId);
  if (on) next.add(key);
  else next.delete(key);
  return next;
}

/** Full pair list in matrix order (rows then columns); keys of unknown types are dropped. */
export function setToPairs(orderedTypeIds: readonly string[], set: PairSet): HierarchyPair[] {
  const pairs: HierarchyPair[] = [];
  for (const parentTypeId of orderedTypeIds) {
    for (const childTypeId of orderedTypeIds) {
      if (set.has(pairKey(parentTypeId, childTypeId))) pairs.push({ parentTypeId, childTypeId });
    }
  }
  return pairs;
}

export function sameSet(a: PairSet, b: PairSet): boolean {
  return a.size === b.size && [...a].every((k) => b.has(k));
}

export interface PairDiff {
  readonly added: number;
  readonly removed: number;
}

export function diffSets(saved: PairSet, draft: PairSet): PairDiff {
  return {
    added: [...draft].filter((k) => !saved.has(k)).length,
    removed: [...saved].filter((k) => !draft.has(k)).length,
  };
}
