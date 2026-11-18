export interface EditableProjectFields {
  readonly name: string;
  readonly description: string;
  readonly ownerId: string;
  readonly startDate: string;
  readonly endDate: string;
}

export interface FormChange {
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

const day = (iso: string): string => iso.slice(0, 10);

/** Human-readable before/after list for the edit dialog: owners are shown by name, never by id. */
export function projectChanges(
  original: EditableProjectFields,
  next: EditableProjectFields,
  userName: (id: string) => string,
): readonly FormChange[] {
  const changes: FormChange[] = [];
  const push = (label: string, from: string, to: string): void => {
    if (from !== to) changes.push({ label, from: from || '—', to: to || '—' });
  };
  push('الاسم', original.name.trim(), next.name.trim());
  push('الوصف', original.description.trim(), next.description.trim());
  push('المالك', userName(original.ownerId), userName(next.ownerId));
  push('تاريخ البداية', day(original.startDate), day(next.startDate));
  push('تاريخ النهاية', day(original.endDate), day(next.endDate));
  return changes;
}
