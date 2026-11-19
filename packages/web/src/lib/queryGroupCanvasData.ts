/**
 * What a saved query group canvas says about its nodes.
 *
 * The canvas snapshot (`QueryGroupVersion.canvasData`) is the only place a
 * node's author-given label is stored. The canvas editor and the Bench page
 * both read it, so the parser lives outside the editor's composable.
 */

type CanvasLabelSnapshot = {
  nodes?: Array<{ id?: string; label?: unknown; position?: { x?: unknown; y?: unknown } }>;
  direction?: unknown;
};

export type SavedCanvasState = {
  positions: Map<string, { x: number; y: number }>;
  labels: Map<string, string>;
  /** Which side edges leave each node from. A snapshot without it was drawn left to right. */
  direction: 'LR' | 'TB';
};

/**
 * Parse the canvas snapshot into what it says about each node: where it sits,
 * and what the author named it.
 *
 * Each is read on its own terms, so a snapshot written before labels were in it
 * still restores its positions, and a malformed label does not cost a node its
 * position.
 */
export const parseCanvasData = (canvasDataString: string | null | undefined): SavedCanvasState => {
  const saved: SavedCanvasState = { positions: new Map(), labels: new Map(), direction: 'LR' };

  if (!canvasDataString || typeof canvasDataString !== 'string') {
    return saved;
  }

  try {
    const canvasData = JSON.parse(canvasDataString) as CanvasLabelSnapshot;
    if (canvasData?.direction === 'TB') saved.direction = 'TB';
    if (canvasData?.nodes && Array.isArray(canvasData.nodes)) {
      for (const node of canvasData.nodes) {
        if (!node.id) {
          continue;
        }
        if (node.position && typeof node.position.x === 'number' && typeof node.position.y === 'number') {
          saved.positions.set(node.id, { x: node.position.x, y: node.position.y });
        }
        if (typeof node.label === 'string' && node.label.trim().length > 0) {
          saved.labels.set(node.id, node.label.trim());
        }
      }
    }
  } catch (error) {
    console.warn('[parseCanvasData] Failed to parse canvas data:', error);
  }

  return saved;
};
