import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { RelationType, WorkItem, WorkItemRelation } from '@domain/work-items/work-item.models';
import { RelationTypeLookup, WorkItemTypeLookup } from '@domain/work-items/work-item.api';
import { StatusLookup } from '@domain/workflow/workflow.api';
import { EmptyState } from '@shared/ui/empty-state/empty-state';

export type GraphMode = 'dependencies' | 'hierarchy';

interface GraphNode {
  readonly item: WorkItem;
  readonly x: number;
  readonly y: number;
  readonly level: number;
  readonly color: string;
  readonly typeName: string;
  readonly statusName: string;
  readonly statusColor: string;
  readonly blocked: boolean;
  readonly title: string;
}

interface GraphEdge {
  readonly key: string;
  readonly from: string;
  readonly to: string;
  readonly path: string;
  readonly kind: 'blocks' | 'duplicates' | 'relates' | 'parent' | 'other';
  readonly directed: boolean;
  readonly label: string;
}

const NODE_W = 196;
const NODE_H = 62;
const COL_GAP = 84;
const ROW_GAP = 20;
const PAD = 24;
const OPEN = (category: string | undefined) => category !== 'done' && category !== 'cancelled';

/**
 * Visual dependency / hierarchy diagram for work items (FR-REL-09, FR-UI-10).
 *
 * - "الاعتماديات": columns follow the blocking order (longest path over directed, acyclic links),
 *   flowing right → left for RTL. Symmetric links are drawn but don't shape the layout.
 * - "التسلسل الهرمي": columns are tree depth (parent → children). Kept separate from blocking (§3.3.2).
 *
 * Pure presentation: the parent supplies items and relations it is allowed to see, and handles `open`.
 */
@Component({
  selector: 'app-dependency-graph',
  imports: [EmptyState],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="controls">
      <div class="seg" role="radiogroup" aria-label="نوع العرض">
        <button type="button" role="radio" [attr.aria-checked]="mode() === 'dependencies'" [class.on]="mode() === 'dependencies'" (click)="mode.set('dependencies')">الاعتماديات</button>
        <button type="button" role="radio" [attr.aria-checked]="mode() === 'hierarchy'" [class.on]="mode() === 'hierarchy'" (click)="mode.set('hierarchy')">التسلسل الهرمي</button>
      </div>
      <div class="chips" role="group" aria-label="تصفية حسب النوع">
        @for (t of typeOptions(); track t.id) {
          <button type="button" class="chip" [class.off]="hiddenTypes().has(t.id)" [attr.aria-pressed]="!hiddenTypes().has(t.id)"
            [style.--chip]="t.color" (click)="toggleType(t.id)">{{ t.name }}</button>
        }
      </div>
      @if (mode() === 'dependencies') {
        <div class="chips" role="group" aria-label="تصفية حسب نوع الرابط">
          @for (r of relationOptions(); track r.id) {
            <button type="button" class="chip chip--rel" [class.off]="hiddenRelations().has(r.id)" [attr.aria-pressed]="!hiddenRelations().has(r.id)"
              (click)="toggleRelation(r.id)">{{ r.name }}</button>
          }
        </div>
      }
      <label class="checkbox"><input type="checkbox" [checked]="showUnlinked()" (change)="showUnlinked.set(!showUnlinked())" /> العناصر غير المرتبطة</label>
    </div>

    @if (graph().nodes.length) {
      <div class="canvas" tabindex="0" aria-label="مخطط العلاقات — قابل للتمرير">
        <svg [attr.viewBox]="'0 0 ' + graph().width + ' ' + graph().height" [attr.width]="graph().width" [attr.height]="graph().height"
          role="img" [attr.aria-label]="summary()">
          <defs>
            <marker id="dg-arrow-blocks" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--c-danger)" /></marker>
            <marker id="dg-arrow-duplicates" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--c-gold-600)" /></marker>
            <marker id="dg-arrow-parent" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--c-emerald-600)" /></marker>
            <marker id="dg-arrow-other" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--c-muted)" /></marker>
          </defs>

          @for (e of graph().edges; track e.key) {
            <path class="edge" [class]="'edge edge--' + e.kind" [class.dim]="isDimmed(e)" [attr.d]="e.path"
              [attr.marker-end]="e.directed ? 'url(#dg-arrow-' + e.kind + ')' : null">
              <title>{{ e.label }}</title>
            </path>
          }

          @for (n of graph().nodes; track n.item.id) {
            <g class="node" [class.focus]="n.item.id === focusId()" [class.blocked]="n.blocked" [class.dim]="isNodeDimmed(n)"
              [attr.transform]="'translate(' + n.x + ',' + n.y + ')'" tabindex="0" role="link"
              [attr.aria-label]="n.typeName + ' ' + n.item.ref + ': ' + n.item.title + '، الحالة ' + n.statusName + (n.blocked ? '، محجوب' : '')"
              (click)="open.emit(n.item)" (keydown.enter)="open.emit(n.item)" (keydown.space)="$event.preventDefault(); open.emit(n.item)"
              (mouseenter)="hover.set(n.item.id)" (mouseleave)="hover.set(null)" (focus)="hover.set(n.item.id)" (blur)="hover.set(null)">
              <rect class="box" [attr.width]="NODE_W" [attr.height]="NODE_H" rx="10" />
              <rect [attr.x]="NODE_W - 5" y="0" width="5" [attr.height]="NODE_H" rx="2.5" [attr.fill]="n.color" />
              <text class="ref" [attr.x]="NODE_W - 14" y="20" direction="ltr" text-anchor="end">{{ n.item.ref }}</text>
              <text class="type" x="12" y="20" text-anchor="end" [attr.fill]="n.color">{{ n.typeName }}</text>
              <text class="title" [attr.x]="NODE_W - 14" y="38" text-anchor="start">{{ n.title }}</text>
              <circle [attr.cx]="NODE_W - 18" cy="51" r="4" [attr.fill]="n.statusColor" />
              <text class="status" [attr.x]="NODE_W - 27" y="54" text-anchor="start">{{ n.statusName }}</text>
              @if (n.blocked) {
                <text class="blocked-tag" x="12" y="54" text-anchor="end">محجوب</text>
              }
            </g>
          }
        </svg>
      </div>

      <ul class="legend" aria-label="مفتاح المخطط">
        @if (mode() === 'dependencies') {
          <li><span class="ln ln--blocks"></span> يحجب (السهم نحو العنصر المحجوب)</li>
          <li><span class="ln ln--duplicates"></span> يكرر</li>
          <li><span class="ln ln--relates"></span> مرتبط بـ</li>
          <li><span class="sw sw--blocked"></span> عنصر محجوب باعتمادية مفتوحة</li>
        } @else {
          <li><span class="ln ln--parent"></span> أب ← ابن</li>
        }
      </ul>
    } @else {
      <app-empty-state icon="link" [title]="mode() === 'dependencies' ? 'لا توجد اعتماديات لعرضها' : 'لا يوجد تسلسل هرمي لعرضه'"
        text="غيّر الفلاتر أو فعّل «العناصر غير المرتبطة»." />
    }
  `,
  styles: `
    :host { display: grid; gap: var(--s-3); }
    .controls { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); }
    .seg { display: inline-flex; padding: 3px; border-radius: var(--r-pill); background: var(--c-surface-2); border: 1px solid var(--c-border); }
    .seg button { border: 0; background: none; padding: 5px 14px; border-radius: var(--r-pill); font-weight: 600; font-size: var(--fs-sm); color: var(--c-text-2); cursor: pointer; }
    .seg button.on { background: var(--c-primary); color: #fff; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; }
    .chip { --chip: var(--c-emerald-600); border: 1px solid color-mix(in srgb, var(--chip) 40%, var(--c-surface)); background: color-mix(in srgb, var(--chip) 12%, var(--c-surface)); color: color-mix(in srgb, var(--chip) 80%, var(--c-text)); border-radius: var(--r-pill); padding: 2px 10px; font-size: var(--fs-xs); font-weight: 600; cursor: pointer; }
    .chip--rel { --chip: var(--c-text-2); }
    .chip.off { background: none; color: var(--c-muted); border-style: dashed; text-decoration: line-through; }
    .canvas { overflow: auto; max-height: 560px; border: 1px solid var(--c-border); border-radius: var(--r-md); background:
      radial-gradient(circle, var(--c-border) 1px, transparent 1px) 0 0 / 18px 18px, var(--c-surface-2); }
    svg { display: block; }
    .edge { fill: none; stroke-width: 1.8; transition: opacity .15s; }
    .edge--blocks { stroke: var(--c-danger); }
    .edge--duplicates { stroke: var(--c-gold-600); stroke-dasharray: 2 4; }
    .edge--relates { stroke: var(--c-muted); stroke-dasharray: 6 4; }
    .edge--parent { stroke: var(--c-emerald-600); }
    .edge--other { stroke: var(--c-muted); }
    .dim { opacity: .18; }
    .node { cursor: pointer; outline: none; transition: opacity .15s; }
    .box { fill: var(--c-surface); stroke: var(--c-border-strong); stroke-width: 1; filter: drop-shadow(0 1px 2px rgb(16 40 30 / 8%)); }
    .node:hover .box, .node:focus-visible .box { stroke: var(--c-emerald-600); stroke-width: 2; }
    .node:focus-visible .box { stroke-width: 3; }
    .node.focus .box { stroke: var(--c-gold-500); stroke-width: 2.5; fill: var(--c-gold-100); }
    .node.blocked .box { stroke: var(--c-warning); stroke-dasharray: 5 3; }
    text { font-family: var(--font); }
    .ref { font-family: 'IBM Plex Mono', Consolas, monospace; font-size: 11px; fill: var(--c-muted); }
    .type { font-size: 11px; font-weight: 700; }
    .title { font-size: 13px; font-weight: 600; fill: var(--c-text); }
    .status { font-size: 11px; fill: var(--c-text-2); }
    .blocked-tag { font-size: 11px; font-weight: 700; fill: var(--c-warning); }
    .legend { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: var(--s-4); font-size: var(--fs-xs); color: var(--c-text-2); }
    .legend li { display: inline-flex; align-items: center; gap: 6px; }
    .ln { width: 26px; border-top: 2px solid; }
    .ln--blocks { border-color: var(--c-danger); }
    .ln--duplicates { border-color: var(--c-gold-600); border-top-style: dotted; }
    .ln--relates { border-color: var(--c-muted); border-top-style: dashed; }
    .ln--parent { border-color: var(--c-emerald-600); }
    .sw { width: 14px; height: 10px; border-radius: 3px; }
    .sw--blocked { border: 1.5px dashed var(--c-warning); }
  `,
})
export class DependencyGraph {
  private readonly types = inject(WorkItemTypeLookup);
  private readonly statuses = inject(StatusLookup);
  private readonly relationTypes = inject(RelationTypeLookup);

  readonly items = input.required<readonly WorkItem[]>();
  readonly relations = input.required<readonly WorkItemRelation[]>();
  /** Highlighted item (e.g. the one whose detail page hosts the graph). */
  readonly focusId = input<string | null>(null);
  readonly initialMode = input<GraphMode>('dependencies');
  readonly open = output<WorkItem>();

  protected readonly NODE_W = NODE_W;
  protected readonly NODE_H = NODE_H;
  /** Starts from `initialMode` and is then driven by the toggle. */
  protected readonly mode = linkedSignal<GraphMode>(() => this.initialMode());
  protected readonly showUnlinked = signal(false);
  protected readonly hiddenTypes = signal<ReadonlySet<string>>(new Set());
  protected readonly hiddenRelations = signal<ReadonlySet<string>>(new Set());
  protected readonly hover = signal<string | null>(null);


  protected readonly typeOptions = computed(() => {
    const used = new Set(this.items().map((i) => i.typeId));
    return this.types.items().filter((t) => used.has(t.id)).sort((a, b) => a.order - b.order);
  });

  protected readonly relationOptions = computed(() => {
    const used = new Set(this.relations().map((r) => r.relationTypeId));
    return this.relationTypes.items().filter((r) => used.has(r.id));
  });

  protected readonly graph = computed(() => this.layout());

  protected readonly summary = computed(() => {
    const g = this.graph();
    return `${g.nodes.length} عنصرًا و${g.edges.length} رابطًا`;
  });

  private readonly neighbours = computed(() => {
    const map = new Map<string, Set<string>>();
    for (const e of this.graph().edges) {
      if (!map.has(e.from)) map.set(e.from, new Set());
      if (!map.has(e.to)) map.set(e.to, new Set());
      map.get(e.from)!.add(e.to);
      map.get(e.to)!.add(e.from);
    }
    return map;
  });

  protected isDimmed(e: GraphEdge): boolean {
    const h = this.hover();
    return !!h && e.from !== h && e.to !== h;
  }

  protected isNodeDimmed(n: GraphNode): boolean {
    const h = this.hover();
    return !!h && h !== n.item.id && !this.neighbours().get(h)?.has(n.item.id);
  }

  protected toggleType(id: string): void {
    this.hiddenTypes.update((s) => toggle(s, id));
  }

  protected toggleRelation(id: string): void {
    this.hiddenRelations.update((s) => toggle(s, id));
  }

  private layout(): { nodes: GraphNode[]; edges: GraphEdge[]; width: number; height: number } {
    const mode = this.mode();
    const items = this.items().filter((i) => !this.hiddenTypes().has(i.typeId));
    const byId = new Map(items.map((i) => [i.id, i]));
    const relTypes = new Map(this.relationTypes.items().map((r) => [r.id, r]));

    // 1. Logical edges for the active mode.
    type Logical = { from: string; to: string; kind: GraphEdge['kind']; directed: boolean; label: string; key: string; layered: boolean };
    const logical: Logical[] = [];
    if (mode === 'hierarchy') {
      for (const i of items) {
        if (i.parentId && byId.has(i.parentId)) {
          logical.push({ key: `p-${i.id}`, from: i.parentId, to: i.id, kind: 'parent', directed: true, label: `${byId.get(i.parentId)!.ref} ← ${i.ref}`, layered: true });
        }
      }
    } else {
      for (const r of this.relations()) {
        if (this.hiddenRelations().has(r.relationTypeId) || !byId.has(r.sourceId) || !byId.has(r.targetId)) continue;
        const type: RelationType | undefined = relTypes.get(r.relationTypeId);
        const kind = (['blocks', 'duplicates', 'relates'].includes(type?.key ?? '') ? type!.key : 'other') as GraphEdge['kind'];
        const directed = type?.directed ?? true;
        logical.push({
          key: r.id, from: r.sourceId, to: r.targetId, kind, directed,
          label: `${byId.get(r.sourceId)!.ref} ${type?.name ?? ''} ${byId.get(r.targetId)!.ref}`,
          layered: directed && (type?.acyclic ?? false),
        });
      }
    }

    // 2. Which nodes to show.
    const linked = new Set(logical.flatMap((e) => [e.from, e.to]));
    const visible = items.filter((i) => this.showUnlinked() || linked.has(i.id) || i.id === this.focusId());

    // 3. Level = longest path over layered edges (acyclic by server rule; guarded anyway).
    const level = new Map<string, number>(visible.map((i) => [i.id, 0]));
    const layered = logical.filter((e) => e.layered && level.has(e.from) && level.has(e.to));
    for (let pass = 0; pass < visible.length; pass++) {
      let changed = false;
      for (const e of layered) {
        const next = level.get(e.from)! + 1;
        if (next > level.get(e.to)!) {
          level.set(e.to, next);
          changed = true;
        }
      }
      if (!changed) break;
    }

    // 4. Order inside each column by the average row of predecessors (fewer crossings).
    const columns = new Map<number, WorkItem[]>();
    for (const i of visible) {
      const l = level.get(i.id)!;
      if (!columns.has(l)) columns.set(l, []);
      columns.get(l)!.push(i);
    }
    const row = new Map<string, number>();
    const maxLevel = Math.max(0, ...columns.keys());
    for (let l = 0; l <= maxLevel; l++) {
      const col = columns.get(l) ?? [];
      const score = (i: WorkItem) => {
        const preds = layered.filter((e) => e.to === i.id && row.has(e.from)).map((e) => row.get(e.from)!);
        return preds.length ? preds.reduce((a, b) => a + b, 0) / preds.length : Number.MAX_SAFE_INTEGER;
      };
      col.sort((a, b) => score(a) - score(b) || a.ref.localeCompare(b.ref, 'en', { numeric: true }));
      col.forEach((i, idx) => row.set(i.id, idx));
    }

    const maxRows = Math.max(1, ...[...columns.values()].map((c) => c.length));
    const width = PAD * 2 + (maxLevel + 1) * NODE_W + maxLevel * COL_GAP;
    const height = PAD * 2 + maxRows * NODE_H + (maxRows - 1) * ROW_GAP;

    // RTL: level 0 sits at the right edge and the flow goes left.
    const xOf = (l: number) => width - PAD - NODE_W - l * (NODE_W + COL_GAP);
    const yOf = (r: number) => PAD + r * (NODE_H + ROW_GAP);

    const openBlockers = new Set(
      this.relations()
        .filter((r) => relTypes.get(r.relationTypeId)?.key === 'blocks')
        .filter((r) => OPEN(this.statuses.get(this.items().find((i) => i.id === r.sourceId)?.statusId)?.category))
        .map((r) => r.targetId),
    );

    const nodes: GraphNode[] = visible.map((item) => {
      const type = this.types.get(item.typeId);
      const status = this.statuses.get(item.statusId);
      return {
        item,
        level: level.get(item.id)!,
        x: xOf(level.get(item.id)!),
        y: yOf(row.get(item.id)!),
        color: type?.color ?? 'var(--c-neutral)',
        typeName: type?.name ?? '',
        statusName: status?.name ?? '',
        statusColor: status?.color ?? 'var(--c-neutral)',
        blocked: openBlockers.has(item.id) && OPEN(status?.category),
        title: truncate(item.title, 24),
      };
    });

    const pos = new Map(nodes.map((n) => [n.item.id, n]));
    const edges: GraphEdge[] = logical
      .filter((e) => pos.has(e.from) && pos.has(e.to))
      .map((e) => ({ key: e.key, from: e.from, to: e.to, kind: e.kind, directed: e.directed, label: e.label, path: edgePath(pos.get(e.from)!, pos.get(e.to)!) }));

    return { nodes, edges, width, height };
  }
}

function toggle(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Curve from the source's leading (left) edge to the target's trailing (right) edge; loops around for same-column links. */
function edgePath(a: { x: number; y: number }, b: { x: number; y: number }): string {
  const ay = a.y + NODE_H / 2;
  const by = b.y + NODE_H / 2;
  if (a.x === b.x) {
    // Same column (symmetric links): bow out to the left.
    const x = a.x;
    const bend = x - 40;
    return `M ${x} ${ay} C ${bend} ${ay}, ${bend} ${by}, ${x} ${by}`;
  }
  const forward = b.x < a.x; // normal RTL flow
  const x1 = forward ? a.x : a.x + NODE_W;
  const x2 = forward ? b.x + NODE_W : b.x;
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${ay} C ${mid} ${ay}, ${mid} ${by}, ${x2} ${by}`;
}
