/**
 * The version diff matches nodes by what they are, because every saved version
 * mints new ids, and reports the rest as added or removed.
 */
import { describe, expect, it } from 'vitest';
import { diffGroupVersions } from '../../src/lib/groupVersionDiff';
import type { GraphEdgeState, GraphNodeState, QueryGroupGraphState } from '../../src/composables/useQueryGroupGraph';

const node = (id: string, kind: GraphNodeState['kind'], extra: Partial<GraphNodeState> = {}): GraphNodeState => ({
  id, kind, label: '', inputs: [], outputs: [], ...extra,
});

const edge = (id: string, source: string, target: string, extra: Partial<GraphEdgeState> = {}): GraphEdgeState => ({
  id, source, target, flowType: 'VARIABLE_BINDINGS', ...extra,
});

const state = (nodes: GraphNodeState[], edges: GraphEdgeState[], extra: Partial<QueryGroupGraphState> = {}): QueryGroupGraphState => ({
  version: {} as QueryGroupGraphState['version'],
  nodes,
  edges,
  ioEntities: {},
  tupleMembers: {},
  variables: {},
  queryVersionInterfaces: {},
  iriMap: { 'urn:q:cities:v1': 'Cities', 'urn:q:cities:v2': 'Cities', 'urn:q:countries:v1': 'Countries' },
  ...extra,
});

const v1 = state(
  [
    node('a-start', 'start'),
    node('a-cities', 'query', { queryVersionId: 'urn:q:cities:v1' }),
    node('a-countries', 'query', { queryVersionId: 'urn:q:countries:v1' }),
    node('a-end', 'end'),
  ],
  [
    edge('a-e1', 'a-start', 'a-cities'),
    edge('a-e2', 'a-cities', 'a-countries'),
    edge('a-e3', 'a-countries', 'a-end'),
  ],
);

describe('diffGroupVersions', () => {
  it('finds nothing between the same drawing under new ids', () => {
    const v2 = state(
      v1.nodes.map((entry) => ({ ...entry, id: entry.id.replace('a-', 'b-') })),
      v1.edges.map((entry) => ({ ...entry, id: entry.id.replace('a-', 'b-'), source: entry.source.replace('a-', 'b-'), target: entry.target.replace('a-', 'b-') })),
    );
    expect(diffGroupVersions(v1, v2).same).toBe(true);
  });

  it('reports a query bumped to a new version as a change, not a swap', () => {
    const v2 = state(
      v1.nodes.map((entry) => (entry.id === 'a-cities'
        ? { ...entry, id: 'b-cities', queryVersionId: 'urn:q:cities:v2' }
        : { ...entry, id: entry.id.replace('a-', 'b-') })),
      v1.edges.map((entry) => ({ ...entry, id: entry.id.replace('a-', 'b-'), source: entry.source.replace('a-', 'b-'), target: entry.target.replace('a-', 'b-') })),
    );
    const diff = diffGroupVersions(v1, v2);
    expect(diff.nodes.added).toEqual([]);
    expect(diff.nodes.removed).toEqual([]);
    expect(diff.nodes.changed).toEqual([{ name: 'Cities (query)', changes: ['query v1 → v2'] }]);
    expect(diff.edges.added).toEqual([]);
  });

  it('lists added and removed nodes and edges', () => {
    const v2 = state(
      [node('b-start', 'start'), node('b-cities', 'query', { queryVersionId: 'urn:q:cities:v1' }), node('b-end', 'end')],
      [edge('b-e1', 'b-start', 'b-cities'), edge('b-e2', 'b-cities', 'b-end', { flowType: 'CONTROL_FLOW' })],
    );
    const diff = diffGroupVersions(v1, v2);
    expect(diff.nodes.removed).toEqual(['Countries (query)']);
    expect(diff.edges.removed).toEqual(['Cities → Countries (bindings)', 'Countries → End (bindings)']);
    expect(diff.edges.added).toEqual(['Cities → End (control flow)']);
    expect(diff.same).toBe(false);
  });

  it('reports a renamed node as renamed', () => {
    const v2 = state(
      v1.nodes.map((entry) => (entry.id === 'a-countries' ? { ...entry, id: 'b-c', label: 'Nations' } : { ...entry, id: `b${entry.id}` })),
      [],
    );
    const diff = diffGroupVersions(v1, v2);
    expect(diff.nodes.changed).toEqual([{ name: 'Nations (query)', changes: ['renamed from “Countries”'] }]);
  });

  it('compares the group inputs', () => {
    const withInput = (variable: string) => state(
      [node('s', 'start', { outputs: [{ id: 't', label: 't', entityType: 'QueryInputTuple', direction: 'output', resolved: true } as GraphNodeState['outputs'][number]] })],
      [],
      {
        ioEntities: { t: { id: 't', kind: 'QueryInputTuple', memberEntries: ['m'] } },
        tupleMembers: { m: { id: 'm', position: 0, variable: 'v' } },
        variables: { v: { id: 'v', variableName: variable, direction: 'input' } },
      },
    );
    const diff = diffGroupVersions(withInput('city'), withInput('language'));
    expect(diff.inputs).toEqual({ added: ['?language'], removed: ['?city'] });
  });
});
