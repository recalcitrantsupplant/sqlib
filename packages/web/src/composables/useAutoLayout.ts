import { Position, type Edge, type Node } from '@vue-flow/core';
import {
  layoutEdgeKey,
  layoutGraph,
  type CanvasDirection,
  type LayoutAlign,
  type LayoutPoint,
  type LayoutRanker,
} from '@sparql-query-lib/contracts/canvas';

/*
 * The dagre layout itself lives in contracts, because the API lays out query
 * group versions created without positions and must agree with the canvas on
 * how. This is the VueFlow side of it: sizes read off rendered nodes, and
 * positions and handle sides written back onto them.
 */
export type { LayoutAlign, LayoutPoint, LayoutRanker };

type LayoutDirection = CanvasDirection;

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
    const isHorizontal = direction === 'LR' || direction === 'RL';

    const sizes = new Map(nodes.map((node) => [node.id, resolveSize(node, nodeSize)]));
    const { positions, edgePoints, bounds } = layoutGraph(
      nodes.map((node) => ({ id: node.id, ...sizes.get(node.id)!, rank: options.rankAccessor?.(node) })),
      edges,
      {
        direction,
        ranker: options.ranker,
        align: options.align,
        rankSep: options.rankSep ?? 120,
        nodeSep: options.nodeSep ?? 60,
        margin: options.margin,
      },
    );

    const layoutedNodes = nodes.map((node) => {
      const position = positions.get(node.id);
      if (!position) return node;
      return {
        ...node,
        targetPosition: isHorizontal ? Position.Left : Position.Top,
        sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
        position,
      };
    });

    const layoutedEdges = options.withEdgePoints
      ? edges.map((edge) => {
        const points = edgePoints.get(layoutEdgeKey(edge.source, edge.target));
        if (!points?.length) return edge;
        return { ...edge, data: { ...(edge.data ?? {}), layoutPoints: points } };
      })
      : edges;

    return { nodes: layoutedNodes, edges: layoutedEdges, bounds };
  };

  return { layout };
}
