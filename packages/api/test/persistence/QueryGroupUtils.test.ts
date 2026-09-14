/**
 * Test QueryGroupUtils LDKit integration
 */

import { QueryGroups, createQueryGroup, findQueryGroupsByParent, loadQueryGroupsByIds, deleteQueryGroups, createQueryGroups, updateQueryGroup } from '../../src/persistence/utils/QueryGroupUtils.js';
import { vi } from 'vitest';

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
  return { createRepositoryLens: () => lens, getEntity: async (lens: any, id: string) => lens.findByIri(id) };
});


describe('QueryGroupUtils (LDKit Integration)', () => {
  const testGroupId = 'http://example.org/test-group';
  const anotherGroupId = 'http://example.org/another-group';
  const testParentId = 'http://example.org/test-library';
  const testVersionId = 'http://example.org/version-1';
  const testNodeId1 = 'http://example.org/node-1';
  const testNodeId2 = 'http://example.org/node-2';
  const testEdgeId1 = 'http://example.org/edge-1';

  afterEach(async () => {
    // Clean up test data
    try {
      await QueryGroups.delete(testGroupId);
      await QueryGroups.delete(anotherGroupId);
      await QueryGroups.delete('http://example.org/group-to-delete');
      await QueryGroups.delete('http://example.org/group-create-error');
      await QueryGroups.delete('http://example.org/group-delete-error');
      await QueryGroups.delete('http://example.org/group-update-test');
      await QueryGroups.delete('http://example.org/group-add-node');
      await QueryGroups.delete('http://example.org/group-remove-node');
      await QueryGroups.delete('http://example.org/group-add-edge');
      await QueryGroups.delete('http://example.org/group-remove-edge');
      await QueryGroups.delete('http://example.org/group-hydration-test');
    } catch (error) {
      // Ignore cleanup errors
    }
    vi.clearAllMocks();
  });

  it('should create and find a query group', async () => {
    // Create using LDKit
    const group = await createQueryGroup({
      $id: testGroupId,
      name: 'Test QueryGroup',
      description: 'A test query group',
      currentVersion: testVersionId,
      isPartOf: testParentId
    });

    expect(group.name).toBe('Test QueryGroup');
    expect(group.description).toBe('A test query group');
    expect(group.isPartOf).toBe(testParentId);

    // Find it back
    const found = await QueryGroups.findByIri(testGroupId);
    expect(found).toBeDefined();
    expect(found!.name).toBe('Test QueryGroup');
  });

  it('should create a query group with @id instead of $id', async () => {
    const group = await createQueryGroup({
      '@id': anotherGroupId,
      name: 'Another Group',
      currentVersion: testVersionId,
      isPartOf: testParentId
    });
    expect(group.$id).toBe(anotherGroupId);
    const found = await QueryGroups.findByIri(anotherGroupId);
    expect(found).toBeDefined();
  });

  it('should create a query group without optional fields', async () => {
    const group = await createQueryGroup({
      $id: anotherGroupId,
      name: 'Simple Group',
      currentVersion: testVersionId,
      isPartOf: testParentId
    });
    expect(group.description).toBeUndefined();
  });

  describe('loadQueryGroupsByIds', () => {
    it('should load multiple query groups by their IDs', async () => {
      await createQueryGroup({ $id: testGroupId, name: 'Group 1', currentVersion: testVersionId, isPartOf: testParentId });
      await createQueryGroup({ $id: anotherGroupId, name: 'Group 2', currentVersion: testVersionId, isPartOf: testParentId });

      const result = await loadQueryGroupsByIds([testGroupId, anotherGroupId]);

      expect(result).toHaveLength(2);
      expect(result.some(g => g.$id === testGroupId)).toBe(true);
      expect(result.some(g => g.$id === anotherGroupId)).toBe(true);
    });

    it('should handle cases where some groups are not found', async () => {
      await createQueryGroup({ $id: testGroupId, name: 'Group 1', currentVersion: testVersionId, isPartOf: testParentId });
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await loadQueryGroupsByIds([testGroupId, 'non-existent-id']);

      expect(result).toHaveLength(1);
      expect(result[0].$id).toBe(testGroupId);
      expect(consoleWarnSpy).toHaveBeenCalledWith('Failed to load QueryGroup non-existent-id:', null);
      consoleWarnSpy.mockRestore();
    });

    it('should handle errors during loading', async () => {
      const mockError = new Error('Network error');
      const originalFindByIri = QueryGroups.findByIri;
      (QueryGroups.findByIri as any) = vi.fn((id) => {
        if (id === testGroupId) {
          return Promise.reject(mockError);
        }
        return originalFindByIri(id);
      });
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await loadQueryGroupsByIds([testGroupId]);

      expect(result).toHaveLength(0);
      expect(consoleWarnSpy).toHaveBeenCalledWith('Failed to load QueryGroup http://example.org/test-group:', mockError);
      consoleWarnSpy.mockRestore();
      QueryGroups.findByIri = originalFindByIri; // Restore original mock
    });
  });

  describe('createQueryGroups', () => {
    it('should create multiple query groups', async () => {
      const groupsData = [
        { id: testGroupId, name: 'Group A', currentVersion: testVersionId, isPartOf: testParentId },
        { id: anotherGroupId, name: 'Group B', currentVersion: testVersionId, isPartOf: testParentId },
      ];

      const results = await createQueryGroups(groupsData as any);

      expect(results).toHaveLength(2);
      expect(results[0].$id).toBe(testGroupId);
      expect(results[1].$id).toBe(anotherGroupId);

      const found1 = await QueryGroups.findByIri(testGroupId);
      expect(found1).toBeDefined();
      const found2 = await QueryGroups.findByIri(anotherGroupId);
      expect(found2).toBeDefined();
    });

    it('should handle errors during creation of some groups', async () => {
      const groupsData = [
        { id: 'http://example.org/group-create-error', name: 'Error Group', currentVersion: testVersionId, isPartOf: testParentId },
        { id: testGroupId, name: 'Valid Group', currentVersion: testVersionId, isPartOf: testParentId },
      ];
      const originalInsert = QueryGroups.insert;
      (QueryGroups.insert as any) = vi.fn((obj) => {
        if (obj.$id === 'http://example.org/group-create-error') {
          return Promise.reject(new Error('Mock insert error'));
        }
        return originalInsert(obj);
      });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const results = await createQueryGroups(groupsData as any);

      expect(results).toHaveLength(1);
      expect(results[0].$id).toBe(testGroupId);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to create QueryGroup http://example.org/group-create-error:',
        expect.any(Error)
      );
      consoleErrorSpy.mockRestore();
      QueryGroups.insert = originalInsert; // Restore original mock
    });
  });

  describe('updateQueryGroup', () => {
    beforeEach(async () => {
      await createQueryGroup({
        $id: 'http://example.org/group-update-test',
        name: 'Original Name',
        description: 'Original Description',
        currentVersion: testVersionId,
        isPartOf: testParentId
      });
    });

    it('should update existing fields of a query group', async () => {
      const updated = await updateQueryGroup('http://example.org/group-update-test', {
        name: 'Updated Name',
        description: 'Updated Description',
      });

      expect(updated).toBeDefined();
      expect(updated!.$id).toBe('http://example.org/group-update-test');
      expect(updated!.name).toBe('Updated Name');
      expect(updated!.description).toBe('Updated Description');
      expect(updated!.currentVersion).toBe(testVersionId); // Should remain unchanged
      expect(updated!.dateModified).toBeDefined();

      const found = await QueryGroups.findByIri('http://example.org/group-update-test');
      expect(found!.name).toBe('Updated Name');
    });

    it('should update fields and handle null/undefined', async () => {
      const updated = await updateQueryGroup('http://example.org/group-update-test', {
        description: 'Updated with new description',
      });

      expect(updated).toBeDefined();
      expect(updated!.description).toBe('Updated with new description');

      const found = await QueryGroups.findByIri('http://example.org/group-update-test');
      expect(found!.description).toBe('Updated with new description');
    });

    it('should return null if query group to update does not exist', async () => {
      const updated = await updateQueryGroup('http://nonexistent.org/group', { name: 'New Name' });
      expect(updated).toBeNull();
    });
  });

  describe('deleteQueryGroups', () => {
    it('should delete multiple query groups', async () => {
      await createQueryGroup({ $id: testGroupId, name: 'Group 1', currentVersion: testVersionId, isPartOf: testParentId });
      await createQueryGroup({ $id: anotherGroupId, name: 'Group 2', currentVersion: testVersionId, isPartOf: testParentId });

      const results = await deleteQueryGroups([testGroupId, anotherGroupId]);

      expect(results).toEqual([true, true]);
      expect(await QueryGroups.findByIri(testGroupId)).toBeNull();
      expect(await QueryGroups.findByIri(anotherGroupId)).toBeNull();
    });

    it('should handle non-existent groups gracefully', async () => {
      await createQueryGroup({ $id: testGroupId, name: 'Group 1', currentVersion: testVersionId, isPartOf: testParentId });

      const results = await deleteQueryGroups([testGroupId, 'non-existent-group']);
      expect(results).toEqual([true, false]);
      expect(await QueryGroups.findByIri(testGroupId)).toBeNull();
    });

    it('should handle errors during deletion of some groups', async () => {
      await createQueryGroup({ $id: 'http://example.org/group-delete-error', name: 'Error Group', currentVersion: testVersionId, isPartOf: testParentId });
      await createQueryGroup({ $id: testGroupId, name: 'Valid Group', currentVersion: testVersionId, isPartOf: testParentId });

      const originalDelete = QueryGroups.delete;
      (QueryGroups.delete as any) = vi.fn((id) => {
        if (id === 'http://example.org/group-delete-error') {
          return Promise.reject(new Error('Mock delete error'));
        }
        return originalDelete(id);
      });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const results = await deleteQueryGroups(['http://example.org/group-delete-error', testGroupId]);

      expect(results).toEqual([false, true]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to delete QueryGroup http://example.org/group-delete-error:',
        expect.any(Error)
      );
      consoleErrorSpy.mockRestore();
      QueryGroups.delete = originalDelete; // Restore original mock
    });
  });

  describe('findQueryGroupsByParent', () => {
    it('should find groups by parent ID', async () => {
      await createQueryGroup({ $id: testGroupId, name: 'Child Group 1', currentVersion: testVersionId, isPartOf: testParentId });
      await createQueryGroup({ $id: anotherGroupId, name: 'Child Group 2', currentVersion: testVersionId, isPartOf: testParentId });
      await createQueryGroup({ $id: 'http://example.org/other-parent-group', name: 'Other Group', currentVersion: testVersionId, isPartOf: 'http://example.org/other-parent' });

      const found = await findQueryGroupsByParent(testParentId);
      expect(found).toHaveLength(2);
      expect(found.some(g => g.$id === testGroupId)).toBe(true);
      expect(found.some(g => g.$id === anotherGroupId)).toBe(true);
    });

    it('should return empty array if no groups found for parent', async () => {
      const found = await findQueryGroupsByParent('non-existent-parent');
      expect(found).toEqual([]);
    });

    it('should handle errors during find operation', async () => {
      const mockError = new Error('Find error');
      const originalFind = QueryGroups.find;
      (QueryGroups.find as any) = vi.fn().mockRejectedValue(mockError);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await findQueryGroupsByParent(testParentId);

      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Failed to find QueryGroups by parent ${testParentId}:`,
        mockError
      );
      consoleErrorSpy.mockRestore();
      QueryGroups.find = originalFind; // Restore original mock
    });
  });

});