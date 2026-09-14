/**
 * `/patches` end to end against a real in-process store.
 *
 * The derivation itself is proved in `packages/rdf-delta`, where an equivalence
 * oracle compares executing an update with applying its patch. What is left to
 * test here is everything that package deliberately knows nothing about: that
 * preview does not write, that apply does, that a store which moved underneath a
 * preview is refused rather than silently overwritten, and that a revert puts
 * back exactly what was taken.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as oxigraph from 'oxigraph';
import patchRoutes from '../../src/routes/patches.js';
import { oxigraphStoreManager } from '../../src/lib/OxigraphStoreManager.js';
import { BackendTypeIri } from '../../src/persistence/schemas/BackendSchema.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import { resetChangeSubscribers, subscribeChanges, type FeedEvent } from '../../src/lib/changeEvents.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

const BACKEND_ID = 'urn:sqlib:backend:patch-test';

/** A repository backed by a Map, which is all the service asks of one. */
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
        ? { $id: BACKEND_ID, name: 'Patch test', backendType: BackendTypeIri.oxigraphEphemeral }
        : null,
  },
}));

const SEED = `
<http://ex/a> <http://ex/status> "draft" .
<http://ex/b> <http://ex/status> "draft" .
<http://ex/c> <http://ex/status> "live" .
<http://ex/x> <http://ex/status> "old" <http://ex/g> .
<http://ex/y> <http://ex/status> "old" <http://ex/g> .
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

/** The default graph is what `statuses()` sees; `<http://ex/g>` needs asking for. */
function graphStatuses(): string[] {
  return (
    store().query(
      'SELECT ?o WHERE { GRAPH <http://ex/g> { ?s <http://ex/status> ?o } }',
    ) as Array<Map<string, { value: string }>>
  )
    .map((row) => row.get('o')!.value)
    .sort();
}

describe('/patches', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema);
      }
    }
    await app.register(patchRoutes, { prefix: '/patches' });
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

  it('previews the diff without touching the store', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/patches/preview',
      payload: { backendId: BACKEND_ID, updateString: PROMOTE },
    });

    expect(response.statusCode).toBe(200);
    const patch = response.json();
    expect(patch.status).toBe('previewed');
    expect(patch.deletionCount).toBe(2);
    expect(patch.additionCount).toBe(2);
    expect(patch.applyMode).toBe('ground-sparql');
    expect(patch.revertible).toBe(true);
    expect(patch.deletions).toContain('<http://ex/a> <http://ex/status> "draft"');

    // The whole point: a preview is a read.
    expect(statuses()).toEqual(['draft', 'draft', 'live']);
  });

  it('reports what the net effect trimmed', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/patches/preview',
      payload: {
        backendId: BACKEND_ID,
        updateString:
          'DELETE DATA { <http://ex/a> <http://ex/status> "draft" . <http://ex/z> <http://ex/status> "draft" }',
      },
    });

    const patch = response.json();
    expect(patch.deletionCount).toBe(1);
    expect(patch.rawDeleteCount).toBe(2);
  });

  it('applies a previewed patch and announces the data change', async () => {
    const events: FeedEvent[] = [];
    subscribeChanges((event) => events.push(event));

    const previewed = (
      await app.inject({
        method: 'POST',
        url: '/patches/preview',
        payload: { backendId: BACKEND_ID, updateString: PROMOTE },
      })
    ).json();

    const applied = await app.inject({
      method: 'POST',
      url: '/patches/apply',
      payload: { patchId: previewed.id },
    });

    expect(applied.statusCode).toBe(200);
    expect(applied.json().status).toBe('applied');
    expect(applied.json().dateApplied).toBeTruthy();
    expect(statuses()).toEqual(['live', 'live', 'live']);

    expect(events).toContainEqual(
      expect.objectContaining({ type: 'data-changed', backendId: BACKEND_ID, patchId: previewed.id }),
    );
  });

  it('refuses to apply a patch the store has moved out from under', async () => {
    const previewed = (
      await app.inject({
        method: 'POST',
        url: '/patches/preview',
        payload: { backendId: BACKEND_ID, updateString: PROMOTE },
      })
    ).json();

    // Somebody else promotes one of the two rows first.
    store().update('DELETE DATA { <http://ex/a> <http://ex/status> "draft" }');

    const applied = await app.inject({
      method: 'POST',
      url: '/patches/apply',
      payload: { patchId: previewed.id },
    });

    expect(applied.statusCode).toBe(409);
    expect(applied.json().current.id).toBe(previewed.id);
    // Refused, not half-applied.
    expect(statuses()).toEqual(['draft', 'live']);
  });

  it('applies the drifted change anyway when the caller accepts last-write-wins', async () => {
    const previewed = (
      await app.inject({
        method: 'POST',
        url: '/patches/preview',
        payload: { backendId: BACKEND_ID, updateString: PROMOTE },
      })
    ).json();

    store().update('DELETE DATA { <http://ex/a> <http://ex/status> "draft" }');

    const applied = await app.inject({
      method: 'POST',
      url: '/patches/apply',
      payload: { patchId: previewed.id, force: true },
    });

    expect(applied.statusCode).toBe(200);
    expect(statuses()).toEqual(['live', 'live']);
  });

  it('rejects a stale expectedHash before deriving anything', async () => {
    const previewed = (
      await app.inject({
        method: 'POST',
        url: '/patches/preview',
        payload: { backendId: BACKEND_ID, updateString: PROMOTE },
      })
    ).json();

    const applied = await app.inject({
      method: 'POST',
      url: '/patches/apply',
      payload: { patchId: previewed.id, expectedHash: 'not-the-hash' },
    });

    expect(applied.statusCode).toBe(409);
    expect(statuses()).toEqual(['draft', 'draft', 'live']);
  });

  it('derives and applies in one call', async () => {
    const applied = await app.inject({
      method: 'POST',
      url: '/patches/apply',
      payload: { backendId: BACKEND_ID, updateString: PROMOTE },
    });

    expect(applied.statusCode).toBe(200);
    expect(applied.json().status).toBe('applied');
    // The time it landed, on the record as well as in the response: this path
    // passed `dateApplied` to `persist` for as long as it has existed and
    // `persist` never wrote it, so every one-step apply read back as an applied
    // patch that never says when.
    expect(applied.json().dateApplied).toBeTruthy();
    expect(patchStore.get(applied.json().id)?.dateApplied).toBe(applied.json().dateApplied);
    expect(statuses()).toEqual(['live', 'live', 'live']);
  });

  it('records when a revert landed, on the inverse patch it writes', async () => {
    const applied = (
      await app.inject({
        method: 'POST',
        url: '/patches/apply',
        payload: { backendId: BACKEND_ID, updateString: PROMOTE },
      })
    ).json();

    const inverse = (
      await app.inject({ method: 'POST', url: `/patches/${encodeURIComponent(applied.id)}/revert` })
    ).json();

    expect(inverse.dateApplied).toBeTruthy();
    // The patch it undid keeps its own: the log holds both, in the order they
    // happened, and the fold cancels them out on that.
    expect(patchStore.get(applied.id)?.dateApplied).toBe(applied.dateApplied);
    expect(Date.parse(inverse.dateApplied)).toBeGreaterThanOrEqual(Date.parse(applied.dateApplied));
  });

  it('leaves a previewed patch with no time it landed, because it did not', async () => {
    const previewed = (
      await app.inject({
        method: 'POST',
        url: '/patches/preview',
        payload: { backendId: BACKEND_ID, updateString: PROMOTE },
      })
    ).json();

    expect(previewed.dateApplied).toBeNull();
    // Passes before the change as well as after — `previewed` never reached
    // `persist` with a time to write. Pinned because it is the other half of
    // the invariant the log reads: a patch says when it landed exactly when it
    // landed.
    expect(patchStore.get(previewed.id)?.dateApplied).toBeFalsy();
  });

  it('reverts an applied patch, restoring exactly what it changed', async () => {
    const applied = (
      await app.inject({
        method: 'POST',
        url: '/patches/apply',
        payload: { backendId: BACKEND_ID, updateString: PROMOTE },
      })
    ).json();

    const reverted = await app.inject({ method: 'POST', url: `/patches/${encodeURIComponent(applied.id)}/revert` });

    expect(reverted.statusCode).toBe(200);
    expect(reverted.json().inverseOf).toBe(applied.id);
    expect(statuses()).toEqual(['draft', 'draft', 'live']);
    // The reverted patch is marked as such rather than deleted: the log is what
    // happened, including the undo.
    expect(patchStore.get(applied.id)?.patchStatus).toBe('reverted');
  });

  it('refuses to revert a patch that was never applied', async () => {
    const previewed = (
      await app.inject({
        method: 'POST',
        url: '/patches/preview',
        payload: { backendId: BACKEND_ID, updateString: PROMOTE },
      })
    ).json();

    const reverted = await app.inject({ method: 'POST', url: `/patches/${encodeURIComponent(previewed.id)}/revert` });

    expect(reverted.statusCode).toBe(409);
  });

  it('serves a stored patch as RDF Patch when asked for one', async () => {
    const previewed = (
      await app.inject({
        method: 'POST',
        url: '/patches/preview',
        payload: { backendId: BACKEND_ID, updateString: PROMOTE },
      })
    ).json();

    const response = await app.inject({
      method: 'GET',
      url: `/patches/${encodeURIComponent(previewed.id)}`,
      headers: { accept: 'text/rdf-patch' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/rdf-patch');
    const body = response.body;
    expect(body).toContain(`H id <${previewed.id}> .`);
    expect(body).toContain('TX .');
    expect(body).toContain('D <http://ex/a> <http://ex/status> "draft" .');
    expect(body).toContain('A <http://ex/a> <http://ex/status> "live" .');
    expect(body.trimEnd().endsWith('TC .')).toBe(true);
  });

  it('previews a graph operation as a count, and says the quads are not the whole story', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/patches/preview',
      payload: { backendId: BACKEND_ID, updateString: 'DROP GRAPH <http://ex/g>' },
    });

    expect(response.statusCode).toBe(200);
    const patch = response.json();
    expect(patch.graphOps).toEqual([
      {
        form: 'drop',
        silent: false,
        destination: { kind: 'iri', value: 'http://ex/g' },
        affectedCount: 2,
        enumerated: false,
      },
    ]);
    expect(patch.applyMode).toBe('graph-ops');
    expect(patch.revertible).toBe(false);
    expect(graphStatuses()).toEqual(['old', 'old']);
  });

  it('refuses to apply a counted graph operation, naming the way out', async () => {
    const preview = await app.inject({
      method: 'POST',
      url: '/patches/preview',
      payload: { backendId: BACKEND_ID, updateString: 'DROP GRAPH <http://ex/g>' },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/patches/apply',
      payload: { patchId: preview.json().id },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toMatch(/enumerateGraphOps/);
    expect(graphStatuses()).toEqual(['old', 'old']);
  });

  it('enumerates a graph operation on request, and then applies it like any diff', async () => {
    const preview = await app.inject({
      method: 'POST',
      url: '/patches/preview',
      payload: {
        backendId: BACKEND_ID,
        updateString: 'DROP GRAPH <http://ex/g>',
        enumerateGraphOps: true,
      },
    });

    const patch = preview.json();
    expect(patch.applyMode).toBe('ground-sparql');
    expect(patch.deletionCount).toBe(2);
    expect(patch.revertible).toBe(true);
    expect(patch.graphOps[0]).toMatchObject({ form: 'drop', enumerated: true, affectedCount: 2 });

    const applied = await app.inject({
      method: 'POST',
      url: '/patches/apply',
      payload: { patchId: patch.id },
    });

    expect(applied.statusCode).toBe(200);
    expect(graphStatuses()).toEqual([]);
    expect(statuses()).toEqual(['draft', 'draft', 'live']);
  });

  it('refuses to enumerate past the cap, reporting the cost', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/patches/preview',
      payload: {
        backendId: BACKEND_ID,
        updateString: 'DROP GRAPH <http://ex/g>',
        enumerateGraphOps: true,
        enumerationCap: 1,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/over the cap of 1/);
  });

  it('previews a program whose later operation reads what an earlier one wrote', async () => {
    // Simulation territory: without a fork, the DELETE WHERE would be evaluated
    // against a store that has not yet seen the INSERT, and would miss it.
    const response = await app.inject({
      method: 'POST',
      url: '/patches/preview',
      payload: {
        backendId: BACKEND_ID,
        updateString:
          'INSERT DATA { <http://ex/d> <http://ex/status> "draft" } ; ' +
          'DELETE { ?s <http://ex/status> "draft" } INSERT { ?s <http://ex/status> "live" } ' +
          'WHERE { ?s <http://ex/status> "draft" }',
      },
    });

    expect(response.statusCode).toBe(200);
    const patch = response.json();
    expect(patch.additions).toContain('<http://ex/d> <http://ex/status> "live"');
    expect(patch.additions).not.toContain('"draft"');
    expect(patch.applyMode).toBe('ground-sparql');
  });

  it('rejects a body that names neither a patch nor an update', async () => {
    const response = await app.inject({ method: 'POST', url: '/patches/apply', payload: {} });

    expect(response.statusCode).toBe(400);
  });

  it('404s for an unknown backend', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/patches/preview',
      payload: { backendId: 'urn:sqlib:backend:nope', updateString: PROMOTE },
    });

    expect(response.statusCode).toBe(404);
  });
});
