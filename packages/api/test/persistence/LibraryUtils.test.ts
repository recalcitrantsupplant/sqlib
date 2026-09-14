/**
 * Test LibraryUtils LDKit integration
 */

import { Libraries, findLibraryByName, createLibrary, updateLibrary } from '../../src/persistence/utils/LibraryUtils.js';

// In-memory LDKit lens for this suite
vi.mock('../../src/persistence/utils/entityRepository', () => {
  const store = new Map<string, any>();
  const lens = {
    insert: async (obj: any) => { const id = obj.$id ?? obj['@id']; const norm = { ...obj, '@id': id, $id: id }; store.set(id, norm); return norm; },
    findByIri: async (id: string) => store.get(id) ?? null,
    find: async () => Array.from(store.values()),
    update: async (obj: any) => { await new Promise(r => setTimeout(r, 10)); const id = obj.$id ?? obj['@id']; const ex = store.get(id) ?? { $id: id, '@id': id }; const merged = { ...ex, ...obj, '@id': id, $id: id, dateModified: new Date().toISOString() }; store.set(id, merged); return merged; },
    delete: async (id: string) => { store.delete(id); },
  };
  return { createRepositoryLens: () => lens };
});

const SPARQL_ENDPOINT = 'http://localhost:3031/testing123'; // This constant is not used in the mocked environment

describe('LibraryUtils (LDKit Integration)', () => {
  const testLibraryId = 'http://example.org/test-library';
  const anotherLibraryId = 'http://example.org/another-library';

  beforeEach(async () => {
    // Clean up test data
    try {
      await Libraries.delete(testLibraryId);
      await Libraries.delete(anotherLibraryId);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  afterEach(async () => {
    // Clean up test data
    try {
      await Libraries.delete(testLibraryId);
      await Libraries.delete(anotherLibraryId);
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should create and find a library', async () => {
    // Create using LDKit
    await createLibrary({
      $id: testLibraryId,
      name: 'Test Library',
      description: 'A test library',
      defaultBackend: 'http://example.org/backend'
    });

    const library = (await Libraries.findByIri(testLibraryId))!;

    expect(library.name).toBe('Test Library');
    expect(library.description).toBe('A test library');
    expect(library.defaultBackend).toBe('http://example.org/backend');
    expect(library.dateCreated).toBeDefined();
    expect(library.dateModified).toBeDefined();

    // Find it back
    const found = await Libraries.findByIri(testLibraryId);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Test Library');
  });

  it('should create a library without optional fields', async () => {
    await createLibrary({
      $id: anotherLibraryId,
      name: 'Simple Library',
    });

    const library = (await Libraries.findByIri(anotherLibraryId))!;

    expect(library.name).toBe('Simple Library');
    expect(library.description).toBeUndefined();
    expect(library.defaultBackend).toBeUndefined();
  });

  it('should create a library with explicit $id', async () => {
    await createLibrary({
      $id: 'http://example.org/library-with-dollar-id',
      name: 'Library with $id',
    });

    const library = (await Libraries.findByIri('http://example.org/library-with-dollar-id'))!;

    expect(library.$id).toBe('http://example.org/library-with-dollar-id');
    expect(library.name).toBe('Library with $id');
  });

  it('should find library by name', async () => {
    // Create library
    await createLibrary({
      $id: testLibraryId,
      name: 'Unique Library Name',
      description: 'Testing name search'
    });

    // Find by name
    const found = await findLibraryByName('Unique Library Name');
    expect(found).toBeDefined();
    expect(found!.$id).toBe(testLibraryId);
    expect(found!.description).toBe('Testing name search');
  });

  it('should return null if library name not found', async () => {
    const found = await findLibraryByName('Non Existent Name');
    expect(found).toBeNull();
  });

  it('should update library', async () => {
    // Create library
    await createLibrary({
      $id: testLibraryId,
      name: 'Original Name',
      description: 'Original description',
      defaultBackend: 'http://original.backend'
    });
    const original = (await Libraries.findByIri(testLibraryId))!;

    // Wait a small amount to ensure different timestamp
    await new Promise(resolve => setTimeout(resolve, 1));

    // Update it
    await updateLibrary(testLibraryId, {
      name: 'Updated Name',
      description: 'Updated description',
      defaultBackend: 'http://updated.backend'
    });

    const updated = (await Libraries.findByIri(testLibraryId))!;

    expect(updated).toBeDefined();
    expect(updated!.$id).toBe(testLibraryId);
    expect(updated!.name).toBe('Updated Name');
    expect(updated!.description).toBe('Updated description');
    expect(updated!.defaultBackend).toBe('http://updated.backend');
    expect(updated!.dateModified).toBeDefined();
    expect(updated!.dateModified).not.toBe(original.dateModified);

    const found = await Libraries.findByIri(testLibraryId);
    expect(found!.name).toBe('Updated Name');
    expect(found!.description).toBe('Updated description');
    expect(found!.defaultBackend).toBe('http://updated.backend');
  });

  it('should update optional fields including setting them to undefined/null', async () => {
    await createLibrary({
      $id: testLibraryId,
      name: 'Original Name',
      description: 'Original Description',
      defaultBackend: 'http://original.backend'
    });

    await updateLibrary(testLibraryId, {
      description: undefined, // Set to undefined
      defaultBackend: null, // Set to null
    });

    const updated = (await Libraries.findByIri(testLibraryId))!;

    expect(updated).toBeDefined();
    expect(updated!.description).toBeUndefined();
    expect(updated!.defaultBackend).toBeUndefined(); // Null should be converted to undefined

    const found = await Libraries.findByIri(testLibraryId);
    expect(found!.description).toBeUndefined();
    expect(found!.defaultBackend).toBeUndefined();
  });

  it('should return null if library to update does not exist', async () => {
    await updateLibrary('http://nonexistent.org/library', { name: 'New Name' });
    const found = await Libraries.findByIri('http://nonexistent.org/library');
    expect(found).toBeNull();
  });

  it('should find all libraries', async () => {
    // Create a test library
    await createLibrary({
      $id: testLibraryId,
      name: 'Test Library for findAll'
    });

    // Find all
    const all = await Libraries.find();
    expect(all.length).toBeGreaterThan(0);
    
    const ourLibrary = all.find(lib => lib.$id === testLibraryId);
    expect(ourLibrary).toBeDefined();
    expect(ourLibrary!.name).toBe('Test Library for findAll');
  });

  it('should delete library', async () => {
    // Create library
    await createLibrary({
      $id: testLibraryId,
      name: 'Library to Delete'
    });

    // Verify it exists
    let found = await Libraries.findByIri(testLibraryId);
    expect(found).toBeDefined();

    // Delete it
    await Libraries.delete(testLibraryId);

    // Verify it's gone
    found = await Libraries.findByIri(testLibraryId);
    expect(found).toBeNull();
  });
});
