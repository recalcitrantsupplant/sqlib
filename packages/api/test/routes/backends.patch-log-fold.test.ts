/**
 * `GET /backends/:id/patch-log` — the same patches, folded rather than listed.
 *
 * The sibling suite `backends.patch-log.test.ts` covers `GET /:id/patches`,
 * which answers "what happened". This one covers the fold, which answers "what
 * did it add up to" — and the interesting assertions are not the happy path but
 * the three things the fold is honest about: an order it had to invent, blank
 * nodes it cannot see through, and a patch it was asked to travel to that is
 * not in the log at all.
 *
 * It runs against a real DuckDB, because the reconstruction rule is the SQL and
 * a mocked engine would only be asserting that the string was passed on.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import backendRoutes from '../../src/routes/backends.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const BACKEND_ID = 'urn:sqlib:backend:folded';
const OTHER_BACKEND_ID = 'urn:sqlib:backend:elsewhere';
const A = '<http://example.org/a>';
const B = '<http://example.org/b>';
const P = '<http://example.org/p>';
const G = '<http://example.org/g>';

function patch(fields: Record<string, unknown>): Record<string, unknown> {
  return {
    '@type': 'Patch',
    isPartOf: BACKEND_ID,
    additions: '',
    deletions: '',
    additionCount: 0,
    deletionCount: 0,
    graphScope: [],
    patchStatus: 'applied',
    applyMode: 'ground-sparql',
    revertible: true,
    contentHash: `hash-${String(fields.$id)}`,
    sourceKind: 'updateString',
    ...fields,
  };
}

const rows = vi.hoisted(() => ({ patches: [] as Record<string, unknown>[] }));

overrideCacheCoordinatorProvider({
  getEntityRepositories: () => ({
    Backend: { list: () => [], get: () => null },
    Library: { list: () => [] },
    Query: { list: () => [] },
    Patch: { list: () => rows.patches, get: () => null },
  }),
  getCacheCoordinator: () => ({ get: () => null }),
});

rows.patches = [
  patch({
    $id: 'urn:sqlib:patch:1',
    dateApplied: '2026-08-01T00:00:00.000Z',
    additions: `${A} ${P} "one" .\n${B} ${P} "two" ${G} .\n`,
    additionCount: 2,
  }),
  patch({
    $id: 'urn:sqlib:patch:2',
    dateApplied: '2026-08-02T00:00:00.000Z',
    deletions: `${A} ${P} "one" .\n`,
    additions: `${A} ${P} "revised" .\n`,
    additionCount: 1,
    deletionCount: 1,
  }),
  patch({
    $id: 'urn:sqlib:patch:3',
    dateApplied: '2026-08-03T00:00:00.000Z',
    deletions: `${B} ${P} "two" ${G} .\n`,
    deletionCount: 1,
    patchStatus: 'reverted',
  }),
  // Never happened, so never in the log.
  patch({ $id: 'urn:sqlib:patch:previewed', dateCreated: '2026-08-04T00:00:00.000Z', patchStatus: 'previewed' }),
  patch({ $id: 'urn:sqlib:patch:failed', dateCreated: '2026-08-05T00:00:00.000Z', patchStatus: 'failed' }),
  // Someone else's history.
  patch({ $id: 'urn:sqlib:patch:other', dateApplied: '2026-08-06T00:00:00.000Z', isPartOf: OTHER_BACKEND_ID }),
];

describe('GET /backends/:id/patch-log', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema);
      }
    }
    await app.register(backendRoutes, { prefix: '/backends' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  async function fold(query = '', backend = BACKEND_ID): Promise<Record<string, any>> {
    const response = await app.inject({
      method: 'GET',
      url: `/backends/${encodeURIComponent(backend)}/patch-log${query}`,
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  it('folds only this backend’s applied and reverted patches', async () => {
    const body = await fold('?state=false');
    expect(body.order).toEqual([
      'urn:sqlib:patch:1',
      'urn:sqlib:patch:2',
      'urn:sqlib:patch:3',
    ]);
    expect(body.patchCount).toBe(3);
    // Two adds, then a delete and an add, then a delete.
    expect(body.rowCount).toBe(5);
  });

  it('reconstructs the state at the head of the log', async () => {
    const body = await fold('?nquads=true');
    expect(body.state.quadCount).toBe(1);
    expect(body.state.nquads).toBe(`${A} ${P} "revised" .`);
    expect(body.state.asOf).toBeNull();
  });

  it('travels to a patch by its IRI', async () => {
    const body = await fold(`?asOf=${encodeURIComponent('urn:sqlib:patch:1')}&nquads=true`);
    expect(body.state.asOf).toBe('urn:sqlib:patch:1');
    expect(body.state.quadCount).toBe(2);
    expect(String(body.state.nquads).split('\n').sort()).toEqual([
      `${A} ${P} "one" .`,
      `${B} ${P} "two" ${G} .`,
    ]);
  });

  it('refuses a patch that is not in the log, rather than folding the head', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/backends/${encodeURIComponent(BACKEND_ID)}/patch-log?asOf=${encodeURIComponent('urn:sqlib:patch:previewed')}`,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/not in this backend's log/);
  });

  it('reports churn per patch when asked', async () => {
    const body = await fold('?state=false&churn=true');
    expect(body.churn).toEqual([
      { patch: 1, additions: 2, deletions: 0, quadsTouched: 2, rewrites: 0 },
      { patch: 2, additions: 1, deletions: 1, quadsTouched: 2, rewrites: 0 },
      { patch: 3, additions: 0, deletions: 1, quadsTouched: 1, rewrites: 0 },
    ]);
  });

  it('ranks the quads the log writes most often when asked', async () => {
    const body = await fold('?state=false&hotQuads=2');
    expect(body.hotQuads).toHaveLength(2);
    expect(body.hotQuads[0].writes).toBe(2);
  });

  it('omits the state entirely when it is not asked for', async () => {
    const body = await fold('?state=false');
    expect(body.state).toBeUndefined();
  });

  it('answers for a backend with no patches at all', async () => {
    const body = await fold('?nquads=true', OTHER_BACKEND_ID + ':empty');
    expect(body.patchCount).toBe(0);
    expect(body.state.quadCount).toBe(0);
    expect(body.state.nquads).toBe('');
    expect(body.caveats).toEqual([]);
  });
});

describe('GET /backends/:id/patch-log — what the fold cannot know', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    rows.patches = [
      patch({
        $id: 'urn:sqlib:patch:tie-a',
        dateApplied: '2026-08-01T00:00:00.000Z',
        contentHash: 'aaa',
        additions: `${A} ${P} "x" .\n`,
      }),
      patch({
        $id: 'urn:sqlib:patch:tie-b',
        dateApplied: '2026-08-01T00:00:00.000Z',
        contentHash: 'zzz',
        deletions: `${A} ${P} "x" .\n`,
      }),
      patch({
        $id: 'urn:sqlib:patch:bnode',
        dateApplied: '2026-08-02T00:00:00.000Z',
        additions: `_:c14n0 ${P} "y" .\n`,
        netEffectExact: false,
      }),
    ];

    app = Fastify({ logger: false });
    setupValidator(app);
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema);
      }
    }
    await app.register(backendRoutes, { prefix: '/backends' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('states every caveat beside the answer rather than refusing to answer', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/backends/${encodeURIComponent(BACKEND_ID)}/patch-log?nquads=true`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    const kinds = body.caveats.map((caveat: { kind: string }) => caveat.kind).sort();
    expect(kinds).toEqual(['blank-nodes', 'inexact-net-effect', 'tied-timestamp']);

    // The answer is still an answer: the tie ordered `aaa` before `zzz`, so the
    // add is folded away by the delete, and the blank-node quad survives.
    expect(body.state.quadCount).toBe(1);
    expect(body.state.nquads).toBe(`_:p3.c14n0 ${P} "y" .`);
  });
});

describe('GET /backends/:id/patch-log — a revert inside one millisecond', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    /*
     * `revertPatch` applies the inverse of a patch that had already landed, so
     * the two are causally ordered however close their clocks are. The key alone
     * cannot see that: both carry the same `dateApplied`, and the revert's
     * `contentHash` sorts first — so the fold ran the delete before the add and
     * answered with the quad the revert exists to remove.
     */
    rows.patches = [
      patch({
        $id: 'urn:sqlib:patch:reverted',
        dateApplied: '2026-08-01T00:00:00.000Z',
        contentHash: 'zzz',
        additions: `${A} ${P} "x" .\n`,
        additionCount: 1,
        patchStatus: 'reverted',
      }),
      patch({
        $id: 'urn:sqlib:patch:undo',
        dateApplied: '2026-08-01T00:00:00.000Z',
        contentHash: 'aaa',
        deletions: `${A} ${P} "x" .\n`,
        deletionCount: 1,
        sourceKind: 'revert',
        inverseOf: 'urn:sqlib:patch:reverted',
      }),
    ];

    app = Fastify({ logger: false });
    setupValidator(app);
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema);
      }
    }
    await app.register(backendRoutes, { prefix: '/backends' });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('folds the inverse last, and calls nothing about it arbitrary', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/backends/${encodeURIComponent(BACKEND_ID)}/patch-log?nquads=true`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.order).toEqual(['urn:sqlib:patch:reverted', 'urn:sqlib:patch:undo']);
    // A reverted patch left nothing behind, which is the whole meaning of the
    // word and what the other order denies.
    expect(body.state.quadCount).toBe(0);
    expect(body.state.nquads).toBe('');
    // `inverseOf` is a recorded fact, so the tie it broke is not a caveat.
    expect(body.caveats).toEqual([]);
  });
});
