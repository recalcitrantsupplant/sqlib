
import { vi } from 'vitest';
import { findStartNodeById, loadStartNodesByIds } from '../../src/persistence/utils/StartNodeUtils.js';

// In-memory LDKit lens for this suite
vi.mock('../../src/persistence/utils/entityRepository', () => {
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

describe('StartNodeUtils', () => {
  const testNodeId1 = 'http://example.org/test-node-1';
  const testNodeId2 = 'http://example.org/test-node-2';

  beforeEach(async () => {
    const { StartNodes } = await import('../../src/persistence/utils/StartNodeUtils.js');
    (StartNodes as any)._store.clear();
  });

  it('should find a start node by ID', async () => {
    const { StartNodes } = await import('../../src/persistence/utils/StartNodeUtils.js');
    await StartNodes.insert({ $id: testNodeId1 });
    const found = await findStartNodeById(testNodeId1);
    expect(found).toBeDefined();
    expect(found!.$id).toBe(testNodeId1);
  });

  it('should load multiple start nodes by IDs', async () => {
    const { StartNodes } = await import('../../src/persistence/utils/StartNodeUtils.js');
    await StartNodes.insert({ $id: testNodeId1 });
    await StartNodes.insert({ $id: testNodeId2 });

    const nodes = await loadStartNodesByIds([testNodeId1, testNodeId2]);
    expect(nodes.length).toBe(2);
  });
});
