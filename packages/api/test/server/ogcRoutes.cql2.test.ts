/**
 * The `cql2` mode of the OGC routes, over a stand-in `/execute` that records
 * each body and answers as a Kurrawong `luc:query` would. The real index runs
 * on Fuseki only, so what is checked here is the call sqlib builds: the
 * filter it sends, the paging, and how the answer becomes features.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ogcParamKinds, type OgcCollectionSpec, type OgcObject } from '@sparql-query-lib/tools';
import { registerOgcRoutes } from '../../src/server/ogcRoutes.js';
import type { PublishedCatalogue } from '../../src/lib/publishedTools.js';

const FIELD = 'urn:jena:lucene:field#';
const IDX = 'urn:jena:lucene:index#';
const WKT = 'http://www.opengis.net/ont/geosparql#wktLiteral';

const ogc: OgcObject = {
  collectionId: 'buildings',
  title: 'Buildings',
  mode: 'cql2',
  feature: { var: 'feature', base: 'https://example.org/building/' },
  geometry: 'geom',
  params: { filter: 'cql', limit: 'limit', offset: 'offset', cursor: 'after', skipGeometry: 'skip' },
  outputs: { numberMatched: 'numberMatched', nextCursor: 'cursor' },
  cql: { configQuery: 'urn:q:config', datetimeField: `${FIELD}observed` },
  queryables: { name: { title: 'Name' }, height: { title: 'Height (m)' } },
  pageSize: { default: 2, max: 100 },
};

const spec: OgcCollectionSpec = {
  slug: 'survey',
  libraryId: 'urn:lib',
  libraryName: 'Survey',
  ogc,
  configTargetId: 'urn:q:config:v1',
  tool: {
    slug: 'survey',
    libraryId: 'urn:lib',
    name: 'ogc-buildings',
    description: 'Buildings',
    targetId: 'urn:q:buildings:v1',
    targetKind: 'query',
    readOnly: true,
    params: ogcParamKinds(ogc),
    inputs: { tables: [['feature'], ['cql', 'limit', 'offset', 'after'], ['skip']], limits: [], offsets: [] },
    defaultBackendId: 'urn:backend',
  },
};

const literal = (value: string, datatype?: string) => ({ type: 'literal', value, ...(datatype ? { datatype } : {}) });
const configRows = [
  ['name', 'KeywordField'],
  ['height', 'DoubleField'],
  ['observed', 'TemporalField'],
  ['location', 'LatLonField'],
  ['secret', 'KeywordField'],
].map(([name, type]) => ({ field: { type: 'uri', value: `${FIELD}${name}` }, type: { type: 'uri', value: `${IDX}${type}` } }));

function featureRow(id: string, cursor: string) {
  return {
    feature: { type: 'uri', value: `https://example.org/building/${id}` },
    geom: literal('POINT(115 -31)', WKT),
    name: literal(`Building ${id}`),
    numberMatched: literal('7', 'http://www.w3.org/2001/XMLSchema#long'),
    cursor: literal(cursor),
  };
}

describe('OGC routes in cql2 mode', () => {
  let app: FastifyInstance;
  const calls: Array<{ body: Record<string, unknown>; authorization?: string }> = [];
  let answer: { status: number; body: unknown } | null = null;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    app.post('/execute', async (request, reply) => {
      const body = request.body as Record<string, unknown>;
      calls.push({ body, authorization: request.headers.authorization });
      if (body.targetId === spec.configTargetId) {
        return reply.send({ head: { vars: ['field', 'type'] }, results: { bindings: configRows } });
      }
      if (answer) return reply.code(answer.status).send(answer.body);
      return reply.send({
        head: { vars: ['feature', 'geom', 'name', 'height', 'numberMatched', 'cursor'] },
        results: { bindings: [featureRow('a1', 'c1'), featureRow('b2', 'c2'), featureRow('c3', 'c3')] },
      });
    });
    const catalogue: PublishedCatalogue = { specs: [], collections: [spec], libraries: new Map(), problems: [] };
    await registerOgcRoutes(app, { catalogue, basePath: '', publicBasePath: '' });
    await app.ready();
  });

  afterAll(() => app.close());

  const get = async (url: string) => {
    calls.length = 0;
    const response = await app.inject({ method: 'GET', url, headers: { authorization: 'Bearer t' } });
    return { status: response.statusCode, body: response.json() };
  };
  /** The arguments of the last items call, by variable. */
  const lastArguments = () => {
    const body = calls.filter(call => call.body.targetId === spec.tool.targetId).at(-1)!.body;
    const values: Record<string, string> = {};
    for (const table of (body.arguments ?? []) as Array<{ results: { bindings: Array<Record<string, { value: string }>> } }>) {
      for (const [name, term] of Object.entries(table.results.bindings[0] ?? {})) values[name] = term.value;
    }
    return values;
  };

  it('declares Part 3 and CQL2 conformance', async () => {
    const conformance = await get('/ogc/survey/conformance');
    expect(conformance.body.conformsTo).toContain('http://www.opengis.net/spec/ogcapi-features-3/1.0/conf/filter');
    expect(conformance.body.conformsTo).toContain('http://www.opengis.net/spec/cql2/1.0/conf/cql2-json');
  });

  it('builds the queryables from luc:config, filtered by the ogc object, as the caller', async () => {
    const queryables = await get('/ogc/survey/collections/buildings/queryables');
    expect(queryables.body.properties).toEqual({
      name: { type: 'string', title: 'Name' },
      height: { type: 'number', title: 'Height (m)' },
      geometry: { format: 'geometry-any' },
    });
  });

  it('binds every luc:query argument on a plain call, and pages by cursor', async () => {
    const page = await get('/ogc/survey/collections/buildings/items');
    expect(page.status).toBe(200);
    expect(lastArguments()).toEqual({ cql: '', limit: '3', offset: '0', after: '*' });
    expect(calls.at(-1)!.authorization).toBe('Bearer t');
    expect(page.body.numberMatched).toBe(7);
    expect(page.body.numberReturned).toBe(2);
    expect(page.body.features.map((f: { id: string }) => f.id)).toEqual(['a1', 'b2']);
    expect(page.body.features[0].properties).toEqual({ name: 'Building a1' });
    const next = page.body.links.find((link: { rel: string }) => link.rel === 'next');
    expect(next.href).toBe('http://localhost:80/ogc/survey/collections/buildings/items?cursor=c2');

    await get('/ogc/survey/collections/buildings/items?cursor=c2');
    expect(lastArguments().after).toBe('c2');
  });

  it('renames filter properties to field IRIs and adds bbox, datetime and queryable clauses', async () => {
    const filter = JSON.stringify({ op: '>', args: [{ property: 'height' }, 10] });
    const query = new URLSearchParams({
      filter,
      'filter-lang': 'cql2-json',
      bbox: '110,-40,120,-30',
      datetime: '2025-01-01T00:00:00Z/..',
      name: 'Hall',
    });
    const page = await get(`/ogc/survey/collections/buildings/items?${query}`);
    expect(page.status).toBe(200);
    expect(JSON.parse(lastArguments().cql)).toEqual({
      op: 'and',
      args: [
        { op: '>', args: [{ property: `${FIELD}height` }, 10] },
        { op: 's_intersects', args: [{ property: `${FIELD}location` }, { bbox: [110, -40, 120, -30] }] },
        { op: '>=', args: [{ property: `${FIELD}observed` }, { timestamp: '2025-01-01T00:00:00Z' }] },
        { op: '=', args: [{ property: `${FIELD}name` }, 'Hall'] },
      ],
    });
  });

  it('refuses a filter the index would refuse, before the call', async () => {
    const range = JSON.stringify({ op: '<', args: [{ property: 'name' }, 'M'] });
    const refused = await get(`/ogc/survey/collections/buildings/items?filter-lang=cql2-json&filter=${encodeURIComponent(range)}`);
    expect(refused.status).toBe(400);
    expect(refused.body.description).toContain('text field');
    expect(calls.some(call => call.body.targetId === spec.tool.targetId)).toBe(false);

    const hidden = JSON.stringify({ op: '=', args: [{ property: 'secret' }, 'x'] });
    const notQueryable = await get(`/ogc/survey/collections/buildings/items?filter-lang=cql2-json&filter=${encodeURIComponent(hidden)}`);
    expect(notQueryable.status).toBe(400);
    expect(notQueryable.body.description).toContain('"secret"');

    const text = await get('/ogc/survey/collections/buildings/items?filter=name%3D%27x%27');
    expect(text.status).toBe(400);
    expect(text.body.description).toContain('cql2-json');
  });

  it('finds one feature by an entityIri clause', async () => {
    answer = {
      status: 200,
      body: { head: { vars: ['feature', 'geom', 'name'] }, results: { bindings: [featureRow('b2', 'c1')] } },
    };
    const one = await get('/ogc/survey/collections/buildings/items/b2');
    answer = null;
    expect(one.status).toBe(200);
    expect(one.body.id).toBe('b2');
    expect(JSON.parse(lastArguments().cql)).toEqual({ op: '=', args: [{ property: 'entityIri' }, 'https://example.org/building/b2'] });
    expect(lastArguments().feature).toBe('https://example.org/building/b2');
  });

  it('maps the index cursor errors to 400', async () => {
    answer = { status: 500, body: { error: 'luc:query failed: [LUC_CURSOR_MALFORMED] bad cursor' } };
    const bad = await get('/ogc/survey/collections/buildings/items?cursor=zz');
    answer = null;
    expect(bad.status).toBe(400);
    expect(bad.body.description).toContain('cursor');
  });

  it('passes other errors from /execute through', async () => {
    answer = { status: 403, body: { error: 'Forbidden' } };
    const forbidden = await get('/ogc/survey/collections/buildings/items');
    answer = null;
    expect(forbidden.status).toBe(403);
    expect(forbidden.body).toEqual({ error: 'Forbidden' });
  });
});
