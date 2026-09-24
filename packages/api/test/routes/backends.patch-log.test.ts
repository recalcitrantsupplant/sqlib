/**
 * `GET /backends/:id/patches` — the write log for one backend.
 *
 * The filters exist because the questions asked of a log are narrow ("what
 * happened to this graph", "what did the reverts touch"), and the ordering
 * exists because both of the questions worth asking live at the head.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import backendRoutes from '../../src/routes/backends.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const BACKEND_ID = 'urn:sqlib:backend:logged';
const OTHER_BACKEND_ID = 'urn:sqlib:backend:elsewhere';

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
    contentHash: 'hash',
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
  patch({ $id: 'urn:sqlib:patch:1', dateCreated: '2026-08-01T00:00:00.000Z', graphScope: ['http://ex/g1'] }),
  patch({ $id: 'urn:sqlib:patch:2', dateCreated: '2026-08-02T00:00:00.000Z', sourceKind: 'revert' }),
  patch({ $id: 'urn:sqlib:patch:3', dateCreated: '2026-08-03T00:00:00.000Z', patchStatus: 'previewed' }),
  patch({ $id: 'urn:sqlib:patch:4', dateCreated: '2026-08-04T00:00:00.000Z', isPartOf: OTHER_BACKEND_ID }),
];

describe('GET /backends/:id/patches', () => {
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

  async function log(query = ''): Promise<Array<Record<string, unknown>>> {
    const response = await app.inject({
      method: 'GET',
      url: `/backends/${encodeURIComponent(BACKEND_ID)}/patches${query}`,
    });
    expect(response.statusCode).toBe(200);
    return response.json();
  }

  it('lists this backend’s patches, newest first', async () => {
    expect((await log()).map((entry) => entry.id)).toEqual([
      'urn:sqlib:patch:3',
      'urn:sqlib:patch:2',
      'urn:sqlib:patch:1',
    ]);
  });

  it('filters by status, source, graph and time', async () => {
    expect((await log('?status=previewed')).map((entry) => entry.id)).toEqual(['urn:sqlib:patch:3']);
    expect((await log('?source=revert')).map((entry) => entry.id)).toEqual(['urn:sqlib:patch:2']);
    expect((await log('?graph=http%3A%2F%2Fex%2Fg1')).map((entry) => entry.id)).toEqual(['urn:sqlib:patch:1']);
    expect((await log('?since=2026-08-03T00:00:00.000Z')).map((entry) => entry.id)).toEqual([
      'urn:sqlib:patch:3',
    ]);
  });

  it('honours a limit', async () => {
    expect(await log('?limit=1')).toHaveLength(1);
  });
});
