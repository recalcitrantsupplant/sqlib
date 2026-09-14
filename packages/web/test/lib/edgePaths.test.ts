import { describe, expect, it } from 'vitest';
import { polylinePointAt, smoothPolylinePath } from '@/lib/edgePaths';

const route = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
];

describe('smoothPolylinePath', () => {
  it('starts at the first point and ends at the last', () => {
    const path = smoothPolylinePath(route);
    expect(path.startsWith('M 0,0')).toBe(true);
    expect(path.endsWith('100,100')).toBe(true);
  });

  it('draws nothing from fewer than two points', () => {
    expect(smoothPolylinePath([{ x: 1, y: 1 }])).toBe('');
  });
});

describe('polylinePointAt', () => {
  it('finds the halfway point by length, not by index', () => {
    // 200 units of route, so halfway is the corner itself.
    expect(polylinePointAt(route, 0.5)).toEqual({ x: 100, y: 0 });
  });

  it('slides along the route as the fraction shrinks', () => {
    const earlier = polylinePointAt(route, 0.25);
    expect(earlier).toEqual({ x: 50, y: 0 });
  });

  it('clamps a fraction outside the route to its ends', () => {
    expect(polylinePointAt(route, -1)).toEqual({ x: 0, y: 0 });
    expect(polylinePointAt(route, 2)).toEqual({ x: 100, y: 100 });
  });

  it('survives a degenerate route', () => {
    expect(polylinePointAt([], 0.5)).toEqual({ x: 0, y: 0 });
    expect(polylinePointAt([{ x: 3, y: 4 }, { x: 3, y: 4 }], 0.5)).toEqual({ x: 3, y: 4 });
  });
});
