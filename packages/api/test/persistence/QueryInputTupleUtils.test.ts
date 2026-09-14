
import { vi } from 'vitest';
import { createQueryInputTuple, findQueryInputTupleById, loadQueryInputTuplesByIds, updateQueryInputTuple, deleteQueryInputTuple } from '../../src/persistence/utils/QueryInputTupleUtils.js';

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

describe('QueryInputTupleUtils', () => {
  const testTupleId1 = 'http://example.org/test-tuple-1';
  const testTupleId2 = 'http://example.org/test-tuple-2';

  beforeEach(async () => {
    const { QueryInputTuples } = await import('../../src/persistence/utils/QueryInputTupleUtils.js');
    (QueryInputTuples as any)._store.clear();
  });

  it('should create and find a query input tuple', async () => {
    await createQueryInputTuple({ $id: testTupleId1, name: 'Test Tuple', memberEntries: [] });
    const found = await findQueryInputTupleById(testTupleId1);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Test Tuple');
  });

  it('should load multiple query input tuples by IDs', async () => {
    await createQueryInputTuple({ $id: testTupleId1, name: 'Test Tuple 1', memberEntries: [] });
    await createQueryInputTuple({ $id: testTupleId2, name: 'Test Tuple 2', memberEntries: [] });

    const tuples = await loadQueryInputTuplesByIds([testTupleId1, testTupleId2]);
    expect(tuples.length).toBe(2);
  });

  it('should update a query input tuple', async () => {
    await createQueryInputTuple({ $id: testTupleId1, name: 'Original Name', memberEntries: [] });
    await updateQueryInputTuple(testTupleId1, { name: 'Updated Name' });
    const found = await findQueryInputTupleById(testTupleId1);
    expect(found!.name).toBe('Updated Name');
  });

  it('should delete a query input tuple', async () => {
    await createQueryInputTuple({ $id: testTupleId1, name: 'Test Tuple', memberEntries: [] });
    await deleteQueryInputTuple(testTupleId1);
    const found = await findQueryInputTupleById(testTupleId1);
    expect(found).toBeNull();
  });
});
