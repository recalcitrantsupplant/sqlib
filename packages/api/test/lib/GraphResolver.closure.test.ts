import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';

/**
 * The expanded group version is a transport closure: whatever port a returned
 * node or edge names, the response has to describe. These tests assert that
 * property directly rather than checking individual arrays, because every way
 * the closure has broken so far looked the same from the client - a node with
 * a query version and no ports, or an edge with no selectable endpoint.
 */

const hoisted = vi.hoisted(() => ({
  get: vi.fn(),
  getByType: vi.fn(),
  QueryNodes: { findByIri: vi.fn() },
  QueryEdges: { findByIri: vi.fn() },
  DynamicQueryNodes: { findByIri: vi.fn() },
  RuleSetNodes: { findByIri: vi.fn() },
  StartNodes: { findByIri: vi.fn() },
  EndNodes: { findByIri: vi.fn() },
  loadTriplesQuadsIOsByIds: vi.fn(),
  loadBooleanIOsByIds: vi.fn(),
  loadQueryIdInputsByIds: vi.fn(),
  loadQueryInputTuplesByIds: vi.fn(),
  loadQueryOutputTuplesByIds: vi.fn(),
  loadQueryVersionsByIds: vi.fn(),
  loadTupleMembersByIds: vi.fn(),
  loadQueryInputVariablesByIds: vi.fn(),
  loadQueryOutputVariablesByIds: vi.fn(),
}));

/** Serve a fixed set of entities from whichever loader matches their type. */
const byType = (entities: Array<Record<string, unknown>>, type: string) =>
  async (ids: string[]) => entities.filter(e => e['@type'] === type && ids.includes(e.$id as string));

type Expanded = Awaited<ReturnType<typeof import('../../src/lib/GraphResolver.js').expandGroupVersionDetailed>>;

/**
 * Every port a node or edge names resolves to a typed I/O entity; every tuple
 * member resolves; every member's variable resolves.
 */
function closureGaps(expanded: Expanded): string[] {
  const gaps: string[] = [];

  const ports = new Map<string, string>();
  const record = (entities: Array<{ id?: string }>, kind: string) => {
    for (const entity of entities) {
      if (entity?.id) ports.set(entity.id, kind);
    }
  };
  record(expanded.inputTuples as Array<{ id?: string }>, 'QueryInputTuple');
  record(expanded.outputTuples as Array<{ id?: string }>, 'QueryOutputTuple');
  record(expanded.rdfOutputs as Array<{ id?: string }>, 'TriplesQuadsIO');
  record(expanded.booleanOutputs as Array<{ id?: string }>, 'BooleanIO');
  record(expanded.queryIdInputs as Array<{ id?: string }>, 'QueryIdInput');

  const refs = new Map<string, string>();
  const addRefs = (owner: string, values: unknown) => {
    if (!Array.isArray(values)) return;
    for (const value of values) {
      if (typeof value === 'string' && value) refs.set(value, owner);
    }
  };

  const nodes: Array<Record<string, unknown>> = [
    ...(expanded.executionNodes as Array<Record<string, unknown>>),
    ...(expanded.startNode ? [expanded.startNode as Record<string, unknown>] : []),
    ...(expanded.endNode ? [expanded.endNode as Record<string, unknown>] : []),
  ];
  for (const node of nodes) {
    addRefs(`node ${String(node.id)}`, node.inputs);
    addRefs(`node ${String(node.id)}`, node.outputs);
  }
  for (const edge of expanded.edges as Array<Record<string, unknown>>) {
    addRefs(`edge ${String(edge.id)}`, [edge.sourceOutputId, edge.targetInputId].filter(Boolean));
  }
  for (const queryVersion of expanded.queryVersions as Array<Record<string, unknown>>) {
    addRefs(`query version ${String(queryVersion.id)}`, queryVersion.inferredInputs);
    addRefs(`query version ${String(queryVersion.id)}`, queryVersion.inferredOutputs);
  }

  for (const [ref, owner] of refs) {
    if (!ports.has(ref)) gaps.push(`${owner} references unresolved port ${ref}`);
  }

  const members = new Map(
    (expanded.tupleMembers as Array<{ id?: string; variable?: string }>).map(member => [member.id ?? '', member]),
  );
  const variables = new Set([
    ...(expanded.inputs as Array<{ id?: string }>).map(v => v.id),
    ...(expanded.outputs as Array<{ id?: string }>).map(v => v.id),
  ]);

  const tuples = [
    ...(expanded.inputTuples as Array<{ id?: string; memberEntries?: string[] | null }>),
    ...(expanded.outputTuples as Array<{ id?: string; memberEntries?: string[] | null }>),
  ];
  for (const tuple of tuples) {
    for (const memberId of tuple.memberEntries ?? []) {
      const member = members.get(memberId);
      if (!member) {
        gaps.push(`tuple ${tuple.id} references unresolved member ${memberId}`);
        continue;
      }
      if (!member.variable || !variables.has(member.variable)) {
        gaps.push(`member ${memberId} references unresolved variable ${member.variable}`);
      }
    }
  }

  return gaps;
}

describe('expandGroupVersionDetailed I/O closure', () => {
  let expandGroupVersionDetailed: typeof import('../../src/lib/GraphResolver.js').expandGroupVersionDetailed;

  beforeEach(async () => {
    vi.resetModules();
    for (const value of Object.values(hoisted)) {
      if (typeof value === 'function') value.mockReset();
      else Object.values(value).forEach(fn => (fn as ReturnType<typeof vi.fn>).mockReset());
    }

    vi.doMock('../../src/persistence/utils/QueryNodeUtils.js', () => ({ QueryNodes: hoisted.QueryNodes }));
    vi.doMock('../../src/persistence/utils/QueryEdgeUtils.js', () => ({ QueryEdges: hoisted.QueryEdges }));
    vi.doMock('../../src/persistence/utils/DynamicQueryNodeUtils.js', () => ({ DynamicQueryNodes: hoisted.DynamicQueryNodes }));
    vi.doMock('../../src/persistence/utils/RuleSetNodeUtils.js', () => ({ RuleSetNodes: hoisted.RuleSetNodes }));
    vi.doMock('../../src/persistence/utils/StartNodeUtils.js', () => ({ StartNodes: hoisted.StartNodes }));
    vi.doMock('../../src/persistence/utils/EndNodeUtils.js', () => ({ EndNodes: hoisted.EndNodes }));
    vi.doMock('../../src/persistence/utils/TriplesQuadsIOUtils.js', () => ({
      loadTriplesQuadsIOsByIds: hoisted.loadTriplesQuadsIOsByIds,
    }));
    vi.doMock('../../src/persistence/utils/BooleanIOUtils.js', () => ({
      loadBooleanIOsByIds: hoisted.loadBooleanIOsByIds,
    }));
    vi.doMock('../../src/persistence/utils/QueryIdInputUtils.js', () => ({
      loadQueryIdInputsByIds: hoisted.loadQueryIdInputsByIds,
    }));
    vi.doMock('../../src/persistence/utils/QueryInputTupleUtils.js', () => ({
      loadQueryInputTuplesByIds: hoisted.loadQueryInputTuplesByIds,
    }));
    vi.doMock('../../src/persistence/utils/QueryOutputTupleUtils.js', () => ({
      loadQueryOutputTuplesByIds: hoisted.loadQueryOutputTuplesByIds,
    }));
    vi.doMock('../../src/persistence/utils/QueryVersionUtils.js', () => ({
      loadQueryVersionsByIds: hoisted.loadQueryVersionsByIds,
    }));
    vi.doMock('../../src/persistence/utils/TupleMemberUtils.js', () => ({
      loadTupleMembersByIds: hoisted.loadTupleMembersByIds,
    }));
    vi.doMock('../../src/persistence/utils/QueryInputVariableUtils.js', () => ({
      loadQueryInputVariablesByIds: hoisted.loadQueryInputVariablesByIds,
    }));
    vi.doMock('../../src/persistence/utils/QueryOutputVariableUtils.js', () => ({
      loadQueryOutputVariablesByIds: hoisted.loadQueryOutputVariablesByIds,
    }));
    vi.doMock('../../src/lib/CacheCoordinatorProvider.js', () => ({
      getCacheCoordinator: () => ({ get: hoisted.get, list: hoisted.getByType }),
    }));

    ({ expandGroupVersionDetailed } = await import('../../src/lib/GraphResolver.js'));
  });

  afterEach(() => {
    vi.resetModules();
  });

  /**
   * The store, described once. Every loader mock reads from it, so a test only
   * has to say which entities exist - not which repository each one lives in.
   */
  const buildStore = () => {
    const entities: Array<Record<string, unknown>> = [
      // Group boundary input tuple, owned by the group and hung off the start node.
      { $id: 'urn:sqlib:input-tuple:boundary', '@type': 'QueryInputTuple', name: 'Cities', memberEntries: ['urn:sqlib:tuple-member:boundary-0'] },
      { $id: 'urn:sqlib:tuple-member:boundary-0', '@type': 'TupleMember', position: 0, variable: 'urn:sqlib:input:city' },
      { $id: 'urn:sqlib:input:city', '@type': 'QueryInputVariable', variableName: 'city' },

      // SELECT query version: one input tuple of two variables, one output tuple of three.
      { $id: 'urn:sqlib:input-tuple:select-in', '@type': 'QueryInputTuple', name: 'city-country', memberEntries: ['urn:sqlib:tuple-member:in-0', 'urn:sqlib:tuple-member:in-1'] },
      { $id: 'urn:sqlib:tuple-member:in-0', '@type': 'TupleMember', position: 0, variable: 'urn:sqlib:input:city' },
      { $id: 'urn:sqlib:tuple-member:in-1', '@type': 'TupleMember', position: 1, variable: 'urn:sqlib:input:country' },
      { $id: 'urn:sqlib:input:country', '@type': 'QueryInputVariable', variableName: 'country' },
      { $id: 'urn:sqlib:output-tuple:select-out', '@type': 'QueryOutputTuple', name: 'results', memberEntries: ['urn:sqlib:tuple-member:out-0', 'urn:sqlib:tuple-member:out-1', 'urn:sqlib:tuple-member:out-2'] },
      { $id: 'urn:sqlib:tuple-member:out-0', '@type': 'TupleMember', position: 0, variable: 'urn:sqlib:output:city' },
      { $id: 'urn:sqlib:tuple-member:out-1', '@type': 'TupleMember', position: 1, variable: 'urn:sqlib:output:pop' },
      { $id: 'urn:sqlib:tuple-member:out-2', '@type': 'TupleMember', position: 2, variable: 'urn:sqlib:output:area' },
      { $id: 'urn:sqlib:output:city', '@type': 'QueryOutputVariable', variableName: 'city' },
      { $id: 'urn:sqlib:output:pop', '@type': 'QueryOutputVariable', variableName: 'pop' },
      { $id: 'urn:sqlib:output:area', '@type': 'QueryOutputVariable', variableName: 'area' },

      // CONSTRUCT query version: an RDF output hanging off a query node.
      { $id: 'urn:sqlib:triples-quads-io:construct-out', '@type': 'TriplesQuadsIO', name: 'RDF Graph' },
      // ASK query version: a boolean output.
      { $id: 'urn:sqlib:boolean-io:ask-out', '@type': 'BooleanIO', name: 'Boolean' },
      // QUERY_ID dispatch target.
      { $id: 'urn:sqlib:query-id-input:dyn-in', '@type': 'QueryIdInput', name: 'Query' },

      { $id: 'urn:sqlib:query-version:select', '@type': 'QueryVersion', isPartOf: 'urn:sqlib:query:select', version: 1, queryString: 'SELECT *', inferredInputs: ['urn:sqlib:input-tuple:select-in'], inferredOutputs: ['urn:sqlib:output-tuple:select-out'] },
      { $id: 'urn:sqlib:query-version:construct', '@type': 'QueryVersion', isPartOf: 'urn:sqlib:query:construct', version: 1, queryString: 'CONSTRUCT {}', inferredOutputs: ['urn:sqlib:triples-quads-io:construct-out'] },
      { $id: 'urn:sqlib:query-version:ask', '@type': 'QueryVersion', isPartOf: 'urn:sqlib:query:ask', version: 1, queryString: 'ASK {}', inferredOutputs: ['urn:sqlib:boolean-io:ask-out'] },
    ];

    hoisted.loadQueryInputTuplesByIds.mockImplementation(byType(entities, 'QueryInputTuple'));
    hoisted.loadQueryOutputTuplesByIds.mockImplementation(byType(entities, 'QueryOutputTuple'));
    hoisted.loadTriplesQuadsIOsByIds.mockImplementation(byType(entities, 'TriplesQuadsIO'));
    hoisted.loadBooleanIOsByIds.mockImplementation(byType(entities, 'BooleanIO'));
    hoisted.loadQueryIdInputsByIds.mockImplementation(byType(entities, 'QueryIdInput'));
    hoisted.loadTupleMembersByIds.mockImplementation(byType(entities, 'TupleMember'));
    hoisted.loadQueryInputVariablesByIds.mockImplementation(byType(entities, 'QueryInputVariable'));
    hoisted.loadQueryOutputVariablesByIds.mockImplementation(byType(entities, 'QueryOutputVariable'));
    hoisted.loadQueryVersionsByIds.mockImplementation(byType(entities, 'QueryVersion'));

    return entities;
  };

  const mountGraph = (graph: Record<string, Record<string, unknown>>) => {
    hoisted.get.mockImplementation((id: string) => graph[id] ?? null);
    for (const finder of [
      hoisted.QueryNodes.findByIri,
      hoisted.QueryEdges.findByIri,
      hoisted.DynamicQueryNodes.findByIri,
      hoisted.RuleSetNodes.findByIri,
      hoisted.StartNodes.findByIri,
      hoisted.EndNodes.findByIri,
    ]) {
      finder.mockResolvedValue(null);
    }
  };

  it('returns the complete closure for a SELECT graph with a group boundary tuple', async () => {
    buildStore();
    mountGraph({
      'urn:sqlib:start-node:1': { $id: 'urn:sqlib:start-node:1', '@type': 'StartNode', outputs: ['urn:sqlib:input-tuple:boundary'] },
      'urn:sqlib:node:select': {
        $id: 'urn:sqlib:node:select',
        '@type': 'QueryNode',
        nodeType: 'QueryNode',
        queryId: 'urn:sqlib:query-version:select',
        inputs: ['urn:sqlib:input-tuple:select-in'],
        outputs: ['urn:sqlib:output-tuple:select-out'],
      },
      'urn:sqlib:end-node:1': { $id: 'urn:sqlib:end-node:1', '@type': 'EndNode', inputs: ['urn:sqlib:output-tuple:select-out'] },
      'urn:sqlib:edge:boundary': {
        $id: 'urn:sqlib:edge:boundary',
        '@type': 'QueryEdge',
        sourceNodeId: 'urn:sqlib:start-node:1',
        targetNodeId: 'urn:sqlib:node:select',
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: 'urn:sqlib:input-tuple:boundary',
        targetInputId: 'urn:sqlib:input-tuple:select-in',
      },
      'urn:sqlib:edge:out': {
        $id: 'urn:sqlib:edge:out',
        '@type': 'QueryEdge',
        sourceNodeId: 'urn:sqlib:node:select',
        targetNodeId: 'urn:sqlib:end-node:1',
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: 'urn:sqlib:output-tuple:select-out',
        targetInputId: 'urn:sqlib:output-tuple:select-out',
      },
    });

    const expanded = await expandGroupVersionDetailed({
      $id: 'urn:sqlib:group-version:1',
      '@type': 'QueryGroupVersion',
      version: 1,
      startNode: 'urn:sqlib:start-node:1',
      endNode: 'urn:sqlib:end-node:1',
      executionNodes: ['urn:sqlib:node:select'],
      edges: ['urn:sqlib:edge:boundary', 'urn:sqlib:edge:out'],
    } as never);

    expect(closureGaps(expanded)).toEqual([]);

    // The start node's outputs are the group's *input* tuples. Bucketing them
    // by the word "output" dropped them, which emptied the start inspector and
    // the boundary edge's source list.
    expect(expanded.inputTuples.map(t => (t as { id: string }).id)).toContain('urn:sqlib:input-tuple:boundary');
    expect(expanded.inputs.map(v => (v as { id: string }).id)).toContain('urn:sqlib:input:city');
  });

  it('resolves RDF, boolean and query-id ports declared on query nodes', async () => {
    buildStore();
    mountGraph({
      'urn:sqlib:node:construct': {
        $id: 'urn:sqlib:node:construct',
        '@type': 'QueryNode',
        nodeType: 'QueryNode',
        queryId: 'urn:sqlib:query-version:construct',
        inputs: [],
        outputs: ['urn:sqlib:triples-quads-io:construct-out'],
      },
      'urn:sqlib:node:ask': {
        $id: 'urn:sqlib:node:ask',
        '@type': 'QueryNode',
        nodeType: 'QueryNode',
        queryId: 'urn:sqlib:query-version:ask',
        inputs: [],
        outputs: ['urn:sqlib:boolean-io:ask-out'],
      },
      'urn:sqlib:dyn-node:1': {
        $id: 'urn:sqlib:dyn-node:1',
        '@type': 'DynamicQueryNode',
        nodeType: 'DynamicQueryNode',
        inputs: ['urn:sqlib:query-id-input:dyn-in'],
        outputs: [],
      },
    });

    const expanded = await expandGroupVersionDetailed({
      $id: 'urn:sqlib:group-version:2',
      '@type': 'QueryGroupVersion',
      version: 1,
      executionNodes: ['urn:sqlib:node:construct', 'urn:sqlib:node:ask', 'urn:sqlib:dyn-node:1'],
      edges: [],
    } as never);

    expect(closureGaps(expanded)).toEqual([]);
    // A CONSTRUCT node's RDF output was only ever collected for ruleset and end
    // nodes, so the port came back untyped and every compatibility list hid it.
    expect(expanded.rdfOutputs.map(o => (o as { id: string }).id)).toEqual(['urn:sqlib:triples-quads-io:construct-out']);
    expect(expanded.booleanOutputs.map(o => (o as { id: string }).id)).toEqual(['urn:sqlib:boolean-io:ask-out']);
    expect(expanded.queryIdInputs.map(o => (o as { id: string }).id)).toEqual(['urn:sqlib:query-id-input:dyn-in']);
  });

  it('describes each shared port once when two nodes reference the same query version', async () => {
    buildStore();
    mountGraph({
      'urn:sqlib:node:a': {
        $id: 'urn:sqlib:node:a',
        '@type': 'QueryNode',
        nodeType: 'QueryNode',
        queryId: 'urn:sqlib:query-version:select',
        inputs: ['urn:sqlib:input-tuple:select-in'],
        outputs: ['urn:sqlib:output-tuple:select-out'],
      },
      'urn:sqlib:node:b': {
        $id: 'urn:sqlib:node:b',
        '@type': 'QueryNode',
        nodeType: 'QueryNode',
        queryId: 'urn:sqlib:query-version:select',
        inputs: ['urn:sqlib:input-tuple:select-in'],
        outputs: ['urn:sqlib:output-tuple:select-out'],
      },
    });

    const expanded = await expandGroupVersionDetailed({
      $id: 'urn:sqlib:group-version:3',
      '@type': 'QueryGroupVersion',
      version: 1,
      executionNodes: ['urn:sqlib:node:a', 'urn:sqlib:node:b'],
      edges: [],
    } as never);

    expect(closureGaps(expanded)).toEqual([]);
    expect(expanded.inputTuples).toHaveLength(1);
    expect(expanded.outputTuples).toHaveLength(1);
    expect(expanded.queryVersions).toHaveLength(1);
  });

  it('recovers a query version canonical port that the node no longer lists', async () => {
    buildStore();
    mountGraph({
      // A node saved before its query version gained an input tuple: its own
      // arrays are stale, but the canonical interface still belongs to it.
      'urn:sqlib:node:stale': {
        $id: 'urn:sqlib:node:stale',
        '@type': 'QueryNode',
        nodeType: 'QueryNode',
        queryId: 'urn:sqlib:query-version:select',
        inputs: [],
        outputs: [],
      },
    });

    const expanded = await expandGroupVersionDetailed({
      $id: 'urn:sqlib:group-version:4',
      '@type': 'QueryGroupVersion',
      version: 1,
      executionNodes: ['urn:sqlib:node:stale'],
      edges: [],
    } as never);

    expect(closureGaps(expanded)).toEqual([]);
    expect(expanded.inputTuples.map(t => (t as { id: string }).id)).toEqual(['urn:sqlib:input-tuple:select-in']);
    expect(expanded.outputTuples.map(t => (t as { id: string }).id)).toEqual(['urn:sqlib:output-tuple:select-out']);
  });

  it('resolves a port whose IRI carries no recognised minting prefix', async () => {
    buildStore();
    hoisted.loadQueryOutputTuplesByIds.mockImplementation(async (ids: string[]) =>
      ids.includes('urn:legacy:port:1')
        ? [{ $id: 'urn:legacy:port:1', '@type': 'QueryOutputTuple', name: 'Legacy', memberEntries: [] }]
        : [],
    );
    mountGraph({
      'urn:sqlib:node:legacy': {
        $id: 'urn:sqlib:node:legacy',
        '@type': 'QueryNode',
        nodeType: 'QueryNode',
        queryId: null,
        inputs: [],
        outputs: ['urn:legacy:port:1'],
      },
    });

    const expanded = await expandGroupVersionDetailed({
      $id: 'urn:sqlib:group-version:5',
      '@type': 'QueryGroupVersion',
      version: 1,
      executionNodes: ['urn:sqlib:node:legacy'],
      edges: [],
    } as never);

    expect(closureGaps(expanded)).toEqual([]);
    expect(expanded.outputTuples.map(t => (t as { id: string }).id)).toEqual(['urn:legacy:port:1']);
  });

  it('warns with the offending refs when a referenced port cannot be resolved', async () => {
    buildStore();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mountGraph({
      'urn:sqlib:node:broken': {
        $id: 'urn:sqlib:node:broken',
        '@type': 'QueryNode',
        nodeType: 'QueryNode',
        queryId: null,
        inputs: ['urn:sqlib:input-tuple:vanished'],
        outputs: [],
      },
    });

    const expanded = await expandGroupVersionDetailed({
      $id: 'urn:sqlib:group-version:6',
      '@type': 'QueryGroupVersion',
      version: 1,
      executionNodes: ['urn:sqlib:node:broken'],
      edges: [],
    } as never);

    // The gap is reported rather than papered over: the node still comes back
    // naming the port, so the client can render "metadata unavailable" instead
    // of an empty port list that looks like a query with no inputs.
    expect(closureGaps(expanded)).toEqual([
      'node urn:sqlib:node:broken references unresolved port urn:sqlib:input-tuple:vanished',
    ]);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('could not be resolved'),
      ['urn:sqlib:input-tuple:vanished'],
    );
    warn.mockRestore();
  });
});

afterAll(() => {
  vi.resetModules();
});
