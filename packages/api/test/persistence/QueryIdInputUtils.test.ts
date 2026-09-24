import { LdkitQueryIdInput } from '../../src/persistence/schemas/QueryIdInputSchema.js';
import * as QueryIdInputUtils from '../../src/persistence/utils/QueryIdInputUtils.js';
import { vi } from 'vitest';
import { overrideRepositoryLenses } from '../../src/persistence/utils/entityRepository.js';

// In-memory LDKit lens for this suite
const repositoryLens = (() => {
  const store = new Map<string, any>();
  const lens = {
    insert: async (obj: any) => {
      const id = obj.$id ?? obj['@id'];
      const norm = { ...obj, '@id': id, $id: id };
      store.set(id, norm);
      return norm;
    },
    findByIri: async (id: string) => store.get(id) ?? null,
    find: async () => Array.from(store.values()),
    update: async (obj: any) => {
      const id = obj.$id ?? obj['@id'];
      const ex = store.get(id) ?? { '@id': id, $id: id };
      const merged = { ...ex, ...obj };
      store.set(id, merged);
      return merged;
    },

    _store: store,
  };
  return lens;
})();
overrideRepositoryLenses(() => repositoryLens);

describe('QueryIdInputUtils (LDKit Integration)', () => {
  const testId = 'http://example.org/test-id-input';
  const anotherId = 'http://example.org/another-id-input';

  beforeEach(async () => {
    const { QueryIdInputs } = await import('../../src/persistence/utils/QueryIdInputUtils.js');
    repositoryLens._store.clear();
    vi.clearAllMocks();
  });

  it('should create and find a query ID input', async () => {
    // Create using LDKit
    const { QueryIdInputs } = await import('../../src/persistence/utils/QueryIdInputUtils.js');
    await QueryIdInputs.insert({
      $id: testId,
      name: 'Test Input',
    });

    // Find it back
    const found = await QueryIdInputUtils.findQueryIdInputById(testId);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Test Input');
  });

  it('should return null if query ID input not found', async () => {
    const found = await QueryIdInputUtils.findQueryIdInputById('non-existent-id');
    expect(found).toBeNull();
  });

  it('should load multiple query ID inputs by IDs', async () => {
    // Create items
    const { QueryIdInputs } = await import('../../src/persistence/utils/QueryIdInputUtils.js');
    await QueryIdInputs.insert({
      $id: testId,
      name: 'Test Input 1',
    });
    await QueryIdInputs.insert({
      $id: anotherId,
      name: 'Test Input 2',
    });

    const ids = [testId, anotherId];
    const items = await QueryIdInputUtils.loadQueryIdInputsByIds(ids);
    expect(items.length).toBe(2);
    expect(items.some(item => item.$id === testId)).toBe(true);
    expect(items.some(item => item.$id === anotherId)).toBe(true);
  });

  it('should return an empty array if no IDs are provided', async () => {
    const items = await QueryIdInputUtils.loadQueryIdInputsByIds([]);
    expect(items).toEqual([]);
  });

  it('should handle a mix of existing and non-existing IDs', async () => {
    const { QueryIdInputs } = await import('../../src/persistence/utils/QueryIdInputUtils.js');
    await QueryIdInputs.insert({
      $id: testId,
      name: 'Test Input 1',
    });

    const ids = [testId, 'non-existent-id'];
    const items = await QueryIdInputUtils.loadQueryIdInputsByIds(ids);
    expect(items.length).toBe(1);
    expect(items[0].$id).toBe(testId);
  });
});
