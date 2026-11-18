import { describe, expect, it } from 'vitest';
import { assignDepths, layoutWorkflow, NODE_W, readableTextColor } from './workflow-diagram-layout';

const t = (fromStatusId: string, toStatusId: string) => ({ fromStatusId, toStatusId });

describe('workflow diagram layout', () => {
  const input = {
    statusIds: ['new', 'work', 'review', 'done', 'orphan'],
    initialId: 'new',
    transitions: [t('new', 'work'), t('work', 'review'), t('review', 'done'), t('review', 'work'), t('new', 'done'), t('work', 'work')],
  };

  it('assigns BFS depth from the initial status and parks unreachable statuses in an extra column', () => {
    const depths = assignDepths(input);
    expect(depths.get('new')).toBe(0);
    expect(depths.get('work')).toBe(1);
    expect(depths.get('done')).toBe(1);
    expect(depths.get('review')).toBe(2);
    expect(depths.get('orphan')).toBe(3);
  });

  it('flows right-to-left: the initial status has the largest x and deeper columns sit further left', () => {
    const { nodes } = layoutWorkflow(input);
    const x = (id: string) => nodes.find((n) => n.id === id)!.x;
    expect(x('new')).toBeGreaterThan(x('work'));
    expect(x('work')).toBeGreaterThan(x('review'));
    expect(x('review')).toBeGreaterThan(x('orphan'));
    expect(nodes.filter((n) => n.initial).map((n) => n.id)).toEqual(['new']);
  });

  it('classifies edges, skips self loops and duplicates, and keeps everything inside the canvas', () => {
    const layout = layoutWorkflow({ ...input, transitions: [...input.transitions, t('new', 'work')] });
    expect(layout.edges.length).toBe(5);
    expect(layout.edges.find((e) => e.fromId === 'review' && e.toId === 'work')?.kind).toBe('backward');
    expect(layout.edges.find((e) => e.fromId === 'new' && e.toId === 'work')?.kind).toBe('forward');
    for (const n of layout.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
      expect(n.x + NODE_W).toBeLessThanOrEqual(layout.width);
      expect(n.y + n.height).toBeLessThanOrEqual(layout.height);
    }
    const back = layout.edges.find((e) => e.kind === 'backward')!;
    expect(back.mid.y).toBeLessThanOrEqual(layout.height);
  });

  it('falls back to the first status when the initial one is not a member, and handles an empty workflow', () => {
    const layout = layoutWorkflow({ statusIds: ['a', 'b'], initialId: 'zzz', transitions: [t('a', 'b')] });
    expect(layout.nodes.find((n) => n.id === 'a')?.initial).toBe(true);
    expect(layoutWorkflow({ statusIds: [], initialId: '', transitions: [] }).nodes).toEqual([]);
  });

  it('picks a readable text colour', () => {
    expect(readableTextColor('#ffffff')).toBe('#14201b');
    expect(readableTextColor('#14614a')).toBe('#ffffff');
  });
});
