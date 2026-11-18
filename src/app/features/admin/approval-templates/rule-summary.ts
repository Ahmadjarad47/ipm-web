import { ApprovalAction, ApprovalEvent, ApprovalRule, RuleCondition } from '@domain/approvals/approval.models';
import { Priority } from '@domain/work-items/work-item.models';

/** Plain-Arabic description of an approval rule (FR-APR-01/13). Pure so it is unit-testable. */

export const ACTION_PHRASES: Readonly<Record<ApprovalAction, string>> = {
  close: 'الإغلاق',
  reopen: 'إعادة الفتح',
  change: 'التعديل',
  activate: 'التفعيل',
};

export const ACTION_LABELS: Readonly<Record<ApprovalAction, string>> = {
  close: 'إغلاق',
  reopen: 'إعادة فتح',
  change: 'تعديل',
  activate: 'تفعيل',
};

export const OP_LABELS: Readonly<Record<RuleCondition['op'], string>> = {
  eq: 'يساوي',
  neq: 'لا يساوي',
  gt: 'أكبر من',
  lt: 'أقل من',
  in: 'ضمن',
};

export interface RuleSummaryContext {
  readonly event: ApprovalEvent;
  readonly typeName: (id: string) => string;
  readonly projectName: (id: string) => string;
  /** Feminine/plural-neutral adjective, e.g. «عالية». */
  readonly priorityLabel: (p: Priority) => string;
  readonly fieldLabel?: (field: string) => string;
}

/** «أ وب» / «أ، ب وج». */
export function joinAr(items: readonly string[], conjunction = 'و'): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join('، ')} ${conjunction}${items[items.length - 1]}`;
}

function subjectNoun(ctx: RuleSummaryContext, rule: ApprovalRule): string {
  if (ctx.event === 'project.approve' || ctx.event === 'project.close') return 'المشاريع';
  if (rule.workItemTypeIds?.length) return joinAr(rule.workItemTypeIds.map(ctx.typeName));
  return ctx.event === 'sensitive.change' ? 'العناصر ذات الحقول المحمية' : 'عناصر العمل';
}

function conditionText(c: RuleCondition, ctx: RuleSummaryContext): string {
  const value = Array.isArray(c.value) ? (c.value as readonly string[]).join('، ') : String(c.value);
  return `${ctx.fieldLabel?.(c.field) ?? c.field} ${OP_LABELS[c.op]} ${value}`;
}

export function summarizeRule(rule: ApprovalRule | undefined, ctx: RuleSummaryContext): string {
  const r = rule ?? {};
  const parts: string[] = [subjectNoun(ctx, r)];
  const isWork = ctx.event === 'workItem.approve' || ctx.event === 'sensitive.change';
  if (isWork && r.priorities?.length) {
    parts.push(r.priorities.length === 1 ? `${ctx.priorityLabel(r.priorities[0])} الأولوية` : `ذات الأولوية ${joinAr(r.priorities.map(ctx.priorityLabel), 'أو ')}`);
  }
  if (r.projectIds?.length) {
    parts.push(r.projectIds.length === 1 ? `في مشروع ${ctx.projectName(r.projectIds[0])}` : `في المشاريع ${joinAr(r.projectIds.map(ctx.projectName))}`);
  }
  if (r.actions?.length) parts.push(`عند ${joinAr(r.actions.map((a) => ACTION_PHRASES[a]), 'أو ')}`);
  if (r.conditions?.length) parts.push(`بشرط ${r.conditions.map((c) => conditionText(c, ctx)).join(' وكذلك ')}`);
  let text = `يُطبَّق على: ${parts.join(' ')}`;
  if (!r.projectIds?.length && !r.actions?.length && !r.priorities?.length && !r.conditions?.length && !r.workItemTypeIds?.length) {
    text += ' — كل الحالات (لا قيود في القاعدة)';
  }
  if (r.priority) text += `. أولوية القاعدة: ${r.priority}`;
  return text;
}

/** Parses the free-text value of a condition row: `in` splits on commas, gt/lt prefer numbers. */
export function parseConditionValue(op: RuleCondition['op'], raw: string): RuleCondition['value'] {
  const text = raw.trim();
  if (op === 'in') return text.split(/[,،]/).map((s) => s.trim()).filter(Boolean);
  if ((op === 'gt' || op === 'lt') && text !== '' && Number.isFinite(Number(text))) return Number(text);
  return text;
}

export function conditionValueText(value: RuleCondition['value']): string {
  return Array.isArray(value) ? (value as readonly string[]).join(', ') : String(value);
}
