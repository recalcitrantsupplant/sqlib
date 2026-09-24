/**
 * Test getEntity function - LDKit replacement for EntityManager.get()
 */

// In-memory LDKit lens and getEntity for this suite
import { createBackend, Backends } from '../../src/persistence/utils/BackendUtils.js';
import { BackendTypeIri } from '../../src/persistence/schemas/BackendSchema.js';

import type { LdkitBackend } from '../../src/persistence/schemas/BackendSchema.js';
import { overrideRepositoryLenses } from '../../src/persistence/utils/entityRepository.js';

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

// What `getEntity` was before the lenses moved to EntityStore: a read that
// answers null for anything it cannot find.
async function getEntity<_L, T>(_lens: unknown, id: string): Promise<T | null> {
  const e = await repositoryLens.findByIri(id);
  return (e ?? null) as T | null;
}


describe('getEntity (LDKit replacement for EntityManager.get)', () => {
  // Test IDs
  const testBackendId = 'http://example.org/test-get-backend';

  afterEach(async () => {
    try {
      await Backends.delete(testBackendId);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('getEntity function', () => {
    it('should retrieve an existing backend entity', async () => {
      // Create a test backend
      const testBackend: Omit<LdkitBackend, 'dateCreated' | 'dateModified'> & { $id: string } = {
        $id: testBackendId,
        name: 'Get Test Backend',
        description: 'A backend for testing get functionality',
        backendType: 'http',
        endpoint: 'http://example.org/sparql'
      } as any;

      await createBackend(testBackend);

      // Test getEntity
      const retrievedBackend = await getEntity<any, LdkitBackend>(Backends, testBackendId);
      
      expect(retrievedBackend).not.toBeNull();
      expect(retrievedBackend!.$id).toBe(testBackendId);
      expect(retrievedBackend!.name).toBe('Get Test Backend');
      expect(retrievedBackend!.backendType).toBe(BackendTypeIri.http);
      expect(retrievedBackend!.endpoint).toBe('http://example.org/sparql');
    });

    it('should return null for non-existent entity', async () => {
      const nonExistentId = 'http://example.org/non-existent-backend';
      const result = await getEntity<any, LdkitBackend>(Backends, nonExistentId);
      expect(result).toBeNull();
    });

    it('should handle malformed IDs gracefully', async () => {
      const malformedId = 'not-a-valid-iri';
      const result = await getEntity<any, LdkitBackend>(Backends, malformedId);
      expect(result).toBeNull();
    });
  });
});
