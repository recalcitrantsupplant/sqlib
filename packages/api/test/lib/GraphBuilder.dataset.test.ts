import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import { GraphBuilder } from '../../src/lib/orchestration/GraphBuilder.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const hoisted = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(), getAll: vi.fn() }));

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({ get: hoisted.get, list: hoisted.list, getAll: hoisted.getAll }),
});

/**
 * Structural rules for `DATASET` edges: a one-variable SELECT feeds the
 * dataset of a query node, through no input port, one edge per part.
 */
describe('GraphBuilder: DATASET edges', () => {
  let cache: Map<string, Record<string, unknown>>;
  const put = (entity: Record<string, unknown>) => cache.set(entity.$id as string, entity);

  beforeEach(() => {
    cache = new Map();
    vi.clearAllMocks();
    hoisted.get.mockImplementation((id: string) => cache.get(id) ?? null);
    hoisted.list.mockImplementation((type: string) => Array.from(cache.values()).filter((e) => e['@type'] === type));
    hoisted.getAll.mockImplementation(() => Array.from(cache.values()));

    put({ $id: 'urn:backend', '@type': 'Backend' });
    put({ $id: 'urn:qout:g', '@type': 'QueryOutput', variableName: 'g' });
    put({ $id: 'urn:qout:h', '@type': 'QueryOutput', variableName: 'h' });
    put({ $id: 'urn:tm:g', '@type': 'TupleMember', position: 0, variable: 'urn:qout:g' });
    put({ $id: 'urn:tm:h', '@type': 'TupleMember', position: 1, variable: 'urn:qout:h' });
    put({ $id: 'urn:tuple:g', '@type': 'QueryOutputTuple', memberEntries: ['urn:tm:g'] });
    put({ $id: 'urn:tuple:gh', '@type': 'QueryOutputTuple', memberEntries: ['urn:tm:g', 'urn:tm:h'] });
    put({ $id: 'urn:qv:graphs', '@type': 'QueryVersion', queryString: 'SELECT ?g ?h WHERE { ?g ?h ?o }', queryType: QueryTypeIri.select });
    put({ $id: 'urn:qv:read', '@type': 'QueryVersion', queryString: 'SELECT ?s WHERE { ?s ?p ?o }', queryType: QueryTypeIri.select });
    put({ $id: 'urn:qv:update', '@type': 'QueryVersion', queryString: 'DELETE WHERE { ?s ?p ?o }', queryType: QueryTypeIri.update });
    put({ $id: 'urn:node:source', '@type': 'QueryNode', backendId: 'urn:backend', queryId: 'urn:qv:graphs', outputs: ['urn:tuple:g', 'urn:tuple:gh'] });
    put({ $id: 'urn:node:target', '@type': 'QueryNode', backendId: 'urn:backend', queryId: 'urn:qv:read' });
    put({ $id: 'urn:node:update', '@type': 'QueryNode', backendId: 'urn:backend', queryId: 'urn:qv:update' });
  });

  const build = (edges: Array<Record<string, unknown>>, target = 'urn:node:target') => {
    const ids = edges.map((edge, index) => {
      const $id = `urn:edge:${index}`;
      put({
        $id,
        '@type': 'QueryEdge',
        sourceNodeId: 'urn:node:source',
        targetNodeId: target,
        dataFlowType: 'DATASET',
        sourceOutputId: 'urn:tuple:g',
        ...edge,
      });
      return $id;
    });
    put({ $id: 'urn:qgv', '@type': 'QueryGroupVersion', executionNodes: ['urn:node:source', target], edges: ids });
    return new GraphBuilder().buildFromGroupVersionId('urn:qgv');
  };

  it('accepts an edge from a one-variable SELECT and defaults datasetPart to both', () => {
    const graph = build([{}]);
    expect(graph.edges[0].dataFlowType).toBe('DATASET');
    expect(graph.edges[0].datasetPart).toBe('both');
  });

  it('accepts one edge per part', () => {
    const graph = build([{ datasetPart: 'default' }, { datasetPart: 'named' }]);
    expect(graph.edges.map((e) => e.datasetPart)).toEqual(['default', 'named']);
  });

  it('refuses two edges filling the same part', () => {
    expect(() => build([{ datasetPart: 'default' }, {}])).toThrow(/already takes its default graph/);
  });

  it('refuses a source tuple with more than one variable', () => {
    expect(() => build([{ sourceOutputId: 'urn:tuple:gh' }])).toThrow(/single-variable/);
  });

  it('refuses a target input port', () => {
    expect(() => build([{ targetInputId: 'urn:tuple:g' }])).toThrow(/remove targetInputId/);
  });

  it('refuses an UPDATE target', () => {
    expect(() => build([{}], 'urn:node:update')).toThrow(/UPDATE node/);
  });

  it('refuses whenEmpty unconstrained', () => {
    expect(() => build([{ whenEmpty: 'unconstrained' }])).toThrow(/whenEmpty=unconstrained/);
  });

  it('refuses an unknown datasetPart', () => {
    expect(() => build([{ datasetPart: 'all' }])).toThrow(/datasetPart all/);
  });
});
