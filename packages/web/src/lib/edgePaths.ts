import type { LayoutPoint } from '@/composables/useAutoLayout';

/** How far a curve control point reaches toward its neighbour. */
const SMOOTHING = 0.32;

/**
 * A Catmull-Rom-ish pass through a polyline, emitted as cubic beziers.
 *
 * Each control point leans along the line between a point's two neighbours, so
 * the curve stays inside the lane the layout reserved rather than bulging out
 * of it into the next one. The waypoints are smoothed rather than joined with
 * straight segments because a corner is where two edges look joined when they
 * merely cross.
 */
export function smoothPolylinePath(points: LayoutPoint[]): string {
  if (points.length < 2) return '';

  if (points.length === 2) {
    const [from, to] = points;
    const midY = (from.y + to.y) / 2;
    return `M ${from.x},${from.y} C ${from.x},${midY} ${to.x},${midY} ${to.x},${to.y}`;
  }

  const segments: string[] = [`M ${points[0].x},${points[0].y}`];
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] ?? points[index];
    const from = points[index];
    const to = points[index + 1];
    const next = points[index + 2] ?? to;
    const control1 = {
      x: from.x + (to.x - previous.x) * SMOOTHING,
      y: from.y + (to.y - previous.y) * SMOOTHING,
    };
    const control2 = {
      x: to.x - (next.x - from.x) * SMOOTHING,
      y: to.y - (next.y - from.y) * SMOOTHING,
    };
    segments.push(`C ${control1.x},${control1.y} ${control2.x},${control2.y} ${to.x},${to.y}`);
  }
  return segments.join(' ');
}

/**
 * The point a given fraction of the way along a polyline, for putting a label
 * on it. Parallel edges pass a different fraction so their labels do not stack.
 */
export function polylinePointAt(points: LayoutPoint[], fraction = 0.5): LayoutPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];

  const spans = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
  const total = spans.reduce((sum, span) => sum + span, 0);
  if (total === 0) return points[0];

  let remaining = total * Math.min(Math.max(fraction, 0), 1);
  for (let index = 0; index < spans.length; index += 1) {
    if (remaining <= spans[index] || index === spans.length - 1) {
      const ratio = spans[index] === 0 ? 0 : remaining / spans[index];
      return {
        x: points[index].x + (points[index + 1].x - points[index].x) * ratio,
        y: points[index].y + (points[index + 1].y - points[index].y) * ratio,
      };
    }
    remaining -= spans[index];
  }
  return points[points.length - 1];
}
