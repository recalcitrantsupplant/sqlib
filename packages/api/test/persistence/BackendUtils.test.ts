/**
 * Test BackendUtils LDKit integration
 */

import { Backends, findBackendByName, findBackendsByType, createBackend, updateBackend } from '../../src/persistence/utils/BackendUtils.js';
import { BackendTypeIri } from '../../src/persistence/schemas/BackendSchema.js';
import { overrideRepositoryLenses } from '../../src/persistence/utils/entityRepository.js';

// In-memory LDKit lens for this suite
const repositoryLens = (() => {
  const store = new Map<string, any>();
  const lens = {
    insert: async (obj: any) => { const id = obj.$id ?? obj['@id']; const norm = { ...obj, '@id': id, $id: id }; store.set(id, norm); return norm; },
    findByIri: async (id: string) => store.get(id) ?? null,
    find: async () => Array.from(store.values()),
    update: async (obj: any) => {
      const id = obj.$id ?? obj['@id'];
      const ex = store.get(id) ?? { $id: id, '@id': id };
      const merged = { ...ex };
      // Explicitly handle all properties, including undefined values
      for (const [key, value] of Object.entries(obj)) {
        if (value === undefined) {
          delete merged[key];
        } else {
          merged[key] = value;
        }
      }
      // Always preserve ID fields
      merged['@id'] = id;
      merged.$id = id;
      store.set(id, merged);
      return merged;
    },
    delete: async (id: string) => { store.delete(id); },
  };
  return lens;
})();
overrideRepositoryLenses(() => repositoryLens);

const SPARQL_ENDPOINT = 'http://localhost:3031/testing123'; // This constant is not used in the mocked environment
const HTTP_TYPE = BackendTypeIri.http;

describe('BackendUtils (LDKit Integration)', () => {
  const testBackendId = 'http://example.org/test-backend';
  const anotherBackendId = 'http://example.org/another-backend';

  afterEach(async () => {
    // Clean up test data
    try {
      await Backends.delete(testBackendId);
      await Backends.delete(anotherBackendId);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should create and find a backend', async () => {
    // Create using LDKit
    await createBackend({
      $id: testBackendId,
      name: 'Test Backend',
      description: 'A test SPARQL backend',
      backendType: 'http',
      endpoint: 'http://example.org/sparql'
    } as any);

    const backend = (await Backends.findByIri(testBackendId))!;

    expect(backend.name).toBe('Test Backend');
    expect(backend.backendType).toBe(HTTP_TYPE);
    expect(backend.endpoint).toBe('http://example.org/sparql');
    expect(backend.dateCreated).toBeDefined();
    expect(backend.dateModified).toBeDefined();

    // Find it back
    const found = await Backends.findByIri(testBackendId);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Test Backend');
    expect(found!.description).toBe('A test SPARQL backend');
  });

  it('should create a backend with optional fields', async () => {
    await createBackend({
      $id: testBackendId,
      name: 'Backend with Auth',
      backendType: 'http',
      endpoint: 'http://auth.example.org/sparql'
    } as any);
  });

  it('should find backend by name', async () => {
    // Create backend
    await createBackend({
      $id: testBackendId,
      name: 'Unique Backend Name',
      backendType: 'http',
      endpoint: 'http://test.example.org/sparql'
    } as any);

    // Find by name
    const found = await findBackendByName('Unique Backend Name');
    expect(found).toBeDefined();
    expect(found!.$id).toBe(testBackendId);
    expect(found!.backendType).toBe(HTTP_TYPE);
  });

  it('should return null if backend name not found', async () => {
    const found = await findBackendByName('Non Existent Name');
    expect(found).toBeNull();
  });

  it('should find backends by type', async () => {
    // Create backend
    await createBackend({
      $id: testBackendId,
      name: 'HTTP Backend',
      backendType: 'http',
      endpoint: 'http://test.example.org/sparql'
    } as any);
    await createBackend({
      $id: anotherBackendId,
      name: 'Another HTTP Backend',
      backendType: 'http',
      endpoint: 'http://another.example.org/sparql'
    } as any);

    // Find by type
    const foundHttp = await findBackendsByType('http');
    expect(foundHttp.length).toBe(2);
    expect(foundHttp.some(b => b.$id === testBackendId)).toBe(true);
    expect(foundHttp.some(b => b.$id === anotherBackendId)).toBe(true);
  });

  it('should return empty array if no backends of type found', async () => {
    const found = await findBackendsByType('oxigraphEphemeral');
    expect(found).toEqual([]);
  });

  it('should reject deprecated oxigraph backendType', () => {
    // oxigraph is not in the allowed enum and throws synchronously during validation
    expect(() => createBackend({
      $id: testBackendId,
      name: 'Deprecated Backend',
      backendType: 'oxigraph',
      endpoint: 'http://deprecated.example.org/sparql'
    } as any)).toThrow('Unsupported backend type: oxigraph');
  });

  it('should validate required fields for createBackend', async () => {
    // Missing name - validated by EntityUtils.create (async)
    await expect(createBackend({
      $id: testBackendId,
      backendType: 'http',
      endpoint: 'http://test.example.org/sparql'
    } as any)).rejects.toThrow('Backend requires name and backendType');

    // Missing backendType - validation throws synchronously before async call
    expect(() => createBackend({
      $id: testBackendId,
      name: 'Test Backend',
      endpoint: 'http://test.example.org/sparql'
    } as any)).toThrow('Backend requires name and backendType');
  });

  it('accepts a backend with no endpoint, which the schema calls optional', async () => {
    // This rejected until issue #65. `BackendUtils` carried a `requiredFields`
    // override demanding an `endpoint` of every backend, although
    // `BackendSchema` marks it `@optional` because an oxigraphEphemeral backend
    // has none — and the route contract requires one only when `backendType` is
    // `http`. The override was the one statement of that rule that disagreed
    // with the other two, so it came off and this path follows the schema.
    await expect(createBackend({
      $id: testBackendId,
      name: 'Test Backend',
      backendType: 'http'
    } as any)).resolves.toBeUndefined();
  });

  describe('updateBackend', () => {
    beforeEach(async () => {
      await createBackend({
        $id: testBackendId,
        name: 'Original Name',
        description: 'Original Description',
        backendType: 'http',
        endpoint: 'http://original.example.org/sparql'
      } as any);
    });

    it('should update existing fields of a backend', async () => {
      // Get the original backend to compare timestamps
      const original = await Backends.findByIri(testBackendId);
      const originalDateCreated = original!.dateCreated;
      
      // Wait a small amount to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 10));
      
      await updateBackend(testBackendId, {
        name: 'Updated Name',
        endpoint: 'http://updated.example.org/sparql'
      });

      const updated = (await Backends.findByIri(testBackendId))!;

      expect(updated).toBeDefined();
      expect(updated!.$id).toBe(testBackendId);
      expect(updated!.name).toBe('Updated Name');
      expect(updated!.endpoint).toBe('http://updated.example.org/sparql');
      expect(updated!.description).toBe('Original Description'); // Should remain unchanged
      expect(updated!.dateModified).toBeDefined();
      expect(updated!.dateCreated).toBe(originalDateCreated); // Should remain unchanged
      expect(updated!.dateModified).not.toBe(originalDateCreated);

      const found = await Backends.findByIri(testBackendId);
      expect(found!.name).toBe('Updated Name');
      expect(found!.endpoint).toBe('http://updated.example.org/sparql');
    });

    it('should update optional fields including setting them to undefined/null', async () => {
      await updateBackend(testBackendId, {
        description: undefined // Set to undefined
      });

      const updated = (await Backends.findByIri(testBackendId))!;

      expect(updated).toBeDefined();
      expect(updated!.description).toBeUndefined();

      const found = await Backends.findByIri(testBackendId);
      expect(found!.description).toBeUndefined();
    });

    it('should return null if backend to update does not exist', async () => {
      await updateBackend('http://nonexistent.org/backend', { name: 'New Name' });
      const found = await Backends.findByIri('http://nonexistent.org/backend');
      expect(found).toBeNull();
    });
  });
});
