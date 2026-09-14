/**
 * `PATCH /queries/:id/v/:version` — what a version PATCH is *for*.
 *
 * A version is a snapshot (issue #192): the content is what a reference to the
 * version means, so nothing edits it in place. What survives is the annotation
 * — the comment about the snapshot — and the freeze transition for versions
 * stored before creation started freezing them.
 *
 * This file used to assert the opposite (that `queryString` could be patched
 * and its metadata re-derived), which is why the deleted cases are worth
 * naming rather than quietly dropping.
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import Fastify, { FastifyInstance } from 'fastify';
import queryRoutes from '../../src/routes/queries.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

const hoisted = vi.hoisted(() => ({
  queryVersion: {
    list: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
  coordinator: {
    get: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({
    QueryVersion: hoisted.queryVersion,
  }),
  getCacheCoordinator: () => hoisted.coordinator,
}));

vi.mock('../../src/lib/QueryVersionResolver.js', () => ({
  expandQueryVersion: vi.fn().mockResolvedValue({
    queryVersion: { id: 'urn:qv:1', isPartOf: 'urn:q:1', version: 1, queryString: 'SELECT * WHERE { ?s ?p ?o }', comment: 'Updated comment' },
    limitParameters: [],
    offsetParameters: [],
    inputs: [],
    inputTuples: [],
    outputs: [],
    outputTuples: [],
    tupleMembers: [],
  }),
}));

const QUERY_ID = 'urn:sqlib:query:test';

function existingVersion(overrides: Record<string, unknown> = {}) {
  return {
    $id: 'urn:qv:1',
    isPartOf: QUERY_ID,
    version: 1,
    queryString: 'SELECT * WHERE { ?s ?p ?o }',
    comment: 'Old comment',
    queryType: QueryTypeIri.select,
    immutable: true,
    dateModified: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Query Version PATCH Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema);
      }
    }
    await app.register(queryRoutes, { prefix: '/queries' });
    await app.ready();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    for (const mock of [
      hoisted.queryVersion.list,
      hoisted.queryVersion.get,
      hoisted.queryVersion.update,
      hoisted.queryVersion.create,
      hoisted.queryVersion.delete,
      hoisted.coordinator.get,
      hoisted.coordinator.update,
      hoisted.coordinator.create,
      hoisted.coordinator.delete,
    ]) mock.mockReset();
  });
  afterAll(async () => { await app.close(); });

  function patch(payload: unknown, version = '1') {
    return app.inject({
      method: 'PATCH',
      url: `/queries/${encodeURIComponent(QUERY_ID)}/v/${version}`,
      payload: payload as Record<string, unknown>,
    });
  }

  it('annotates a frozen version: the comment is metadata about the snapshot, not part of it', async () => {
    hoisted.queryVersion.list.mockReturnValue([existingVersion()]);
    hoisted.queryVersion.update.mockResolvedValue({
      ...existingVersion(),
      comment: 'Updated comment',
      dateModified: '2024-01-02T00:00:00.000Z',
    });

    const res = await patch({ comment: 'Updated comment' });

    expect(res.statusCode, res.payload).toBe(200);
    expect(hoisted.queryVersion.update).toHaveBeenCalledWith('urn:qv:1', { comment: 'Updated comment' });
    expect(res.headers.etag).toBe('"2024-01-02T00:00:00.000Z"');
    expect(res.headers['last-modified']).toBe(new Date('2024-01-02T00:00:00.000Z').toUTCString());
  });

  it('refuses to change the query itself, naming the fields it refused', async () => {
    hoisted.queryVersion.list.mockReturnValue([existingVersion()]);

    const res = await patch({ queryString: 'SELECT * WHERE { ?s ?p ?o . ?x ?y ?z }' });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: 'Version is immutable; create a new version instead.',
      fields: ['queryString'],
    });
    expect(hoisted.queryVersion.update).not.toHaveBeenCalled();
  });

  it('refuses a content field even when a legal annotation rides along', async () => {
    // The whole body is rejected rather than partly applied: a caller that
    // asked for two things and got one has no way to tell which.
    hoisted.queryVersion.list.mockReturnValue([existingVersion()]);

    const res = await patch({ comment: 'fine', queryType: QueryTypeIri.construct });

    expect(res.statusCode).toBe(409);
    expect(res.json().fields).toEqual(['queryType']);
    expect(hoisted.queryVersion.update).not.toHaveBeenCalled();
  });

  it('refuses to unfreeze a version', async () => {
    // The one direction that would undo the guarantee every reference relies on.
    hoisted.queryVersion.list.mockReturnValue([existingVersion()]);

    const res = await patch({ immutable: false });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('A version cannot be unfrozen; create a new version instead.');
    expect(hoisted.queryVersion.update).not.toHaveBeenCalled();
  });

  it('freezes a version stored before freeze-on-create', async () => {
    // The migration path: old records are absent/false and this is how they
    // catch up, which is also what the benchmark freeze precondition needs.
    const legacy = existingVersion({ immutable: false });
    hoisted.queryVersion.list.mockReturnValue([legacy]);
    hoisted.queryVersion.update.mockResolvedValue({ ...legacy, immutable: true });

    const res = await patch({ immutable: true });

    expect(res.statusCode, res.payload).toBe(200);
    expect(hoisted.queryVersion.update).toHaveBeenCalledWith('urn:qv:1', { immutable: true });
  });

  it('rejects system fields at the wire schema', async () => {
    hoisted.queryVersion.list.mockReturnValue([existingVersion()]);

    const res = await patch({ version: 2 });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Bad Request');
  });

  it('returns 404 for a version that does not exist', async () => {
    hoisted.queryVersion.list.mockReturnValue([]);

    const res = await patch({ comment: 'Updated comment' }, '999');

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Query version not found');
  });

  it('requires at least one field', async () => {
    hoisted.queryVersion.list.mockReturnValue([existingVersion()]);

    const res = await patch({});

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Bad Request');
  });
});
