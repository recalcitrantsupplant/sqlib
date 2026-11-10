/**
 * The CRSs a WKT literal may name, and the axis order each one uses.
 *
 * GeoJSON is longitude, latitude in CRS84 (RFC 7946). The CRSs here are
 * geographic and lat/lon, so the only change is an axis swap. GDA94 and
 * GDA2020 are treated as equal to WGS84: GDA2020 is within centimetres of it,
 * GDA94 within about 1.8 m. That is the rule the Kurrawong index uses too.
 * Nothing is reprojected; any other CRS is refused.
 */
import type { Geometry, Position } from './types.js';

export const CRS84 = 'http://www.opengis.net/def/crs/OGC/1.3/CRS84';

/** Axis order by CRS IRI, `http` spelling, without the scheme. */
const AXIS_ORDER: Record<string, 'lonlat' | 'latlon'> = {
  'www.opengis.net/def/crs/OGC/1.3/CRS84': 'lonlat',
  'www.opengis.net/def/crs/OGC/1.3/CRS84h': 'lonlat',
  'www.opengis.net/def/crs/OGC/0/CRS84': 'lonlat',
  'www.opengis.net/def/crs/EPSG/0/4326': 'latlon',
  'www.opengis.net/def/crs/EPSG/0/4283': 'latlon',
  'www.opengis.net/def/crs/EPSG/0/7844': 'latlon',
};

/** The axis order of a CRS IRI, or undefined when sqlib does not know it. */
export function axisOrder(crsIri: string | null): 'lonlat' | 'latlon' | undefined {
  if (crsIri === null) return 'lonlat';
  const withoutScheme = crsIri.replace(/^https?:\/\//, '');
  return AXIS_ORDER[withoutScheme];
}

/** Split a `geo:wktLiteral` into its optional leading CRS IRI and its WKT text. */
export function splitWktLiteral(literal: string): { crs: string | null; wkt: string } {
  const match = /^\s*<([^>]*)>\s*(.*)$/s.exec(literal);
  return match ? { crs: match[1]!, wkt: match[2]! } : { crs: null, wkt: literal };
}

function swapPosition(position: Position): Position {
  const [a, b, ...rest] = position;
  return [b!, a!, ...rest];
}

/** The geometry with the first two axes of every position swapped. */
export function swapAxes(geometry: Geometry): Geometry {
  switch (geometry.type) {
    case 'Point':
      return { type: 'Point', coordinates: swapPosition(geometry.coordinates) };
    case 'MultiPoint':
    case 'LineString':
      return { type: geometry.type, coordinates: geometry.coordinates.map(swapPosition) } as Geometry;
    case 'MultiLineString':
    case 'Polygon':
      return { type: geometry.type, coordinates: geometry.coordinates.map(ring => ring.map(swapPosition)) } as Geometry;
    case 'MultiPolygon':
      return {
        type: 'MultiPolygon',
        coordinates: geometry.coordinates.map(polygon => polygon.map(ring => ring.map(swapPosition))),
      };
    case 'GeometryCollection':
      return { type: 'GeometryCollection', geometries: geometry.geometries.map(swapAxes) };
  }
}
