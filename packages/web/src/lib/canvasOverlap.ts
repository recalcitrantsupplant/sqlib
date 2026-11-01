/**
 * Overlap checks for the query group canvas.
 *
 * A saved group can come back with nodes on top of each other: a seeded or
 * hand-written version with no canvas positions, or one saved before a node
 * grew. A node also grows when a query is assigned to it, and then covers its
 * neighbour. Both hide edges, so the canvas resolves them: a whole re-layout
 * when a version opens tangled, and a nudge to the right when one node grows.
 */

export interface CanvasBox {
  id: string;
  position: { x: number; y: number };
  dimensions?: { width?: number; height?: number };
}

const GAP = 40;

const sizeOf = (node: CanvasBox) => {
  const width = node.dimensions?.width ?? 0;
  const height = node.dimensions?.height ?? 0;
  return width > 0 && height > 0 ? { width, height } : null;
};

const intersects = (a: CanvasBox, b: CanvasBox, margin = 0): boolean => {
  const sa = sizeOf(a);
  const sb = sizeOf(b);
  if (!sa || !sb) return false;
  return (
    a.position.x < b.position.x + sb.width + margin
    && b.position.x < a.position.x + sa.width + margin
    && a.position.y < b.position.y + sb.height + margin
    && b.position.y < a.position.y + sa.height + margin
  );
};

/**
 * True when any two measured nodes overlap, or stand so close that the edge
 * between them has no room to show. Unmeasured nodes never count.
 */
export function hasOverlaps(nodes: readonly CanvasBox[], margin = 24): boolean {
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      if (intersects(nodes[i]!, nodes[j]!, margin)) return true;
    }
  }
  return false;
}

/**
 * New x positions that clear the nodes a grown node now covers.
 *
 * Only nodes that start at or right of the grown node move, and only to the
 * right, so the push cannot loop. A node that moves can push the next one in
 * turn. Nodes left of the grown one stay where the author put them.
 */
export function pushApartFrom(nodes: readonly CanvasBox[], grownId: string): Map<string, number> {
  const boxes = nodes.map((node) => ({ ...node, position: { ...node.position } }));
  const grown = boxes.find((node) => node.id === grownId);
  const moved = new Map<string, number>();
  if (!grown || !sizeOf(grown)) return moved;

  const pushers = [grown];
  while (pushers.length > 0) {
    const pusher = pushers.shift()!;
    const width = sizeOf(pusher)!.width;
    for (const other of boxes) {
      if (other.id === pusher.id || other.id === grownId) continue;
      if (other.position.x < pusher.position.x) continue;
      if (!intersects(pusher, other)) continue;
      other.position.x = pusher.position.x + width + GAP;
      moved.set(other.id, other.position.x);
      pushers.push(other);
    }
  }
  return moved;
}
