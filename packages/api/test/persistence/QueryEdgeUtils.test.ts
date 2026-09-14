/**
 * Test QueryEdgeUtils LDKit integration
 */

import * as QueryEdgeUtils from '../../src/persistence/utils/QueryEdgeUtils.js';
import { QueryGroups } from '../../src/persistence/utils/QueryGroupUtils.js';
import { vi } from 'vitest';

// In-memory LDKit lens for this suite
vi.mock('../../src/persistence/utils/entityRepository', () => {
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

      // Explicitly handle properties that are set to undefined or null in the update object
      for (const key in obj) {
        if (obj[key] === undefined || obj[key] === null) {
          delete merged[key];
        }
      }
      store.set(id, merged);
      return merged;
    },
    delete: async (id: string) => { store.delete(id); },
  };
  return { createRepositoryLens: () => lens };
});

vi.mock('../../src/persistence/utils/QueryGroupUtils', () => ({
  QueryGroups: {
    findByIri: vi.fn(),
  },
}));

describe('QueryEdgeUtils (LDKit Integration)', () => {
  const testEdgeId = 'http://example.org/test-edge';
  const anotherEdgeId = 'http://example.org/another-edge';
  const sourceNodeId = 'http://example.org/from-node';
  const targetNodeId = 'http://example.org/to-node';
  const thirdNodeId = 'http://example.org/third-node';
  const queryGroupVersionId = 'http://example.org/test-group-version';

  afterEach(async () => {
    // Clean up test data
    try {
      await QueryEdgeUtils.QueryEdges.delete(testEdgeId);
      await QueryEdgeUtils.QueryEdges.delete(anotherEdgeId);
      await QueryEdgeUtils.QueryEdges.delete('http://example.org/edge-to-delete');
      await QueryEdgeUtils.QueryEdges.delete('http://example.org/edge-from-third');
      await QueryEdgeUtils.QueryEdges.delete('http://example.org/edge-to-third');
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should create and find a query edge', async () => {
    // Create using LDKit
    const edge = await QueryEdgeUtils.createQueryEdge({
      $id: testEdgeId,
      sourceNodeId,
      targetNodeId,
      dataFlowType: 'RDF_GRAPH',
    });

    expect(edge.sourceNodeId).toBe(sourceNodeId);
    expect(edge.targetNodeId).toBe(targetNodeId);
    expect(edge.dataFlowType).toBe('RDF_GRAPH');

    // Find it back
    const found = await QueryEdgeUtils.QueryEdges.findByIri(testEdgeId);
    expect(found).toBeDefined();
    expect(found!.sourceNodeId).toBe(sourceNodeId);
    expect(found!.targetNodeId).toBe(targetNodeId);
  });

  it('should create a query edge with @id instead of $id', async () => {
    const edge = await QueryEdgeUtils.createQueryEdge({
      '@id': anotherEdgeId,
      sourceNodeId,
      targetNodeId,
    });
    expect(edge.$id).toBe(anotherEdgeId);
    const found = await QueryEdgeUtils.QueryEdges.findByIri(anotherEdgeId);
    expect(found).toBeDefined();
  });

  it('should create a query edge without optional fields', async () => {
    const edge = await QueryEdgeUtils.createQueryEdge({
      $id: anotherEdgeId,
      sourceNodeId,
      targetNodeId,
    });
    expect(edge.dataFlowType).toBeUndefined();
  });

  it('should find edges by source node', async () => {
    // Create edge
    await QueryEdgeUtils.createQueryEdge({
      $id: testEdgeId,
      sourceNodeId,
      targetNodeId,
    });
    await QueryEdgeUtils.createQueryEdge({
      $id: anotherEdgeId,
      sourceNodeId: 'http://example.org/other-from',
      targetNodeId,
    });

    // Find by from node
    const found = await QueryEdgeUtils.findQueryEdgesBySourceNode(sourceNodeId);
    expect(found.length).toBe(1);
    expect(found[0].$id).toBe(testEdgeId);
  });

  it('should return empty array if no edges found by source node', async () => {
    const found = await QueryEdgeUtils.findQueryEdgesBySourceNode('non-existent-node');
    expect(found).toEqual([]);
  });

  it('should find edges by target node', async () => {
    // Create edge
    await QueryEdgeUtils.createQueryEdge({
      $id: testEdgeId,
      sourceNodeId,
      targetNodeId,
    });
    await QueryEdgeUtils.createQueryEdge({
      $id: anotherEdgeId,
      sourceNodeId,
      targetNodeId: 'http://example.org/other-to',
    });

    // Find by to node
    const found = await QueryEdgeUtils.findQueryEdgesByTargetNode(targetNodeId);
    expect(found.length).toBe(1);
    expect(found[0].$id).toBe(testEdgeId);
  });

  it('should return empty array if no edges found by target node', async () => {
    const found = await QueryEdgeUtils.findQueryEdgesByTargetNode('non-existent-node');
    expect(found).toEqual([]);
  });

  it('should find edges by node (either direction)', async () => {
    // Create edges
    await QueryEdgeUtils.createQueryEdge({
      $id: testEdgeId,
      sourceNodeId,
      targetNodeId,
    });
    await QueryEdgeUtils.createQueryEdge({
      $id: 'http://example.org/edge-from-third',
      sourceNodeId: thirdNodeId,
      targetNodeId: sourceNodeId,
    });
    await QueryEdgeUtils.createQueryEdge({
      $id: 'http://example.org/edge-to-third',
      sourceNodeId: targetNodeId,
      targetNodeId: thirdNodeId,
    });

    // Find by from node
    const foundByFrom = await QueryEdgeUtils.findQueryEdgesByNode(sourceNodeId);
    expect(foundByFrom.length).toBe(2);
    expect(foundByFrom.some(e => e.$id === testEdgeId)).toBe(true);
    expect(foundByFrom.some(e => e.$id === 'http://example.org/edge-from-third')).toBe(true);

    // Find by to node
    const foundByTo = await QueryEdgeUtils.findQueryEdgesByNode(targetNodeId);
    expect(foundByTo.length).toBe(2);
    expect(foundByTo.some(e => e.$id === testEdgeId)).toBe(true);
    expect(foundByTo.some(e => e.$id === 'http://example.org/edge-to-third')).toBe(true);

    // Find by third node
    const foundByThird = await QueryEdgeUtils.findQueryEdgesByNode(thirdNodeId);
    expect(foundByThird.length).toBe(2);
    expect(foundByThird.some(e => e.$id === 'http://example.org/edge-from-third')).toBe(true);
    expect(foundByThird.some(e => e.$id === 'http://example.org/edge-to-third')).toBe(true);
  });

  it('should return empty array if no edges found by node', async () => {
    const found = await QueryEdgeUtils.findQueryEdgesByNode('non-existent-node');
    expect(found).toEqual([]);
  });

  it('should validate required fields for createQueryEdge', async () => {
    // Missing sourceNodeId
    await expect(QueryEdgeUtils.createQueryEdge({
      $id: testEdgeId,
      targetNodeId,
    } as any)).rejects.toThrow('QueryEdge requires both sourceNodeId and targetNodeId');

    // Missing targetNodeId
    await expect(QueryEdgeUtils.createQueryEdge({
      $id: testEdgeId,
      sourceNodeId,
    } as any)).rejects.toThrow('QueryEdge requires both sourceNodeId and targetNodeId');
  });

  describe('updateQueryEdge', () => {
    beforeEach(async () => {
      await QueryEdgeUtils.createQueryEdge({
        $id: testEdgeId,
        sourceNodeId: 'nodeA',
        targetNodeId: 'nodeB',
        dataFlowType: 'RDF_GRAPH',
      });
    });

    it('should update existing fields of a query edge', async () => {
      const updated = await QueryEdgeUtils.updateQueryEdge(testEdgeId, {
        sourceNodeId: 'nodeX',
        dataFlowType: 'VARIABLE_BINDINGS',
      });

      expect(updated).toBeDefined();
      expect(updated!.$id).toBe(testEdgeId);
      expect(updated!.sourceNodeId).toBe('nodeX');
      expect(updated!.targetNodeId).toBe('nodeB'); // Unchanged
      expect(updated!.dataFlowType).toBe('VARIABLE_BINDINGS');
    });

    it('should update optional fields including setting them to undefined/null', async () => {
      const updated = await QueryEdgeUtils.updateQueryEdge(testEdgeId, {
        dataFlowType: null, // Set to null
      });

      expect(updated).toBeDefined();
      const found = await QueryEdgeUtils.QueryEdges.findByIri(testEdgeId);
      expect(found!.dataFlowType).toBeUndefined();
    });

    it('should return null if query edge to update does not exist', async () => {
      const result = await QueryEdgeUtils.updateQueryEdge('http://nonexistent.org/edge', { sourceNodeId: 'nodeZ' });
      expect(result).toBeNull();
    });
  });

  describe('deleteQueryEdge', () => {
    it('should delete an existing query edge', async () => {
      await QueryEdgeUtils.createQueryEdge({
        $id: 'http://example.org/edge-to-delete',
        sourceNodeId,
        targetNodeId,
      });

      const success = await QueryEdgeUtils.deleteQueryEdge('http://example.org/edge-to-delete');
      expect(success).toBe(true);

      const found = await QueryEdgeUtils.QueryEdges.findByIri('http://example.org/edge-to-delete');
      expect(found).toBeNull();
    });

    it('should return false and log error if delete fails', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      // Mock the delete method of the lens to throw an error
      const originalDelete = QueryEdgeUtils.QueryEdges.delete;
      (QueryEdgeUtils.QueryEdges.delete as any) = vi.fn().mockRejectedValue(new Error('Mock delete error'));

      const success = await QueryEdgeUtils.deleteQueryEdge('http://example.org/non-existent-edge');
      expect(success).toBe(false);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to delete QueryEdge http://example.org/non-existent-edge:',
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
      QueryEdgeUtils.QueryEdges.delete = originalDelete; // Restore original mock
    });
  });

  describe('findQueryEdgesByGroupVersion (deprecated)', () => {
    it('should return empty array (function is deprecated)', async () => {
      const foundEdges = await QueryEdgeUtils.findQueryEdgesByGroupVersion('any-group-version-id');
      expect(foundEdges).toEqual([]);
    });
  });

  describe('deleteEdgesByNode', () => {
    const nodeToDelete = 'http://example.org/node-to-delete';
    const edge1 = 'http://example.org/edge1-to-delete';
    const edge2 = 'http://example.org/edge2-to-delete';
    const edge3 = 'http://example.org/edge3-not-deleted';

    beforeEach(async () => {
      // Create edges connected to nodeToDelete
      await QueryEdgeUtils.createQueryEdge({
        $id: edge1,
        sourceNodeId: nodeToDelete,
        targetNodeId: 'http://example.org/other-node-1',
      });
      await QueryEdgeUtils.createQueryEdge({
        $id: edge2,
        sourceNodeId: 'http://example.org/other-node-2',
        targetNodeId: nodeToDelete,
      });
      // Create edge not connected to nodeToDelete
      await QueryEdgeUtils.createQueryEdge({
        $id: edge3,
        sourceNodeId: 'http://example.org/other-node-3',
        targetNodeId: 'http://example.org/other-node-4',
      });
    });

    it('should delete all edges connected to a given node', async () => {
      const deletedIds = await QueryEdgeUtils.deleteEdgesByNode(nodeToDelete);
      expect(deletedIds).toHaveLength(2);
      expect(deletedIds).toContain(edge1);
      expect(deletedIds).toContain(edge2);

      // Verify they are gone
      expect(await QueryEdgeUtils.QueryEdges.findByIri(edge1)).toBeNull();
      expect(await QueryEdgeUtils.QueryEdges.findByIri(edge2)).toBeNull();
      // Verify other edge is still there
      expect(await QueryEdgeUtils.QueryEdges.findByIri(edge3)).toBeDefined();
    });

    it('should return empty array if no edges connected to node', async () => {
      const deletedIds = await QueryEdgeUtils.deleteEdgesByNode('http://nonexistent.org/node');
      expect(deletedIds).toEqual([]);
    });

    it('should handle errors during deletion of some edges', async () => {
      // Spy on the LDKit delete function to simulate a failure at a lower level.
      // This is necessary because deleteEdgesByNode calls deleteQueryEdge within the same module,
      // which can bypass spies on deleteQueryEdge itself.
      const deleteSpy = vi.spyOn(QueryEdgeUtils.QueryEdges, 'delete').mockImplementation(async (...identities: (string | { $id: string })[]) => {
        const firstIdentity = identities[0];
        const id = typeof firstIdentity === 'string' ? firstIdentity : firstIdentity.$id;
        if (id === edge1) {
          throw new Error('Mock LDKit delete error');
        }
        // For edge2, we let it succeed by doing nothing (the underlying mock store won't be changed,
        // but deleteQueryEdge will return true as no error is thrown).
      });
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const deletedIds = await QueryEdgeUtils.deleteEdgesByNode(nodeToDelete);

      // Assertions
      expect(deletedIds).toHaveLength(1);
      expect(deletedIds).toContain(edge2);
      expect(deletedIds).not.toContain(edge1);

      // Verify that the error was logged for the failed deletion
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        `Failed to delete QueryEdge ${edge1}:`,
        expect.any(Error)
      );

      // Verify state in mock store
      // edge1 should still exist because its deletion failed
      expect(await QueryEdgeUtils.QueryEdges.findByIri(edge1)).toBeDefined();
      // edge2 will also still exist in the mock store because our spy doesn't delete it,
      // but the test correctly verifies that deleteEdgesByNode reports it as a success.
      expect(await QueryEdgeUtils.QueryEdges.findByIri(edge2)).toBeDefined();

      // Restore mocks
      deleteSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });
  });
});
