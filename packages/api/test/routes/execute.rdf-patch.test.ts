/**
 * `POST /execute` with `Accept: text/rdf-patch` — an update query's output.
 *
 * Until #290 an update had none: it ran, answered `204`, and left nothing to
 * render. Asked for the patch, the same run derives instead of executing, which
 * is the pair of properties every test here is about — a document comes back,
 * and the store is exactly as it was.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as oxigraph from 'oxigraph';
import executeRoutes from '../../src/routes/execute.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import { oxigraphStoreManager } from '../../src/lib/OxigraphStoreManager.js';
import { BackendTypeIri } from '../../src/persistence/schemas/BackendSchema.js';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import { EPHEMERAL_BACKEND_ID } from '@sparql-query-lib/types';

const BACKEND_ID = 'urn:sqlib:backend:execute-patch';
const VERSION_ID = 'urn:sqlib:query-version:promote';
const LOAD_VERSION_ID = 'urn:sqlib:query-version:load';

const PROMOTE =
  'DELETE { ?s <http://ex/status> "draft" } INSERT { ?s <http://ex/status> "live" } WHERE { ?s <http://ex/status> "draft" }';

const BACKEND = {
  $id: BACKEND_ID,
  '@type': 'Backend',
  name: 'Execute patch test',
  backendType: BackendTypeIri.oxigraphEphemeral,
};

/**
 * The cache the route reads its target and backend from, as a plain map.
 *
 * Hoisted with the mock factory, because a `vi.mock` factory runs before the
 * module body and can only close over what `vi.hoisted` gives it.
 */
const { entities, patchStore, patchRepo } = vi.hoisted(() => {
  const store = new Map<string, Record<string, unknown>>();
  return {
    entities: new Map<string, unknown>(),
    patchStore: store,
    patchRepo: {
      get: (id: string) => store.get(id) ?? null,
      list: () => [...store.values()],
      create: async (entity: Record<string, unknown>) => {
        const record = { ...entity, '@type': 'Patch', dateCreated: new Date().toISOString() };
        store.set(entity.$id as string, record);
        return record;
      },
      update: async () => null,
      delete: async (id: string) => {
        store.delete(id);
      },
    },
  };
});

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({ get: (id: string) => entities.get(id) ?? null }),
  getEntityRepositories: () => ({ Patch: patchRepo }),
}));

vi.mock('../../src/persistence/utils/BackendUtils.js', () => ({
  Backends: {
    findByIri: async (iri: string) => entities.get(iri) ?? null,
  },
}));

entities.set(BACKEND_ID, BACKEND);
entities.set(VERSION_ID, {
  $id: VERSION_ID,
  '@type': 'QueryVersion',
  queryString: PROMOTE,
  queryType: QueryTypeIri.update,
});
entities.set(LOAD_VERSION_ID, {
  $id: LOAD_VERSION_ID,
  '@type': 'QueryVersion',
  queryString: 'LOAD <https://example.org/data.ttl>',
  queryType: QueryTypeIri.update,
});

const SEED = `
<http://ex/a> <http://ex/status> "draft" .
<http://ex/b> <http://ex/status> "draft" .
<http://ex/c> <http://ex/status> "live" .
`;

function store(): oxigraph.Store {
  return oxigraphStoreManager.getEphemeralStore(BACKEND_ID)!;
}

function statuses(): string[] {
  return (store().query('SELECT ?o WHERE { ?s <http://ex/status> ?o }') as Array<Map<string, { value: string }>>)
    .map((row) => row.get('o')!.value)
    .sort();
}

describe('POST /execute with Accept: text/rdf-patch', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);
    await app.register(executeRoutes, { prefix: '/execute' });
    await app.ready();
  });

  beforeEach(() => {
    patchStore.clear();
    const fresh = oxigraphStoreManager.createEphemeralStore(BACKEND_ID);
    fresh.update('DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }');
    fresh.load(SEED, { format: 'application/n-quads' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers with the diff and leaves the store alone', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/execute/',
      headers: { accept: 'text/rdf-patch' },
      payload: { targetId: VERSION_ID, backendId: BACKEND_ID },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/rdf-patch');
    expect(response.body).toContain('D <http://ex/a> <http://ex/status> "draft"');
    expect(response.body).toContain('A <http://ex/a> <http://ex/status> "live"');

    // Derived, not executed.
    expect(statuses()).toEqual(['draft', 'draft', 'live']);

    // The document names the record it came from, so a caller can apply it.
    const patchId = response.headers['x-sqlib-patch-id'] as string;
    expect(patchStore.get(patchId)).toMatchObject({ patchStatus: 'previewed', isPartOf: BACKEND_ID });
  });

  it('still runs the update when nobody asked for the patch', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/execute/',
      payload: { targetId: VERSION_ID, backendId: BACKEND_ID },
    });

    expect(response.statusCode).toBe(204);
    expect(statuses()).toEqual(['live', 'live', 'live']);
    expect(patchStore.size).toBe(0);
  });

  it('refuses a backend that has no patch log to derive against', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/execute/',
      headers: { accept: 'text/rdf-patch' },
      payload: { targetId: VERSION_ID, backendId: EPHEMERAL_BACKEND_ID },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('ephemeral');
  });

  it('refuses to render a graph-management operation RDF Patch cannot express', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/execute/',
      headers: { accept: 'text/rdf-patch' },
      payload: { targetId: LOAD_VERSION_ID, backendId: BACKEND_ID },
    });

    // The format has rows for quads and nothing else, so a counted LOAD would
    // serialise as an empty change — worse than no answer. Still not run.
    expect(response.statusCode).toBe(422);
    expect(response.json().error).toContain('/patches/');
    expect(statuses()).toEqual(['draft', 'draft', 'live']);
  });
});
