/** One RDF term in a binding, as SPARQL JSON spells it. */
export type ResultTerm = {
  type: string;
  value: string;
  datatype?: string;
  'xml:lang'?: string;
};

/** A SELECT result in SPARQL JSON (https://www.w3.org/TR/sparql11-results-json/). */
export type SelectResults = {
  head: { vars: string[]; link?: string[] };
  results: { bindings: Array<Record<string, ResultTerm | undefined>> };
};

/** A position: longitude, latitude, and an optional height. */
export type Position = number[];

export type Point = { type: 'Point'; coordinates: Position };
export type MultiPoint = { type: 'MultiPoint'; coordinates: Position[] };
export type LineString = { type: 'LineString'; coordinates: Position[] };
export type MultiLineString = { type: 'MultiLineString'; coordinates: Position[][] };
export type Polygon = { type: 'Polygon'; coordinates: Position[][] };
export type MultiPolygon = { type: 'MultiPolygon'; coordinates: Position[][][] };
export type GeometryCollection = { type: 'GeometryCollection'; geometries: Geometry[] };

export type Geometry =
  | Point
  | MultiPoint
  | LineString
  | MultiLineString
  | Polygon
  | MultiPolygon
  | GeometryCollection;

export type JsonValue = string | number | boolean | null;

export type Feature = {
  type: 'Feature';
  id?: string | number;
  geometry: Geometry | null;
  properties: Record<string, JsonValue>;
};

export type FeatureCollection = {
  type: 'FeatureCollection';
  features: Feature[];
};

export type GeoJsonOptions = {
  /** The column that gives each feature its id. Default: `feature`, then `id`, then the first IRI column. */
  idVar?: string;
  /** The column that holds a `geo:wktLiteral` or `geo:geoJSONLiteral`. */
  geometryVar?: string;
  /** Two numeric columns that make a Point, longitude first. */
  pointVars?: [lonVar: string, latVar: string];
  /** Every feature gets `"geometry": null`, and no geometry column is looked for. */
  noGeometry?: boolean;
  /** Columns left out of `properties`, such as a paging cursor. */
  omitVars?: string[];
  /** Turn a feature IRI into the id the caller sees. Default: the IRI itself. */
  idFromIri?: (iri: string) => string | number;
};

export type GeoJsonFailure = 'no-geometry-column' | 'unsupported-crs' | 'invalid-geometry';

export type GeoJsonResult =
  | { ok: true; collection: FeatureCollection }
  | { ok: false; reason: GeoJsonFailure; detail: string };
