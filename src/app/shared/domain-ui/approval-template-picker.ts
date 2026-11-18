import { ChangeDetectionStrategy, Component, computed, effect, inject, input, model, untracked } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { forkJoin, map } from 'rxjs';
import { ApprovalTemplatesApi } from '@domain/approvals/approval.api';
import {
  APPROVAL_EVENT_LABELS,
  APPROVER_POSITION_LABELS,
  ApprovalAction,
  ApprovalStage,
  ApprovalSubject,
  ApprovalTemplate,
  ApproverPosition,
} from '@domain/approvals/approval.models';
import { RoleLookup, UserLookup } from '@domain/users/user.api';

export interface MatchedTemplate {
  readonly template: ApprovalTemplate;
  /** Actions for which the server resolves this template. */
  readonly actions: readonly ApprovalAction[];
}

const ALL_ACTIONS: readonly ApprovalAction[] = ['close', 'activate', 'reopen', 'change'];
const ACTION_NAMES: Record<ApprovalAction, string> = { close: 'الإغلاق', reopen: 'إعادة الفتح', change: 'التعديل', activate: 'التفعيل' };

/** Pure: dedupe per-action matches into one entry per template, keeping the order of first appearance. */
export function groupMatches(results: readonly { readonly action: ApprovalAction; readonly template: ApprovalTemplate | null }[]): MatchedTemplate[] {
  const byId = new Map<string, { template: ApprovalTemplate; actions: ApprovalAction[] }>();
  for (const r of results) {
    if (!r.template) continue;
    const entry = byId.get(r.template.id);
    if (entry) entry.actions.push(r.action);
    else byId.set(r.template.id, { template: r.template, actions: [r.action] });
  }
  return [...byId.values()];
}

/**
 * Shows which template the server will apply to a subject (FR-APR-01/13), with a stage preview.
 * Only templates the server resolves for this subject are offered, so a manual choice can never be rejected as «not applicable».
 */
@Component({
  selector: 'app-approval-template-picker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (matches.isLoading()) {
      <p class="muted" role="status">جارٍ تحديد قالب الموافقة المناسب…</p>
    } @else if (matches.error()) {
      <p class="err" role="alert">تعذّر تحديد قالب الموافقة. أعد فتح النافذة والمحاولة مجددًا.</p>
    } @else if (!options().length) {
      <div class="none" role="status">
        <strong>لا يوجد قالب موافقة مطابق</strong>
        <span>لا ينطبق أي قالب نشط على هذا العنصر. اطلب من مدير الموافقات إنشاء قالب أو تفعيله من «قوالب الموافقات»؛ لا يمكن إرسال الطلب قبل ذلك.</span>
      </div>
    } @else {
      @if (selected(); as t) {
        <p class="applied" role="status">سيُطبَّق قالب: <strong>{{ t.name }}</strong> <span class="muted">({{ eventLabel(t) }})</span></p>
      }
      @if (options().length > 1) {
        <fieldset class="opts">
          <legend>قوالب أخرى مقبولة لهذا العنصر</legend>
          @for (o of options(); track o.template.id) {
            <label class="opt">
              <input type="radio" name="tpl-pick" [checked]="selected()?.id === o.template.id" (change)="selected.set(o.template)" />
              <span>{{ o.template.name }} <span class="muted">— عند {{ actionsText(o) }}</span></span>
            </label>
          }
        </fieldset>
      }
      @if (selected(); as t) {
        <ol class="stages" aria-label="مراحل الموافقة">
          @for (s of orderedStages(t); track s.order) {
            <li>
              <span class="n">{{ s.order }}</span>
              <span class="t">
                <strong>{{ s.name }}</strong>
                <small class="muted">{{ approver(s) }}@if (s.dueHours) { · المهلة {{ s.dueHours }} ساعة }</small>
              </span>
            </li>
          }
        </ol>
      }
    }
  `,
  styles: `
    :host { display: grid; gap: var(--s-3); }
    .err { color: var(--c-danger); margin: 0; }
    .none { display: grid; gap: var(--s-1); padding: var(--s-3); border-radius: var(--r-md); background: var(--c-warning-bg); color: var(--c-warning); }
    .applied { margin: 0; padding: var(--s-2) var(--s-3); border-radius: var(--r-md); background: var(--c-success-bg); color: var(--c-success); }
    .opts { border: 0; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
    .opts legend { font-size: var(--fs-sm); font-weight: 600; margin-bottom: var(--s-1); }
    .opt { display: flex; align-items: center; gap: var(--s-2); padding: var(--s-2) var(--s-3); border: 1px solid var(--c-border); border-radius: var(--r-md); cursor: pointer; }
    .stages { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
    .stages li { display: flex; gap: var(--s-2); align-items: center; padding: var(--s-2) var(--s-3); border: 1px solid var(--c-border); border-radius: var(--r-md); background: var(--c-surface-2); }
    .n { display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--c-primary); color: #fff; font-size: var(--fs-xs); font-weight: 700; flex-shrink: 0; }
    .t { display: flex; flex-direction: column; line-height: 1.3; }
  `,
})
export class ApprovalTemplatePicker {
  readonly subjectType = input.required<ApprovalSubject>();
  readonly subjectId = input.required<string>();
  /** The action the user is requesting; its template is listed first and preselected. */
  readonly preferredAction = input<ApprovalAction>('close');
  /** Template the user is submitting with (null while loading or when none matches). */
  readonly selected = model<ApprovalTemplate | null>(null);

  private readonly api = inject(ApprovalTemplatesApi);
  private readonly users = inject(UserLookup);
  private readonly roles = inject(RoleLookup);

  protected readonly matches = rxResource<readonly MatchedTemplate[], { type: ApprovalSubject; id: string; first: ApprovalAction }>({
    params: () => ({ type: this.subjectType(), id: this.subjectId(), first: this.preferredAction() }),
    stream: ({ params }) =>
      forkJoin([params.first, ...ALL_ACTIONS.filter((a) => a !== params.first)].map((action) => this.api.matchTemplate(params.type, params.id, action).pipe(map((template) => ({ action, template }))))).pipe(map(groupMatches)),
    defaultValue: [],
  });

  protected readonly options = computed(() => (this.matches.hasValue() ? this.matches.value() : []));

  constructor() {
    effect(() => {
      const opts = this.options();
      untracked(() => {
        const current = this.selected();
        if (!opts.length) this.selected.set(null);
        else if (!current || !opts.some((o) => o.template.id === current.id)) this.selected.set(opts[0].template);
      });
    });
  }

  protected eventLabel(t: ApprovalTemplate): string {
    return APPROVAL_EVENT_LABELS[t.event];
  }

  protected actionsText(o: MatchedTemplate): string {
    return o.actions.map((a) => ACTION_NAMES[a]).join(' أو ');
  }

  protected orderedStages(t: ApprovalTemplate): readonly ApprovalStage[] {
    return [...t.stages].sort((a, b) => a.order - b.order);
  }

  protected approver(s: ApprovalStage): string {
    if (s.approverKind === 'user') return this.users.nameOf(s.approverId);
    if (s.approverKind === 'role') return `الدور: ${this.roles.get(s.approverId)?.name ?? '—'}`;
    return APPROVER_POSITION_LABELS[s.approverId as ApproverPosition] ?? 'منصب';
  }
}
