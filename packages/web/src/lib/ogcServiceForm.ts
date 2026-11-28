/**
 * An OGC service collection as the collection editor holds it, and back.
 *
 * The editor works on flat strings, one per control, because a select or an
 * input holds a string. `collectionFromForm` builds the stored object from
 * them and drops what is empty, so a field left blank is absent rather than
 * `""`. Fields the editor has no control for (`extent`, `omit`, `cql`,
 * `outputs`, `geometrySources`, and `params.filter` / `params.cursor`) are
 * carried through unchanged in `rest`, so editing a collection never loses
 * them.
 *
 * Partial groups are sent as typed: a bbox with two of its four variables is
 * sent with two empty names, and the server's 400 names the field.
 */
import type { OgcServiceCollection } from '@/composables/useApiClient';
import { normaliseBase, withBase } from './basePath';

export const OGC_QUERYABLE_TYPES = ['string', 'number', 'integer', 'boolean', 'date-time', 'uri'] as const;
export type OgcQueryableType = (typeof OGC_QUERYABLE_TYPES)[number];

export const OGC_SERVICE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type GeometryKind = 'column' | 'point' | 'none';
/** How a JSON-LD term types its values: a plain literal, an IRI, a datatype or a language. */
export type ContextKind = 'literal' | 'iri' | 'datatype' | 'language';

export interface QueryableRow {
  name: string;
  variable: string;
  type: OgcQueryableType;
  title: string;
  /** Kept from the stored queryable; the editor has no control for it. */
  description: string;
}

export interface ContextRow {
  property: string;
  iri: string;
  kind: ContextKind;
  datatype: string;
  language: string;
}

export interface CollectionForm {
  query: string;
  /** A query version IRI, or empty to follow the query's version in the environment. */
  queryVersion: string;
  collectionId: string;
  title: string;
  description: string;
  mode: 'values' | 'cql2';
  featureVar: string;
  featureBase: string;
  geometryKind: GeometryKind;
  geometry: string;
  pointLon: string;
  pointLat: string;
  limit: string;
  offset: string;
  bbox: [string, string, string, string];
  datetimeStart: string;
  datetimeEnd: string;
  skipGeometry: string;
  pageSizeDefault: string;
  pageSizeMax: string;
  queryables: QueryableRow[];
  valuesQuery: string;
  context: ContextRow[];
  /** Everything the editor does not edit, carried through as stored. */
  rest: Record<string, unknown>;
}

const MANAGED_KEYS = [
  'query', 'queryVersion', 'collectionId', 'title', 'description', 'mode', 'feature', 'geometry',
  'point', 'params', 'queryables', 'valuesQuery', 'pageSize', 'context',
] as const;

const MANAGED_PARAMS = ['limit', 'offset', 'bbox', 'datetime', 'skipGeometry'] as const;

const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

export function emptyCollectionForm(): CollectionForm {
  return {
    query: '',
    queryVersion: '',
    collectionId: '',
    title: '',
    description: '',
    mode: 'values',
    featureVar: '',
    featureBase: '',
    geometryKind: 'column',
    geometry: '',
    pointLon: '',
    pointLat: '',
    limit: '',
    offset: '',
    bbox: ['', '', '', ''],
    datetimeStart: '',
    datetimeEnd: '',
    skipGeometry: '',
    pageSizeDefault: '',
    pageSizeMax: '',
    queryables: [],
    valuesQuery: '',
    context: [],
    rest: {},
  };
}

export function formFromCollection(collection: OgcServiceCollection): CollectionForm {
  const source = collection as unknown as Record<string, unknown>;
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!(MANAGED_KEYS as readonly string[]).includes(key)) rest[key] = value;
  }
  const params = (collection.params ?? {}) as Record<string, unknown>;
  const otherParams: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!(MANAGED_PARAMS as readonly string[]).includes(key)) otherParams[key] = value;
  }
  if (Object.keys(otherParams).length > 0) rest.params = otherParams;

  const bbox = Array.isArray(params.bbox) ? params.bbox : [];
  const datetime = Array.isArray(params.datetime) ? params.datetime : [];
  const geometryKind: GeometryKind = collection.point
    ? 'point'
    : collection.geometry === null ? 'none' : 'column';

  return {
    query: collection.query,
    queryVersion: collection.queryVersion ?? '',
    collectionId: collection.collectionId,
    title: collection.title,
    description: collection.description ?? '',
    mode: collection.mode,
    featureVar: collection.feature?.var ?? '',
    featureBase: collection.feature?.base ?? '',
    geometryKind,
    geometry: text(collection.geometry),
    pointLon: collection.point?.[0] ?? '',
    pointLat: collection.point?.[1] ?? '',
    limit: text(params.limit),
    offset: text(params.offset),
    bbox: [text(bbox[0]), text(bbox[1]), text(bbox[2]), text(bbox[3])],
    datetimeStart: text(datetime[0]),
    datetimeEnd: text(datetime[1]),
    skipGeometry: text(params.skipGeometry),
    pageSizeDefault: numberText(collection.pageSize?.default),
    pageSizeMax: numberText(collection.pageSize?.max),
    queryables: Object.entries(collection.queryables ?? {}).map(([name, queryable]) => ({
      name,
      variable: queryable.var ?? '',
      type: queryable.type ?? 'string',
      title: queryable.title ?? '',
      description: queryable.description ?? '',
    })),
    valuesQuery: collection.valuesQuery ?? '',
    context: Object.entries(collection.context ?? {}).map(([property, term]) => contextRow(property, term)),
    rest,
  };
}

function contextRow(property: string, term: { '@id': string; '@type'?: string; '@language'?: string }): ContextRow {
  const type = term['@type'];
  const kind: ContextKind = type === '@id'
    ? 'iri'
    : type ? 'datatype' : term['@language'] ? 'language' : 'literal';
  return {
    property,
    iri: term['@id'],
    kind,
    datatype: type && type !== '@id' ? type : '',
    language: term['@language'] ?? '',
  };
}

function positiveInteger(value: string): number | undefined {
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && String(parsed) === value.trim() ? parsed : undefined;
}

export function collectionFromForm(form: CollectionForm): OgcServiceCollection {
  const out: Record<string, unknown> = { ...form.rest };
  delete out.params;

  out.query = form.query;
  if (form.queryVersion) out.queryVersion = form.queryVersion;
  out.collectionId = form.collectionId.trim();
  out.title = form.title.trim();
  if (form.description.trim()) out.description = form.description.trim();
  out.mode = form.mode;
  out.feature = { var: form.featureVar, base: form.featureBase.trim() };

  if (form.geometryKind === 'column') {
    if (form.geometry) out.geometry = form.geometry;
  } else if (form.geometryKind === 'point') {
    out.point = [form.pointLon, form.pointLat];
  } else {
    out.geometry = null;
  }

  const params: Record<string, unknown> = { ...((form.rest.params as Record<string, unknown> | undefined) ?? {}) };
  if (form.limit) params.limit = form.limit;
  if (form.offset) params.offset = form.offset;
  if (form.bbox.some(Boolean)) params.bbox = [...form.bbox];
  if (form.datetimeStart || form.datetimeEnd) params.datetime = [form.datetimeStart, form.datetimeEnd];
  if (form.skipGeometry) params.skipGeometry = form.skipGeometry;
  if (Object.keys(params).length > 0) out.params = params;

  const queryables: Record<string, Record<string, string>> = {};
  for (const row of form.queryables) {
    const name = row.name.trim();
    if (!name) continue;
    const entry: Record<string, string> = { type: row.type };
    if (row.variable) entry.var = row.variable;
    if (row.title.trim()) entry.title = row.title.trim();
    if (row.description.trim()) entry.description = row.description.trim();
    queryables[name] = entry;
  }
  if (Object.keys(queryables).length > 0) out.queryables = queryables;

  if (form.valuesQuery) out.valuesQuery = form.valuesQuery;

  const pageSize: Record<string, number> = {};
  const pageDefault = positiveInteger(form.pageSizeDefault);
  const pageMax = positiveInteger(form.pageSizeMax);
  if (pageDefault !== undefined) pageSize.default = pageDefault;
  if (pageMax !== undefined) pageSize.max = pageMax;
  if (Object.keys(pageSize).length > 0) out.pageSize = pageSize;

  const context: Record<string, Record<string, string>> = {};
  for (const row of form.context) {
    if (!row.property || !row.iri.trim()) continue;
    const term: Record<string, string> = { '@id': row.iri.trim() };
    if (row.kind === 'iri') term['@type'] = '@id';
    if (row.kind === 'datatype' && row.datatype && row.datatype !== XSD_STRING) term['@type'] = row.datatype;
    if (row.kind === 'language' && row.language.trim()) term['@language'] = row.language.trim();
    context[row.property] = term;
  }
  if (Object.keys(context).length > 0) out.context = context;

  return out as unknown as OgcServiceCollection;
}

/** What a query declares and projects, as the selects list them. */
export interface QuerySignature {
  outputs: string[];
  /** Each VALUES clause's variables. */
  valuesInputs: string[][];
  limitParameters: string[];
  offsetParameters: string[];
}

/** The variables of every VALUES clause, in order, without repeats. */
export function valuesVariables(signature: QuerySignature | null): string[] {
  return [...new Set((signature?.valuesInputs ?? []).flat())];
}

/** The output columns a JSON-LD term can name: all but the feature and geometry columns. */
export function propertyColumns(form: CollectionForm, signature: QuerySignature | null): string[] {
  const taken = new Set([form.featureVar]);
  if (form.geometryKind === 'column') taken.add(form.geometry);
  if (form.geometryKind === 'point') {
    taken.add(form.pointLon);
    taken.add(form.pointLat);
  }
  return (signature?.outputs ?? []).filter((column) => !taken.has(column));
}

const GEOMETRY_NAMES = ['geom', 'geometry', 'wkt', 'geojson', 'shape'];
const BBOX_NAMES: Array<[string, string, string, string]> = [
  ['minx', 'miny', 'maxx', 'maxy'],
  ['minLon', 'minLat', 'maxLon', 'maxLat'],
  ['west', 'south', 'east', 'north'],
];

/**
 * Fill the empty mapping fields from a query's signature, where the names
 * leave no doubt: a `feature` column, a `geom` column, the one LIMIT and the
 * one OFFSET, `minx miny maxx maxy`. A field already set is left alone.
 */
export function suggestMapping(form: CollectionForm, signature: QuerySignature): CollectionForm {
  const next: CollectionForm = { ...form, bbox: [...form.bbox] as CollectionForm['bbox'] };
  const outputs = signature.outputs;
  const variables = valuesVariables(signature);
  if (!next.featureVar) {
    next.featureVar = outputs.find((column) => column === 'feature') ?? outputs[0] ?? '';
  }
  if (next.geometryKind === 'column' && !next.geometry) {
    next.geometry = outputs.find((column) => GEOMETRY_NAMES.includes(column.toLowerCase())) ?? '';
  }
  if (!next.limit && signature.limitParameters.length === 1) next.limit = signature.limitParameters[0]!;
  if (!next.offset && signature.offsetParameters.length === 1) next.offset = signature.offsetParameters[0]!;
  if (!next.bbox.some(Boolean)) {
    const match = BBOX_NAMES.find((names) => names.every((name) => variables.includes(name)));
    if (match) next.bbox = [...match];
  }
  if (!next.skipGeometry) {
    next.skipGeometry = variables.find((name) => name === 'skip' || name === 'skipGeometry') ?? '';
  }
  return next;
}

/** "v3" for a pinned version, "Follows environment" for none. */
export function versionLabel(collection: OgcServiceCollection, versionNumbers: ReadonlyMap<string, number>): string {
  if (!collection.queryVersion) return 'Follows environment';
  const number = versionNumbers.get(collection.queryVersion);
  return number === undefined ? 'Pinned' : `v${number}`;
}

export function queryableCount(collection: OgcServiceCollection): number {
  return Object.keys(collection.queryables ?? {}).length;
}

export function hasContext(collection: OgcServiceCollection): boolean {
  return Object.keys(collection.context ?? {}).length > 0;
}

/** A collection id not yet in the list: `collection`, `collection-2`, … */
export function freshCollectionId(taken: readonly string[]): string {
  if (!taken.includes('collection')) return 'collection';
  let n = 2;
  while (taken.includes(`collection-${n}`)) n += 1;
  return `collection-${n}`;
}

/** Where a service is served: `{API base}/ogc/{slug}`. */
export function ogcServiceUrl(apiBaseUrl: string, slug: string): string {
  return `${apiBaseUrl.replace(/\/+$/, '')}/ogc/${slug}`;
}

/**
 * The browser demo's map page for a service, or null where there is none.
 *
 * Only a build whose API runs in the browser ships the page, at `map/` beside
 * the app. Such a build's API base is `{app base}api` once the Worker is
 * installed (`plugins/runtime-config.client.ts`), and `browser` before.
 */
export function ogcMapUrl(
  options: { apiBaseUrl: string; appBase: string | undefined; origin: string },
  slug: string,
): string | null {
  const base = normaliseBase(options.appBase);
  const browserBase = `${options.origin}${withBase('/api', base)}`;
  const api = options.apiBaseUrl.replace(/\/+$/, '');
  if (api !== 'browser' && api !== browserBase) return null;
  return `${withBase('/map/', base)}?service=${encodeURIComponent(slug)}`;
}

/** The fields a collection cannot be saved without, by the label the editor gives them. */
export type RequiredField = 'Query' | 'Id' | 'Title' | 'Feature column' | 'Base IRI' | 'Longitude' | 'Latitude';

/** The required fields a collection leaves empty, in the editor's order. */
export function missingFields(collection: OgcServiceCollection): RequiredField[] {
  const missing: RequiredField[] = [];
  if (!collection.query) missing.push('Query');
  if (!collection.collectionId?.trim()) missing.push('Id');
  if (!collection.title?.trim()) missing.push('Title');
  if (!collection.feature?.var) missing.push('Feature column');
  if (!collection.feature?.base?.trim()) missing.push('Base IRI');
  if (collection.point) {
    if (!collection.point[0]) missing.push('Longitude');
    if (!collection.point[1]) missing.push('Latitude');
  }
  return missing;
}

/**
 * The first collection with an empty required field, as the line Save shows,
 * in the shape of the server's own: `collections[0] ("stations"): Base IRI is empty`.
 */
export function firstMissing(collections: readonly OgcServiceCollection[]): { index: number; message: string } | null {
  for (const [index, collection] of collections.entries()) {
    const missing = missingFields(collection);
    if (missing.length === 0) continue;
    const name = collection.collectionId?.trim() || collection.title?.trim() || '';
    const fields = missing.join(', ');
    return {
      index,
      message: `collections[${index}]${name ? ` ("${name}")` : ''}: ${fields} ${missing.length === 1 ? 'is' : 'are'} empty`,
    };
  }
  return null;
}
