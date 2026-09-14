
import { vi } from 'vitest';
import { createQueryVersion, updateQueryVersion, deleteQueryVersion, findAllQueryVersions, findQueryVersionById, listVersionsForQuery } from '../../src/persistence/utils/QueryVersionUtils.js';

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

describe('QueryVersionUtils', () => {
  const testQueryId = 'http://example.org/test-query';
  const testVersionId1 = 'http://example.org/test-query/v1';
  const testVersionId2 = 'http://example.org/test-query/v2';

  beforeEach(async () => {
    const { QueryVersions } = await import('../../src/persistence/utils/QueryVersionUtils.js');
    (QueryVersions as any)._store.clear();
  });

  it('should create and find a query version', async () => {
    await createQueryVersion({ $id: testVersionId1, isPartOf: testQueryId, version: 1, queryString: 'SELECT * WHERE { ?s ?p ?o }' });
    const found = await findQueryVersionById(testVersionId1);
    expect(found).toBeDefined();
    expect(found!.version).toBe(1);
  });

  it('should list versions for a query', async () => {
    await createQueryVersion({ $id: testVersionId1, isPartOf: testQueryId, version: 1, queryString: 'SELECT * WHERE { ?s ?p ?o }' });
    await createQueryVersion({ $id: testVersionId2, isPartOf: testQueryId, version: 2, queryString: 'SELECT * WHERE { ?s ?p ?o }' });
    await createQueryVersion({ $id: 'http://example.org/another-query/v1', isPartOf: 'http://example.org/another-query', version: 1, queryString: 'SELECT * WHERE { ?s ?p ?o }' });

    const versions = await listVersionsForQuery(testQueryId);
    expect(versions.length).toBe(2);
    expect(versions[0].version).toBe(1);
    expect(versions[1].version).toBe(2);
  });

  it('should find all query versions', async () => {
    await createQueryVersion({ $id: testVersionId1, isPartOf: testQueryId, version: 1, queryString: 'SELECT * WHERE { ?s ?p ?o }' });
    await createQueryVersion({ $id: testVersionId2, isPartOf: testQueryId, version: 2, queryString: 'SELECT * WHERE { ?s ?p ?o }' });

    const all = await findAllQueryVersions();
    expect(all.length).toBe(2);
  });

  it('should update a query version', async () => {
    await createQueryVersion({ $id: testVersionId1, isPartOf: testQueryId, version: 1, queryString: 'SELECT * WHERE { ?s ?p ?o }' });
    await updateQueryVersion(testVersionId1, { comment: 'Updated comment' });
    const found = await findQueryVersionById(testVersionId1);
    expect(found!.comment).toBe('Updated comment');
  });

  it('should delete a query version', async () => {
    await createQueryVersion({ $id: testVersionId1, isPartOf: testQueryId, version: 1, queryString: 'SELECT * WHERE { ?s ?p ?o }' });
    await deleteQueryVersion(testVersionId1);
    const found = await findQueryVersionById(testVersionId1);
    expect(found).toBeNull();
  });
});
