import { describe, expect, it } from 'vitest';
import type { Edge, Node } from '@vue-flow/core';
import { useAutoLayout } from '@/composables/useAutoLayout';

/**
 * The layout seam, and the two things the stratification graph asks of it that
 * nothing else did: the routes dagre picked, and how big the result is.
 *
 * Both exist because a dense rule set is unreadable without them — a skip edge
 * drawn by the renderer takes the shortest path and lands on top of every other
 * skip edge, and a canvas sized to anything but the drawing wastes the panel.
 */
const node = (id: string): Node => ({
  id,
  position: { x: 0, y: 0 },
  data: {},
  style: { width: '120px', height: '40px' },
});

const edge = (source: string, target: string, id = `${source}-${target}`): Edge => ({
  id,
  source,
  target,
});

describe('useAutoLayout', () => {
  const { layout } = useAutoLayout();

  it('reports the laid-out size, so a caller can fit its canvas to the drawing', () => {
    const { bounds } = layout([node('a'), node('b')], [edge('a', 'b')], { direction: 'TB' });
    expect(bounds.width).toBeGreaterThan(0);
    expect(bounds.height).toBeGreaterThan(0);
  });

  it('keeps dagre’s waypoints for an edge that skips a rank', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('a', 'c')];
    const { edges: laidOut } = layout(nodes, edges, { direction: 'TB', withEdgePoints: true });

    const skip = laidOut.find((entry) => entry.id === 'a-c');
    const points = (skip?.data as { layoutPoints?: Array<{ x: number; y: number }> })?.layoutPoints;
    // More than two points *is* the lane: dagre threads the edge past the rank
    // it skips instead of letting it cut straight through the node there.
    expect(points?.length ?? 0).toBeGreaterThan(2);
  });

  it('leaves edges untouched when the caller did not ask for waypoints', () => {
    const { edges: laidOut } = layout([node('a'), node('b')], [edge('a', 'b')], { direction: 'TB' });
    expect(laidOut[0].data).toBeUndefined();
  });

  /*
   * Two rules can depend on each other for several reasons at once. Dagre would
   * otherwise reserve a lane per reason and the renderer would stack identical
   * strokes in them — width spent to say something the inspector already says.
   */
  it('lays out one lane for a pair, however many edges join them', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const once = layout(nodes, [edge('a', 'b'), edge('b', 'c')], { direction: 'TB' });
    const twice = layout(
      nodes,
      [edge('a', 'b'), edge('a', 'b', 'a-b-again'), edge('b', 'c')],
      { direction: 'TB' },
    );
    expect(twice.bounds.width).toBe(once.bounds.width);
    // The caller still gets every edge back — deduplication is dagre's view of
    // the graph, not a decision about what may be drawn.
    expect(twice.edges).toHaveLength(3);
  });
});
