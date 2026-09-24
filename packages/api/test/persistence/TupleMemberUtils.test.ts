
import { findTupleMemberById, loadTupleMembersByIds } from '../../src/persistence/utils/TupleMemberUtils.js';
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

describe('TupleMemberUtils', () => {
  const testMemberId1 = 'http://example.org/test-member-1';
  const testMemberId2 = 'http://example.org/test-member-2';

  beforeEach(async () => {
    const { TupleMembers } = await import('../../src/persistence/utils/TupleMemberUtils.js');
    repositoryLens._store.clear();
  });

  it('should find a tuple member by ID', async () => {
    const { TupleMembers } = await import('../../src/persistence/utils/TupleMemberUtils.js');
    await TupleMembers.insert({ $id: testMemberId1, position: 0, variable: 'http://example.org/var' });
    const found = await findTupleMemberById(testMemberId1);
    expect(found).toBeDefined();
    expect(found!.position).toBe(0);
  });

  it('should load multiple tuple members by IDs', async () => {
    const { TupleMembers } = await import('../../src/persistence/utils/TupleMemberUtils.js');
    await TupleMembers.insert({ $id: testMemberId1, position: 0, variable: 'http://example.org/var1' });
    await TupleMembers.insert({ $id: testMemberId2, position: 1, variable: 'http://example.org/var2' });

    const members = await loadTupleMembersByIds([testMemberId1, testMemberId2]);
    expect(members.length).toBe(2);
  });
});
