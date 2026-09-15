/**
 * The canvas half of the `PatchNode` (issue #290).
 *
 * The API half shipped without a browser half, which left the canvas as exactly
 * the client its writer guard was written about: it read a node with a
 * `queryId`, drew it as a query node, and sent it back as one — a save the
 * server refused rather than let it run the update the node exists only to
 * describe. Everything here is about the three things that stop being true once
 * the canvas knows the type: it loads one as a patch node, it sends one back as
 * a patch node with both halves named, and it says what a patch node may be
 * wired to.
 *
 * The rules are stated against the backend's own codes wherever there is one,
 * so a canvas that disagrees with `GraphBuilder` fails here rather than at a run.
 */

import { describe, it, expect } from 'vitest';
import type { QueryGroupVersionExpandedWithIriMap } from '@sparql-query-lib/contracts';

import {
  createGraphStateFromExpanded,
  graphStateToFlatPayload,
  type GraphEdgeState,
  type GraphNodeState,
  type QueryGroupGraphState,
} from '../../src/composables/useQueryGroupGraph';
import { validateEdge, checkNodeKinds } from '../../src/composables/queryGroupCompatibility';
import { liveValidationIssues } from '../../src/composables/useQueryGroupLiveValidation';
import { recommendFlowType, validateFlowTypeCompatibility } from '../../src/composables/edgeFlowTypeDefaults';

const UPDATE_QUERY_TYPE = 'https://sparql-query-lib/query-type/update';
const SELECT_QUERY_TYPE = 'https://sparql-query-lib/query-type/select';

const P = {
  group: 'urn:sqlib:group:patch',
  groupVersion: 'urn:sqlib:group-version:patch',
  startNode: 'urn:sqlib:start-node:patch',
  endNode: 'urn:sqlib:end-node:patch',
  patchNode: 'urn:sqlib:node:patch',
  rulesetNode: 'urn:sqlib:node:ruleset',
  updateVersion: 'urn:sqlib:query-version:update',
  updateQuery: 'urn:sqlib:query:update',
  deletions: 'urn:sqlib:triples-quads-io:deletions',
  additions: 'urn:sqlib:triples-quads-io:additions',
  rulesetIn: 'urn:sqlib:triples-quads-io:ruleset-in',
  rulesetOut: 'urn:sqlib:triples-quads-io:ruleset-out',
  edge: 'urn:sqlib:edge:additions-to-ruleset',
  backend: 'urn:sqlib:backend:1',
} as const;

/**
 * A saved group whose patch node sends its additions to a rule set.
 *
 * Hand-built rather than taken from the shared fixture because the point is
 * what a *server* response looks like: `nodeType: 'PatchNode'` with
 * `deletionsOutput`/`additionsOutput` beside the ports they name.
 */
const patchGroupExpanded = (
  overrides: { deletionsOutput?: string | null; additionsOutput?: string | null } = {},
): QueryGroupVersionExpandedWithIriMap => {
  const patchNode = {
    id: P.patchNode,
    nodeType: 'PatchNode' as const,
    queryId: P.updateVersion,
    backendId: P.backend,
    inputs: [],
    outputs: [P.deletions, P.additions],
    deletionsOutput: 'deletionsOutput' in overrides ? overrides.deletionsOutput : P.deletions,
    additionsOutput: 'additionsOutput' in overrides ? overrides.additionsOutput : P.additions,
  };
  const rulesetNode = {
    id: P.rulesetNode,
    nodeType: 'RuleSetNode' as const,
    ruleSetVersion: 'urn:sqlib:rule-set-version:1',
    inputs: [P.rulesetIn],
    outputs: [P.rulesetOut],
  };

  return {
    queryGroupVersion: {
      id: P.groupVersion,
      isPartOf: P.group,
      version: 1,
      startNode: P.startNode,
      endNode: P.endNode,
      executionNodes: [P.patchNode, P.rulesetNode],
      edges: [P.edge],
      canvasData: null,
      comment: null,
      dateCreated: null,
      dateModified: null,
    },
    executionNodes: [patchNode, rulesetNode],
    startNode: { id: P.startNode, outputs: [] },
    endNode: { id: P.endNode, inputs: [P.rulesetOut], mediaType: null },
    edges: [
      {
        id: P.edge,
        sourceNodeId: P.patchNode,
        targetNodeId: P.rulesetNode,
        dataFlowType: 'RDF_GRAPH',
        sourceOutputId: P.additions,
        targetInputId: P.rulesetIn,
        variableMappings: null,
      },
    ],
    inputTuples: [],
    outputTuples: [],
    tupleMembers: [],
    inputs: [],
    outputs: [],
    rdfOutputs: [
      { id: P.deletions, name: 'deletions' },
      { id: P.additions, name: 'additions' },
      { id: P.rulesetIn, name: 'ruleset input' },
      { id: P.rulesetOut, name: 'ruleset output' },
    ],
    booleanOutputs: [],
    queryIdInputs: [],
    queryVersions: [
      {
        id: P.updateVersion,
        isPartOf: P.updateQuery,
        version: 1,
        queryString: 'DELETE { ?s ?p ?o } INSERT { ?s ?p "new" } WHERE { ?s ?p ?o }',
        queryType: UPDATE_QUERY_TYPE,
        inferredInputs: [],
        inferredOutputs: [],
      },
    ],
    iriMap: { [P.updateVersion]: 'Retire the old value' },
  } as unknown as QueryGroupVersionExpandedWithIriMap;
};

const nodeIn = (state: QueryGroupGraphState, id: string): GraphNodeState =>
  state.nodes.find(node => node.id === id)!;

/** A patch node as the canvas builds one, without going through a payload. */
const patchNodeState = (overrides: Partial<GraphNodeState> = {}): GraphNodeState => ({
  id: P.patchNode,
  kind: 'patch',
  label: 'Patch Node',
  queryId: P.updateVersion,
  queryVersionId: P.updateVersion,
  queryType: UPDATE_QUERY_TYPE,
  backendId: P.backend,
  deletionsOutputId: P.deletions,
  additionsOutputId: P.additions,
  inputs: [],
  outputs: [
    { id: P.deletions, label: 'deletions', entityType: 'TriplesQuadsIO', direction: 'output', origin: 'query-group', resolved: true },
    { id: P.additions, label: 'additions', entityType: 'TriplesQuadsIO', direction: 'output', origin: 'query-group', resolved: true },
  ],
  ...overrides,
});

const otherNodeState = (kind: GraphNodeState['kind'], id: string): GraphNodeState => ({
  id,
  kind,
  label: `${kind} node`,
  inputs: [
    { id: P.rulesetIn, label: 'in', entityType: 'TriplesQuadsIO', direction: 'input', origin: 'query-group', resolved: true },
  ],
  outputs: [
    { id: P.rulesetOut, label: 'out', entityType: 'TriplesQuadsIO', direction: 'output', origin: 'query-group', resolved: true },
  ],
});

const rdfEdge = (overrides: Partial<GraphEdgeState> = {}): GraphEdgeState => ({
  id: P.edge,
  source: P.patchNode,
  target: P.rulesetNode,
  flowType: 'RDF_GRAPH',
  sourceOutputId: P.additions,
  targetInputId: P.rulesetIn,
  variableMappings: null,
  whenEmpty: null,
  ...overrides,
});

const emptyModel = { entities: {}, members: {}, variables: {} };

const errorCodes = (edge: GraphEdgeState, source: GraphNodeState, target: GraphNodeState) =>
  validateEdge(edge, source, target, emptyModel)
    .filter(issue => issue.level === 'error')
    .map(issue => issue.code);

describe('a patch node on the canvas', () => {
  it('loads as a patch node, not as the query node it looks like', () => {
    const state = createGraphStateFromExpanded(patchGroupExpanded());
    const node = nodeIn(state, P.patchNode);

    expect(node.kind).toBe('patch');
    // It keeps its query and its backend: the update it derives, and the store
    // it reads to work out what that update would change.
    expect(node.queryVersionId).toBe(P.updateVersion);
    expect(node.backendId).toBe(P.backend);
    expect(node.deletionsOutputId).toBe(P.deletions);
    expect(node.additionsOutputId).toBe(P.additions);
    expect(node.outputs.map(port => port.id)).toEqual([P.deletions, P.additions]);
  });

  /*
   * The round trip the writer guard exists for. A client that sent this back as
   * a QueryNode would be asking the server to save a node that runs the update.
   */
  it('is sent back as a patch node, with both halves named', () => {
    const state = createGraphStateFromExpanded(patchGroupExpanded());
    const sent = graphStateToFlatPayload(state).executionNodes.find(node => node.id === P.patchNode);

    expect(sent).toBeDefined();
    expect(sent!.nodeType).toBe('PatchNode');
    expect(sent).toMatchObject({
      queryId: P.updateVersion,
      backendId: P.backend,
      deletionsOutput: P.deletions,
      additionsOutput: P.additions,
    });
  });

  it('keeps the halves distinct through a load and a save', () => {
    const state = createGraphStateFromExpanded(patchGroupExpanded());
    const sent = graphStateToFlatPayload(state).executionNodes.find(node => node.id === P.patchNode) as {
      outputs: string[];
      deletionsOutput?: string | null;
      additionsOutput?: string | null;
    };

    expect(sent.deletionsOutput).not.toBe(sent.additionsOutput);
    // Each half has to be one of the node's own outputs, or it names a port no
    // edge could legally leave from.
    expect(sent.outputs).toContain(sent.deletionsOutput);
    expect(sent.outputs).toContain(sent.additionsOutput);
  });
});

describe('what may be wired to a patch node', () => {
  it('lets a half reach a rule set', () => {
    expect(errorCodes(rdfEdge(), patchNodeState(), otherNodeState('ruleset', P.rulesetNode))).toEqual([]);
  });

  it('lets a half reach the end node', () => {
    const end: GraphNodeState = { ...otherNodeState('end', P.endNode), inputs: [] };
    // The End node aliases its source port rather than owning one.
    const edge = rdfEdge({ target: P.endNode, targetInputId: P.additions });
    expect(errorCodes(edge, patchNodeState(), end)).toEqual([]);
  });

  /*
   * The one that would have gone wrong quietly. A patch node has an ephemeral
   * store of its own — that is how it derives over a supplied graph — so the
   * materialization check a query node's RDF input relies on would pass while
   * nothing was ever written into it, and the consumer would query an empty
   * store (the backend's EDGE_RDF_GRAPH_TARGET_CANNOT_CONSUME).
   */
  it('refuses to send a half to a query node', () => {
    const codes = errorCodes(
      rdfEdge({ target: 'urn:sqlib:node:query' }),
      patchNodeState(),
      otherNodeState('query', 'urn:sqlib:node:query'),
    );
    expect(codes).toContain('rdf-graph-target-cannot-consume');
  });

  it('refuses to send a half to another patch node', () => {
    const codes = errorCodes(
      rdfEdge({ target: 'urn:sqlib:node:patch-2' }),
      patchNodeState(),
      patchNodeState({ id: 'urn:sqlib:node:patch-2' }),
    );
    expect(codes).toContain('rdf-graph-target-cannot-consume');
  });

  /*
   * A patch has no tabular shape and no truth value, so these are not narrower
   * readings of what leaves the node — they are different things
   * (NODE_PATCH_OUTBOUND_FLOW_TYPE).
   */
  it.each(['VARIABLE_BINDINGS', 'BOOLEAN', 'QUERY_ID'] as const)(
    'refuses to carry %s out of a patch node',
    flowType => {
      const codes = checkNodeKinds(flowType, patchNodeState(), otherNodeState('ruleset', P.rulesetNode))
        .filter(issue => issue.level === 'error')
        .map(issue => issue.code);
      expect(codes).toContain('patch-outbound-flow-type');
    },
  );

  it('allows a control flow edge, which carries nothing', () => {
    const codes = checkNodeKinds('CONTROL_FLOW', patchNodeState(), otherNodeState('query', 'urn:sqlib:node:query'))
      .filter(issue => issue.level === 'error')
      .map(issue => issue.code);
    expect(codes).toEqual([]);
  });

  /*
   * The two halves are only distinguishable by which port they left through, so
   * an edge that names neither cannot be answered — the engine would have to
   * hand it the patch document, which is not a graph
   * (EDGE_PATCH_SOURCE_PORT_UNNAMED).
   */
  it('refuses an RDF edge that does not say which half it carries', () => {
    const codes = errorCodes(
      rdfEdge({ sourceOutputId: null }),
      patchNodeState(),
      otherNodeState('ruleset', P.rulesetNode),
    );
    expect(codes).toContain('patch-source-port-unnamed');
  });

  it('reports a source port that is neither half once, as the endpoint mistake it is', () => {
    const codes = errorCodes(
      rdfEdge({ sourceOutputId: P.rulesetOut }),
      patchNodeState(),
      otherNodeState('ruleset', P.rulesetNode),
    );
    expect(codes).toContain('endpoint-not-on-node');
    expect(codes).not.toContain('patch-source-port-unnamed');
  });
});

describe('what a patch node recommends and refuses for a new edge', () => {
  /*
   * Short-circuited before the rule table, which keys on the source's query
   * type: a patch node's query is an update, which that table reads as
   * "produces no output data" and answers with a control flow edge. What the
   * node emits is the derived patch, not its query's result.
   */
  it('recommends RDF for an edge drawn out of one', () => {
    const recommendation = recommendFlowType(patchNodeState(), otherNodeState('ruleset', P.rulesetNode));
    expect(recommendation.defaultFlowType).toBe('RDF_GRAPH');
  });

  it('accepts RDF and refuses bindings, without quoting a rule about CONSTRUCT', () => {
    const target = otherNodeState('ruleset', P.rulesetNode);
    expect(validateFlowTypeCompatibility(patchNodeState(), target, 'RDF_GRAPH').valid).toBe(true);

    const bindings = validateFlowTypeCompatibility(patchNodeState(), target, 'VARIABLE_BINDINGS');
    expect(bindings.valid).toBe(false);
    expect(bindings.errors.join(' ')).toContain('patch node');
  });

  it('recommends bindings for a start node feeding one, which parameterises the update', () => {
    const start: GraphNodeState = {
      id: P.startNode,
      kind: 'start',
      label: 'Start',
      inputs: [],
      outputs: [],
    };
    expect(recommendFlowType(start, patchNodeState()).defaultFlowType).toBe('VARIABLE_BINDINGS');
  });
});

describe('what live validation says about a patch node', () => {
  const stateWith = (node: GraphNodeState): QueryGroupGraphState => ({
    version: { id: P.groupVersion } as QueryGroupGraphState['version'],
    nodes: [node],
    edges: [],
    ioEntities: {},
    tupleMembers: {},
    variables: {},
    queryVersionInterfaces: {},
    iriMap: {},
  });

  const codesFor = (node: GraphNodeState) => liveValidationIssues(stateWith(node)).map(issue => issue.code);

  it('says nothing about a fully built one', () => {
    expect(codesFor(patchNodeState())).toEqual([]);
  });

  /*
   * An error rather than a warning, unlike a missing query: the canvas mints
   * both ports with the node, so a node without them did not arrive by an
   * author being half way through — it arrived from a payload the server would
   * refuse (NODE_PATCH_OUTPUT_PORTS_MISSING).
   */
  it('reports a node missing a half', () => {
    const codes = codesFor(patchNodeState({ additionsOutputId: null }));
    expect(codes).toContain('NODE_PATCH_OUTPUT_PORTS_MISSING');
  });

  it('reports one port used for both halves', () => {
    const codes = codesFor(patchNodeState({ additionsOutputId: P.deletions }));
    expect(codes).toContain('NODE_PATCH_OUTPUT_PORTS_MISSING');
  });

  it('reports a half the node does not declare as an output', () => {
    const codes = codesFor(patchNodeState({ additionsOutputId: 'urn:sqlib:triples-quads-io:elsewhere' }));
    expect(codes).toContain('NODE_PATCH_OUTPUT_PORTS_MISSING');
  });

  /* Deriving the effect of a SELECT is not a narrower version of anything. */
  it('reports a query that is not an update', () => {
    const codes = codesFor(patchNodeState({ queryType: SELECT_QUERY_TYPE }));
    expect(codes).toContain('NODE_PATCH_QUERY_NOT_UPDATE');
  });

  it('warns, as it does for a query node, when there is no update yet', () => {
    const issues = liveValidationIssues(
      stateWith(patchNodeState({ queryId: null, queryVersionId: null, queryType: null })),
    );
    const missing = issues.find(issue => issue.code === 'NODE_QUERY_ID_UNRESOLVABLE');
    expect(missing?.level).toBe('warning');
  });

  /* It reads a store, so it needs one — the same warning a query node gets. */
  it('warns when it has no store to read', () => {
    expect(codesFor(patchNodeState({ backendId: null }))).toContain('NODE_BACKEND_UNRESOLVABLE');
  });

  /**
   * Both halves at one consumer, which neither edge nor node validation sees.
   *
   * `validateEdge` is asked about one edge and `nodeIssues` about one node, and
   * each of these graphs is fine by both: the patch node names two distinct
   * ports and every edge carries the half it says it does. It is the pair
   * arriving together that is wrong, because a consumer unions the graphs it is
   * handed. `GraphBuilder` refuses it as `EDGE_PATCH_HALVES_MERGED`; these keep
   * the canvas saying so first.
   */
  describe('both halves reaching one consumer', () => {
    const bothHalvesTo = (target: string, targetNode: GraphNodeState): QueryGroupGraphState => ({
      version: { id: P.groupVersion } as QueryGroupGraphState['version'],
      nodes: [patchNodeState(), targetNode],
      edges: [
        rdfEdge({ id: 'urn:sqlib:edge:deletions', target, sourceOutputId: P.deletions, targetInputId: P.rulesetIn }),
        rdfEdge({ id: 'urn:sqlib:edge:additions', target, sourceOutputId: P.additions, targetInputId: P.rulesetIn }),
      ],
      ioEntities: {},
      tupleMembers: {},
      variables: {},
      queryVersionInterfaces: {},
      iriMap: {},
    });

    it('reports both halves reaching one rule set', () => {
      const issues = liveValidationIssues(bothHalvesTo(P.rulesetNode, otherNodeState('ruleset', P.rulesetNode)));
      const merged = issues.find(issue => issue.code === 'EDGE_PATCH_HALVES_MERGED');

      expect(merged?.level).toBe('error');
      // The second edge, which is the one to delete.
      expect(merged?.entityId).toBe('urn:sqlib:edge:additions');
    });

    it('reports both halves reaching one end node', () => {
      const issues = liveValidationIssues(bothHalvesTo(P.endNode, otherNodeState('end', P.endNode)));

      expect(issues.map(issue => issue.code)).toContain('EDGE_PATCH_HALVES_MERGED');
    });

    it('says nothing when each half goes to its own consumer', () => {
      const state: QueryGroupGraphState = {
        version: { id: P.groupVersion } as QueryGroupGraphState['version'],
        nodes: [patchNodeState(), otherNodeState('ruleset', P.rulesetNode), otherNodeState('end', P.endNode)],
        edges: [
          rdfEdge({ id: 'urn:sqlib:edge:additions', target: P.rulesetNode, sourceOutputId: P.additions, targetInputId: P.rulesetIn }),
          rdfEdge({ id: 'urn:sqlib:edge:deletions', target: P.endNode, sourceOutputId: P.deletions, targetInputId: P.rulesetIn }),
        ],
        ioEntities: {},
        tupleMembers: {},
        variables: {},
        queryVersionInterfaces: {},
        iriMap: {},
      };

      expect(liveValidationIssues(state).map(issue => issue.code)).not.toContain('EDGE_PATCH_HALVES_MERGED');
    });

    it('reports one pairing once, however many edges restate it', () => {
      const state = bothHalvesTo(P.rulesetNode, otherNodeState('ruleset', P.rulesetNode));
      state.edges.push(
        rdfEdge({ id: 'urn:sqlib:edge:deletions-again', target: P.rulesetNode, sourceOutputId: P.deletions, targetInputId: P.rulesetIn }),
      );

      const merged = liveValidationIssues(state).filter(issue => issue.code === 'EDGE_PATCH_HALVES_MERGED');
      expect(merged).toHaveLength(1);
    });

    it('says nothing when the same half arrives twice', () => {
      // Two edges from one port is a duplicate, not a lost sign: the union of a
      // graph with itself is that graph. Not this rule's business.
      const state = bothHalvesTo(P.rulesetNode, otherNodeState('ruleset', P.rulesetNode));
      state.edges[1] = rdfEdge({
        id: 'urn:sqlib:edge:additions',
        target: P.rulesetNode,
        sourceOutputId: P.deletions,
        targetInputId: P.rulesetIn,
      });

      expect(liveValidationIssues(state).map(issue => issue.code)).not.toContain('EDGE_PATCH_HALVES_MERGED');
    });
  });
});
