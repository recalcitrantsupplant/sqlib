import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createGroupVersionFlat } from '../../src/lib/GroupVersionWriter.js';
import type { EntityType } from '../../src/lib/EntityRegistry.js';
import type { LDKitEntity } from '../../src/persistence/EntityTypes.js';
import { installFakePersistenceAdapter } from '../support/fakePersistenceAdapter.js';

let store: Awaited<ReturnType<typeof installFakePersistenceAdapter>>;

/** The QueryNodes the write stored. */
const storedNodes = () => store.all('QueryNode');

describe('GroupVersionWriter persisted fields', () => {
  // These tests are about which fields survive the write, not about
  // reference checking — but the writer refuses a payload naming anything
  // that does not exist, so the store has to actually hold what they point
  // at. Seeded once here to keep each test on its own subject.
  const referenced: Array<[string, EntityType]> = [
    ['urn:query:select', 'QueryVersion'],
    ['urn:query:construct', 'QueryVersion'],
    ['urn:query:single', 'QueryVersion'],
    ['urn:backend:select', 'Backend'],
    ['urn:backend:construct', 'Backend'],
    ['urn:backend:explicit', 'Backend'],
    ['urn:backend:primary', 'Backend'],
    ['urn:tuple:select', 'QueryOutputTuple'],
    ['urn:tuple:pair', 'QueryInputTuple'],
    ['urn:io:construct', 'TriplesQuadsIO'],
    ['urn:auto:input:seed', 'QueryInputTuple'],
    ['urn:user:input:extra', 'QueryInputTuple'],
    ['urn:user:output:extra', 'QueryOutputTuple'],
  ];

  /** Installs the store over the group, what the payloads reference, and `extra`. */
  async function install(extra: Array<{ type: EntityType; entity: LDKitEntity }> = []): Promise<void> {
    store?.restore();
    store = await installFakePersistenceAdapter([
      { type: 'QueryGroup', entity: { $id: 'urn:group:test', '@type': 'QueryGroup' } },
      ...referenced.map(([id, type]) => ({ type, entity: { $id: id, '@type': type } })),
      ...extra,
    ]);
  }

  beforeEach(() => install());

  afterEach(() => store.restore());

  it('preserves node and edge references on the returned version', async () => {
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

    await install([{
      type: 'QueryVersion',
      entity: {
        $id: queryVersionId,
        '@type': 'QueryVersion',
        inferredInputs,
        inferredOutputs,
        defaultBackend: 'urn:backend:auto',
      },
    }]);

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

    const [nodeEntity] = storedNodes();
    expect(nodeEntity.inputs).toEqual(inferredInputs);
    expect(nodeEntity.outputs).toEqual(inferredOutputs);
  });

  it('appends user-provided IO after inferred tuples without duplicates', async () => {
    const queryVersionId = 'urn:mock:queryVersion:merge';

    await install([{
      type: 'QueryVersion',
      entity: {
        $id: queryVersionId,
        '@type': 'QueryVersion',
        inferredInputs: ['urn:auto:input:seed'],
        inferredOutputs: ['urn:auto:output:seed'],
        defaultBackend: 'urn:backend:auto',
      },
    }]);

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

    const [nodeEntity] = storedNodes();
    expect(nodeEntity.inputs).toEqual(['urn:auto:input:seed', 'urn:user:input:extra']);
    expect(nodeEntity.outputs).toEqual(['urn:auto:output:seed', 'urn:user:output:extra']);
  });

  it('propagates canvas data and version metadata when repository fetch omits arrays', async () => {
    await install([{
      type: 'QueryGroupVersion',
      entity: {
        $id: 'urn:mock:groupVersion:prev',
        '@type': 'QueryGroupVersion',
        isPartOf: 'urn:group:test',
        version: 1,
      },
    }]);

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
    expect(store.get(created.$id)).toMatchObject({ version: 2, isPartOf: 'urn:group:test' });
  });

  /*
   * Issue #297: a node with an ephemeral store never reads `backendId` —
   * `ExecutorFactory` branches on the config first — so requiring one made
   * every all-ephemeral group name an irrelevant backend, which read as a
   * coupling the group did not have and broke it if that backend was deleted.
   */
  it('persists an ephemeral node with no backendId at all', async () => {
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

    const [node] = storedNodes();
    expect(node.backendConfig).toEqual({ type: 'ephemeral-oxigraph', storeId: 'store-a' });
    // Not merely unresolved — absent. A defaulted backend here is what put a
    // placeholder on every ephemeral node and made the canvas state the
    // opposite of what executes.
    expect(node.backendId ?? null).toBeNull();
  });

  it('refuses a node that names both a backend and an ephemeral store', async () => {
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
    /** The nodes the re-save wrote, leaving out the one it re-saved from. */
    const writtenNodes = () => storedNodes().filter(node => node.$id !== EXISTING_NODE);

    const resave = (node: Record<string, unknown>) => async () => {
        return createGroupVersionFlat('urn:group:test', {
        startNode: { id: 'urn:ui-temp:start-node-1', outputs: [] },
        endNode: { id: 'urn:ui-temp:end-node-1', outputs: [] },
        executionNodes: [{ id: EXISTING_NODE, nodeType: 'QueryNode', queryId: 'urn:query:single', ...node }],
        edges: [],
      });
    };

    beforeEach(() => install([{
      type: 'QueryNode',
      entity: {
        $id: EXISTING_NODE,
        '@type': 'QueryNode',
        queryId: 'urn:query:single',
        backendConfig: { type: 'ephemeral-oxigraph', storeId: 'store-a' },
      },
    }]));

    it('rejects a payload that omits the config the node already has', async () => {
      await expect(resave({})()).rejects.toThrow(/would silently drop that store/);
    });

    it('accepts the same node when the config is sent back', async () => {
      await resave({ backendConfig: { type: 'ephemeral-oxigraph', storeId: 'store-a' } })();

      const [node] = writtenNodes();
      expect(node.backendConfig).toEqual({ type: 'ephemeral-oxigraph', storeId: 'store-a' });
    });

    /*
     * An explicit null is a client deliberately clearing the store — a
     * legitimate edit, and the one thing that distinguishes "I mean this" from
     * "I have never heard of this field".
     */
    it('accepts an explicit null as a deliberate clear', async () => {
      await resave({ backendConfig: null, backendId: 'urn:backend:primary' })();

      const [node] = writtenNodes();
      expect(node.backendConfig ?? null).toBeNull();
      expect(node.backendId).toBe('urn:backend:primary');
    });

    it('does not fire for a node the payload is minting', async () => {
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

      expect(writtenNodes()).toHaveLength(1);
    });
  });
});
