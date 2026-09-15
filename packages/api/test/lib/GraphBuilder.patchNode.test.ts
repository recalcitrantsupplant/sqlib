import { describe, it, expect, beforeEach, vi } from 'vitest';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import { GraphBuilder } from '../../src/lib/orchestration/GraphBuilder.js';
import { isGraphValidationError } from '../../src/lib/orchestration/GraphValidationError.js';

/**
 * What a PatchNode is allowed to be wired to (issue #290, MVP-3).
 *
 * The node's whole value is that it says what an update *would* change without
 * changing it, and every rule below exists to stop that promise being broken
 * quietly rather than loudly:
 *
 * - Two ports, named by sign, because deletions and additions are only
 *   distinguishable by which port they left through.
 * - An update query, because deriving the effect of a SELECT is meaningless.
 * - No SPARQL consumer, because a derived value is not in any store for one to
 *   read - and a PatchNode's own `backendConfig` would otherwise satisfy the
 *   materialization check and hand the consumer an empty store.
 */

const hoisted = vi.hoisted(() => ({
  get: vi.fn(),
  list: vi.fn(),
  getAll: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    get: hoisted.get,
    list: hoisted.list,
    getAll: hoisted.getAll,
  }),
}));

const UPDATE = 'DELETE { ?s <urn:p> ?o } INSERT { ?s <urn:q> ?o } WHERE { ?s <urn:p> ?o }';

describe('GraphBuilder: PatchNode', () => {
  let graphBuilder: GraphBuilder;
  let cache: Map<string, Record<string, unknown>>;

  const ids = {
    backend: 'urn:backend:test',
    queryVersion: 'urn:qv:update',
    deletions: 'urn:tqio:deletions',
    additions: 'urn:tqio:additions',
    ruleSetInput: 'urn:tqio:ruleset-in',
    node: 'urn:node:patch',
    ruleSetNode: 'urn:node:ruleset',
    ruleSetVersion: 'urn:rsv:1',
    start: 'urn:node:start',
    end: 'urn:node:end',
    groupVersion: 'urn:qgv:patch',
  };

  /**
   * A group of START -> patch -> END, with the patch node's fields overridable
   * so each test states only the thing it is about.
   */
  function buildGroup(overrides: {
    node?: Record<string, unknown>;
    queryVersion?: Record<string, unknown>;
    endNodeInputs?: string[];
    endEdge?: Record<string, unknown>;
    extraNodes?: string[];
    extraEdges?: string[];
  } = {}) {
    cache.set(ids.backend, {
      $id: ids.backend,
      '@type': 'Backend',
      backendType: 'HTTP',
      endpoint: 'http://example.org/sparql',
    });
    cache.set(ids.queryVersion, {
      $id: ids.queryVersion,
      '@type': 'QueryVersion',
      queryString: UPDATE,
      queryType: QueryTypeIri.update,
      ...overrides.queryVersion,
    });
    for (const port of [ids.deletions, ids.additions, ids.ruleSetInput]) {
      cache.set(port, { $id: port, '@type': 'TriplesQuadsIO', ioType: 'output', outputType: 'RDFGraph' });
    }

    cache.set(ids.node, {
      $id: ids.node,
      '@type': 'PatchNode',
      queryId: ids.queryVersion,
      backendId: ids.backend,
      outputs: [ids.deletions, ids.additions],
      deletionsOutput: ids.deletions,
      additionsOutput: ids.additions,
      ...overrides.node,
    });

    cache.set(ids.start, { $id: ids.start, '@type': 'StartNode', outputs: [] });
    cache.set(ids.end, {
      $id: ids.end,
      '@type': 'EndNode',
      inputs: overrides.endNodeInputs ?? [ids.deletions],
    });

    cache.set('urn:edge:start', {
      $id: 'urn:edge:start',
      '@type': 'QueryEdge',
      sourceNodeId: ids.start,
      targetNodeId: ids.node,
      dataFlowType: 'CONTROL_FLOW',
    });
    cache.set('urn:edge:end', {
      $id: 'urn:edge:end',
      '@type': 'QueryEdge',
      sourceNodeId: ids.node,
      targetNodeId: ids.end,
      dataFlowType: 'RDF_GRAPH',
      sourceOutputId: ids.deletions,
      targetInputId: ids.deletions,
      ...overrides.endEdge,
    });

    cache.set(ids.groupVersion, {
      $id: ids.groupVersion,
      '@type': 'QueryGroupVersion',
      executionNodes: [ids.start, ids.node, ids.end, ...(overrides.extraNodes ?? [])],
      edges: ['urn:edge:start', 'urn:edge:end', ...(overrides.extraEdges ?? [])],
    });

    return graphBuilder.buildFromGroupVersionId(ids.groupVersion);
  }

  /** The code of the GraphValidationError a build throws, or the raw message. */
  function codeOf(build: () => unknown): string {
    try {
      build();
    } catch (error) {
      return isGraphValidationError(error) ? error.code : `unexpected: ${(error as Error).message}`;
    }
    return 'no error thrown';
  }

  beforeEach(() => {
    graphBuilder = new GraphBuilder();
    cache = new Map<string, any>();
    vi.clearAllMocks();
    hoisted.get.mockImplementation((id: string) => cache.get(id) ?? null);
    hoisted.list.mockImplementation((type: string) =>
      Array.from(cache.values()).filter(entity => entity['@type'] === type));
    hoisted.getAll.mockImplementation(() => Array.from(cache.values()));
  });

  it('resolves the update query and both signed ports', () => {
    const graph = buildGroup();
    const node = graph.nodes.get(ids.node)!;

    expect(node.queryString).toBe(UPDATE);
    expect(node.queryType).toBe(QueryTypeIri.update);
    expect(node.deletionsOutputId).toBe(ids.deletions);
    expect(node.additionsOutputId).toBe(ids.additions);
  });

  it('rejects a node that declares only one of the two ports', () => {
    expect(codeOf(() => buildGroup({ node: { additionsOutput: undefined } })))
      .toBe('NODE_PATCH_OUTPUT_PORTS_MISSING');
  });

  it('rejects a node that uses one port for both halves', () => {
    expect(codeOf(() => buildGroup({ node: { additionsOutput: ids.deletions } })))
      .toBe('NODE_PATCH_OUTPUT_PORTS_MISSING');
  });

  it('rejects a named port the node does not list in outputs', () => {
    expect(codeOf(() => buildGroup({ node: { outputs: [ids.deletions] } })))
      .toBe('NODE_PATCH_OUTPUT_PORTS_MISSING');
  });

  it('rejects a query that is not an update', () => {
    expect(codeOf(() => buildGroup({
      queryVersion: {
        queryString: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
        queryType: QueryTypeIri.construct,
      },
    }))).toBe('NODE_PATCH_QUERY_NOT_UPDATE');
  });

  it('rejects an outgoing RDF edge that does not say which half it carries', () => {
    // Caught by the generic data-flow rule rather than the patch-specific one:
    // an edge with no source port is already invalid whatever it leaves.
    expect(codeOf(() => buildGroup({ endEdge: { sourceOutputId: undefined } })))
      .toBe('EDGE_DATA_FLOW_MISSING_IO');
  });

  it('rejects an outgoing RDF edge naming a port the node does not offer', () => {
    expect(codeOf(() => buildGroup({ endEdge: { sourceOutputId: ids.ruleSetInput } })))
      .toBe('EDGE_SOURCE_OUTPUT_UNDECLARED');
  });

  it('rejects an outgoing RDF edge naming an output that is neither half', () => {
    // The case the generic rules cannot reach: a port the node really does
    // declare, but which carries neither sign. Leaving it to them would send
    // whatever `results` held for the node - the patch document, not a graph.
    expect(codeOf(() => buildGroup({
      node: { outputs: [ids.deletions, ids.additions, ids.ruleSetInput] },
      endNodeInputs: [ids.ruleSetInput],
      endEdge: { sourceOutputId: ids.ruleSetInput, targetInputId: ids.ruleSetInput },
    }))).toBe('EDGE_PATCH_SOURCE_PORT_UNNAMED');
  });

  it('rejects an outgoing edge carrying bindings', () => {
    // A patch has no tabular shape, so VARIABLE_BINDINGS out of one is not a
    // narrower version of anything - it is a wiring mistake.
    expect(codeOf(() => buildGroup({
      endEdge: { dataFlowType: 'VARIABLE_BINDINGS', sourceOutputId: ids.deletions },
    }))).toBe('EDGE_SOURCE_PORT_TYPE');
  });

  it('refuses to feed a SPARQL node, which has no store to read the patch from', () => {
    const consumer = 'urn:node:consumer';
    cache.set('urn:qv:consumer', {
      $id: 'urn:qv:consumer',
      '@type': 'QueryVersion',
      queryString: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      queryType: QueryTypeIri.construct,
    });

    const code = codeOf(() => {
      cache.set(consumer, {
        $id: consumer,
        '@type': 'QueryNode',
        queryId: 'urn:qv:consumer',
        backendConfig: { type: 'ephemeral-oxigraph', storeId: 'store-consumer' },
        inputs: [ids.additions],
      });
      cache.set('urn:edge:consume', {
        $id: 'urn:edge:consume',
        '@type': 'QueryEdge',
        sourceNodeId: ids.node,
        targetNodeId: consumer,
        dataFlowType: 'RDF_GRAPH',
        sourceOutputId: ids.additions,
        targetInputId: ids.additions,
      });
      return buildGroup({
        node: { backendConfig: { type: 'ephemeral-oxigraph', storeId: 'store-patch' }, backendId: undefined },
        extraNodes: [consumer],
        extraEdges: ['urn:edge:consume'],
      });
    });

    expect(code).toBe('EDGE_RDF_GRAPH_TARGET_CANNOT_CONSUME');
  });

  /**
   * Both halves at one consumer (the case `staticResultKind` did not see).
   *
   * Every multi-input RDF consumer in the engine unions its inputs, so two
   * halves arriving together come out as one graph with the sign gone. These
   * assert the refusal at build time, before the derivation runs, because the
   * merged string is not something a caller can undo.
   */
  it('refuses to give one EndNode both halves of the same patch', () => {
    cache.set('urn:edge:end-additions', {
      $id: 'urn:edge:end-additions',
      '@type': 'QueryEdge',
      sourceNodeId: ids.node,
      targetNodeId: ids.end,
      dataFlowType: 'RDF_GRAPH',
      sourceOutputId: ids.additions,
      targetInputId: ids.additions,
    });

    expect(codeOf(() => buildGroup({
      endNodeInputs: [ids.deletions, ids.additions],
      extraEdges: ['urn:edge:end-additions'],
    }))).toBe('EDGE_PATCH_HALVES_MERGED');
  });

  it('refuses to seed one RuleSetNode with both halves of the same patch', () => {
    const rulesOut = 'urn:tqio:rules-out';

    const code = codeOf(() => {
      cache.set(rulesOut, { $id: rulesOut, '@type': 'TriplesQuadsIO', ioType: 'output', outputType: 'RDFGraph' });
      cache.set(ids.ruleSetVersion, { $id: ids.ruleSetVersion, '@type': 'RuleSetVersion' });
      cache.set(ids.ruleSetNode, {
        $id: ids.ruleSetNode,
        '@type': 'RuleSetNode',
        ruleSetVersion: ids.ruleSetVersion,
        inputs: [ids.deletions, ids.additions],
        outputs: [rulesOut],
      });
      for (const half of ['deletions', 'additions'] as const) {
        cache.set(`urn:edge:rules-${half}`, {
          $id: `urn:edge:rules-${half}`,
          '@type': 'QueryEdge',
          sourceNodeId: ids.node,
          targetNodeId: ids.ruleSetNode,
          dataFlowType: 'RDF_GRAPH',
          sourceOutputId: ids[half],
          targetInputId: ids[half],
        });
      }
      cache.set('urn:edge:rules-end', {
        $id: 'urn:edge:rules-end',
        '@type': 'QueryEdge',
        sourceNodeId: ids.ruleSetNode,
        targetNodeId: ids.end,
        dataFlowType: 'RDF_GRAPH',
        sourceOutputId: rulesOut,
        targetInputId: rulesOut,
      });
      return buildGroup({
        endNodeInputs: [rulesOut],
        endEdge: { sourceNodeId: ids.ruleSetNode, sourceOutputId: rulesOut, targetInputId: rulesOut },
        extraNodes: [ids.ruleSetNode],
        extraEdges: ['urn:edge:rules-deletions', 'urn:edge:rules-additions', 'urn:edge:rules-end'],
      });
    });

    expect(code).toBe('EDGE_PATCH_HALVES_MERGED');
  });

  it('allows the two halves when they go to different consumers', () => {
    const rulesOut = 'urn:tqio:rules-out';
    cache.set(rulesOut, { $id: rulesOut, '@type': 'TriplesQuadsIO', ioType: 'output', outputType: 'RDFGraph' });
    cache.set(ids.ruleSetVersion, { $id: ids.ruleSetVersion, '@type': 'RuleSetVersion' });
    cache.set(ids.ruleSetNode, {
      $id: ids.ruleSetNode,
      '@type': 'RuleSetNode',
      ruleSetVersion: ids.ruleSetVersion,
      inputs: [ids.additions],
      outputs: [rulesOut],
    });
    // additions → the rule set, deletions → the EndNode. Each consumer sees one
    // sign, so nothing is unioned across the two.
    cache.set('urn:edge:rules-additions', {
      $id: 'urn:edge:rules-additions',
      '@type': 'QueryEdge',
      sourceNodeId: ids.node,
      targetNodeId: ids.ruleSetNode,
      dataFlowType: 'RDF_GRAPH',
      sourceOutputId: ids.additions,
      targetInputId: ids.additions,
    });

    const graph = buildGroup({
      extraNodes: [ids.ruleSetNode],
      extraEdges: ['urn:edge:rules-additions'],
    });

    expect(graph.nodes.has(ids.ruleSetNode)).toBe(true);
  });

  it('never asks its own store to materialize, whatever consumes it', () => {
    const graph = buildGroup({
      node: { backendConfig: { type: 'ephemeral-oxigraph', storeId: 'store-patch' }, backendId: undefined },
    });

    expect(graph.nodes.get(ids.node)!.needsEphemeralMaterialization).toBe(false);
  });
});
