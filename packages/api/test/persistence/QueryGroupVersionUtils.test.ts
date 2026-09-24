
import { createQueryGroupVersion, findQueryGroupVersionById, findAllQueryGroupVersions, listVersionsForGroup } from '../../src/persistence/utils/QueryGroupVersionUtils.js';
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

describe('QueryGroupVersionUtils', () => {
  const testGroupId = 'http://example.org/test-group';
  const testVersionId1 = 'http://example.org/test-group/v1';
  const testVersionId2 = 'http://example.org/test-group/v2';

  beforeEach(async () => {
    repositoryLens._store.clear();
  });

  it('should create and find a query group version', async () => {
    await createQueryGroupVersion({ $id: testVersionId1, isPartOf: testGroupId, version: 1 });
    const found = await findQueryGroupVersionById(testVersionId1);
    expect(found).toBeDefined();
    expect(found!.version).toBe(1);
  });

  it('should list versions for a group', async () => {
    await createQueryGroupVersion({ $id: testVersionId1, isPartOf: testGroupId, version: 1 });
    await createQueryGroupVersion({ $id: testVersionId2, isPartOf: testGroupId, version: 2 });
    await createQueryGroupVersion({ $id: 'http://example.org/another-group/v1', isPartOf: 'http://example.org/another-group', version: 1 });

    const versions = await listVersionsForGroup(testGroupId);
    expect(versions.length).toBe(2);
    expect(versions[0].version).toBe(1);
    expect(versions[1].version).toBe(2);
  });

  it('should find all query group versions', async () => {
    await createQueryGroupVersion({ $id: testVersionId1, isPartOf: testGroupId, version: 1 });
    await createQueryGroupVersion({ $id: testVersionId2, isPartOf: testGroupId, version: 2 });

    const all = await findAllQueryGroupVersions();
    expect(all.length).toBe(2);
  });

  it('preserves optional collection fields when present at creation', async () => {
    const arraysVersionId = 'http://example.org/test-group/v-arrays';
    await createQueryGroupVersion({
      $id: arraysVersionId,
      isPartOf: testGroupId,
      version: 3,
      executionNodes: ['urn:node:1', 'urn:node:2'],
      edges: ['urn:edge:1'],
      startNode: 'urn:start:1',
      endNode: 'urn:end:1',
    } as any);

    const stored = await findQueryGroupVersionById(arraysVersionId);
    expect(stored).toBeTruthy();
    expect(stored!.executionNodes).toEqual(['urn:node:1', 'urn:node:2']);
    expect(stored!.edges).toEqual(['urn:edge:1']);
    expect(stored!.startNode).toBe('urn:start:1');
    expect(stored!.endNode).toBe('urn:end:1');
  });
});
