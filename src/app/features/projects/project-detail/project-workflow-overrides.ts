/** One row of the per-project workflow override table (FR-WF-10). `workflowId === ''` means "type default". */
export interface OverrideRow {
  readonly typeId: string;
  readonly workflowId: string;
}

/** Builds the payload of `ProjectsApi.setWorkflowOverrides`: only non-default rows; an empty map clears all overrides. */
export function buildOverrideMap(rows: readonly OverrideRow[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (row.typeId && row.workflowId) map[row.typeId] = row.workflowId;
  }
  return map;
}

/** True when two override maps are equivalent (key order and undefined maps are irrelevant). */
export function sameOverrides(a: Readonly<Record<string, string>> | undefined, b: Readonly<Record<string, string>> | undefined): boolean {
  const x = Object.entries(a ?? {});
  const y = b ?? {};
  return x.length === Object.keys(y).length && x.every(([k, v]) => y[k] === v);
}

export interface ConflictRow {
  /** «النوع / الحالة» as sent by the server. */
  readonly label: string;
  readonly count: number;
}

/** Turns `ApiError.details` of a 422 (label → count) into sortable rows; non-numeric values count as 1. */
export function conflictRows(details: Readonly<Record<string, string>> | undefined): readonly ConflictRow[] {
  return Object.entries(details ?? {})
    .map(([label, value]) => ({ label, count: Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 1 }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ar'));
}
