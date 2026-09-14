
import { vi } from 'vitest';
import { createQueryNode, findQueryNodesByQuery, findQueryNodesByBackend, updateQueryNode, deleteQueryNode, findQueryNodesByGroup } from '../../src/persistence/utils/QueryNodeUtils.js';

// Mock dependencies
vi.mock('../../src/persistence/utils/entityRepository.js', () => {
  const store = new Map<string, any>();
  const lens = {
    insert: async (obj: any) => { const id = obj.$id ?? obj['@id']; const norm = { ...obj, '@id': id, $id: id }; store.set(id, norm); return norm; },
    findByIri: async (id: string) => store.get(id) ?? null,
    find: async () => Array.from(store.values()),
    update: async (obj: any) => { const id = obj.$id ?? obj['@id']; const ex = store.get(id) ?? { $id: id, '@id': id }; const merged = { ...ex, ...obj, '@id': id, $id: id }; store.set(id, merged); return merged; },
    delete: async (id: string) => { store.delete(id); },
    _store: store,
  };
  return { createRepositoryLens: () => lens };
});

vi.mock('../../src/persistence/utils/QueryGroupVersionUtils.js', () => ({
  listVersionsForGroup: vi.fn(),
}));

describe('QueryNodeUtils', () => {
  const testNodeId1 = 'http://example.org/test-node-1';
  const testNodeId2 = 'http://example.org/test-node-2';
  const testQueryId = 'http://example.org/test-query';
  const testBackendId = 'http://example.org/test-backend';

  beforeEach(async () => {
    const { QueryNodes } = await import('../../src/persistence/utils/QueryNodeUtils.js');
    (QueryNodes as any)._store.clear();
    vi.clearAllMocks();
  });

  it('should create a query node', async () => {
    await createQueryNode({
      $id: testNodeId1,
      queryId: testQueryId,
      backendId: testBackendId,
    });
    const { QueryNodes } = await import('../../src/persistence/utils/QueryNodeUtils.js');
    const found = await QueryNodes.findByIri(testNodeId1);
    expect(found).toBeDefined();
    expect(found!.queryId).toBe(testQueryId);
  });

  it('should find query nodes by query', async () => {
    await createQueryNode({
      $id: testNodeId1,
      queryId: testQueryId,
      backendId: testBackendId,
    });

    const found = await findQueryNodesByQuery(testQueryId);
    expect(found.length).toBe(1);
    expect(found[0].$id).toBe(testNodeId1);
  });

  it('should find query nodes by backend', async () => {
    await createQueryNode({
      $id: testNodeId1,
      queryId: testQueryId,
      backendId: testBackendId,
    });

    const found = await findQueryNodesByBackend(testBackendId);
    expect(found.length).toBe(1);
    expect(found[0].$id).toBe(testNodeId1);
  });

  it('should update a query node', async () => {
    await createQueryNode({
      $id: testNodeId1,
      queryId: testQueryId,
      backendId: testBackendId,
    });
    await updateQueryNode(testNodeId1, { queryId: 'http://example.org/updated-query' });
    const { QueryNodes } = await import('../../src/persistence/utils/QueryNodeUtils.js');
    const found = await QueryNodes.findByIri(testNodeId1);
    expect(found).not.toBeNull();
    expect(found!.queryId).toBe('http://example.org/updated-query');
  });

  it('should delete a query node', async () => {
    await createQueryNode({
      $id: testNodeId1,
      queryId: testQueryId,
      backendId: testBackendId,
    });
    await deleteQueryNode(testNodeId1);
    const { QueryNodes } = await import('../../src/persistence/utils/QueryNodeUtils.js');
    const found = await QueryNodes.findByIri(testNodeId1);
    expect(found).toBeNull();
  });

  it('should find query nodes by group', async () => {
    await createQueryNode({
      $id: testNodeId1,
      queryId: testQueryId,
      backendId: testBackendId,
    });
    const { listVersionsForGroup } = await import('../../src/persistence/utils/QueryGroupVersionUtils.js');
    (listVersionsForGroup as any).mockResolvedValue([
      { executionNodes: [testNodeId1] },
    ]);

    const found = await findQueryNodesByGroup('http://example.org/test-group');
    expect(found.length).toBe(1);
    expect(found[0].$id).toBe(testNodeId1);
  });
});
