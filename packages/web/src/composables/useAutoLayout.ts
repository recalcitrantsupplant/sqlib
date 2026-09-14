import dagre from 'dagre';
import { Position, type Edge, type Node } from '@vue-flow/core';

type LayoutDirection = 'TB' | 'BT' | 'LR' | 'RL';

/**
 * Which rank-assignment algorithm dagre uses to decide what sits in which
 * column. They read differently enough to be worth offering:
 *
 * - `network-simplex` balances edge lengths over the whole graph. The default,
 *   and the best general answer for a pipeline with branches.
 * - `tight-tree` is cheaper and keeps chains tight, so a mostly-linear graph
 *   comes out compact rather than spread over the full width.
 * - `longest-path` pushes every node as late as its dependencies allow, which
 *   lines up all the terminal steps in one final column.
 */
export type LayoutRanker = 'network-simplex' | 'tight-tree' | 'longest-path';

/** How nodes sit within their rank: U/D = up/down, L/R = left/right. */
export type LayoutAlign = 'UL' | 'UR' | 'DL' | 'DR';

export interface AutoLayoutOptions {
  direction?: LayoutDirection;
  rankAccessor?: (node: Node) => number | null | undefined;
  nodeSize?: { width: number; height: number };
  ranker?: LayoutRanker;
  align?: LayoutAlign;
  rankSep?: number;
  nodeSep?: number;
  margin?: { x?: number; y?: number };
  /**
   * Keep dagre's routing waypoints for each edge, on `edge.data.layoutPoints`.
   *
   * Dagre reserves a lane between ranks for every edge that skips one, which is
   * the whole reason a dense layered graph is readable at all. Discarding those
   * points and letting the renderer draw its own straight or orthogonal path
   * puts every skip edge back on top of every other — so a graph that has any
   * asks for them, and one that does not pays nothing.
   */
  withEdgePoints?: boolean;
}

/** A dagre waypoint, in the same space as the returned node positions. */
export interface LayoutPoint {
  x: number;
  y: number;
}

export interface AutoLayoutResult<T extends Node = Node> {
  nodes: T[];
  edges: Edge[];
  /** The laid-out graph's own size, for a caller that sizes its canvas to fit. */
  bounds: { width: number; height: number };
}

const parseDimension = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/**
 * VueFlow writes the size it measured for a rendered node back onto the node as
 * `dimensions`, but the `Node` type it accepts as input has no such field, so
 * reading it needs a cast. Measuring matters: this canvas has 110px Start/End
 * pills next to 220-320px query cards of varying height, and laying all of them
 * out as one nominal box is what makes ranks collide and edges cut through
 * cards.
 */
const readMeasuredDimension = (node: Node, key: 'width' | 'height'): number | null => {
  const dimensions = (node as Node & { dimensions?: { width?: number; height?: number } }).dimensions;
  const value = dimensions?.[key];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
};

const readStyleDimension = (style: Node['style'], key: 'width' | 'height'): number | null => {
  if (style && typeof style === 'object') {
    return parseDimension((style as Record<string, unknown>)[key]);
  }
  return null;
};

export function useAutoLayout() {
  const resolveSize = (node: Node, fallback: { width: number; height: number }) => ({
    width: readMeasuredDimension(node, 'width') ?? readStyleDimension(node.style, 'width') ?? fallback.width,
    height: readMeasuredDimension(node, 'height') ?? readStyleDimension(node.style, 'height') ?? fallback.height,
  });

  const layout = <T extends Node = Node>(
    nodes: T[],
    edges: Edge[],
    options: AutoLayoutOptions = {},
  ): AutoLayoutResult<T> => {
    const direction: LayoutDirection = options.direction ?? 'TB';
    const nodeSize = options.nodeSize ?? { width: 240, height: 90 };
    const ranksep = options.rankSep ?? 120;
    const nodesep = options.nodeSep ?? 60;
    const marginx = options.margin?.x ?? 32;
    const marginy = options.margin?.y ?? 32;
    const isHorizontal = direction === 'LR' || direction === 'RL';
    const ranker: LayoutRanker = options.ranker ?? 'network-simplex';

    const graph = new dagre.graphlib.Graph();
    graph.setDefaultEdgeLabel(() => ({}));
    graph.setGraph({
      rankdir: direction,
      ranksep,
      nodesep,
      marginx,
      marginy,
      ranker,
      ...(options.align ? { align: options.align } : {}),
    });

    nodes.forEach((node) => {
      const { width, height } = resolveSize(node, nodeSize);
      const rank = options.rankAccessor?.(node);
      graph.setNode(node.id, {
        width,
        height,
        ...(Number.isFinite(rank as number) ? { rank: Number(rank) } : {}),
      });
    });

    /*
     * One dagre edge per source/target pair. Two rules can depend on each other
     * for several reasons at once, and dagre would otherwise reserve a lane per
     * reason and draw them as identical overlapping lines — the drawing would
     * say "several dependencies" where the inspector already says which.
     */
    const seen = new Set<string>();
    edges.forEach((edge) => {
      const key = `${edge.source}\u0000${edge.target}`;
      if (seen.has(key)) return;
      seen.add(key);
      graph.setEdge(edge.source, edge.target);
    });

    dagre.layout(graph);

    const layoutedNodes = nodes.map((node) => {
      const { width, height } = resolveSize(node, nodeSize);
      const position = graph.node(node.id) as { x: number; y: number } | undefined;
      if (!position) return node;
      return {
        ...node,
        targetPosition: isHorizontal ? Position.Left : Position.Top,
        sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
        position: {
          x: position.x - width / 2,
          y: position.y - height / 2,
        },
      };
    });

    const layoutedEdges = options.withEdgePoints
      ? edges.map((edge) => {
        const points = (graph.edge(edge.source, edge.target) as { points?: LayoutPoint[] } | undefined)?.points;
        if (!points?.length) return edge;
        return { ...edge, data: { ...(edge.data ?? {}), layoutPoints: points } };
      })
      : edges;

    const { width = 0, height = 0 } = graph.graph() as { width?: number; height?: number };

    return { nodes: layoutedNodes, edges: layoutedEdges, bounds: { width, height } };
  };

  return { layout };
}
