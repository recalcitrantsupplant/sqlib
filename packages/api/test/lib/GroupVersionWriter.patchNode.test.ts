/**
 * Staging a PatchNode in the flat group-version writer (issue #290, MVP-3).
 *
 * The node's two output ports are the part the generic staging path cannot
 * check: they are minted by the same payload as every other port, so reference
 * resolution alone will happily accept a node that names one, names the same
 * one twice, or names one it never listed among its outputs. Each of those is
 * a group that saves and then fails at execution, which is the shape of bug
 * the staging phase exists to convert into a 422.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  cacheCoordinator: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    get: vi.fn(),
    resolveExisting: vi.fn(),
  },
}));

let createGroupVersionFlat: typeof import('../../src/lib/GroupVersionWriter.js').createGroupVersionFlat;

let store: Map<string, { $id: string; '@type': string; [k: string]: unknown }>;
/** Everything the writer asked the store to create, in order. */
let created: Array<{ type: string; entity: Record<string, unknown> }>;

function seed(id: string, type: string, extra: Record<string, unknown> = {}) {
  store.set(id, { $id: id, '@type': type, ...extra });
}

const GROUP_ID = 'urn:test:group:1';
const DELETIONS = 'urn:ui-temp:port-deletions';
const ADDITIONS = 'urn:ui-temp:port-additions';

describe('GroupVersionWriter: PatchNode', () => {
  beforeEach(async () => {
    vi.resetModules();
    store = new Map();
    created = [];

    for (const fn of Object.values(hoisted.cacheCoordinator)) fn.mockReset();

    vi.doMock('../../src/lib/CacheCoordinatorProvider.js', () => ({
      getCacheCoordinator: () => hoisted.cacheCoordinator,
    }));

    ({ createGroupVersionFlat } = await import('../../src/lib/GroupVersionWriter.js'));

    hoisted.cacheCoordinator.list.mockReturnValue([]);
    hoisted.cacheCoordinator.create.mockImplementation(async (type: string, entity: Record<string, unknown>) => {
      created.push({ type, entity });
      return entity;
    });
    hoisted.cacheCoordinator.update.mockImplementation(async (_t: string, id: string) => ({
      $id: id,
      '@type': 'QueryGroupVersion',
    }));
    hoisted.cacheCoordinator.get.mockImplementation((id: string) => store.get(id) ?? null);
    hoisted.cacheCoordinator.resolveExisting.mockImplementation(async (id: string) => {
      const entity = store.get(id);
      return entity ? { type: entity['@type'], entity } : null;
    });

    seed(GROUP_ID, 'QueryGroup');
    seed('urn:test:qv:update', 'QueryVersion', { isPartOf: 'urn:test:query:1' });
    seed('urn:test:backend:1', 'Backend');
  });

  function body(node: Record<string, unknown> = {}) {
    return {
      queryGroupVersion: {},
      rdfOutputs: [
        { id: DELETIONS, name: 'deletions' },
        { id: ADDITIONS, name: 'additions' },
      ],
      executionNodes: [
        {
          id: 'urn:ui-temp:node-1',
          nodeType: 'PatchNode',
          queryId: 'urn:test:qv:update',
          backendId: 'urn:test:backend:1',
          inputs: [],
          outputs: [DELETIONS, ADDITIONS],
          deletionsOutput: DELETIONS,
          additionsOutput: ADDITIONS,
          ...node,
        },
      ],
      edges: [],
    };
  }

  const stagedPatchNode = () =>
    created.find(entry => entry.type === 'PatchNode')?.entity as Record<string, unknown> | undefined;

  it('writes a PatchNode with both ports resolved to their minted IRIs', async () => {
    await createGroupVersionFlat(GROUP_ID, body());

    const node = stagedPatchNode();
    expect(node).toBeTruthy();
    const deletions = node!.deletionsOutput as string;
    const additions = node!.additionsOutput as string;

    // Minted, so no longer the temp URNs the payload used.
    expect(deletions.startsWith('urn:ui-temp:')).toBe(false);
    expect(additions.startsWith('urn:ui-temp:')).toBe(false);
    expect(deletions).not.toBe(additions);
    expect(node!.outputs).toEqual([deletions, additions]);
    expect(node!.queryId).toBe('urn:test:qv:update');
  });

  it('rejects a node that names only one of the two ports', async () => {
    await expect(createGroupVersionFlat(GROUP_ID, body({ additionsOutput: undefined })))
      .rejects.toThrow(/additionsOutput.*required for a PatchNode/s);
  });

  it('rejects a node that uses one port for both halves', async () => {
    await expect(createGroupVersionFlat(GROUP_ID, body({ additionsOutput: DELETIONS })))
      .rejects.toThrow(/separate ports/);
  });

  it('rejects a port the node does not list among its outputs', async () => {
    await expect(createGroupVersionFlat(GROUP_ID, body({ outputs: [DELETIONS] })))
      .rejects.toThrow(/is not one of the node's outputs/);
  });

  it('rejects a node whose query does not exist', async () => {
    await expect(createGroupVersionFlat(GROUP_ID, body({ queryId: 'urn:test:qv:missing' })))
      .rejects.toThrow(/urn:test:qv:missing/);
  });

  it('refuses to carry a stored PatchNode over as a QueryNode', async () => {
    // A client that has never heard of the node type reads one, sees a queryId,
    // and sends it back as a QueryNode. Saving that would turn "show me the
    // diff" into "make the change".
    seed('urn:test:node:existing', 'PatchNode', { queryId: 'urn:test:qv:update' });

    const payload = body();
    payload.executionNodes[0] = {
      ...payload.executionNodes[0],
      id: 'urn:test:node:existing',
      nodeType: 'QueryNode',
      deletionsOutput: undefined,
      additionsOutput: undefined,
    };

    await expect(createGroupVersionFlat(GROUP_ID, payload))
      .rejects.toThrow(/would run the update it only derives/);
  });

  it('lets a stored PatchNode be saved again as itself', async () => {
    seed('urn:test:node:existing', 'PatchNode', { queryId: 'urn:test:qv:update' });

    const payload = body();
    payload.executionNodes[0] = { ...payload.executionNodes[0], id: 'urn:test:node:existing' };

    await expect(createGroupVersionFlat(GROUP_ID, payload)).resolves.toBeTruthy();
  });

  it('accepts an ephemeral store in place of a backend', async () => {
    await createGroupVersionFlat(GROUP_ID, body({
      backendId: undefined,
      backendConfig: { type: 'ephemeral-oxigraph', storeId: 'store-1' },
    }));

    const node = stagedPatchNode();
    expect(node!.backendConfig).toEqual({ type: 'ephemeral-oxigraph', storeId: 'store-1' });
    expect(node!.backendId).toBeFalsy();
  });
});
