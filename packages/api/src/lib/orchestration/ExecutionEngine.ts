import { randomUUID } from 'node:crypto';
import { orderByPosition } from '@sparql-query-lib/types';
import * as oxigraph from 'oxigraph';
import { toError } from '../toError.js';
import type { ExecutionGraph, ResolvedNode, ResolvedEdge, ArgumentSet, SparqlResultsJson, FinalResult, NodeResult } from './types.js';
import type { ExecutorFactory } from './ExecutorFactory.js';
import { SparqlQueryParser } from '../parser.js';
import type { SparqlBinding, SparqlValue } from '../query-chaining.js';
import { getCacheCoordinator } from '../CacheCoordinatorProvider.js';
import { oxigraphStoreManager } from '../OxigraphStoreManager.js';
import { QueryTypeIri, getQueryTypeKeyFromIri, type QueryTypeValue } from '../../constants/queryTypes.js';
import { requireLibraryMode, resolveOwningLibrary } from '../../auth/enforce.js';
import { toQueryTypeIri } from '../queryTypes.js';
import { RuleSetExecutor } from '../RuleSetExecutor.js';
import { etlService } from '../EtlService.js';
import { invokeCallable } from '../invokeCallable.js';
import { tupleVariableNames } from './tupleNames.js';
import {
  derivePatch,
  patchToRdfPatch,
  quadsToNQuads,
  type DeltaStore,
} from '@sparql-query-lib/rdf-delta';
import { oxigraphDeltaStore } from '../deltaStore.js';
import { resolvePatchTarget } from '../patchTargets.js';
import type { WhenEmptyMode } from '../../persistence/schemas/QueryEdgeSchema.js';
import { convertRdf, mergeRdf, rdfFormatFromMediaType, type RdfPayload } from './rdfHandoff.js';

export type ExecutionHooks = {
  onNodeStart?: (node: ResolvedNode, orderIndex: number) => void;
  onNodeFinish?: (node: ResolvedNode, result: NodeResult, durationMs: number, orderIndex: number) => void;
  onNodeError?: (node: ResolvedNode, error: Error, durationMs: number, orderIndex: number) => void;
};

/**
 * One RDF graph a caller hands to a query group's start node.
 *
 * A start node's tuple outputs are the group's tabular parameters; its
 * `TriplesQuadsIO` outputs are its *data* inputs — the RDF a run supplies for
 * the group to work over. The two are independent slots, so a run may fill
 * either, both, or neither, exactly as the group's start node declares them.
 *
 * Graphs are routed by their order in the run's list: entry N fills the start
 * node's Nth declared data graph input. Nothing here names a port — a run says
 * what it supplies and in what order, and the group says where each one goes.
 */
export type ExecutionDataGraphInput = {
  /** RDF text. */
  content: string;
  /** Format token for `OxigraphStoreManager.loadDataFromString`. */
  format: string;
};

/** A `LIMIT`/`OFFSET` value, named by the placeholder it fills. */
export type ExecutionPageParameter = { name: string; value: number };

export type ExecutionOptions = {
  acceptHeader?: string | null;
  /** Data graphs for the start node's declared RDF inputs. */
  dataGraphs?: ExecutionDataGraphInput[];
  /**
   * `LIMIT` / `OFFSET` values for the run, named rather than global.
   *
   * The route used to refuse these for a group, on the grounds that there was
   * "no unambiguous single query to which a global LIMIT/OFFSET can be
   * applied". True of a *global* one — so these are not global: a value reaches
   * exactly those nodes whose query declares that placeholder name, and a node
   * that must page independently names its parameter differently. See
   * `docs/concepts.md`.
   */
  limits?: ExecutionPageParameter[];
  offsets?: ExecutionPageParameter[];
};

const NODE_TYPES = ['StartNode', 'EndNode', 'QueryNode', 'DynamicQueryNode', 'RuleSetNode', 'PatchNode', 'DuckDbEtlNode'] as const;
type NodeType = typeof NODE_TYPES[number];
type ExecutableNodeType = Exclude<NodeType, 'StartNode' | 'EndNode'>;

/** Everything one run accumulates as its nodes execute. */
type RunState = {
  graph: ExecutionGraph;
  initialArgs: ArgumentSet[] | undefined;
  options: ExecutionOptions | undefined;
  acceptHeader: string | null;
  results: Map<string, NodeResult>;
  /**
   * Results addressed by output port rather than by node.
   *
   * Every other node kind produces one value that all of its outgoing edges
   * share, so `results` keyed by node is enough. A PatchNode produces two —
   * deletions and additions — and an edge says which it carries through
   * `sourceOutputId`. Consumers therefore consult this first and fall back
   * to the node's result, so nothing else has to know a port map exists.
   */
  portResults: Map<string, NodeResult>;
  /**
   * A StartNode carries one independent parameter per output tuple, so its
   * seeded data is keyed by output tuple rather than by node like executed
   * results.
   */
  startNodeOutputs: Map<string, SparqlResultsJson>;
  /** The RDF half of the same idea: one supplied graph per declared input port. */
  startNodeGraphs: Map<string, ExecutionDataGraphInput>;
  /**
   * The syntax of each RDF result, keyed like `results` / `portResults`.
   * A CONSTRUCT answers in what its backend sent, a rule set in N-Quads, a
   * patch half in N-Quads; anything combining or relabelling RDF reads
   * the format from here rather than assuming one.
   */
  rdfFormats: Map<string, string>;
  rdf: RdfSources;
  /** Ephemeral stores this run created, destroyed when it ends. */
  ephemeralStores: Set<string>;
};

/** Runs one node, records what it produced, and returns its node-level result. */
type NodeRunner = (node: ResolvedNode, run: RunState) => Promise<NodeResult>;

/** Where a run's RDF values are kept, and what syntax each is in. */
type RdfSources = {
  results: Map<string, NodeResult>;
  portResults: Map<string, NodeResult>;
  startNodeGraphs: Map<string, ExecutionDataGraphInput>;
  rdfFormats: Map<string, string>;
};

export class ExecutionNodeError extends Error {
  constructor(
    public readonly nodeId: string,
    public readonly nodeName: string,
    cause: Error,
  ) {
    super(`Execution failed for node ${nodeId} (${nodeName}): ${cause.message}`, { cause });
    this.name = 'ExecutionNodeError';
  }
}

export class ExecutionEngine {
  constructor(
    private readonly executorFactory: ExecutorFactory,
    private readonly parser = new SparqlQueryParser(),
    private readonly ruleSetExecutor = new RuleSetExecutor()
  ) {}

  async execute(
    authoredGraph: ExecutionGraph,
    initialArgs?: ArgumentSet[],
    hooks?: ExecutionHooks,
    options?: ExecutionOptions
  ): Promise<FinalResult> {
    const graph = ExecutionEngine.scopeEphemeralStores(authoredGraph, randomUUID());
    const results = new Map<string, NodeResult>();
    const portResults = new Map<string, NodeResult>();
    const startNodeGraphs = new Map<string, ExecutionDataGraphInput>();
    const rdfFormats = new Map<string, string>();
    const run: RunState = {
      graph,
      initialArgs,
      options,
      acceptHeader: options?.acceptHeader ?? null,
      results,
      portResults,
      startNodeOutputs: new Map(),
      startNodeGraphs,
      rdfFormats,
      rdf: { results, portResults, startNodeGraphs, rdfFormats },
      ephemeralStores: new Set(),
    };

    try {
      // Before anything runs: a group may contain UPDATE nodes, and a bad
      // request must not be reported only after half of it has been applied.
      this.refuseUnroutedArguments(graph, initialArgs);

      // Topological order (Kahn).
      const indeg = new Map<string, number>();
      for (const id of graph.nodes.keys()) indeg.set(id, 0);
      for (const e of graph.edges) indeg.set(e.targetNodeId, (indeg.get(e.targetNodeId) || 0) + 1);
      const queue: string[] = Array.from(graph.nodes.keys()).filter(id => (indeg.get(id) || 0) === 0);
      const order: string[] = [];
      const advance = (id: string) => {
        order.push(id);
        for (const e of graph.outgoingEdges.get(id) || []) {
          const d = (indeg.get(e.targetNodeId) || 0) - 1;
          indeg.set(e.targetNodeId, d);
          if (d === 0) queue.push(e.targetNodeId);
        }
      };

      while (queue.length) {
        const id = queue.shift()!;
        const node = graph.nodes.get(id)!;
        const nodeType = this.nodeTypeOf(node);

        // StartNode and EndNode are control-flow markers; a start node also
        // seeds what the run supplied, and executes nothing.
        if (nodeType === 'StartNode') {
          this.seedStartNodeResult(graph, node, results, run.startNodeOutputs, initialArgs);
          this.seedStartNodeDataGraphs(graph, node, startNodeGraphs, options?.dataGraphs);
        } else if (nodeType !== 'EndNode') {
          await this.runNode(node, nodeType, run, hooks, order.length);
        }
        advance(id);
      }

      return this.collectEndNodeResult(run);
    } finally {
      for (const storeId of run.ephemeralStores) {
        oxigraphStoreManager.destroyEphemeralStore(storeId);
      }
    }
  }

  /** How each executable node type runs. Start and end nodes run nothing. */
  private readonly runners: ReadonlyMap<ExecutableNodeType, NodeRunner> = new Map<ExecutableNodeType, NodeRunner>([
    ['QueryNode', (node, run) => this.runQueryNode(node, run)],
    ['DynamicQueryNode', (node, run) => this.runQueryNode(node, run)],
    ['RuleSetNode', (node, run) => this.runRuleSetNode(node, run)],
    ['PatchNode', (node, run) => this.runPatchNode(node, run)],
    ['DuckDbEtlNode', (node, run) => this.runDuckDbEtlNode(node, run)],
  ]);

  /**
   * One node, inside its own error boundary.
   *
   * Everything a node does — resolving its executor, applying arguments,
   * loading the RDF handed to it — belongs inside the boundary: a run that
   * cannot say which node broke is the opaque error the structured failure
   * body exists to replace.
   */
  private async runNode(
    node: ResolvedNode,
    nodeType: ExecutableNodeType,
    run: RunState,
    hooks: ExecutionHooks | undefined,
    orderIndex: number,
  ): Promise<void> {
    // The run's ephemeral stores are torn down with it, whichever node made them.
    if (node.backendConfig?.type === 'ephemeral-oxigraph') {
      run.ephemeralStores.add(node.backendConfig.storeId);
    }
    const startedAt = performance.now();
    hooks?.onNodeStart?.(node, orderIndex);
    let result: NodeResult;
    try {
      result = await this.runners.get(nodeType)!(node, run);
    } catch (error__u: unknown) {
      const error = toError(error__u);
      hooks?.onNodeError?.(node, error, performance.now() - startedAt, orderIndex);
      throw new ExecutionNodeError(node.id, this.nodeName(node), error);
    }
    hooks?.onNodeFinish?.(node, result, performance.now() - startedAt, orderIndex);
  }

  /** The name a failure reports: the query's, the node's, or its id. */
  private nodeName(node: ResolvedNode): string {
    return (node.queryVersion as { name?: string } | undefined)?.name
      || (node.raw as { name?: string }).name
      || node.id;
  }

  private async runQueryNode(node: ResolvedNode, run: RunState): Promise<NodeResult> {
    const { graph, results, startNodeOutputs, startNodeGraphs } = run;
    const exec = await this.executorFactory.getExecutorForNode(node);
    // A start node holds no store of its own, so RDF it supplies reaches a
    // SPARQL node the only way RDF ever does: loaded into the ephemeral
    // store that node queries. Done after the executor call because that
    // is what creates the store.
    await this.loadStartNodeGraphsIntoNode(graph, node, startNodeGraphs);
    // A dynamic node runs the query it resolved, so it is dispatched by that
    // query's type rather than by its declared placeholder's.
    this.applyDynamicQueryOverride(graph, node, results, startNodeOutputs);
    if (!node.queryString) {
      throw new Error(`Node ${node.id} has no query to run`);
    }
    const supplied = this.buildArgumentSetsForNode(graph, node, results, startNodeOutputs);
    const { argumentSets, limits, offsets } = this.resolveNodeArguments(graph, node, supplied, run.initialArgs, run.options);

    const { result, contentType } = await invokeCallable(exec, node.queryString, node.queryType, {
      argumentSets,
      limits,
      offsets,
      acceptHeader: run.acceptHeader,
      parser: this.parser,
    });
    run.results.set(node.id, result);

    const type = toQueryTypeIri(node.queryType) || QueryTypeIri.select;
    const producesRdf = type === QueryTypeIri.construct || type === QueryTypeIri.describe;
    if (producesRdf) {
      // What the backend sent, which need not be what was asked for: the
      // in-process executor answers N-Quads to anything but Turtle.
      run.rdfFormats.set(node.id, rdfFormatFromMediaType(contentType ?? run.acceptHeader));
    }

    if (node.backendConfig?.type === 'ephemeral-oxigraph' && node.needsEphemeralMaterialization && producesRdf) {
      if (typeof result !== 'string') {
        throw new Error(`Node ${node.id} expected RDF string result for materialization but received ${typeof result}`);
      }
      await this.materializeRdfResult(node.backendConfig.storeId, result, run.rdfFormats.get(node.id) ?? 'nquads');
    }
    return result;
  }

  private async runRuleSetNode(node: ResolvedNode, run: RunState): Promise<NodeResult> {
    const ruleSetVersion = node.ruleSetVersion;
    if (!ruleSetVersion) {
      throw new Error(`RuleSetNode ${node.id} missing resolved RuleSetVersion`);
    }
    const rdfSeed = this.buildRdfSeedForRuleSetNode(run.graph, node, run.rdf);
    const executionResult = await this.ruleSetExecutor.execute(ruleSetVersion, {
      initialGraph: rdfSeed?.content || undefined,
      initialGraphFormat: rdfSeed?.format,
    });
    const graphResult = executionResult.finalGraphNQuads ?? executionResult.finalGraphContent ?? '';
    run.results.set(node.id, graphResult);
    run.rdfFormats.set(node.id, executionResult.finalGraphNQuads !== undefined
      ? 'nquads'
      : rdfFormatFromMediaType(executionResult.finalGraphContentType));
    return graphResult;
  }

  private async runPatchNode(node: ResolvedNode, run: RunState): Promise<NodeResult> {
    const deletionsPort = node.deletionsOutputId;
    const additionsPort = node.additionsOutputId;
    if (!deletionsPort || !additionsPort) {
      throw new Error(
        `PatchNode ${node.id} reached execution without both output ports; ` +
        `there is no way to say which half is which`,
      );
    }
    const { document, deletions, additions } = await this.executePatchNode(node);
    // Both halves are addressed by port, because they are only
    // distinguishable by which port they left through. The node-level
    // result is the patch document — what a run report shows for the
    // node, and the only form in which the two halves stay one thing.
    run.portResults.set(deletionsPort, deletions);
    run.portResults.set(additionsPort, additions);
    run.rdfFormats.set(deletionsPort, 'nquads');
    run.rdfFormats.set(additionsPort, 'nquads');
    run.results.set(node.id, document);
    return document;
  }

  /**
   * An ETL job as a node: the same pipeline `POST /etl-jobs/:id/execute`
   * runs, so a job yields the same triples — the same IRIs, the same
   * skipped rows — run directly or inside a group.
   */
  private async runDuckDbEtlNode(node: ResolvedNode, run: RunState): Promise<NodeResult> {
    const etlJobVersion = node.etlJobVersion;
    if (!etlJobVersion) {
      throw new Error(`DuckDbEtlNode ${node.id} missing resolved EtlJobVersion`);
    }
    const { columns } = etlService.resolveColumnMapping(etlJobVersion);
    const executor = await this.executorFactory.getExecutorForBackendId(etlJobVersion.backendId);

    const outputs: RdfPayload[] = [];
    await etlService.runPipeline({
      sql: etlJobVersion.sql,
      sparqlTemplate: etlJobVersion.sparqlTemplate,
      columnDefs: columns,
      executor,
      chunkSize: etlJobVersion.chunkSize || 1000,
      onOutput: async (rdf, chunk) => {
        outputs.push({ content: rdf, format: rdfFormatFromMediaType(chunk.contentType) });
      },
    });

    const result = outputs.length ? mergeRdf(outputs, 'nquads') : '';
    run.results.set(node.id, result);
    run.rdfFormats.set(node.id, 'nquads');
    return result;
  }

  /**
   * What the EndNode returns: the result feeding its one declared input, or
   * the RDF merge of several.
   */
  private collectEndNodeResult(run: RunState): FinalResult {
    const { graph } = run;
    // All query groups MUST have an EndNode
    if (graph.endNodeIds.length === 0) {
      throw new Error('Query group execution graph must have an EndNode');
    }

    const endNodeId = graph.endNodeIds[0]; // Single EndNode per query group
    const endNode = graph.nodes.get(endNodeId);
    if (!endNode) {
      throw new Error(`EndNode ${endNodeId} is missing from execution graph`);
    }

    // EndNode is always a control-flow-only node - collect results from execution nodes feeding its inputs
    const incomingToEnd = graph.incomingEdges.get(endNodeId) || [];
    const endNodeInputs: string[] = Array.isArray((endNode.raw as { inputs?: unknown }).inputs)
      ? ((endNode.raw as { inputs?: unknown }).inputs as string[]).filter(Boolean)
      : [];

    if (endNodeInputs.length === 0) {
      throw new Error(`EndNode ${endNodeId} must declare at least one input IO entity`);
    }

    const predecessorResults: Array<{ nodeId: string; result: NodeResult; inputId: string; rdfFormat: string }> = [];

    // EndNode acts as a "result selector" - it collects outputs from predecessor execution nodes
    // For each input declared by the EndNode, find the edge that supplies it and collect that node's result
    // Note: For EndNode edges, sourceOutputId === targetInputId (pass-through semantics)
    for (const inputId of endNodeInputs) {
      const supplyingEdge = incomingToEnd.find(edge => edge.targetInputId === inputId);
      if (!supplyingEdge) {
        throw new Error(`No incoming edge supplies EndNode input ${inputId}`);
      }

      // A graph the caller supplied and the group passes straight back out is
      // the start node's result for that port: nothing executed, so `results`
      // holds nothing for it.
      const { result: supplierResult, format } = this.resultForEdge(supplyingEdge, run.rdf);
      if (supplierResult === undefined) {
        throw new Error(`Missing execution result for node ${supplyingEdge.sourceNodeId} feeding EndNode input ${inputId}`);
      }

      predecessorResults.push({ nodeId: supplyingEdge.sourceNodeId, result: supplierResult, inputId, rdfFormat: format });
    }

    if (predecessorResults.length === 0) {
      throw new Error(`EndNode ${endNodeId} has no data inputs (only control flow); nothing to return`);
    }

    // The caller is told the result is in the format they asked for, so RDF
    // leaves in that format whichever node produced it.
    const outputFormat = this.resolveRdfFormatFromAccept(run.acceptHeader);

    // Single predecessor: return its result directly
    if (predecessorResults.length === 1) {
      const [only] = predecessorResults;
      return {
        result: typeof only.result === 'string'
          ? convertRdf({ content: only.result, format: only.rdfFormat }, outputFormat)
          : only.result,
        resultNodeId: only.nodeId
      };
    }

    // Multiple predecessors: merge RDF outputs
    // For now, all must be RDF strings (CONSTRUCT/DESCRIBE results)
    const rdfOutputs: RdfPayload[] = [];
    for (const { nodeId, result, inputId, rdfFormat } of predecessorResults) {
      if (typeof result !== 'string') {
        throw new Error(
          `EndNode input ${inputId} expects RDF string output. ` +
          `Node ${nodeId} produced ${typeof result}. ` +
          `Support for merging bindings/booleans is not yet implemented.`
        );
      }
      rdfOutputs.push({ content: result, format: rdfFormat });
    }

    // Parsed and re-written rather than concatenated: the inputs need not
    // share a syntax, and only N-Triples survives being joined by newline.
    return {
      result: mergeRdf(rdfOutputs, outputFormat),
      resultNodeId: endNodeId
    };
  }

  /**
   * This run's copy of the graph, with every ephemeral `storeId` prefixed by
   * the run id.
   *
   * A node's `storeId` is a string its author chose and the group version
   * persists, so two runs of one version name the same store. Keyed verbatim,
   * concurrent runs would seed into and query one shared store, and whichever
   * finished first would destroy it under the other. Within one run the
   * author's ids keep their meaning — nodes naming the same store still share
   * it — and across runs nothing is shared.
   *
   * Nodes are copied, not edited: the built graph may be reused by its caller,
   * and a dynamic node's resolved query is per-run state too.
   */
  static scopeEphemeralStores(graph: ExecutionGraph, runId: string): ExecutionGraph {
    const nodes = new Map<string, ResolvedNode>();
    for (const [id, node] of graph.nodes) {
      nodes.set(id, node.backendConfig?.type === 'ephemeral-oxigraph'
        ? { ...node, backendConfig: { ...node.backendConfig, storeId: `${runId}:${node.backendConfig.storeId}` } }
        : { ...node });
    }
    return { ...graph, nodes };
  }

  /**
   * Whether a node is a StartNode proper.
   *
   * By `@type`, not by `graph.startNodeIds` — that list is the DAG's roots,
   * which for a plain two-node chain is the first *query* node. The
   * distinction matters wherever a start node's ports are read one at a time
   * rather than through the node's single result.
   */
  private isStartNode(graph: ExecutionGraph, nodeId: string): boolean {
    return (graph.nodes.get(nodeId)?.raw as { '@type'?: string } | undefined)?.['@type'] === 'StartNode';
  }

  /**
   * A node's type, read from its `@type` and nothing else.
   *
   * There used to be a fallback that guessed from the node's shape (no query
   * string at a root means a start node, a rule set version means a rule set
   * node), kept for unit tests. Every stored node carries its type, and a
   * guess is how a PatchNode — which holds an update — came within one
   * misordered branch of running that update. An untyped node is refused.
   */
  private nodeTypeOf(node: ResolvedNode): NodeType {
    const rawType = (node.raw as { '@type'?: string })['@type'];
    if (rawType && (NODE_TYPES as readonly string[]).includes(rawType)) return rawType as NodeType;
    throw new ExecutionNodeError(node.id, this.nodeName(node), new Error(
      rawType ? `Unsupported node type ${rawType}` : 'Node has no @type, so there is no way to know how to run it',
    ));
  }

  /**
   * The value an edge carries, and its RDF syntax when it is RDF.
   *
   * A graph the caller supplied is the start node's result for its port; a
   * patch half is addressed by port; everything else by node.
   */
  private resultForEdge(edge: ResolvedEdge, rdf: RdfSources): { result: NodeResult; format: string } {
    const port = edge.sourceOutputId ?? undefined;
    const seededGraph = port ? rdf.startNodeGraphs.get(port) : undefined;
    if (seededGraph) return { result: seededGraph.content, format: seededGraph.format };
    if (port && rdf.portResults.has(port)) {
      return { result: rdf.portResults.get(port), format: rdf.rdfFormats.get(port) ?? 'nquads' };
    }
    return { result: rdf.results.get(edge.sourceNodeId), format: rdf.rdfFormats.get(edge.sourceNodeId) ?? 'nquads' };
  }

  /**
   * Everything a RuleSetNode's inbound RDF edges carry, as one document.
   *
   * A data graph supplied to the start node is upstream RDF like any other:
   * the rules run over it exactly as they would over a CONSTRUCT's output.
   * One input is handed over as it came, with its format; several are merged
   * into N-Quads, since they need not share a syntax.
   */
  private buildRdfSeedForRuleSetNode(graph: ExecutionGraph, node: ResolvedNode, rdf: RdfSources): RdfPayload | null {
    const inbound = graph.incomingEdges.get(node.id) || [];
    const payloads: RdfPayload[] = [];
    for (const e of inbound) {
      if (e.dataFlowType !== 'RDF_GRAPH') continue;
      const { result: srcResult, format } = this.resultForEdge(e, rdf);
      if (typeof srcResult !== 'string') {
        if (srcResult === undefined) {
          throw new Error(`RuleSetNode ${node.id} missing RDF input from ${e.sourceNodeId}`);
        }
        throw new Error(`RuleSetNode ${node.id} expected RDF string from ${e.sourceNodeId} but received ${typeof srcResult}`);
      }
      payloads.push({ content: srcResult, format });
    }
    if (payloads.length === 0) return null;
    if (payloads.length === 1) return payloads[0];
    return { content: mergeRdf(payloads, 'nquads'), format: 'nquads' };
  }

  /**
   * Derive what a PatchNode's update *would* change, and change nothing.
   *
   * The derivation is `packages/rdf-delta` — the same call `POST /patches/preview`
   * makes — so a patch computed inside a group and a patch computed by the route
   * are the same patch. Nothing is persisted: a `Patch` entity is a record of an
   * approval flow, and a value flowing down an edge is not that. Nothing is
   * applied either; applying is `POST /patches/:id/apply`, which re-derives and
   * guards, and a node that quietly did it would make the diff and the write the
   * same act.
   *
   * A blank-node deletion the store could not be asked about (`netEffectExact:
   * false`) is reported rather than smoothed over: the quad sets are then not
   * the whole truth about what an observer would see change, and a downstream
   * rule set fed a half-truth would draw conclusions from it.
   */
  private async executePatchNode(node: ResolvedNode): Promise<{
    document: string;
    deletions: string;
    additions: string;
  }> {
    const updateString = node.queryString;
    if (!updateString) {
      throw new Error(`PatchNode ${node.id} has no update query to derive from`);
    }

    const store = await this.deltaStoreForNode(node);
    const patch = await derivePatch(updateString, store);

    if (!patch.netEffectExact) {
      throw new Error(
        `PatchNode ${node.id} could not derive an exact patch from this store ` +
        `(applyMode=${patch.applyMode}). The quad sets would understate what the update changes, ` +
        `so they are not passed on. Derive against an in-process Oxigraph backend, ` +
        `or split the update so no operation reads what another wrote.`,
      );
    }

    return {
      document: patchToRdfPatch(patch),
      deletions: quadsToNQuads(patch.deletions),
      additions: quadsToNQuads(patch.additions),
    };
  }

  /**
   * The store a PatchNode derives against.
   *
   * An ephemeral node reads the store this run created for it, which is what
   * makes a patch over a graph the caller supplied possible at all. Anything
   * else goes through `resolvePatchTarget`, so "which store is this backend"
   * has one answer shared with preview, apply and revert.
   */
  private async deltaStoreForNode(node: ResolvedNode): Promise<DeltaStore> {
    if (node.backendConfig?.type === 'ephemeral-oxigraph') {
      const storeId = node.backendConfig.storeId;
      const store = oxigraphStoreManager.getEphemeralStore(storeId)
        ?? oxigraphStoreManager.createEphemeralStore(storeId);
      return oxigraphDeltaStore(store, { createStore: () => new oxigraph.Store() });
    }
    if (!node.backendId) {
      throw new Error(`PatchNode ${node.id} names neither a backendId nor an ephemeral backendConfig`);
    }
    const target = await resolvePatchTarget(node.backendId);
    return target.deltaStore;
  }

  private buildArgumentSetsForNode(
    graph: ExecutionGraph,
    node: ResolvedNode,
    results: Map<string, NodeResult>,
    startNodeOutputs?: Map<string, SparqlResultsJson>
  ): Map<string, ArgumentSet> {
    const inbound = graph.incomingEdges.get(node.id) || [];
    const byInputTuple = new Map<string, ArgumentSet>();

    for (const e of inbound) {
      if (e.dataFlowType !== 'VARIABLE_BINDINGS') continue;
      /*
       * A StartNode output tuple carries its own parameter data; an executed
       * node has a single result shared by all of its outgoing edges.
       *
       * So a start node's edge reads *only* its own port. Falling back to the
       * node-level result would hand a port with nothing supplied whatever
       * some other port received, and the default positional mapping would
       * then rename those values into this port's vocabulary. A port the run
       * left open has to stay open — `whenEmpty` decides what that means.
       */
      const fromStartNode = this.isStartNode(graph, e.sourceNodeId);
      const seeded = e.sourceOutputId ? startNodeOutputs?.get(e.sourceOutputId) : undefined;
      const srcRes = fromStartNode ? seeded : (seeded ?? results.get(e.sourceNodeId));
      if (srcRes === undefined) continue;

      // Check if source is BooleanIO (ASK query result)
      const sourceOutputEntity = e.sourceOutputId ? getCacheCoordinator().get(e.sourceOutputId) : null;
      const isBooleanIO = sourceOutputEntity?.['@type'] === 'BooleanIO';

      if (isBooleanIO) {
        // Handle BooleanIO source: convert boolean to single-variable binding
        if (typeof srcRes !== 'boolean') {
          throw new Error(`BooleanIO edge ${e.id} expects boolean result but got ${typeof srcRes}`);
        }
        const tgtVars = this.getInputTupleNames(graph, e);
        if (tgtVars.length !== 1) {
          throw new Error(`BooleanIO edge ${e.id} must connect to single-variable tuple, found ${tgtVars.length} variables`);
        }
        const varName = tgtVars[0];
        const arg: ArgumentSet = {
          head: { vars: [varName] },
          results: { bindings: [{
            [varName]: {
              type: 'literal',
              value: srcRes.toString(),
              datatype: 'http://www.w3.org/2001/XMLSchema#boolean'
            }
          }] },
        };
        const key = e.targetInputId!;
        byInputTuple.set(key, arg);
        continue;
      }

      // Handle QueryOutputTuple source (standard SELECT query results)
      if (typeof srcRes !== 'object' || !('head' in srcRes)) continue;
      const src = srcRes as SparqlResultsJson;
      const srcVars = this.getOutputTupleNames(graph, e);
      const tgtVars = this.getInputTupleNames(graph, e);
      const mappings = this.resolveVariableMappings(e, srcVars, tgtVars);
      // A mapping that maps nothing is a broken edge, not data: every row it
      // carries would arrive with nothing bound. Said by name, rather than
      // left to surface as whatever the empty rows turn into downstream.
      if (mappings.length === 0 && tgtVars.length > 0 && src.results.bindings.length > 0) {
        throw new Error(
          `Edge ${e.id} maps none of its source's variables [${srcVars.join(', ')}] onto the input it feeds `
          + `[${tgtVars.join(', ')}], so every row it carries would arrive empty. Correct the edge's variable mappings.`
        );
      }
      const arg: ArgumentSet = {
        head: { vars: tgtVars },
        results: { bindings: [] },
      };
      for (const row of src.results.bindings) {
        const b: SparqlBinding = {};
        for (const { source: from, target: to } of mappings) {
          const v = row[from];
          if (!v) continue;
          if (v.type !== 'uri' && v.type !== 'literal') {
            throw new Error(`Unsupported SPARQL value type in chaining: ${v.type}`);
          }
          b[to] = v as SparqlValue;
        }
        /*
         * A row an upstream *query* produced with nothing bound in the mapped
         * columns — what an OPTIONAL yields when it matched nothing — says
         * nothing about this input. Passed on, it became an all-UNDEF VALUES
         * row beside bound ones, which the parser rightly refuses as a
         * wildcard, and the run died on legitimate data. Dropped, it
         * constrains nothing; if every row goes, the input is empty and the
         * edge's `whenEmpty` decides.
         *
         * Not a caller's row arriving through a start node: an all-UNDEF row
         * in a supplied table is an explicit "no constraint", and keeps that
         * meaning (`docs/concepts.md`).
         */
        if (!fromStartNode && Object.keys(b).length === 0) continue;
        arg.results.bindings.push(b);
      }
      // Merge by union for same target input tuple
      const key = e.targetInputId!;
      if (!byInputTuple.has(key)) {
        byInputTuple.set(key, arg);
      } else {
        const exist = byInputTuple.get(key)!;
        const merged = this.unionBindings(exist, arg);
        byInputTuple.set(key, merged);
      }
    }
    return byInputTuple;
  }

  /**
   * What fills each of a node's parameters: one argument set per VALUES
   * clause, in clause order, and the page numbers it declares.
   */
  private resolveNodeArguments(
    graph: ExecutionGraph,
    node: ResolvedNode,
    byInputTuple: Map<string, ArgumentSet>,
    initialArgs?: ArgumentSet[],
    options?: ExecutionOptions,
  ): { argumentSets: ArgumentSet[]; limits: ExecutionPageParameter[]; offsets: ExecutionPageParameter[] } {
    const inputs = this.parser.detectInputs(node.queryString ?? '');
    const detected = inputs.valuesInputs; // string[][]
    const allowedSignatures = new Set(detected.map(group => this.normalizedSignature(group)));

    // Query-group executions pass the same initialArgs to the whole DAG.
    // Only apply argument sets that match a VALUES placeholder in *this* node.
    const matchingInitialArgs = (initialArgs || []).filter((argSet) => {
      const vars = Array.isArray(argSet.head?.vars) ? argSet.head.vars : [];
      return allowedSignatures.has(this.normalizedSignature(vars));
    });

    const argSets: ArgumentSet[] = [];
    for (const group of detected) {
      // The author's per-input policy, if they set one on the declared input tuple.
      const declaredWhenEmpty = this.resolveWhenEmptyForGroup(graph, node, group);

      // By the variables named, not their order: the parser pairs columns by
      // name, so a table naming the same variables in another order fills
      // this clause exactly as `/execute` lets it fill a lone query's.
      const signature = this.normalizedSignature(group);
      const matchKey = Array.from(byInputTuple.entries()).find(([, set]) =>
        this.normalizedSignature(set.head.vars) === signature
      )?.[0];
      if (matchKey) {
        const supplied = byInputTuple.get(matchKey)!;
        // An upstream node supplied this input. Its own policy decides what an empty
        // upstream result means: propagate the empty set, or run open ("optional
        // enrichment"), or fail.
        argSets.push(declaredWhenEmpty ? { ...supplied, whenEmpty: declaredWhenEmpty } : supplied);
      } else {
        // The same signature rule `refuseUnroutedArguments` applies, so what
        // that check let through is what lands here.
        const ext = matchingInitialArgs.find(s => this.normalizedSignature(s.head?.vars ?? []) === signature);
        if (ext) {
          // The author's edge policy applies to what the caller supplied: a
          // request carries rows, never a policy of its own.
          argSets.push(declaredWhenEmpty ? { ...ext, whenEmpty: declaredWhenEmpty } : ext);
        } else {
          // Nothing arrived. Absent external parameters run unconstrained unless the
          // author asked otherwise (notably `require`, for a mandatory parameter).
          argSets.push({
            head: { vars: group },
            results: { bindings: [] },
            whenEmpty: declaredWhenEmpty ?? 'unconstrained',
          });
        }
      }
    }
    /*
     * Filtered to what this node declares. A group's run carries the union of
     * its members' placeholder names, and handing a node a name it never
     * declared would make `substituteLimitOffset` a no-op at best; keeping the
     * filter here means the route can validate names against the group and the
     * engine still cannot mis-apply one. `invokeCallable` applies them, numbers
     * before rows.
     */
    const declaredLimits = new Set(inputs.limitParameters);
    const declaredOffsets = new Set(inputs.offsetParameters);
    const limits = (options?.limits ?? []).filter(parameter => declaredLimits.has(parameter.name));
    const offsets = (options?.offsets ?? []).filter(parameter => declaredOffsets.has(parameter.name));

    return { argumentSets: argSets, limits, offsets };
  }

  /**
   * The author's `whenEmpty` policy for whichever inbound edge feeds the given
   * VALUES group. It lives on the edge because input tuples belong to the
   * QueryVersion and are shared by every group using that query. Unset means the
   * §1.1 defaults apply.
   */
  private resolveWhenEmptyForGroup(
    graph: ExecutionGraph,
    node: ResolvedNode,
    group: string[]
  ): WhenEmptyMode | undefined {
    for (const edge of graph.incomingEdges.get(node.id) || []) {
      if (!edge.whenEmpty || !edge.targetInputId) continue;
      const names = this.resolveInputTupleNames(edge.targetInputId);
      if (names.length !== group.length || !names.every((n, i) => n === group[i])) continue;
      return edge.whenEmpty;
    }
    return undefined;
  }

  /**
   * Refuse a run carrying a table that can reach nothing.
   *
   * A table has two ways to arrive somewhere: a declared start-node port
   * (`seedStartNodeResult` pairs them) or a VALUES clause whose signature it
   * matches (`applyArgumentsInOrder`). One that can do neither was silently
   * dropped before, and the group answered from an unfilled clause — the
   * confident wrong answer `seedStartNodeDataGraphs` already pays a hard error
   * to avoid on the RDF side. The opposite case stays legal: a parameter
   * nothing was supplied for runs open, per `QueryEdge.whenEmpty`.
   *
   * Answered up front, from the ports and the query text, rather than by
   * watching what got used: a group may contain UPDATE nodes, and a request
   * this malformed should cost nothing rather than be reported once half of it
   * has been written.
   *
   * A `DynamicQueryNode` is the one node whose clauses are not knowable here:
   * the query it runs is chosen by an upstream node. So for it alone the check
   * trusts what the node declares instead — its input tuple ports, and the
   * clauses of its declared query — and every other node is held to its text
   * as usual. Letting one dynamic node switch the whole check off would let
   * a stray table through to every static node beside it.
   */
  private refuseUnroutedArguments(graph: ExecutionGraph, initialArgs?: ArgumentSet[]): void {
    if (!initialArgs?.length) return;

    const nodes = Array.from(graph.nodes.values());

    const reachable = new Set<ArgumentSet>();
    for (const node of nodes) {
      if ((node.raw as { '@type'?: string })['@type'] !== 'StartNode') continue;
      for (const { arg } of this.pairArgsToPorts(this.startNodeTuplePorts(graph, node), initialArgs).pairs) {
        reachable.add(arg);
      }
    }

    const clauseSignatures = new Set<string>();
    for (const node of nodes) {
      if ((node.raw as { '@type'?: string })['@type'] === 'DynamicQueryNode') {
        for (const signature of this.dynamicNodeSignatures(node)) clauseSignatures.add(signature);
        continue;
      }
      if (!node.queryString) continue;
      try {
        for (const group of this.parser.detectInputs(node.queryString).valuesInputs ?? []) {
          clauseSignatures.add(this.normalizedSignature(group));
        }
      } catch {
        // Unparseable here is the node's own failure to report when it runs,
        // with its name attached. Treat its clauses as unknown rather than
        // pre-empting that with a worse message about the caller's tables.
        return;
      }
    }

    const stranded = initialArgs.filter(arg =>
      !reachable.has(arg) && !clauseSignatures.has(this.normalizedSignature(arg.head?.vars ?? [])));
    if (!stranded.length) return;

    const described = stranded
      .map(arg => `(${(arg.head?.vars ?? []).map(name => `?${name}`).join(' ')})`)
      .join(', ');
    throw new Error(
      `This run supplies ${stranded.length} table(s) that fill no input the query group declares: ${described}. `
      + 'Drop them, or declare an input for each on the start node.'
    );
  }

  /**
   * The table signatures a dynamic node may consume, as far as they can be
   * known before it resolves its query.
   *
   * Its declared query is only a placeholder for the one that will run, so a
   * parse failure there says nothing about the run and is ignored rather than
   * abandoning the check the way a static node's does.
   */
  private dynamicNodeSignatures(node: ResolvedNode): string[] {
    const signatures: string[] = [];
    for (const portId of node.inputTupleIds) {
      if ((getCacheCoordinator().get(portId) as { '@type'?: string } | null)?.['@type'] !== 'QueryInputTuple') continue;
      const names = this.resolveInputTupleNames(portId);
      if (names.length) signatures.push(this.normalizedSignature(names));
    }
    if (node.queryString) {
      try {
        for (const group of this.parser.detectInputs(node.queryString).valuesInputs ?? []) {
          signatures.push(this.normalizedSignature(group));
        }
      } catch {
        // See above: the placeholder's text is not what runs.
      }
    }
    return signatures;
  }

  /**
   * The start node's tuple ports, in declaration order.
   *
   * QUERY_ID counts as well as VARIABLE_BINDINGS: "the caller chooses which
   * query runs" is an external parameter like any other, and reads its value
   * from the same seeded output tuple.
   *
   * Ordered by the port's stored `position` where it has one, because
   * `StartNode.outputs` is an RDF array and does not come back in the order it
   * was written. Ports are routed by position, so that order is load-bearing.
   */
  private startNodeTuplePorts(graph: ExecutionGraph, node: ResolvedNode): string[] {
    const wired = new Set((graph.outgoingEdges.get(node.id) || [])
      .filter(edge => (edge.dataFlowType === 'VARIABLE_BINDINGS' || edge.dataFlowType === 'QUERY_ID') && edge.sourceOutputId)
      .map(edge => edge.sourceOutputId!));
    const declared = node.outputTupleIds.filter(id => wired.has(id));
    for (const id of wired) if (!declared.includes(id)) declared.push(id);
    return orderByPosition(declared.map(id => ({
      id,
      position: (getCacheCoordinator().get(id) as { position?: number | null } | null)?.position ?? null,
    }))).map(entry => entry.id);
  }

  /**
   * A StartNode is a data source as well as a control-flow marker.
   *
   * The run supplies an ordered list of tables and the group says where they
   * go: an argument set carries payload, a group owns routing
   * (`docs/guides/query-groups.md`). Pairing is by exact signature first
   * — which is the whole of the previous rule, so every set that worked before
   * still lands where it did — and then by position for whatever is left, so a
   * table whose columns are named differently or ordered differently from the
   * port still reaches it.
   *
   * Seeded rows are keyed by the **port's** declared variable names, not by the
   * supplied ones. Downstream reads them that way already
   * (`buildArgumentSetsForNode`, `applyDynamicQueryOverride`); it was only ever
   * correct because signature equality made the two spellings identical.
   */
  private seedStartNodeResult(
    graph: ExecutionGraph,
    node: ResolvedNode,
    results: Map<string, NodeResult>,
    startNodeOutputs: Map<string, SparqlResultsJson>,
    initialArgs?: ArgumentSet[]
  ): void {
    if (!initialArgs?.length) return;
    const { pairs } = this.pairArgsToPorts(this.startNodeTuplePorts(graph, node), initialArgs);

    for (const { portId, arg } of pairs) {
      const declaredVars = this.resolveOutputTupleNames(portId);
      const seeded: SparqlResultsJson = {
        head: { vars: declaredVars },
        results: { bindings: this.mapRowsToPort(portId, arg, declaredVars) },
      };
      startNodeOutputs.set(portId, seeded);
      // Mark the node as having produced data so downstream edges are considered.
      if (!results.has(node.id)) results.set(node.id, seeded);
    }
  }

  /**
   * Which supplied table fills which port.
   *
   * Exact signature first — the whole of the previous rule, so every set that
   * worked before still lands where it did — then the remainder by position,
   * which is what makes "table 1, table 2" work without the caller restating
   * the group's vocabulary. A table with no port left over is not an error
   * here: a group may declare no start-node ports at all and let its query
   * nodes match external arguments by signature instead.
   *
   * Pure, so `refuseUnroutedArguments` can ask the same question before
   * anything runs and get the same answer.
   */
  private pairArgsToPorts(ports: string[], args: ArgumentSet[]): {
    pairs: Array<{ portId: string; arg: ArgumentSet }>;
    unrouted: ArgumentSet[];
  } {
    const remainingPorts = [...ports];
    const pairs: Array<{ portId: string; arg: ArgumentSet }> = [];
    const unmatched: ArgumentSet[] = [];

    for (const arg of args) {
      const signature = this.normalizedSignature(arg.head?.vars ?? []);
      const at = remainingPorts.findIndex(portId => this.normalizedSignature(this.resolveOutputTupleNames(portId)) === signature);
      if (at < 0) { unmatched.push(arg); continue; }
      pairs.push({ portId: remainingPorts[at], arg });
      remainingPorts.splice(at, 1);
    }

    const unrouted: ArgumentSet[] = [];
    for (const arg of unmatched) {
      const portId = remainingPorts.shift();
      if (!portId) { unrouted.push(arg); continue; }
      pairs.push({ portId, arg });
    }
    return { pairs, unrouted };
  }

  /**
   * Rewrite a supplied table's rows into the port's vocabulary.
   *
   * The port's own `variableMappings` when the author set one, and otherwise
   * the same default every other hop uses: exact names first, then pair what
   * is left by position. A supplied column the mapping does not mention is
   * dropped, which is how partial consumption is expressed.
   */
  private mapRowsToPort(portId: string, arg: ArgumentSet, declaredVars: string[]): SparqlBinding[] {
    const suppliedVars = arg.head.vars;
    const stored = (getCacheCoordinator().get(portId) as { variableMappings?: string | null } | null)?.variableMappings ?? null;
    const mappings = this.variableMappingsFrom(stored, suppliedVars, declaredVars);
    // The common case by far: same names, nothing to rewrite.
    if (mappings.every(({ source, target }) => source === target) && suppliedVars.length === declaredVars.length) {
      return arg.results.bindings;
    }
    return arg.results.bindings.map(row => {
      const mapped: SparqlBinding = {};
      for (const { source, target } of mappings) {
        const value = row[source];
        if (value) mapped[target] = value;
      }
      return mapped;
    });
  }

  /**
   * The start node's declared data graph inputs, in declaration order.
   *
   * Declaration order is the port order on the node, so a caller may supply
   * graphs positionally; ports reached only through an edge are appended after
   * the declared ones so a group that wires an undeclared port still runs.
   */
  private startNodeDataGraphPorts(graph: ExecutionGraph, node: ResolvedNode): string[] {
    const cache = getCacheCoordinator();
    const isRdfPort = (id: string) => cache.get(id)?.['@type'] === 'TriplesQuadsIO';
    const ports: string[] = [];
    for (const id of node.outputTupleIds) {
      if (isRdfPort(id) && !ports.includes(id)) ports.push(id);
    }
    for (const edge of graph.outgoingEdges.get(node.id) || []) {
      const id = edge.sourceOutputId;
      if (!id || edge.dataFlowType !== 'RDF_GRAPH') continue;
      if (!ports.includes(id)) ports.push(id);
    }
    // By stored ordinal where the ports carry one: `StartNode.outputs` is an
    // RDF array, so its order is not the author's. Ports that predate the field
    // keep the order they arrived in, which is no worse than before.
    return orderByPosition(ports.map(id => ({
      id,
      position: (cache.get(id) as { position?: number | null } | null)?.position ?? null,
    }))).map(entry => entry.id);
  }

  /** A data graph port's author-given name, for matching and for messages. */
  private dataGraphPortName(portId: string): string | null {
    const entity = getCacheCoordinator().get(portId) as { name?: string | null } | null;
    const name = entity?.name?.trim();
    return name ? name : null;
  }

  private describeDataGraphPort(portId: string): string {
    const name = this.dataGraphPortName(portId);
    return name ? `${name} (${portId})` : portId;
  }

  /**
   * Bind the run's data graphs to the start node's declared RDF inputs.
   *
   * Tuples and data graphs are separate slots on the same node rather than
   * alternatives: a group may declare both, and a run fills each from its own
   * source - `arguments` for the tuples, `dataGraphs` for the graphs.
   *
   * By position, and only by position: the run says what it supplies and in
   * what order, and the group's declared order says where each one goes. Either
   * side coming up short throws rather than running a graph without its data —
   * a group whose data input silently arrived empty returns a plausible, wrong
   * answer, which is the failure mode worth paying a hard error to avoid.
   */
  private seedStartNodeDataGraphs(
    graph: ExecutionGraph,
    node: ResolvedNode,
    startNodeGraphs: Map<string, ExecutionDataGraphInput>,
    dataGraphs?: ExecutionDataGraphInput[]
  ): void {
    const ports = this.startNodeDataGraphPorts(graph, node);
    const supplied = dataGraphs ?? [];

    if (ports.length === 0) {
      if (supplied.length > 0) {
        throw new Error(
          `This run supplies ${supplied.length} data graph(s), but the query group's start node declares no data graph input to put them in. `
          + 'Add a data graph input to the start node, or drop the graphs from the run.'
        );
      }
      return;
    }

    if (supplied.length > ports.length) {
      throw new Error(
        `This run supplies ${supplied.length} data graph(s) but the query group's start node declares ${ports.length}. `
        + 'Supply one graph per declared input, in the order they are declared.'
      );
    }

    supplied.forEach((entry, index) => {
      startNodeGraphs.set(ports[index], entry);
    });

    const unfilled = ports.filter(portId => !startNodeGraphs.has(portId));
    if (unfilled.length > 0) {
      throw new Error(
        `The query group's start node declares data graph input ${unfilled.map(portId => this.describeDataGraphPort(portId)).join(', ')}, `
        + 'which this run did not supply. Supply a data graph for every declared input.'
      );
    }
  }

  /**
   * Load whatever the start node supplies into a SPARQL node's ephemeral store.
   *
   * The graph validator only lets a start node's RDF reach a query node that
   * has one, for the reason stated there: without a store the edge would
   * transfer nothing and the node would quietly query its own backend instead.
   */
  private async loadStartNodeGraphsIntoNode(
    graph: ExecutionGraph,
    node: ResolvedNode,
    startNodeGraphs: Map<string, ExecutionDataGraphInput>
  ): Promise<void> {
    if (startNodeGraphs.size === 0) return;
    for (const edge of graph.incomingEdges.get(node.id) || []) {
      if (edge.dataFlowType !== 'RDF_GRAPH' || !edge.sourceOutputId) continue;
      const seeded = startNodeGraphs.get(edge.sourceOutputId);
      if (!seeded) continue;
      const storeId = node.backendConfig?.storeId;
      if (!storeId) {
        throw new Error(
          `Node ${node.id} receives a data graph from the start node but has no ephemeral store to load it into.`
        );
      }
      await this.materializeRdfResult(storeId, seeded.content, seeded.format);
    }
  }

  private getOutputTupleNames(graph: ExecutionGraph, e: ResolvedEdge): string[] {
    if (!e.sourceOutputId) return [];
    return this.resolveOutputTupleNames(e.sourceOutputId);
  }

  private getInputTupleNames(graph: ExecutionGraph, e: ResolvedEdge): string[] {
    if (!e.targetInputId) return [];
    return this.resolveInputTupleNames(e.targetInputId);
  }

  private resolveVariableMappings(e: ResolvedEdge, sourceVars: string[], targetVars: string[]): Array<{ source: string; target: string }> {
    return this.variableMappingsFrom(e.variableMappings, sourceVars, targetVars);
  }

  /**
   * An author's `{ source, target }[]` if it parses, else the default pairing.
   *
   * Shared by the edges inside a group and by the start node's ports, so the
   * boundary lines variables up the way every other hop already does. Entries
   * naming a variable neither side declares are dropped rather than failing the
   * run — a mapping written against an older signature degrades to the default
   * for the parts that no longer apply.
   */
  private variableMappingsFrom(raw: string | null | undefined, sourceVars: string[], targetVars: string[]): Array<{ source: string; target: string }> {
    try {
      if (raw) {
        const parsed = JSON.parse(raw) as Array<{ source?: unknown; target?: unknown }>;
        if (Array.isArray(parsed)) {
          const allowedSource = new Set(sourceVars);
          const allowedTarget = new Set(targetVars);
          const usedTargets = new Set<string>();
          return parsed.filter((m): m is { source: string; target: string } =>
            typeof m.source === 'string' && typeof m.target === 'string' &&
            allowedSource.has(m.source) && allowedTarget.has(m.target) &&
            !usedTargets.has(m.target) && (usedTargets.add(m.target), true));
        }
      }
    } catch { /* fall through to defaults */ }
    // Default: exact names first, then pair the remaining variables by position.
    const mappings: Array<{ source: string; target: string }> = [];
    const remainingSource = new Set(sourceVars);
    const remainingTarget = new Set(targetVars);
    for (const target of targetVars) if (remainingSource.delete(target)) { mappings.push({ source: target, target }); remainingTarget.delete(target); }
    const sources = sourceVars.filter(name => remainingSource.has(name));
    const targets = targetVars.filter(name => remainingTarget.has(name));
    for (let i = 0; i < Math.min(sources.length, targets.length); i++) mappings.push({ source: sources[i], target: targets[i] });
    return mappings;
  }

  private resolveInputTupleNames(tupleId: string): string[] {
    return tupleVariableNames(tupleId);
  }

  private resolveOutputTupleNames(tupleId: string): string[] {
    return tupleVariableNames(tupleId);
  }

  private normalizedSignature(vars: string[]): string {
    return vars.map(v => v.replace(/^\?/, '')).sort().join('|');
  }

  private unionBindings(a: ArgumentSet, b: ArgumentSet): ArgumentSet {
    // Canonical key, not JSON.stringify of the row as it happens to be built.
    // Rows are assembled in edge-mapping order, so two edges feeding the same
    // input tuple can deliver identical rows with different key insertion order
    // - {group, label} from one and {label, group} from the other - and an
    // order-sensitive key silently fails to dedupe them. Sorting the variables
    // and spelling each term out makes the key describe the row rather than how
    // it was written.
    const keyOf = (row: SparqlBinding) => JSON.stringify(
      Object.keys(row).sort().map(name => {
        const term = row[name];
        return [name, term?.type, term?.value, term?.datatype ?? null, term?.['xml:lang'] ?? null];
      }),
    );
    const set = new Set<string>();
    const out: SparqlBinding[] = [];
    for (const r of a.results.bindings) { const k = keyOf(r); if (!set.has(k)) { set.add(k); out.push(r);} }
    for (const r of b.results.bindings) { const k = keyOf(r); if (!set.has(k)) { set.add(k); out.push(r);} }
    return { head: a.head, results: { bindings: out } };
  }

  /**
   * Load RDF into a store this run created.
   *
   * A missing store is a failure, not a warning: the nodes downstream would
   * otherwise query a store without the data they were wired to receive and
   * answer confidently from less than the author meant. An empty payload is a
   * legitimate empty graph and loads nothing.
   */
  private async materializeRdfResult(storeId: string, rdf: string, format: string): Promise<void> {
    const store = oxigraphStoreManager.getEphemeralStore(storeId);
    if (!store) {
      throw new Error(`Ephemeral store ${storeId} does not exist, so RDF meant for it cannot be loaded`);
    }
    if (!rdf || !rdf.trim()) return;
    await oxigraphStoreManager.loadDataFromString(store, rdf, format);
  }

  private resolveRdfFormatFromAccept(acceptHeader: string | null): string {
    return rdfFormatFromMediaType(acceptHeader);
  }

  private applyDynamicQueryOverride(
    graph: ExecutionGraph,
    node: ResolvedNode,
    results: Map<string, NodeResult>,
    startNodeOutputs?: Map<string, SparqlResultsJson>
  ) {
    const rawType = (node.raw)['@type'];
    const inbound = graph.incomingEdges.get(node.id) || [];
    const queryIdEdges = inbound.filter((edge) => edge.dataFlowType === 'QUERY_ID');
    if (queryIdEdges.length === 0) {
      return;
    }
    if (rawType !== 'DynamicQueryNode') {
      throw new Error(`QUERY_ID flow targets non-dynamic node ${node.id}`);
    }
    if (queryIdEdges.length > 1) {
      throw new Error(`DynamicQueryNode ${node.id} has multiple QUERY_ID inputs`);
    }

    const edge = queryIdEdges[0];
    if (!edge.sourceOutputId || !edge.targetInputId) {
      throw new Error(`QUERY_ID edge ${edge.id} must specify sourceOutputId and targetInputId`);
    }
    // A StartNode supplies data per output tuple, not per node, so an externally
    // chosen query id has to be read from the seeded outputs - the same rule
    // VARIABLE_BINDINGS edges out of a StartNode already follow, including that
    // the node-level result is not a stand-in for a port that got nothing.
    const seeded = startNodeOutputs?.get(edge.sourceOutputId);
    const sourceResult = this.isStartNode(graph, edge.sourceNodeId)
      ? seeded
      : (seeded ?? results.get(edge.sourceNodeId));
    if (sourceResult === undefined) {
      throw new Error(`Missing QUERY_ID source result from node ${edge.sourceNodeId}`);
    }
    if (typeof sourceResult !== 'object' || sourceResult === null || !('head' in sourceResult)) {
      throw new Error(`QUERY_ID edge ${edge.id} expects SELECT results`);
    }

    const src = sourceResult as SparqlResultsJson;
    const outputVars = this.resolveOutputTupleNames(edge.sourceOutputId);
    if (outputVars.length !== 1) {
      throw new Error(`QUERY_ID edge ${edge.id} expects a single output variable`);
    }
    const varName = outputVars[0];
    if (!Array.isArray(src.results?.bindings) || src.results.bindings.length !== 1) {
      throw new Error(`QUERY_ID edge ${edge.id} expects exactly one binding row`);
    }
    const binding = src.results.bindings[0];
    const value = binding?.[varName];
    if (!value || value.type !== 'uri') {
      throw new Error(`QUERY_ID edge ${edge.id} expects a URI value for ${varName}`);
    }

    const queryVersionId = value.value;
    const resolved = getCacheCoordinator().get(queryVersionId);
    if (!resolved || resolved['@type'] !== 'QueryVersion') {
      throw new Error(`QUERY_ID edge ${edge.id} references missing QueryVersion ${queryVersionId}`);
    }

    this.requireDynamicQueryReachable(graph, queryVersionId, resolved);
    const queryType = toQueryTypeIri(resolved.queryType as string | undefined | null) ?? null;
    this.requireDynamicQueryTypeFits(graph, node, queryVersionId, queryType);

    node.queryVersionId = queryVersionId;
    node.queryVersion = resolved;
    node.queryString = resolved.queryString as string;
    node.queryType = queryType;
  }

  /**
   * A QUERY_ID value is data — possibly the caller's own, seeded through the
   * start node — so the version it names is only as trustworthy as whoever
   * supplied it. Without this, one group could run any QueryVersion in the
   * process, from any library, against the node's backend.
   *
   * The group's own library is always in reach: its author could have wired
   * that query in statically. Beyond it, a caller may reach a library they may
   * `execute`, which is exactly what running that query directly would need.
   * An internal execution has no caller to ask, so it is held to the group's
   * library alone; only when even that is unknown (a graph assembled without
   * a stored group) does it keep resolving freely, as sqlib's own work always
   * has.
   *
   * The group's library comes from the graph's `groupVersion`, falling back to
   * the scope's `viaLibrary` — the route sets that to the same library, and it
   * is the only answer for a graph whose group version is not stored.
   */
  private requireDynamicQueryReachable(
    graph: ExecutionGraph,
    queryVersionId: string,
    resolved: unknown
  ): void {
    const scope = this.executorFactory.callerScope;
    const groupLibrary = resolveOwningLibrary(graph.groupVersion) ?? scope?.viaLibrary ?? null;
    const queryLibrary = resolveOwningLibrary(resolved);

    if (groupLibrary && queryLibrary === groupLibrary) return;
    if (scope) {
      requireLibraryMode(scope.request, queryLibrary, 'execute');
      return;
    }
    if (!groupLibrary) return;
    throw new Error(
      `QueryVersion ${queryVersionId} belongs to ${queryLibrary ?? 'no library'}, `
      + `not to this group's library ${groupLibrary}`
    );
  }

  /**
   * The chosen query must produce what the node's outgoing edges carry.
   *
   * The graph was validated against the node's declared query, not the one
   * chosen at runtime, so nothing upstream has checked this pairing. A SELECT
   * where an RDF_GRAPH edge expects triples fails confusingly downstream at
   * best; an UPDATE is never acceptable, because a value flowing along an edge
   * must not be able to turn a read into a write.
   *
   * Control-flow edges carry nothing and constrain nothing, so a node reached
   * only by them may run any read.
   */
  private requireDynamicQueryTypeFits(
    graph: ExecutionGraph,
    node: ResolvedNode,
    queryVersionId: string,
    queryType: QueryTypeValue | null
  ): void {
    const effective = queryType ?? QueryTypeIri.select;
    if (effective === QueryTypeIri.update) {
      throw new Error(`DynamicQueryNode ${node.id} cannot run UPDATE QueryVersion ${queryVersionId}`);
    }
    const carries: Record<string, QueryTypeValue[]> = {
      VARIABLE_BINDINGS: [QueryTypeIri.select],
      QUERY_ID: [QueryTypeIri.select],
      RDF_GRAPH: [QueryTypeIri.construct, QueryTypeIri.describe],
      BOOLEAN: [QueryTypeIri.ask],
    };
    for (const edge of graph.outgoingEdges.get(node.id) || []) {
      const accepted = edge.dataFlowType ? carries[edge.dataFlowType] : undefined;
      if (!accepted || accepted.includes(effective)) continue;
      throw new Error(
        `DynamicQueryNode ${node.id} resolved QueryVersion ${queryVersionId} of type `
        + `${(getQueryTypeKeyFromIri(effective) ?? effective).toUpperCase()}, which its ${edge.dataFlowType} edge ${edge.id} cannot carry`
      );
    }
  }
}
