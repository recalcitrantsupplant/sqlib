import { describe, it, expect, beforeEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const inserts: Record<string, any[]> = {};
  const register = (key: string) => {
    inserts[key] = [];
    return vi.fn(async (entity: any) => {
      inserts[key].push(entity);
      return entity;
    });
  };

  return {
    inserts,
    register,
    groupMap: new Map<string, any>(),
    versionMap: new Map<string, any>(),
    queryVersionMap: new Map<string, any>(),
    /** Everything else the payloads point at: backends, tuples, IO ports. */
    entityMap: new Map<string, any>(),
    create: vi.fn(async (type: string, entity: any) => {
      if (type === 'QueryGroupVersion') {
        const record = { ...entity, '@type': 'QueryGroupVersion' };
        hoisted.versionMap.set(record.$id, record);
        return record;
      }
      if (type === 'QueryGroup') {
        const record = { ...entity, '@type': 'QueryGroup' };
        hoisted.groupMap.set(record.$id, record);
        return record;
      }
      if (type === 'QueryVersion') {
        const record = { ...entity, '@type': 'QueryVersion' };
        hoisted.queryVersionMap.set(record.$id, record);
        return record;
      }
      if (!hoisted.inserts[type]) {
        hoisted.inserts[type] = [];
      }
      hoisted.inserts[type].push(entity);
      return { ...entity, '@type': type };
    }),
    update: vi.fn(async (type: string, id: string, updates: any) => {
      if (type === 'QueryGroupVersion') {
        const existing = hoisted.versionMap.get(id) || { $id: id, '@type': 'QueryGroupVersion' };
        const merged = { ...existing, ...updates };
        hoisted.versionMap.set(id, merged);
        return merged;
      }
      if (type === 'QueryGroup') {
        const existing = hoisted.groupMap.get(id) || { $id: id, '@type': 'QueryGroup' };
        const merged = { ...existing, ...updates };
        hoisted.groupMap.set(id, merged);
        return merged;
      }
      throw new Error(`Unexpected update type: ${type}`);
    }),
    get: vi.fn((id: string) => hoisted.groupMap.get(id) ?? hoisted.versionMap.get(id) ?? hoisted.queryVersionMap.get(id) ?? hoisted.entityMap.get(id) ?? null),
    list: vi.fn((type: string) => {
      if (type === 'QueryGroupVersion') return Array.from(hoisted.versionMap.values());
      if (type === 'QueryGroup') return Array.from(hoisted.groupMap.values());
      if (type === 'QueryVersion') return Array.from(hoisted.queryVersionMap.values());
      return [];
    }),
    reset() {
      hoisted.groupMap.clear();
      hoisted.versionMap.clear();
      hoisted.queryVersionMap.clear();
      hoisted.entityMap.clear();
    },
    seedEntity(id: string, type: string) {
      hoisted.entityMap.set(id, { $id: id, '@type': type });
    },
    seedGroup(group: any) {
      hoisted.groupMap.set(group.$id, group);
    },
    seedVersion(version: any) {
      hoisted.versionMap.set(version.$id, version);
    },
    seedQueryVersion(version: any) {
      hoisted.queryVersionMap.set(version.$id, version);
    },
  };
});

let idCounter = 0;

vi.mock('../../src/lib/id.js', () => ({
  mintId: (prefix: string) => `urn:mock:${prefix}:${++idCounter}`,
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    list: hoisted.list,
    get: hoisted.get,
    create: hoisted.create,
    update: hoisted.update,
    delete: vi.fn(),
    // Client-supplied references are resolved through this; backed by the same
    // fixtures `get` serves so the two cannot disagree.
    resolveExisting: async (id: string) => {
      const entity = hoisted.get(id) as { '@type'?: string } | null;
      return entity ? { type: entity['@type'], entity } : null;
    },
  }),
}));

const registerInsert = (key: string) => hoisted.register(key);

vi.mock('../../src/persistence/utils/QueryNodeUtils.js', () => ({
  QueryNodes: { insert: registerInsert('QueryNodes') },
}));
vi.mock('../../src/persistence/utils/DynamicQueryNodeUtils.js', () => ({
  DynamicQueryNodes: { insert: registerInsert('DynamicQueryNodes') },
}));
vi.mock('../../src/persistence/utils/StartNodeUtils.js', () => ({
  StartNodes: { insert: registerInsert('StartNodes') },
}));
vi.mock('../../src/persistence/utils/EndNodeUtils.js', () => ({
  EndNodes: { insert: registerInsert('EndNodes') },
}));
vi.mock('../../src/persistence/utils/QueryEdgeUtils.js', () => ({
  QueryEdges: { insert: registerInsert('QueryEdges') },
}));
vi.mock('../../src/persistence/utils/QueryInputUtils.js', () => ({
  QueryInputs: { insert: registerInsert('QueryInputs') },
}));
vi.mock('../../src/persistence/utils/QueryOutputUtils.js', () => ({
  QueryOutputs: { insert: registerInsert('QueryOutputs') },
}));
vi.mock('../../src/persistence/utils/QueryInputTupleUtils.js', () => ({
  QueryInputTuples: { insert: registerInsert('QueryInputTuples') },
}));
vi.mock('../../src/persistence/utils/QueryOutputTupleUtils.js', () => ({
  QueryOutputTuples: { insert: registerInsert('QueryOutputTuples') },
}));
vi.mock('../../src/persistence/utils/TupleMemberUtils.js', () => ({
  TupleMembers: { insert: registerInsert('TupleMembers') },
}));
vi.mock('../../src/persistence/utils/RdfOutputUtils.js', () => ({
  RdfOutputs: { insert: registerInsert('RdfOutputs') },
}));

describe('GroupVersionWriter persisted fields', () => {
  beforeEach(async () => {
    vi.resetModules();
    idCounter = 0;
    hoisted.reset();
    Object.values(hoisted.inserts).forEach(arr => arr.splice(0, arr.length));
    hoisted.seedGroup({ $id: 'urn:group:test', '@type': 'QueryGroup' });

    // These tests are about which fields survive the write, not about
    // reference checking — but the writer now refuses a payload naming
    // anything that does not exist, so the store has to actually hold what
    // they point at. Seeded once here to keep each test on its own subject.
    hoisted.seedEntity('urn:query:select', 'QueryVersion');
    hoisted.seedEntity('urn:query:construct', 'QueryVersion');
    hoisted.seedEntity('urn:query:single', 'QueryVersion');
    hoisted.seedEntity('urn:backend:select', 'Backend');
    hoisted.seedEntity('urn:backend:construct', 'Backend');
    hoisted.seedEntity('urn:backend:explicit', 'Backend');
    hoisted.seedEntity('urn:backend:primary', 'Backend');
    hoisted.seedEntity('urn:tuple:select', 'QueryOutputTuple');
    hoisted.seedEntity('urn:tuple:pair', 'QueryInputTuple');
    hoisted.seedEntity('urn:io:construct', 'TriplesQuadsIO');
    hoisted.seedEntity('urn:auto:input:seed', 'QueryInputTuple');
    hoisted.seedEntity('urn:user:input:extra', 'QueryInputTuple');
    hoisted.seedEntity('urn:user:output:extra', 'QueryOutputTuple');
  });

  it('preserves node and edge references on the returned version', async () => {
    const { createGroupVersionFlat } = await import('../../src/lib/GroupVersionWriter.js');

    const { created, iriMap } = await createGroupVersionFlat('urn:group:test', {
      canvasData: JSON.stringify({ zoom: 1 }),
      startNode: { id: 'urn:ui-temp:start-node-1', outputs: [] },
      endNode: { id: 'urn:ui-temp:end-node-1', outputs: [], mediaType: 'application/rdf+xml' },
      executionNodes: [
        {
          id: 'urn:ui-temp:select-node',
          nodeType: 'QueryNode',
          backendId: 'urn:backend:select',
          queryId: 'urn:query:select',
          outputs: ['urn:tuple:select'],
        },
        {
          id: 'urn:ui-temp:construct-node',
          nodeType: 'QueryNode',
          backendId: 'urn:backend:construct',
          queryId: 'urn:query:construct',
          inputs: ['urn:tuple:pair'],
          outputs: ['urn:io:construct'],
        },
      ],
      edges: [
        {
          id: 'urn:ui-temp:edge-start-select',
          sourceNodeId: 'urn:__START__',
          targetNodeId: 'urn:ui-temp:select-node',
          dataFlowType: 'CONTROL_FLOW',
        },
        {
          id: 'urn:ui-temp:edge-select-construct',
          sourceNodeId: 'urn:ui-temp:select-node',
          targetNodeId: 'urn:ui-temp:construct-node',
          dataFlowType: 'VARIABLE_BINDINGS',
          sourceOutputTupleId: 'urn:tuple:select',
          targetInputTupleId: 'urn:tuple:pair',
        },
        {
          id: 'urn:ui-temp:edge-construct-end',
          sourceNodeId: 'urn:ui-temp:construct-node',
          targetNodeId: 'urn:__END__',
          dataFlowType: 'CONTROL_FLOW',
        },
      ],
    });

    expect(created.startNode).toBe(iriMap['urn:__START__']);
    expect(created.endNode).toBe(iriMap['urn:__END__']);
    expect(created.executionNodes).toEqual([
      iriMap['urn:ui-temp:select-node'],
      iriMap['urn:ui-temp:construct-node'],
    ]);
    expect(created.edges).toEqual([
      iriMap['urn:ui-temp:edge-start-select'],
      iriMap['urn:ui-temp:edge-select-construct'],
      iriMap['urn:ui-temp:edge-construct-end'],
    ]);
    expect(created.canvasData).toBe(JSON.stringify({ zoom: 1 }));
    expect(created.isPartOf).toBe('urn:group:test');
  });

  it('auto seeds inferred IO when execution node omits inputs and outputs', async () => {
    const queryVersionId = 'urn:mock:queryVersion:auto';
    const inferredInputs = ['urn:auto:input:1'];
    const inferredOutputs = ['urn:auto:output:1'];

    hoisted.seedQueryVersion({
      $id: queryVersionId,
      '@type': 'QueryVersion',
      inferredInputs,
      inferredOutputs,
      defaultBackend: 'urn:backend:auto',
    });

    const createSpy = hoisted.create as any;
    createSpy.mockClear();

    const { createGroupVersionFlat } = await import('../../src/lib/GroupVersionWriter.js');

    await createGroupVersionFlat('urn:group:test', {
      executionNodes: [
        {
          id: 'urn:ui-temp:auto-node',
          nodeType: 'QueryNode',
          queryId: queryVersionId,
          backendId: 'urn:backend:explicit',
        },
      ],
      edges: [],
    });

    const nodeCall = createSpy.mock.calls.find(([type]: [string, any]) => type === 'QueryNode');
    expect(nodeCall).toBeTruthy();
    const nodeEntity = nodeCall![1];
    expect(nodeEntity.inputs).toEqual(inferredInputs);
    expect(nodeEntity.outputs).toEqual(inferredOutputs);
  });

  it('appends user-provided IO after inferred tuples without duplicates', async () => {
    const queryVersionId = 'urn:mock:queryVersion:merge';

    hoisted.seedQueryVersion({
      $id: queryVersionId,
      '@type': 'QueryVersion',
      inferredInputs: ['urn:auto:input:seed'],
      inferredOutputs: ['urn:auto:output:seed'],
      defaultBackend: 'urn:backend:auto',
    });

    const createSpy = hoisted.create as any;
    createSpy.mockClear();

    const { createGroupVersionFlat } = await import('../../src/lib/GroupVersionWriter.js');

    await createGroupVersionFlat('urn:group:test', {
      executionNodes: [
        {
          id: 'urn:ui-temp:merge-node',
          nodeType: 'QueryNode',
          queryId: queryVersionId,
          backendId: 'urn:backend:explicit',
          inputs: ['urn:auto:input:seed', 'urn:user:input:extra'],
          outputs: ['urn:user:output:extra'],
        },
      ],
      edges: [],
    });

    const nodeCall = createSpy.mock.calls.find(([type]: [string, any]) => type === 'QueryNode');
    expect(nodeCall).toBeTruthy();
    const nodeEntity = nodeCall![1];
    expect(nodeEntity.inputs).toEqual(['urn:auto:input:seed', 'urn:user:input:extra']);
    expect(nodeEntity.outputs).toEqual(['urn:auto:output:seed', 'urn:user:output:extra']);
  });

  it('propagates canvas data and version metadata when repository fetch omits arrays', async () => {
    hoisted.seedVersion({
      $id: 'urn:mock:groupVersion:prev',
      '@type': 'QueryGroupVersion',
      isPartOf: 'urn:group:test',
      version: 1,
    });

    const { createGroupVersionFlat } = await import('../../src/lib/GroupVersionWriter.js');
    const { created } = await createGroupVersionFlat('urn:group:test', {
      canvasData: JSON.stringify({ zoom: 2 }),
      executionNodes: [
        {
          id: 'urn:ui-temp:only-node',
          nodeType: 'QueryNode',
          backendId: 'urn:backend:primary',
          queryId: 'urn:query:single',
          outputs: [],
        },
      ],
      edges: [
        {
          id: 'urn:ui-temp:edge-1',
          sourceNodeId: 'urn:ui-temp:only-node',
          targetNodeId: 'urn:ui-temp:only-node',
          dataFlowType: 'CONTROL_FLOW',
        },
      ],
    });

    expect(created.version).toBe(2);
    expect(created.executionNodes?.length).toBe(1);
    expect(created.edges?.length).toBe(1);
    expect(created.isPartOf).toBe('urn:group:test');
  });

  /*
   * Issue #297: a node with an ephemeral store never reads `backendId` —
   * `ExecutorFactory` branches on the config first — so requiring one made
   * every all-ephemeral group name an irrelevant backend, which read as a
   * coupling the group did not have and broke it if that backend was deleted.
   */
  it('persists an ephemeral node with no backendId at all', async () => {
    const { createGroupVersionFlat } = await import('../../src/lib/GroupVersionWriter.js');

    await createGroupVersionFlat('urn:group:test', {
      startNode: { id: 'urn:ui-temp:start-node-1', outputs: [] },
      endNode: { id: 'urn:ui-temp:end-node-1', outputs: [] },
      executionNodes: [
        {
          id: 'urn:ui-temp:ephemeral-node',
          nodeType: 'QueryNode',
          queryId: 'urn:query:single',
          backendConfig: { type: 'ephemeral-oxigraph', storeId: 'store-a' },
        },
      ],
      edges: [],
    });

    const [node] = hoisted.inserts.QueryNode;
    expect(node.backendConfig).toEqual({ type: 'ephemeral-oxigraph', storeId: 'store-a' });
    // Not merely unresolved — absent. A defaulted backend here is what put a
    // placeholder on every ephemeral node and made the canvas state the
    // opposite of what executes.
    expect(node.backendId ?? null).toBeNull();
  });

  it('refuses a node that names both a backend and an ephemeral store', async () => {
    const { createGroupVersionFlat } = await import('../../src/lib/GroupVersionWriter.js');

    await expect(
      createGroupVersionFlat('urn:group:test', {
        startNode: { id: 'urn:ui-temp:start-node-1', outputs: [] },
        endNode: { id: 'urn:ui-temp:end-node-1', outputs: [] },
        executionNodes: [
          {
            id: 'urn:ui-temp:conflicted-node',
            nodeType: 'QueryNode',
            queryId: 'urn:query:single',
            backendId: 'urn:backend:primary',
            backendConfig: { type: 'ephemeral-oxigraph', storeId: 'store-a' },
          },
        ],
        edges: [],
      }),
    ).rejects.toThrow(/cannot be combined with an ephemeral backendConfig/);
  });

  it('still requires a backend for a node with no ephemeral store', async () => {
    const { createGroupVersionFlat } = await import('../../src/lib/GroupVersionWriter.js');

    await expect(
      createGroupVersionFlat('urn:group:test', {
        startNode: { id: 'urn:ui-temp:start-node-1', outputs: [] },
        endNode: { id: 'urn:ui-temp:end-node-1', outputs: [] },
        executionNodes: [
          { id: 'urn:ui-temp:bare-node', nodeType: 'QueryNode', queryId: 'urn:query:single' },
        ],
        edges: [],
      }),
    ).rejects.toThrow(/could not be resolved, and no default applies/);
  });

  /*
   * Issue #301's server-side half. The web editor is fixed, but "the client
   * remembered to send it back" is not a property the server should rely on
   * for a field whose absence is destructive.
   */
  describe('refuses to silently drop an ephemeral store on re-save', () => {
    const EXISTING_NODE = 'urn:sqlib:node:existing';

    const resave = (node: Record<string, unknown>) => async () => {
      const { createGroupVersionFlat } = await import('../../src/lib/GroupVersionWriter.js');
      return createGroupVersionFlat('urn:group:test', {
        startNode: { id: 'urn:ui-temp:start-node-1', outputs: [] },
        endNode: { id: 'urn:ui-temp:end-node-1', outputs: [] },
        executionNodes: [{ id: EXISTING_NODE, nodeType: 'QueryNode', queryId: 'urn:query:single', ...node }],
        edges: [],
      });
    };

    beforeEach(() => {
      hoisted.entityMap.set(EXISTING_NODE, {
        $id: EXISTING_NODE,
        '@type': 'QueryNode',
        queryId: 'urn:query:single',
        backendConfig: { type: 'ephemeral-oxigraph', storeId: 'store-a' },
      });
    });

    it('rejects a payload that omits the config the node already has', async () => {
      await expect(resave({})()).rejects.toThrow(/would silently drop that store/);
    });

    it('accepts the same node when the config is sent back', async () => {
      await resave({ backendConfig: { type: 'ephemeral-oxigraph', storeId: 'store-a' } })();

      const [node] = hoisted.inserts.QueryNode;
      expect(node.backendConfig).toEqual({ type: 'ephemeral-oxigraph', storeId: 'store-a' });
    });

    /*
     * An explicit null is a client deliberately clearing the store — a
     * legitimate edit, and the one thing that distinguishes "I mean this" from
     * "I have never heard of this field".
     */
    it('accepts an explicit null as a deliberate clear', async () => {
      await resave({ backendConfig: null, backendId: 'urn:backend:primary' })();

      const [node] = hoisted.inserts.QueryNode;
      expect(node.backendConfig ?? null).toBeNull();
      expect(node.backendId).toBe('urn:backend:primary');
    });

    it('does not fire for a node the payload is minting', async () => {
      const { createGroupVersionFlat } = await import('../../src/lib/GroupVersionWriter.js');

      await createGroupVersionFlat('urn:group:test', {
        startNode: { id: 'urn:ui-temp:start-node-1', outputs: [] },
        endNode: { id: 'urn:ui-temp:end-node-1', outputs: [] },
        executionNodes: [
          {
            id: 'urn:ui-temp:brand-new',
            nodeType: 'QueryNode',
            queryId: 'urn:query:single',
            backendId: 'urn:backend:primary',
          },
        ],
        edges: [],
      });

      expect(hoisted.inserts.QueryNode).toHaveLength(1);
    });
  });
});
