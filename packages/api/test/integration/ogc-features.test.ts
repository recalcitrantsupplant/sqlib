/**
 * OGC API Features, against a real API instance
 * (`docs/proposals/ogc-api-features.md`).
 *
 * The first instance is the author's: it saves a query version with an `ogc`
 * object, which is where the object is checked and carried forward. The
 * collections are collected when a server starts, so a second instance, with
 * `FEATURE_OGC=true`, is the one that serves them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

type Json = ReturnType<typeof JSON.parse>;

const BUILDINGS = `PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX ex:  <https://example.org/ns#>
SELECT ?feature ?geom ?name ?height WHERE {
  VALUES ?feature { UNDEF }
  VALUES (?minx ?miny ?maxx ?maxy) { (UNDEF UNDEF UNDEF UNDEF) }
  VALUES (?start ?end) { (UNDEF UNDEF) }
  VALUES ?name { UNDEF }
  VALUES ?skip { UNDEF }
  ?feature a ex:Building ;
           ex:name ?name ;
           ex:minLon ?x0 ; ex:minLat ?y0 ; ex:maxLon ?x1 ; ex:maxLat ?y1 .
  OPTIONAL {
    ?feature geo:hasGeometry/geo:asWKT ?geom .
    FILTER(!BOUND(?skip) || !?skip)
  }
  OPTIONAL { ?feature ex:height ?height }
  OPTIONAL { ?feature ex:surveyed ?when }
  FILTER(!BOUND(?minx) || (?x1 >= ?minx && ?x0 <= ?maxx && ?y1 >= ?miny && ?y0 <= ?maxy))
  FILTER(!BOUND(?start) || (BOUND(?when) && ?when >= ?start))
  FILTER(!BOUND(?end)   || (BOUND(?when) && ?when <= ?end))
}
ORDER BY ?feature
LIMIT 0001
OFFSET 0002`;

const OGC = {
  collectionId: 'buildings',
  title: 'Buildings',
  mode: 'values',
  feature: { var: 'feature', base: 'https://example.org/building/' },
  geometry: 'geom',
  params: { limit: '1', offset: '2', bbox: ['minx', 'miny', 'maxx', 'maxy'], datetime: ['start', 'end'], skipGeometry: 'skip' },
  queryables: { name: { var: 'name', type: 'string', title: 'Name' } },
  pageSize: { default: 2, max: 10 },
  extent: { spatial: [[115, -35, 154, -12]] },
};

/** Three buildings, in Perth, Darwin and Sydney; the Darwin one surveyed in 2025. */
function building(id: string, name: string, lon: number, lat: number, extra = ''): string {
  return `<https://example.org/building/${id}> a ex:Building ; ex:name "${name}" ;
  ex:minLon ${lon - 0.01} ; ex:minLat ${lat - 0.01} ; ex:maxLon ${lon + 0.01} ; ex:maxLat ${lat + 0.01} ;
  geo:hasGeometry [ geo:asWKT "POINT(${lon} ${lat})"^^geo:wktLiteral ] ${extra} .`;
}
const DATA = `@prefix ex: <https://example.org/ns#> . @prefix geo: <http://www.opengis.net/ont/geosparql#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
${building('a1', 'Perth Hall', 115.86, -31.95, '; ex:height 12')}
${building('b2', 'Darwin Depot', 130.84, -12.46, '; ex:surveyed "2025-03-01T00:00:00Z"^^xsd:dateTime')}
${building('c3', 'Sydney Store', 151.21, -33.87)}`;

describe('OGC API Features, against a real API instance', () => {
  let author: FastifyInstance;
  let server: FastifyInstance;
  const teardowns: Array<() => Promise<void>> = [];
  let outputDir: string;
  const ids: Record<string, string> = {};

  const previousEnv: Record<string, string | undefined> = {};
  const setEnv = (key: string, value: string | undefined) => {
    if (!(key in previousEnv)) previousEnv[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  async function startServer(): Promise<FastifyInstance> {
    const { configureApp } = await import('../../src/index.js');
    const app = Fastify({ logger: false });
    const { teardown } = await configureApp(app as never, { enableCacheMonitoring: false, registerSwagger: false });
    teardowns.push(teardowns.length === 0 ? teardown : () => app.close());
    await app.ready();
    return app;
  }

  const send = async (app: FastifyInstance, method: 'GET' | 'POST', url: string, payload?: object) => {
    const response = await app.inject({ method, url, ...(payload ? { payload } : {}) });
    let body: Json;
    try {
      body = response.body ? response.json() : null;
    } catch {
      body = response.body;
    }
    return { status: response.statusCode, body, headers: response.headers };
  };
  const get = (url: string) => send(server, 'GET', url);
  const saveVersion = (queryId: string, queryVersion: Json) =>
    send(author, 'POST', `/queries/${encodeURIComponent(queryId)}/versions`, { queryVersion });

  beforeAll(async () => {
    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ogc-features-'));
    setEnv('FEATURE_QUERIES', 'true');
    setEnv('FEATURE_BACKENDS', 'true');
    setEnv('FEATURE_DATA_GRAPHS', 'true');
    setEnv('FEATURE_OGC', 'true');
    setEnv('SQLIB_OGC_BASE_URL', 'https://maps.example.org');
    setEnv('INTERNAL_BACKEND_TYPE', 'oxigraph-memory');
    setEnv('OXIGRAPH_STORAGE_DIR', path.join(outputDir, 'oxigraph'));
    setEnv('MCP_CATALOGUE', undefined);
    const { oxigraphStoreManager } = await import('../../src/lib/OxigraphStoreManager.js');
    await oxigraphStoreManager.initialize(path.join(outputDir, 'oxigraph'));
    author = await startServer();

    const library = await send(author, 'POST', '/libraries', { name: 'Survey', slug: 'survey', description: 'Survey data.' });
    expect(library.status).toBe(201);
    ids.library = library.body.id;
    const dataGraph = await send(author, 'POST', '/data-graphs', { name: 'Buildings', isPartOf: [ids.library] });
    ids.dataGraph = dataGraph.body.id;
    const graphVersion = await send(author, 'POST', `/data-graphs/${encodeURIComponent(ids.dataGraph)}/versions`, {
      contentString: DATA,
      contentFormat: 'text/turtle',
    });
    expect(graphVersion.status).toBeLessThan(300);
    const backend = await send(author, 'POST', '/backends', {
      name: 'Survey store',
      backendType: 'oxigraphMemory',
      oxigraphConfig: JSON.stringify({ storeType: 'ephemeral', mode: 'ephemeral', sources: [{ dataGraphId: ids.dataGraph }] }),
    });
    expect(backend.status).toBe(201);
    const query = await send(author, 'POST', '/queries', { name: 'Buildings', isPartOf: [ids.library], defaultBackend: backend.body.id });
    ids.query = query.body.id;
  }, 120_000);

  afterAll(async () => {
    for (const teardown of teardowns.reverse()) await teardown();
    await fs.rm(outputDir, { recursive: true, force: true });
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('checks the ogc object when the version is saved, naming the key', async () => {
    const wrong = await saveVersion(ids.query, { queryString: BUILDINGS, ogc: { ...OGC, params: { ...OGC.params, limit: '7' } } });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error).toContain('ogc.params.limit');
  });

  it('stores the ogc object, and carries it to a version that sends none', async () => {
    const first = await saveVersion(ids.query, { queryString: BUILDINGS, ogc: OGC });
    expect(first.status).toBe(201);
    expect(first.body.queryVersion.ogc).toEqual(OGC);
    const second = await saveVersion(ids.query, { queryString: BUILDINGS.replace('ORDER BY ?feature', 'ORDER BY ?feature ?name') });
    expect(second.status).toBe(201);
    expect(second.body.queryVersion.ogc).toEqual(OGC);
    const dropped = await saveVersion(ids.query, { queryString: BUILDINGS.replace('LIMIT 0001', 'LIMIT 5') });
    expect(dropped.status).toBe(400);
    expect(dropped.body.error).toMatch(/ogc\.params\.limit.*copied from version 2/);
  });

  describe('a server started after the collection was saved', () => {
    beforeAll(async () => {
      server = await startServer();
    }, 120_000);

    it('serves the landing page, conformance and the API document', async () => {
      const landing = await get('/ogc/survey/');
      expect(landing.status).toBe(200);
      expect(landing.body.title).toBe('Survey');
      expect(landing.body.links.map((link: { rel: string }) => link.rel)).toEqual(['self', 'service-desc', 'conformance', 'data']);
      expect(landing.body.links[0].href).toBe('https://maps.example.org/ogc/survey/');

      const conformance = await get('/ogc/survey/conformance');
      expect(conformance.body.conformsTo).toContain('http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core');
      expect(conformance.body.conformsTo).not.toContain('http://www.opengis.net/spec/ogcapi-features-3/1.0/conf/filter');

      const api = await get('/ogc/survey/api');
      expect(api.status).toBe(200);
      expect(api.headers['content-type']).toContain('application/vnd.oai.openapi+json');
      expect(api.body.openapi).toBe('3.0.3');
      expect(Object.keys(api.body.paths)).toContain('/collections/buildings/items');
    });

    it('lists the collection, with its extent and links', async () => {
      const collections = await get('/ogc/survey/collections');
      expect(collections.status).toBe(200);
      expect(collections.body.collections).toHaveLength(1);
      const one = await get('/ogc/survey/collections/buildings');
      expect(one.body).toMatchObject({ id: 'buildings', title: 'Buildings', itemType: 'feature' });
      expect(one.body.extent.spatial.bbox).toEqual([[115, -35, 154, -12]]);
      expect(one.body.links.map((link: { rel: string }) => link.rel)).toContain('items');
      expect((await get('/ogc/survey/collections/nope')).status).toBe(404);
      expect((await get('/ogc/nope/collections')).status).toBe(404);
    });

    it('serves the queryables as JSON Schema', async () => {
      const queryables = await get('/ogc/survey/collections/buildings/queryables');
      expect(queryables.status).toBe(200);
      expect(queryables.headers['content-type']).toContain('application/schema+json');
      expect(queryables.body.properties).toEqual({ name: { type: 'string', title: 'Name' } });
    });

    it('pages the features, with next and prev links', async () => {
      const first = await get('/ogc/survey/collections/buildings/items');
      expect(first.status).toBe(200);
      expect(first.headers['content-type']).toMatch(/^application\/geo\+json/);
      expect(first.body.type).toBe('FeatureCollection');
      expect(first.body.numberReturned).toBe(2);
      expect(first.body.features.map((f: { id: string }) => f.id)).toEqual(['a1', 'b2']);
      expect(first.body.features[0]).toMatchObject({
        geometry: { type: 'Point', coordinates: [115.86, -31.95] },
        properties: { name: 'Perth Hall', height: 12 },
      });
      const next = first.body.links.find((link: { rel: string }) => link.rel === 'next');
      expect(next.href).toBe('https://maps.example.org/ogc/survey/collections/buildings/items?offset=2');

      const second = await get('/ogc/survey/collections/buildings/items?offset=2');
      expect(second.body.features.map((f: { id: string }) => f.id)).toEqual(['c3']);
      const rels = second.body.links.map((link: { rel: string }) => link.rel);
      expect(rels).toContain('prev');
      expect(rels).not.toContain('next');
    });

    it('filters by bbox, datetime and a queryable', async () => {
      const bbox = await get('/ogc/survey/collections/buildings/items?bbox=150,-35,153,-30');
      expect(bbox.body.features.map((f: { id: string }) => f.id)).toEqual(['c3']);
      const datetime = await get('/ogc/survey/collections/buildings/items?datetime=2025-01-01T00:00:00Z/..');
      expect(datetime.body.features.map((f: { id: string }) => f.id)).toEqual(['b2']);
      const name = await get('/ogc/survey/collections/buildings/items?name=Perth%20Hall');
      expect(name.body.features.map((f: { id: string }) => f.id)).toEqual(['a1']);
    });

    it('leaves the geometry out when asked', async () => {
      const skipped = await get('/ogc/survey/collections/buildings/items?skipGeometry=true&limit=3');
      expect(skipped.status).toBe(200);
      expect(skipped.body.features).toHaveLength(3);
      for (const feature of skipped.body.features) expect(feature.geometry).toBeNull();
    });

    it('answers 400 for an unknown or malformed parameter', async () => {
      const unknown = await get('/ogc/survey/collections/buildings/items?colour=red');
      expect(unknown.status).toBe(400);
      expect(unknown.body.description).toContain('colour');
      expect((await get('/ogc/survey/collections/buildings/items?bbox=1,2,3')).status).toBe(400);
      expect((await get('/ogc/survey/collections/buildings/items?limit=0')).status).toBe(400);
      expect((await get('/ogc/survey/collections/buildings/items?filter=x')).status).toBe(400);
      expect((await get('/ogc/survey/collections/buildings/items?f=html')).status).toBe(400);
    });

    it('serves one feature by its id, and 404 for none', async () => {
      const one = await get('/ogc/survey/collections/buildings/items/b2');
      expect(one.status).toBe(200);
      expect(one.body).toMatchObject({ type: 'Feature', id: 'b2', properties: { name: 'Darwin Depot' } });
      expect(one.body.links[0].href).toBe('https://maps.example.org/ogc/survey/collections/buildings/items/b2');
      const none = await get('/ogc/survey/collections/buildings/items/zz9');
      expect(none.status).toBe(404);
    });
  });

  describe('a server with MCP_CATALOGUE=published', () => {
    it('serves the collections, and runs their pinned version through /execute', async () => {
      setEnv('MCP_CATALOGUE', 'published');
      const published = await startServer();
      const items = await send(published, 'GET', '/ogc/survey/collections/buildings/items?limit=1');
      expect(items.status).toBe(200);
      expect(items.body.features.map((f: { id: string }) => f.id)).toEqual(['a1']);
      expect((await send(published, 'GET', '/ogc/survey/conformance')).status).toBe(200);
      expect((await send(published, 'GET', `/queries/${encodeURIComponent(ids.query)}`)).status).toBe(404);
    }, 120_000);
  });
});
