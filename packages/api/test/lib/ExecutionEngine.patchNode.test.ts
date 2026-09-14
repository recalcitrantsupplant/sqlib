import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as oxigraph from 'oxigraph';
import { ExecutionEngine } from '../../src/lib/orchestration/ExecutionEngine.js';
import type { ExecutionGraph, ResolvedEdge, ResolvedNode } from '../../src/lib/orchestration/types.js';
import type { ExecutorFactory } from '../../src/lib/orchestration/ExecutorFactory.js';
import type { RuleSetExecutor } from '../../src/lib/RuleSetExecutor.js';
import type { SparqlQueryParser } from '../../src/lib/parser.js';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';

/**
 * A PatchNode in a running group (issue #290, MVP-3).
 *
 * The store here is a real in-process Oxigraph rather than a stub, because the
 * two properties worth testing are properties of a real derivation: that the
 * halves come out on the right ports, and that the store is *unchanged*
 * afterwards. A mocked store could be made to report either.
 */

const hoisted = vi.hoisted(() => ({
  get: vi.fn(),
  loadDataFromString: vi.fn(),
  getEphemeralStore: vi.fn(),
  createEphemeralStore: vi.fn(),
  destroyEphemeralStore: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({ get: hoisted.get }),
}));

vi.mock('../../src/lib/OxigraphStoreManager.js', () => ({
  oxigraphStoreManager: {
    loadDataFromString: hoisted.loadDataFromString,
    getEphemeralStore: hoisted.getEphemeralStore,
    createEphemeralStore: hoisted.createEphemeralStore,
    destroyEphemeralStore: hoisted.destroyEphemeralStore,
  },
}));

const STORE_ID = 'store-patch';
const DELETIONS_PORT = 'urn:io:deletions';
const ADDITIONS_PORT = 'urn:io:additions';

/** One triple in, renamed to another predicate: one deletion, one addition. */
const SEED = '<urn:s> <urn:p> <urn:o> .';
const UPDATE = 'DELETE { ?s <urn:p> ?o } INSERT { ?s <urn:q> ?o } WHERE { ?s <urn:p> ?o }';

function baseNode(id: string, raw: Record<string, unknown>): ResolvedNode {
  return {
    id,
    raw: { $id: id, ...raw } as ResolvedNode['raw'],
    backendId: undefined,
    queryVersionId: undefined,
    queryVersion: undefined,
    queryString: undefined,
    queryType: undefined,
    inputTupleIds: [],
    outputTupleIds: [],
  };
}

function patchNode(id: string, overrides: Partial<ResolvedNode> = {}): ResolvedNode {
  return {
    ...baseNode(id, { '@type': 'PatchNode', name: 'Preview the rename' }),
    queryString: UPDATE,
    queryType: QueryTypeIri.update,
    backendConfig: { type: 'ephemeral-oxigraph', storeId: STORE_ID },
    outputTupleIds: [DELETIONS_PORT, ADDITIONS_PORT],
    deletionsOutputId: DELETIONS_PORT,
    additionsOutputId: ADDITIONS_PORT,
    ...overrides,
  };
}

function edge(partial: Partial<ResolvedEdge> & Pick<ResolvedEdge, 'id' | 'sourceNodeId' | 'targetNodeId'>): ResolvedEdge {
  return { raw: {} as unknown as ResolvedEdge['raw'], ...partial } as ResolvedEdge;
}

const typeOf = (node: ResolvedNode): string | undefined =>
  (node.raw as { '@type'?: string })['@type'];

function graphOf(nodes: ResolvedNode[], edges: ResolvedEdge[]): ExecutionGraph {
  const incomingEdges = new Map<string, ResolvedEdge[]>();
  const outgoingEdges = new Map<string, ResolvedEdge[]>();
  for (const e of edges) {
    if (!outgoingEdges.has(e.sourceNodeId)) outgoingEdges.set(e.sourceNodeId, []);
    outgoingEdges.get(e.sourceNodeId)!.push(e);
    if (!incomingEdges.has(e.targetNodeId)) incomingEdges.set(e.targetNodeId, []);
    incomingEdges.get(e.targetNodeId)!.push(e);
  }
  return {
    groupVersion: {} as unknown as ExecutionGraph['groupVersion'],
    nodes: new Map(nodes.map(node => [node.id, node])),
    edges,
    incomingEdges,
    outgoingEdges,
    startNodeIds: nodes.filter(node => typeOf(node) === 'StartNode').map(node => node.id),
    endNodeIds: nodes.filter(node => typeOf(node) === 'EndNode').map(node => node.id),
  };
}

describe('ExecutionEngine — PatchNode', () => {
  let store: oxigraph.Store;
  let engine: ExecutionEngine;
  let executor: { update: ReturnType<typeof vi.fn> };
  let ruleSetExecutor: { execute: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.get.mockReturnValue(null);

    store = new oxigraph.Store();
    store.load(SEED, { format: 'application/n-quads' });
    hoisted.getEphemeralStore.mockReturnValue(store);
    hoisted.createEphemeralStore.mockReturnValue(store);

    executor = { update: vi.fn() };
    ruleSetExecutor = {
      execute: vi.fn().mockResolvedValue({ finalGraphNQuads: '<urn:inferred> <urn:p> <urn:o> .' }),
    };
    engine = new ExecutionEngine(
      { getExecutorForNode: vi.fn().mockResolvedValue(executor) } as unknown as ExecutorFactory,
      { detectInputs: vi.fn().mockReturnValue({ valuesInputs: [] }), applyArguments: vi.fn((q: string) => q) } as unknown as SparqlQueryParser,
      ruleSetExecutor as unknown as RuleSetExecutor,
    );
  });

  /** patch → end, with the end node fed from whichever port `port` names. */
  function pipeline(port: string) {
    return graphOf(
      [patchNode('patch'), baseNode('end', { '@type': 'EndNode', inputs: [port] })],
      [edge({
        id: 'e1',
        sourceNodeId: 'patch',
        targetNodeId: 'end',
        dataFlowType: 'RDF_GRAPH',
        sourceOutputId: port,
        targetInputId: port,
      })],
    );
  }

  it('sends the removed quads down the deletions port', async () => {
    const { result } = await engine.execute(pipeline(DELETIONS_PORT));

    expect(result).toContain('<urn:s> <urn:p> <urn:o>');
    expect(result).not.toContain('<urn:q>');
  });

  it('sends the added quads down the additions port', async () => {
    const { result } = await engine.execute(pipeline(ADDITIONS_PORT));

    expect(result).toContain('<urn:s> <urn:q> <urn:o>');
    expect(result).not.toContain('<urn:p>');
  });

  it('leaves the store exactly as it found it', async () => {
    await engine.execute(pipeline(ADDITIONS_PORT));

    const after = store.match(null, null, null, null);
    expect(after).toHaveLength(1);
    expect(after[0].predicate.value).toBe('urn:p');
    // Nothing ran the update - not through an executor, and not through the
    // store. This is the assertion the node type exists for.
    expect(executor.update).not.toHaveBeenCalled();
  });

  it('feeds a rule set the half its edge names, not the whole patch', async () => {
    const rulesOut = 'urn:io:rules-out';
    const graph = graphOf(
      [
        patchNode('patch'),
        {
          ...baseNode('rules', { '@type': 'RuleSetNode', name: 'Rules' }),
          ruleSetVersionId: 'urn:rsv:1',
          ruleSetVersion: { $id: 'urn:rsv:1', '@type': 'RuleSetVersion' } as unknown as ResolvedNode['ruleSetVersion'],
        },
        baseNode('end', { '@type': 'EndNode', inputs: [rulesOut] }),
      ],
      [
        edge({
          id: 'e1', sourceNodeId: 'patch', targetNodeId: 'rules',
          dataFlowType: 'RDF_GRAPH', sourceOutputId: ADDITIONS_PORT, targetInputId: 'urn:io:rules-in',
        }),
        edge({
          id: 'e2', sourceNodeId: 'rules', targetNodeId: 'end',
          dataFlowType: 'RDF_GRAPH', sourceOutputId: rulesOut, targetInputId: rulesOut,
        }),
      ],
    );

    await engine.execute(graph);

    const seed = ruleSetExecutor.execute.mock.calls[0][1].initialGraph as string;
    expect(seed).toContain('<urn:s> <urn:q> <urn:o>');
    // Not the patch document, and not the other half.
    expect(seed).not.toContain('TX .');
    expect(seed).not.toContain('<urn:p>');
  });

  it('reports the whole patch as the node result, in RDF Patch form', async () => {
    const seen: unknown[] = [];
    await engine.execute(pipeline(ADDITIONS_PORT), undefined, {
      onNodeFinish: (node, result) => {
        if (node.id === 'patch') seen.push(result);
      },
    });

    expect(seen).toHaveLength(1);
    const document = seen[0] as string;
    expect(document).toContain('TX .');
    expect(document).toContain('D <urn:s> <urn:p> <urn:o> .');
    expect(document).toContain('A <urn:s> <urn:q> <urn:o> .');
  });

  it('fails the node rather than the run when the update cannot be derived', async () => {
    const graph = graphOf(
      [
        patchNode('patch', { queryString: 'SELECT ?s WHERE { ?s ?p ?o }' }),
        baseNode('end', { '@type': 'EndNode', inputs: [ADDITIONS_PORT] }),
      ],
      [edge({
        id: 'e1', sourceNodeId: 'patch', targetNodeId: 'end',
        dataFlowType: 'RDF_GRAPH', sourceOutputId: ADDITIONS_PORT, targetInputId: ADDITIONS_PORT,
      })],
    );

    await expect(engine.execute(graph)).rejects.toThrow(/node patch/i);
  });
});
