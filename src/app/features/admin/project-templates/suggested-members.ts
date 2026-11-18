/** Pure rules for the `suggestedMembers` editor of a project template (FR-PRJ-10). */
export interface MemberRow {
  /** `''` = no user chosen: the row is only a suggested role and adds nobody. */
  readonly userId: string;
  readonly roleId: string;
}

export interface UserInfo {
  readonly name: string;
  readonly active: boolean;
}

export interface RoleInfo {
  readonly name: string;
  readonly scope: 'system' | 'project';
}

export type PreviewStatus = 'added' | 'role-only' | 'inactive' | 'invalid-role' | 'duplicate';

export interface PreviewRow {
  readonly index: number;
  readonly userName: string;
  readonly roleName: string;
  readonly status: PreviewStatus;
}

export const PREVIEW_LABELS: Record<PreviewStatus, string> = {
  added: 'يُضاف تلقائيًا',
  'role-only': 'اقتراح دور فقط (لا يُضاف أحد)',
  inactive: 'يُتخطّى: المستخدم غير نشط',
  'invalid-role': 'يُتخطّى: الدور غير صالح (يجب أن يكون دور مشروع)',
  duplicate: 'يُتخطّى: المستخدم مذكور سابقًا في القائمة',
};

/**
 * What creating a project from the template would do with each row, in the server's order:
 * rows without a user add nobody; inactive users and non-project roles are skipped; the first row of a user wins.
 */
export function previewMembers(
  rows: readonly MemberRow[],
  users: ReadonlyMap<string, UserInfo>,
  roles: ReadonlyMap<string, RoleInfo>,
): PreviewRow[] {
  const taken = new Set<string>();
  return rows.map((row, index) => {
    const role = roles.get(row.roleId);
    const user = users.get(row.userId);
    const base = { index, userName: row.userId ? (user?.name ?? row.userId) : '—', roleName: role?.name ?? '—' };
    if (!row.userId) return { ...base, status: 'role-only' as const };
    if (!user?.active) return { ...base, status: 'inactive' as const };
    if (role?.scope !== 'project') return { ...base, status: 'invalid-role' as const };
    if (taken.has(row.userId)) return { ...base, status: 'duplicate' as const };
    taken.add(row.userId);
    return { ...base, status: 'added' as const };
  });
}

/** Blocking errors per row index: a project role is required and a user may appear once. */
export function memberRowErrors(rows: readonly MemberRow[], roles: ReadonlyMap<string, RoleInfo>): ReadonlyMap<number, string> {
  const errors = new Map<number, string>();
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    if (!row.roleId) errors.set(i, 'اختر دور المشروع.');
    else if (roles.get(row.roleId)?.scope !== 'project') errors.set(i, 'الدور يجب أن يكون دور مشروع.');
    else if (row.userId && seen.has(row.userId)) errors.set(i, 'هذا المستخدم مضاف في صف آخر.');
    if (row.userId) seen.add(row.userId);
  });
  return errors;
}
