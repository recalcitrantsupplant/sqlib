/**
 * OGC API Features: one service per library slug, under `/ogc/{slug}`, for
 * the query versions that carry an `ogc` object. See
 * `docs/proposals/ogc-api-features.md`, part 2.
 *
 * The metadata routes (landing page, conformance, API document, collections,
 * queryables) are built from the catalogue collected at startup. They read
 * nothing from the store, and any caller who can reach the server reads them,
 * as `/tools/{slug}/openapi.json` is read.
 *
 * `items` and one item run the pinned query version through `POST /execute`
 * with `app.inject` and the caller's own `Authorization` header, so a
 * collection grants nothing the same call on the same version would not. The
 * plugin asks for SPARQL JSON and serializes the rows itself: it needs the
 * raw rows to find the next page and to read the control columns.
 *
 * Not under `src/routes/`, for the reason `publishedToolRoutes.ts` gives.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { GEOJSON_MEDIA_TYPE, toFeatureCollection, type Feature, type SelectResults } from '@sparql-query-lib/geojson';
import {
  CRS84_URI,
  OgcRequestError,
  PublishedToolArgumentError,
  buildPublishedExecuteBody,
  checkCqlAgainstFields,
  combineCql,
  cqlBboxClause,
  cqlDatetimeClauses,
  cqlEqualsClause,
  indexFieldSchema,
  localName,
  ogcCollectionBody,
  ogcConformance,
  ogcItemsParameters,
  ogcOpenApiDocument,
  parseBbox,
  parseBoolean,
  parseCql2Json,
  parseDatetime,
  parseLimit,
  parseOffset,
  queryableSchema,
  renameCqlProperties,
  type Cql2,
  type IndexField,
  type OgcCollectionSpec,
  type OgcObject,
  type OgcQueryable,
} from '@sparql-query-lib/tools';
import type { PublishedCatalogue } from '../lib/publishedTools.js';

const JSON_TYPE = 'application/json';
const OPENAPI_TYPE = 'application/vnd.oai.openapi+json;version=3.0';
const SCHEMA_TYPE = 'application/schema+json';
const SPARQL_JSON = 'application/sparql-results+json';
const QUERYABLES_REL = 'http://www.opengis.net/def/rel/ogc/1.0/queryables';
const CRS84_SPELLINGS = new Set([CRS84_URI, CRS84_URI.replace('http://', 'https://')]);

/** Headers worth passing back from `/execute`. */
const FORWARDED_HEADERS = ['server-timing', 'cache-control'];

type Service = {
  slug: string;
  title: string;
  description?: string | null;
  collections: Map<string, OgcCollectionSpec>;
  conformance: string[];
};

type Query = Record<string, string | string[] | undefined>;

type Link = { rel: string; type?: string; title?: string; href: string };

/** An answer other than 200, with its message. */
class OgcAnswer extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export async function registerOgcRoutes(
  app: FastifyInstance,
  options: {
    catalogue: PublishedCatalogue;
    /** The prefix the API's routes are registered under, which `inject` needs. */
    basePath: string;
    /** The prefix clients see, for links when `SQLIB_OGC_BASE_URL` is unset. */
    publicBasePath: string;
  },
): Promise<void> {
  const { catalogue, basePath, publicBasePath } = options;
  const services = new Map<string, Service>();
  for (const spec of catalogue.collections) {
    let service = services.get(spec.slug);
    if (!service) {
      service = {
        slug: spec.slug,
        title: spec.libraryName,
        description: spec.libraryDescription,
        collections: new Map(),
        conformance: [],
      };
      services.set(spec.slug, service);
    }
    service.collections.set(spec.ogc.collectionId, spec);
  }
  for (const service of services.values()) {
    service.conformance = ogcConformance([...service.collections.values()].map(spec => spec.ogc));
  }

  /** Index fields by collection, kept once read. A failed read is not kept. */
  const indexFields = new Map<OgcCollectionSpec, IndexField[]>();

  const serviceUrl = (request: FastifyRequest, slug: string): string => {
    const configured = process.env.SQLIB_OGC_BASE_URL?.trim().replace(/\/+$/, '');
    const base = configured || `${request.protocol}://${request.host}${publicBasePath}`;
    return `${base}/ogc/${slug}`;
  };

  const serviceOf = (request: FastifyRequest): Service => {
    const { slug } = request.params as { slug: string };
    const service = services.get(slug);
    if (!service) throw new OgcAnswer(404, `No OGC service "${slug}".`);
    return service;
  };

  const collectionOf = (request: FastifyRequest): { service: Service; spec: OgcCollectionSpec } => {
    const service = serviceOf(request);
    const { collectionId } = request.params as { collectionId: string };
    const spec = service.collections.get(collectionId);
    if (!spec) throw new OgcAnswer(404, `No collection "${collectionId}" in "${service.slug}".`);
    return { service, spec };
  };

  /** `f` on a JSON document: `json`, or absent. */
  const checkJsonFormat = (request: FastifyRequest, formats: string[] = ['json']) => {
    const f = lastValue((request.query as Query).f);
    if (f !== undefined && !formats.includes(f)) {
      throw new OgcAnswer(400, `f: "${f}" is not a format of this resource. Use ${formats.join(' or ')}.`);
    }
  };

  const route = (
    url: string,
    handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
  ) => {
    app.get(url, { schema: { hide: true } }, async (request, reply) => {
      try {
        return await handler(request, reply);
      } catch (error) {
        if (error instanceof OgcAnswer || error instanceof OgcRequestError || error instanceof PublishedToolArgumentError) {
          const status = error instanceof OgcAnswer ? error.statusCode : 400;
          return reply.code(status).header('content-type', JSON_TYPE).send({ code: String(status), description: error.message });
        }
        throw error;
      }
    });
  };

  const landing = async (request: FastifyRequest, reply: FastifyReply) => {
    const service = serviceOf(request);
    checkJsonFormat(request);
    const root = serviceUrl(request, service.slug);
    return reply.header('content-type', JSON_TYPE).send({
      title: service.title,
      ...(service.description ? { description: service.description } : {}),
      links: [
        { rel: 'self', type: JSON_TYPE, title: 'This document', href: `${root}/` },
        { rel: 'service-desc', type: OPENAPI_TYPE, title: 'The API definition', href: `${root}/api` },
        { rel: 'conformance', type: JSON_TYPE, title: 'Conformance classes', href: `${root}/conformance` },
        { rel: 'data', type: JSON_TYPE, title: 'Collections', href: `${root}/collections` },
      ],
    });
  };
  route('/ogc/:slug', landing);
  route('/ogc/:slug/', landing);

  route('/ogc/:slug/conformance', async (request, reply) => {
    const service = serviceOf(request);
    checkJsonFormat(request);
    return reply.header('content-type', JSON_TYPE).send({ conformsTo: service.conformance });
  });

  route('/ogc/:slug/api', async (request, reply) => {
    const service = serviceOf(request);
    checkJsonFormat(request);
    const document = ogcOpenApiDocument({
      title: service.title,
      description: service.description,
      serviceUrl: serviceUrl(request, service.slug),
      collections: [...service.collections.values()].map(spec => spec.ogc),
    });
    return reply.header('content-type', OPENAPI_TYPE).send(JSON.stringify(document));
  });

  const collectionDocument = (request: FastifyRequest, service: Service, spec: OgcCollectionSpec) => {
    const root = `${serviceUrl(request, service.slug)}/collections/${spec.ogc.collectionId}`;
    const links: Link[] = [
      { rel: 'self', type: JSON_TYPE, title: spec.ogc.title, href: root },
      { rel: 'items', type: GEOJSON_MEDIA_TYPE, title: `${spec.ogc.title} features`, href: `${root}/items` },
      { rel: QUERYABLES_REL, type: SCHEMA_TYPE, title: 'Queryables', href: `${root}/queryables` },
    ];
    for (const source of spec.ogc.geometrySources ?? []) {
      links.push({ rel: 'alternate', href: source.href, ...(source.type ? { type: source.type } : {}), ...(source.title ? { title: source.title } : {}) });
    }
    return { ...ogcCollectionBody(spec.ogc), links };
  };

  route('/ogc/:slug/collections', async (request, reply) => {
    const service = serviceOf(request);
    checkJsonFormat(request);
    const root = serviceUrl(request, service.slug);
    return reply.header('content-type', JSON_TYPE).send({
      links: [{ rel: 'self', type: JSON_TYPE, title: 'Collections', href: `${root}/collections` }],
      collections: [...service.collections.values()].map(spec => collectionDocument(request, service, spec)),
    });
  });

  route('/ogc/:slug/collections/:collectionId', async (request, reply) => {
    const { service, spec } = collectionOf(request);
    checkJsonFormat(request);
    return reply.header('content-type', JSON_TYPE).send(collectionDocument(request, service, spec));
  });

  /** Run a body through `/execute` as the caller. */
  const execute = async (request: FastifyRequest, payload: object) => {
    const headers: Record<string, string> = { 'content-type': JSON_TYPE, accept: SPARQL_JSON };
    if (typeof request.headers.authorization === 'string') headers.authorization = request.headers.authorization;
    return app.inject({ method: 'POST', url: `${basePath}/execute`, headers, payload });
  };

  /** cql2 mode with `cql.configQuery`: the index fields, read once as the first caller who needs them. */
  const fieldsOf = async (request: FastifyRequest, spec: OgcCollectionSpec): Promise<IndexField[] | null> => {
    if (!spec.configTargetId) return null;
    const known = indexFields.get(spec);
    if (known) return known;
    const response = await execute(request, {
      targetId: spec.configTargetId,
      ...(spec.tool.defaultBackendId ? { backendId: spec.tool.defaultBackendId } : {}),
    });
    if (response.statusCode !== 200) {
      throw new OgcAnswer(
        response.statusCode === 401 || response.statusCode === 403 ? response.statusCode : 502,
        `The index fields could not be read: ${errorText(response.body)}`,
      );
    }
    const results = JSON.parse(response.body) as SelectResults;
    const fields: IndexField[] = [];
    for (const row of results.results.bindings) {
      const iri = row.field?.value;
      const type = row.type?.value;
      if (!iri || !type) continue;
      fields.push({ iri, name: localName(iri), type: localName(type) });
    }
    indexFields.set(spec, fields);
    return fields;
  };

  route('/ogc/:slug/collections/:collectionId/queryables', async (request, reply) => {
    const { service, spec } = collectionOf(request);
    checkJsonFormat(request);
    const { ogc } = spec;
    const url = `${serviceUrl(request, service.slug)}/collections/${ogc.collectionId}/queryables`;
    const properties: Record<string, unknown> = {};
    const fields = await fieldsOf(request, spec);
    if (fields) {
      const allow = ogc.queryables;
      for (const field of fields) {
        if (allow && !allow[field.name] && field.type !== 'LatLonField') continue;
        const name = field.type === 'LatLonField' ? 'geometry' : field.name;
        properties[name] = { ...indexFieldSchema(field.type), ...titleOf(allow?.[field.name]) };
      }
    } else {
      for (const [name, queryable] of Object.entries(ogc.queryables ?? {})) properties[name] = queryableSchema(queryable);
      if (ogc.mode === 'cql2' && geometryFieldOf(ogc, null)) properties.geometry = { format: 'geometry-any' };
    }
    return reply.header('content-type', SCHEMA_TYPE).send({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: url,
      type: 'object',
      title: ogc.title,
      properties,
      additionalProperties: false,
    });
  });

  route('/ogc/:slug/collections/:collectionId/items', async (request, reply) => {
    const { service, spec } = collectionOf(request);
    return runItems(request, reply, service, spec, null);
  });

  route('/ogc/:slug/collections/:collectionId/items/:featureId', async (request, reply) => {
    const { service, spec } = collectionOf(request);
    const { featureId } = request.params as { featureId: string };
    return runItems(request, reply, service, spec, featureId);
  });

  async function runItems(
    request: FastifyRequest,
    reply: FastifyReply,
    service: Service,
    spec: OgcCollectionSpec,
    featureId: string | null,
  ) {
    const { ogc } = spec;
    const query = request.query as Query;
    const allowed = new Set(featureId === null ? ogcItemsParameters(ogc) : ['f']);
    for (const key of Object.keys(query)) {
      if (!allowed.has(key)) throw new OgcAnswer(400, `"${key}" is not a parameter of this ${featureId === null ? 'collection' : 'feature'}.`);
    }
    const one = (key: string) => lastValue(query[key]);
    checkJsonFormat(request, ['geojson', 'json']);

    const p = ogc.params ?? {};
    const values: Record<string, unknown> = {};
    const limit = featureId === null ? parseLimit(one('limit'), ogc.pageSize) : 1;
    const offset = featureId === null ? parseOffset(one('offset')) : 0;
    const skipGeometry = one('skipGeometry') !== undefined && parseBoolean('skipGeometry', one('skipGeometry')!);
    if (skipGeometry && p.skipGeometry) values[p.skipGeometry] = true;
    const featureIri = featureId === null ? null : featureIriOf(ogc, featureId);
    if (featureIri) values[ogc.feature.var] = featureIri;

    const bboxRaw = one('bbox');
    const datetimeRaw = one('datetime');
    const bbox = bboxRaw === undefined ? null : parseBbox(bboxRaw);
    const datetime = datetimeRaw === undefined ? null : parseDatetime(datetimeRaw);
    const queryableValues = Object.entries(ogc.queryables ?? {})
      .filter(([name]) => one(name) !== undefined)
      .map(([name, queryable]) => ({ name, queryable, value: queryableValue(name, queryable, one(name)!) }));

    if (ogc.mode === 'values') {
      if (bbox) {
        if (!p.bbox) throw new OgcAnswer(400, 'bbox: this collection is not filtered by bbox.');
        p.bbox.forEach((name, index) => (values[name] = bbox[index]));
      }
      if (datetime) {
        if (!p.datetime) throw new OgcAnswer(400, 'datetime: this collection is not filtered by time.');
        if (datetime.start !== null) values[p.datetime[0]] = datetime.start;
        if (datetime.end !== null) values[p.datetime[1]] = datetime.end;
      }
      for (const { name, queryable, value } of queryableValues) values[queryable.var ?? name] = value;
      if (p.limit) values[p.limit] = limit + 1;
      if (p.offset) values[p.offset] = offset;
    } else {
      const fields = await fieldsOf(request, spec);
      const clauses: Cql2[] = [];
      const filterRaw = one('filter');
      if (filterRaw !== undefined) {
        const lang = one('filter-lang');
        if (lang !== 'cql2-json') throw new OgcAnswer(400, 'filter-lang: this collection accepts filter-lang=cql2-json only.');
        const crs = one('filter-crs');
        if (crs !== undefined && !CRS84_SPELLINGS.has(crs)) throw new OgcAnswer(400, `filter-crs: only ${CRS84_URI} is supported.`);
        clauses.push(renameCqlProperties(parseCql2Json(filterRaw), name => fieldIri(ogc, fields, name)));
      }
      if (bbox) {
        const geometryField = geometryFieldOf(ogc, fields);
        if (!geometryField) {
          throw new OgcAnswer(500, 'This collection has no single geometry field in its index; set ogc.cql.geometryField.');
        }
        clauses.push(cqlBboxClause(geometryField, bbox));
      }
      if (datetime) {
        if (!ogc.cql?.datetimeField) throw new OgcAnswer(400, 'datetime: this collection is not filtered by time.');
        clauses.push(...cqlDatetimeClauses(ogc.cql.datetimeField, datetime));
      }
      for (const { name, value } of queryableValues) {
        clauses.push(cqlEqualsClause(fieldIri(ogc, fields, name), value as string | number | boolean));
      }
      const combined = combineCql(clauses);
      if (combined && fields) {
        const problem = checkCqlAgainstFields(combined, fields);
        if (problem) throw new OgcAnswer(400, problem);
      }
      const withId = featureIri ? combineCql([...(combined ? [combined] : []), cqlEqualsClause('id', featureIri)]) : combined;
      values[p.filter!] = withId ? JSON.stringify(withId) : '';
      values[p.limit!] = limit + 1;
      if (p.offset) values[p.offset] = offset;
      if (p.cursor) values[p.cursor] = one('cursor') ?? '*';
    }

    const body = buildPublishedExecuteBody(spec.tool, values);
    const response = await execute(request, body);
    for (const name of FORWARDED_HEADERS) {
      const value = response.headers[name];
      if (value !== undefined) reply.header(name, value);
    }
    if (response.statusCode !== 200) {
      const text = response.body;
      if (/\[LUC_CURSOR_(MALFORMED|OTHER_SORT)\]/.test(text)) throw new OgcAnswer(400, 'cursor: the value is not a cursor of this collection.');
      if (text.includes('[LUC_ENTITY_SORT_NEEDS_REBUILD]')) throw new OgcAnswer(500, 'The index needs a rebuild before it can page this collection.');
      const contentType = response.headers['content-type'];
      if (contentType) reply.header('content-type', contentType);
      return reply.code(response.statusCode).send(response.rawPayload);
    }

    const results = JSON.parse(response.body) as SelectResults;
    const outputs = ogc.outputs ?? {};
    const controlVars = [
      ...(ogc.omit ?? []),
      ...Object.values(outputs).filter((name): name is string => Boolean(name)),
      ...paramVariables(ogc),
    ];
    const base = ogc.feature.base;
    const serialized = toFeatureCollection(results, {
      idVar: ogc.feature.var,
      ...(typeof ogc.geometry === 'string' ? { geometryVar: ogc.geometry } : {}),
      ...(ogc.point ? { pointVars: ogc.point } : {}),
      noGeometry: ogc.geometry === null || skipGeometry,
      omitVars: controlVars,
      idFromIri: iri => (base && iri.startsWith(base) && iri.length > base.length ? iri.slice(base.length) : iri),
    });
    // No rows: some stores then leave unbound columns out of `head.vars`, so there is nothing to check.
    if (!serialized.ok && results.results.bindings.length > 0) {
      throw new OgcAnswer(500, `The collection's query result is not features: ${serialized.detail}`);
    }
    const features = serialized.ok ? serialized.collection.features : [];
    const seen = new Set<string | number>();
    for (const feature of features) {
      if (feature.id === undefined) continue;
      if (seen.has(feature.id)) {
        throw new OgcAnswer(500, `The query returns feature ${feature.id} more than once; it must return one row per feature.`);
      }
      seen.add(feature.id);
    }

    const root = `${serviceUrl(request, service.slug)}/collections/${ogc.collectionId}`;
    const featureLinks = (feature: Feature): Link[] => [
      ...(feature.id !== undefined
        ? [{ rel: 'self', type: GEOJSON_MEDIA_TYPE, href: `${root}/items/${encodeURIComponent(String(feature.id))}` }]
        : []),
      { rel: 'collection', type: JSON_TYPE, href: root },
    ];

    reply.header('content-type', GEOJSON_MEDIA_TYPE);
    if (featureId !== null) {
      if (features.length === 0) throw new OgcAnswer(404, `No feature "${featureId}" in "${ogc.collectionId}".`);
      const feature = features[0]!;
      return reply.send({ ...feature, links: featureLinks(feature) });
    }

    const page = features.slice(0, limit);
    const itemsUrl = (changes: Record<string, string | null>) => {
      const params = new URLSearchParams();
      for (const [key, raw] of Object.entries(query)) {
        if (key in changes || raw === undefined) continue;
        for (const value of Array.isArray(raw) ? raw : [raw]) params.append(key, value);
      }
      for (const [key, value] of Object.entries(changes)) if (value !== null) params.set(key, value);
      const text = params.toString();
      return `${root}/items${text ? `?${text}` : ''}`;
    };
    const links: Link[] = [
      { rel: 'self', type: GEOJSON_MEDIA_TYPE, title: 'This page', href: itemsUrl({}) },
      { rel: 'collection', type: JSON_TYPE, title: ogc.title, href: root },
    ];
    if (features.length > limit) {
      if (ogc.mode === 'cql2' && p.cursor && outputs.nextCursor) {
        const lastRow = results.results.bindings[limit - 1];
        const cursor = lastRow?.[outputs.nextCursor]?.value;
        if (cursor) links.push({ rel: 'next', type: GEOJSON_MEDIA_TYPE, title: 'Next page', href: itemsUrl({ cursor, offset: null }) });
      } else if (p.offset) {
        links.push({ rel: 'next', type: GEOJSON_MEDIA_TYPE, title: 'Next page', href: itemsUrl({ offset: String(offset + limit) }) });
      }
    }
    if (p.offset && offset > 0 && !(ogc.mode === 'cql2' && one('cursor') !== undefined)) {
      links.push({ rel: 'prev', type: GEOJSON_MEDIA_TYPE, title: 'Previous page', href: itemsUrl({ offset: String(Math.max(0, offset - limit)) }) });
    }

    const envelope: Record<string, unknown> = {
      type: 'FeatureCollection',
      features: page.map(feature => ({ ...feature, links: featureLinks(feature) })),
      links,
      timeStamp: new Date().toISOString(),
      numberReturned: page.length,
    };
    if (outputs.numberMatched) {
      const matched = Number(results.results.bindings[0]?.[outputs.numberMatched]?.value);
      if (Number.isSafeInteger(matched)) envelope.numberMatched = matched;
      else if (results.results.bindings.length === 0) envelope.numberMatched = 0;
    }
    return reply.send(envelope);
  }
}

function lastValue(raw: string | string[] | undefined): string | undefined {
  return Array.isArray(raw) ? raw[raw.length - 1] : raw;
}

function titleOf(queryable: OgcQueryable | undefined): Record<string, string> {
  return {
    ...(queryable?.title ? { title: queryable.title } : {}),
    ...(queryable?.description ? { description: queryable.description } : {}),
  };
}

/** A feature id from a URL path: an absolute IRI as it is, else appended to `feature.base`. */
function featureIriOf(ogc: OgcObject, featureId: string): string {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(featureId) ? featureId : `${ogc.feature.base}${featureId}`;
}

/** The variables the `ogc` object fills, other than the feature and the queryables: never properties. */
function paramVariables(ogc: OgcObject): string[] {
  const p = ogc.params ?? {};
  return [...(p.bbox ?? []), ...(p.datetime ?? []), p.skipGeometry, p.filter, p.cursor, p.limit, p.offset].filter(
    (name): name is string => typeof name === 'string',
  );
}

/** A queryable's value from the query string, parsed by its type. */
function queryableValue(name: string, queryable: OgcQueryable, raw: string): unknown {
  switch (queryable.type ?? 'string') {
    case 'number': {
      const value = Number(raw);
      if (raw.trim() === '' || !Number.isFinite(value)) throw new OgcAnswer(400, `${name} must be a number.`);
      return value;
    }
    case 'integer': {
      if (!/^[-+]?\d+$/.test(raw.trim())) throw new OgcAnswer(400, `${name} must be a whole number.`);
      return Number(raw);
    }
    case 'boolean':
      return parseBoolean(name, raw);
    case 'date-time':
      return parseDatetime(raw).start;
    case 'uri':
      if (!/^[A-Za-z][A-Za-z0-9+.-]*:\S+$/.test(raw)) throw new OgcAnswer(400, `${name} must be an absolute IRI.`);
      return raw;
    default:
      return raw;
  }
}

/** The geometry field: `cql.geometryField`, else the index's one `LatLonField`. */
function geometryFieldOf(ogc: OgcObject, fields: IndexField[] | null): string | null {
  if (ogc.cql?.geometryField) return ogc.cql.geometryField;
  const spatial = (fields ?? []).filter(field => field.type === 'LatLonField');
  return spatial.length === 1 ? spatial[0]!.iri : null;
}

/**
 * A filter property as the index names it: `geometry` is the geometry field,
 * a name in `cql.fields` its IRI, an index field's local name its IRI, and a
 * field IRI stays. With the index fields known, any other name is a 400; and
 * when the `ogc` object lists queryables, only those are accepted.
 */
function fieldIri(ogc: OgcObject, fields: IndexField[] | null, name: string): string {
  if (name === 'geometry') {
    const geometry = geometryFieldOf(ogc, fields);
    if (!geometry) throw new OgcAnswer(500, 'This collection has no single geometry field in its index; set ogc.cql.geometryField.');
    return geometry;
  }
  const mapped = ogc.cql?.fields?.[name];
  if (mapped) return mapped;
  if (!fields) return name;
  if (fields.some(field => field.iri === name)) return name;
  const allowed = !ogc.queryables || Boolean(ogc.queryables[name]);
  const field = allowed ? fields.find(candidate => candidate.name === name) : undefined;
  if (!field) throw new OgcAnswer(400, `filter: "${name}" is not a queryable of this collection.`);
  return field.iri;
}

function errorText(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: unknown; message?: unknown };
    return String(parsed.error ?? parsed.message ?? body);
  } catch {
    return body;
  }
}
