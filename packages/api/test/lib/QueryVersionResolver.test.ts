import { describe, it, expect, beforeEach, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  coordinatorGet: vi.fn(),
  loadLimitParametersByIds: vi.fn(),
  loadOffsetParametersByIds: vi.fn(),
  loadQueryInputTuplesByIds: vi.fn(),
  loadTupleMembersByIds: vi.fn(),
  loadQueryOutputTuplesByIds: vi.fn(),
  loadQueryInputsByIds: vi.fn(),
  loadQueryOutputsByIds: vi.fn(),
  // Repository lens mocks that MemoryCacheManager needs
  LimitParameters: { insert: vi.fn(), update: vi.fn(), delete: vi.fn(), find: vi.fn(), findByIri: vi.fn() },
  OffsetParameters: { insert: vi.fn(), update: vi.fn(), delete: vi.fn(), find: vi.fn(), findByIri: vi.fn() },
  QueryInputs: { insert: vi.fn(), update: vi.fn(), delete: vi.fn(), find: vi.fn(), findByIri: vi.fn() },
  QueryOutputs: { insert: vi.fn(), update: vi.fn(), delete: vi.fn(), find: vi.fn(), findByIri: vi.fn() },
  QueryInputTuples: { insert: vi.fn(), update: vi.fn(), delete: vi.fn(), find: vi.fn(), findByIri: vi.fn() },
  QueryOutputTuples: { insert: vi.fn(), update: vi.fn(), delete: vi.fn(), find: vi.fn(), findByIri: vi.fn() },
  TupleMembers: { insert: vi.fn(), update: vi.fn(), delete: vi.fn(), find: vi.fn(), findByIri: vi.fn() },
}));

describe('QueryVersionResolver', () => {
  let expandQueryVersion: typeof import('../../src/lib/QueryVersionResolver.js').expandQueryVersion;

  beforeEach(async () => {
    vi.resetModules();
    hoisted.coordinatorGet.mockReset();
    hoisted.loadLimitParametersByIds.mockReset();
    hoisted.loadOffsetParametersByIds.mockReset();
    hoisted.loadQueryInputTuplesByIds.mockReset();
    hoisted.loadTupleMembersByIds.mockReset();
    hoisted.loadQueryOutputTuplesByIds.mockReset();

    vi.doMock('../../src/lib/CacheCoordinatorProvider.js', () => ({
      getCacheCoordinator: () => ({
        get: hoisted.coordinatorGet,
      }),
    }));
    vi.doMock('../../src/persistence/utils/LimitParameterUtils.js', () => ({
      loadLimitParametersByIds: hoisted.loadLimitParametersByIds,
      LimitParameters: hoisted.LimitParameters
    }));
    vi.doMock('../../src/persistence/utils/OffsetParameterUtils.js', () => ({
      loadOffsetParametersByIds: hoisted.loadOffsetParametersByIds,
      OffsetParameters: hoisted.OffsetParameters
    }));
    vi.doMock('../../src/persistence/utils/QueryInputTupleUtils.js', () => ({
      loadQueryInputTuplesByIds: hoisted.loadQueryInputTuplesByIds,
      QueryInputTuples: hoisted.QueryInputTuples
    }));
    vi.doMock('../../src/persistence/utils/TupleMemberUtils.js', () => ({
      loadTupleMembersByIds: hoisted.loadTupleMembersByIds,
      TupleMembers: hoisted.TupleMembers
    }));
    vi.doMock('../../src/persistence/utils/QueryInputUtils.js', () => ({
      loadQueryInputsByIds: hoisted.loadQueryInputsByIds,
      QueryInputs: hoisted.QueryInputs
    }));
    vi.doMock('../../src/persistence/utils/QueryOutputUtils.js', () => ({
      loadQueryOutputsByIds: hoisted.loadQueryOutputsByIds,
      QueryOutputs: hoisted.QueryOutputs
    }));
    vi.doMock('../../src/persistence/utils/QueryOutputTupleUtils.js', () => ({
      loadQueryOutputTuplesByIds: hoisted.loadQueryOutputTuplesByIds,
      QueryOutputTuples: hoisted.QueryOutputTuples
    }));

    ({ expandQueryVersion } = await import('../../src/lib/QueryVersionResolver.js'));
  });

  afterEach(() => {
    vi.unmock('../../src/lib/CacheCoordinatorProvider.js');
    vi.unmock('../../src/persistence/utils/LimitParameterUtils.js');
    vi.unmock('../../src/persistence/utils/OffsetParameterUtils.js');
    vi.unmock('../../src/persistence/utils/QueryInputTupleUtils.js');
    vi.unmock('../../src/persistence/utils/TupleMemberUtils.js');
    vi.unmock('../../src/persistence/utils/QueryInputUtils.js');
    vi.unmock('../../src/persistence/utils/QueryOutputUtils.js');
    vi.unmock('../../src/persistence/utils/QueryOutputTupleUtils.js');
  });
  it('expands linked resources for query version', async () => {
    hoisted.loadLimitParametersByIds.mockResolvedValue([{ $id: 'urn:limit:1', name: 'Limit' }]);
    hoisted.loadOffsetParametersByIds.mockResolvedValue([{ $id: 'urn:offset:1', name: 'Offset' }]);
    hoisted.loadQueryInputTuplesByIds.mockResolvedValue([
      { $id: 'urn:tuple:input:1', memberEntries: ['urn:member:1'] },
    ]);
    hoisted.loadTupleMembersByIds.mockResolvedValue([
      { $id: 'urn:member:1', variable: 'urn:input:1', position: 0 },
    ]);
    hoisted.loadQueryOutputTuplesByIds.mockResolvedValue([{ $id: 'urn:tuple:output:1', name: 'All query outputs' }]);

    // Mock cacheCoordinator.get to return appropriate types for inferred outputs
    hoisted.coordinatorGet.mockImplementation((id: string) => {
      if (id === 'urn:tuple:output:1') {
        return { $id: 'urn:tuple:output:1', '@type': 'QueryOutputTuple', name: 'All query outputs' };
      }
      return null;
    });

    const version = {
      $id: 'urn:qv:1',
      '@type': 'QueryVersion',
      limitParameters: ['urn:limit:1'],
      offsetParameters: ['urn:offset:1'],
      inferredInputs: ['urn:tuple:input:1'],
      inferredOutputs: ['urn:tuple:output:1'],
    } as any;

    const expanded = await expandQueryVersion(version);

    expect(expanded.queryVersion).toEqual({ id: 'urn:qv:1', limitParameters: ['urn:limit:1'], offsetParameters: ['urn:offset:1'], inferredInputs: ['urn:tuple:input:1'], inferredOutputs: ['urn:tuple:output:1'] });
    expect(expanded.limitParameters).toEqual([{ id: 'urn:limit:1', name: 'Limit' }]);
    expect(expanded.offsetParameters).toEqual([{ id: 'urn:offset:1', name: 'Offset' }]);
    expect(expanded.inputTuples).toEqual([{ id: 'urn:tuple:input:1', memberEntries: ['urn:member:1'] }]);
    expect(expanded.tupleMembers).toEqual([{ id: 'urn:member:1', variable: 'urn:input:1', position: 0 }]);
    expect(expanded.outputTuples).toEqual([{ id: 'urn:tuple:output:1', name: 'All query outputs' }]);
  });
});

afterAll(() => {
  vi.unmock('../../src/persistence/utils/LimitParameterUtils.js');
  vi.unmock('../../src/persistence/utils/OffsetParameterUtils.js');
  vi.unmock('../../src/persistence/utils/QueryInputTupleUtils.js');
  vi.unmock('../../src/persistence/utils/TupleMemberUtils.js');
  vi.unmock('../../src/persistence/utils/QueryOutputTupleUtils.js');
  vi.resetModules();
});
