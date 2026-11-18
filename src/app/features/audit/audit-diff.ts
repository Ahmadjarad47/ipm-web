export type DiffKind = 'same' | 'removed' | 'added' | 'changed';

/** One aligned row of the side-by-side viewer: `null` means nothing on that side. */
export interface DiffRow {
  readonly kind: DiffKind;
  readonly left: string | null;
  readonly right: string | null;
}

/** JSON values are pretty-printed so structural changes show line by line; other text is kept as-is. */
export function prettyValue(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const t = value.trim();
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try {
      return JSON.stringify(JSON.parse(t), null, 2);
    } catch {
      return value;
    }
  }
  return value;
}

const MAX_CELLS = 250_000;

/** Line-based diff (LCS) aligned for two columns; adjacent removed+added runs are paired as "changed". */
export function diffValues(from: string | null | undefined, to: string | null | undefined): readonly DiffRow[] {
  const a = prettyValue(from) === '' ? [] : prettyValue(from).split('\n');
  const b = prettyValue(to) === '' ? [] : prettyValue(to).split('\n');
  const n = a.length;
  const m = b.length;

  // Too large for the quadratic table: show the two texts as one changed block.
  if (n * m > MAX_CELLS) return pair([...a.map((l) => ({ kind: 'removed' as const, text: l })), ...b.map((l) => ({ kind: 'added' as const, text: l }))]);

  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  }

  const ops: { kind: 'same' | 'removed' | 'added'; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      ops.push({ kind: 'removed', text: a[i++] });
    } else {
      ops.push({ kind: 'added', text: b[j++] });
    }
  }
  while (i < n) ops.push({ kind: 'removed', text: a[i++] });
  while (j < m) ops.push({ kind: 'added', text: b[j++] });
  return pair(ops);
}

function pair(ops: readonly { kind: 'same' | 'removed' | 'added'; text: string }[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let k = 0;
  while (k < ops.length) {
    if (ops[k].kind === 'same') {
      rows.push({ kind: 'same', left: ops[k].text, right: ops[k].text });
      k++;
      continue;
    }
    const removed: string[] = [];
    const added: string[] = [];
    while (k < ops.length && ops[k].kind !== 'same') {
      (ops[k].kind === 'removed' ? removed : added).push(ops[k].text);
      k++;
    }
    for (let r = 0; r < Math.max(removed.length, added.length); r++) {
      const left = removed[r] ?? null;
      const right = added[r] ?? null;
      rows.push({ kind: left !== null && right !== null ? 'changed' : left !== null ? 'removed' : 'added', left, right });
    }
  }
  return rows;
}

/** First/last characters with an ellipsis, for long hashes in tight cells. */
export function truncateMiddle(value: string, head = 10, tail = 6): string {
  return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}
