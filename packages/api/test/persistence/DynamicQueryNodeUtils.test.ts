
import { findDynamicQueryNodeById, loadDynamicQueryNodesByIds } from '../../src/persistence/utils/DynamicQueryNodeUtils.js';
import { overrideRepositoryLenses } from '../../src/persistence/utils/entityRepository.js';

// In-memory LDKit lens for this suite
const repositoryLens = (() => {
  const store = new Map<string, any>();
  const lens = {
    insert: async (obj: any) => { const id = obj.$id ?? obj['@id']; const norm = { ...obj, '@id': id, $id: id }; store.set(id, norm); return norm; },
    findByIri: async (id: string) => store.get(id) ?? null,
    find: async () => Array.from(store.values()),
    update: async (obj: any) => { const id = obj.$id ?? obj['@id']; const ex = store.get(id) ?? { $id: id, '@id': id }; const merged = { ...ex, ...obj, '@id': id, $id: id }; store.set(id, merged); return merged; },
    delete: async (id: string) => { store.delete(id); },
  };
  return lens;
})();
overrideRepositoryLenses(() => repositoryLens);

describe('DynamicQueryNodeUtils', () => {
  const testNodeId = 'http://example.org/test-node';
  const anotherNodeId = 'http://example.org/another-node';

  beforeEach(async () => {
    // Clean up test data
    const { DynamicQueryNodes } = await import('../../src/persistence/utils/DynamicQueryNodeUtils.js');
    try {
      await DynamicQueryNodes.delete(testNodeId);
      await DynamicQueryNodes.delete(anotherNodeId);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should find a dynamic query node by ID', async () => {
    const { DynamicQueryNodes } = await import('../../src/persistence/utils/DynamicQueryNodeUtils.js');
    await DynamicQueryNodes.insert({
      $id: testNodeId,
      backendId: 'http://example.org/backend',
    });

    const found = await findDynamicQueryNodeById(testNodeId);
    expect(found).toBeDefined();
    expect(found!.$id).toBe(testNodeId);
  });

  it('should return null if dynamic query node not found', async () => {
    const found = await findDynamicQueryNodeById('http://example.org/non-existent');
    expect(found).toBeNull();
  });

  it('should load multiple dynamic query nodes by IDs', async () => {
    const { DynamicQueryNodes } = await import('../../src/persistence/utils/DynamicQueryNodeUtils.js');
    await DynamicQueryNodes.insert({
      $id: testNodeId,
      backendId: 'http://example.org/backend',
    });
    await DynamicQueryNodes.insert({
      $id: anotherNodeId,
      backendId: 'http://example.org/backend2',
    });

    const found = await loadDynamicQueryNodesByIds([testNodeId, anotherNodeId]);
    expect(found.length).toBe(2);
    expect(found.some(n => n.$id === testNodeId)).toBe(true);
    expect(found.some(n => n.$id === anotherNodeId)).toBe(true);
  });

  it('should return an empty array if no dynamic query nodes are found', async () => {
    const found = await loadDynamicQueryNodesByIds(['http://example.org/non-existent']);
    expect(found).toEqual([]);
  });
});
