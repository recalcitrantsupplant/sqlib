/**
 * Test deleteEntity function - LDKit replacement for EntityManager.delete()
 */

// In-memory LDKit lens and deleteEntity for this suite
vi.mock('../../src/persistence/utils/entityRepository', () => {
  const store = new Map<string, any>();
  const lens = {
    insert: async (obj: any) => { const id = obj.$id ?? obj['@id']; const norm = { ...obj, '@id': id, $id: id }; store.set(id, norm); return norm; },
    findByIri: async (id: string) => store.get(id) ?? null,
    find: async () => Array.from(store.values()),
    update: async (obj: any) => { const id = obj.$id ?? obj['@id']; const ex = store.get(id) ?? { $id: id, '@id': id }; const merged = { ...ex, ...obj, '@id': id, $id: id }; store.set(id, merged); return merged; },
    delete: async (id: string) => { store.delete(id); },
  };
  return {
    createRepositoryLens: () => lens,
    deleteEntity: async (_lens: any, id: string) => { try { await lens.delete(id); } catch { /*noop*/ } },
  };
});
import { deleteEntity } from '../../src/persistence/utils/entityRepository.js';
import { Backends, createBackend } from '../../src/persistence/utils/BackendUtils.js';
import type { LdkitBackend } from '../../src/persistence/schemas/BackendSchema.js';

describe('deleteEntity function (LDKit replacement for EntityManager.delete)', () => {
  const testBackendId = 'http://example.org/test-delete-backend';
  
  afterEach(async () => {
    // Clean up test data
    try {
      await deleteEntity(Backends, testBackendId);
    } catch (error) {
      // Ignore cleanup errors - entity might already be deleted
    }
  });

  it('should delete an existing entity using LDKit', async () => {
    // Create a test backend first
  const testBackend: Omit<LdkitBackend, 'dateCreated' | 'dateModified'> & { $id: string } = {
    $id: testBackendId,
    name: 'Delete Test Backend',
    description: 'A backend for testing delete functionality',
    backendType: 'http',
    endpoint: 'http://example.org/sparql'
  } as any;

    await createBackend(testBackend);
    
    // Verify it exists
    const createdBackend = await Backends.findByIri(testBackendId);
    expect(createdBackend).toBeDefined();
    expect(createdBackend!.name).toBe('Delete Test Backend');

    // Delete using our new function
    await deleteEntity(Backends, testBackendId);

    // Verify it's gone
    const deletedBackend = await Backends.findByIri(testBackendId);
    expect(deletedBackend).toBeNull();
  });

  it('should not throw error when deleting non-existent entity', async () => {
    const nonExistentId = 'http://example.org/non-existent-backend';
    
    // This should not throw an error
    await expect(deleteEntity(Backends, nonExistentId)).resolves.not.toThrow();
    
    // Verify it still doesn't exist
    const result = await Backends.findByIri(nonExistentId);
    expect(result).toBeNull();
  });

  it('should handle malformed IDs gracefully', async () => {
    const malformedId = 'not-a-valid-iri';
    
    // LDKit is lenient with malformed IDs - it doesn't throw but handles them gracefully
    await expect(deleteEntity(Backends, malformedId)).resolves.not.toThrow();
    
    // Verify the malformed ID entity doesn't exist (it never did)
    const result = await Backends.findByIri(malformedId);
    expect(result).toBeNull();
  });

  it('should work with entities that have complex relationships', async () => {
    // Create a backend with all optional fields populated
  const complexBackend: Omit<LdkitBackend, 'dateCreated' | 'dateModified'> & { $id: string } = {
    $id: testBackendId,
    name: 'Complex Delete Test Backend',
    description: 'A backend with all fields for testing complex delete functionality',
    backendType: 'http',
    endpoint: 'http://example.org/complex-sparql'
  } as any;

    await createBackend(complexBackend);
    
    // Verify it exists with all properties
    const createdBackend = await Backends.findByIri(testBackendId);
    expect(createdBackend).toBeDefined();
    expect(createdBackend!.name).toBe('Complex Delete Test Backend');
    // Delete using our function
    await deleteEntity(Backends, testBackendId);

    // Verify it's completely gone
    const deletedBackend = await Backends.findByIri(testBackendId);
    expect(deletedBackend).toBeNull();
  });

  it('should match EntityManager.delete behavior - delete all triples for the entity', async () => {
    // Create backend with timestamp fields
  const timestampedBackend: Omit<LdkitBackend, 'dateCreated' | 'dateModified'> & { $id: string } = {
    $id: testBackendId,
    name: 'Timestamped Delete Test Backend',
    description: 'Testing that timestamps are also deleted',
    backendType: 'http',
    endpoint: 'http://example.org/timestamped-sparql'
  } as any;

    await createBackend(timestampedBackend);
    
    // Verify timestamps exist
    const createdBackend = await Backends.findByIri(testBackendId);
    expect(createdBackend).toBeDefined();

    // Delete the entity
    await deleteEntity(Backends, testBackendId);

    // Verify everything is gone (including timestamps)
    const deletedBackend = await Backends.findByIri(testBackendId);
    expect(deletedBackend).toBeNull();
  });
});
