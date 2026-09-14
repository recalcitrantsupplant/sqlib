import { describe, expect, it } from 'vitest';
import {
  collectLibraryGroups,
  type GroupGraphEntity,
  type LibraryGroupSource,
} from '../../../src/lib/export/collectLibraryGroups.js';
import type { LdkitQueryGroup } from '../../../src/persistence/schemas/QueryGroupSchema.js';
import type { LdkitQueryGroupVersion } from '../../../src/persistence/schemas/QueryGroupVersionSchema.js';

const LIBRARY = 'urn:sqlib:library:main';
const OTHER = 'urn:sqlib:library:other';

const CITIES = 'SELECT ?city WHERE { VALUES (?region) { (UNDEF) } ?city :inRegion ?region }';
const PEOPLE = 'SELECT ?name WHERE { VALUES (?place) { (UNDEF) } ?p :livesIn ?place ; :name ?name }';

/**
 * A group as it is actually stored: nodes, edges, tuples, members and the
 * variables the members point at, all separate entities. The fixture builds the
 * whole web so the tests exercise the same walk the export performs.
 */
function graph(overrides: Record<string, GroupGraphEntity> = {}): Record<string, GroupGraphEntity> {
  const tuple = (id: string, type: string, ...names: string[]): Record<string, GroupGraphEntity> => {
    const entities: Record<string, GroupGraphEntity> = {
      [id]: { '@type': type, memberEntries: names.map((_, index) => `${id}-m${index}`) },
    };
    names.forEach((name, index) => {
      entities[`${id}-m${index}`] = {
        '@type': 'TupleMember',
        position: index,
        variable: `${id}-v${index}`,
      };
      entities[`${id}-v${index}`] = {
        '@type': type === 'QueryOutputTuple' ? 'QueryOutputVariable' : 'QueryInputVariable',
        variableName: name,
      };
    });
    return entities;
  };

  return {
    start: { '@type': 'StartNode' },
    end: { '@type': 'EndNode' },
    n1: { '@type': 'QueryNode', queryId: 'qv1', inputs: ['in-region'], outputs: ['out-city'] },
    n2: { '@type': 'QueryNode', queryId: 'qv2', inputs: ['in-place'], outputs: ['out-name'] },
    qv1: { '@type': 'QueryVersion', $id: 'qv1', isPartOf: 'q1', version: 1, queryString: CITIES },
    qv2: { '@type': 'QueryVersion', $id: 'qv2', isPartOf: 'q2', version: 1, queryString: PEOPLE },
    q1: { '@type': 'Query', $id: 'q1', name: 'Cities in region' },
    q2: { '@type': 'Query', $id: 'q2', name: 'People in place' },
    ...tuple('in-region', 'QueryInputTuple', 'region'),
    ...tuple('in-place', 'QueryInputTuple', 'place'),
    ...tuple('out-city', 'QueryOutputTuple', 'city'),
    ...tuple('out-name', 'QueryOutputTuple', 'name'),
    e1: {
      '@type': 'QueryEdge',
      sourceNodeId: 'n1',
      targetNodeId: 'n2',
      dataFlowType: 'VARIABLE_BINDINGS',
      sourceOutputId: 'out-city',
      targetInputId: 'in-place',
    },
    e2: {
      '@type': 'QueryEdge',
      sourceNodeId: 'n2',
      targetNodeId: 'end',
      dataFlowType: 'VARIABLE_BINDINGS',
      sourceOutputId: 'out-name',
      targetInputId: 'out-name',
    },
    ...overrides,
  };
}

function source(
  entities: Record<string, GroupGraphEntity>,
  group: Partial<LdkitQueryGroup> = {},
  version: Partial<LdkitQueryGroupVersion> = {},
): LibraryGroupSource {
  const groups: LdkitQueryGroup[] = [
    {
      $id: 'g1',
      name: 'People by region',
      isPartOf: LIBRARY,
      currentVersion: 'gv1',
      ...group,
    } as LdkitQueryGroup,
  ];
  const versions: Record<string, LdkitQueryGroupVersion> = {
    gv1: {
      $id: 'gv1',
      isPartOf: 'g1',
      version: 1,
      startNode: 'start',
      endNode: 'end',
      executionNodes: ['n1', 'n2'],
      edges: ['e1', 'e2'],
      ...version,
    } as LdkitQueryGroupVersion,
  };

  return {
    listGroups: () => groups,
    getGroupVersion: (id) => versions[id] ?? null,
    getEntity: (id) => entities[id] ?? null,
  };
}

const only = (result: ReturnType<typeof collectLibraryGroups>) => result.groups[0];
const reason = (result: ReturnType<typeof collectLibraryGroups>) => result.skipped[0]?.reason ?? '';

describe('collectLibraryGroups', () => {
  it('reduces a chained group to nodes, edges and a result node', () => {
    const result = collectLibraryGroups(source(graph()), LIBRARY);

    expect(result.skipped).toEqual([]);
    expect(only(result)).toEqual({
      name: 'People by region',
      sourceGroup: 'g1',
      sourceVersion: 'gv1',
      nodes: [
        {
          key: 'cities-in-region',
          sourceNode: 'n1',
          name: 'Cities in region',
          queryString: CITIES,
          sourceQuery: 'q1',
          sourceVersion: 'qv1',
        },
        {
          key: 'people-in-place',
          sourceNode: 'n2',
          name: 'People in place',
          queryString: PEOPLE,
          sourceQuery: 'q2',
          sourceVersion: 'qv2',
        },
      ],
      edges: [
        {
          from: 'cities-in-region',
          to: 'people-in-place',
          targetVars: ['place'],
          // Different names either side, so the default pairs them by position —
          // the same answer the engine's resolveVariableMappings gives.
          mappings: [{ source: 'city', target: 'place' }],
          sourceEdge: 'e1',
        },
      ],
      // The end node does not execute; whatever fed it is the answer.
      resultNode: 'people-in-place',
    });
  });

  it('takes the author\'s stored variable mapping over the default pairing', () => {
    const result = collectLibraryGroups(
      source(
        graph({
          e1: {
            ...graph().e1,
            variableMappings: JSON.stringify([{ source: 'city', target: 'place' }]),
          },
        }),
      ),
      LIBRARY,
    );

    expect(only(result).edges[0].mappings).toEqual([{ source: 'city', target: 'place' }]);
  });

  it('carries the edge\'s whenEmpty policy, and only a known one', () => {
    const withPolicy = collectLibraryGroups(
      source(graph({ e1: { ...graph().e1, whenEmpty: 'require' } })),
      LIBRARY,
    );
    expect(only(withPolicy).edges[0].whenEmpty).toBe('require');

    const nonsense = collectLibraryGroups(
      source(graph({ e1: { ...graph().e1, whenEmpty: 'sometimes' } })),
      LIBRARY,
    );
    expect(only(nonsense).edges[0].whenEmpty).toBeUndefined();
  });

  it('drops a start node edge: its rows are the caller\'s own arguments', () => {
    const entities = graph({
      e0: {
        '@type': 'QueryEdge',
        sourceNodeId: 'start',
        targetNodeId: 'n1',
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: 'in-region',
        targetInputId: 'in-region',
      },
    });
    const result = collectLibraryGroups(
      source(entities, {}, { edges: ['e0', 'e1', 'e2'] }),
      LIBRARY,
    );

    expect(only(result).edges.map((edge) => edge.sourceEdge)).toEqual(['e1']);
  });

  it('ignores groups belonging to another library, and filters by tag', () => {
    const elsewhere = collectLibraryGroups(source(graph(), { isPartOf: OTHER }), LIBRARY);
    expect(elsewhere.groups).toEqual([]);
    expect(elsewhere.skipped).toEqual([]);

    const tagged = collectLibraryGroups(source(graph(), { tags: ['urn:tag:demo'] }), LIBRARY, {
      tags: ['urn:tag:other'],
    });
    expect(tagged.groups).toEqual([]);
  });

  it('reports a group with no current version rather than failing the export', () => {
    const result = collectLibraryGroups(source(graph(), { currentVersion: undefined }), LIBRARY);
    expect(result.groups).toEqual([]);
    expect(result.skipped).toEqual([
      { id: 'g1', name: 'People by region', reason: 'The group has no current version.' },
    ]);
  });
});

describe('groups the static runtime cannot walk', () => {
  it('refuses a node that is not a query', () => {
    const result = collectLibraryGroups(
      source(graph({ n2: { '@type': 'RuleSetNode', ruleSetVersion: 'rv1' } })),
      LIBRARY,
    );
    expect(result.groups).toEqual([]);
    expect(reason(result)).toContain('is a RuleSetNode');
  });

  it('refuses an edge that moves RDF rather than rows', () => {
    const result = collectLibraryGroups(
      source(graph({ e1: { ...graph().e1, dataFlowType: 'RDF_GRAPH' } })),
      LIBRARY,
    );
    expect(reason(result)).toContain('RDF_GRAPH edge');
  });

  it('refuses a start node that hands in a data graph', () => {
    const entities = graph({
      e0: {
        '@type': 'QueryEdge',
        sourceNodeId: 'start',
        targetNodeId: 'n1',
        dataFlowType: 'RDF_GRAPH',
        sourceOutputId: 'graph-in',
        targetInputId: 'graph-in',
      },
    });
    const result = collectLibraryGroups(
      source(entities, {}, { edges: ['e0', 'e1', 'e2'] }),
      LIBRARY,
    );
    expect(reason(result)).toContain('Only tabular inputs reach an exported group');
  });

  it('refuses a boolean chained into a VALUES clause', () => {
    const result = collectLibraryGroups(
      source(graph({ 'out-city': { '@type': 'BooleanIO' } })),
      LIBRARY,
    );
    expect(reason(result)).toContain('chains a BooleanIO');
  });

  it('refuses an end node fed by two nodes, since merging needs a store', () => {
    const entities = graph({
      e3: {
        '@type': 'QueryEdge',
        sourceNodeId: 'n1',
        targetNodeId: 'end',
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: 'out-city',
        targetInputId: 'out-city',
      },
    });
    const result = collectLibraryGroups(
      source(entities, {}, { edges: ['e1', 'e2', 'e3'] }),
      LIBRARY,
    );
    expect(reason(result)).toContain('more than one data input');
  });

  it('refuses a group whose end node is connected to nothing', () => {
    const result = collectLibraryGroups(source(graph(), {}, { edges: ['e1'] }), LIBRARY);
    expect(reason(result)).toContain('Nothing is connected to its end node');
  });

  it('refuses a node whose query version has gone', () => {
    const entities = graph();
    delete entities.qv2;
    const result = collectLibraryGroups(source(entities), LIBRARY);
    expect(reason(result)).toContain('references missing QueryVersion qv2');
  });
});
