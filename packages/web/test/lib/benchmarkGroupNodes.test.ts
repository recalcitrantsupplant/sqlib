import { describe, expect, it } from 'vitest';
import type { QueryGroupVersionExpanded } from '@sparql-query-lib/contracts';
import { groupNodeCosts, groupNodeRows } from '../../src/lib/benchmarkGroupNodes';

const START = 'urn:node:start';
const END = 'urn:node:end';
const FIND = 'urn:node:find';
const ASSAYS = 'urn:node:assays';
const RULES = 'urn:node:rules';
const WRITE = 'urn:node:write';

function expanded(): QueryGroupVersionExpanded {
  return {
    queryGroupVersion: {
      id: 'urn:group-version:1',
      version: 4,
      canvasData: JSON.stringify({ nodes: [{ id: FIND, label: 'Find boreholes' }] }),
    },
    startNode: { id: START },
    endNode: { id: END },
    // Listed out of run order: the rows follow the edges.
    executionNodes: [
      { id: WRITE, nodeType: 'PatchNode', queryId: 'urn:qv:write', backendConfig: { type: 'ephemeral-oxigraph', storeId: 's' } },
      { id: RULES, nodeType: 'RuleSetNode', ruleSetVersion: 'urn:rsv:litho' },
      { id: ASSAYS, nodeType: 'QueryNode', queryId: 'urn:qv:assays' },
      { id: FIND, nodeType: 'QueryNode', queryId: 'urn:qv:find', backendId: 'urn:backend:graphdb' },
    ],
    edges: [
      { id: 'e1', sourceNodeId: START, targetNodeId: FIND },
      { id: 'e2', sourceNodeId: FIND, targetNodeId: ASSAYS },
      { id: 'e3', sourceNodeId: ASSAYS, targetNodeId: RULES },
      { id: 'e4', sourceNodeId: RULES, targetNodeId: WRITE },
      { id: 'e5', sourceNodeId: WRITE, targetNodeId: END },
    ],
    queryVersions: [
      { id: 'urn:qv:find', isPartOf: 'urn:query:find', version: 3, queryString: 'SELECT ?hole WHERE { ?hole a :Borehole }' },
      { id: 'urn:qv:assays', isPartOf: 'urn:query:assays', version: 2, queryString: 'SELECT ?a WHERE { ?a a :Assay }' },
      { id: 'urn:qv:write', isPartOf: 'urn:query:write', version: 1, queryString: 'INSERT DATA {}' },
    ],
    iriMap: {
      'urn:qv:find': 'Boreholes by tenement',
      'urn:qv:assays': 'Assay summary',
      'urn:qv:write': 'Add assay links',
      'urn:rsv:litho': 'Lithology rules',
    },
  } as unknown as QueryGroupVersionExpanded;
}

describe('groupNodeRows', () => {
  it('lists execution nodes in run order, named by label or source', () => {
    const rows = groupNodeRows(expanded());
    expect(rows.map((row) => [row.order, row.name, row.sourceName, row.sourceVersion])).toEqual([
      [1, 'Find boreholes', 'Boreholes by tenement', 3],
      [2, 'Assay summary', null, 2],
      [3, 'Lithology rules', null, null],
      [4, 'Add assay links', null, 1],
    ]);
  });

  it('names where each node runs', () => {
    const rows = groupNodeRows(expanded());
    expect(rows.map((row) => row.target)).toEqual([
      { kind: 'backend', backendId: 'urn:backend:graphdb' },
      { kind: 'none' },
      { kind: 'inProcess' },
      { kind: 'ephemeral' },
    ]);
    expect(rows[0]!.queryString).toContain('Borehole');
  });
});

describe('groupNodeCosts', () => {
  it('takes p95, requests and failures per node', () => {
    const rows = groupNodeRows(expanded());
    const costs = groupNodeCosts(rows, [
      { node: FIND, durationMs: 10, success: true },
      { node: FIND, durationMs: 20, success: true },
      { node: FIND, durationMs: 99, success: false },
      { node: 'urn:node:other', durationMs: 5, success: true },
    ]);
    expect(costs[0]).toMatchObject({ samples: 3, failed: 1 });
    expect(costs[0]!.p95Ms).not.toBeNull();
    expect(costs[1]).toMatchObject({ samples: 0, failed: 0, p95Ms: null });
  });
});
