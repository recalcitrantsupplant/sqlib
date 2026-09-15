import { getCacheCoordinator } from '../CacheCoordinatorProvider.js';
import { SparqlQueryParser } from '../parser.js';
import { isAnyNode, getNodeType, getNodeBackendId, getNodeQueryId, getEtlJobVersionId, getNodeEphemeralBackendConfig } from '../type-guards.js';
import { QueryTypeIri } from '../../constants/queryTypes.js';
import type { QueryTypeValue } from '../../constants/queryTypes.js';
import { getQueryTypeKeyFromIri, toQueryTypeIri } from '../queryTypes.js';
import { GraphValidationError } from './GraphValidationError.js';
import { WHEN_EMPTY_MODES } from '../../persistence/schemas/QueryEdgeSchema.js';
import type { WhenEmptyMode } from '../../persistence/schemas/QueryEdgeSchema.js';
import type { GraphValidationCode } from './GraphValidationError.js';
import type {
  ExecutionGraph,
  ResolvedNode,
  ResolvedEdge,
  EdgeFlowType,
  QueryGroupVersion,
  QueryNode,
  RuleSetNode,
  QueryEdge,
  QueryInputVariable,
  QueryOutputVariable,
  QueryInputTuple,
  QueryOutputTuple,
  TupleMember,
} from './types.js';

export class GraphBuilder {
  private parser = new SparqlQueryParser();

  buildFromGroupVersionId(groupVersionId: string): ExecutionGraph {
    const cacheCoordinator = getCacheCoordinator();
    const gv = cacheCoordinator.get(groupVersionId) as QueryGroupVersion | null;
    if (!gv || gv['@type'] !== 'QueryGroupVersion') {
      throw new Error(`QueryGroupVersion not found: ${groupVersionId}`);
    }
    return this.buildFromGroupVersion(gv);
  }

  buildFromGroupVersion(gv: QueryGroupVersion): ExecutionGraph {
    const cacheCoordinator = getCacheCoordinator();

    const nodeIds = (gv.executionNodes || []).filter(Boolean) as string[];
    const edgeIds = (gv.edges || []).filter(Boolean) as string[];

    // Resolve nodes - include start/end nodes from explicit references
    const allNodeIdsToProcess = [...nodeIds];
    if (gv.startNode) allNodeIdsToProcess.push(gv.startNode);
    if (gv.endNode) allNodeIdsToProcess.push(gv.endNode);

    const nodes = new Map<string, ResolvedNode>();
    for (const id of allNodeIdsToProcess) {
      const raw = cacheCoordinator.get(id) as QueryNode | RuleSetNode | Record<string, any> | null;
      if (!raw) continue;

      // Accept QueryNode, StartNode, EndNode, DynamicQueryNode types using type guards
      if (!isAnyNode(raw)) continue;

      const nodeType = getNodeType(raw);

      // Start/End nodes don't execute; Query/Dynamic nodes execute SPARQL; RuleSet nodes execute RuleSets
      let backendId: string | undefined;
      let queryVersionId: string | undefined;
      let qv: any;
      let queryString: string | undefined;
      let queryType: QueryTypeValue | undefined | null;
      let ruleSetVersionId: string | undefined;
      let ruleSetVersion: any;
      let etlJobVersionId: string | undefined;
      let etlJobVersion: any;
      let deletionsOutputId: string | undefined;
      let additionsOutputId: string | undefined;

      if (nodeType === 'StartNode' || nodeType === 'EndNode') {
        backendId = undefined;
        queryVersionId = undefined;
        qv = undefined;
        queryString = undefined;
        queryType = undefined;
      } else if (nodeType === 'RuleSetNode') {
        backendId = undefined;
        queryVersionId = undefined;
        qv = undefined;
        queryString = undefined;
        queryType = undefined;
        ruleSetVersionId = (raw as { ruleSetVersion?: string }).ruleSetVersion;
        if (!ruleSetVersionId) {
          throw new Error(`RuleSetNode ${id} missing ruleSetVersion reference`);
        }
        ruleSetVersion = cacheCoordinator.get(ruleSetVersionId);
        if (!ruleSetVersion || ruleSetVersion['@type'] !== 'RuleSetVersion') {
          throw new Error(`RuleSetNode ${id} references missing RuleSetVersion ${ruleSetVersionId}`);
        }
      } else if (nodeType === 'DuckDbEtlNode') {
        backendId = undefined;
        queryVersionId = undefined;
        qv = undefined;
        queryString = undefined;
        queryType = undefined;
        etlJobVersionId = getEtlJobVersionId(raw);
        if (!etlJobVersionId) {
          throw new Error(`DuckDbEtlNode ${id} missing etlJobVersionId reference`);
        }
        etlJobVersion = cacheCoordinator.get(etlJobVersionId);
        if (!etlJobVersion || etlJobVersion['@type'] !== 'EtlJobVersion') {
          throw new Error(`DuckDbEtlNode ${id} references missing EtlJobVersion ${etlJobVersionId}`);
        }
      } else {
        // QueryNode or DynamicQueryNode. A node needs a query and somewhere to
        // run it, but "somewhere" is either a registered backend or an
        // ephemeral store — `ExecutorFactory` branches on the config first and
        // never reads `backendId` when one is present (issue #297), so
        // demanding both rejected exactly the nodes that need neither.
        backendId = getNodeBackendId(raw);
        queryVersionId = getNodeQueryId(raw);
        if (!queryVersionId) {
          throw new Error(`${nodeType} ${id} missing queryId`);
        }
        if (!backendId && !getNodeEphemeralBackendConfig(raw)) {
          throw new Error(
            `${nodeType} ${id} has no backend: it names neither a backendId nor an ephemeral backendConfig`,
          );
        }

        qv = cacheCoordinator.get(queryVersionId);
        if (!qv || qv['@type'] !== 'QueryVersion') {
          throw new Error(`${nodeType} ${id} references missing QueryVersion ${queryVersionId}`);
        }
        queryString = qv.queryString as string;
        queryType = toQueryTypeIri(qv.queryType as string | undefined | null) ?? null;
      }

      if (nodeType === 'PatchNode') {
        /*
         * A patch has two halves and they are not interchangeable, so which
         * port carries which is read from the node rather than from the order
         * of `outputs`. Both are required here rather than defaulted, because
         * every sensible default (first output, only output, by name) is a
         * guess that silently sends deletions where additions were meant.
         */
        deletionsOutputId = (raw as { deletionsOutput?: string }).deletionsOutput;
        additionsOutputId = (raw as { additionsOutput?: string }).additionsOutput;
        if (!deletionsOutputId || !additionsOutputId) {
          throw new GraphValidationError('NODE_PATCH_OUTPUT_PORTS_MISSING',
            `PatchNode ${id} must declare both deletionsOutput and additionsOutput`, 'node', id);
        }
        if (deletionsOutputId === additionsOutputId) {
          throw new GraphValidationError('NODE_PATCH_OUTPUT_PORTS_MISSING',
            `PatchNode ${id} uses the same port for deletions and additions`, 'node', id);
        }
        if (toQueryTypeIri(queryType) !== QueryTypeIri.update) {
          const readable = getQueryTypeKeyFromIri(toQueryTypeIri(queryType) ?? '') || 'unknown';
          throw new GraphValidationError('NODE_PATCH_QUERY_NOT_UPDATE',
            `PatchNode ${id} derives the effect of an update, but its query is ${readable}`,
            'node', id);
        }
      }

      const resolvedBackendConfig = getNodeEphemeralBackendConfig(raw);

      nodes.set(id, {
        id,
        raw,
        backendId,
        queryVersionId,
        queryVersion: qv,
        queryString,
        queryType,
        ruleSetVersionId,
        ruleSetVersion,
        etlJobVersionId,
        etlJobVersion,
        deletionsOutputId,
        additionsOutputId,
        inputTupleIds: ((raw as { inputs?: string[] }).inputs || []).filter(Boolean),
        outputTupleIds: ((raw as { outputs?: string[] }).outputs || []).filter(Boolean),
        backendConfig: resolvedBackendConfig,
      });
    }

    const hasExecutableNode = Array.from(nodes.values()).some(node => {
      const rawType = (node.raw)['@type'];
      return rawType !== 'StartNode' && rawType !== 'EndNode';
    });

    if (!hasExecutableNode) {
      throw new GraphValidationError('GRAPH_NO_EXECUTABLE_NODE',
        `QueryGroupVersion ${gv.$id} has no executable QueryNode nodes`, 'graph');
    }

    // Resolve edges
    const edges: ResolvedEdge[] = [];
    for (const id of edgeIds) {
      const raw = cacheCoordinator.get(id) as QueryEdge | null;
      if (!raw || raw['@type'] !== 'QueryEdge') continue;
      const sourceNodeId = raw.sourceNodeId as string;
      const targetNodeId = raw.targetNodeId as string;
      if (!nodes.has(sourceNodeId) || !nodes.has(targetNodeId)) continue;
      edges.push({
        id,
        raw,
        sourceNodeId,
        targetNodeId,
        dataFlowType: raw.dataFlowType as EdgeFlowType | null | undefined,
        sourceOutputId: raw.sourceOutputId,
        targetInputId: raw.targetInputId,
        variableMappings: raw.variableMappings,
        whenEmpty: WHEN_EMPTY_MODES.includes(raw.whenEmpty as WhenEmptyMode)
          ? (raw.whenEmpty as WhenEmptyMode)
          : undefined,
      });
    }

    const incomingEdges = new Map<string, ResolvedEdge[]>();
    const outgoingEdges = new Map<string, ResolvedEdge[]>();
    for (const e of edges) {
      if (!outgoingEdges.has(e.sourceNodeId)) outgoingEdges.set(e.sourceNodeId, []);
      outgoingEdges.get(e.sourceNodeId)!.push(e);
      if (!incomingEdges.has(e.targetNodeId)) incomingEdges.set(e.targetNodeId, []);
      incomingEdges.get(e.targetNodeId)!.push(e);
    }

    const allNodeIds = Array.from(nodes.keys());
    // StartNode and EndNode are identified by their @type, not by graph structure
    const startNodeIds = allNodeIds.filter(id => {
      const node = nodes.get(id)!;
      return (node.raw)['@type'] === 'StartNode';
    });
    const endNodeIds = allNodeIds.filter(id => {
      const node = nodes.get(id)!;
      return (node.raw)['@type'] === 'EndNode';
    });

    const graph: ExecutionGraph = {
      groupVersion: gv,
      nodes,
      edges,
      incomingEdges,
      outgoingEdges,
      startNodeIds,
      endNodeIds,
    };

    this.markEphemeralMaterializationNodes(graph);
    this.validateGraph(graph);
    return graph;
  }

  private markEphemeralMaterializationNodes(graph: ExecutionGraph): void {
    for (const node of graph.nodes.values()) {
      // A PatchNode's store is what it reads, never where its result goes, so
      // it has nothing to materialize however its outputs are consumed.
      if (node.backendConfig?.type !== 'ephemeral-oxigraph'
        || (node.raw)['@type'] === 'PatchNode') {
        node.needsEphemeralMaterialization = false;
        continue;
      }
      const outgoing = graph.outgoingEdges.get(node.id) || [];
      const hasRdfConsumer = outgoing.some(edge => this.edgeRequiresEphemeralMaterialization(edge, graph));
      node.needsEphemeralMaterialization = hasRdfConsumer;
    }
  }

  private edgeRequiresEphemeralMaterialization(edge: ResolvedEdge, graph: ExecutionGraph): boolean {
    if (edge.dataFlowType !== 'RDF_GRAPH') {
      return false;
    }
    const targetNode = graph.nodes.get(edge.targetNodeId);
    if (!targetNode) return false;
    const targetType = (targetNode.raw)['@type'];
    // EndNode outputs go back to clients; no need to materialize for them
    if (targetType === 'EndNode') {
      return false;
    }
    return true;
  }

  private validateGraph(graph: ExecutionGraph): void {
    const cacheCoordinator = getCacheCoordinator();
    // Enforce DAG
    const indegree = new Map<string, number>();
    for (const id of Array.from(graph.nodes.keys())) indegree.set(id, 0);
    for (const e of graph.edges) indegree.set(e.targetNodeId, (indegree.get(e.targetNodeId) || 0) + 1);
    const q: string[] = Array.from(graph.nodes.keys()).filter(id => (indegree.get(id) || 0) === 0);
    let visited = 0;
    const localIndegree = new Map(indegree);
    while (q.length) {
      const n = q.shift()!;
      visited++;
      for (const e of graph.outgoingEdges.get(n) || []) {
        const d = (localIndegree.get(e.targetNodeId) || 0) - 1;
        localIndegree.set(e.targetNodeId, d);
        if (d === 0) q.push(e.targetNodeId);
      }
    }
    if (visited !== graph.nodes.size) {
      throw new GraphValidationError('GRAPH_CYCLE', 'Graph validation failed: cycle detected', 'graph');
    }

    // Validate edges and tuple constraints
    const validDataFlowTypes = ['CONTROL_FLOW', 'VARIABLE_BINDINGS', 'RDF_GRAPH', 'BOOLEAN', 'QUERY_ID'];
    for (const e of graph.edges) {
      const edgeError = (code: GraphValidationCode, message: string) =>
        new GraphValidationError(code, message, 'edge', e.id);

      const flowType = (e.dataFlowType ?? 'CONTROL_FLOW') as string;
      if (!validDataFlowTypes.includes(flowType)) {
        throw edgeError('EDGE_FLOW_TYPE_UNSUPPORTED', `Unsupported dataFlowType on edge ${e.id}: ${e.dataFlowType}`);
      }

      const sourceNode = graph.nodes.get(e.sourceNodeId);
      const targetNode = graph.nodes.get(e.targetNodeId);
      if (!sourceNode || !targetNode) {
        throw edgeError('EDGE_NODE_MISSING', `Edge ${e.id} references invalid nodes`);
      }

      const declaredSourceOutputs = Array.isArray((sourceNode.raw as { outputs?: unknown }).outputs)
        ? ((sourceNode.raw as { outputs?: unknown }).outputs as string[]).filter(Boolean)
        : [];
      const declaredTargetInputs = Array.isArray((targetNode.raw as { inputs?: unknown }).inputs)
        ? ((targetNode.raw as { inputs?: unknown }).inputs as string[]).filter(Boolean)
        : [];

      if (e.sourceOutputId && declaredSourceOutputs.length > 0 && !declaredSourceOutputs.includes(e.sourceOutputId)) {
        throw edgeError('EDGE_SOURCE_OUTPUT_UNDECLARED',
          `Edge ${e.id} sourceOutputId ${e.sourceOutputId} is not declared in source node ${e.sourceNodeId} outputs`
        );
      }

      if (e.targetInputId && declaredTargetInputs.length > 0 && !declaredTargetInputs.includes(e.targetInputId)) {
        throw edgeError('EDGE_TARGET_INPUT_UNDECLARED',
          `Edge ${e.id} targetInputId ${e.targetInputId} is not declared in target node ${e.targetNodeId} inputs`
        );
      }

      if (flowType === 'CONTROL_FLOW') {
        // CONTROL_FLOW edges represent execution dependencies only (no data transfer)
        // They MUST NOT have sourceOutputId or targetInputId
        if (e.sourceOutputId || e.targetInputId) {
          throw edgeError('EDGE_CONTROL_FLOW_HAS_IO',
            `Edge ${e.id} has dataFlowType=CONTROL_FLOW but specifies I/O references ` +
            `(sourceOutputId: ${e.sourceOutputId ?? 'none'}, targetInputId: ${e.targetInputId ?? 'none'}). ` +
            `Control flow edges represent execution dependencies only and should not reference I/O entities.`
          );
        }
        continue;  // Valid control flow edge - just defines execution order
      }

      if (!e.sourceOutputId || !e.targetInputId) {
        throw edgeError('EDGE_DATA_FLOW_MISSING_IO',
          `Edge ${e.id} with dataFlowType=${flowType} must specify both sourceOutputId and targetInputId`
        );
      }

      // For edges to EndNode, targetInputId should equal sourceOutputId (explicit connection)
      if (targetNode.raw['@type'] === 'EndNode' && e.sourceOutputId !== e.targetInputId) {
        throw edgeError('EDGE_END_NODE_PASSTHROUGH_MISMATCH',
          `Edge ${e.id} to EndNode must have targetInputId equal to sourceOutputId ` +
          `(got sourceOutputId: ${e.sourceOutputId}, targetInputId: ${e.targetInputId}). ` +
          `This makes the connection explicit: "this output goes into EndNode".`
        );
      }

      const sourceEntity = cacheCoordinator.get(e.sourceOutputId);
      const targetEntity = cacheCoordinator.get(e.targetInputId);

      if (!sourceEntity) {
        throw edgeError('EDGE_SOURCE_IO_MISSING', `Edge ${e.id} references missing source I/O entity ${e.sourceOutputId}`);
      }
      if (!targetEntity) {
        throw edgeError('EDGE_TARGET_IO_MISSING', `Edge ${e.id} references missing target I/O entity ${e.targetInputId}`);
      }

      const sourceType = sourceEntity['@type'];
      const targetType = targetEntity['@type'];

      const isStartNodeSource = (sourceNode.raw)['@type'] === 'StartNode';

      if (flowType === 'VARIABLE_BINDINGS') {
        // Allow QueryOutputTuple or BooleanIO as source (booleans can be passed to VALUES clauses)
        // Special case: StartNode can output QueryInputTuple (external inputs to the group)
        if (isStartNodeSource) {
          if (sourceType !== 'QueryOutputTuple' && sourceType !== 'BooleanIO' && sourceType !== 'QueryInputTuple') {
            throw edgeError('EDGE_SOURCE_PORT_TYPE', `Edge ${e.id} from StartNode expects QueryOutputTuple, BooleanIO, or QueryInputTuple source but found ${sourceType}`);
          }
        } else {
          if (sourceType !== 'QueryOutputTuple' && sourceType !== 'BooleanIO') {
            throw edgeError('EDGE_SOURCE_PORT_TYPE', `Edge ${e.id} expects QueryOutputTuple or BooleanIO source but found ${sourceType}`);
          }
        }
        // For EndNode targets, allow QueryOutputTuple (pass-through semantics: sourceOutputId === targetInputId)
        const isEndNodeTarget = (targetNode.raw)['@type'] === 'EndNode';
        if (isEndNodeTarget) {
          // EndNode uses pass-through: the same QueryOutputTuple ID serves as both source output and target input
          if (targetType !== 'QueryOutputTuple') {
            throw edgeError('EDGE_TARGET_PORT_TYPE', `Edge ${e.id} to EndNode expects QueryOutputTuple target (pass-through) but found ${targetType}`);
          }
        } else {
          // Regular QueryNode target requires QueryInputTuple
          if (targetType !== 'QueryInputTuple') {
            throw edgeError('EDGE_TARGET_PORT_TYPE', `Edge ${e.id} expects QueryInputTuple target but found ${targetType}`);
          }
        }
      } else if (flowType === 'RDF_GRAPH') {
        if (sourceType !== 'TriplesQuadsIO') {
          throw edgeError('EDGE_SOURCE_PORT_TYPE', `Edge ${e.id} expects TriplesQuadsIO source but found ${sourceType}`);
        }
        if (targetType !== 'TriplesQuadsIO') {
          throw edgeError('EDGE_TARGET_PORT_TYPE', `Edge ${e.id} expects TriplesQuadsIO target but found ${targetType}`);
        }
        // A PatchNode's outputs are the two halves of one patch, and they are
        // only distinguishable by which port they left through. An RDF edge
        // that names no source port would have to be answered with a guess.
        if ((sourceNode.raw)['@type'] === 'PatchNode') {
          const ports = [sourceNode.deletionsOutputId, sourceNode.additionsOutputId];
          if (!e.sourceOutputId || !ports.includes(e.sourceOutputId)) {
            throw edgeError('EDGE_PATCH_SOURCE_PORT_UNNAMED',
              `Edge ${e.id} leaves PatchNode ${e.sourceNodeId} without naming which half of the patch it carries. ` +
              `Set sourceOutputId to the node's deletionsOutput (${sourceNode.deletionsOutputId}) ` +
              `or additionsOutput (${sourceNode.additionsOutputId}).`);
          }
        }

        // A RuleSetNode is handed its upstream RDF directly, and an EndNode
        // returns it. A SPARQL node has no such hand-off: the only way RDF
        // reaches one is if the producer materializes into an ephemeral store
        // the consumer also queries. Without that config the edge transfers
        // nothing and the target silently queries its own backend instead -
        // exactly the silent degradation the total-rewrite work removed
        // elsewhere, so reject it rather than let it look wired up.
        const targetRawType = (targetNode.raw)['@type'];
        /*
         * A patch half is a derived value, not the contents of a store. The
         * only route RDF takes into a SPARQL node is an ephemeral store the
         * producer materialized into, and a PatchNode never materializes: it
         * reads its store to work out what an update would change, and writes
         * nothing back. Its `backendConfig` would satisfy the check below and
         * the target would silently query a store with no patch in it.
         */
        if ((sourceNode.raw)['@type'] === 'PatchNode'
          && (targetRawType === 'QueryNode' || targetRawType === 'DynamicQueryNode' || targetRawType === 'PatchNode')) {
          throw edgeError('EDGE_RDF_GRAPH_TARGET_CANNOT_CONSUME',
            `Edge ${e.id} sends half a patch to ${targetRawType} ${e.targetNodeId}, which has no way to read it. ` +
            `A PatchNode derives without writing, so there is no store for a SPARQL node to query. ` +
            `Send it to a RuleSetNode or the EndNode instead.`);
        }
        // A PatchNode reads its store over SPARQL exactly as a query node does,
        // so upstream RDF reaches it under the same condition and no other.
        if (targetRawType === 'QueryNode' || targetRawType === 'DynamicQueryNode' || targetRawType === 'PatchNode') {
          if (isStartNodeSource) {
            // A start node supplies RDF the caller hands in, so there is no
            // producing store to share. The graph is loaded into the target's
            // own ephemeral store instead - which means the target has to have
            // one, for the same reason spelled out below.
            if (!getNodeEphemeralBackendConfig(targetNode.raw)) {
              throw edgeError('EDGE_RDF_GRAPH_TARGET_CANNOT_CONSUME',
                `Edge ${e.id} sends a start node data graph to ${targetRawType} ${e.targetNodeId}, which has no way to read it. ` +
                `A SPARQL node reads supplied RDF only when it runs against an ephemeral store the graph can be loaded into; ` +
                `otherwise the graph is discarded and the node queries its own backend. Give the node an ephemeral backend, ` +
                `or send the data graph to a RuleSetNode or the EndNode instead.`
              );
            }
            continue;
          }
          if (!getNodeEphemeralBackendConfig(sourceNode.raw)) {
            throw edgeError('EDGE_RDF_GRAPH_TARGET_CANNOT_CONSUME',
              `Edge ${e.id} sends RDF to ${targetRawType} ${e.targetNodeId}, which has no way to read it. ` +
              `A SPARQL node only sees upstream RDF when the source node materializes into an ephemeral ` +
              `store; otherwise the graph is discarded. Send the RDF to a RuleSetNode or the EndNode instead.`
            );
          }
        }
      } else if (flowType === 'BOOLEAN') {
        if (sourceType !== 'BooleanIO' || targetType !== 'BooleanIO') {
          throw edgeError('EDGE_SOURCE_PORT_TYPE',
            `Edge ${e.id} with dataFlowType=BOOLEAN must connect BooleanIO entities (source=${sourceType}, target=${targetType})`
          );
        }
      } else if (flowType === 'QUERY_ID') {
        const targetRawType = (targetNode.raw)['@type'];
        if (targetRawType !== 'DynamicQueryNode') {
          throw edgeError('EDGE_QUERY_ID_TARGET_NODE_TYPE', `Edge ${e.id} with dataFlowType=QUERY_ID must target a DynamicQueryNode (found ${targetRawType ?? 'unknown'})`);
        }
        if (sourceType !== 'QueryOutputTuple') {
          throw edgeError('EDGE_SOURCE_PORT_TYPE', `Edge ${e.id} expects QueryOutputTuple source but found ${sourceType}`);
        }
        if (targetType !== 'QueryIdInput') {
          throw edgeError('EDGE_TARGET_PORT_TYPE', `Edge ${e.id} expects QueryIdInput target but found ${targetType}`);
        }
        const outputMembers = Array.isArray((sourceEntity)?.memberEntries)
          ? sourceEntity.memberEntries
          : [];
        if (outputMembers.length !== 1) {
          throw edgeError('EDGE_QUERY_ID_ARITY', `Edge ${e.id} expects a single-variable QueryOutputTuple for QUERY_ID flow (found ${outputMembers.length})`);
        }
      }

      if (flowType === 'VARIABLE_BINDINGS') {
        let srcNames: string[] = [];
        let tgtNames: string[] = [];

        // BooleanIO passes a single boolean value to a single variable
        if (sourceType === 'BooleanIO') {
          tgtNames = this.resolveInputTupleNames(e.targetInputId!);
          if (tgtNames.length !== 1) {
            throw edgeError('EDGE_BOOLEAN_TARGET_ARITY', `Edge ${e.id} with BooleanIO source must connect to QueryInputTuple with exactly 1 variable, found ${tgtNames.length}`);
          }
        } else {
          // StartNode can output QueryInputTuple (external inputs), so handle both types
          if (sourceType === 'QueryInputTuple') {
            srcNames = this.resolveInputTupleNames(e.sourceOutputId!);
          } else {
            srcNames = this.resolveOutputTupleNames(e.sourceOutputId!);
          }
          tgtNames = this.resolveInputTupleNames(e.targetInputId!);
          if (srcNames.length !== tgtNames.length) {
            throw edgeError('EDGE_TUPLE_ARITY_MISMATCH', `Tuple dimensions mismatch on edge ${e.id}: ${srcNames.length} != ${tgtNames.length}`);
          }
          if (srcNames.some(n => !n) || tgtNames.some(n => !n)) {
            throw edgeError('EDGE_TUPLE_NAME_EMPTY', `Empty variable/input name in tuples for edge ${e.id}`);
          }
        }

        // Validate source SELECT exports variables (skip for StartNode/EndNode and BooleanIO)
        const sourceNode = graph.nodes.get(e.sourceNodeId)!;
        if (sourceNode.queryString && sourceType !== 'BooleanIO') {
          const outputs = this.parser.detectQueryOutputs(sourceNode.queryString);
          const missing = srcNames.filter(n => !outputs.includes(n));
          if (missing.length) {
            throw new GraphValidationError('NODE_OUTPUT_VARIABLE_MISSING',
              `Source node ${sourceNode.id} does not export variables required by its OutputTuple ${e.sourceOutputId}: ${missing.join(', ')}`,
              'node', sourceNode.id);
          }
        }

        // Validate target VALUES group alignment (skip for StartNode/EndNode)
        const targetNode = graph.nodes.get(e.targetNodeId)!;
        if (targetNode.queryString) {
          const detected = this.parser.detectInputs(targetNode.queryString).valuesInputs;
          const hasMatch = detected.some((group: string[]) => group.length === tgtNames.length && group.every((v: string, i: number) => v === tgtNames[i]));
          if (!hasMatch) {
            throw new GraphValidationError('NODE_VALUES_GROUP_MISSING',
              `Target node ${targetNode.id} query does not contain a VALUES group matching InputTuple ${e.targetInputId} variables in order: [${tgtNames.join(', ')}]`,
              'node', targetNode.id);
          }
        }
      }
    }

    // Terminal rules: CONSTRUCT/DESCRIBE/UPDATE cannot have outgoing VARIABLE_BINDINGS
    // (ASK can output boolean via BooleanIO which feeds into VARIABLE_BINDINGS)
    for (const [id, node] of Array.from(graph.nodes)) {
      const rawType = (node.raw)['@type'];
      if (rawType === 'RuleSetNode') {
        const inbound = graph.incomingEdges.get(id) || [];
        const outbound = graph.outgoingEdges.get(id) || [];
        const badInbound = inbound.find(e => e.dataFlowType && e.dataFlowType !== 'RDF_GRAPH' && e.dataFlowType !== 'CONTROL_FLOW');
        if (badInbound) {
          throw new GraphValidationError('NODE_RULESET_INBOUND_FLOW_TYPE',
            `RuleSetNode ${id} only accepts RDF_GRAPH or CONTROL_FLOW edges. Invalid inbound edge ${badInbound.id} (${badInbound.dataFlowType})`,
            'node', id);
        }
        const badOutbound = outbound.find(e => e.dataFlowType && e.dataFlowType !== 'RDF_GRAPH' && e.dataFlowType !== 'CONTROL_FLOW');
        if (badOutbound) {
          throw new GraphValidationError('NODE_RULESET_OUTBOUND_FLOW_TYPE',
            `RuleSetNode ${id} only produces RDF_GRAPH or CONTROL_FLOW edges. Invalid outbound edge ${badOutbound.id} (${badOutbound.dataFlowType})`,
            'node', id);
        }
      }

      if (rawType === 'PatchNode') {
        const outbound = graph.outgoingEdges.get(id) || [];
        const badOutbound = outbound.find(e => e.dataFlowType && e.dataFlowType !== 'RDF_GRAPH' && e.dataFlowType !== 'CONTROL_FLOW');
        if (badOutbound) {
          throw new GraphValidationError('NODE_PATCH_OUTBOUND_FLOW_TYPE',
            `PatchNode ${id} only produces RDF_GRAPH or CONTROL_FLOW edges. Invalid outbound edge ${badOutbound.id} (${badOutbound.dataFlowType})`,
            'node', id);
        }
        // Declared ports have to be the node's own, or an edge can name a port
        // the node never offered and validation would still pass.
        for (const port of [node.deletionsOutputId, node.additionsOutputId]) {
          if (port && !node.outputTupleIds.includes(port)) {
            throw new GraphValidationError('NODE_PATCH_OUTPUT_PORTS_MISSING',
              `PatchNode ${id} names port ${port} but does not list it in outputs`, 'node', id);
          }
        }
        continue;
      }

      const type = toQueryTypeIri(node.queryType);
      if (type && (type === QueryTypeIri.construct || type === QueryTypeIri.describe || type === QueryTypeIri.update)) {
        const out = graph.outgoingEdges.get(id) || [];
        const bad = out.find(e => e.dataFlowType === 'VARIABLE_BINDINGS');
        if (bad) {
          const readableType = getQueryTypeKeyFromIri(type) || type;
          throw new GraphValidationError('NODE_TERMINAL_BINDINGS_OUTPUT',
            `Node ${id} of type ${readableType} cannot have VARIABLE_BINDINGS outgoing edges (edge ${bad.id})`,
            'node', id);
        }
      }
    }

    this.validateEndNodeFanIn(graph);
    this.validatePatchHalvesNotMerged(graph);
  }

  /**
   * Refuse to hand one consumer both halves of the same patch.
   *
   * Everywhere the engine takes more than one RDF input it unions them —
   * `join('\n')` in `buildRdfSeedForRuleSetNode` for a rule set, and the same in
   * the EndNode fan-in merge. A union is sound for two CONSTRUCTs, which both
   * assert that their quads are present. It is not sound for a patch, whose two
   * ports assert opposite things: the union of "these go" and "these come" is
   * the set of quads the update touches with the sign erased, which is the one
   * fact a caller asking "what would this update change?" needs.
   *
   * The sign is only recoverable from the port an edge left through, so once the
   * two halves are in one string nothing downstream — and no caller reading the
   * result — can separate them again. `PatchNodeSchema` puts it as "a patch is
   * not a graph, and flattening it into one would lose the sign"; this is the
   * check that was missing behind that sentence. `staticResultKind` reasons
   * about a single port ("whichever port an EndNode is fed from") and is right
   * about it; nothing was reasoning about both at once.
   *
   * Deliberately narrow. A half merged with an *unrelated* graph is the same
   * category error and is not rejected here: what a rule set should be handed
   * alongside a half is a modelling question with more than one defensible
   * answer, whereas both halves of one patch has none — they cancel. The whole
   * patch, sign intact, is already available two ways: the node's own result is
   * the RDF Patch document, and `text/rdf-patch` on the update query itself.
   */
  private validatePatchHalvesNotMerged(graph: ExecutionGraph): void {
    for (const [targetId, inbound] of Array.from(graph.incomingEdges.entries())) {
      // Ports already seen arriving at this consumer, per patch source.
      const portsBySource = new Map<string, Set<string>>();

      for (const e of inbound) {
        if (e.dataFlowType !== 'RDF_GRAPH' || !e.sourceOutputId) continue;
        const sourceNode = graph.nodes.get(e.sourceNodeId);
        if (!sourceNode || (sourceNode.raw)['@type'] !== 'PatchNode') continue;

        let seen = portsBySource.get(e.sourceNodeId);
        if (!seen) {
          seen = new Set<string>();
          portsBySource.set(e.sourceNodeId, seen);
        }
        seen.add(e.sourceOutputId);

        const { deletionsOutputId, additionsOutputId } = sourceNode;
        if (deletionsOutputId && additionsOutputId
          && seen.has(deletionsOutputId) && seen.has(additionsOutputId)) {
          throw new GraphValidationError('EDGE_PATCH_HALVES_MERGED',
            `Edge ${e.id} gives ${targetId} the second half of PatchNode ${e.sourceNodeId}'s patch, ` +
            `and both halves arriving at one consumer are merged into a single graph — ` +
            `the deletions and the additions become indistinguishable. ` +
            `Send each half to its own consumer, or take the whole patch from the node's result ` +
            `(RDF Patch, sign intact) instead.`,
            'edge', e.id);
        }
      }
    }
  }

  /**
   * The engine can only merge multiple EndNode inputs when every one of them is an
   * RDF string (it concatenates them); anything else hits an explicit "not yet
   * implemented" throw at execution time. Reject that here so validation stays a
   * sound predictor of executability rather than deferring to a runtime surprise.
   *
   * Only statically-known result types are judged. A DynamicQueryNode resolves its
   * query at runtime and a DuckDbEtlNode's shape depends on its job, so neither can
   * be proven wrong here and both are left to the engine.
   */
  private validateEndNodeFanIn(graph: ExecutionGraph): void {
    for (const endNodeId of graph.endNodeIds ?? []) {
      const dataInputs = (graph.incomingEdges.get(endNodeId) || [])
        .filter(e => (e.dataFlowType ?? 'CONTROL_FLOW') !== 'CONTROL_FLOW');

      // An EndNode reached only by control flow has nothing to return, and the
      // engine says so at execution time. Saying it here instead keeps
      // validation a sound predictor of executability, and lets the canvas
      // point at the EndNode rather than surfacing a failed run.
      if (dataInputs.length === 0) {
        throw new GraphValidationError('END_NODE_NO_DATA_INPUT',
          `EndNode ${endNodeId} has no data inputs, so the group cannot produce a result. ` +
          `Connect a node output to it with a data flow edge (control flow edges carry no result).`,
          'node', endNodeId);
      }
      if (dataInputs.length === 1) continue;

      for (const edge of dataInputs) {
        const sourceNode = graph.nodes.get(edge.sourceNodeId);
        if (!sourceNode) continue;
        const kind = this.staticResultKind(sourceNode);
        if (kind === 'rdf' || kind === 'unknown') continue;
        throw new GraphValidationError('END_NODE_MIXED_RESULT_TYPES',
          `EndNode ${endNodeId} has ${dataInputs.length} data inputs, so every input must produce RDF for merging. ` +
          `Node ${sourceNode.id} produces ${kind}. Merging bindings/booleans is not supported.`,
          'node', sourceNode.id);
      }
    }
  }

  /** Result shape a node produces, where that is knowable without executing it. */
  private staticResultKind(node: ResolvedNode): 'rdf' | 'bindings' | 'boolean' | 'update' | 'unknown' {
    const rawType = (node.raw)['@type'];
    if (rawType === 'RuleSetNode') return 'rdf';
    // Both halves of a patch are RDF, so whichever *single* port an EndNode is
    // fed from, the thing arriving there merges like any other graph. Both at
    // once does not, and this function cannot see that: it is asked about one
    // node at a time and answers about its result kind, not about how many of
    // its ports arrive together. `validatePatchHalvesNotMerged` is the check
    // for that, and the reason this one may stay a plain `rdf`.
    // Checked before `queryType`, which says `update` and would otherwise make
    // a node that writes nothing look like a node that writes.
    if (rawType === 'PatchNode') return 'rdf';
    // A DynamicQueryNode's query - and a DuckDbEtlNode's output shape - are chosen
    // at runtime, so neither can be judged statically.
    if (rawType === 'DynamicQueryNode' || rawType === 'DuckDbEtlNode') return 'unknown';

    const type = toQueryTypeIri(node.queryType);
    if (!type) return 'unknown';
    if (type === QueryTypeIri.construct || type === QueryTypeIri.describe) return 'rdf';
    if (type === QueryTypeIri.ask) return 'boolean';
    if (type === QueryTypeIri.update) return 'update';
    if (type === QueryTypeIri.select) return 'bindings';
    return 'unknown';
  }

  private resolveInputTupleNames(tupleId: string): string[] {
    const t = getCacheCoordinator().get(tupleId) as QueryInputTuple | null;
    if (!t) throw new GraphValidationError('TUPLE_MISSING', `Missing QueryInputTuple ${tupleId}`, 'tuple', tupleId);
    const members = (t.memberEntries || []) as string[];
    const entries: { pos: number; name: string }[] = [];
    for (const mId of members) {
      const m = getCacheCoordinator().get(mId) as TupleMember | null;
      if (!m) continue;
      const memberAny = m;
      const varId = memberAny.variable as string | undefined;
      if (!varId) continue;
      const qi = getCacheCoordinator().get(varId) as QueryInputVariable | null;
      const name = (qi)?.variableName as string | undefined;
      if (typeof memberAny.position !== 'number') throw new Error(`TupleMember ${mId} missing position`);
      entries.push({ pos: memberAny.position as number, name: name || '' });
    }
    entries.sort((a, b) => a.pos - b.pos);
    return entries.map(e => e.name);
  }

  private resolveOutputTupleNames(tupleId: string): string[] {
    const t = getCacheCoordinator().get(tupleId) as QueryOutputTuple | null;
    if (!t) throw new GraphValidationError('TUPLE_MISSING', `Missing QueryOutputTuple ${tupleId}`, 'tuple', tupleId);
    const members = (t.memberEntries || []) as string[];
    const entries: { pos: number; name: string }[] = [];
    for (const mId of members) {
      const m = getCacheCoordinator().get(mId) as TupleMember | null;
      if (!m) continue;
      const memberAny = m;
      const varId = memberAny.variable as string | undefined;
      if (!varId) continue;
      const qo = getCacheCoordinator().get(varId) as QueryOutputVariable | null;
      const name = (qo)?.variableName as string | undefined;
      if (typeof memberAny.position !== 'number') throw new Error(`TupleMember ${mId} missing position`);
      entries.push({ pos: memberAny.position as number, name: name || '' });
    }
    entries.sort((a, b) => a.pos - b.pos);
    return entries.map(e => e.name);
  }
}
