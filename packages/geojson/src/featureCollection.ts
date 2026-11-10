/**
 * A SPARQL JSON SELECT result as a GeoJSON FeatureCollection: one feature per
 * row. See `docs/proposals/ogc-api-features.md`, part 1.
 *
 * Nothing here throws on bad data. A failure is returned with its reason, so
 * the caller picks the status: `/execute` answers 406, the OGC routes 500.
 */
import { axisOrder, splitWktLiteral, swapAxes } from './crs.js';
import { isNumericDatatype, propertyValue } from './properties.js';
import type {
  Feature,
  GeoJsonOptions,
  GeoJsonResult,
  Geometry,
  JsonValue,
  ResultTerm,
  SelectResults,
} from './types.js';
import { WktError, parseWkt } from './wkt.js';

export const GEOJSON_MEDIA_TYPE = 'application/geo+json';

const GEO = 'http://www.opengis.net/ont/geosparql#';
export const WKT_LITERAL = `${GEO}wktLiteral`;
export const GEOJSON_LITERAL = `${GEO}geoJSONLiteral`;

const LON_NAMES = ['lon', 'long', 'lng', 'longitude'];
const LAT_NAMES = ['lat', 'latitude'];

type GeometrySource = { kind: 'literal'; variable: string } | { kind: 'point'; lon: string; lat: string };

/** The first bound value of a column. */
function firstValue(results: SelectResults, variable: string): ResultTerm | undefined {
  for (const binding of results.results.bindings) {
    const term = binding[variable];
    if (term) return term;
  }
  return undefined;
}

function isGeometryLiteral(term: ResultTerm | undefined): boolean {
  return term?.datatype === WKT_LITERAL || term?.datatype === GEOJSON_LITERAL;
}

function findGeometrySource(results: SelectResults, options: GeoJsonOptions): GeometrySource | null {
  const vars = results.head.vars;
  if (options.geometryVar) return vars.includes(options.geometryVar) ? { kind: 'literal', variable: options.geometryVar } : null;
  const literal = vars.find(name => isGeometryLiteral(firstValue(results, name)));
  if (literal) return { kind: 'literal', variable: literal };
  if (options.pointVars) {
    const [lon, lat] = options.pointVars;
    return vars.includes(lon) && vars.includes(lat) ? { kind: 'point', lon, lat } : null;
  }
  const numeric = (name: string) => isNumericDatatype(firstValue(results, name)?.datatype);
  const lon = vars.find(name => LON_NAMES.includes(name.toLowerCase()) && numeric(name));
  const lat = vars.find(name => LAT_NAMES.includes(name.toLowerCase()) && numeric(name));
  return lon && lat ? { kind: 'point', lon, lat } : null;
}

/** The column `toFeatureCollection` would read geometry from, or null when it would find none. */
export function findGeometryColumn(results: SelectResults, options: GeoJsonOptions = {}): string | null {
  if (options.noGeometry) return null;
  const source = findGeometrySource(results, options);
  if (!source) return null;
  return source.kind === 'literal' ? source.variable : source.lon;
}

function findIdVar(results: SelectResults, options: GeoJsonOptions, taken: Set<string>): string | undefined {
  const vars = results.head.vars;
  if (options.idVar) return vars.includes(options.idVar) ? options.idVar : undefined;
  for (const name of ['feature', 'id']) {
    if (vars.includes(name) && !taken.has(name)) return name;
  }
  return vars.find(name => !taken.has(name) && firstValue(results, name)?.type === 'uri');
}

class GeometryFailure extends Error {
  constructor(
    readonly reason: 'unsupported-crs' | 'invalid-geometry',
    message: string,
  ) {
    super(message);
  }
}

function literalGeometry(term: ResultTerm, row: number): Geometry | null {
  if (term.datatype === GEOJSON_LITERAL) {
    try {
      const parsed = JSON.parse(term.value) as { type?: unknown };
      if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
        throw new Error('not a geometry object');
      }
      return parsed as Geometry;
    } catch (error) {
      throw new GeometryFailure('invalid-geometry', `Row ${row + 1}: the geoJSONLiteral is not valid GeoJSON (${(error as Error).message}).`);
    }
  }
  const { crs, wkt } = splitWktLiteral(term.value);
  const order = axisOrder(crs);
  if (!order) {
    throw new GeometryFailure(
      'unsupported-crs',
      `Row ${row + 1}: the geometry is in ${crs}. GeoJSON output takes CRS84, EPSG:4326, EPSG:4283 or EPSG:7844 only.`,
    );
  }
  let geometry: Geometry | null;
  try {
    geometry = parseWkt(wkt);
  } catch (error) {
    if (error instanceof WktError) {
      throw new GeometryFailure('invalid-geometry', `Row ${row + 1}: the WKT is not valid (${error.message}).`);
    }
    throw error;
  }
  return geometry && order === 'latlon' ? swapAxes(geometry) : geometry;
}

function pointGeometry(lonTerm: ResultTerm | undefined, latTerm: ResultTerm | undefined, row: number): Geometry | null {
  if (!lonTerm || !latTerm) return null;
  const lon = Number(lonTerm.value);
  const lat = Number(latTerm.value);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    throw new GeometryFailure('invalid-geometry', `Row ${row + 1}: "${lonTerm.value}", "${latTerm.value}" is not a longitude and latitude.`);
  }
  return { type: 'Point', coordinates: [lon, lat] };
}

/**
 * The result as a FeatureCollection.
 *
 * The geometry column is `geometryVar`, else the first column of
 * `geo:wktLiteral` or `geo:geoJSONLiteral` values, else `pointVars`, else a
 * lon/lat pair of numeric columns. The id column is `idVar`, else `feature`,
 * else `id`, else the first IRI column. Every other column, minus `omitVars`,
 * is a property.
 */
export function toFeatureCollection(results: SelectResults, options: GeoJsonOptions = {}): GeoJsonResult {
  const source = options.noGeometry ? null : findGeometrySource(results, options);
  if (!options.noGeometry && !source) {
    return {
      ok: false,
      reason: 'no-geometry-column',
      detail: options.geometryVar
        ? `The result has no column "${options.geometryVar}".`
        : 'No column holds a geo:wktLiteral or geo:geoJSONLiteral, and no longitude and latitude columns were found.',
    };
  }

  const geometryVars = new Set<string>();
  if (source?.kind === 'literal') geometryVars.add(source.variable);
  if (source?.kind === 'point') {
    geometryVars.add(source.lon);
    geometryVars.add(source.lat);
  }
  // A geometry column the caller skipped is still not a property.
  if (options.noGeometry && options.geometryVar) geometryVars.add(options.geometryVar);
  const idVar = findIdVar(results, options, geometryVars);
  const omit = new Set([...(options.omitVars ?? []), ...geometryVars, ...(idVar ? [idVar] : [])]);
  const propertyVars = results.head.vars.filter(name => !omit.has(name));

  const features: Feature[] = [];
  try {
    results.results.bindings.forEach((binding, row) => {
      let geometry: Geometry | null = null;
      if (source?.kind === 'literal') {
        const term = binding[source.variable];
        geometry = term ? literalGeometry(term, row) : null;
      } else if (source?.kind === 'point') {
        geometry = pointGeometry(binding[source.lon], binding[source.lat], row);
      }

      const properties: Record<string, JsonValue> = {};
      for (const name of propertyVars) {
        const term = binding[name];
        if (term) properties[name] = propertyValue(term);
      }

      const feature: Feature = { type: 'Feature', geometry, properties };
      const idTerm = idVar ? binding[idVar] : undefined;
      if (idTerm) {
        feature.id = idTerm.type === 'uri' && options.idFromIri
          ? options.idFromIri(idTerm.value)
          : idTerm.type === 'uri' || idTerm.type === 'bnode'
            ? (propertyValue(idTerm) as string)
            : idValue(idTerm);
      }
      features.push(feature);
    });
  } catch (error) {
    if (error instanceof GeometryFailure) return { ok: false, reason: error.reason, detail: error.message };
    throw error;
  }

  return { ok: true, collection: { type: 'FeatureCollection', features } };
}

/** A literal id: a number when it is one, else its string. GeoJSON allows only those two. */
function idValue(term: ResultTerm): string | number {
  const value = propertyValue(term);
  return typeof value === 'number' ? value : String(value);
}
