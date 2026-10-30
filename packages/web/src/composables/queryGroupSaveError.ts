/**
 * A canvas that cannot be written as a version, because of one node.
 *
 * The payload builder refuses a node with no backend or no assignment before
 * anything is sent. Carrying the node's canvas id lets the screen select that
 * node and open its inspector, so the author lands on the field to fill in
 * rather than reading a message that names a URN.
 */
export class CanvasNodeError extends Error {
  readonly nodeId: string;

  constructor(message: string, nodeId: string) {
    super(message);
    this.name = 'CanvasNodeError';
    this.nodeId = nodeId;
  }
}
