/**
 * OGC API Features collections: the `ogc` object a query version carries, its
 * check, and the pure pieces of an `items` call — parsing the OGC parameters
 * and editing a CQL2-JSON filter. Nothing here reads the store or runs a query.
 * See `docs/proposals/ogc-api-features.md`.
 */
import type { DetectedInputs, PublishedToolSpec, ToolParamKind, ToolParamSpec } from './published.js';

export const OGC_COLLECTION_ID_PATTERN = '^[A-Za-z0-9_-]{1,64}$';

/** The OGC parameter names no queryable may take. */
export const OGC_RESERVED_PARAMS: readonly string[] = [
  'f',
  'bbox',
  'datetime',
  'limit',
  'offset',
  'cursor',
  'filter',
  'filter-lang',
  'filter-crs',
  'crs',
  'bbox-crs',
  'properties',
  'sortby',
  'skipGeometry',
];

export const OGC_QUERYABLE_TYPES = ['string', 'number', 'integer', 'boolean', 'date-time', 'uri'] as const;
export type OgcQueryableType = (typeof OGC_QUERYABLE_TYPES)[number];

/** The most features a page may ask for, whatever a collection says. */
export const OGC_MAX_PAGE_SIZE = 10000;

export type OgcQueryable = {
  /** values mode: the `VALUES` variable the parameter fills. */
  var?: string;
  type?: OgcQueryableType;
  title?: string;
  description?: string;
};

export type OgcObject = {
  collectionId: string;
  title: string;
  description?: string;
  mode: 'values' | 'cql2';
  feature: { var: string; base: string };
  /** A WKT or GeoJSON literal column, or null for a collection with no geometry. */
  geometry?: string | null;
  /** Longitude and latitude columns, in place of `geometry`. */
  point?: [string, string];
  geometrySources?: Array<{ href: string; type?: string; title?: string }>;
  params?: {
    limit?: string;
    offset?: string;
    bbox?: [string, string, string, string];
    datetime?: [string, string];
    skipGeometry?: string;
    filter?: string;
    cursor?: string;
  };
  outputs?: { numberMatched?: string; nextCursor?: string };
  cql?: {
    /** The id of a stored SELECT over `luc:config` that lists the index fields. */
    configQuery?: string;
    geometryField?: string;
    datetimeField?: string;
    /** Queryable name to index field IRI, where they differ. */
    fields?: Record<string, string>;
  };
  queryables?: Record<string, OgcQueryable>;
  pageSize?: { default?: number; max?: number };
  extent?: {
    spatial?: number[][];
    temporal?: Array<[string | null, string | null]>;
  };
  /** Result columns kept out of the feature properties. */
  omit?: string[];
};

export type OgcCheckContext = {
  inputs: DetectedInputs;
  /** The variables the SELECT projects. */
  outputs: string[];
  /** Whether the version is a SELECT. */
  isSelect: boolean;
};

const ABSOLUTE_IRI = /^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`]*$/;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Check an `ogc` object against the version it is on. Returns the first problem
 * as a message that names the key, or null. Run when a version is saved, as
 * `checkToolObject` is, and again at startup.
 */
export function checkOgcObject(ogc: unknown, context: OgcCheckContext): string | null {
  if (!isObject(ogc)) return 'ogc must be an object';
  const o = ogc as Partial<OgcObject>;
  if (!context.isSelect) return 'ogc: only a SELECT can be a collection';
  if (typeof o.collectionId !== 'string' || !new RegExp(OGC_COLLECTION_ID_PATTERN).test(o.collectionId)) {
    return `ogc.collectionId must match ${OGC_COLLECTION_ID_PATTERN}`;
  }
  if (typeof o.title !== 'string' || !o.title.trim()) return 'ogc.title must be text';
  if (o.description !== undefined && typeof o.description !== 'string') return 'ogc.description must be text';
  if (o.mode !== 'values' && o.mode !== 'cql2') return 'ogc.mode must be "values" or "cql2"';

  const variables = new Set(context.inputs.tables.flat());
  const outputs = new Set(context.outputs);
  const tableOf = (name: string) => context.inputs.tables.find(table => table.includes(name));
  const used = new Set<string>();

  if (!isObject(o.feature) || !isName(o.feature.var) || typeof o.feature.base !== 'string') {
    return 'ogc.feature must be { "var": …, "base": … }';
  }
  if (!outputs.has(o.feature.var)) return `ogc.feature.var: the query does not return ?${o.feature.var}`;
  if (!variables.has(o.feature.var)) {
    return `ogc.feature.var: ?${o.feature.var} must also be a VALUES parameter, so one feature can be read by its id`;
  }
  used.add(o.feature.var);
  if (!ABSOLUTE_IRI.test(o.feature.base)) return 'ogc.feature.base must be an absolute IRI';

  const hasGeometry = o.geometry !== undefined && o.geometry !== null;
  if (hasGeometry && o.point !== undefined) return 'ogc: give "geometry" or "point", not both';
  if (!hasGeometry && o.point === undefined && o.geometry !== null) {
    return 'ogc.geometry: name the geometry column, give "point", or set it to null for a collection with no geometry';
  }
  if (hasGeometry) {
    if (!isName(o.geometry)) return 'ogc.geometry must be a variable name or null';
    if (!outputs.has(o.geometry)) return `ogc.geometry: the query does not return ?${o.geometry}`;
  }
  if (o.point !== undefined) {
    if (!Array.isArray(o.point) || o.point.length !== 2 || !o.point.every(isName)) {
      return 'ogc.point must be [longitude variable, latitude variable]';
    }
    for (const name of o.point) if (!outputs.has(name)) return `ogc.point: the query does not return ?${name}`;
  }

  if (o.geometrySources !== undefined) {
    if (!Array.isArray(o.geometrySources)) return 'ogc.geometrySources must be a list';
    for (const [index, source] of o.geometrySources.entries()) {
      if (!isObject(source) || typeof source.href !== 'string' || !/^https?:\/\//.test(source.href)) {
        return `ogc.geometrySources[${index}].href must be an http or https URL`;
      }
    }
  }

  const params = o.params ?? {};
  if (!isObject(params)) return 'ogc.params must be an object';
  const valuesVariable = (key: string, name: unknown, wholeTuple = true): string | null => {
    if (!isName(name)) return `ogc.params.${key} must be a variable name`;
    if (!variables.has(name)) return `ogc.params.${key}: ?${name} is not a VALUES parameter of this version`;
    if (used.has(name)) return `ogc.params.${key}: ?${name} is already used`;
    if (wholeTuple && tableOf(name)!.length !== 1) {
      return `ogc.params.${key}: ?${name} must be alone in its VALUES clause`;
    }
    used.add(name);
    return null;
  };
  const tuple = (key: string, names: unknown, size: number): string | null => {
    if (!Array.isArray(names) || names.length !== size || !names.every(isName)) {
      return `ogc.params.${key} must list ${size} variables`;
    }
    for (const name of names) {
      const problem = valuesVariable(key, name, false);
      if (problem) return problem;
    }
    const table = tableOf(names[0]!)!;
    if (table.length !== size || !names.every(name => table.includes(name))) {
      return `ogc.params.${key}: ${names.map(n => `?${n}`).join(' ')} must be the whole of one VALUES clause`;
    }
    return null;
  };

  if (params.skipGeometry !== undefined) {
    if (!hasGeometry && o.point === undefined) return 'ogc.params.skipGeometry: this collection has no geometry to skip';
    const problem = valuesVariable('skipGeometry', params.skipGeometry);
    if (problem) return problem;
  }

  if (o.mode === 'values') {
    for (const key of ['filter', 'cursor'] as const) {
      if (params[key] !== undefined) return `ogc.params.${key}: only a cql2 collection takes it`;
    }
    if (o.outputs !== undefined || o.cql !== undefined) return 'ogc: "outputs" and "cql" belong to a cql2 collection';
    if (!isName(params.limit)) return 'ogc.params.limit: a values collection needs a LIMIT parameter, so a page is bounded';
    if (!context.inputs.limits.includes(params.limit)) {
      return `ogc.params.limit: "LIMIT ${params.limit}" is not a LIMIT parameter of this version`;
    }
    if (params.offset !== undefined && (!isName(params.offset) || !context.inputs.offsets.includes(params.offset))) {
      return `ogc.params.offset: "OFFSET ${String(params.offset)}" is not an OFFSET parameter of this version`;
    }
    if (params.bbox !== undefined) {
      const problem = tuple('bbox', params.bbox, 4);
      if (problem) return problem;
    }
    if (params.datetime !== undefined) {
      const problem = tuple('datetime', params.datetime, 2);
      if (problem) return problem;
    }
  } else {
    for (const key of ['bbox', 'datetime'] as const) {
      if (params[key] !== undefined) return `ogc.params.${key}: a cql2 collection sends ${key} to the index in the filter`;
    }
    // Every luc:query argument is bound on each call, so they may share one VALUES clause.
    for (const key of ['filter', 'limit'] as const) {
      const problem = valuesVariable(key, params[key], false);
      if (problem) return problem;
    }
    for (const key of ['offset', 'cursor'] as const) {
      if (params[key] === undefined) continue;
      const problem = valuesVariable(key, params[key], false);
      if (problem) return problem;
    }
    if (o.outputs !== undefined) {
      if (!isObject(o.outputs)) return 'ogc.outputs must be an object';
      for (const key of ['numberMatched', 'nextCursor'] as const) {
        const name = o.outputs[key];
        if (name === undefined) continue;
        if (!isName(name) || !outputs.has(name)) return `ogc.outputs.${key}: the query does not return ?${String(name)}`;
      }
      if (o.outputs.nextCursor !== undefined && params.cursor === undefined) {
        return 'ogc.outputs.nextCursor needs ogc.params.cursor, to send the cursor back';
      }
    }
    const cql = o.cql;
    if (!isObject(cql)) return 'ogc.cql must be an object';
    for (const key of ['configQuery', 'geometryField', 'datetimeField'] as const) {
      if (cql[key] !== undefined && !isName(cql[key])) return `ogc.cql.${key} must be text`;
    }
    if (cql.geometryField === undefined && cql.configQuery === undefined && (hasGeometry || o.point)) {
      return 'ogc.cql: give geometryField, or configQuery to find it, so bbox reaches the index';
    }
    if (cql.fields !== undefined) {
      if (!isObject(cql.fields)) return 'ogc.cql.fields must be an object of field IRIs';
      for (const [name, field] of Object.entries(cql.fields)) {
        if (!isName(field)) return `ogc.cql.fields.${name} must be a field IRI`;
      }
    }
  }

  if (o.queryables !== undefined) {
    if (!isObject(o.queryables)) return 'ogc.queryables must be an object';
    for (const [name, queryable] of Object.entries(o.queryables)) {
      if (OGC_RESERVED_PARAMS.includes(name)) return `ogc.queryables.${name}: "${name}" is an OGC parameter name`;
      if (!/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(name)) return `ogc.queryables.${name}: not a usable parameter name`;
      if (!isObject(queryable)) return `ogc.queryables.${name} must be an object`;
      const q = queryable as OgcQueryable;
      if (q.type !== undefined && !(OGC_QUERYABLE_TYPES as readonly string[]).includes(q.type)) {
        return `ogc.queryables.${name}.type must be one of ${OGC_QUERYABLE_TYPES.join(', ')}`;
      }
      if (o.mode === 'values') {
        if (q.type === undefined) return `ogc.queryables.${name}.type is required`;
        const problem = valuesVariable(`queryables.${name}`, q.var ?? name);
        if (problem) return problem.replace('ogc.params.', 'ogc.');
      } else if (q.var !== undefined) {
        return `ogc.queryables.${name}.var: a cql2 queryable is an index field, not a VALUES variable`;
      }
    }
  }

  if (o.pageSize !== undefined) {
    const { default: def = 10, max = OGC_MAX_PAGE_SIZE } = o.pageSize;
    if (![def, max].every(n => Number.isInteger(n) && n >= 1) || def > max || max > OGC_MAX_PAGE_SIZE) {
      return `ogc.pageSize: need 1 ≤ default ≤ max ≤ ${OGC_MAX_PAGE_SIZE}`;
    }
  }
  if (o.extent !== undefined) {
    const spatial = o.extent.spatial;
    if (spatial !== undefined && (!Array.isArray(spatial) || !spatial.every(box => Array.isArray(box) && box.length === 4 && box.every(n => typeof n === 'number')))) {
      return 'ogc.extent.spatial must be a list of [minx, miny, maxx, maxy]';
    }
    const temporal = o.extent.temporal;
    if (temporal !== undefined && (!Array.isArray(temporal) || !temporal.every(span => Array.isArray(span) && span.length === 2))) {
      return 'ogc.extent.temporal must be a list of [start, end]';
    }
  }
  if (o.omit !== undefined && (!Array.isArray(o.omit) || !o.omit.every(isName))) return 'ogc.omit must be a list of variable names';
  return null;
}

/** The variables an `ogc` object fills, each with the kind its values have. */
export function ogcParamKinds(ogc: OgcObject): Record<string, ToolParamSpec> {
  const params: Record<string, ToolParamSpec> = {};
  const set = (name: string | undefined, kind: ToolParamKind) => {
    if (name) params[name] = { kind };
  };
  set(ogc.feature.var, 'iri');
  const p = ogc.params ?? {};
  for (const name of p.bbox ?? []) set(name, 'decimal');
  for (const name of p.datetime ?? []) set(name, 'dateTime');
  set(p.limit, 'integer');
  set(p.offset, 'integer');
  set(p.skipGeometry, 'boolean');
  set(p.filter, 'string');
  set(p.cursor, 'string');
  if (ogc.mode === 'values') {
    for (const [name, queryable] of Object.entries(ogc.queryables ?? {})) {
      set(queryable.var ?? name, QUERYABLE_KIND[queryable.type ?? 'string']);
    }
  }
  return params;
}

const QUERYABLE_KIND: Record<OgcQueryableType, ToolParamKind> = {
  string: 'string',
  uri: 'iri',
  number: 'decimal',
  integer: 'integer',
  boolean: 'boolean',
  'date-time': 'dateTime',
};

/** A collection as served: its `ogc` object, the library it is in, and the tool spec its items call runs. */
export type OgcCollectionSpec = {
  slug: string;
  libraryId: string;
  ogc: OgcObject;
  /** The synthesized tool: pinned target, backend, inputs and one param per variable the `ogc` object fills. */
  tool: PublishedToolSpec;
};

// ------------------------------------------------------------- parameters --

/** A request the OGC routes refuse: 400 with this message. */
export class OgcRequestError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'OgcRequestError';
  }
}

/** `bbox=minx,miny,maxx,maxy` in CRS84. Six numbers, and a box across the antimeridian, are refused in v1. */
export function parseBbox(raw: string): [number, number, number, number] {
  const parts = raw.split(',').map(part => part.trim());
  if (parts.length === 6) throw new OgcRequestError('bbox: a 3D bbox (six numbers) is not supported; give four');
  if (parts.length !== 4) throw new OgcRequestError('bbox must be four numbers: minx,miny,maxx,maxy');
  const numbers = parts.map(Number);
  if (parts.some(part => part === '') || !numbers.every(Number.isFinite)) {
    throw new OgcRequestError('bbox must be four numbers: minx,miny,maxx,maxy');
  }
  const [minx, miny, maxx, maxy] = numbers as [number, number, number, number];
  if (miny < -90 || maxy > 90 || miny > maxy) throw new OgcRequestError('bbox: the latitudes must be within -90..90, south first');
  if (minx > maxx) throw new OgcRequestError('bbox: a box that crosses the antimeridian is not supported; split it in two');
  return [minx, miny, maxx, maxy];
}

const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseInstant(raw: string): string {
  if (DATE_ONLY.test(raw)) return `${raw}T00:00:00Z`;
  if (!RFC3339.test(raw) || Number.isNaN(Date.parse(raw))) {
    throw new OgcRequestError(`datetime: "${raw}" is not an RFC 3339 date-time`);
  }
  return raw;
}

/**
 * `datetime`: an instant, or an interval `start/end` where either end may be
 * `..` or empty. Returns the two ends, `null` for an open one. An instant is
 * both ends.
 */
export function parseDatetime(raw: string): { start: string | null; end: string | null } {
  if (!raw.includes('/')) {
    const instant = parseInstant(raw.trim());
    return { start: instant, end: instant };
  }
  const pieces = raw.split('/');
  if (pieces.length !== 2) throw new OgcRequestError('datetime: an interval is start/end');
  const [a, b] = pieces.map(piece => piece.trim()) as [string, string];
  const start = a === '' || a === '..' ? null : parseInstant(a);
  const end = b === '' || b === '..' ? null : parseInstant(b);
  if (start === null && end === null) throw new OgcRequestError('datetime: at least one end of the interval must be given');
  if (start !== null && end !== null && Date.parse(start) > Date.parse(end)) {
    throw new OgcRequestError('datetime: the start is after the end');
  }
  return { start, end };
}

/** `limit`: at least 1. Above the maximum, the maximum (Core says this is not an error). */
export function parseLimit(raw: string | undefined, pageSize: OgcObject['pageSize']): number {
  const def = pageSize?.default ?? 10;
  const max = pageSize?.max ?? OGC_MAX_PAGE_SIZE;
  if (raw === undefined) return def;
  if (!/^\d+$/.test(raw.trim())) throw new OgcRequestError('limit must be a whole number of at least 1');
  const value = Number(raw);
  if (value < 1) throw new OgcRequestError('limit must be a whole number of at least 1');
  return Math.min(value, max);
}

export function parseOffset(raw: string | undefined): number {
  if (raw === undefined) return 0;
  if (!/^\d+$/.test(raw.trim())) throw new OgcRequestError('offset must be a whole number');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > 2_000_000_000) throw new OgcRequestError('offset is too large');
  return value;
}

export function parseBoolean(name: string, raw: string): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  throw new OgcRequestError(`${name} must be true or false`);
}

// ------------------------------------------------------------------- CQL2 --

export type Cql2 = unknown;

/** Parse the `filter` parameter as CQL2-JSON. */
export function parseCql2Json(raw: string): Cql2 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new OgcRequestError('filter is not valid JSON; this collection takes filter-lang=cql2-json');
  }
  if (!isObject(parsed) || typeof parsed.op !== 'string') {
    throw new OgcRequestError('filter must be a CQL2-JSON expression: an object with "op" and "args"');
  }
  return parsed;
}

/** Every `{"property": name}` in a CQL2-JSON tree, in order. */
export function cqlProperties(node: Cql2): string[] {
  const found: string[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (isObject(value)) {
      if (typeof value.property === 'string' && Object.keys(value).length === 1) found.push(value.property);
      else Object.values(value).forEach(walk);
    }
  };
  walk(node);
  return found;
}

/**
 * The tree with every `{"property": name}` renamed by `rename`. A JSON walk,
 * not a parser: nothing else in the expression is read or changed.
 */
export function renameCqlProperties(node: Cql2, rename: (name: string) => string): Cql2 {
  if (Array.isArray(node)) return node.map(item => renameCqlProperties(item, rename));
  if (!isObject(node)) return node;
  if (typeof node.property === 'string' && Object.keys(node).length === 1) return { property: rename(node.property) };
  return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, renameCqlProperties(value, rename)]));
}

/** Every `{"op": …, "args": [{"property": p}, …]}` in the tree: the operator and the field it applies to. */
export function cqlComparisons(node: Cql2): Array<{ op: string; property: string }> {
  const found: Array<{ op: string; property: string }> = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (!isObject(value)) return;
    if (typeof value.op === 'string' && Array.isArray(value.args)) {
      for (const arg of value.args) {
        if (isObject(arg) && typeof arg.property === 'string') found.push({ op: value.op.toLowerCase(), property: arg.property });
      }
    }
    Object.values(value).forEach(walk);
  };
  walk(node);
  return found;
}

export function cqlBboxClause(field: string, bbox: [number, number, number, number]): Cql2 {
  return { op: 's_intersects', args: [{ property: field }, { bbox }] };
}

/** Range clauses on a temporal field: `>=` the start and `<=` the end, as the index documents. */
export function cqlDatetimeClauses(field: string, range: { start: string | null; end: string | null }): Cql2[] {
  if (range.start !== null && range.start === range.end) {
    return [{ op: '=', args: [{ property: field }, { timestamp: range.start }] }];
  }
  const clauses: Cql2[] = [];
  if (range.start !== null) clauses.push({ op: '>=', args: [{ property: field }, { timestamp: range.start }] });
  if (range.end !== null) clauses.push({ op: '<=', args: [{ property: field }, { timestamp: range.end }] });
  return clauses;
}

export function cqlEqualsClause(field: string, value: string | number | boolean): Cql2 {
  return { op: '=', args: [{ property: field }, value] };
}

/** One clause as it is; several under `and`; none as null. */
export function combineCql(clauses: Cql2[]): Cql2 | null {
  if (clauses.length === 0) return null;
  if (clauses.length === 1) return clauses[0]!;
  return { op: 'and', args: clauses };
}
