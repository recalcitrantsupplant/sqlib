/**
 * Selecting which of a library's query groups an export covers, and reducing
 * each to the walk a browser can perform.
 *
 * A group as stored is a canvas: nodes, edges, tuples, tuple members and the
 * input/output variables those members point at, all separate entities. A group
 * as exported is three lists — nodes, edges, and which node's result is the
 * answer — with every name already resolved. That resolution is this module: it
 * reads entities and writes plain data, exactly as `collectLibraryQueries` does
 * for queries, leaving all parser work to the compile step.
 *
 * **What is not carried, and why it is a skip rather than a failure.** The
 * static runtime chains rows: an upstream SELECT's results become a downstream
 * query's `VALUES` block, which is the substitution it already performs. Moving
 * RDF between nodes needs a store to materialise into, a rule set node needs the
 * rules engine, an ETL node needs DuckDB — none of which a ~2 KiB runtime has.
 * A group using any of them is reported, with the reason, and left out. That is
 * the opposite policy to a query, which is fatal when it cannot be compiled,
 * because a group is additive: a library whose one CONSTRUCT-chaining group
 * cannot travel should still export its queries and its other groups.
 *
 * See `docs/guides/static-export.md`.
 */

import type { LdkitQueryGroup } from '../../persistence/schemas/QueryGroupSchema.js';
import type { LdkitQueryGroupVersion } from '../../persistence/schemas/QueryGroupVersionSchema.js';
import type { LdkitQueryVersion } from '../../persistence/schemas/QueryVersionSchema.js';
import type { LdkitQuery } from '../../persistence/schemas/QuerySchema.js';
import { WHEN_EMPTY_MODES, type WhenEmptyMode } from '../../persistence/schemas/QueryEdgeSchema.js';
import { slugify } from './queryBundle.js';

/** Any entity in a group's graph, read as the untyped record a store returns. */
export type GroupGraphEntity = Record<string, unknown> & { '@type'?: string };

/** The entity reads this module needs, so a route and a script can both supply them. */
export interface LibraryGroupSource {
  listGroups(): LdkitQueryGroup[];
  getGroupVersion(id: string): LdkitQueryGroupVersion | null;
  /**
   * Any other entity by IRI: nodes, edges, tuples, tuple members, input and
   * output variables, query versions and queries. One accessor rather than one
   * per type, because the walk is generic over all of them.
   */
  getEntity(id: string): GroupGraphEntity | null;
}

export interface CollectGroupsOptions {
  /** Tag IRIs to filter by. Empty means "every group in the library". */
  tags?: readonly string[];
  /** `any` (the default) keeps a group carrying any listed tag; `all` requires all. */
  match?: 'any' | 'all';
}

/** A group the export could not include, and why — reported, never swallowed. */
export interface SkippedGroup {
  id: string;
  name: string;
  reason: string;
}

/** One node of a group, reduced to the query it runs. */
export interface ExportGroupNodeInput {
  /** The node's key within the exported group. */
  key: string;
  /** Provenance: the QueryNode IRI. */
  sourceNode: string;
  /** The stable Query's name, which the bundle key is slugged from. */
  name: string;
  queryString: string;
  sourceQuery?: string;
  sourceVersion: string;
  tags?: string[];
  description?: string;
}

/** One chaining edge, with every name resolved. */
export interface ExportGroupEdgeInput {
  from: string;
  to: string;
  targetVars: string[];
  mappings: Array<{ source: string; target: string }>;
  whenEmpty?: WhenEmptyMode;
  sourceEdge: string;
}

/** A group to export, reduced to what the bundle needs. */
export interface ExportGroupInput {
  name: string;
  description?: string;
  tags?: string[];
  sourceGroup: string;
  sourceVersion: string;
  nodes: ExportGroupNodeInput[];
  edges: ExportGroupEdgeInput[];
  /** Node key whose result the group returns. */
  resultNode: string;
}

export interface CollectedGroups {
  groups: ExportGroupInput[];
  skipped: SkippedGroup[];
}

/** Raised internally to abandon one group with a reason. Never leaves the module. */
class GroupNotExportable extends Error {}

function refuse(reason: string): never {
  throw new GroupNotExportable(reason);
}

function matchesTags(group: LdkitQueryGroup, tags: readonly string[], match: 'any' | 'all'): boolean {
  if (tags.length === 0) return true;
  const carried = group.tags ?? [];
  return match === 'all'
    ? tags.every((tag) => carried.includes(tag))
    : tags.some((tag) => carried.includes(tag));
}

function typeOf(entity: GroupGraphEntity | null): string {
  return typeof entity?.['@type'] === 'string' ? (entity['@type'] as string) : 'unknown';
}

/**
 * The variable names a tuple declares, in position order.
 *
 * A tuple is a list of members, each pointing at a variable entity that holds
 * the name — the same three-hop walk `GraphBuilder` performs, done here against
 * a supplied source so the export does not depend on the execution cache.
 */
function tupleNames(source: LibraryGroupSource, tupleId: string): string[] {
  const tuple = source.getEntity(tupleId);
  if (!tuple) refuse(`Its tuple ${tupleId} could not be found.`);
  const members = Array.isArray(tuple.memberEntries) ? (tuple.memberEntries as string[]) : [];
  const entries: Array<{ position: number; name: string }> = [];

  for (const memberId of members) {
    const member = source.getEntity(memberId);
    if (!member) continue;
    const variableId = typeof member.variable === 'string' ? member.variable : undefined;
    if (!variableId) continue;
    const variable = source.getEntity(variableId);
    const name = typeof variable?.variableName === 'string' ? variable.variableName : '';
    if (!name) refuse(`Its tuple member ${memberId} names no variable.`);
    entries.push({ position: typeof member.position === 'number' ? member.position : 0, name });
  }

  entries.sort((a, b) => a.position - b.position);
  return entries.map((entry) => entry.name);
}

/**
 * How an edge's columns line up: the author's stored mapping when there is one,
 * otherwise the server's default — exact names first, then position for what is
 * left. Copied in behaviour from `ExecutionEngine.resolveVariableMappings`,
 * because a group that renames differently here than there is a group that
 * returns different rows.
 */
export function resolveVariableMappings(
  stored: string | null | undefined,
  sourceVars: readonly string[],
  targetVars: readonly string[],
): Array<{ source: string; target: string }> {
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Array<{ source?: unknown; target?: unknown }>;
      if (Array.isArray(parsed)) {
        const allowedSource = new Set(sourceVars);
        const allowedTarget = new Set(targetVars);
        const used = new Set<string>();
        const mappings: Array<{ source: string; target: string }> = [];
        for (const mapping of parsed) {
          if (typeof mapping?.source !== 'string' || typeof mapping?.target !== 'string') continue;
          if (!allowedSource.has(mapping.source) || !allowedTarget.has(mapping.target)) continue;
          if (used.has(mapping.target)) continue;
          used.add(mapping.target);
          mappings.push({ source: mapping.source, target: mapping.target });
        }
        if (mappings.length > 0) return mappings;
      }
    } catch {
      // A mapping that will not parse is no mapping: fall through to the default,
      // which is what the engine does with it too.
    }
  }

  const mappings: Array<{ source: string; target: string }> = [];
  const remainingSource = new Set(sourceVars);
  const remainingTarget = new Set(targetVars);
  for (const target of targetVars) {
    if (remainingSource.delete(target)) {
      mappings.push({ source: target, target });
      remainingTarget.delete(target);
    }
  }
  const sources = sourceVars.filter((name) => remainingSource.has(name));
  const targets = targetVars.filter((name) => remainingTarget.has(name));
  for (let index = 0; index < Math.min(sources.length, targets.length); index++) {
    mappings.push({ source: sources[index], target: targets[index] });
  }
  return mappings;
}

/** Resolve one group version into the walk, or refuse it with a reason. */
function reduceGroup(
  source: LibraryGroupSource,
  group: LdkitQueryGroup,
  version: LdkitQueryGroupVersion,
): ExportGroupInput {
  const nodeIds = (version.executionNodes ?? []).filter(Boolean) as string[];
  if (nodeIds.length === 0) refuse('Its current version has no execution nodes.');

  const keys = new Map<string, string>();
  const nodes: ExportGroupNodeInput[] = [];
  const used = new Set<string>();

  for (const nodeId of nodeIds) {
    const node = source.getEntity(nodeId);
    if (!node) refuse(`Its node ${nodeId} could not be found.`);
    const nodeType = typeOf(node);
    if (nodeType !== 'QueryNode') {
      refuse(
        `Node ${nodeId} is a ${nodeType}. The static runtime runs SPARQL queries only, so a group containing one cannot be exported.`,
      );
    }

    const queryVersionId = typeof node.queryId === 'string' ? node.queryId : undefined;
    if (!queryVersionId) refuse(`Its node ${nodeId} names no query version.`);
    const raw = source.getEntity(queryVersionId);
    if (!raw || typeOf(raw) !== 'QueryVersion') {
      refuse(`Its node ${nodeId} references missing QueryVersion ${queryVersionId}.`);
    }
    const queryVersion = raw as unknown as LdkitQueryVersion;
    if (!queryVersion.queryString) refuse(`The query version behind node ${nodeId} has no text.`);

    const stable = queryVersion.isPartOf
      ? (source.getEntity(queryVersion.isPartOf) as unknown as LdkitQuery | null)
      : null;
    const name = stable?.name ?? queryVersion.$id;

    // The node key is slugged from the query's name, so a group's edges read as
    // `people-by-city → summary` rather than as a pair of IRIs.
    let key = slugify(name);
    for (let suffix = 2; used.has(key); suffix++) key = `${slugify(name)}-${suffix}`;
    used.add(key);
    keys.set(nodeId, key);

    nodes.push({
      key,
      sourceNode: nodeId,
      name,
      queryString: queryVersion.queryString,
      ...(stable?.$id ? { sourceQuery: stable.$id } : {}),
      sourceVersion: queryVersion.$id,
      ...(stable?.tags && stable.tags.length > 0 ? { tags: [...stable.tags] } : {}),
      ...(stable?.description ? { description: stable.description } : {}),
    });
  }

  const edges: ExportGroupEdgeInput[] = [];
  let resultNode: string | undefined;

  for (const edgeId of (version.edges ?? []).filter(Boolean) as string[]) {
    const edge = source.getEntity(edgeId);
    if (!edge || typeOf(edge) !== 'QueryEdge') continue;

    const from = typeof edge.sourceNodeId === 'string' ? edge.sourceNodeId : undefined;
    const to = typeof edge.targetNodeId === 'string' ? edge.targetNodeId : undefined;
    if (!from || !to) refuse(`Its edge ${edgeId} names no source or target node.`);

    const flow = typeof edge.dataFlowType === 'string' ? edge.dataFlowType : 'CONTROL_FLOW';
    const fromStart = from === version.startNode;
    const toEnd = to === version.endNode;

    if (toEnd) {
      // The end node is not executed: whatever fed it is the group's answer.
      if (flow === 'CONTROL_FLOW') continue;
      const producer = keys.get(from);
      if (!producer) refuse(`Its end node is fed by ${from}, which is not one of its nodes.`);
      if (resultNode && resultNode !== producer) {
        refuse(
          'Its end node has more than one data input. Merging several results is a store operation, which the static runtime does not perform.',
        );
      }
      resultNode = producer;
      continue;
    }

    if (fromStart) {
      // A start node port is the caller's own input. The exported group takes
      // those as argument sets named by the slot they fill, so the edge itself
      // carries nothing and is dropped — but only when it carries rows.
      if (flow === 'VARIABLE_BINDINGS' || flow === 'CONTROL_FLOW') continue;
      refuse(
        `Its start node supplies ${flow} to node ${to}. Only tabular inputs reach an exported group; a data graph or a boolean does not.`,
      );
    }

    if (flow !== 'VARIABLE_BINDINGS') {
      refuse(
        `Edge ${edgeId} is a ${flow} edge. Only SELECT-to-VALUES chaining is carried by the static runtime.`,
      );
    }

    const fromKey = keys.get(from);
    const toKey = keys.get(to);
    if (!fromKey || !toKey) refuse(`Its edge ${edgeId} connects a node outside the group.`);

    const sourceOutputId = typeof edge.sourceOutputId === 'string' ? edge.sourceOutputId : undefined;
    const targetInputId = typeof edge.targetInputId === 'string' ? edge.targetInputId : undefined;
    if (!sourceOutputId || !targetInputId) {
      refuse(`Its edge ${edgeId} does not say which output feeds which input.`);
    }

    const outputType = typeOf(source.getEntity(sourceOutputId));
    if (outputType !== 'QueryOutputTuple') {
      refuse(
        `Edge ${edgeId} chains a ${outputType}. Only a query's output tuple carries rows the runtime can splice.`,
      );
    }

    const sourceVars = tupleNames(source, sourceOutputId);
    const targetVars = tupleNames(source, targetInputId);
    if (targetVars.length === 0) refuse(`Its edge ${edgeId} fills a tuple that declares no variables.`);

    const whenEmpty = WHEN_EMPTY_MODES.includes(edge.whenEmpty as WhenEmptyMode)
      ? (edge.whenEmpty as WhenEmptyMode)
      : undefined;

    edges.push({
      from: fromKey,
      to: toKey,
      targetVars,
      mappings: resolveVariableMappings(
        typeof edge.variableMappings === 'string' ? edge.variableMappings : null,
        sourceVars,
        targetVars,
      ),
      ...(whenEmpty ? { whenEmpty } : {}),
      sourceEdge: edgeId,
    });
  }

  if (!resultNode) {
    refuse(
      'Nothing is connected to its end node, so the group has no result for the runtime to return.',
    );
  }

  return {
    name: group.name ?? group.$id,
    ...(group.description ? { description: group.description } : {}),
    ...(group.tags && group.tags.length > 0 ? { tags: [...group.tags] } : {}),
    sourceGroup: group.$id,
    sourceVersion: version.$id,
    nodes,
    edges,
    resultNode,
  };
}

/**
 * Resolve a library's query groups to the walks an export should compile.
 *
 * Every group that cannot travel is returned in `skipped` with the reason, in
 * the words a person reading an export report needs: which node, which edge,
 * and what about it the static runtime cannot do.
 */
export function collectLibraryGroups(
  source: LibraryGroupSource,
  libraryId: string,
  options: CollectGroupsOptions = {},
): CollectedGroups {
  const tags = options.tags ?? [];
  const match = options.match ?? 'any';

  const groups: ExportGroupInput[] = [];
  const skipped: SkippedGroup[] = [];

  const members = source
    .listGroups()
    .filter((group) => group.isPartOf === libraryId)
    .filter((group) => matchesTags(group, tags, match));

  for (const group of members) {
    const name = group.name ?? group.$id;
    if (!group.currentVersion) {
      skipped.push({ id: group.$id, name, reason: 'The group has no current version.' });
      continue;
    }
    const version = source.getGroupVersion(group.currentVersion);
    if (!version) {
      skipped.push({
        id: group.$id,
        name,
        reason: `Its current version ${group.currentVersion} could not be found.`,
      });
      continue;
    }

    try {
      groups.push(reduceGroup(source, group, version));
    } catch (error) {
      if (error instanceof GroupNotExportable) {
        skipped.push({ id: group.$id, name, reason: error.message });
        continue;
      }
      throw error;
    }
  }

  // Stable output regardless of store iteration order, so re-exporting an
  // unchanged library produces a byte-identical bundle and a clean diff.
  groups.sort((a, b) => a.name.localeCompare(b.name));
  skipped.sort((a, b) => a.name.localeCompare(b.name));

  return { groups, skipped };
}
