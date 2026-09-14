import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import type { LdkitQueryGroupVersion } from '../persistence/schemas/QueryGroupVersionSchema.js';
import type { LdkitQueryNode } from '../persistence/schemas/QueryNodeSchema.js';
import type { LdkitQueryEdge } from '../persistence/schemas/QueryEdgeSchema.js';
import type { LdkitDynamicQueryNode } from '../persistence/schemas/DynamicQueryNodeSchema.js';
import type { LdkitRuleSetNode } from '../persistence/schemas/RuleSetNodeSchema.js';
import type { LdkitPatchNode } from '../persistence/schemas/PatchNodeSchema.js';
import type { LdkitStartNode } from '../persistence/schemas/StartNodeSchema.js';
import type { LdkitEndNode } from '../persistence/schemas/EndNodeSchema.js';
import type { LdkitTriplesQuadsIO } from '../persistence/schemas/TriplesQuadsIOSchema.js';
import type { LdkitBooleanIO } from '../persistence/schemas/BooleanIOSchema.js';
import type { LdkitQueryIdInput } from '../persistence/schemas/QueryIdInputSchema.js';
import type { LdkitQueryInputVariable } from '../persistence/schemas/QueryInputVariableSchema.js';
import type { LdkitQueryInputTuple } from '../persistence/schemas/QueryInputTupleSchema.js';
import type { LdkitQueryOutputVariable } from '../persistence/schemas/QueryOutputVariableSchema.js';
import type { LdkitQueryOutputTuple } from '../persistence/schemas/QueryOutputTupleSchema.js';
import type { LdkitTupleMember } from '../persistence/schemas/TupleMemberSchema.js';
import type { LdkitQueryVersion } from '../persistence/schemas/QueryVersionSchema.js';
import type { LdkitQueryGroup } from '../persistence/schemas/QueryGroupSchema.js';
import { toRestApi } from '../persistence/utils/id-adapter.js';
import { QueryGroupSignatureService } from './QueryGroupSignatureService.js';
import {
  type AnyRestNodeType,
  isQueryEdge,
  isQueryGroup,
  isQueryNode,
  isStartNode,
  isEndNode,
  isDynamicQueryNode,
  isRuleSetNode,
  isPatchNode,
} from './type-guards.js';

function uniqueIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(id);
  }
  return unique;
}

function normalizeRefArray(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') return [value];
  return [];
}

/**
 * The five entity types a node port or edge endpoint can name.
 *
 * A port reference is an opaque IRI. Which of these it denotes is a property of
 * the stored entity, not of the string - so the closure below resolves refs by
 * asking the repositories, and treats the minting prefix only as a hint for
 * which repository to ask first.
 */
type PortKind = 'QueryInputTuple' | 'QueryOutputTuple' | 'TriplesQuadsIO' | 'BooleanIO' | 'QueryIdInput';

const PORT_KINDS: readonly PortKind[] = [
  'QueryInputTuple',
  'QueryOutputTuple',
  'TriplesQuadsIO',
  'BooleanIO',
  'QueryIdInput',
];

const PORT_LOADERS: Record<PortKind, (ids: string[]) => Promise<unknown[]>> = {
  QueryInputTuple: async ids => {
    const { loadQueryInputTuplesByIds } = await import('../persistence/utils/QueryInputTupleUtils.js');
    return loadQueryInputTuplesByIds(ids);
  },
  QueryOutputTuple: async ids => {
    const { loadQueryOutputTuplesByIds } = await import('../persistence/utils/QueryOutputTupleUtils.js');
    return loadQueryOutputTuplesByIds(ids);
  },
  TriplesQuadsIO: async ids => {
    const { loadTriplesQuadsIOsByIds } = await import('../persistence/utils/TriplesQuadsIOUtils.js');
    return loadTriplesQuadsIOsByIds(ids);
  },
  BooleanIO: async ids => {
    const { loadBooleanIOsByIds } = await import('../persistence/utils/BooleanIOUtils.js');
    return loadBooleanIOsByIds(ids);
  },
  QueryIdInput: async ids => {
    const { loadQueryIdInputsByIds } = await import('../persistence/utils/QueryIdInputUtils.js');
    return loadQueryIdInputsByIds(ids);
  },
};

/** Minting prefixes, used only to order the probes - never to reject a ref. */
const PORT_PREFIX_HINTS: ReadonlyArray<readonly [string, PortKind]> = [
  ['urn:sqlib:input-tuple:', 'QueryInputTuple'],
  ['urn:sqlib:output-tuple:', 'QueryOutputTuple'],
  ['urn:sqlib:triples-quads-io:', 'TriplesQuadsIO'],
  ['urn:sqlib:rdf-output:', 'TriplesQuadsIO'],
  ['urn:sqlib:boolean-io:', 'BooleanIO'],
  ['urn:sqlib:query-id-input:', 'QueryIdInput'],
];

/**
 * Control Flow anchors are not persisted entities, so a ref carrying that
 * prefix is absent by design rather than missing.
 */
const CONTROL_FLOW_PREFIX = 'urn:sqlib:control-flow-io:';

function hintPortKind(ref: string): PortKind | null {
  for (const [prefix, kind] of PORT_PREFIX_HINTS) {
    if (ref.startsWith(prefix)) return kind;
  }
  return null;
}

function entityId(entity: unknown): string | null {
  const record = entity as { $id?: string; '@id'?: string } | null;
  return record?.$id ?? record?.['@id'] ?? null;
}

type PortClosure = {
  byKind: Record<PortKind, unknown[]>;
  unresolved: string[];
};

/**
 * Resolve every referenced port IRI to its typed entity.
 *
 * Probes the hinted repository first and falls back to every other repository
 * for anything still unresolved, so a port minted under an unexpected prefix -
 * or under a prefix this file has never heard of - is still returned rather
 * than silently dropped from the closure.
 */
async function resolvePortClosure(refs: Iterable<string>): Promise<PortClosure> {
  const byKind = Object.fromEntries(PORT_KINDS.map(kind => [kind, [] as unknown[]])) as Record<PortKind, unknown[]>;

  const pending = new Set<string>();
  for (const ref of refs) {
    if (typeof ref !== 'string' || ref.length === 0) continue;
    if (ref.startsWith(CONTROL_FLOW_PREFIX)) continue;
    pending.add(ref);
  }
  if (pending.size === 0) {
    return { byKind, unresolved: [] };
  }

  const accept = (kind: PortKind, entities: unknown[]) => {
    for (const entity of entities) {
      const id = entityId(entity);
      if (!id || !pending.has(id)) continue;
      pending.delete(id);
      byKind[kind].push(entity);
    }
  };

  const hinted = new Map<PortKind, string[]>();
  for (const ref of pending) {
    const kind = hintPortKind(ref);
    if (!kind) continue;
    const bucket = hinted.get(kind);
    if (bucket) bucket.push(ref);
    else hinted.set(kind, [ref]);
  }

  for (const [kind, ids] of hinted) {
    accept(kind, await resolveEntities<unknown>(ids, kind, missing => PORT_LOADERS[kind](missing)));
  }

  for (const kind of PORT_KINDS) {
    if (pending.size === 0) break;
    const ids = Array.from(pending);
    accept(kind, await resolveEntities<unknown>(ids, kind, missing => PORT_LOADERS[kind](missing)));
  }

  return { byKind, unresolved: Array.from(pending) };
}

function getCachedEntity<T>(id: string, type: string): T | null {
  if (!id) return null;
  try {
    const entity = getCacheCoordinator().get(id);
    if (entity && entity['@type'] === type) {
      return entity as T;
    }
  } catch (error) {
    // Cache may not be hydrated in tests; fall back to repository loaders
  }
  return null;
}

function partitionCacheHits<T>(ids: string[], type: string): { hits: Map<string, T>; misses: string[] } {
  const hits = new Map<string, T>();
  const misses: string[] = [];
  for (const id of ids) {
    if (!id) continue;
    const cached = getCachedEntity<T>(id, type);
    if (cached) {
      hits.set(id, cached);
    } else {
      misses.push(id);
    }
  }
  return { hits, misses };
}

async function resolveEntities<T>(
  ids: string[],
  type: string,
  loader: (missing: string[]) => Promise<T[]>
): Promise<T[]> {
  if (ids.length === 0) return [];
  const { hits, misses } = partitionCacheHits<T>(ids, type);
  if (misses.length > 0) {
    try {
      const fetched = await loader(misses);
      for (const entity of fetched) {
        const entityId = (entity as { $id?: string; '@id'?: string }).$id ?? (entity as { $id?: string; '@id'?: string })['@id'];
        if (entityId && !hits.has(entityId)) {
          hits.set(entityId, entity);
        }
      }
    } catch (error) {
      // Surface best-effort data; repository failures match previous behaviour
    }
  }
  return ids
    .map(id => hits.get(id))
    .filter((entity): entity is T => Boolean(entity));
}

/**
 * Helper to convert a node entity to REST API shape with nodeType field.
 */
function toRestExecutionNode(node: any): any {
  const restNode = toRestApi(node);
  // Use existing nodeType field or derive from @type as fallback
  const nodeType = node.nodeType || node['@type'];
  return { ...restNode, nodeType };
}

/**
 * Helper to add a node to the collections and track start/end nodes
 */
function addNodeToCollections(
  node: any,
  id: string,
  startNodeId: string | null,
  endNodeId: string | null,
  nodes: any[],
  startNodeRef: { value: any },
  endNodeRef: { value: any }
): void {
  nodes.push(node);
  if (id === startNodeId) {
    startNodeRef.value = node;
  }
  if (id === endNodeId) {
    endNodeRef.value = node;
  }
}

/**
 * Everything an expansion needs from a group version's `executionNodes`,
 * `startNode`, `endNode` and `edges` references, resolved to entities.
 *
 * Both `expandGroupVersion` and `expandGroupVersionDetailed` need exactly this,
 * and for a long time each carried its own copy of the resolution — ~140 lines
 * that had already drifted apart in formatting and were one edit away from
 * drifting in behaviour. The two expansions differ in what they *report*, not
 * in how they find things, so the finding lives here and the reporting stays
 * with each caller.
 */
type ResolvedGroupMembers = {
  startNodeId: string | null;
  endNodeId: string | null;
  nodes: (LdkitQueryNode | LdkitStartNode | LdkitEndNode | LdkitDynamicQueryNode | LdkitRuleSetNode | LdkitPatchNode)[];
  startNodeRef: { value: any };
  endNodeRef: { value: any };
  edges: LdkitQueryEdge[];
};

/**
 * The repositories a node IRI may live in, tried in order until one answers.
 *
 * Order is the original ladder's: QueryNode first because it is much the most
 * common, then the structural node types. A repository that throws is skipped
 * rather than fatal — expansion is best-effort, and a missing node should cost
 * that node, not the whole graph.
 */
const NODE_REPOSITORY_LOOKUPS: ReadonlyArray<(id: string) => Promise<any>> = [
  async id => (await import('../persistence/utils/QueryNodeUtils.js')).QueryNodes.findByIri(id),
  async id => (await import('../persistence/utils/StartNodeUtils.js')).StartNodes.findByIri(id),
  async id => (await import('../persistence/utils/EndNodeUtils.js')).EndNodes.findByIri(id),
  async id => (await import('../persistence/utils/DynamicQueryNodeUtils.js')).DynamicQueryNodes.findByIri(id),
  async id => (await import('../persistence/utils/RuleSetNodeUtils.js')).RuleSetNodes.findByIri(id),
  async id => (await import('../persistence/utils/PatchNodeUtils.js')).PatchNodes.findByIri(id),
];

async function resolveGroupMembers(version: LdkitQueryGroupVersion): Promise<ResolvedGroupMembers> {
  const cacheCoordinator = getCacheCoordinator();

  // Include nodes from explicit startNode/endNode references in addition to intermediate nodes
  const allNodeIds: string[] = [
    ...((version.executionNodes || []).filter(Boolean) as string[])
  ];

  // Track start/end node IDs separately
  const startNodeId = ('startNode' in version && version.startNode) ? version.startNode as string : null;
  const endNodeId = ('endNode' in version && version.endNode) ? version.endNode as string : null;

  // Add explicit start/end node references if they exist
  if (startNodeId) {
    allNodeIds.push(startNodeId);
  }
  if (endNodeId) {
    allNodeIds.push(endNodeId);
  }

  const nodeIds = uniqueIds(allNodeIds);
  const edgeIds = uniqueIds(((version.edges || []).filter(Boolean) as string[]));

  const nodes: ResolvedGroupMembers['nodes'] = [];
  const startNodeRef = { value: null };
  const endNodeRef = { value: null };
  const edges: LdkitQueryEdge[] = [];

  // Resolve nodes via cache, falling back to each node repository in turn
  for (const id of nodeIds) {
    const cached = cacheCoordinator.get(id);
    if (cached) {
      addNodeToCollections(cached, id, startNodeId, endNodeId, nodes, startNodeRef, endNodeRef);
      continue;
    }

    for (const lookup of NODE_REPOSITORY_LOOKUPS) {
      try {
        const node = await lookup(id);
        if (node) {
          addNodeToCollections(node, id, startNodeId, endNodeId, nodes, startNodeRef, endNodeRef);
          break;
        }
      } catch (e) {
        // swallow; keep trying other types
      }
    }
  }

  // Resolve edges via cache, fallback to repository
  for (const id of edgeIds) {
    const cached = cacheCoordinator.get(id);
    if (cached && isQueryEdge(cached)) {
      edges.push(cached);
      continue;
    }
    try {
      const { QueryEdges } = await import('../persistence/utils/QueryEdgeUtils.js');
      const edge = await QueryEdges.findByIri(id);
      if (edge) {
        edges.push(edge);
      }
    } catch (e) {
      // swallow; keep best-effort expansion
    }
  }

  return { startNodeId, endNodeId, nodes, startNodeRef, endNodeRef, edges };
}

/**
 * Resolve and expand a QueryGroupVersion's node and edge references into full objects.
 * Falls back to LDKit repositories for types not cached.
 */
export async function expandGroupVersion(version: LdkitQueryGroupVersion): Promise<{
  queryGroupVersion: ReturnType<typeof toRestApi<LdkitQueryGroupVersion>>;
  executionNodes: AnyRestNodeType[];
  startNode?: AnyRestNodeType;
  endNode?: AnyRestNodeType;
  edges: ReturnType<typeof toRestApi<LdkitQueryEdge>>[];
  /**
   * The `LIMIT` / `OFFSET` names this group accepts: the union of its members'.
   *
   * Served here rather than recomputed by the screen so the fields a caller is
   * offered and the names `/execute` will accept cannot disagree. Same field
   * names a query version carries, for the same reason.
   */
  limitParameters: string[];
  offsetParameters: string[];
}> {
  const { startNodeId, endNodeId, nodes, startNodeRef, endNodeRef, edges } = await resolveGroupMembers(version);

  // Create executionNodes array - all nodes with nodeType field, start/end nodes omitted from duplicates
  const executionNodes = nodes
    .filter(n => {
      const nodeId = n.$id;
      // Include node if it's not a dedicated start/end node, or if it's both intermediate and start/end
      const isStart = nodeId === startNodeId;
      const isEnd = nodeId === endNodeId;
      const isIntermediate = (version.executionNodes || []).includes(nodeId);

      // Include if: not start/end, or if start/end but also intermediate
      return (!isStart && !isEnd) || (isIntermediate && (isStart || isEnd));
    })
    .map(n => toRestExecutionNode(n));

  const pageParameters = new QueryGroupSignatureService().pageParametersFor(version.$id);

  return {
    queryGroupVersion: toRestApi<LdkitQueryGroupVersion>(version),
    executionNodes,
    startNode: startNodeRef.value ? toRestExecutionNode(startNodeRef.value) : null,
    endNode: endNodeRef.value ? toRestExecutionNode(endNodeRef.value) : null,
    edges: edges.map(e => toRestApi<LdkitQueryEdge>(e)),
    limitParameters: pageParameters.limitParameters,
    offsetParameters: pageParameters.offsetParameters,
  };
}

/**
 * Optionally expand currentVersion for a stable QueryGroup, returning combined shape.
 */
export async function expandCurrentVersionForGroup(groupId: string): Promise<{
  version?: ReturnType<typeof toRestApi<LdkitQueryGroupVersion>>;
  executionNodes?: AnyRestNodeType[];
  startNode?: AnyRestNodeType | null;
  endNode?: AnyRestNodeType | null;
  edges?: ReturnType<typeof toRestApi<LdkitQueryEdge>>[];
} | null> {
  const cacheCoordinator = getCacheCoordinator();
  const group = cacheCoordinator.get(groupId);
  if (!group || !isQueryGroup(group)) return null;

  const current = group.currentVersion as string | undefined;
  if (!current) return { version: undefined, executionNodes: undefined, startNode: undefined, endNode: undefined, edges: undefined };

  // Try to get the actual version entity by ID from cache first (by ID not by type)
  const maybe = cacheCoordinator.get(current) as LdkitQueryGroupVersion | null;
  if (maybe) {
    const expanded = await expandGroupVersion(maybe);
    return {
      version: expanded.queryGroupVersion,
      executionNodes: expanded.executionNodes,
      startNode: expanded.startNode ?? null,
      endNode: expanded.endNode ?? null,
      edges: expanded.edges
    };
  }

  // Fallback: scan cached versions of type and match by IRI
  const versions = cacheCoordinator.list('QueryGroupVersion') as LdkitQueryGroupVersion[];
  const found = versions.find(v => v.$id === current);
  if (found) {
    const expanded = await expandGroupVersion(found);
    return {
      version: expanded.queryGroupVersion,
      executionNodes: expanded.executionNodes,
      startNode: expanded.startNode ?? null,
      endNode: expanded.endNode ?? null,
      edges: expanded.edges
    };
  }

  return null;
}

export async function expandGroupVersionDetailed(version: LdkitQueryGroupVersion): Promise<{
  queryGroupVersion: ReturnType<typeof toRestApi<LdkitQueryGroupVersion>>;
  executionNodes: AnyRestNodeType[];
  startNode?: AnyRestNodeType;
  endNode?: AnyRestNodeType;
  edges: ReturnType<typeof toRestApi<LdkitQueryEdge>>[];
  queryNodes: ReturnType<typeof toRestApi<LdkitQueryNode>>[];
  dynamicQueryNodes: ReturnType<typeof toRestApi<LdkitDynamicQueryNode>>[];
  ruleSetNodes: ReturnType<typeof toRestApi<LdkitRuleSetNode>>[];
  patchNodes: ReturnType<typeof toRestApi<LdkitPatchNode>>[];
  startNodes: ReturnType<typeof toRestApi<LdkitStartNode>>[];
  endNodes: ReturnType<typeof toRestApi<LdkitEndNode>>[];
  rdfOutputs: ReturnType<typeof toRestApi<LdkitTriplesQuadsIO>>[];
  booleanOutputs: ReturnType<typeof toRestApi<LdkitBooleanIO>>[];
  queryIdInputs: ReturnType<typeof toRestApi<LdkitQueryIdInput>>[];
  inputs: ReturnType<typeof toRestApi<LdkitQueryInputVariable>>[];
  inputTuples: ReturnType<typeof toRestApi<LdkitQueryInputTuple>>[];
  outputs: ReturnType<typeof toRestApi<LdkitQueryOutputVariable>>[];
  outputTuples: ReturnType<typeof toRestApi<LdkitQueryOutputTuple>>[];
  tupleMembers: ReturnType<typeof toRestApi<LdkitTupleMember>>[];
  queryVersions: ReturnType<typeof toRestApi<LdkitQueryVersion>>[];
}> {
  const { startNodeId, endNodeId, nodes, startNodeRef, endNodeRef, edges } = await resolveGroupMembers(version);

  const queryNodes: LdkitQueryNode[] = [];
  const dynamicQueryNodes: LdkitDynamicQueryNode[] = [];
  const ruleSetNodes: LdkitRuleSetNode[] = [];
  const patchNodes: LdkitPatchNode[] = [];
  const startNodes: LdkitStartNode[] = [];
  const endNodes: LdkitEndNode[] = [];
  const queryVersionIds = new Set<string>();

  /**
   * Every port IRI the returned graph mentions, whoever owns the entity behind
   * it. Which bucket each one belongs in is decided by resolving it, not by
   * reading its name: a start node's outputs are the group's *input* tuples, a
   * CONSTRUCT node's output is a TriplesQuadsIO, and an EndNode's inputs are
   * whatever its upstream produced. Name-based bucketing silently dropped all
   * three, which is how a saved node could come back with no ports at all.
   */
  const portRefs = new Set<string>();
  const addPortRefs = (refs: unknown) => {
    for (const ref of normalizeRefArray(refs)) {
      if (ref) portRefs.add(ref);
    }
  };

  // Classify nodes by trying lenses
  for (const node of nodes) {
    if (isQueryNode(node)) {
        queryNodes.push(node as unknown as LdkitQueryNode);
        if (node.queryId) queryVersionIds.add(node.queryId);
        continue;
    }
    if (isDynamicQueryNode(node)) {
        dynamicQueryNodes.push(node as LdkitDynamicQueryNode);
        if (node.queryId) queryVersionIds.add(node.queryId);
        continue;
    }
    if (isRuleSetNode(node)) {
        ruleSetNodes.push(node as LdkitRuleSetNode);
        continue;
    }
    if (isPatchNode(node)) {
        patchNodes.push(node as LdkitPatchNode);
        // The update it derives is a QueryVersion like any other node's query,
        // and the client needs it to show what the node does.
        if (node.queryId) queryVersionIds.add(node.queryId);
        continue;
    }
    if (isStartNode(node)) {
        startNodes.push(node as LdkitStartNode);
        continue;
    }
    if (isEndNode(node)) {
        endNodes.push(node as LdkitEndNode);
        addPortRefs((node as { rdfOutputs?: unknown }).rdfOutputs);
        continue;
    }
  }

  for (const node of nodes) {
    addPortRefs((node as { inputs?: unknown }).inputs);
    addPortRefs((node as { outputs?: unknown }).outputs);
    // A PatchNode names its two ports twice - in `outputs` and by sign. The
    // named ones are added explicitly so a node whose `outputs` went stale
    // still comes back with the ports its edges reference.
    addPortRefs([
      (node as { deletionsOutput?: unknown }).deletionsOutput,
      (node as { additionsOutput?: unknown }).additionsOutput,
    ].filter(Boolean));
  }
  for (const edge of edges) {
    addPortRefs([edge.sourceOutputId, edge.targetInputId].filter(Boolean));
  }

  const queryVersionIdList = Array.from(queryVersionIds);
  const rawQueryVersions = await resolveEntities<LdkitQueryVersion>(queryVersionIdList, 'QueryVersion', async missing => {
    const { loadQueryVersionsByIds } = await import('../persistence/utils/QueryVersionUtils.js');
    return loadQueryVersionsByIds(missing);
  });

  // A query version owns the canonical interface of every node that references
  // it. Including it here is what makes a reloaded node show the same ports as
  // a freshly assigned one, even when the node's persisted arrays predate a
  // change to the query.
  for (const queryVersion of rawQueryVersions) {
    addPortRefs(queryVersion.inferredInputs);
    addPortRefs(queryVersion.inferredOutputs);
  }

  const portClosure = await resolvePortClosure(portRefs);
  if (portClosure.unresolved.length > 0) {
    console.warn(
      `[expandGroupVersionDetailed] ${portClosure.unresolved.length} referenced port(s) in ${version.$id} could not be resolved to an I/O entity:`,
      portClosure.unresolved,
    );
  }

  const rawInputTuples = portClosure.byKind.QueryInputTuple as LdkitQueryInputTuple[];
  const rawOutputTuples = portClosure.byKind.QueryOutputTuple as LdkitQueryOutputTuple[];
  const rawRdfOutputs = portClosure.byKind.TriplesQuadsIO as LdkitTriplesQuadsIO[];
  const rawBooleanOutputs = portClosure.byKind.BooleanIO as LdkitBooleanIO[];
  const rawQueryIdInputs = portClosure.byKind.QueryIdInput as LdkitQueryIdInput[];

  const rdfOutputs = rawRdfOutputs.map(o => toRestApi<LdkitTriplesQuadsIO>(o));
  const booleanOutputs = rawBooleanOutputs.map(o => toRestApi<LdkitBooleanIO>(o));
  const queryIdInputs = rawQueryIdInputs.map(o => toRestApi<LdkitQueryIdInput>(o));
  const inputTuples = rawInputTuples.map(t => toRestApi<LdkitQueryInputTuple>(t));
  const outputTuples = rawOutputTuples.map(t => toRestApi<LdkitQueryOutputTuple>(t));
  const queryVersions = rawQueryVersions.map(v => toRestApi<LdkitQueryVersion>(v));

  const normalizedInputTuples = Array.isArray(inputTuples) ? inputTuples : [];
  // From tuples, collect tupleMembers and then variables → inputs/outputs
  const tupleMemberIds = new Set<string>();
  inputTuples.forEach((t: any) => (t.memberEntries || []).forEach((id: string) => id && tupleMemberIds.add(id)));
  outputTuples.forEach((t: any) => (t.memberEntries || []).forEach((id: string) => id && tupleMemberIds.add(id)));
  const tupleMemberIdList = Array.from(tupleMemberIds);
  const rawTupleMembers = await resolveEntities<LdkitTupleMember>(tupleMemberIdList, 'TupleMember', async missing => {
    const { loadTupleMembersByIds } = await import('../persistence/utils/TupleMemberUtils.js');
    return loadTupleMembersByIds(missing);
  });
  const tupleMembers: ReturnType<typeof toRestApi<LdkitTupleMember>>[] = rawTupleMembers.map(m => toRestApi<LdkitTupleMember>(m));

  // Collect all variable IDs from tuple members for bulk loading
  const variableIds = new Set<string>();
  for (const m of tupleMembers) {
    const variable = m.variable;
    if (typeof variable === 'string') {
      variableIds.add(variable);
    }
  }
  const variableIdList = Array.from(variableIds);

  // Bulk load all variables as inputs and outputs to classify them
  const rawInputCandidates = await resolveEntities<LdkitQueryInputVariable>(variableIdList, 'QueryInputVariable', async missing => {
    const { loadQueryInputVariablesByIds } = await import('../persistence/utils/QueryInputVariableUtils.js');
    return loadQueryInputVariablesByIds(missing);
  });
  const rawOutputCandidates = await resolveEntities<LdkitQueryOutputVariable>(variableIdList, 'QueryOutputVariable', async missing => {
    const { loadQueryOutputVariablesByIds } = await import('../persistence/utils/QueryOutputVariableUtils.js');
    return loadQueryOutputVariablesByIds(missing);
  });

  // Classify variables by what was successfully loaded
  const inputIds = new Set<string>(rawInputCandidates.map(i => i.$id).filter(Boolean));
  const outputIds = new Set<string>(rawOutputCandidates.map(o => o.$id).filter(Boolean));
  // Use the already loaded data from classification
  const inputs = rawInputCandidates.map(i => toRestApi<LdkitQueryInputVariable>(i));
  const outputs = rawOutputCandidates.map(o => toRestApi<LdkitQueryOutputVariable>(o));

  // Create executionNodes array - all nodes with nodeType field, start/end nodes omitted from duplicates
  const executionNodes = nodes
    .filter(n => {
      const nodeId = n.$id;
      // Include node if it's not a dedicated start/end node, or if it's both intermediate and start/end
      const isStart = nodeId === startNodeId;
      const isEnd = nodeId === endNodeId;
      const isIntermediate = (version.executionNodes || []).includes(nodeId);

      // Include if: not start/end, or if start/end but also intermediate
      return (!isStart && !isEnd) || (isIntermediate && (isStart || isEnd));
    })
    .map(n => toRestExecutionNode(n));

  return {
    queryGroupVersion: toRestApi<LdkitQueryGroupVersion>(version),
    executionNodes,
    startNode: startNodeRef.value ? toRestExecutionNode(startNodeRef.value) : null,
    endNode: endNodeRef.value ? toRestExecutionNode(endNodeRef.value) : null,
    edges: edges.map(e => toRestApi<LdkitQueryEdge>(e)),
    queryNodes: queryNodes.map(n => toRestApi<LdkitQueryNode>(n)),
    dynamicQueryNodes: dynamicQueryNodes.map(n => toRestApi<LdkitDynamicQueryNode>(n)),
    ruleSetNodes: ruleSetNodes.map(n => toRestApi<LdkitRuleSetNode>(n)),
    patchNodes: patchNodes.map(n => toRestApi<LdkitPatchNode>(n)),
    startNodes: startNodes.map(n => toRestApi<LdkitStartNode>(n)),
    endNodes: endNodes.map(n => toRestApi<LdkitEndNode>(n)),
    rdfOutputs,
    booleanOutputs,
    queryIdInputs,
    inputs,
    inputTuples: normalizedInputTuples,
    outputs,
    outputTuples,
    tupleMembers,
    queryVersions,
  };
}
