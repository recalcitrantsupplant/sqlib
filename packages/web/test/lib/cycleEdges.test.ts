import { describe, expect, it } from 'vitest';
import { bowPoints, facingEndpoints, labelBox, labelPlacement } from '@/lib/cycleEdges';

/*
 * Two rules negating each other are two edges between one pair of nodes, and
 * dagre lays them on the same line. Each bows to the right of the way it runs,
 * which puts the pair on opposite sides — and their labels with them.
 */
describe('cycle edge geometry', () => {
  const down = [{ x: 0, y: 0 }, { x: 0, y: 100 }];
  const up = [{ x: 0, y: 100 }, { x: 0, y: 0 }];

  it('leaves an unbowed edge as laid out', () => {
    expect(bowPoints(down, 0)).toBe(down);
  });

  it('keeps the ends where the handles are and bends the middle', () => {
    const bowed = bowPoints(down, 20);
    expect(bowed[0]).toEqual(down[0]);
    expect(bowed[bowed.length - 1]).toEqual(down[1]);
    expect(Math.abs(bowed[1].x)).toBeCloseTo(20);
  });

  it('parts a two-way pair onto opposite sides, labels outward', () => {
    const a = bowPoints(down, 20)[1];
    const b = bowPoints(up, 20)[1];
    expect(Math.sign(a.x)).toBe(-Math.sign(b.x));
    const labelA = labelPlacement(down, 20);
    const labelB = labelPlacement(up, 20);
    expect(labelA.anchor).not.toBe(labelB.anchor);
    // Each label sits on the side its own curve went.
    expect(labelA.anchor === 'left').toBe(a.x < 0);
  });

  it('puts the labels of a side-by-side pair above and below, clear of the curve', () => {
    const right = [{ x: 0, y: 0 }, { x: 100, y: 0 }];
    const left = [{ x: 100, y: 0 }, { x: 0, y: 0 }];
    const anchors = [labelPlacement(right, 20).anchor, labelPlacement(left, 20).anchor].sort();
    expect(anchors).toEqual(['above', 'below']);
    const above = labelPlacement(right, 20).anchor === 'above' ? labelPlacement(right, 20) : labelPlacement(left, 20);
    const box = labelBox('NOT ?s :p "ABC" → :s :p "ABC"', above);
    expect(box.y + box.height).toBeLessThan(above.y);
    expect(box.x + box.width / 2).toBeCloseTo(above.x);
  });
});

describe('facingEndpoints', () => {
  const a = { x: 0, y: 0, width: 100, height: 50 };

  it('joins side by side boxes across the gap between them', () => {
    const b = { x: 200, y: 0, width: 100, height: 50 };
    expect(facingEndpoints(a, b)).toEqual([{ x: 100, y: 25 }, { x: 200, y: 25 }]);
    // Running back the other way uses the same two sides, not the far ones.
    expect(facingEndpoints(b, a)).toEqual([{ x: 200, y: 25 }, { x: 100, y: 25 }]);
  });

  it('joins stacked boxes bottom to top, whichever way the edge runs', () => {
    const b = { x: 0, y: 120, width: 100, height: 50 };
    expect(facingEndpoints(b, a)).toEqual([{ x: 50, y: 120 }, { x: 50, y: 50 }]);
  });
});
