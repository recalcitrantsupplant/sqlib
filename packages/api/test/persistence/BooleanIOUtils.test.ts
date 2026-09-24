import { describe, it, expect, beforeEach, vi } from 'vitest';
import { findBooleanIOById, loadBooleanIOsByIds } from '../../src/persistence/utils/BooleanIOUtils.js';
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
      const ex = store.get(id) ?? { $id: id, '@id': id };
      const merged = { ...ex, ...obj, '@id': id, $id: id };
      store.set(id, merged);
      return merged;
    },
    delete: async (id: string) => {
      store.delete(id);
    },
    _store: store,
  };
  return lens;
})();
overrideRepositoryLenses(() => repositoryLens);

describe('BooleanIOUtils', () => {
  const testBooleanId1 = 'urn:sqlib:boolean-io:test-1';
  const testBooleanId2 = 'urn:sqlib:boolean-io:test-2';

  beforeEach(async () => {
    const { BooleanIOs } = await import('../../src/persistence/utils/BooleanIOUtils.js');
    repositoryLens._store.clear();
  });

  describe('findBooleanIOById', () => {
    it('should find a BooleanIO by ID', async () => {
      const { BooleanIOs } = await import('../../src/persistence/utils/BooleanIOUtils.js');
      await BooleanIOs.insert({
        $id: testBooleanId1,
        name: 'Test Boolean IO',
      });

      const found = await findBooleanIOById(testBooleanId1);

      expect(found).toBeDefined();
      expect(found!.$id).toBe(testBooleanId1);
      expect(found!.name).toBe('Test Boolean IO');
    });

    it('should return null when BooleanIO not found', async () => {
      const found = await findBooleanIOById('urn:sqlib:boolean-io:nonexistent');

      expect(found).toBeNull();
    });

    it('should return null for empty ID', async () => {
      const found = await findBooleanIOById('');

      expect(found).toBeNull();
    });

    it('should handle errors gracefully', async () => {
      const { BooleanIOs } = await import('../../src/persistence/utils/BooleanIOUtils.js');

      // Mock findByIri to throw an error
      const originalFindByIri = repositoryLens.findByIri;
      repositoryLens.findByIri = vi.fn().mockRejectedValue(new Error('Database error'));

      const found = await findBooleanIOById(testBooleanId1);

      expect(found).toBeNull();

      // Restore original method
      repositoryLens.findByIri = originalFindByIri;
    });

    it('should preserve all properties of BooleanIO', async () => {
      const { BooleanIOs } = await import('../../src/persistence/utils/BooleanIOUtils.js');
      const booleanIO = {
        $id: testBooleanId1,
        name: 'Complex Boolean IO',
        description: 'Test description',
        customField: 'custom value',
      };

      await BooleanIOs.insert(booleanIO);
      const found = await findBooleanIOById(testBooleanId1);

      expect(found).toEqual(expect.objectContaining({
        $id: testBooleanId1,
        name: 'Complex Boolean IO',
        description: 'Test description',
        customField: 'custom value',
      }));
    });
  });

  describe('loadBooleanIOsByIds', () => {
    it('should load multiple BooleanIOs by IDs', async () => {
      const { BooleanIOs } = await import('../../src/persistence/utils/BooleanIOUtils.js');
      await BooleanIOs.insert({
        $id: testBooleanId1,
        name: 'Test Boolean IO 1',
      });
      await BooleanIOs.insert({
        $id: testBooleanId2,
        name: 'Test Boolean IO 2',
      });

      const booleanIOs = await loadBooleanIOsByIds([testBooleanId1, testBooleanId2]);

      expect(booleanIOs).toHaveLength(2);
      expect(booleanIOs[0].$id).toBe(testBooleanId1);
      expect(booleanIOs[1].$id).toBe(testBooleanId2);
    });

    it('should return empty array for empty IDs array', async () => {
      const booleanIOs = await loadBooleanIOsByIds([]);

      expect(booleanIOs).toEqual([]);
    });

    it('should skip non-existent IDs', async () => {
      const { BooleanIOs } = await import('../../src/persistence/utils/BooleanIOUtils.js');
      await BooleanIOs.insert({
        $id: testBooleanId1,
        name: 'Test Boolean IO 1',
      });

      const booleanIOs = await loadBooleanIOsByIds([
        testBooleanId1,
        'urn:sqlib:boolean-io:nonexistent',
        testBooleanId2, // doesn't exist
      ]);

      expect(booleanIOs).toHaveLength(1);
      expect(booleanIOs[0].$id).toBe(testBooleanId1);
    });

    it('should maintain order of IDs', async () => {
      const { BooleanIOs } = await import('../../src/persistence/utils/BooleanIOUtils.js');
      await BooleanIOs.insert({
        $id: testBooleanId1,
        name: 'First',
      });
      await BooleanIOs.insert({
        $id: testBooleanId2,
        name: 'Second',
      });

      // Request in reverse order
      const booleanIOs = await loadBooleanIOsByIds([testBooleanId2, testBooleanId1]);

      expect(booleanIOs).toHaveLength(2);
      expect(booleanIOs[0].$id).toBe(testBooleanId2);
      expect(booleanIOs[0].name).toBe('Second');
      expect(booleanIOs[1].$id).toBe(testBooleanId1);
      expect(booleanIOs[1].name).toBe('First');
    });

    it('should handle duplicate IDs', async () => {
      const { BooleanIOs } = await import('../../src/persistence/utils/BooleanIOUtils.js');
      await BooleanIOs.insert({
        $id: testBooleanId1,
        name: 'Test Boolean IO',
      });

      const booleanIOs = await loadBooleanIOsByIds([
        testBooleanId1,
        testBooleanId1,
        testBooleanId1,
      ]);

      // Should return duplicates as requested
      expect(booleanIOs).toHaveLength(3);
      expect(booleanIOs[0].$id).toBe(testBooleanId1);
      expect(booleanIOs[1].$id).toBe(testBooleanId1);
      expect(booleanIOs[2].$id).toBe(testBooleanId1);
    });

    it('should handle errors gracefully and continue loading', async () => {
      const { BooleanIOs } = await import('../../src/persistence/utils/BooleanIOUtils.js');
      await BooleanIOs.insert({
        $id: testBooleanId1,
        name: 'Test Boolean IO 1',
      });
      await BooleanIOs.insert({
        $id: testBooleanId2,
        name: 'Test Boolean IO 2',
      });

      // Mock findByIri to throw error for specific ID
      const originalFindByIri = repositoryLens.findByIri;
      repositoryLens.findByIri = vi.fn().mockImplementation(async (id: string) => {
        if (id === testBooleanId1) {
          throw new Error('Database error');
        }
        return originalFindByIri.call(BooleanIOs, id);
      });

      const booleanIOs = await loadBooleanIOsByIds([testBooleanId1, testBooleanId2]);

      // Should only return the successful one
      expect(booleanIOs).toHaveLength(1);
      expect(booleanIOs[0].$id).toBe(testBooleanId2);

      // Restore
      repositoryLens.findByIri = originalFindByIri;
    });

    it('should handle mixed valid and empty IDs', async () => {
      const { BooleanIOs } = await import('../../src/persistence/utils/BooleanIOUtils.js');
      await BooleanIOs.insert({
        $id: testBooleanId1,
        name: 'Test Boolean IO',
      });

      const booleanIOs = await loadBooleanIOsByIds([
        testBooleanId1,
        '',
        'urn:sqlib:boolean-io:nonexistent',
      ]);

      expect(booleanIOs).toHaveLength(1);
      expect(booleanIOs[0].$id).toBe(testBooleanId1);
    });
  });

  describe('Integration', () => {
    it('should work with repository CRUD operations', async () => {
      const { BooleanIOs } = await import('../../src/persistence/utils/BooleanIOUtils.js');

      // Insert
      await BooleanIOs.insert({
        $id: testBooleanId1,
        name: 'Original Name',
      });

      // Find
      const found = await findBooleanIOById(testBooleanId1);
      expect(found!.name).toBe('Original Name');

      // Update
      await BooleanIOs.update({
        $id: testBooleanId1,
        name: 'Updated Name',
      });

      // Find after update
      const updated = await findBooleanIOById(testBooleanId1);
      expect(updated!.name).toBe('Updated Name');

      // Delete
      await BooleanIOs.delete(testBooleanId1);

      // Find after delete
      const deleted = await findBooleanIOById(testBooleanId1);
      expect(deleted).toBeNull();
    });

    it('should work with bulk loading after modifications', async () => {
      const { BooleanIOs } = await import('../../src/persistence/utils/BooleanIOUtils.js');

      // Insert multiple
      await BooleanIOs.insert({ $id: testBooleanId1, name: 'IO 1' });
      await BooleanIOs.insert({ $id: testBooleanId2, name: 'IO 2' });

      // Load bulk
      let loaded = await loadBooleanIOsByIds([testBooleanId1, testBooleanId2]);
      expect(loaded).toHaveLength(2);

      // Update one
      await BooleanIOs.update({ $id: testBooleanId1, name: 'Updated IO 1' });

      // Load bulk again
      loaded = await loadBooleanIOsByIds([testBooleanId1, testBooleanId2]);
      expect(loaded).toHaveLength(2);
      expect(loaded[0].name).toBe('Updated IO 1');
      expect(loaded[1].name).toBe('IO 2');

      // Delete one
      await BooleanIOs.delete(testBooleanId2);

      // Load bulk after delete
      loaded = await loadBooleanIOsByIds([testBooleanId1, testBooleanId2]);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].$id).toBe(testBooleanId1);
    });
  });
});
