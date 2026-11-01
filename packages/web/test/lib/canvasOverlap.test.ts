/**
 * The canvas overlap rules: a version that opens tangled is detected, and a
 * node that grows pushes what it now covers to the right, never to the left.
 */
import { describe, expect, it } from 'vitest';
import { hasOverlaps, pushApartFrom, type CanvasBox } from '@/lib/canvasOverlap';

const box = (id: string, x: number, y: number, width = 200, height = 80): CanvasBox => ({
  id,
  position: { x, y },
  dimensions: { width, height },
});

describe('hasOverlaps', () => {
  it('finds two nodes on top of each other', () => {
    expect(hasOverlaps([box('a', 0, 0), box('b', 100, 20)])).toBe(true);
  });

  it('ignores nodes side by side', () => {
    expect(hasOverlaps([box('a', 0, 0), box('b', 240, 0)])).toBe(false);
  });

  it('counts nodes too close for an edge between them to show', () => {
    expect(hasOverlaps([box('a', 0, 0), box('b', 206, 0)])).toBe(true);
  });

  it('ignores nodes that are not measured yet', () => {
    expect(hasOverlaps([box('a', 0, 0), { id: 'b', position: { x: 10, y: 10 } }])).toBe(false);
  });
});

describe('pushApartFrom', () => {
  it('moves the covered node clear of the grown one, and the next one in turn', () => {
    const moved = pushApartFrom([box('a', 0, 0, 320), box('b', 240, 0), box('c', 480, 0)], 'a');
    expect(moved.get('b')).toBe(360);
    expect(moved.get('c')).toBe(600);
  });

  it('leaves nodes to the left of the grown one where they are', () => {
    const moved = pushApartFrom([box('left', 0, 0), box('a', 100, 0, 320)], 'a');
    expect(moved.size).toBe(0);
  });

  it('moves nothing when the grown node still fits', () => {
    expect(pushApartFrom([box('a', 0, 0), box('b', 300, 0)], 'a').size).toBe(0);
  });
});
