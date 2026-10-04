/**
 * Delete the entities a version owns, by walking its references.
 *
 * A query version's parameters, variables and tuples, and a group version's
 * nodes, edges and ports, are separate entities that only that version names.
 * Deleting the version alone would leave them in the store with nothing able
 * to reach them. The walk follows only the given properties and deletes only
 * the given types, so a reference out of the owned set — a node's
 * `queryId`, a binding's pinned version — is never followed.
 */
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import type { EntityType } from './EntityRegistry.js';

/** What a query version owns: its parameters, variables, tuples and RDF ports. */
export const QUERY_VERSION_OWNED = {
  types: [
    'LimitParameter', 'OffsetParameter', 'QueryInputVariable', 'QueryOutputVariable',
    'TupleMember', 'QueryInputTuple', 'QueryOutputTuple', 'TriplesQuadsIO', 'BooleanIO',
  ],
  references: [
    'limitParameters', 'offsetParameters', 'inferredInputs', 'inferredOutputs',
    'memberEntries', 'variable',
  ],
} as const satisfies OwnedGraph;

/** What a query group version owns: its nodes, edges and their ports. */
export const GROUP_VERSION_OWNED = {
  types: [
    'QueryEdge', 'QueryNode', 'DynamicQueryNode', 'RuleSetNode', 'PatchNode', 'StartNode', 'EndNode',
    'QueryInputTuple', 'QueryOutputTuple', 'TupleMember', 'QueryInputVariable',
    'QueryOutputVariable', 'TriplesQuadsIO', 'BooleanIO', 'QueryIdInput',
  ],
  references: ['edges', 'executionNodes', 'startNode', 'endNode', 'inputs', 'outputs', 'memberEntries', 'variable'],
} as const satisfies OwnedGraph;

export interface OwnedGraph {
  types: readonly EntityType[];
  references: readonly string[];
}

/**
 * Delete what `root` owns under `graph`, then `root` itself as `rootType`.
 *
 * Children first, so an interrupted walk leaves the root in place to retry from
 * rather than children nothing names.
 */
export async function deleteWithOwned(root: Record<string, unknown> & { $id: string }, rootType: EntityType, graph: OwnedGraph): Promise<void> {
  const cache = getCacheCoordinator();
  const ownedTypes = new Set<string>(graph.types);
  const seen = new Set<string>([root.$id]);

  const childrenOf = (entity: Record<string, unknown>): string[] =>
    graph.references.flatMap(key => {
      const value = entity[key];
      return Array.isArray(value) ? value.filter((ref): ref is string => typeof ref === 'string')
        : typeof value === 'string' ? [value] : [];
    });

  const visit = async (entityId: string): Promise<void> => {
    if (seen.has(entityId)) return;
    seen.add(entityId);
    const entity = cache.get(entityId) as (Record<string, unknown> & { '@type'?: EntityType }) | null;
    if (!entity?.['@type'] || !ownedTypes.has(entity['@type'])) return;
    for (const child of childrenOf(entity)) await visit(child);
    await cache.delete(entity['@type'], entityId);
  };

  for (const child of childrenOf(root)) await visit(child);
  await cache.delete(rootType, root.$id);
}
