import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { PERMISSION_LABELS } from '@core/auth/permission-labels';
import { StatusLookup, WorkflowLookup } from '@domain/workflow/workflow.api';
import { STATUS_CATEGORY_LABELS, Transition } from '@domain/workflow/workflow.models';
import { EmptyState } from '@shared/ui/empty-state/empty-state';
import { Skeleton } from '@shared/ui/skeleton/skeleton';
import { AdminNotice } from '../shared/admin-notice';
import { DiagramLayout, layoutWorkflow, NODE_H, NODE_W, readableTextColor } from './workflow-diagram-layout';

interface RuleBadge {
  readonly text: string;
  readonly title: string;
  readonly width: number;
}

interface NodeView {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly name: string;
  readonly label: string;
  readonly fill: string;
  readonly ink: string;
  readonly initial: boolean;
  readonly aria: string;
}

interface EdgeView {
  readonly key: string;
  readonly fromId: string;
  readonly toId: string;
  readonly path: string;
  readonly mid: { readonly x: number; readonly y: number };
  readonly badges: readonly RuleBadge[];
}

const badge = (text: string, title: string): RuleBadge => ({ text, title, width: text.length * 7 + 14 });

/** Rules of one transition as short badges (permission, assignee, approval, blocked by dependencies). */
export function ruleBadges(t: Transition): readonly RuleBadge[] {
  return [
    ...(t.permission ? [badge('صلاحية', `يتطلب صلاحية: ${PERMISSION_LABELS[t.permission]}`)] : []),
    ...(t.requiresAssignee ? [badge('مكلَّف', 'يتطلب وجود مكلَّف بالعمل')] : []),
    ...(t.requiresApproval ? [badge('موافقة', 'يتطلب موافقة معتمدة')] : []),
    ...(t.blockedByOpenDependencies ? [badge('اعتماديات', 'يُرفض عند وجود اعتماديات مفتوحة تحجب العمل')] : []),
  ];
}

/** «المخطط»: read-only SVG state diagram of the selected workflow, no external libraries (FR-WF). */
@Component({
  selector: 'app-workflow-diagram-tab',
  imports: [AdminNotice, EmptyState, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .scroll { overflow: auto; border: 1px solid var(--c-border); border-radius: var(--r-md); background: var(--c-surface); }
    svg { display: block; margin-inline: auto; }
    .edge { fill: none; stroke: var(--c-text-2); stroke-width: 1.6; transition: opacity 0.15s; }
    .edge.hl { stroke: var(--c-emerald-700); stroke-width: 2.6; }
    .dim { opacity: 0.18; }
    .node { cursor: default; outline: none; }
    .node rect.box { stroke: var(--c-border-strong); stroke-width: 1.5; }
    .node.initial rect.box { stroke: var(--c-gold-500); stroke-width: 3.5; }
    .node:focus-visible rect.ring, .node:hover rect.ring { stroke: var(--c-emerald-700); }
    rect.ring { fill: none; stroke: transparent; stroke-width: 3; }
    .nm { font-size: 14px; font-weight: 700; }
    .tag { font-size: 11px; font-weight: 700; fill: var(--c-gold-600); }
    .bd { fill: var(--c-gold-100); stroke: var(--c-gold-500); }
    .bt { font-size: 10.5px; font-weight: 700; fill: var(--c-gold-600); }
    .legend { display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-4); margin: 0; padding: 0; list-style: none; font-size: var(--fs-xs); color: var(--c-muted); }
    .sw { display: inline-block; inline-size: 12px; block-size: 12px; margin-inline-end: 6px; border-radius: 3px; vertical-align: middle; }
    .tl { display: flex; flex-direction: column; gap: var(--s-1); margin: 0; padding: 0; list-style: none; font-size: var(--fs-sm); }
    .tl li { padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); background: var(--c-surface-2); }
    .rb { display: inline-block; margin-inline-start: var(--s-1); padding: 0 8px; border-radius: var(--r-pill); background: var(--c-gold-100); color: var(--c-gold-600); font-size: var(--fs-xs); font-weight: 700; }
  `,
  template: `
    @if (workflows.loading() && !workflows.items().length) {
      <app-skeleton variant="chart" />
    } @else if (!workflows.items().length) {
      <app-empty-state icon="flow" title="لا توجد مسارات عمل" text="أنشئ مسارًا من تبويب «سير العمل» ليظهر مخططه هنا." />
    } @else if (workflow(); as wf) {
      <div class="stack">
        <div class="card"><div class="card-body">
          <div class="field" style="max-inline-size: 360px">
            <label for="dg-pick">سير العمل</label>
            <select id="dg-pick" class="select" (change)="pick($event)">
              @for (w of workflows.items(); track w.id) {
                <option [value]="w.id" [selected]="w.id === wf.id">{{ w.name }}</option>
              }
            </select>
          </div>
        </div></div>

        <app-admin-notice>المخطط للقراءة فقط ويتبع الحالة المحفوظة للمسار. التعديل من تبويب «سير العمل». يبدأ المسار من اليمين، والسهم يشير إلى الحالة التالية.</app-admin-notice>

        <section class="card" aria-labelledby="dg-title"><div class="card-body stack">
          <h2 class="section-title" id="dg-title">مخطط: {{ wf.name }}</h2>
          <div class="scroll" tabindex="0" role="region" aria-label="مخطط الحالات والانتقالات (قابل للتمرير)">
            <svg [attr.viewBox]="'0 0 ' + layout().width + ' ' + layout().height" [attr.width]="layout().width" [attr.height]="layout().height"
              role="group" [attr.aria-label]="'مخطط سير العمل ' + wf.name + ': ' + nodes().length + ' حالات و' + edges().length + ' انتقالات'">
              <defs>
                <marker id="wf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
                </marker>
              </defs>
              <g aria-hidden="true" style="color: var(--c-text-2)">
                @for (e of edges(); track e.key) {
                  <path class="edge" [class.hl]="isLinked(e)" [class.dim]="active() !== null && !isLinked(e)" [attr.d]="e.path" marker-end="url(#wf-arrow)" />
                }
                @for (e of edges(); track e.key) {
                  @for (b of e.badges; track b.text; let i = $index) {
                    <g [class.dim]="active() !== null && !isLinked(e)" [attr.transform]="'translate(' + (e.mid.x - b.width / 2) + ',' + (e.mid.y - (e.badges.length * 18) / 2 + i * 18) + ')'">
                      <title>{{ b.title }}</title>
                      <rect class="bd" [attr.width]="b.width" height="16" rx="8" />
                      <text class="bt" [attr.x]="b.width / 2" y="11.5" text-anchor="middle">{{ b.text }}</text>
                    </g>
                  }
                }
              </g>
              @for (n of nodes(); track n.id) {
                <g class="node" [class.initial]="n.initial" tabindex="0" role="img" [attr.aria-label]="n.aria"
                  [attr.transform]="'translate(' + n.x + ',' + n.y + ')'"
                  (focus)="active.set(n.id)" (blur)="active.set(null)" (mouseenter)="active.set(n.id)" (mouseleave)="active.set(null)">
                  <rect class="box" [attr.width]="nodeW" [attr.height]="nodeH" rx="10" [attr.fill]="n.fill" />
                  <rect class="ring" x="-3" y="-3" [attr.width]="nodeW + 6" [attr.height]="nodeH + 6" rx="13" />
                  <text class="nm" [attr.x]="nodeW / 2" [attr.y]="nodeH / 2 + 5" text-anchor="middle" [attr.fill]="n.ink">{{ n.label }}</text>
                  @if (n.initial) {
                    <text class="tag" [attr.x]="nodeW" y="-8" text-anchor="end">ابتدائية</text>
                  }
                </g>
              }
            </svg>
          </div>

          <ul class="legend" aria-label="دليل المخطط">
            <li><span class="sw" style="background: transparent; border: 3px solid var(--c-gold-500)"></span>حالة ابتدائية</li>
            <li><span class="sw" style="background: var(--c-text-2)"></span>انتقال مسموح (يشير السهم إلى الحالة التالية)</li>
            <li><span class="rb">صلاحية</span> صلاحية إضافية</li>
            <li><span class="rb">مكلَّف</span> يتطلب مكلَّفًا</li>
            <li><span class="rb">موافقة</span> يتطلب موافقة</li>
            <li><span class="rb">اعتماديات</span> تمنعه اعتماديات مفتوحة</li>
          </ul>
        </div></section>

        <section class="card" aria-labelledby="dg-list"><div class="card-body stack">
          <h3 class="section-title" id="dg-list">الانتقالات كنص ({{ edges().length }})</h3>
          <ul class="tl">
            @for (e of edges(); track e.key) {
              <li>
                <strong>{{ nameOf(e.fromId) }}</strong> ← <strong>{{ nameOf(e.toId) }}</strong>
                @for (b of e.badges; track b.text) { <span class="rb" [attr.title]="b.title">{{ b.text }}</span> }
              </li>
            } @empty {
              <li class="muted">لا توجد انتقالات في هذا المسار.</li>
            }
          </ul>
        </div></section>
      </div>
    }
  `,
})
export class WorkflowDiagramTab {
  protected readonly workflows = inject(WorkflowLookup);
  private readonly statuses = inject(StatusLookup);

  protected readonly nodeW = NODE_W;
  protected readonly nodeH = NODE_H;
  protected readonly active = signal<string | null>(null);
  private readonly selectedId = signal<string | null>(null);
  protected readonly workflow = computed(() => this.workflows.get(this.selectedId()) ?? this.workflows.items()[0]);

  protected readonly layout = computed<DiagramLayout>(() => {
    const wf = this.workflow();
    return layoutWorkflow({ statusIds: wf?.statusIds ?? [], initialId: wf?.initialStatusId ?? '', transitions: wf?.transitions ?? [] });
  });

  private readonly transitionIndex = computed(
    () => new Map((this.workflow()?.transitions ?? []).map((t) => [`${t.fromStatusId}>${t.toStatusId}`, t] as const)),
  );

  protected readonly nodes = computed<readonly NodeView[]>(() => {
    const transitions = this.workflow()?.transitions ?? [];
    return this.layout().nodes.map((n) => {
      const status = this.statuses.get(n.id);
      const name = status?.name ?? '—';
      const out = [...new Set(transitions.filter((t) => t.fromStatusId === n.id).map((t) => this.nameOf(t.toStatusId)))];
      const into = [...new Set(transitions.filter((t) => t.toStatusId === n.id).map((t) => this.nameOf(t.fromStatusId)))];
      const parts = [
        `الحالة ${name}`,
        ...(n.initial ? ['حالة ابتدائية'] : []),
        ...(status ? [`فئة الحالة ${STATUS_CATEGORY_LABELS[status.category]}`] : []),
        out.length ? `تنتقل إلى: ${out.join('، ')}` : 'لا انتقالات خارجة',
        into.length ? `تصلها من: ${into.join('، ')}` : 'لا انتقالات واردة',
      ];
      const color = status?.color ?? '#6b7280';
      return {
        id: n.id,
        x: n.x,
        y: n.y,
        name,
        label: name.length > 16 ? `${name.slice(0, 15)}…` : name,
        fill: color,
        ink: readableTextColor(color),
        initial: n.initial,
        aria: parts.join('. '),
      };
    });
  });

  protected readonly edges = computed<readonly EdgeView[]>(() =>
    this.layout().edges.map((e) => ({
      key: `${e.fromId}>${e.toId}`,
      fromId: e.fromId,
      toId: e.toId,
      path: e.path,
      mid: e.mid,
      badges: ruleBadges(this.transitionIndex().get(`${e.fromId}>${e.toId}`) ?? { fromStatusId: e.fromId, toStatusId: e.toId }),
    })),
  );

  protected nameOf(id: string): string {
    return this.statuses.get(id)?.name ?? '—';
  }

  protected isLinked(e: EdgeView): boolean {
    const a = this.active();
    return a !== null && (e.fromId === a || e.toId === a);
  }

  protected pick(event: Event): void {
    this.selectedId.set((event.target as HTMLSelectElement).value);
  }
}
