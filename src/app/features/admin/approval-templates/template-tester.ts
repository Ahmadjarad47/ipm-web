import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { rxResource } from '@core/state/safe-resource';
import { FormsModule } from '@angular/forms';
import { ApprovalTemplatesApi } from '@domain/approvals/approval.api';
import { ApprovalAction, ApprovalEvent, ApprovalSubject, ApprovalTemplate, APPROVAL_EVENT_LABELS } from '@domain/approvals/approval.models';
import { ProjectLookup } from '@domain/projects/project.api';
import { WorkItemsApi, WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { PRIORITY_LABELS } from '@domain/work-items/work-item.models';
import { emptyPage, PagedResult } from '@core/models/entity.model';
import { WorkItem } from '@domain/work-items/work-item.models';
import { ACTION_LABELS, summarizeRule } from './rule-summary';

const ACTIONS = Object.keys(ACTION_LABELS) as ApprovalAction[];

const DEFAULT_ACTION: Record<ApprovalEvent, ApprovalAction> = {
  'project.approve': 'activate',
  'project.close': 'close',
  'workItem.approve': 'close',
  'sensitive.change': 'change',
};

/** «اختبر القالب»: asks the server which saved, active template would govern a real project / work item. */
@Component({
  selector: 'app-template-tester',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host { display: grid; gap: var(--s-3); }
    .result { padding: var(--s-3); border-radius: var(--r-md); background: var(--c-surface-2); display: grid; gap: var(--s-1); }
    .result.ok { background: var(--c-success-bg); color: var(--c-success); }
    .result.other { background: var(--c-warning-bg); color: var(--c-warning); }
    .result.none { background: var(--c-danger-bg); color: var(--c-danger); }
  `,
  template: `
    <p class="muted">يختبر القوالب <strong>المحفوظة والنشطة</strong> على الخادم؛ احفظ التعديلات أولًا لاختبارها.</p>
    <div class="form-grid">
      <div class="field">
        <label for="tt-project">المشروع</label>
        <select id="tt-project" class="select" [ngModel]="projectId()" (ngModelChange)="projectId.set($event); workItemId.set(''); result.set(null)">
          <option value="">— اختر مشروعًا —</option>
          @for (p of projects.items(); track p.id) {
            <option [value]="p.id">{{ p.code }} — {{ p.name }}</option>
          }
        </select>
      </div>
      @if (subject() === 'workItem') {
        <div class="field">
          <label for="tt-item">عنصر العمل</label>
          <select id="tt-item" class="select" [ngModel]="workItemId()" (ngModelChange)="workItemId.set($event); result.set(null)" [disabled]="!projectId()">
            <option value="">— اختر عنصرًا —</option>
            @for (w of items.value().items; track w.id) {
              <option [value]="w.id">{{ w.ref }} — {{ w.title }}</option>
            }
          </select>
        </div>
      }
      <div class="field">
        <label for="tt-action">الإجراء</label>
        <select id="tt-action" class="select" [ngModel]="effectiveAction()" (ngModelChange)="action.set($event); result.set(null)">
          @for (a of actions; track a) {
            <option [value]="a">{{ actionLabels[a] }}</option>
          }
        </select>
      </div>
    </div>
    <div>
      <button type="button" class="btn btn--outline" [disabled]="!subjectId() || testing()" (click)="run()">{{ testing() ? 'جارٍ الاختبار…' : 'اختبر القالب' }}</button>
    </div>
    @if (outcome(); as o) {
      <div [class]="'result ' + o.tone" role="status">
        <strong>{{ o.title }}</strong>
        @if (o.detail) {
          <span>{{ o.detail }}</span>
        }
      </div>
    }
  `,
})
export class TemplateTester {
  readonly subject = input.required<ApprovalSubject>();
  readonly event = input.required<ApprovalEvent>();
  /** The template being edited (null when new). */
  readonly templateId = input<string | null>(null);

  private readonly api = inject(ApprovalTemplatesApi);
  private readonly workItems = inject(WorkItemsApi);
  private readonly types = inject(WorkItemTypeLookup);
  protected readonly projects = inject(ProjectLookup);

  protected readonly actions = ACTIONS;
  protected readonly actionLabels = ACTION_LABELS;
  protected readonly projectId = signal('');
  protected readonly workItemId = signal('');
  protected readonly action = signal<ApprovalAction | null>(null);
  protected readonly testing = signal(false);
  protected readonly result = signal<{ readonly match: ApprovalTemplate | null } | null>(null);

  protected readonly effectiveAction = computed<ApprovalAction>(() => this.action() ?? DEFAULT_ACTION[this.event()]);
  protected readonly subjectId = computed(() => (this.subject() === 'project' ? this.projectId() : this.workItemId()));

  protected readonly items = rxResource<PagedResult<WorkItem>, string | undefined>({
    params: () => (this.subject() === 'workItem' && this.projectId() ? this.projectId() : undefined),
    stream: ({ params }) => this.workItems.list({ page: 1, pageSize: 50, filters: { projectId: params as string } }),
    defaultValue: emptyPage<WorkItem>(50),
  });

  protected readonly outcome = computed(() => {
    const r = this.result();
    if (!r) return null;
    const match = r.match;
    if (!match) return { tone: 'none', title: 'لا ينطبق أي قالب نشط على هذا العنصر والإجراء.', detail: 'لن تُطلب موافقة، أو سيُرفض الإجراء إن كان محميًا.' };
    const why = this.why(match);
    if (match.id === this.templateId()) return { tone: 'ok', title: `سيُطبَّق هذا القالب «${match.name}».`, detail: why };
    return { tone: 'other', title: `سيُطبَّق قالب «${match.name}» (${APPROVAL_EVENT_LABELS[match.event]}).`, detail: why };
  });

  protected run(): void {
    this.testing.set(true);
    this.result.set(null);
    this.api.matchTemplate(this.subject(), this.subjectId(), this.effectiveAction()).subscribe({
      next: (match) => {
        this.testing.set(false);
        this.result.set({ match });
      },
      error: () => this.testing.set(false),
    });
  }

  /** Why this one wins: the engine takes the highest rule priority, then the most specific rule, then the oldest. */
  private why(t: ApprovalTemplate): string {
    const summary = summarizeRule(t.rule, {
      event: t.event,
      typeName: (id) => this.types.get(id)?.name ?? id,
      projectName: (id) => this.projects.get(id)?.name ?? id,
      priorityLabel: (p) => PRIORITY_LABELS[p],
    });
    return `${summary}. الاختيار: الأعلى أولوية قاعدة (${t.rule?.priority ?? 0})، ثم الأكثر تحديدًا، ثم الأقدم.`;
  }
}
