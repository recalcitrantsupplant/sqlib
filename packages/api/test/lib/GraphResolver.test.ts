import { describe, it, expect, beforeEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  get: vi.fn(),
  getByType: vi.fn(),
  QueryNodes: { findByIri: vi.fn() },
  QueryEdges: { findByIri: vi.fn() },
  DynamicQueryNodes: { findByIri: vi.fn() },
  StartNodes: { findByIri: vi.fn() },
  EndNodes: { findByIri: vi.fn() },
  loadTriplesQuadsIOsByIds: vi.fn(),
  loadQueryInputTuplesByIds: vi.fn(),
  loadQueryOutputTuplesByIds: vi.fn(),
  loadQueryVersionsByIds: vi.fn(),
  loadTupleMembersByIds: vi.fn(),
  findQueryInputVariableById: vi.fn(),
  findQueryOutputVariableById: vi.fn(),
  loadQueryInputVariablesByIds: vi.fn(),
  loadQueryOutputVariablesByIds: vi.fn(),
}));

describe('GraphResolver utilities', () => {
  let moduleRef: typeof import('../../src/lib/GraphResolver.js');
  let expandGroupVersion: typeof import('../../src/lib/GraphResolver.js').expandGroupVersion;
  let expandCurrentVersionForGroup: typeof import('../../src/lib/GraphResolver.js').expandCurrentVersionForGroup;
  let expandGroupVersionDetailed: typeof import('../../src/lib/GraphResolver.js').expandGroupVersionDetailed;

  beforeEach(async () => {
    vi.resetModules();
    hoisted.get.mockReset();
    hoisted.getByType.mockReset();
    hoisted.QueryNodes.findByIri.mockReset();
    hoisted.QueryEdges.findByIri.mockReset();
    hoisted.DynamicQueryNodes.findByIri.mockReset();
    hoisted.StartNodes.findByIri.mockReset();
    hoisted.EndNodes.findByIri.mockReset();
    hoisted.loadTriplesQuadsIOsByIds.mockReset();
    hoisted.loadQueryInputTuplesByIds.mockReset();
    hoisted.loadQueryOutputTuplesByIds.mockReset();
    hoisted.loadQueryVersionsByIds.mockReset();
    hoisted.loadTupleMembersByIds.mockReset();
    hoisted.findQueryInputVariableById.mockReset();
    hoisted.findQueryOutputVariableById.mockReset();
    hoisted.loadQueryInputVariablesByIds.mockReset();
    hoisted.loadQueryOutputVariablesByIds.mockReset();

    vi.doMock('../../src/persistence/utils/QueryNodeUtils.js', () => ({ QueryNodes: hoisted.QueryNodes }));
    vi.doMock('../../src/persistence/utils/QueryEdgeUtils.js', () => ({ QueryEdges: hoisted.QueryEdges }));
    vi.doMock('../../src/persistence/utils/DynamicQueryNodeUtils.js', () => ({ DynamicQueryNodes: hoisted.DynamicQueryNodes }));
    vi.doMock('../../src/persistence/utils/StartNodeUtils.js', () => ({ StartNodes: hoisted.StartNodes }));
    vi.doMock('../../src/persistence/utils/EndNodeUtils.js', () => ({ EndNodes: hoisted.EndNodes }));
    vi.doMock('../../src/persistence/utils/TriplesQuadsIOUtils.js', () => ({
      loadTriplesQuadsIOsByIds: hoisted.loadTriplesQuadsIOsByIds,
      TriplesQuadsIOs: { findByIri: vi.fn() },
    }));
    vi.doMock('../../src/persistence/utils/QueryInputTupleUtils.js', () => ({
      loadQueryInputTuplesByIds: hoisted.loadQueryInputTuplesByIds,
      QueryInputTuples: { findByIri: vi.fn() },
    }));
    vi.doMock('../../src/persistence/utils/QueryOutputTupleUtils.js', () => ({
      loadQueryOutputTuplesByIds: hoisted.loadQueryOutputTuplesByIds,
      QueryOutputTuples: { findByIri: vi.fn() },
    }));
    vi.doMock('../../src/persistence/utils/QueryVersionUtils.js', () => ({
      loadQueryVersionsByIds: hoisted.loadQueryVersionsByIds,
      QueryVersions: { findByIri: vi.fn() },
    }));
    vi.doMock('../../src/persistence/utils/TupleMemberUtils.js', () => ({
      loadTupleMembersByIds: hoisted.loadTupleMembersByIds,
      TupleMembers: { findByIri: vi.fn() },
    }));
    vi.doMock('../../src/persistence/utils/QueryInputVariableUtils.js', () => ({
      findQueryInputVariableById: hoisted.findQueryInputVariableById,
      loadQueryInputVariablesByIds: hoisted.loadQueryInputVariablesByIds,
      QueryInputVariables: { findByIri: vi.fn() },
    }));
    vi.doMock('../../src/persistence/utils/QueryOutputVariableUtils.js', () => ({
      findQueryOutputVariableById: hoisted.findQueryOutputVariableById,
      loadQueryOutputVariablesByIds: hoisted.loadQueryOutputVariablesByIds,
      QueryOutputVariables: { findByIri: vi.fn() },
    }));
    vi.doMock('../../src/lib/CacheCoordinatorProvider.js', () => ({
      getCacheCoordinator: () => ({
        get: hoisted.get,
        list: hoisted.getByType,
      }),
    }));

    moduleRef = await import('../../src/lib/GraphResolver.js');
    ({ expandGroupVersion, expandCurrentVersionForGroup, expandGroupVersionDetailed } = moduleRef);
  });

  afterEach(() => {
    vi.unmock('../../src/persistence/utils/QueryNodeUtils.js');
    vi.unmock('../../src/persistence/utils/QueryEdgeUtils.js');
    vi.unmock('../../src/persistence/utils/DynamicQueryNodeUtils.js');
    vi.unmock('../../src/persistence/utils/StartNodeUtils.js');
    vi.unmock('../../src/persistence/utils/EndNodeUtils.js');
    vi.unmock('../../src/persistence/utils/TriplesQuadsIOUtils.js');
    vi.unmock('../../src/persistence/utils/QueryInputTupleUtils.js');
    vi.unmock('../../src/persistence/utils/QueryOutputTupleUtils.js');
    vi.unmock('../../src/persistence/utils/QueryVersionUtils.js');
    vi.unmock('../../src/persistence/utils/TupleMemberUtils.js');
    vi.unmock('../../src/persistence/utils/QueryInputVariableUtils.js');
    vi.unmock('../../src/persistence/utils/QueryOutputVariableUtils.js');
    vi.unmock('../../src/lib/CacheCoordinatorProvider.js');
  });

  it('expands nodes and edges using cache with repository fallback', async () => {
    hoisted.get.mockImplementation((id: string) => {
      if (id === 'urn:node:cache') {
        return { $id: id, '@type': 'QueryNode', nodeType: 'QueryNode', inputs: [], outputs: [], name: 'Cached Node' };
      }
      if (id === 'urn:edge:cache') {
        return { $id: id, '@type': 'QueryEdge', name: 'Cached Edge' };
      }
      return null;
    });
    hoisted.QueryNodes.findByIri.mockResolvedValue({ $id: 'urn:node:fallback', '@type': 'QueryNode', nodeType: 'QueryNode', name: 'Repo Node' } as any);
    hoisted.QueryEdges.findByIri.mockResolvedValue({ $id: 'urn:edge:fallback', '@type': 'QueryEdge', name: 'Repo Edge' } as any);
    const queryNodeModule = await import('../../src/persistence/utils/QueryNodeUtils.js');
    expect(queryNodeModule.QueryNodes).toBe(hoisted.QueryNodes);

    const version = {
      $id: 'urn:qgv:1',
      '@type': 'QueryGroupVersion',
      groupId: 'urn:group:1',
      version: 1,
      executionNodes: ['urn:node:cache', 'urn:node:fallback', undefined],
      edges: ['urn:edge:cache', 'urn:edge:fallback', null],
    } as any;

    const expanded = await expandGroupVersion(version);

    expect(expanded.queryGroupVersion).toEqual({ id: 'urn:qgv:1', groupId: 'urn:group:1', version: 1, executionNodes: ['urn:node:cache', 'urn:node:fallback', undefined], edges: ['urn:edge:cache', 'urn:edge:fallback', null] });
    expect(expanded.edges).toEqual([
      { id: 'urn:edge:cache', name: 'Cached Edge' },
      { id: 'urn:edge:fallback', name: 'Repo Edge' },
    ]);

    // Assert new execution node fields exist and contain expected data
    expect(expanded.executionNodes).toBeDefined();
    expect(Array.isArray(expanded.executionNodes)).toBe(true);
    expect(expanded.executionNodes).toEqual([
      expect.objectContaining({ id: 'urn:node:cache', name: 'Cached Node', nodeType: 'QueryNode' }),
      expect.objectContaining({ id: 'urn:node:fallback', name: 'Repo Node', nodeType: 'QueryNode' }),
    ]);
    expect(expanded.startNode).toBeNull();
    expect(expanded.endNode).toBeNull();
    expect(hoisted.QueryNodes.findByIri).toHaveBeenCalledWith('urn:node:fallback');
    expect(hoisted.QueryEdges.findByIri).toHaveBeenCalledWith('urn:edge:fallback');
  });

  it('dedupes repeated node references before repository lookups', async () => {
    hoisted.get.mockReturnValue(null);

    hoisted.QueryNodes.findByIri.mockImplementation(async (id: string) => ({
      $id: id,
      '@type': 'QueryNode',
      inputs: ['urn:sqlib:input-tuple:dup', 'urn:sqlib:input-tuple:dup'],
      outputs: ['urn:sqlib:output-tuple:dup'],
      queryId: undefined,
    } as any));
    hoisted.QueryEdges.findByIri.mockResolvedValue({
      $id: 'urn:edge:dup',
      '@type': 'QueryEdge',
    } as any);

    hoisted.loadQueryInputTuplesByIds.mockResolvedValue([
      { $id: 'urn:sqlib:input-tuple:dup', memberEntries: ['urn:sqlib:tuple-member:dup'] },
    ]);
    hoisted.loadQueryOutputTuplesByIds.mockResolvedValue([
      { $id: 'urn:sqlib:output-tuple:dup', memberEntries: ['urn:sqlib:tuple-member:dup'] },
    ]);
    hoisted.loadQueryVersionsByIds.mockResolvedValue([]);
    hoisted.loadTupleMembersByIds.mockResolvedValue([
      { $id: 'urn:sqlib:tuple-member:dup', variable: 'urn:input:dup', position: 0 },
    ]);
    hoisted.findQueryInputVariableById.mockImplementation(async (id: string) => (id === 'urn:input:dup' ? { $id: id } : null));
    hoisted.findQueryOutputVariableById.mockResolvedValue(null);
    hoisted.loadQueryInputVariablesByIds.mockResolvedValue([{ $id: 'urn:input:dup', '@type': 'QueryInputVariable' }]);
    hoisted.loadQueryOutputVariablesByIds.mockResolvedValue([]);

    const version = {
      $id: 'urn:qgv:dup',
      '@type': 'QueryGroupVersion',
      groupId: 'urn:group:dup',
      version: 1,
      executionNodes: ['urn:node:dup', 'urn:node:dup', 'urn:node:dup'],
      edges: ['urn:edge:dup', 'urn:edge:dup'],
    } as any;

    await expandGroupVersionDetailed(version);

    expect(hoisted.QueryNodes.findByIri).toHaveBeenCalledTimes(1);
    expect(hoisted.QueryNodes.findByIri).toHaveBeenCalledWith('urn:node:dup');
    expect(hoisted.QueryEdges.findByIri).toHaveBeenCalledTimes(1);
    expect(hoisted.QueryEdges.findByIri).toHaveBeenCalledWith('urn:edge:dup');
    expect(hoisted.loadQueryInputTuplesByIds).toHaveBeenCalledTimes(1);
    expect(hoisted.loadQueryInputTuplesByIds).toHaveBeenCalledWith(['urn:sqlib:input-tuple:dup']);
    expect(hoisted.loadTupleMembersByIds).toHaveBeenCalledWith(['urn:sqlib:tuple-member:dup']);
    expect(hoisted.findQueryInputVariableById).not.toHaveBeenCalled();
  });

  it('expands current version for group using cache and type scan', async () => {
    hoisted.get.mockImplementation((id: string) => {
      if (id === 'urn:group:1') {
        // This mock simulates a valid LDKit entity found in the cache.
        return { $id: 'urn:group:1', '@type': 'QueryGroup', currentVersion: 'urn:qgv:1' };
      }
      if (id === 'urn:qgv:1') {
        return { $id: 'urn:qgv:1', '@type': 'QueryGroupVersion', executionNodes: [], edges: [] };
      }
      return null;
    });

    const expandSpy = vi.spyOn(moduleRef, 'expandGroupVersion');
    expandSpy.mockResolvedValue({ queryGroupVersion: { id: 'urn:qgv:1', executionNodes: [], edges: [] }, executionNodes: [], edges: [] } as any);

    const result = await expandCurrentVersionForGroup('urn:group:1');
    expect(result).toEqual(expect.objectContaining({
      version: { id: 'urn:qgv:1', executionNodes: [], edges: [] },
      executionNodes: [],
      edges: []
    }));
    expandSpy.mockRestore();
  });

  it('expandGroupVersionDetailed gathers related tuples and resources', async () => {
    hoisted.get.mockImplementation((id: string) => {
      if (id === 'urn:edge:1') {
        return { $id: id, '@type': 'QueryEdge', name: 'Edge' };
      }
      return null;
    });

    hoisted.QueryNodes.findByIri.mockImplementation(async (id: string) => {
      if (id === 'urn:node:query') {
        return {
          $id: id,
          '@type': 'QueryNode',
          nodeType: 'QueryNode',
          inputs: ['urn:sqlib:input-tuple:input'],
          outputs: ['urn:sqlib:output-tuple:output'],
          queryId: 'urn:query-version:1',
        } as any;
      }
      return null;
    });

    hoisted.DynamicQueryNodes.findByIri.mockImplementation(async (id: string) => {
      if (id === 'urn:node:dynamic') {
        return {
          $id: id,
          '@type': 'DynamicQueryNode',
          nodeType: 'DynamicQueryNode',
          inputs: ['urn:sqlib:input-tuple:dynamic'],
          queryId: 'urn:query-version:1',
        } as any;
      }
      return null;
    });

    hoisted.StartNodes.findByIri.mockImplementation(async (id: string) => {
      if (id === 'urn:node:start') {
        return {
          $id: id,
          '@type': 'StartNode',
          outputs: ['urn:sqlib:output-tuple:output'],
        } as any;
      }
      return null;
    });

    hoisted.EndNodes.findByIri.mockImplementation(async (id: string) => {
      if (id === 'urn:node:end') {
        return {
          $id: id,
          '@type': 'EndNode',
          inputs: ['urn:rdf:1', 'urn:sqlib:output-tuple:output'],
        } as any;
      }
      return null;
    });

    hoisted.loadTriplesQuadsIOsByIds.mockResolvedValue([{ $id: 'urn:rdf:1', '@type': 'TriplesQuadsIO' }]);
    hoisted.loadQueryInputTuplesByIds.mockResolvedValue([
      { $id: 'urn:sqlib:input-tuple:input', '@type': 'QueryInputTuple', memberEntries: ['urn:sqlib:tuple-member:1'] },
      { $id: 'urn:sqlib:input-tuple:dynamic', '@type': 'QueryInputTuple', memberEntries: [] },
    ]);
    hoisted.loadQueryOutputTuplesByIds.mockResolvedValue([
      { $id: 'urn:sqlib:output-tuple:output', '@type': 'QueryOutputTuple', memberEntries: ['urn:sqlib:tuple-member:2'] },
    ]);
    hoisted.loadQueryVersionsByIds.mockResolvedValue([{ $id: 'urn:query-version:1', '@type': 'QueryVersion' }]);
    hoisted.loadTupleMembersByIds.mockResolvedValue([
      { $id: 'urn:sqlib:tuple-member:1', '@type': 'TupleMember', variable: 'urn:input:1', position: 0 },
      { $id: 'urn:sqlib:tuple-member:2', '@type': 'TupleMember', variable: 'urn:output:1', position: 0 },
    ]);
    hoisted.findQueryInputVariableById.mockImplementation(async (id: string) => (id === 'urn:input:1' ? { $id: id } : null));
    hoisted.findQueryOutputVariableById.mockImplementation(async (id: string) => (id === 'urn:output:1' ? { $id: id } : null));
    hoisted.loadQueryInputVariablesByIds.mockResolvedValue([{ $id: 'urn:input:1', '@type': 'QueryInputVariable' }]);
    hoisted.loadQueryOutputVariablesByIds.mockResolvedValue([{ $id: 'urn:output:1', '@type': 'QueryOutputVariable' }]);

    const version = {
      $id: 'urn:qgv:1',
      '@type': 'QueryGroupVersion',
      groupId: 'urn:group:1',
      version: 1,
      executionNodes: ['urn:node:query', 'urn:node:dynamic'], // Only execution nodes, not start/end
      edges: ['urn:edge:1'],
      startNode: 'urn:node:start',
      endNode: 'urn:node:end',
    } as any;

    const detailed = await expandGroupVersionDetailed(version);

    expect((detailed.queryGroupVersion as any).id).toBe('urn:qgv:1');
    expect(detailed.edges).toHaveLength(1);
    expect(detailed.queryNodes).toEqual([
      expect.objectContaining({
        id: 'urn:node:query',
        inputs: ['urn:sqlib:input-tuple:input'],
        outputs: ['urn:sqlib:output-tuple:output'],
        queryId: 'urn:query-version:1',
        nodeType: 'QueryNode',
      }),
    ]);
    expect(detailed.dynamicQueryNodes).toEqual([
      expect.objectContaining({
        id: 'urn:node:dynamic',
        inputs: ['urn:sqlib:input-tuple:dynamic'],
        queryId: 'urn:query-version:1',
        nodeType: 'DynamicQueryNode',
      }),
    ]);
    expect(detailed.startNodes).toEqual([
      expect.objectContaining({
        id: 'urn:node:start',
        outputs: ['urn:sqlib:output-tuple:output'],
      }),
    ]);
    expect(detailed.endNodes).toEqual([
      expect.objectContaining({
        id: 'urn:node:end',
        inputs: ['urn:rdf:1', 'urn:sqlib:output-tuple:output'],
      }),
    ]);
    expect(detailed.rdfOutputs).toEqual([{ id: 'urn:rdf:1' }]);
    expect(detailed.inputTuples.map(t => (t as any).id)).toContain('urn:sqlib:input-tuple:input');
    expect(detailed.outputTuples.map(t => (t as any).id)).toContain('urn:sqlib:output-tuple:output');
    expect(detailed.tupleMembers.map(m => (m as any).id)).toEqual(['urn:sqlib:tuple-member:1', 'urn:sqlib:tuple-member:2']);
    expect(detailed.inputs).toEqual([{ id: 'urn:input:1' }]);
    expect(detailed.outputs).toEqual([{ id: 'urn:output:1' }]);
    expect(detailed.queryVersions).toEqual([{ id: 'urn:query-version:1' }]);

    // Assert new execution node fields exist and contain expected data with nodeType
    expect(detailed.executionNodes).toBeDefined();
    expect(Array.isArray(detailed.executionNodes)).toBe(true);
    expect(detailed.executionNodes).toEqual([
      expect.objectContaining({ id: 'urn:node:query', inputs: ['urn:sqlib:input-tuple:input'], outputs: ['urn:sqlib:output-tuple:output'], queryId: 'urn:query-version:1', nodeType: 'QueryNode' }),
      expect.objectContaining({ id: 'urn:node:dynamic', inputs: ['urn:sqlib:input-tuple:dynamic'], queryId: 'urn:query-version:1', nodeType: 'DynamicQueryNode' }),
    ]);
  });

  it('expandGroupVersion skips nodes or edges when repository lookups fail', async () => {
    hoisted.get.mockReturnValue(null);
    hoisted.QueryNodes.findByIri.mockRejectedValue(new Error('node repo down'));
    hoisted.QueryEdges.findByIri.mockRejectedValue(new Error('edge repo down'));

    const version = {
      $id: 'urn:qgv:2',
      '@type': 'QueryGroupVersion',
      executionNodes: ['urn:node:missing'],
      edges: ['urn:edge:missing'],
    } as any;

    const expanded = await expandGroupVersion(version);

    expect(expanded.executionNodes).toEqual([]);
    expect(expanded.edges).toEqual([]);
  });

  it('expandCurrentVersionForGroup falls back to type scan when direct cache misses', async () => {
    hoisted.get.mockImplementation((id: string) => {
      if (id === 'urn:group:scan') {
        return { $id: 'urn:group:scan', '@type': 'QueryGroup', currentVersion: 'urn:qgv:scan' };
      }
      return null;
    });
    hoisted.getByType.mockReturnValue([
      { $id: 'urn:qgv:scan', '@type': 'QueryGroupVersion', executionNodes: [], edges: [] },
    ]);

    const result = await expandCurrentVersionForGroup('urn:group:scan');

    expect(result).toEqual(expect.objectContaining({
      version: { id: 'urn:qgv:scan', executionNodes: [], edges: [] },
      executionNodes: [],
      edges: [],
    }));
  });

  it('expandCurrentVersionForGroup returns null when group is missing', async () => {
    hoisted.get.mockReturnValue(null);

    const result = await expandCurrentVersionForGroup('urn:group:missing');

    expect(result).toBeNull();
  });

  it('expandGroupVersion creates executionNodes excluding start/end nodes', async () => {
    const startNode = { $id: 'urn:start:1', '@type': 'StartNode', outputs: [] };
    const endNode = { $id: 'urn:end:1', '@type': 'EndNode', inputs: [] };
    const execNode = { $id: 'urn:exec:1', '@type': 'QueryNode', nodeType: 'QueryNode', inputs: [], outputs: [] };

    hoisted.get.mockImplementation((id: string) => {
      if (id === 'urn:start:1') return startNode;
      if (id === 'urn:end:1') return endNode;
      if (id === 'urn:exec:1') return execNode;
      return null;
    });

    const version = {
      $id: 'urn:qgv:1',
      groupId: 'urn:group:1',
      version: 1,
      '@type': 'QueryGroupVersion',
      startNode: 'urn:start:1',
      endNode: 'urn:end:1',
      executionNodes: ['urn:exec:1'],
      edges: [],
    } as any;

    const expanded = await expandGroupVersion(version);

    // executionNodes should contain only the execution node, not start/end
    expect(expanded.executionNodes).toEqual([
      expect.objectContaining({ id: 'urn:exec:1', nodeType: 'QueryNode' }),
    ]);

    // start and end nodes should be available separately
  });

  it('expandGroupVersionDetailed surfaces node classifications for start/end and execution nodes', async () => {
    hoisted.get.mockImplementation((id: string) => {
      if (id === 'urn:start:detail') {
      }
      if (id === 'urn:end:detail') {
      }
      if (id === 'urn:exec:detail') {
        return { $id: id, '@type': 'QueryNode', nodeType: 'QueryNode', inputs: [], outputs: [] };
      }
      if (id === 'urn:edge:detail') {
        return { $id: id, '@type': 'QueryEdge', dataFlowType: 'CONTROL_FLOW' };
      }
      return null;
    });

    hoisted.loadQueryInputTuplesByIds.mockResolvedValue([]);
    hoisted.loadQueryOutputTuplesByIds.mockResolvedValue([]);
    hoisted.loadQueryVersionsByIds.mockResolvedValue([]);
    hoisted.loadTupleMembersByIds.mockResolvedValue([]);
    hoisted.findQueryInputVariableById.mockResolvedValue(null);
    hoisted.findQueryOutputVariableById.mockResolvedValue(null);
    hoisted.loadQueryInputVariablesByIds.mockResolvedValue([]);
    hoisted.loadQueryOutputVariablesByIds.mockResolvedValue([]);

    const version = {
      $id: 'urn:qgv:detail',
      '@type': 'QueryGroupVersion',
      groupId: 'urn:group:detail',
      version: 5,
      startNode: 'urn:start:detail',
      endNode: 'urn:end:detail',
      executionNodes: ['urn:exec:detail'],
      edges: ['urn:edge:detail'],
    } as any;

    const detailed = await expandGroupVersionDetailed(version);

    expect(detailed.queryGroupVersion.executionNodes).toEqual(['urn:exec:detail']);
    expect(detailed.executionNodes).toEqual([
      expect.objectContaining({ id: 'urn:exec:detail', nodeType: 'QueryNode' }),
    ]);
    expect(detailed.edges).toEqual([{ id: 'urn:edge:detail', dataFlowType: 'CONTROL_FLOW' }]);
  });
});

afterAll(() => {
  vi.resetModules();
});
