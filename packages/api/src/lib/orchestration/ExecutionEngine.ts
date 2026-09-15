import { orderByPosition } from '@sparql-query-lib/types';
import * as oxigraph from 'oxigraph';
import { toError } from '../toError.js';
import type { ExecutionGraph, ResolvedNode, ResolvedEdge, ArgumentSet, SparqlResultsJson, FinalResult, NodeResult } from './types.js';
import { ExecutorFactory } from './ExecutorFactory.js';
import { SparqlQueryParser } from '../parser.js';
import type { SparqlBinding, SparqlValue } from '../query-chaining.js';
import { getCacheCoordinator } from '../CacheCoordinatorProvider.js';
import { oxigraphStoreManager } from '../OxigraphStoreManager.js';
import { QueryTypeIri } from '../../constants/queryTypes.js';
import { toQueryTypeIri } from '../queryTypes.js';
import { RuleSetExecutor } from '../RuleSetExecutor.js';
import { duckDbService } from '../DuckDbService.js';
import {
  derivePatch,
  patchToRdfPatch,
  quadsToNQuads,
  type DeltaStore,
} from '@sparql-query-lib/rdf-delta';
import { oxigraphDeltaStore } from '../deltaStore.js';
import { resolvePatchTarget } from '../patchTargets.js';
import type { WhenEmptyMode } from '../../persistence/schemas/QueryEdgeSchema.js';
import type { ColumnDefinition } from '../../persistence/schemas/EtlColumnMappingVersionSchema.js';

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
    private readonly executorFactory = new ExecutorFactory(),
    private readonly parser = new SparqlQueryParser(),
    private readonly ruleSetExecutor = new RuleSetExecutor()
  ) {}

  async execute(
    graph: ExecutionGraph,
    initialArgs?: ArgumentSet[],
    hooks?: ExecutionHooks,
    options?: ExecutionOptions
  ): Promise<FinalResult> {
    // Track ephemeral stores created during execution for cleanup
    const ephemeralStores = new Set<string>();
    const acceptHeader = options?.acceptHeader ?? null;
    
    try {
      // Topological order (Kahn)
      const indeg = new Map<string, number>();
      for (const id of Array.from(graph.nodes.keys())) indeg.set(id, 0);
      for (const e of graph.edges) indeg.set(e.targetNodeId, (indeg.get(e.targetNodeId) || 0) + 1);
      const q: string[] = Array.from(graph.nodes.keys()).filter(id => (indeg.get(id) || 0) === 0);
      const results = new Map<string, NodeResult>();
      /**
       * Results addressed by output port rather than by node.
       *
       * Every other node kind produces one value that all of its outgoing edges
       * share, so `results` keyed by node is enough. A PatchNode produces two —
       * deletions and additions — and an edge says which it carries through
       * `sourceOutputId`. Consumers therefore consult this first and fall back
       * to the node's result, so nothing else has to know a port map exists.
       */
      const portResults = new Map<string, NodeResult>();
      // A StartNode carries one independent parameter per output tuple, so its seeded
      // data is keyed by output tuple rather than by node like executed results.
      const startNodeOutputs = new Map<string, SparqlResultsJson>();
      // The RDF half of the same idea: one supplied graph per declared data
      // graph input, keyed by the output port it arrived for.
      const startNodeGraphs = new Map<string, ExecutionDataGraphInput>();
      const order: string[] = [];

      const startNodeSet = new Set(graph.startNodeIds ?? []);
      const endNodeSet = new Set(graph.endNodeIds ?? []);

      // Before anything runs: a group may contain UPDATE nodes, and a bad
      // request must not be reported only after half of it has been applied.
      this.refuseUnroutedArguments(graph, initialArgs);

      while (q.length) {
        const id = q.shift()!;
        const node = graph.nodes.get(id)!;

        // Get node type to determine if execution is needed
        const nodeType = this.determineNodeType(node, startNodeSet, endNodeSet);

        // StartNode and EndNode are control flow markers - they don't execute queries
        if (nodeType === 'StartNode' || nodeType === 'EndNode') {
          if (nodeType === 'StartNode') {
            this.seedStartNodeResult(graph, node, results, startNodeOutputs, initialArgs);
            this.seedStartNodeDataGraphs(graph, node, startNodeGraphs, options?.dataGraphs);
          }
          order.push(id);
          // Advance the topological order for downstream nodes
          for (const e of graph.outgoingEdges.get(id) || []) {
            const d = (indeg.get(e.targetNodeId) || 0) - 1;
            indeg.set(e.targetNodeId, d);
            if (d === 0) q.push(e.targetNodeId);
          }
          continue;
        }

        if (nodeType === 'RuleSetNode') {
          const nodeOrderIndex = order.length;
          const nodeStart = performance.now();
          hooks?.onNodeStart?.(node, nodeOrderIndex);
          try {
            const ruleSetVersion = node.ruleSetVersion;
            if (!ruleSetVersion) {
              throw new Error(`RuleSetNode ${node.id} missing resolved RuleSetVersion`);
            }
            const rdfSeed = this.buildRdfSeedForRuleSetNode(graph, node, results, portResults, startNodeGraphs);
            const executionResult = await this.ruleSetExecutor.execute(ruleSetVersion, {
              initialGraph: rdfSeed || undefined,
            });
            const graphResult = executionResult.finalGraphNQuads ?? executionResult.finalGraphContent ?? '';
            results.set(id, graphResult);
            hooks?.onNodeFinish?.(node, graphResult, performance.now() - nodeStart, nodeOrderIndex);
          } catch (error__u: unknown) {
            const error = toError(error__u);
            hooks?.onNodeError?.(node, error, performance.now() - nodeStart, nodeOrderIndex);
            throw new ExecutionNodeError(node.id, (node.raw as { name?: string }).name ?? node.id, error);
          }
          order.push(id);
          for (const e of graph.outgoingEdges.get(id) || []) {
            const d = (indeg.get(e.targetNodeId) || 0) - 1;
            indeg.set(e.targetNodeId, d);
            if (d === 0) q.push(e.targetNodeId);
          }
          continue;
        }

        if (nodeType === 'PatchNode') {
          const nodeOrderIndex = order.length;
          const nodeStart = performance.now();
          hooks?.onNodeStart?.(node, nodeOrderIndex);
          try {
            const deletionsPort = node.deletionsOutputId;
            const additionsPort = node.additionsOutputId;
            if (!deletionsPort || !additionsPort) {
              throw new Error(
                `PatchNode ${node.id} reached execution without both output ports; ` +
                `there is no way to say which half is which`,
              );
            }
            // The store this node derives against is torn down with the run,
            // like any other ephemeral one - it is created here when an
            // upstream node has not already made it.
            if (node.backendConfig?.type === 'ephemeral-oxigraph') {
              ephemeralStores.add(node.backendConfig.storeId);
            }
            const { document, deletions, additions } = await this.executePatchNode(node);
            // Both halves are addressed by port, because they are only
            // distinguishable by which port they left through. The node-level
            // result is the patch document — what a run report shows for the
            // node, and the only form in which the two halves stay one thing.
            portResults.set(deletionsPort, deletions);
            portResults.set(additionsPort, additions);
            results.set(id, document);
            hooks?.onNodeFinish?.(node, document, performance.now() - nodeStart, nodeOrderIndex);
          } catch (error__u: unknown) {
            const error = toError(error__u);
            hooks?.onNodeError?.(node, error, performance.now() - nodeStart, nodeOrderIndex);
            throw new ExecutionNodeError(node.id, (node.raw as { name?: string }).name ?? node.id, error);
          }
          order.push(id);
          for (const e of graph.outgoingEdges.get(id) || []) {
            const d = (indeg.get(e.targetNodeId) || 0) - 1;
            indeg.set(e.targetNodeId, d);
            if (d === 0) q.push(e.targetNodeId);
          }
          continue;
        }

        if (nodeType === 'DuckDbEtlNode') {
          const nodeOrderIndex = order.length;
          const nodeStart = performance.now();
          hooks?.onNodeStart?.(node, nodeOrderIndex);
          try {
            const etlJobVersion = node.etlJobVersion;
            if (!etlJobVersion) {
              throw new Error(`DuckDbEtlNode ${node.id} missing resolved EtlJobVersion`);
            }
            const nodeResult = await this.executeDuckDbEtlNode(graph, node, results);
            results.set(id, nodeResult);
            hooks?.onNodeFinish?.(node, nodeResult, performance.now() - nodeStart, nodeOrderIndex);
          } catch (error__u: unknown) {
            const error = toError(error__u);
            hooks?.onNodeError?.(node, error, performance.now() - nodeStart, nodeOrderIndex);
            throw new ExecutionNodeError(node.id, (node.raw as { name?: string }).name ?? node.id, error);
          }
          order.push(id);
          for (const e of graph.outgoingEdges.get(id) || []) {
            const d = (indeg.get(e.targetNodeId) || 0) - 1;
            indeg.set(e.targetNodeId, d);
            if (d === 0) q.push(e.targetNodeId);
          }
          continue;
        }

        // Track ephemeral stores for cleanup
        if (node.backendConfig?.type === 'ephemeral-oxigraph') {
          ephemeralStores.add(node.backendConfig.storeId);
        }

        const nodeOrderIndex = order.length;
        const nodeStart = performance.now();
        hooks?.onNodeStart?.(node, nodeOrderIndex);

        const type = toQueryTypeIri(node.queryType) || QueryTypeIri.select;
        let nodeResult: NodeResult;
        try {
          // Resolving the executor belongs inside the node's error boundary too:
          // a node pointing at a missing or unsupported backend is that node's
          // failure, and a run that cannot say which node broke is the opaque
          // error the structured failure body exists to replace.
          const exec = await this.executorFactory.getExecutorForNode(node);
          // A start node holds no store of its own, so RDF it supplies reaches a
          // SPARQL node the only way RDF ever does: loaded into the ephemeral
          // store that node queries. Done after the executor call because that
          // is what creates the store.
          await this.loadStartNodeGraphsIntoNode(graph, node, startNodeGraphs);
          // Argument application belongs inside the node's error boundary: a bad
          // argument set is that node's failure, and must report as one.
          this.applyDynamicQueryOverride(graph, node, results, startNodeOutputs);
          const argSets = this.buildArgumentSetsForNode(graph, node, results, startNodeOutputs);
          const query = this.applyArgumentsInOrder(graph, node, argSets, initialArgs, options);

          if (type === QueryTypeIri.ask) {
            const { result } = await exec.askQuery(query);
            nodeResult = result;
          } else if (type === QueryTypeIri.update) {
            await exec.update(query);
            nodeResult = { success: true };
          } else if (type === QueryTypeIri.construct || type === QueryTypeIri.describe) {
            const { result } = await exec.constructQueryParsed(query, {
              acceptHeader: acceptHeader || undefined,
            });
            nodeResult = result;
          } else {
            // default to SELECT
            const { result } = await exec.selectQueryParsed(query);
            nodeResult = result;
          }
        } catch (err__u: unknown) {
      const err = toError(err__u);
          const durationMs = performance.now() - nodeStart;
          const error = err instanceof Error ? err : new Error(String(err));
          hooks?.onNodeError?.(node, error, durationMs, nodeOrderIndex);
          const originalMessage = err?.message || String(err);
          const queryName = (node.queryVersion as { name?: string } | undefined)?.name || (node.raw as { name?: string }).name || node.id;
          throw new ExecutionNodeError(node.id, queryName, new Error(originalMessage));
        }
        const durationMs = performance.now() - nodeStart;
        hooks?.onNodeFinish?.(node, nodeResult, durationMs, nodeOrderIndex);
        results.set(id, nodeResult);
        order.push(id);

        const shouldMaterializeRdf =
          node.backendConfig?.type === 'ephemeral-oxigraph' &&
          node.needsEphemeralMaterialization &&
          (type === QueryTypeIri.construct || type === QueryTypeIri.describe);

        if (shouldMaterializeRdf) {
          if (typeof nodeResult !== 'string') {
            throw new Error(`Node ${node.id} expected RDF string result for materialization but received ${typeof nodeResult}`);
          }
          const storeId = node.backendConfig?.storeId;
          if (!storeId) {
            throw new Error(`Node ${node.id} requires storeId to materialize RDF output.`);
          }
          const format = this.resolveRdfFormatFromAccept(acceptHeader);
          await this.materializeRdfResult(storeId, nodeResult, format);
        }

        for (const e of graph.outgoingEdges.get(id) || []) {
          const d = (indeg.get(e.targetNodeId) || 0) - 1;
          indeg.set(e.targetNodeId, d);
          if (d === 0) q.push(e.targetNodeId);
        }
      }

      // Choose final result
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

      const predecessorResults: Array<{ nodeId: string; result: NodeResult; inputId: string }> = [];

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
        const seededGraph = supplyingEdge.sourceOutputId
          ? startNodeGraphs.get(supplyingEdge.sourceOutputId)
          : undefined;
        const supplierResult = seededGraph
          ? seededGraph.content
          : (supplyingEdge.sourceOutputId && portResults.has(supplyingEdge.sourceOutputId)
            ? portResults.get(supplyingEdge.sourceOutputId)
            : results.get(supplyingEdge.sourceNodeId));
        if (supplierResult === undefined) {
          throw new Error(`Missing execution result for node ${supplyingEdge.sourceNodeId} feeding EndNode input ${inputId}`);
        }

        predecessorResults.push({ nodeId: supplyingEdge.sourceNodeId, result: supplierResult, inputId });
      }

      if (predecessorResults.length === 0) {
        throw new Error(`EndNode ${endNodeId} has no data inputs (only control flow); nothing to return`);
      }

      // Single predecessor: return its result directly
      if (predecessorResults.length === 1) {
        return {
          result: predecessorResults[0].result,
          resultNodeId: predecessorResults[0].nodeId
        };
      }

      // Multiple predecessors: merge RDF outputs
      // For now, all must be RDF strings (CONSTRUCT/DESCRIBE results)
      const rdfOutputs: string[] = [];
      for (const { nodeId, result, inputId } of predecessorResults) {
        if (typeof result !== 'string') {
          throw new Error(
            `EndNode input ${inputId} expects RDF string output. ` +
            `Node ${nodeId} produced ${typeof result}. ` +
            `Support for merging bindings/booleans is not yet implemented.`
          );
        }
        rdfOutputs.push(result);
      }

      // Concatenate all RDF outputs (assumes N-Triples or compatible format)
      const mergedRdf = rdfOutputs.join('\n');

      return {
        result: mergedRdf,
        resultNodeId: endNodeId
      };
    } finally {
      // Clean up ephemeral stores
      for (const storeId of Array.from(ephemeralStores)) {
        oxigraphStoreManager.destroyEphemeralStore(storeId);
      }
    }
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
   * Determine if a node is a StartNode, EndNode, RuleSetNode, PatchNode, DuckDbEtlNode, or executable QueryNode/DynamicQueryNode
   * Uses @type if available, otherwise infers from graph structure and node properties
   */
  private determineNodeType(node: ResolvedNode, startNodeSet: Set<string>, endNodeSet: Set<string>): 'StartNode' | 'EndNode' | 'RuleSetNode' | 'PatchNode' | 'DuckDbEtlNode' | 'ExecutableNode' {
    // Check @type if available
    const rawType = (node.raw)['@type'];
    if (rawType === 'StartNode') return 'StartNode';
    if (rawType === 'EndNode') return 'EndNode';
    if (rawType === 'RuleSetNode') return 'RuleSetNode';
    /*
     * Before the fallbacks, and deliberately so. A PatchNode carries an update
     * query string, so anything that reasons from "has a query" downwards
     * classifies it as executable and *runs the update* — the one outcome this
     * node type exists to avoid.
     */
    if (rawType === 'PatchNode') return 'PatchNode';
    if (rawType === 'DuckDbEtlNode') return 'DuckDbEtlNode';
    if (rawType === 'QueryNode' || rawType === 'DynamicQueryNode') return 'ExecutableNode';

    // Fallback: infer from graph structure and node properties
    // StartNode/EndNode don't have queryString
    if (!node.queryString) {
      if (startNodeSet.has(node.id)) return 'StartNode';
      if (endNodeSet.has(node.id)) return 'EndNode';
    }

    // Default to executable node for unit tests and backwards compatibility
    if (node.ruleSetVersion) return 'RuleSetNode';
    // Two signed ports is a shape no other node has, so it identifies one here
    // for the same reason `ruleSetVersion` does above.
    if (node.deletionsOutputId && node.additionsOutputId) return 'PatchNode';
    if (node.etlJobVersion) return 'DuckDbEtlNode';
    return 'ExecutableNode';
  }

  private buildRdfSeedForRuleSetNode(
    graph: ExecutionGraph,
    node: ResolvedNode,
    results: Map<string, NodeResult>,
    portResults: Map<string, NodeResult>,
    startNodeGraphs?: Map<string, ExecutionDataGraphInput>
  ): string {
    const inbound = graph.incomingEdges.get(node.id) || [];
    const rdfPayloads: string[] = [];
    for (const e of inbound) {
      if (e.dataFlowType !== 'RDF_GRAPH') continue;
      // A data graph supplied to the start node is upstream RDF like any other:
      // the rules run over it exactly as they would over a CONSTRUCT's output.
      const seededGraph = e.sourceOutputId ? startNodeGraphs?.get(e.sourceOutputId) : undefined;
      if (seededGraph) {
        rdfPayloads.push(seededGraph.content);
        continue;
      }
      // A patch half is addressed by port; everything else by node.
      const srcResult = e.sourceOutputId && portResults.has(e.sourceOutputId)
        ? portResults.get(e.sourceOutputId)
        : results.get(e.sourceNodeId);
      if (typeof srcResult !== 'string') {
        if (srcResult === undefined) {
          throw new Error(`RuleSetNode ${node.id} missing RDF input from ${e.sourceNodeId}`);
        }
        throw new Error(`RuleSetNode ${node.id} expected RDF string from ${e.sourceNodeId} but received ${typeof srcResult}`);
      }
      rdfPayloads.push(srcResult);
    }
    return rdfPayloads.join('\n');
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

  /**
   * Execute a DuckDbEtlNode by running ETL transformation and returning SPARQL bindings or RDF
   */
  private async executeDuckDbEtlNode(
    graph: ExecutionGraph,
    node: ResolvedNode,
    results: Map<string, NodeResult>
  ): Promise<NodeResult> {
    const etlJobVersion = node.etlJobVersion;
    if (!etlJobVersion) {
      throw new Error(`DuckDbEtlNode ${node.id} missing etlJobVersion`);
    }

    const { sql, sparqlTemplate, backendId, currentColumnMappingVersion, chunkSize: defaultChunkSize } = etlJobVersion;

    // Load column mapping version
    if (!currentColumnMappingVersion) {
      throw new Error(`DuckDbEtlNode ${node.id}: EtlJobVersion missing currentColumnMappingVersion`);
    }

    const columnMapping = getCacheCoordinator().get(currentColumnMappingVersion);
    if (!columnMapping || columnMapping['@type'] !== 'EtlColumnMappingVersion') {
      throw new Error(`DuckDbEtlNode ${node.id}: Column mapping version not found: ${currentColumnMappingVersion}`);
    }

    const columnDefs: ColumnDefinition[] = JSON.parse(columnMapping.columns);

    // Get executor for the backend
    const executor = await this.executorFactory.getExecutorForBackendId(backendId);

    // Execute ETL in chunks, over one streamed execution of the source query (#201)
    const chunkSize = defaultChunkSize || 1000;
    const rdfOutputs: string[] = [];
    const allBindings: SparqlBinding[] = [];

    for await (const { rows } of duckDbService.streamChunks(sql, chunkSize)) {
      // Convert rows to SPARQL bindings
      const bindings = this.convertRowsToBindings(rows, columnDefs);

      if (bindings.length > 0) {
        // Build ArgumentSet for VALUES substitution
        const argSet = this.buildArgumentSetFromBindings(bindings, columnDefs);

        // Apply bindings to SPARQL template
        const query = this.parser.applyArguments(sparqlTemplate, [argSet]);

        // Execute SPARQL query
        const { result } = await executor.constructQueryParsed(query);

        if (typeof result === 'string') {
          rdfOutputs.push(result);
        } else {
          // If it's SELECT bindings, accumulate them
          allBindings.push(...bindings);
        }
      }
    }

    // Return RDF output if CONSTRUCT, otherwise return bindings
    if (rdfOutputs.length > 0) {
      return rdfOutputs.join('\n');
    } else if (allBindings.length > 0) {
      const vars = columnDefs.map(c => c.targetVariable);
      return {
        head: { vars },
        results: { bindings: allBindings }
      } as SparqlResultsJson;
    }

    // Empty result
    const vars = columnDefs.map(c => c.targetVariable);
    return {
      head: { vars },
      results: { bindings: [] }
    } as SparqlResultsJson;
  }

  /**
   * Convert DuckDB rows to SPARQL bindings (replicating EtlService logic)
   */
  private convertRowsToBindings(rows: Record<string, any>[], columnDefs: ColumnDefinition[]): SparqlBinding[] {
    const bindings: SparqlBinding[] = [];

    for (const row of rows) {
      const binding: SparqlBinding = {};
      let skipRow = false;

      for (const col of columnDefs) {
        const value = row[col.columnName];

        // Handle null policy
        if (value === null || value === undefined) {
          if (col.nullPolicy === 'skipRow') {
            skipRow = true;
            break;
          }
          // 'undef' - skip this variable (don't add to binding)
          continue;
        }

        // Build SPARQL value
        const sparqlValue: SparqlValue = { value: String(value), type: col.termType as 'uri' | 'literal' };

        if (col.termType === 'uri') {
          if (col.iriTemplate) {
            sparqlValue.value = col.iriTemplate.replace('{value}', String(value));
          }
        } else if (col.termType === 'literal') {
          if (col.datatypeIri) {
            sparqlValue.datatype = col.datatypeIri;
          }
          if (col.lang) {
            sparqlValue['xml:lang'] = col.lang;
          }
        }

        binding[col.targetVariable] = sparqlValue;
      }

      if (!skipRow) {
        bindings.push(binding);
      }
    }

    return bindings;
  }

  /**
   * Convert SPARQL bindings to ArgumentSet format
   */
  private buildArgumentSetFromBindings(bindings: SparqlBinding[], columnDefs: ColumnDefinition[]): ArgumentSet {
    const vars = columnDefs.map(c => c.targetVariable);
    return {
      head: { vars },
      arguments: { bindings }
    };
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
          arguments: { bindings: [{
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
      const arg: ArgumentSet = {
        head: { vars: tgtVars },
        arguments: { bindings: [] },
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
        arg.arguments.bindings.push(b);
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

  private applyArgumentsInOrder(graph: ExecutionGraph, node: ResolvedNode, byInputTuple: Map<string, ArgumentSet>, initialArgs?: ArgumentSet[], options?: ExecutionOptions): string {
    if (!node.queryString) {
      return '';
    }
    const inputs = this.parser.detectInputs(node.queryString);
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

      // group is vars in order; find matching tuple key
      const matchKey = Array.from(byInputTuple.entries()).find(([, set]) =>
        set.head.vars.length === group.length && set.head.vars.every((v, i) => v === group[i])
      )?.[0];
      if (matchKey) {
        const supplied = byInputTuple.get(matchKey)!;
        // An upstream node supplied this input. Its own policy decides what an empty
        // upstream result means: propagate the empty set, or run open ("optional
        // enrichment"), or fail.
        argSets.push(declaredWhenEmpty ? { ...supplied, whenEmpty: declaredWhenEmpty } : supplied);
      } else {
        // Try to find a matching initial argument set by vars ordering
        const ext = matchingInitialArgs.find(s => s.head?.vars?.length === group.length && s.head.vars.every((v, i) => v === group[i]));
        if (ext) {
          // A whenEmpty on the request is more specific than the stored default.
          argSets.push(ext.whenEmpty || !declaredWhenEmpty ? ext : { ...ext, whenEmpty: declaredWhenEmpty });
        } else {
          /*
           * An *order* mismatch means the same variables in a different order.
           * Matching on length alone misdiagnosed a node with two clauses of
           * equal width: a table meant for one of them was reported as the
           * other written backwards, and the run failed instead of leaving the
           * unfilled clause open.
           */
          const wrongOrder = matchingInitialArgs.find(s =>
            this.normalizedSignature(s.head?.vars ?? []) === this.normalizedSignature(group));
          if (wrongOrder) {
            throw new Error(`Argument variable order mismatch for VALUES input [${group.join(', ')}]; received [${wrongOrder.head.vars.join(', ')}].`);
          }
          // Nothing arrived. Absent external parameters run unconstrained unless the
          // author asked otherwise (notably `require`, for a mandatory parameter).
          argSets.push({
            head: { vars: group },
            arguments: { bindings: [] },
            whenEmpty: declaredWhenEmpty ?? 'unconstrained',
          });
        }
      }
    }
    /*
     * Numbers first, then rows, matching `applyExecutionArguments` on the query
     * path — substitution rewrites `LIMIT 000name` in the text, so it has to
     * happen before the AST rewrite that splices the VALUES blocks.
     *
     * Filtered to what this node declares. A group's run carries the union of
     * its members' placeholder names, and handing a node a name it never
     * declared would make `substituteLimitOffset` a no-op at best; keeping the
     * filter here means the route can validate names against the group and the
     * engine still cannot mis-apply one.
     */
    const declaredLimits = new Set(inputs.limitParameters);
    const declaredOffsets = new Set(inputs.offsetParameters);
    const limits = (options?.limits ?? []).filter(parameter => declaredLimits.has(parameter.name));
    const offsets = (options?.offsets ?? []).filter(parameter => declaredOffsets.has(parameter.name));
    const parameterised = (limits.length || offsets.length)
      ? this.parser.applyLimitOffsetParameters(node.queryString, limits, offsets)
      : node.queryString;

    return this.parser.applyArguments(parameterised, argSets);
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
   * Skipped where a `DynamicQueryNode` is present, because the query whose
   * clauses a table might fill is chosen by an upstream node and its text is
   * not knowable here. Guessing would refuse a legitimate run, which is worse
   * than the silence this replaces.
   */
  private refuseUnroutedArguments(graph: ExecutionGraph, initialArgs?: ArgumentSet[]): void {
    if (!initialArgs?.length) return;

    const nodes = Array.from(graph.nodes.values());
    if (nodes.some(node => (node.raw as { '@type'?: string })['@type'] === 'DynamicQueryNode')) return;

    const reachable = new Set<ArgumentSet>();
    for (const node of nodes) {
      if ((node.raw as { '@type'?: string })['@type'] !== 'StartNode') continue;
      for (const { arg } of this.pairArgsToPorts(this.startNodeTuplePorts(graph, node), initialArgs).pairs) {
        reachable.add(arg);
      }
    }

    const clauseSignatures = new Set<string>();
    for (const node of nodes) {
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
      return arg.arguments.bindings;
    }
    return arg.arguments.bindings.map(row => {
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

  // Local tuple resolvers (duplicate minimal logic to avoid tight coupling)
  private resolveInputTupleNames(tupleId: string): string[] {
    const t = getCacheCoordinator().get(tupleId);
    if (!t) return [];
    const members = ((t as { memberEntries?: string[] }).memberEntries || []) as string[];
    const entries: { pos: number; name: string }[] = [];
    for (const mId of members) {
      const m = getCacheCoordinator().get(mId);
      if (!m) continue;
      const memberAny = m as { variable?: string; position?: number };
      const varId = memberAny.variable as string | undefined;
      if (!varId) continue;
      const qi = getCacheCoordinator().get(varId);
      const name = (qi as { variableName?: string } | undefined)?.variableName;
      entries.push({ pos: (memberAny.position as number) ?? 0, name: name || '' });
    }
    entries.sort((a, b) => a.pos - b.pos);
    return entries.map(e => e.name);
  }

  private resolveOutputTupleNames(tupleId: string): string[] {
    const t = getCacheCoordinator().get(tupleId);
    if (!t) return [];
    const members = ((t as { memberEntries?: string[] }).memberEntries || []) as string[];
    const entries: { pos: number; name: string }[] = [];
    for (const mId of members) {
      const m = getCacheCoordinator().get(mId);
      if (!m) continue;
      const memberAny = m as { variable?: string; position?: number };
      const varId = memberAny.variable as string | undefined;
      if (!varId) continue;
      const qo = getCacheCoordinator().get(varId);
      const name = (qo as { variableName?: string } | undefined)?.variableName;
      entries.push({ pos: (memberAny.position as number) ?? 0, name: name || '' });
    }
    entries.sort((a, b) => a.pos - b.pos);
    return entries.map(e => e.name);
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
    for (const r of a.arguments.bindings) { const k = keyOf(r); if (!set.has(k)) { set.add(k); out.push(r);} }
    for (const r of b.arguments.bindings) { const k = keyOf(r); if (!set.has(k)) { set.add(k); out.push(r);} }
    return { head: a.head, arguments: { bindings: out } };
  }

  private async materializeRdfResult(storeId: string, rdf: string, format: string): Promise<void> {
    const store = oxigraphStoreManager.getEphemeralStore(storeId);
    if (!store) {
      console.warn(`Ephemeral store ${storeId} not found for RDF materialization`);
      return;
    }
    if (!rdf || !rdf.trim()) {
      console.warn(`Skipping RDF materialization for store ${storeId}: empty result payload`);
      return;
    }
    await oxigraphStoreManager.loadDataFromString(store, rdf, format);
    console.log(`Materialized RDF output into ephemeral store ${storeId}`);
  }

  private resolveRdfFormatFromAccept(acceptHeader: string | null): string {
    if (!acceptHeader) {
      return 'nquads';
    }
    const lower = acceptHeader.toLowerCase();
    if (lower.includes('n-quads')) return 'nquads';
    if (lower.includes('n-triples')) return 'ntriples';
    if (lower.includes('turtle')) return 'turtle';
    if (lower.includes('rdf+xml')) return 'rdfxml';
    if (lower.includes('json-ld')) return 'jsonld';
    if (lower.includes('trig')) return 'trig';
    return 'nquads';
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

    node.queryVersionId = queryVersionId;
    node.queryVersion = resolved;
    node.queryString = resolved.queryString as string;
    node.queryType = toQueryTypeIri(resolved.queryType as string | undefined | null) ?? null;
  }
}
