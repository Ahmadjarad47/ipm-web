/**
 * Auto layout of a workflow state diagram (FR-WF): columns = BFS depth from the initial status,
 * laid out right-to-left (RTL: the initial status is on the right). Pure, so it is unit tested.
 */
export interface LayoutTransition {
  readonly fromStatusId: string;
  readonly toStatusId: string;
}

export interface LayoutInput {
  readonly statusIds: readonly string[];
  readonly initialId: string;
  readonly transitions: readonly LayoutTransition[];
}

export interface LayoutNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly depth: number;
  readonly initial: boolean;
}

export type EdgeKind = 'forward' | 'backward' | 'sameColumn';

export interface LayoutEdge {
  readonly fromId: string;
  readonly toId: string;
  readonly kind: EdgeKind;
  /** SVG path `d`. */
  readonly path: string;
  /** Anchor for the rule badges. */
  readonly mid: { readonly x: number; readonly y: number };
}

export interface DiagramLayout {
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
  readonly width: number;
  readonly height: number;
}

export const NODE_W = 150;
export const NODE_H = 48;
export const COL_GAP = 110;
export const ROW_GAP = 40;
export const PAD = 36;
const BULGE = 56;

/** BFS depth of every status from the initial one; unreachable statuses are placed in one extra column. */
export function assignDepths(input: LayoutInput): Map<string, number> {
  const { statusIds, transitions } = input;
  const ids = new Set(statusIds);
  const start = ids.has(input.initialId) ? input.initialId : statusIds[0];
  const depths = new Map<string, number>();
  if (start === undefined) return depths;

  const next = new Map<string, string[]>();
  for (const t of transitions) {
    if (!ids.has(t.fromStatusId) || !ids.has(t.toStatusId) || t.fromStatusId === t.toStatusId) continue;
    next.set(t.fromStatusId, [...(next.get(t.fromStatusId) ?? []), t.toStatusId]);
  }

  depths.set(start, 0);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const id = queue[head];
    for (const to of next.get(id) ?? []) {
      if (depths.has(to)) continue;
      depths.set(to, (depths.get(id) ?? 0) + 1);
      queue.push(to);
    }
  }

  const unreachable = statusIds.filter((id) => !depths.has(id));
  if (unreachable.length) {
    const extra = Math.max(...depths.values()) + 1;
    for (const id of unreachable) depths.set(id, extra);
  }
  return depths;
}

/** Cubic Bezier point at t = 0.5. */
export function bezierMid(p0: number, p1: number, p2: number, p3: number): number {
  return (p0 + 3 * p1 + 3 * p2 + p3) / 8;
}

export function layoutWorkflow(input: LayoutInput): DiagramLayout {
  const depths = assignDepths(input);
  if (!depths.size) return { nodes: [], edges: [], width: PAD * 2, height: PAD * 2 };

  const startId = input.statusIds.includes(input.initialId) ? input.initialId : input.statusIds[0];
  const columns = Math.max(...depths.values()) + 1;
  const byColumn: string[][] = Array.from({ length: columns }, () => []);
  for (const id of input.statusIds) {
    const d = depths.get(id);
    if (d !== undefined) byColumn[d].push(id);
  }
  const rows = Math.max(...byColumn.map((c) => c.length));
  const baseWidth = PAD * 2 + columns * NODE_W + (columns - 1) * COL_GAP;
  const columnHeight = (n: number): number => n * NODE_H + (n - 1) * ROW_GAP;
  const innerHeight = columnHeight(rows);

  const nodes: LayoutNode[] = [];
  byColumn.forEach((column, depth) => {
    const offset = (innerHeight - columnHeight(column.length)) / 2;
    column.forEach((id, index) => {
      nodes.push({
        id,
        // RTL: depth 0 sits on the right edge.
        x: baseWidth - PAD - NODE_W - depth * (NODE_W + COL_GAP),
        y: PAD + offset + index * (NODE_H + ROW_GAP),
        width: NODE_W,
        height: NODE_H,
        depth,
        initial: id === startId,
      });
    });
  });
  const node = new Map(nodes.map((n) => [n.id, n]));

  const edges: LayoutEdge[] = [];
  const seen = new Set<string>();
  let lowest = PAD + innerHeight;
  for (const t of input.transitions) {
    const a = node.get(t.fromStatusId);
    const b = node.get(t.toStatusId);
    const key = `${t.fromStatusId}>${t.toStatusId}`;
    if (!a || !b || a === b || seen.has(key)) continue;
    seen.add(key);

    if (b.depth > a.depth) {
      const sx = a.x;
      const sy = a.y + NODE_H / 2;
      const ex = b.x + NODE_W;
      const ey = b.y + NODE_H / 2;
      const dx = Math.max(30, (sx - ex) / 2);
      edges.push({
        fromId: a.id,
        toId: b.id,
        kind: 'forward',
        path: `M ${sx} ${sy} C ${sx - dx} ${sy}, ${ex + dx} ${ey}, ${ex} ${ey}`,
        mid: { x: bezierMid(sx, sx - dx, ex + dx, ex), y: bezierMid(sy, sy, ey, ey) },
      });
    } else if (b.depth === a.depth) {
      const sx = a.x + NODE_W;
      const sy = a.y + NODE_H / 2;
      const ey = b.y + NODE_H / 2;
      edges.push({
        fromId: a.id,
        toId: b.id,
        kind: 'sameColumn',
        path: `M ${sx} ${sy} C ${sx + BULGE} ${sy}, ${sx + BULGE} ${ey}, ${sx} ${ey}`,
        mid: { x: bezierMid(sx, sx + BULGE, sx + BULGE, sx), y: bezierMid(sy, sy, ey, ey) },
      });
    } else {
      const sx = a.x + NODE_W / 2;
      const sy = a.y + NODE_H;
      const ex = b.x + NODE_W / 2;
      const ey = b.y + NODE_H;
      const off = 44 + 16 * (a.depth - b.depth);
      lowest = Math.max(lowest, Math.max(sy, ey) + off * 0.75);
      edges.push({
        fromId: a.id,
        toId: b.id,
        kind: 'backward',
        path: `M ${sx} ${sy} C ${sx} ${sy + off}, ${ex} ${ey + off}, ${ex} ${ey}`,
        mid: { x: bezierMid(sx, sx, ex, ex), y: bezierMid(sy, sy + off, ey + off, ey) },
      });
    }
  }

  return { nodes, edges, width: baseWidth + BULGE, height: lowest + PAD + 24 };
}

/** Text colour (dark or white) that stays readable on a `#rrggbb` status colour. */
export function readableTextColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return lum > 0.4 ? '#14201b' : '#ffffff';
}
