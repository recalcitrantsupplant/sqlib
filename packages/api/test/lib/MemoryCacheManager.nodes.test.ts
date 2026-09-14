import { describe, it, expect, beforeEach, vi } from 'vitest';
import { memoryCacheManager } from '../../src/lib/MemoryCacheManager.js';
import { toLdkit } from '../../src/persistence/utils/id-adapter.js';

// Mock the LDKit repositories to avoid SPARQL dependencies
vi.mock('../../src/persistence/utils/QueryNodeUtils.js', () => ({
  QueryNodes: {
    insert: vi.fn(),
    find: vi.fn().mockResolvedValue([]),
  }
}));

// The boot load has to be stubbed too, not just the repositories above: it reads
// every registered type from the store, and this suite never stands one up.
vi.mock('../../src/persistence/utils/entityRepository.js', () => ({
  loadAllSystemEntities: vi.fn(async () => new Map()),
  createRepositoryLens: vi.fn(),
}));

// This suite's subject is cache logic; storage is a stub. It runs against a
// double built from those stubs (see lensBackedAdapter), so what is asserted is
// what the cache did, not what the persistence layer did.
vi.mock('../../src/persistence/adapterRegistry', async () => {
  const { lensBackedAdapter } = await import('../persistence/lensBackedAdapter.js');
  return { getPersistenceAdapter: () => lensBackedAdapter, setPersistenceAdapter: () => {} };
});

vi.mock('../../src/persistence/utils/StartNodeUtils.js', () => ({
  StartNodes: {
    insert: vi.fn(),
    find: vi.fn().mockResolvedValue([]),
  }
}));

vi.mock('../../src/persistence/utils/EndNodeUtils.js', () => ({
  EndNodes: {
    insert: vi.fn(),
    find: vi.fn().mockResolvedValue([]),
  }
}));

vi.mock('../../src/persistence/utils/QueryEdgeUtils.js', () => ({
  QueryEdges: {
    insert: vi.fn(),
    find: vi.fn().mockResolvedValue([]),
  }
}));

describe('MemoryCacheManager - Node Entity Creation', () => {
  beforeEach(async () => {
    // Initialize cache manager (this loads from mocked repositories)
    await memoryCacheManager.loadAll();

    // Reset mocks after loading
    vi.clearAllMocks();
  });

  describe('QueryNode creation', () => {
    it('should create and cache a QueryNode entity', async () => {
      const queryNodeData = toLdkit({
        $id: 'urn:test:node:1',
        queryId: 'urn:test:query-version:1',
        backendId: 'urn:test:backend:1',
        inputs: ['urn:test:input-tuple:1'],
        outputs: ['urn:test:output-tuple:1'],
        isPartOf: 'urn:test:group-version:1',
        '@type': 'QueryNode',
        nodeType: 'QueryNode'
      });

      // Create through cache manager
      const created = await memoryCacheManager.create(queryNodeData as any, 'QueryNode');

      // Verify entity was created
      expect(created).toBeDefined();
      expect(created.$id).toBe('urn:test:node:1');
      expect(created['@type']).toBe('QueryNode');

      // Verify entity is in cache
      const cached = memoryCacheManager.get('urn:test:node:1');
      expect(cached).toBeDefined();
      expect(cached).toEqual(created);
      expect((cached as any)['@type']).toBe('QueryNode');
    });

    it('should handle QueryNode with minimal required fields', async () => {
      const minimalNodeData = toLdkit({
        $id: 'urn:test:node:minimal',
        queryId: 'urn:test:query-version:1',
        backendId: 'urn:test:backend:1',
        '@type': 'QueryNode',
        nodeType: 'QueryNode'
      });

      const created = await memoryCacheManager.create(minimalNodeData as any, 'QueryNode');

      expect(created).toBeDefined();
      expect(created.$id).toBe('urn:test:node:minimal');

      const cached = memoryCacheManager.get('urn:test:node:minimal');
      expect(cached).toBeDefined();
    });
  });

  describe('StartNode creation', () => {
    it('should create and cache a StartNode entity', async () => {
      const startNodeData = toLdkit({
        $id: 'urn:test:start-node:1',
        inputs: [],
        outputs: ['urn:test:output-tuple:1'],
        isPartOf: 'urn:test:group-version:1',
        '@type': 'StartNode',
      });

      const created = await memoryCacheManager.create(startNodeData as any, 'StartNode');

      expect(created).toBeDefined();
      expect(created.$id).toBe('urn:test:start-node:1');
      expect(created['@type']).toBe('StartNode');

      const cached = memoryCacheManager.get('urn:test:start-node:1');
      expect(cached).toBeDefined();
      expect((cached as any)['@type']).toBe('StartNode');
    });
  });

  describe('EndNode creation', () => {
    it('should create and cache an EndNode entity', async () => {
      const endNodeData = toLdkit({
        $id: 'urn:test:end-node:1',
        inputs: ['urn:test:output-tuple:1'],
        mediaType: 'application/n-triples',
        isPartOf: 'urn:test:group-version:1',
        '@type': 'EndNode',
      });

      const created = await memoryCacheManager.create(endNodeData as any, 'EndNode');

      expect(created).toBeDefined();
      expect(created.$id).toBe('urn:test:end-node:1');
      expect(created['@type']).toBe('EndNode');

      const cached = memoryCacheManager.get('urn:test:end-node:1');
      expect(cached).toBeDefined();
      expect((cached as any)['@type']).toBe('EndNode');
    });
  });

  describe('QueryEdge creation', () => {
    it('should create and cache a QueryEdge entity', async () => {
      const edgeData = toLdkit({
        $id: 'urn:test:edge:1',
        sourceNodeId: 'urn:test:node:source',
        targetNodeId: 'urn:test:node:target',
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: 'urn:test:output-tuple:1',
        targetInputId: 'urn:test:input-tuple:1',
        isPartOf: 'urn:test:group-version:1',
        '@type': 'QueryEdge'
      });

      const created = await memoryCacheManager.create(edgeData as any, 'QueryEdge');

      expect(created).toBeDefined();
      expect(created.$id).toBe('urn:test:edge:1');
      expect(created['@type']).toBe('QueryEdge');

      const cached = memoryCacheManager.get('urn:test:edge:1');
      expect(cached).toBeDefined();
      expect((cached as any)['@type']).toBe('QueryEdge');
      expect((cached as any).dataFlowType).toBe('VARIABLE_BINDINGS');
    });
  });

  describe('Type guards integration', () => {
    it('should create nodes that pass type guard validation', async () => {
      // Import type guards
      const { isQueryNode, isStartNode, isEndNode, isAnyNode } = await import('../../src/lib/type-guards.js');

      // Create a QueryNode
      const queryNodeData = toLdkit({
        $id: 'urn:test:node:type-guard',
        queryId: 'urn:test:query-version:1',
        backendId: 'urn:test:backend:1',
        '@type': 'QueryNode',
        nodeType: 'QueryNode'
      });

      await memoryCacheManager.create(queryNodeData as any, 'QueryNode');
      const cachedNode = memoryCacheManager.get('urn:test:node:type-guard');

      // Test type guards on cached entity
      expect(isAnyNode(cachedNode)).toBe(true);
      expect(isQueryNode(cachedNode)).toBe(true);
      expect(isStartNode(cachedNode)).toBe(false);
      expect(isEndNode(cachedNode)).toBe(false);

      // Create a StartNode
      const startNodeData = toLdkit({
        $id: 'urn:test:start-node:type-guard',
        '@type': 'StartNode',
      });

      await memoryCacheManager.create(startNodeData as any, 'StartNode');
      const cachedStartNode = memoryCacheManager.get('urn:test:start-node:type-guard');

      expect(isAnyNode(cachedStartNode)).toBe(true);
      expect(isStartNode(cachedStartNode)).toBe(true);
      expect(isQueryNode(cachedStartNode)).toBe(false);
    });
  });

  describe('Cache coherency', () => {
    it('should maintain cache coherency after multiple entity creations', async () => {
      // Create multiple entities
      const nodes = [
        { id: 'urn:test:node:1', type: 'QueryNode' },
        { id: 'urn:test:node:2', type: 'QueryNode' },
        { id: 'urn:test:start:1', type: 'StartNode' },
        { id: 'urn:test:end:1', type: 'EndNode' }
      ];

      for (const nodeSpec of nodes) {
        const nodeData = toLdkit({
          $id: nodeSpec.id,
          '@type': nodeSpec.type,
          nodeType: nodeSpec.type,
          ...(nodeSpec.type === 'QueryNode' ? {
            queryId: 'urn:test:query-version:1',
            backendId: 'urn:test:backend:1'
          } : {})
        });

        await memoryCacheManager.create(nodeData as any, nodeSpec.type as any);
      }

      // Verify all entities are cached
      for (const nodeSpec of nodes) {
        const cached = memoryCacheManager.get(nodeSpec.id);
        expect(cached).toBeDefined();
        expect((cached as any)['@type']).toBe(nodeSpec.type);
      }

      // Verify cache stats
      const stats = memoryCacheManager.getStats();
      expect(stats.totalEntities).toBeGreaterThanOrEqual(4);
      expect(stats.entityTypes.QueryNode?.count).toBe(2);
      expect(stats.entityTypes.StartNode?.count).toBe(1);
      expect(stats.entityTypes.EndNode?.count).toBe(1);
    });
  });
});
