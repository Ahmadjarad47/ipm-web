import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, signal } from '@angular/core';
import { ApprovalAction, ApprovalEvent, ApprovalRule, RuleCondition } from '@domain/approvals/approval.models';
import { ProjectLookup } from '@domain/projects/project.api';
import { WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { PRIORITY_LABELS, Priority } from '@domain/work-items/work-item.models';
import { Icon } from '@shared/ui/icon/icon';
import { ACTION_LABELS, conditionValueText, OP_LABELS, parseConditionValue } from './rule-summary';

const PRIORITIES = Object.keys(PRIORITY_LABELS) as Priority[];
const ACTIONS = Object.keys(ACTION_LABELS) as ApprovalAction[];
const OPS = Object.keys(OP_LABELS) as RuleCondition['op'][];

/** Fields a condition may inspect (the engine reads them from the subject record). */
const CONDITION_FIELDS: readonly { readonly key: string; readonly label: string }[] = [
  { key: 'title', label: 'العنوان' },
  { key: 'name', label: 'الاسم' },
  { key: 'priority', label: 'الأولوية' },
  { key: 'typeId', label: 'النوع' },
  { key: 'statusId', label: 'الحالة' },
  { key: 'dueDate', label: 'تاريخ الاستحقاق' },
  { key: 'startDate', label: 'تاريخ البداية' },
  { key: 'endDate', label: 'تاريخ النهاية' },
  { key: 'ownerId', label: 'المالك' },
];

interface ConditionRow {
  readonly field: string;
  readonly op: RuleCondition['op'];
  readonly value: string;
}

/** Visual editor for `ApprovalRule` (FR-APR-01/13). Two-way bound through `rule`. */
@Component({
  selector: 'app-rule-editor',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: grid; gap: var(--s-4); }
    fieldset { margin: 0; padding: 0; border: 0; min-width: 0; }
    legend { font-size: var(--fs-sm); font-weight: 600; color: var(--c-text-2); margin-bottom: var(--s-2); }
    .chips { display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-4); max-block-size: 140px; overflow: auto; }
    .cond { display: grid; grid-template-columns: 1fr 0.7fr 1fr auto; gap: var(--s-2); align-items: center; margin-block-end: var(--s-2); }
    @media (max-width: 700px) { .cond { grid-template-columns: 1fr 1fr; } }
    .na { color: var(--c-muted); font-size: var(--fs-xs); }
    .prio { max-inline-size: 140px; }
  `,
  template: `
    <fieldset [disabled]="!isWork()">
      <legend>أنواع عناصر العمل</legend>
      @if (!isWork()) {
        <p class="na">لا ينطبق على أحداث المشاريع.</p>
      }
      <div class="chips">
        @for (t of types.items(); track t.id) {
          <label class="checkbox">
            <input type="checkbox" [checked]="has(rule().workItemTypeIds, t.id)" (change)="toggle('workItemTypeIds', t.id, $any($event.target).checked)" />
            {{ t.name }}
          </label>
        }
      </div>
      <span class="hint">بلا اختيار = كل الأنواع.</span>
    </fieldset>

    <fieldset>
      <legend>المشاريع</legend>
      <div class="chips">
        @for (p of projects.items(); track p.id) {
          <label class="checkbox">
            <input type="checkbox" [checked]="has(rule().projectIds, p.id)" (change)="toggle('projectIds', p.id, $any($event.target).checked)" />
            <span class="ltr">{{ p.code }}</span> {{ p.name }}
          </label>
        }
      </div>
      <span class="hint">بلا اختيار = كل المشاريع.</span>
    </fieldset>

    <fieldset [disabled]="!isWork()">
      <legend>الأولويات</legend>
      <div class="chips">
        @for (p of priorities; track p) {
          <label class="checkbox">
            <input type="checkbox" [checked]="has(rule().priorities, p)" (change)="toggle('priorities', p, $any($event.target).checked)" />
            {{ priorityLabels[p] }}
          </label>
        }
      </div>
    </fieldset>

    <fieldset>
      <legend>الإجراءات التي تشملها القاعدة</legend>
      <div class="chips">
        @for (a of actions; track a) {
          <label class="checkbox">
            <input type="checkbox" [checked]="has(rule().actions, a)" (change)="toggle('actions', a, $any($event.target).checked)" />
            {{ actionLabels[a] }}
          </label>
        }
      </div>
      <span class="hint">بلا اختيار = أي إجراء.</span>
    </fieldset>

    <fieldset>
      <legend>شروط إضافية</legend>
      @for (c of rows(); track $index; let i = $index) {
        <div class="cond">
          <select class="select" [attr.aria-label]="'حقل الشرط ' + (i + 1)" (change)="patchRow(i, { field: $any($event.target).value })">
            @for (f of fields; track f.key) {
              <option [value]="f.key" [selected]="f.key === c.field">{{ f.label }}</option>
            }
          </select>
          <select class="select" [attr.aria-label]="'عامل الشرط ' + (i + 1)" (change)="patchRow(i, { op: $any($event.target).value })">
            @for (o of ops; track o) {
              <option [value]="o" [selected]="o === c.op">{{ opLabels[o] }}</option>
            }
          </select>
          <input class="input ltr" [value]="c.value" [attr.aria-label]="'قيمة الشرط ' + (i + 1)" [placeholder]="c.op === 'in' ? 'قيمة1, قيمة2' : 'القيمة'" (input)="patchRow(i, { value: $any($event.target).value })" />
          <button type="button" class="btn btn--ghost btn--sm btn--icon" [attr.aria-label]="'حذف الشرط ' + (i + 1)" (click)="removeRow(i)"><app-icon name="trash" [size]="15" /></button>
        </div>
      }
      <button type="button" class="btn btn--outline btn--sm" (click)="addRow()"><app-icon name="plus" [size]="14" /> شرط</button>
    </fieldset>

    <div class="field prio">
      <label for="rule-priority">أولوية القاعدة</label>
      <input id="rule-priority" type="number" class="input ltr" min="0" step="1" [value]="rule().priority ?? ''" (input)="setPriority($any($event.target).value)" />
      <span class="hint">عند تطابق أكثر من قالب يفوز الأعلى رقمًا، ثم الأكثر تحديدًا.</span>
    </div>
  `,
})
export class RuleEditor {
  readonly rule = model.required<ApprovalRule>();
  readonly event = input.required<ApprovalEvent>();

  protected readonly types = inject(WorkItemTypeLookup);
  protected readonly projects = inject(ProjectLookup);
  protected readonly priorities = PRIORITIES;
  protected readonly priorityLabels = PRIORITY_LABELS;
  protected readonly actions = ACTIONS;
  protected readonly actionLabels = ACTION_LABELS;
  protected readonly ops = OPS;
  protected readonly opLabels = OP_LABELS;
  protected readonly fields = CONDITION_FIELDS;
  protected readonly isWork = computed(() => this.event() === 'workItem.approve' || this.event() === 'sensitive.change');

  /** Draft rows keep the raw text the admin typed (the rule stores the parsed value). */
  protected readonly rows = signal<readonly ConditionRow[]>([]);
  private seeded = false;

  constructor() {
    // The model value only exists once the parent bound it, so rows are seeded from the first value.
    effect(() => {
      const rule = this.rule();
      if (this.seeded) return;
      this.seeded = true;
      this.rows.set((rule.conditions ?? []).map((c) => ({ field: c.field, op: c.op, value: conditionValueText(c.value) })));
    });
  }

  protected has<T extends string>(list: readonly T[] | undefined, value: T): boolean {
    return !!list?.includes(value);
  }

  protected toggle(key: 'workItemTypeIds' | 'projectIds' | 'priorities' | 'actions', value: string, checked: boolean): void {
    const current = (this.rule()[key] ?? []) as readonly string[];
    const next = checked ? [...current.filter((v) => v !== value), value] : current.filter((v) => v !== value);
    this.rule.set({ ...this.rule(), [key]: next });
  }

  protected setPriority(raw: string): void {
    const n = raw.trim() === '' ? undefined : Math.trunc(Number(raw));
    this.rule.set({ ...this.rule(), priority: n !== undefined && Number.isFinite(n) ? n : undefined });
  }

  protected addRow(): void {
    this.writeRows([...this.rows(), { field: 'title', op: 'eq', value: '' }]);
  }

  protected removeRow(i: number): void {
    this.writeRows(this.rows().filter((_, idx) => idx !== i));
  }

  protected patchRow(i: number, patch: Partial<ConditionRow>): void {
    this.writeRows(this.rows().map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  private writeRows(rows: readonly ConditionRow[]): void {
    this.rows.set(rows);
    const conditions = rows.filter((r) => r.value.trim()).map((r): RuleCondition => ({ field: r.field, op: r.op, value: parseConditionValue(r.op, r.value) }));
    this.rule.set({ ...this.rule(), conditions });
  }
}
