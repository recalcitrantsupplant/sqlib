/**
 * `POST|GET /sparql?record=patch` — the proxy's opt-in write log.
 *
 * The derivation is proved in `packages/rdf-delta` and the storage in
 * `test/routes/patches.test.ts`. What is left here is the part that is specific
 * to the proxy: that the update still runs as a passthrough (same executor,
 * same string, store actually changed), that the diff recorded beside it is the
 * *pre*-update one, and that asking to record a request that cannot be recorded
 * is refused before the write rather than after it.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as oxigraph from 'oxigraph';
import { oxigraphStoreManager } from '../../src/lib/OxigraphStoreManager.js';
import { BackendTypeIri } from '../../src/persistence/schemas/BackendSchema.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import { resetChangeSubscribers, subscribeChanges, type FeedEvent } from '../../src/lib/changeEvents.js';

const BACKEND_ID = 'urn:sqlib:backend:proxy-record';

const { patchStore, patchRepo } = vi.hoisted(() => {
  const store = new Map<string, Record<string, unknown>>();
  return {
    patchStore: store,
    patchRepo: {
      get: (id: string) => store.get(id) ?? null,
      list: () => [...store.values()],
      create: async (entity: Record<string, unknown>) => {
        const record = { ...entity, '@type': 'Patch', dateCreated: new Date().toISOString() };
        store.set(entity.$id as string, record);
        return record;
      },
      update: async (id: string, updates: Record<string, unknown>) => {
        const current = store.get(id);
        if (!current) return null;
        const next = { ...current, ...updates };
        store.set(id, next);
        return next;
      },
      delete: async (id: string) => {
        store.delete(id);
      },
    },
  };
});

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({ Patch: patchRepo }),
  getCacheCoordinator: () => ({ get: () => null }),
}));

vi.mock('../../src/persistence/utils/BackendUtils.js', () => ({
  Backends: {
    findByIri: async (iri: string) =>
      iri === BACKEND_ID
        ? { $id: BACKEND_ID, name: 'Proxy record test', backendType: BackendTypeIri.oxigraphEphemeral }
        : null,
  },
}));

const SEED = `
<http://ex/a> <http://ex/status> "draft" .
<http://ex/b> <http://ex/status> "draft" .
<http://ex/c> <http://ex/status> "live" .
`;

const PROMOTE =
  'DELETE { ?s <http://ex/status> "draft" } INSERT { ?s <http://ex/status> "live" } WHERE { ?s <http://ex/status> "draft" }';

function store(): oxigraph.Store {
  return oxigraphStoreManager.getEphemeralStore(BACKEND_ID)!;
}

function statuses(): string[] {
  return (store().query('SELECT ?o WHERE { ?s <http://ex/status> ?o }') as Array<Map<string, { value: string }>>)
    .map((row) => row.get('o')!.value)
    .sort();
}

describe('/sparql?record=patch', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);
    const sparqlRoutes = (await import('../../src/routes/sparql.js')).default;
    await app.register(sparqlRoutes, { prefix: '' });
    await app.ready();
  });

  beforeEach(() => {
    patchStore.clear();
    resetChangeSubscribers();
    const fresh = oxigraphStoreManager.createEphemeralStore(BACKEND_ID);
    fresh.update('DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }');
    fresh.load(SEED, { format: 'application/n-quads' });
  });

  afterAll(async () => {
    await app.close();
  });

  it('runs the update and records what it changed', async () => {
    const events: FeedEvent[] = [];
    subscribeChanges((event) => events.push(event));

    const response = await app.inject({
      method: 'POST',
      url: '/sparql?record=patch',
      headers: { 'x-sqlib-client-id': 'proxy-client' },
      payload: { query: PROMOTE, backendId: BACKEND_ID },
    });

    expect(response.statusCode).toBe(200);
    const patch = response.json();
    expect(patch.status).toBe('applied');
    // Nobody applied this patch: the backend ran the caller's own update, which
    // is what the source kind records. `applyMode` keeps saying what the quads
    // are good for, because that is what a later revert or apply reads.
    expect(patch.sourceKind).toBe('proxyUpdate');
    expect(patch.applyMode).toBe('ground-sparql');
    expect(patch.deletionCount).toBe(2);
    expect(patch.additionCount).toBe(2);
    expect(patch.deletions).toContain('<http://ex/a> <http://ex/status> "draft"');
    expect(patch.updateString).toBe(PROMOTE);
    expect(response.headers['x-sqlib-patch-id']).toBe(patch.id);

    // The update itself is untouched by recording it.
    expect(statuses()).toEqual(['live', 'live', 'live']);

    expect(events).toEqual([
      expect.objectContaining({ type: 'data-changed', backendId: BACKEND_ID, patchId: patch.id, origin: 'proxy-client' }),
    ]);
  });

  it('records when the backend ran it, not only that it did', async () => {
    const patch = (
      await app.inject({
        method: 'POST',
        url: '/sparql?record=patch',
        payload: { query: PROMOTE, backendId: BACKEND_ID },
      })
    ).json();

    // The recording is an audit trail, and a write with no time is half of one.
    // This path passed `dateApplied` through and `persist` dropped it.
    expect(patch.dateApplied).toBeTruthy();
    expect(patchStore.get(patch.id)?.dateApplied).toBe(patch.dateApplied);
  });

  it('records a GET update too', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/sparql?record=patch&backendId=${encodeURIComponent(BACKEND_ID)}&query=${encodeURIComponent(PROMOTE)}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().additionCount).toBe(2);
    expect(statuses()).toEqual(['live', 'live', 'live']);
  });

  it('leaves an unrecorded update answering 204, as it always did', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sparql',
      payload: { query: PROMOTE, backendId: BACKEND_ID },
    });

    expect(response.statusCode).toBe(204);
    expect(patchStore.size).toBe(0);
    expect(statuses()).toEqual(['live', 'live', 'live']);
  });

  it('keeps the failed attempt in the log and still fails the request', async () => {
    const broken = oxigraphStoreManager.getEphemeralStore(BACKEND_ID)!;
    const update = vi.spyOn(broken, 'update').mockImplementation(() => {
      throw new Error('backend refused the write');
    });

    const response = await app.inject({
      method: 'POST',
      url: '/sparql?record=patch',
      payload: { query: PROMOTE, backendId: BACKEND_ID },
    });

    expect(response.statusCode).toBe(500);
    const recorded = [...patchStore.values()];
    expect(recorded).toHaveLength(1);
    expect(recorded[0].patchStatus).toBe('failed');
    // Nothing landed, so nothing says it did: the log reads `dateApplied` to
    // place a patch in history, and an attempt is not history.
    expect(recorded[0].dateApplied).toBeFalsy();
    update.mockRestore();
  });

  it('refuses to record a read', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sparql?record=patch',
      payload: { query: 'SELECT * WHERE { ?s ?p ?o }', backendId: BACKEND_ID },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('updates only');
    expect(patchStore.size).toBe(0);
  });

  it('refuses to record against an ad-hoc endpoint, before running anything', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sparql?record=patch',
      payload: { query: PROMOTE, endpoint: 'https://example.org/sparql' },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('registered backendId');
  });

  it('rejects a record value it does not know', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sparql?record=everything',
      payload: { query: PROMOTE, backendId: BACKEND_ID },
    });

    expect(response.statusCode).toBe(400);
    // Untouched: the gate answered before the handler.
    expect(statuses()).toEqual(['draft', 'draft', 'live']);
  });

  it('records a graph-management operation as the graph op it is', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/sparql?record=patch',
      payload: { query: 'CLEAR DEFAULT', backendId: BACKEND_ID },
    });

    expect(response.statusCode).toBe(200);
    const patch = response.json();
    // The quads are not the whole update, and the record says so rather than
    // pretending three deletions describe a CLEAR.
    expect(patch.applyMode).toBe('graph-ops');
    expect(patch.graphOps).toEqual([
      expect.objectContaining({ form: 'clear', affectedCount: 3, enumerated: false }),
    ]);
    expect(patch.sourceKind).toBe('proxyUpdate');
    expect(statuses()).toEqual([]);
  });
});
