
import { createQuery, updateQuery, deleteQuery, findAllQueries, findQueryById, findQueryByName } from '../../src/persistence/utils/QueryUtils.js';
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

describe('QueryUtils', () => {
  const testQueryId1 = 'http://example.org/test-query-1';
  const testQueryId2 = 'http://example.org/test-query-2';

  beforeEach(async () => {
    repositoryLens._store.clear();
  });

  it('should create and find a query', async () => {
    await createQuery({
      $id: testQueryId1, name: 'Test Query',
      isPartOf: []
    });
    const found = await findQueryById(testQueryId1);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Test Query');
  });

  it('should find a query by name', async () => {
    await createQuery({
      $id: testQueryId1, name: 'Test Query',
      isPartOf: []
    });
    const found = await findQueryByName('Test Query');
    expect(found).toBeDefined();
    expect(found!.$id).toBe(testQueryId1);
  });

  it('should find all queries', async () => {
    await createQuery({
      $id: testQueryId1, name: 'Test Query 1',
      isPartOf: []
    });
    await createQuery({
      $id: testQueryId2, name: 'Test Query 2',
      isPartOf: []
    });
    const all = await findAllQueries();
    expect(all.length).toBe(2);
  });

  it('should update a query', async () => {
    await createQuery({
      $id: testQueryId1, name: 'Original Name',
      isPartOf: []
    });
    await updateQuery(testQueryId1, { name: 'Updated Name' });
    const found = await findQueryById(testQueryId1);
    expect(found!.name).toBe('Updated Name');
  });

  it('should delete a query', async () => {
    await createQuery({
      $id: testQueryId1, name: 'Test Query',
      isPartOf: []
    });
    await deleteQuery(testQueryId1);
    const found = await findQueryById(testQueryId1);
    expect(found).toBeNull();
  });
});
