import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@vue-flow/core';
import { useAutoLayout } from '../useAutoLayout';

/** A node carrying the size VueFlow would have measured for it. */
const measured = (id: string, width: number, height: number): Node =>
  ({ id, position: { x: 0, y: 0 }, data: {}, dimensions: { width, height } }) as unknown as Node;

const edge = (source: string, target: string): Edge => ({ id: `${source}-${target}`, source, target });

describe('useAutoLayout', () => {
  const { layout } = useAutoLayout();

  it('separates ranks by the measured width, not a nominal one', () => {
    const nodes = [measured('a', 320, 90), measured('b', 320, 90)];
    const { nodes: laidOut } = layout(nodes, [edge('a', 'b')], { direction: 'LR', rankSep: 140 });

    const [a, b] = laidOut;
    expect(b.position.x - (a.position.x + 320)).toBeCloseTo(140, 5);
  });

  it('keeps siblings of different heights from overlapping', () => {
    const nodes = [measured('root', 200, 60), measured('tall', 200, 400), measured('short', 200, 40)];
    const edges = [edge('root', 'tall'), edge('root', 'short')];
    const { nodes: laidOut } = layout(nodes, edges, { direction: 'LR', nodeSep: 60 });

    const byId = new Map(laidOut.map((node) => [node.id, node]));
    const tall = byId.get('tall')!;
    const short = byId.get('short')!;
    const gap =
      tall.position.y < short.position.y
        ? short.position.y - (tall.position.y + 400)
        : tall.position.y - (short.position.y + 40);
    expect(gap).toBeGreaterThanOrEqual(60);
  });

  it('pushes every node as late as its dependencies allow under longest-path', () => {
    // a -> b -> d and a -> d: with longest-path, d sits behind b either way,
    // and the short a -> d edge stretches rather than pulling d forward.
    const nodes = ['a', 'b', 'd'].map((id) => measured(id, 200, 60));
    const edges = [edge('a', 'b'), edge('b', 'd'), edge('a', 'd')];
    const { nodes: laidOut } = layout(nodes, edges, { direction: 'LR', ranker: 'longest-path' });

    const byId = new Map(laidOut.map((node) => [node.id, node.position.x]));
    expect(byId.get('d')!).toBeGreaterThan(byId.get('b')!);
    expect(byId.get('b')!).toBeGreaterThan(byId.get('a')!);
  });

  it('falls back to the nominal size when a node was never measured', () => {
    const unmeasured = { id: 'x', position: { x: 0, y: 0 }, data: {} } as Node;
    const { nodes: laidOut } = layout([unmeasured], [], { nodeSize: { width: 100, height: 50 } });
    expect(laidOut[0].position).toEqual({ x: 32, y: 32 });
  });
});
