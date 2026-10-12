import dagre from 'dagre';

/*
 * The query group canvas snapshot (`QueryGroupVersion.canvasData`), and the
 * layout that fills it in when a version arrives without one.
 *
 * Both the API and the web canvas need this. The API lays out a version that
 * was created without positions — a group generated over the API or MCP has no
 * canvas to take them from — so the stored version is complete and every
 * client draws it the same way. The canvas runs the same code for versions
 * stored before the API did that, and for its own "Tidy up".
 */

/** Which way the ranks run: T/B/L/R = top/bottom/left/right. */
export type CanvasDirection = 'TB' | 'BT' | 'LR' | 'RL';

/**
 * Which rank-assignment algorithm dagre uses to decide what sits in which rank.
 *
 * - `network-simplex` balances edge lengths over the whole graph. The default,
 *   and the best general answer for a pipeline with branches.
 * - `tight-tree` is cheaper and keeps chains tight, so a mostly-linear graph
 *   comes out compact rather than spread over the full width.
 * - `longest-path` pushes every node as late as its dependencies allow, which
 *   lines up all the terminal steps in one final rank.
 */
export type LayoutRanker = 'network-simplex' | 'tight-tree' | 'longest-path';

/** How nodes sit within their rank: U/D = up/down, L/R = left/right. */
export type LayoutAlign = 'UL' | 'UR' | 'DL' | 'DR';

/** A point in the same space as the laid-out node positions. */
export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutNode {
  id: string;
  width: number;
  height: number;
  /** A fixed rank for this node, when the caller decides ranks itself. */
  rank?: number | null;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

export interface GraphLayoutOptions {
  direction?: CanvasDirection;
  ranker?: LayoutRanker;
  align?: LayoutAlign;
  rankSep?: number;
  nodeSep?: number;
  margin?: { x?: number; y?: number };
}

export interface GraphLayout {
  /** Each node's top-left corner. */
  positions: Map<string, LayoutPoint>;
  /**
   * Dagre's routing waypoints, keyed by `layoutEdgeKey(source, target)`.
   *
   * Dagre reserves a lane between ranks for every edge that skips one, which is
   * what keeps a dense layered graph readable. A renderer that draws its own
   * path instead puts every skip edge back on top of the cards it passes.
   */
  edgePoints: Map<string, LayoutPoint[]>;
  /** The laid-out graph's own size, for a caller that sizes its canvas to fit. */
  bounds: { width: number; height: number };
}

/** The key `GraphLayout.edgePoints` uses for the edge from `source` to `target`. */
export const layoutEdgeKey = (source: string, target: string): string => `${source}\u0000${target}`;

/** Lay a directed graph out in ranks with dagre. */
export function layoutGraph(
  nodes: readonly LayoutNode[],
  edges: readonly LayoutEdge[],
  options: GraphLayoutOptions = {},
): GraphLayout {
  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: options.direction ?? 'TB',
    ranksep: options.rankSep ?? 120,
    nodesep: options.nodeSep ?? 60,
    marginx: options.margin?.x ?? 32,
    marginy: options.margin?.y ?? 32,
    ranker: options.ranker ?? 'network-simplex',
    ...(options.align ? { align: options.align } : {}),
  });

  const known = new Set<string>();
  for (const node of nodes) {
    known.add(node.id);
    graph.setNode(node.id, {
      width: node.width,
      height: node.height,
      ...(typeof node.rank === 'number' && Number.isFinite(node.rank) ? { rank: node.rank } : {}),
    });
  }

  /*
   * One dagre edge per source/target pair. Two nodes can be joined for several
   * reasons at once, and dagre would otherwise reserve a lane per reason and
   * draw them as identical overlapping lines. An edge to a node that is not in
   * the graph is left out rather than letting dagre invent a zero-size node.
   */
  for (const edge of edges) {
    if (!known.has(edge.source) || !known.has(edge.target)) continue;
    if (graph.hasEdge(edge.source, edge.target)) continue;
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  const positions = new Map<string, LayoutPoint>();
  for (const node of nodes) {
    // Dagre places a node by its centre; a canvas places it by its corner.
    const centre = graph.node(node.id) as LayoutPoint | undefined;
    if (!centre) continue;
    positions.set(node.id, { x: centre.x - node.width / 2, y: centre.y - node.height / 2 });
  }

  const edgePoints = new Map<string, LayoutPoint[]>();
  for (const { v, w } of graph.edges()) {
    const points = (graph.edge(v, w) as { points?: LayoutPoint[] } | undefined)?.points;
    if (points?.length) edgePoints.set(layoutEdgeKey(v, w), points);
  }

  const { width = 0, height = 0 } = graph.graph() as { width?: number; height?: number };
  return { positions, edgePoints, bounds: { width, height } };
}

// ------------------------------------------------------------------ canvas --

export interface CanvasSnapshotNode {
  id: string;
  /** Absent only on an entry read from a snapshot that did not place it. */
  position?: LayoutPoint;
  width?: number;
  height?: number;
  /** The name the author typed for this node, when they typed one. */
  label?: string;
}

export interface CanvasSnapshot {
  nodes: CanvasSnapshotNode[];
  viewport: { zoom: number; panX: number; panY: number };
  /**
   * The way the layout runs, which decides the side of a node its edges leave
   * and arrive on. Absent from snapshots written before it was saved; those
   * were all drawn left to right (`LEGACY_CANVAS_DIRECTION`).
   */
  direction?: CanvasDirection;
}

/** The direction of a canvas laid out for a version stored without one. */
export const DEFAULT_CANVAS_DIRECTION: CanvasDirection = 'TB';

/** The direction of a snapshot that carries positions but no direction. */
export const LEGACY_CANVAS_DIRECTION: CanvasDirection = 'LR';

/** The layout a canvas gets when nobody has arranged it. */
export const DEFAULT_CANVAS_LAYOUT: Readonly<GraphLayoutOptions> = {
  direction: DEFAULT_CANVAS_DIRECTION,
  ranker: 'network-simplex',
  rankSep: 110,
  nodeSep: 80,
};

export type CanvasNodeKind = 'start' | 'end' | 'step';

/**
 * A node's size before anything has drawn it. The canvas measures its nodes
 * and saves those sizes; these stand in where nothing has. Start and End are
 * ~110px pills; a step card is 220-320px wide and as tall as its label wraps,
 * so the step size errs large to keep estimated cards from touching.
 */
export const ESTIMATED_CANVAS_NODE_SIZE: Readonly<Record<CanvasNodeKind, { width: number; height: number }>> = {
  start: { width: 110, height: 44 },
  end: { width: 110, height: 44 },
  step: { width: 300, height: 96 },
};

const CANVAS_DIRECTIONS: readonly CanvasDirection[] = ['TB', 'BT', 'LR', 'RL'];

export const isCanvasDirection = (value: unknown): value is CanvasDirection =>
  typeof value === 'string' && (CANVAS_DIRECTIONS as readonly string[]).includes(value);

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/**
 * Read a stored snapshot. Null for no snapshot or one that is not JSON; an entry
 * without an id is dropped, and one without a usable position keeps its other
 * fields so a saved name is not lost with it.
 */
export function parseCanvasSnapshot(canvasData: unknown): CanvasSnapshot | null {
  if (typeof canvasData !== 'string' || canvasData.trim().length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(canvasData);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  // Fields this module does not know are carried through rather than dropped.
  const { nodes: rawNodes, viewport: rawViewport, direction: rawDirection, ...rest } =
    parsed as { nodes?: unknown; viewport?: unknown; direction?: unknown };
  const nodes: CanvasSnapshotNode[] = [];
  for (const entry of Array.isArray(rawNodes) ? rawNodes : []) {
    if (!entry || typeof entry !== 'object' || typeof (entry as { id?: unknown }).id !== 'string') continue;
    const { position, ...rest } = entry as Record<string, unknown> & { id: string };
    const point = position as { x?: unknown; y?: unknown } | undefined;
    nodes.push({
      ...rest,
      ...(isFiniteNumber(point?.x) && isFiniteNumber(point?.y) ? { position: { x: point.x, y: point.y } } : {}),
    });
  }
  const viewport = rawViewport as Partial<CanvasSnapshot['viewport']> | undefined;
  return {
    ...rest,
    nodes,
    viewport: {
      zoom: isFiniteNumber(viewport?.zoom) ? viewport.zoom : 1,
      panX: isFiniteNumber(viewport?.panX) ? viewport.panX : 0,
      panY: isFiniteNumber(viewport?.panY) ? viewport.panY : 0,
    },
    ...(isCanvasDirection(rawDirection) ? { direction: rawDirection } : {}),
  };
}

/** True when a parsed snapshot entry carries a position. */
export const hasCanvasPosition = (
  node: CanvasSnapshotNode | undefined,
): node is CanvasSnapshotNode & { position: LayoutPoint } =>
  Boolean(node?.position && isFiniteNumber(node.position.x) && isFiniteNumber(node.position.y));

/** The direction a snapshot is drawn in. */
export function canvasDirectionOf(snapshot: CanvasSnapshot | null): CanvasDirection {
  if (snapshot?.direction) return snapshot.direction;
  return snapshot?.nodes.some(hasCanvasPosition) ? LEGACY_CANVAS_DIRECTION : DEFAULT_CANVAS_DIRECTION;
}

export interface CanvasGraph {
  nodes: ReadonlyArray<{ id: string; kind: CanvasNodeKind }>;
  edges: readonly LayoutEdge[];
}

/**
 * The snapshot with a position for every node in the graph.
 *
 * A snapshot that already places every node is returned unchanged, byte for
 * byte. Otherwise the whole graph is laid out and the missing positions are
 * taken from that layout; positions the snapshot has always win. A snapshot
 * with no positions at all is laid out in `DEFAULT_CANVAS_LAYOUT`'s direction.
 *
 * A stored value that is not JSON is returned unchanged: it is not this
 * function's to discard.
 */
export function completeCanvasLayout(canvasData: unknown, graph: CanvasGraph): unknown {
  const snapshot = parseCanvasSnapshot(canvasData);
  if (!snapshot && typeof canvasData === 'string' && canvasData.trim().length > 0) return canvasData;
  if (graph.nodes.length === 0) return canvasData;

  const saved = new Map((snapshot?.nodes ?? []).map((node) => [node.id, node]));
  if (graph.nodes.every((node) => hasCanvasPosition(saved.get(node.id)))) return canvasData;

  const direction = canvasDirectionOf(snapshot);
  const sizeOf = (node: { id: string; kind: CanvasNodeKind }) => {
    const entry = saved.get(node.id);
    const estimate = ESTIMATED_CANVAS_NODE_SIZE[node.kind];
    return {
      width: isFiniteNumber(entry?.width) && entry.width > 0 ? entry.width : estimate.width,
      height: isFiniteNumber(entry?.height) && entry.height > 0 ? entry.height : estimate.height,
    };
  };
  /*
   * A graph with no edges yet — a new group is only Start and End — would put
   * every node in one rank. Start leads and End follows, so say so.
   */
  const start = graph.nodes.find((node) => node.kind === 'start');
  const end = graph.nodes.find((node) => node.kind === 'end');
  const edges = graph.edges.length === 0 && start && end ? [{ source: start.id, target: end.id }] : graph.edges;
  const { positions } = layoutGraph(
    graph.nodes.map((node) => ({ id: node.id, ...sizeOf(node) })),
    edges,
    { ...DEFAULT_CANVAS_LAYOUT, direction },
  );

  // The snapshot's entries keep their order, so a stored layout changes only
  // where it gained positions; nodes it did not mention follow. Entries for ids
  // this graph does not have are kept, not judged.
  const place = (entry: CanvasSnapshotNode): CanvasSnapshotNode => {
    if (hasCanvasPosition(entry)) return entry;
    const laid = positions.get(entry.id);
    return laid ? { ...entry, position: { x: Math.round(laid.x), y: Math.round(laid.y) } } : entry;
  };
  const completed: CanvasSnapshot = {
    ...snapshot,
    nodes: [
      ...(snapshot?.nodes ?? []).map(place),
      ...graph.nodes.filter((node) => !saved.has(node.id)).map((node) => place({ id: node.id })),
    ],
    viewport: snapshot?.viewport ?? { zoom: 1, panX: 0, panY: 0 },
    direction,
  };
  return JSON.stringify(completed);
}
