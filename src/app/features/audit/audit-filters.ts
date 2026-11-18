/** UI state of the audit filter bar; mirrored into the list store and shown as removable chips. */
export interface AuditUiFilters {
  readonly search: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly subjectType: string;
  readonly action: string;
  readonly subjectId: string;
  readonly correlationId: string;
  readonly security: boolean;
  readonly from: string;
  readonly to: string;
}

export const EMPTY_AUDIT_FILTERS: AuditUiFilters = {
  search: '', projectId: '', actorId: '', subjectType: '', action: '', subjectId: '', correlationId: '', security: false, from: '', to: '',
};

export type AuditFilterKey = keyof AuditUiFilters;

export const AUDIT_FILTER_NAMES: Readonly<Record<AuditFilterKey, string>> = {
  search: 'بحث', projectId: 'المشروع', actorId: 'المنفّذ', subjectType: 'نوع الموضوع', action: 'الإجراء',
  subjectId: 'معرّف الموضوع', correlationId: 'معرّف الارتباط', security: 'أحداث أمنية', from: 'من', to: 'إلى',
};

export interface FilterChip {
  readonly key: AuditFilterKey;
  readonly label: string;
}

/** Active filters as chips; `display` resolves ids and keys to readable text. */
export function activeChips(f: AuditUiFilters, display: (key: AuditFilterKey, value: string) => string): readonly FilterChip[] {
  const chips: FilterChip[] = [];
  for (const key of Object.keys(AUDIT_FILTER_NAMES) as AuditFilterKey[]) {
    const value = f[key];
    if (value === '' || value === false) continue;
    chips.push({ key, label: `${AUDIT_FILTER_NAMES[key]}: ${typeof value === 'boolean' ? 'نعم' : display(key, value)}` });
  }
  return chips;
}
