import type { LayoutPoint } from '@/composables/useAutoLayout';

/**
 * Geometry for the edges of a dependency cycle.
 *
 * A cycle of two rules is two edges between the same pair of nodes, one each
 * way. Laid out as usual they sit on top of each other, and so do their labels.
 * Each is instead drawn straight across the gap between the two nodes' facing
 * sides and bowed out to the right of the way it travels, which parts them:
 * the two run in opposite directions, so "right" is opposite sides.
 *
 * Shared by the edge that draws the bow and the graph that fits the view to
 * it, so the fit measures the same curve and label the edge draws.
 */

/** How far a bowed edge's middle leaves the straight line. */
export const CYCLE_BOW = 24;

/** The advance of the 10px mono face, plus the label's padding. */
const LABEL_CHAR_WIDTH = 6.1;
const LABEL_PADDING = 12;
export const CYCLE_LABEL_HEIGHT = 18;
/** The gap between a label and the curve it names. */
export const CYCLE_LABEL_GAP = 4;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type LabelAnchor = 'left' | 'right' | 'above' | 'below';

/** Unit normal to the right of travel from `from` to `to` (screen y runs down). */
function rightNormal(from: LayoutPoint, to: LayoutPoint): LayoutPoint {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: -dy / length, y: dx / length };
}

/**
 * The middles of the two sides the boxes turn to each other: left and right
 * when they sit side by side, top and bottom when one is above the other.
 *
 * A layout's handles assume every edge runs one way — out of the bottom, into
 * the top — and the edge of a cycle that runs back against the layout would
 * leave from the far side of its node and cut across both boxes to get there.
 */
export function facingEndpoints(source: Box, target: Box): [LayoutPoint, LayoutPoint] {
  const sc = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
  const tc = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const dx = tc.x - sc.x;
  const dy = tc.y - sc.y;
  // Which gap is clear: the one the boxes do not overlap across.
  const sideBySide = Math.abs(dx) - (source.width + target.width) / 2 > Math.abs(dy) - (source.height + target.height) / 2;
  if (sideBySide) {
    const sign = Math.sign(dx) || 1;
    return [
      { x: sc.x + (sign * source.width) / 2, y: sc.y },
      { x: tc.x - (sign * target.width) / 2, y: tc.y },
    ];
  }
  const sign = Math.sign(dy) || 1;
  return [
    { x: sc.x, y: sc.y + (sign * source.height) / 2 },
    { x: tc.x, y: tc.y - (sign * target.height) / 2 },
  ];
}

/**
 * The polyline pushed out by `bow` pixels at its middle, tapering to nothing at
 * the ends so the arrow still lands where it should. A straight two-point edge
 * gains a midpoint to bend at.
 */
export function bowPoints(points: LayoutPoint[], bow: number): LayoutPoint[] {
  if (!bow || points.length < 2) return points;
  const first = points[0];
  const last = points[points.length - 1];
  const normal = rightNormal(first, last);
  const base = points.length === 2
    ? [first, { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 }, last]
    : points;
  const lastIndex = base.length - 1;
  return base.map((point, index) => {
    if (index === 0 || index === lastIndex) return point;
    // Full bow at the middle of the run, less toward either end.
    const weight = Math.sin((Math.PI * index) / lastIndex);
    return { x: point.x + normal.x * bow * weight, y: point.y + normal.y * bow * weight };
  });
}

/**
 * Where an edge's label sits: at the middle of its (bowed) path, on the outside
 * of the bow, so the labels of a two-way pair face away from each other.
 */
export function labelPlacement(points: LayoutPoint[], bow: number): { x: number; y: number; anchor: LabelAnchor } {
  const drawn = bowPoints(points, bow);
  const middle = drawn.length % 2 === 1
    ? drawn[(drawn.length - 1) / 2]
    : {
        x: (drawn[drawn.length / 2 - 1].x + drawn[drawn.length / 2].x) / 2,
        y: (drawn[drawn.length / 2 - 1].y + drawn[drawn.length / 2].y) / 2,
      };
  const normal = rightNormal(drawn[0], drawn[drawn.length - 1]);
  const out = bow >= 0 ? normal : { x: -normal.x, y: -normal.y };
  const anchor: LabelAnchor = Math.abs(out.x) >= Math.abs(out.y)
    ? (out.x < 0 ? 'left' : 'right')
    : (out.y < 0 ? 'above' : 'below');
  return { ...middle, anchor };
}

/** A label's width on screen at 1:1, for fitting the view around it. */
export function labelWidth(text: string): number {
  return text.length * LABEL_CHAR_WIDTH + LABEL_PADDING;
}

/** The box a label occupies, in the same space as its anchor point. */
export function labelBox(text: string, placement: { x: number; y: number; anchor: LabelAnchor }): Box {
  const width = labelWidth(text);
  const height = CYCLE_LABEL_HEIGHT;
  const gap = CYCLE_LABEL_GAP;
  switch (placement.anchor) {
    case 'left': return { x: placement.x - gap - width, y: placement.y - height / 2, width, height };
    case 'right': return { x: placement.x + gap, y: placement.y - height / 2, width, height };
    case 'above': return { x: placement.x - width / 2, y: placement.y - gap - height, width, height };
    default: return { x: placement.x - width / 2, y: placement.y + gap, width, height };
  }
}

/** The CSS transform that puts a label's box where {@link labelBox} says it is. */
export function labelTransform(placement: { x: number; y: number; anchor: LabelAnchor }): string {
  const gap = `${CYCLE_LABEL_GAP}px`;
  const shift = {
    left: `calc(-100% - ${gap}), -50%`,
    right: `${gap}, -50%`,
    above: `-50%, calc(-100% - ${gap})`,
    below: `-50%, ${gap}`,
  }[placement.anchor];
  return `translate(${shift}) translate(${placement.x}px, ${placement.y}px)`;
}
