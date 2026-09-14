/**
 * Reference resolution in the flat group-version writer.
 *
 * See `docs/guides/query-groups.md`. Every inbound IRI is either minted by this
 * payload or has to already exist; before the staging split the writer could
 * not tell the two apart and wrote both.
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

/** Entities the store is pretending to hold, keyed by IRI. */
let store: Map<string, { $id: string; '@type': string; [k: string]: unknown }>;

function seed(id: string, type: string, extra: Record<string, unknown> = {}) {
  store.set(id, { $id: id, '@type': type, ...extra });
}

const GROUP_ID = 'urn:test:group:1';

describe('GroupVersionWriter reference resolution', () => {
  beforeEach(async () => {
    vi.resetModules();
    store = new Map();

    for (const fn of Object.values(hoisted.cacheCoordinator)) fn.mockReset();

    vi.doMock('../../src/lib/CacheCoordinatorProvider.js', () => ({
      getCacheCoordinator: () => hoisted.cacheCoordinator,
    }));

    ({ createGroupVersionFlat } = await import('../../src/lib/GroupVersionWriter.js'));

    hoisted.cacheCoordinator.list.mockReturnValue([]);
    hoisted.cacheCoordinator.create.mockImplementation(async (_t: string, e: { $id: string }) => e);
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
  });

  /** A payload whose every external reference resolves, as a baseline. */
  function validBody() {
    seed('urn:test:qv:1', 'QueryVersion', { isPartOf: 'urn:test:query:1' });
    seed('urn:test:backend:1', 'Backend');
    return {
      queryGroupVersion: {},
      executionNodes: [
        {
          id: 'urn:ui-temp:node-1',
          nodeType: 'QueryNode',
          queryId: 'urn:test:qv:1',
          backendId: 'urn:test:backend:1',
          inputs: [],
          outputs: [],
        },
      ],
      edges: [
        {
          id: 'urn:ui-temp:edge-1',
          sourceNodeId: 'urn:__START__',
          targetNodeId: 'urn:ui-temp:node-1',
          dataFlowType: 'CONTROL_FLOW',
        },
      ],
    };
  }

  it('accepts a payload whose references all resolve', async () => {
    const result = await createGroupVersionFlat(GROUP_ID, validBody());
    expect(result.created).toBeTruthy();
  });

  it('rejects a RuleSetNode pointing at a rule-set version that does not exist', async () => {
    const body = {
      queryGroupVersion: {},
      executionNodes: [
        {
          id: 'urn:ui-temp:node-1',
          nodeType: 'RuleSetNode',
          ruleSetVersion: 'urn:test:ruleset-version:does-not-exist',
          inputs: [],
          outputs: [],
        },
      ],
      edges: [],
    };

    await expect(createGroupVersionFlat(GROUP_ID, body)).rejects.toThrow(
      /urn:test:ruleset-version:does-not-exist/
    );
  });

  it('rejects a RuleSetNode pointing at an entity of the wrong type', async () => {
    seed('urn:test:backend:1', 'Backend');
    const body = {
      queryGroupVersion: {},
      executionNodes: [
        {
          id: 'urn:ui-temp:node-1',
          nodeType: 'RuleSetNode',
          // Exists, but is a Backend, not a RuleSetVersion.
          ruleSetVersion: 'urn:test:backend:1',
          inputs: [],
          outputs: [],
        },
      ],
      edges: [],
    };

    await expect(createGroupVersionFlat(GROUP_ID, body)).rejects.toThrow(/urn:test:backend:1/);
  });

  it('accepts the deprecated ruleSetVersionId spelling', async () => {
    // `ruleSetVersionId` was the only spelling the create body accepted before
    // the wire name was reconciled with the property. Clients may still be
    // sending it, so it resolves exactly as `ruleSetVersion` does — the failure
    // here is a missing target, not a rejected field.
    const body = {
      queryGroupVersion: {},
      executionNodes: [
        {
          id: 'urn:ui-temp:node-1',
          nodeType: 'RuleSetNode',
          ruleSetVersionId: 'urn:test:ruleset-version:does-not-exist',
          inputs: [],
          outputs: [],
        },
      ],
      edges: [],
    };

    await expect(createGroupVersionFlat(GROUP_ID, body)).rejects.toThrow(
      /executionNodes\[0\]\.ruleSetVersionId/
    );
  });

  it('rejects a QueryNode whose queryId does not resolve', async () => {
    seed('urn:test:backend:1', 'Backend');
    const body = {
      queryGroupVersion: {},
      executionNodes: [
        {
          id: 'urn:ui-temp:node-1',
          nodeType: 'QueryNode',
          queryId: 'urn:test:qv:missing',
          backendId: 'urn:test:backend:1',
        },
      ],
      edges: [],
    };

    await expect(createGroupVersionFlat(GROUP_ID, body)).rejects.toThrow(/urn:test:qv:missing/);
  });

  it('rejects a backendId that does not resolve', async () => {
    seed('urn:test:qv:1', 'QueryVersion', { isPartOf: 'urn:test:query:1' });
    const body = {
      queryGroupVersion: {},
      executionNodes: [
        {
          id: 'urn:ui-temp:node-1',
          nodeType: 'QueryNode',
          queryId: 'urn:test:qv:1',
          backendId: 'urn:test:backend:missing',
        },
      ],
      edges: [],
    };

    await expect(createGroupVersionFlat(GROUP_ID, body)).rejects.toThrow(
      /urn:test:backend:missing/
    );
  });

  it('rejects an edge endpoint that is neither minted here nor in the store', async () => {
    const body = validBody();
    body.edges.push({
      id: 'urn:ui-temp:edge-2',
      sourceNodeId: 'urn:ui-temp:node-1',
      targetNodeId: 'urn:test:node:nowhere',
      dataFlowType: 'CONTROL_FLOW',
    });

    await expect(createGroupVersionFlat(GROUP_ID, body)).rejects.toThrow(
      /urn:test:node:nowhere/
    );
  });

  it('rejects a urn:ui-temp: reference that no resource in the payload declares', async () => {
    const body = validBody();
    body.edges.push({
      id: 'urn:ui-temp:edge-2',
      sourceNodeId: 'urn:ui-temp:node-1',
      // Nothing in the payload has this id, so nothing minted an IRI for it.
      targetNodeId: 'urn:ui-temp:node-typo',
      dataFlowType: 'CONTROL_FLOW',
    });

    await expect(createGroupVersionFlat(GROUP_ID, body)).rejects.toThrow(/urn:ui-temp:node-typo/);
  });

  it('reports every unresolvable reference at once, not just the first', async () => {
    const body = {
      queryGroupVersion: {},
      executionNodes: [
        {
          id: 'urn:ui-temp:node-1',
          nodeType: 'QueryNode',
          queryId: 'urn:test:qv:missing-a',
          backendId: 'urn:test:backend:missing-b',
        },
      ],
      edges: [],
    };

    const error = await createGroupVersionFlat(GROUP_ID, body).catch(e => e as Error);
    expect(error.message).toMatch(/urn:test:qv:missing-a/);
    expect(error.message).toMatch(/urn:test:backend:missing-b/);
  });

  it('accepts a DynamicQueryNode with no queryId', async () => {
    seed('urn:test:backend:1', 'Backend');
    const body = {
      queryGroupVersion: {},
      executionNodes: [
        {
          id: 'urn:ui-temp:node-1',
          nodeType: 'DynamicQueryNode',
          backendId: 'urn:test:backend:1',
          inputs: [],
          outputs: [],
        },
      ],
      edges: [],
    };

    const result = await createGroupVersionFlat(GROUP_ID, body);
    expect(result.created).toBeTruthy();
  });

  it('writes nothing at all when a reference does not resolve', async () => {
    const body = {
      queryGroupVersion: {},
      executionNodes: [
        { id: 'urn:ui-temp:node-1', nodeType: 'RuleSetNode', ruleSetVersionId: 'urn:nope' },
      ],
      edges: [],
    };

    await expect(createGroupVersionFlat(GROUP_ID, body)).rejects.toThrow();

    // No version row, no children, no currentVersion bump.
    expect(hoisted.cacheCoordinator.create).not.toHaveBeenCalled();
    expect(hoisted.cacheCoordinator.update).not.toHaveBeenCalled();
  });

  it('writes the version row last, so a listed version is always complete', async () => {
    await createGroupVersionFlat(GROUP_ID, validBody());

    const createdTypes = hoisted.cacheCoordinator.create.mock.calls.map(([type]) => type);
    expect(createdTypes).toContain('QueryGroupVersion');
    expect(createdTypes.indexOf('QueryGroupVersion')).toBe(createdTypes.length - 1);

    const versionCall = hoisted.cacheCoordinator.create.mock.calls.find(
      ([type]) => type === 'QueryGroupVersion'
    );
    // Complete on creation — no follow-up finalize update.
    expect(versionCall?.[1]).toMatchObject({ executionNodes: expect.any(Array) });
  });
});
