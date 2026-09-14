
import { vi } from 'vitest';
import { findEndNodeById, loadEndNodesByIds } from '../../src/persistence/utils/EndNodeUtils.js';

// In-memory LDKit lens for this suite
vi.mock('../../src/persistence/utils/entityRepository', () => {
  const store = new Map<string, any>();
  const lens = {
    insert: async (obj: any) => { const id = obj.$id ?? obj['@id']; const norm = { ...obj, '@id': id, $id: id }; store.set(id, norm); return norm; },
    findByIri: async (id: string) => store.get(id) ?? null,
    find: async () => Array.from(store.values()),
    update: async (obj: any) => { const id = obj.$id ?? obj['@id']; const ex = store.get(id) ?? { $id: id, '@id': id }; const merged = { ...ex, ...obj, '@id': id, $id: id }; store.set(id, merged); return merged; },
    delete: async (id: string) => { store.delete(id); },
  };
  return { createRepositoryLens: () => lens };
});

describe('EndNodeUtils', () => {
  const testNodeId = 'http://example.org/test-node';
  const anotherNodeId = 'http://example.org/another-node';

  beforeEach(async () => {
    // Clean up test data
    const { EndNodes } = await import('../../src/persistence/utils/EndNodeUtils.js');
    try {
      await EndNodes.delete(testNodeId);
      await EndNodes.delete(anotherNodeId);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should find an end node by ID', async () => {
    const { EndNodes } = await import('../../src/persistence/utils/EndNodeUtils.js');
    await EndNodes.insert({
      $id: testNodeId,
      mediaType: 'application/json',
    });

    const found = await findEndNodeById(testNodeId);
    expect(found).toBeDefined();
    expect(found!.$id).toBe(testNodeId);
  });

  it('should return null if end node not found', async () => {
    const found = await findEndNodeById('http://example.org/non-existent');
    expect(found).toBeNull();
  });

  it('should load multiple end nodes by IDs', async () => {
    const { EndNodes } = await import('../../src/persistence/utils/EndNodeUtils.js');
    await EndNodes.insert({
      $id: testNodeId,
      mediaType: 'application/json',
    });
    await EndNodes.insert({
      $id: anotherNodeId,
      mediaType: 'text/csv',
    });

    const found = await loadEndNodesByIds([testNodeId, anotherNodeId]);
    expect(found.length).toBe(2);
    expect(found.some(n => n.$id === testNodeId)).toBe(true);
    expect(found.some(n => n.$id === anotherNodeId)).toBe(true);
  });

  it('should return an empty array if no end nodes are found', async () => {
    const found = await loadEndNodesByIds(['http://example.org/non-existent']);
    expect(found).toEqual([]);
  });
});
