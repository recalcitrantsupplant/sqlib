
import { findQueryOutputTupleById, loadQueryOutputTuplesByIds } from '../../src/persistence/utils/QueryOutputTupleUtils.js';
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
    _store: store,
  };
  return lens;
})();
overrideRepositoryLenses(() => repositoryLens);

describe('QueryOutputTupleUtils', () => {
  const testTupleId1 = 'http://example.org/test-tuple-1';
  const testTupleId2 = 'http://example.org/test-tuple-2';

  beforeEach(async () => {
    const { QueryOutputTuples } = await import('../../src/persistence/utils/QueryOutputTupleUtils.js');
    repositoryLens._store.clear();
  });

  it('should find a query output tuple by ID', async () => {
    const { QueryOutputTuples } = await import('../../src/persistence/utils/QueryOutputTupleUtils.js');
    await QueryOutputTuples.insert({ $id: testTupleId1, name: 'Test Tuple' });
    const found = await findQueryOutputTupleById(testTupleId1);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Test Tuple');
  });

  it('should load multiple query output tuples by IDs', async () => {
    const { QueryOutputTuples } = await import('../../src/persistence/utils/QueryOutputTupleUtils.js');
    await QueryOutputTuples.insert({ $id: testTupleId1, name: 'Test Tuple 1' });
    await QueryOutputTuples.insert({ $id: testTupleId2, name: 'Test Tuple 2' });

    const tuples = await loadQueryOutputTuplesByIds([testTupleId1, testTupleId2]);
    expect(tuples.length).toBe(2);
  });
});
