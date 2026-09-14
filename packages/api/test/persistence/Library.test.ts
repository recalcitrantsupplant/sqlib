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
import { createRepositoryLens } from '../../src/persistence/utils/entityRepository.js';
import { LibrarySchema, LdkitLibrary } from '../../src/persistence/schemas/LibrarySchema.js';
import { randomUUID } from 'crypto';

describe('Library Persistence', () => {
  const Libraries = createRepositoryLens(LibrarySchema);

  test('should create and find a library', async () => {
    const libraryId = `urn:sqlib:library:${randomUUID().replace(/-/g, '')}`;
    const newLibrary = {
      $id: libraryId,
      name: 'Test Library',
    };

    await Libraries.insert(newLibrary);
    const foundLibrary = await Libraries.findByIri(libraryId);

    expect(foundLibrary).not.toBeNull();
    expect(foundLibrary?.$id).toBe(libraryId);
    expect(foundLibrary?.name).toBe('Test Library');

    // Cleanup
    await Libraries.delete(libraryId);
  });
});
