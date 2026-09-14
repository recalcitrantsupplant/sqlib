/**
 * `PATCH /query-groups/:id/v/:version` — what a group version PATCH is *for*.
 *
 * The group's in-place overwrite went in #191 and the API half in #192: a
 * version is what the graph looked like when it was saved. `canvasData` is
 * refused along with the graph itself, deliberately — it rides in the version
 * payload, so allowing it would mean dragging a node while viewing an old
 * version silently rewrites that version. Layout that is genuinely per-user
 * belongs off the version, not on an allowlist.
 *
 * This file used to assert the opposite, which is why the retired cases
 * (executionNodes, edges, startNode/endNode normalisation, canvasData) are
 * stated here as refusals rather than quietly dropped.
 */
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import queryGroupRoutes from '../../src/routes/query-groups.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

const hoisted = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockGet: vi.fn(),
  mockUpdate: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    list: hoisted.mockList,
    get: hoisted.mockGet,
    update: hoisted.mockUpdate,
  }),
}));

vi.mock('../../src/lib/GraphResolver.js', () => ({
  expandGroupVersion: vi.fn().mockResolvedValue({
    queryGroupVersion: { id: 'urn:qgv:1', version: 1, isPartOf: 'urn:qg:1' },
    executionNodes: [],
    startNode: null,
    endNode: null,
    edges: [],
  }),
  expandGroupVersionDetailed: vi.fn().mockResolvedValue({
    queryGroupVersion: {
      id: 'urn:qgv:1',
      version: 1,
      isPartOf: 'urn:qg:1',
      canvasData: JSON.stringify({ zoom: 1.2 })
    },
    executionNodes: [],
    startNode: null,
    endNode: null,
    edges: [],
    queryNodes: [],
    dynamicQueryNodes: [],
    startNodes: [],
    endNodes: [],
    rdfOutputs: [],
    inputs: [],
    inputTuples: [],
    outputs: [],
    outputTuples: [],
    tupleMembers: [],
  }),
}));

describe('Query Group Version PATCH Routes', () => {
  let app: FastifyInstance;
  const groupId = 'urn:sqlib:querygroup:test';

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) {
        app.addSchema(schema);
      }
    }
    await app.register(queryGroupRoutes, { prefix: '/query-groups' });
    await app.ready();
  });

  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => { if (app) await app.close(); });

  function existingVersion(overrides: Record<string, unknown> = {}) {
    return {
      $id: 'urn:qgv:1',
      isPartOf: groupId,
      version: 1,
      immutable: true,
      canvasData: JSON.stringify({ zoom: 1.0, panX: 0, panY: 0 }),
      dateModified: '2024-02-01T00:00:00.000Z',
      ...overrides,
    };
  }

  function patch(payload: unknown, version = '1') {
    return app.inject({
      method: 'PATCH',
      url: `/query-groups/${encodeURIComponent(groupId)}/v/${version}`,
      payload: payload as Record<string, unknown>,
    });
  }

  it('annotates a frozen version', async () => {
    hoisted.mockList.mockReturnValue([existingVersion()]);
    hoisted.mockUpdate.mockResolvedValue({
      ...existingVersion(),
      comment: 'the one that fixed the timeout',
      dateModified: '2024-02-02T00:00:00.000Z',
    });

    const res = await patch({ queryGroupVersion: { comment: 'the one that fixed the timeout' } });

    expect(res.statusCode, res.payload).toBe(200);
    expect(hoisted.mockUpdate).toHaveBeenCalledWith('QueryGroupVersion', 'urn:qgv:1', {
      comment: 'the one that fixed the timeout',
    });
    expect(res.headers.etag).toBe('"2024-02-02T00:00:00.000Z"');
  });

  it('accepts the comment unwrapped as well as wrapped', async () => {
    hoisted.mockList.mockReturnValue([existingVersion()]);
    hoisted.mockUpdate.mockResolvedValue({ ...existingVersion(), comment: 'flat' });

    const res = await patch({ comment: 'flat' });

    expect(res.statusCode, res.payload).toBe(200);
    expect(hoisted.mockUpdate).toHaveBeenCalledWith('QueryGroupVersion', 'urn:qgv:1', { comment: 'flat' });
  });

  it('refuses to rewrite the graph', async () => {
    hoisted.mockList.mockReturnValue([existingVersion()]);

    const res = await patch({
      queryGroupVersion: {
        executionNodes: ['urn:sqlib:node:1'],
        edges: ['urn:sqlib:edge:1'],
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({
      error: 'Version is immutable; create a new version instead.',
      fields: ['edges', 'executionNodes'],
    });
    expect(hoisted.mockUpdate).not.toHaveBeenCalled();
  });

  it('refuses canvasData: layout rides in the version payload, so it is content', async () => {
    hoisted.mockList.mockReturnValue([existingVersion()]);

    const res = await patch({ queryGroupVersion: { canvasData: JSON.stringify({ zoom: 1.2 }) } });

    expect(res.statusCode).toBe(409);
    expect(res.json().fields).toEqual(['canvasData']);
    expect(hoisted.mockUpdate).not.toHaveBeenCalled();
  });

  it('refuses to move the start and end of the graph', async () => {
    hoisted.mockList.mockReturnValue([existingVersion()]);

    const res = await patch({
      queryGroupVersion: {
        startNode: { id: 'urn:sqlib:node:start' },
        endNode: 'urn:sqlib:node:end',
      },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().fields).toEqual(['endNode', 'startNode']);
  });

  it('refuses to unfreeze a version', async () => {
    hoisted.mockList.mockReturnValue([existingVersion()]);

    const res = await patch({ queryGroupVersion: { immutable: false } });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('A version cannot be unfrozen; create a new version instead.');
    expect(hoisted.mockUpdate).not.toHaveBeenCalled();
  });

  it('freezes a version stored before freeze-on-create', async () => {
    const legacy = existingVersion({ immutable: false });
    hoisted.mockList.mockReturnValue([legacy]);
    hoisted.mockUpdate.mockResolvedValue({ ...legacy, immutable: true });

    const res = await patch({ queryGroupVersion: { immutable: true } });

    expect(res.statusCode, res.payload).toBe(200);
    expect(hoisted.mockUpdate).toHaveBeenCalledWith('QueryGroupVersion', 'urn:qgv:1', { immutable: true });
  });

  it('refuses an unrecognised field rather than dropping it silently', async () => {
    // The normalizer this route used to run filtered unknown keys out, so a
    // caller patching a field that does not exist got a 200 and no change.
    hoisted.mockList.mockReturnValue([existingVersion()]);

    const res = await patch({ queryGroupVersion: { notAField: 'value' } });

    expect(res.statusCode).toBe(409);
    expect(res.json().fields).toEqual(['notAField']);
  });

  it('rejects system fields at the wire schema', async () => {
    hoisted.mockList.mockReturnValue([existingVersion()]);

    const res = await patch({ queryGroupVersion: { version: 2 } });

    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for a version that does not exist', async () => {
    hoisted.mockList.mockReturnValue([]);

    const res = await patch({ comment: 'nowhere' }, '999');

    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Query group version not found');
  });

  it('an empty body changes nothing and says so with the version as it stands', async () => {
    hoisted.mockList.mockReturnValue([existingVersion()]);

    const res = await patch({ queryGroupVersion: {} });

    expect(res.statusCode, res.payload).toBe(200);
    expect(hoisted.mockUpdate).not.toHaveBeenCalled();
  });
});
