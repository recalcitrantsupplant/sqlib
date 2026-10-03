import { describe, it, expect, vi } from 'vitest';
import * as oxigraph from 'oxigraph';
import { ExecutionEngine } from '../../src/lib/orchestration/ExecutionEngine.js';
import { ExecutorFactory } from '../../src/lib/orchestration/ExecutorFactory.js';
import { SparqlQueryParser } from '../../src/lib/parser.js';
import type { RuleSetExecutor } from '../../src/lib/RuleSetExecutor.js';
import type { ExecutionGraph, ResolvedEdge, ResolvedNode } from '../../src/lib/orchestration/types.js';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';

/**
 * RDF handed from one node to the next (WP14).
 *
 * A CONSTRUCT answers in the syntax its backend chose for the run's `Accept`;
 * a rule set reads its seed as N-Triples unless told otherwise; an EndNode
 * fanning in several graphs used to join them with a newline. Each of those
 * is only right when everything happens to be N-Triples, so these runs use a
 * real in-process store, whose Turtle groups predicates under one subject and
 * is therefore not N-Triples at all.
 */

const ports: Record<string, Record<string, unknown>> = {};
for (const id of ['urn:io:data', 'urn:io:a-out', 'urn:io:b-out', 'urn:io:rules-out']) {
  ports[id] = { $id: id, '@type': 'TriplesQuadsIO' };
}

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({ get: (id: string) => ports[id] ?? null }),
}));

/** One subject, two predicates: Turtle writes this with a `;`. */
const SEED = '<urn:s> <urn:p> <urn:o1> .\n<urn:s> <urn:q> <urn:o2> .\n';

function node(id: string, raw: Record<string, unknown>, rest: Partial<ResolvedNode> = {}): ResolvedNode {
  return {
    id,
    raw: { $id: id, name: id, ...raw } as ResolvedNode['raw'],
    backendId: undefined,
    queryVersionId: undefined,
    queryVersion: undefined,
    queryString: undefined,
    queryType: undefined,
    inputTupleIds: [],
    outputTupleIds: [],
    ...rest,
  };
}

function construct(id: string, output: string, storeId: string): ResolvedNode {
  return node(id, { '@type': 'QueryNode' }, {
    queryVersionId: `urn:qv:${id}`,
    queryString: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
    queryType: QueryTypeIri.construct,
    outputTupleIds: [output],
    backendConfig: { type: 'ephemeral-oxigraph', storeId },
  });
}

function edge(id: string, sourceNodeId: string, targetNodeId: string, sourceOutputId: string, targetInputId = sourceOutputId): ResolvedEdge {
  return { id, raw: {} as ResolvedEdge['raw'], sourceNodeId, targetNodeId, dataFlowType: 'RDF_GRAPH', sourceOutputId, targetInputId };
}

function graphOf(nodes: ResolvedNode[], edges: ResolvedEdge[]): ExecutionGraph {
  const incomingEdges = new Map<string, ResolvedEdge[]>();
  const outgoingEdges = new Map<string, ResolvedEdge[]>();
  for (const e of edges) {
    outgoingEdges.set(e.sourceNodeId, [...(outgoingEdges.get(e.sourceNodeId) ?? []), e]);
    incomingEdges.set(e.targetNodeId, [...(incomingEdges.get(e.targetNodeId) ?? []), e]);
  }
  const typeOf = (n: ResolvedNode) => (n.raw as { '@type'?: string })['@type'];
  return {
    groupVersion: {} as ExecutionGraph['groupVersion'],
    nodes: new Map(nodes.map(n => [n.id, n])),
    edges,
    incomingEdges,
    outgoingEdges,
    startNodeIds: nodes.filter(n => typeOf(n) === 'StartNode').map(n => n.id),
    endNodeIds: nodes.filter(n => typeOf(n) === 'EndNode').map(n => n.id),
  };
}

const OXIGRAPH_FORMAT: Record<string, string> = { ntriples: 'nt', nquads: 'nq', turtle: 'ttl' };

/**
 * A rule set that infers nothing, but reads its seed exactly as the real one
 * does — N-Triples unless the engine says otherwise — so a seed in the wrong
 * syntax fails here the way it fails in production.
 */
function echoRuleSet() {
  const execute = vi.fn(async (_version: unknown, options: { initialGraph?: string; initialGraphFormat?: string }) => {
    const store = new oxigraph.Store();
    store.load(options.initialGraph ?? '', { format: OXIGRAPH_FORMAT[options.initialGraphFormat ?? 'ntriples'] });
    return { finalGraphNQuads: store.dump({ format: 'nq' }) };
  });
  return { execute } as unknown as RuleSetExecutor & { execute: typeof execute };
}

function engineWith(ruleSet = echoRuleSet()) {
  return new ExecutionEngine(new ExecutorFactory({ internal: true }), new SparqlQueryParser(), ruleSet);
}

function quadsOf(text: string, format: string): string[] {
  const store = new oxigraph.Store();
  store.load(text, { format });
  return store.match(null, null, null, null).map(q => q.toString()).sort();
}

describe('ExecutionEngine — RDF hand-offs agree on format', () => {
  it('seeds a rule set with a CONSTRUCT answered in Turtle', async () => {
    const ruleSet = echoRuleSet();
    const graph = graphOf(
      [
        node('start', { '@type': 'StartNode', outputs: ['urn:io:data'] }, { outputTupleIds: ['urn:io:data'] }),
        construct('a', 'urn:io:a-out', 'store-a'),
        node('rules', { '@type': 'RuleSetNode' }, {
          ruleSetVersionId: 'urn:rsv:1',
          ruleSetVersion: { $id: 'urn:rsv:1' } as ResolvedNode['ruleSetVersion'],
          outputTupleIds: ['urn:io:rules-out'],
        }),
        node('end', { '@type': 'EndNode', inputs: ['urn:io:rules-out'] }),
      ],
      [
        edge('e0', 'start', 'a', 'urn:io:data', 'urn:io:a-in'),
        edge('e1', 'a', 'rules', 'urn:io:a-out', 'urn:io:rules-in'),
        edge('e2', 'rules', 'end', 'urn:io:rules-out'),
      ],
    );

    const { result } = await engineWith(ruleSet).execute(graph, [], undefined, {
      acceptHeader: 'text/turtle',
      dataGraphs: [{ content: SEED, format: 'ntriples' }],
    });

    expect(ruleSet.execute).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ initialGraphFormat: 'turtle' }));
    expect(quadsOf(result as string, 'ttl')).toEqual(quadsOf(SEED, 'nt'));
  });

  it('merges two CONSTRUCTs at the end node into the JSON-LD the caller asked for', async () => {
    const graph = graphOf(
      [
        node('start', { '@type': 'StartNode', outputs: ['urn:io:data'] }, { outputTupleIds: ['urn:io:data'] }),
        construct('a', 'urn:io:a-out', 'store-a'),
        construct('b', 'urn:io:b-out', 'store-b'),
        node('end', { '@type': 'EndNode', inputs: ['urn:io:a-out', 'urn:io:b-out'] }),
      ],
      [
        edge('e0', 'start', 'a', 'urn:io:data', 'urn:io:a-in'),
        edge('e1', 'start', 'b', 'urn:io:data', 'urn:io:b-in'),
        edge('e2', 'a', 'end', 'urn:io:a-out'),
        edge('e3', 'b', 'end', 'urn:io:b-out'),
      ],
    );

    const { result } = await engineWith().execute(graph, [], undefined, {
      acceptHeader: 'application/ld+json',
      dataGraphs: [{ content: SEED, format: 'ntriples' }],
    });

    expect(() => JSON.parse(result as string)).not.toThrow();
    expect(quadsOf(result as string, 'jsonld')).toEqual(quadsOf(SEED, 'nt'));
  });

  it('fails the node, not the run, when its store is gone before it can be loaded', async () => {
    const { oxigraphStoreManager } = await import('../../src/lib/OxigraphStoreManager.js');
    const query = construct('a', 'urn:io:a-out', 'store-a');
    query.needsEphemeralMaterialization = true;
    const graph = graphOf(
      [
        node('start', { '@type': 'StartNode' }),
        query,
        node('end', { '@type': 'EndNode', inputs: ['urn:io:a-out'] }),
      ],
      [{ ...edge('e0', 'start', 'a', 'urn:io:none'), dataFlowType: 'CONTROL_FLOW' }, edge('e1', 'a', 'end', 'urn:io:a-out')],
    );
    const lookup = vi.spyOn(oxigraphStoreManager, 'getEphemeralStore').mockReturnValue(null);
    try {
      await expect(engineWith().execute(graph)).rejects.toMatchObject({
        name: 'ExecutionNodeError',
        nodeId: 'a',
      });
    } finally {
      lookup.mockRestore();
    }
  });
});
