import { BulkDecideResult, Delegation, DelegationCreate } from '@domain/approvals/approval.models';

/** Pure helpers for the approvals centre (kept free of Angular so they are unit-testable). */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function plural(n: number, one: string, two: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n >= 3 && n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
}

function span(ms: number): string {
  const abs = Math.abs(ms);
  if (abs < HOUR) return 'أقل من ساعة';
  if (abs < DAY) return plural(Math.floor(abs / HOUR), 'ساعة', 'ساعتان', 'ساعات', 'ساعة');
  return plural(Math.floor(abs / DAY), 'يوم', 'يومان', 'أيام', 'يومًا');
}

/** «منذ 3 أيام» for an ISO timestamp. */
export function ageText(iso: string, now: number = Date.now()): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  return ms < HOUR ? 'منذ أقل من ساعة' : `منذ ${span(ms)}`;
}

export type SlaState = 'none' | 'ok' | 'soon' | 'overdue';

/** Where a pending request stands against its stage due date (`soon` = under 4 hours left). */
export function slaState(stageDueAt: string | null | undefined, pending: boolean, now: number = Date.now()): SlaState {
  if (!pending || !stageDueAt) return 'none';
  const left = Date.parse(stageDueAt) - now;
  if (!Number.isFinite(left)) return 'none';
  return left < 0 ? 'overdue' : left < 4 * HOUR ? 'soon' : 'ok';
}

export function slaText(stageDueAt: string | null | undefined, pending: boolean, now: number = Date.now()): string {
  const state = slaState(stageDueAt, pending, now);
  if (state === 'none') return '';
  const diff = Date.parse(stageDueAt as string) - now;
  return state === 'overdue' ? `تأخّر ${span(diff)}` : `المهلة المتبقية: ${span(diff)}`;
}

export interface BulkSummary {
  readonly total: number;
  readonly okIds: readonly string[];
  readonly failed: readonly { readonly id: string; readonly message: string }[];
}

/** Splits a bulk-decide response into succeeded ids and failures with a readable reason. */
export function summarizeBulk(results: readonly BulkDecideResult[]): BulkSummary {
  const okIds = results.filter((r) => r.ok).map((r) => r.id);
  const failed = results.filter((r) => !r.ok).map((r) => ({ id: r.id, message: r.message?.trim() || 'رفض الخادم هذا الطلب دون ذكر السبب.' }));
  return { total: results.length, okIds, failed };
}

export function bulkHeadline(s: BulkSummary): string {
  if (!s.total) return 'لم يُحدَّد أي طلب.';
  if (!s.failed.length) return `تمت الموافقة على ${s.okIds.length} من ${s.total} طلبًا.`;
  if (!s.okIds.length) return `لم تتم الموافقة على أي طلب (${s.failed.length}).`;
  return `تمت الموافقة على ${s.okIds.length} وتعذّرت ${s.failed.length} من ${s.total}.`;
}

export interface DiffRow {
  readonly field: string;
  readonly label: string;
  readonly before: string;
  readonly after: string;
  readonly changed: boolean;
}

type Raw = string | number | null | undefined;

/** Before/after rows for a `sensitive.change` request; `display` turns ids into readable names. */
export function diffRows(
  snapshot: Readonly<Record<string, Raw>>,
  proposed: Readonly<Record<string, Raw>>,
  labelOf: (field: string) => string,
  display: (field: string, value: Raw, side: 'before' | 'after') => string = (_f, v) => (v === null || v === undefined || v === '' ? '—' : String(v)),
): DiffRow[] {
  return Object.keys(proposed).map((field) => {
    const before = display(field, snapshot[field], 'before');
    const after = display(field, proposed[field], 'after');
    return { field, label: labelOf(field), before, after, changed: before !== after };
  });
}

export const MAX_DELEGATION_DAYS = 90;

export interface DelegationInput {
  readonly fromUserId: string;
  readonly toUserId: string;
  readonly from: string;
  readonly to: string;
  readonly reason: string;
}

/** Client-side mirror of the server delegation rules; returns field -> Arabic message. */
export function validateDelegation(v: DelegationInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!v.toUserId) errors['toUserId'] = 'اختر المفوَّض إليه.';
  else if (v.toUserId === v.fromUserId) errors['toUserId'] = 'لا يمكن التفويض لنفسك.';
  if (!v.from) errors['from'] = 'تاريخ البداية مطلوب.';
  if (!v.to) errors['to'] = 'تاريخ النهاية مطلوب.';
  if (v.from && v.to) {
    const days = (Date.parse(v.to) - Date.parse(v.from)) / DAY + 1;
    if (days < 1) errors['to'] = 'تاريخ النهاية يسبق البداية.';
    else if (days > MAX_DELEGATION_DAYS) errors['to'] = `أقصى مدة للتفويض ${MAX_DELEGATION_DAYS} يومًا.`;
  }
  if (!v.reason.trim()) errors['reason'] = 'السبب مطلوب.';
  return errors;
}

export function toDelegationCreate(v: DelegationInput, asAdminFor: boolean): DelegationCreate {
  return { ...(asAdminFor ? { fromUserId: v.fromUserId } : {}), toUserId: v.toUserId, from: v.from, to: v.to, reason: v.reason.trim() };
}

/** Delegations currently in force on `today` (YYYY-MM-DD). */
export function isInForce(d: Delegation, today: string): boolean {
  return d.active && d.from <= today && today <= d.to;
}
