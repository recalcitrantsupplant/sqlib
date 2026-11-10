import { describe, expect, it } from 'vitest';
import { WktError, parseWkt } from '../src/wkt.js';

describe('parseWkt', () => {
  it('reads a point', () => {
    expect(parseWkt('POINT (115.86 -31.95)')).toEqual({ type: 'Point', coordinates: [115.86, -31.95] });
  });

  it('is case-insensitive and accepts exponents', () => {
    expect(parseWkt('point(1e2 -2.5E-1)')).toEqual({ type: 'Point', coordinates: [100, -0.25] });
  });

  it('keeps Z and drops M', () => {
    expect(parseWkt('POINT Z (1 2 3)')).toEqual({ type: 'Point', coordinates: [1, 2, 3] });
    expect(parseWkt('POINT M (1 2 9)')).toEqual({ type: 'Point', coordinates: [1, 2] });
    expect(parseWkt('POINT ZM (1 2 3 9)')).toEqual({ type: 'Point', coordinates: [1, 2, 3] });
    expect(parseWkt('POINT (1 2 3)')).toEqual({ type: 'Point', coordinates: [1, 2, 3] });
  });

  it('reads lines and polygons with holes', () => {
    expect(parseWkt('LINESTRING (0 0, 1 1, 2 0)')).toEqual({
      type: 'LineString',
      coordinates: [[0, 0], [1, 1], [2, 0]],
    });
    expect(parseWkt('POLYGON ((0 0, 4 0, 4 4, 0 4, 0 0), (1 1, 2 1, 2 2, 1 1))')).toEqual({
      type: 'Polygon',
      coordinates: [
        [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]],
        [[1, 1], [2, 1], [2, 2], [1, 1]],
      ],
    });
  });

  it('reads both MULTIPOINT forms', () => {
    const expected = { type: 'MultiPoint', coordinates: [[1, 2], [3, 4]] };
    expect(parseWkt('MULTIPOINT ((1 2), (3 4))')).toEqual(expected);
    expect(parseWkt('MULTIPOINT (1 2, 3 4)')).toEqual(expected);
  });

  it('reads the multi forms and collections', () => {
    expect(parseWkt('MULTILINESTRING ((0 0, 1 1), (2 2, 3 3))')).toEqual({
      type: 'MultiLineString',
      coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]],
    });
    expect(parseWkt('MULTIPOLYGON (((0 0, 1 0, 1 1, 0 0)), ((5 5, 6 5, 6 6, 5 5)))')).toEqual({
      type: 'MultiPolygon',
      coordinates: [[[[0, 0], [1, 0], [1, 1], [0, 0]]], [[[5, 5], [6, 5], [6, 6], [5, 5]]]],
    });
    expect(parseWkt('GEOMETRYCOLLECTION (POINT (1 2), LINESTRING (0 0, 1 1), POINT EMPTY)')).toEqual({
      type: 'GeometryCollection',
      geometries: [
        { type: 'Point', coordinates: [1, 2] },
        { type: 'LineString', coordinates: [[0, 0], [1, 1]] },
      ],
    });
  });

  it('reads EMPTY as null', () => {
    expect(parseWkt('POLYGON EMPTY')).toBeNull();
    expect(parseWkt('point z empty')).toBeNull();
  });

  it('refuses malformed text', () => {
    for (const text of ['POINT (1)', 'POINT (1 2', 'CIRCLE (1 2)', 'POINT (1 2) extra', 'LINESTRING (0 0,)', 'POINT Z (1 2)', '']) {
      expect(() => parseWkt(text), text).toThrow(WktError);
    }
  });
});
