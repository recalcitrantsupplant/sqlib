import type { PersistedQueryVersion } from '../persistence/schemas/QueryVersionSchema.js';
import type { PersistedLimitParameter } from '../persistence/schemas/LimitParameterSchema.js';
import type { PersistedOffsetParameter } from '../persistence/schemas/OffsetParameterSchema.js';
import type { PersistedQueryInputVariable } from '../persistence/schemas/QueryInputVariableSchema.js';
import type { PersistedQueryOutputVariable } from '../persistence/schemas/QueryOutputVariableSchema.js';
import type { PersistedQueryInputTuple } from '../persistence/schemas/QueryInputTupleSchema.js';
import type { PersistedQueryOutputTuple } from '../persistence/schemas/QueryOutputTupleSchema.js';
import type { PersistedTupleMember } from '../persistence/schemas/TupleMemberSchema.js';
import { toRestApi } from '../persistence/utils/id-adapter.js';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { loadLimitParametersByIds } from '../persistence/utils/LimitParameterUtils.js';
import { loadOffsetParametersByIds } from '../persistence/utils/OffsetParameterUtils.js';
import { loadQueryInputVariablesByIds } from '../persistence/utils/QueryInputVariableUtils.js';
import { loadQueryOutputVariablesByIds } from '../persistence/utils/QueryOutputVariableUtils.js';
import { loadQueryInputTuplesByIds } from '../persistence/utils/QueryInputTupleUtils.js';
import { loadTupleMembersByIds } from '../persistence/utils/TupleMemberUtils.js';
import { loadQueryOutputTuplesByIds } from '../persistence/utils/QueryOutputTupleUtils.js';
import { loadTriplesQuadsIOsByIds } from '../persistence/utils/TriplesQuadsIOUtils.js';
import { loadBooleanIOsByIds } from '../persistence/utils/BooleanIOUtils.js';

/**
 * Helper to get cached entity by ID and type, same pattern as GraphResolver
 */
function getCachedEntity<T>(id: string, type?: string): T | null {
  if (!id) return null;
  try {
    const entity = getCacheCoordinator().get(id);
    if (entity && (!type || entity['@type'] === type)) {
      return entity as T;
    }
  } catch (error) {
    // Cache may not be hydrated in tests; fall back to repository loaders
  }
  return null;
}

/**
 * Helper to partition IDs into cache hits and misses
 */
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

/**
 * Helper to resolve entities via cache first, then loader fallback
 */
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
        const entityRef = entity as { $id?: string; '@id'?: string };
        const entityId = entityRef.$id ?? entityRef['@id'];
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
 * Expand a QueryVersion into a flat wrapper with all referenced children as top-level arrays.
 */
export async function expandQueryVersion(version: PersistedQueryVersion): Promise<{
  queryVersion: ReturnType<typeof toRestApi<PersistedQueryVersion>>;
  limitParameters: ReturnType<typeof toRestApi<PersistedLimitParameter>>[];
  offsetParameters: ReturnType<typeof toRestApi<PersistedOffsetParameter>>[];
  inputs: ReturnType<typeof toRestApi<PersistedQueryInputVariable>>[];
  outputs: ReturnType<typeof toRestApi<PersistedQueryOutputVariable>>[];
  inputTuples: ReturnType<typeof toRestApi<PersistedQueryInputTuple>>[];
  outputTuples: ReturnType<typeof toRestApi<PersistedQueryOutputTuple>>[];
  tupleMembers: ReturnType<typeof toRestApi<PersistedTupleMember>>[];
}> {
  const versionApi = toRestApi<PersistedQueryVersion>(version);

  const limitParamIds = (version.limitParameters || []).filter(Boolean) as string[];
  const offsetParamIds = (version.offsetParameters || []).filter(Boolean) as string[];
  const inputTupleIds = (version.inferredInputs || []).filter(Boolean) as string[];
  const inferredOutputIds = (version.inferredOutputs || []).filter(Boolean) as string[];

  const [limitParams, offsetParams, inputTuples] = await Promise.all([
    resolveEntities<PersistedLimitParameter>(limitParamIds, 'LimitParameter', loadLimitParametersByIds),
    resolveEntities<PersistedOffsetParameter>(offsetParamIds, 'OffsetParameter', loadOffsetParametersByIds),
    resolveEntities<PersistedQueryInputTuple>(inputTupleIds, 'QueryInputTuple', loadQueryInputTuplesByIds),
  ]);

  // From inputTuples, collect tupleMembers and then inputs
  const inputTupleMemberIds = new Set<string>();
  for (const t of inputTuples) {
    (t.memberEntries || []).forEach((id) => id && inputTupleMemberIds.add(id));
  }

  // From inferredOutputs, collect different types of outputs and resolve them
  const outputTupleIds = new Set<string>();
  const triplesQuadsIOIds = new Set<string>();
  const booleanIOIds = new Set<string>();

  // First pass: categorize by type using cache
  for (const outputId of inferredOutputIds) {
    const output = getCachedEntity(outputId); // Get any entity without type filter
    if (output) {
      const outputType = (output as { '@type'?: string })['@type'];
      if (outputType === 'QueryOutputTuple') {
        outputTupleIds.add(outputId);
      } else if (outputType === 'TriplesQuadsIO') {
        triplesQuadsIOIds.add(outputId);
      } else if (outputType === 'BooleanIO') {
        booleanIOIds.add(outputId);
      }
    } else {
      // If not in cache, we need to determine type via repository - add to all sets for now
      // The resolveEntities calls below will filter out the ones that don't match
      outputTupleIds.add(outputId);
      triplesQuadsIOIds.add(outputId);
      booleanIOIds.add(outputId);
    }
  }

  // Resolve all the different types of outputs in parallel
  const [inputTupleMembers, outputTuples, triplesQuadsIOs, booleanIOs] = await Promise.all([
    resolveEntities<PersistedTupleMember>(Array.from(inputTupleMemberIds), 'TupleMember', loadTupleMembersByIds),
    resolveEntities<PersistedQueryOutputTuple>(Array.from(outputTupleIds), 'QueryOutputTuple', loadQueryOutputTuplesByIds),
    resolveEntities(Array.from(triplesQuadsIOIds), 'TriplesQuadsIO', loadTriplesQuadsIOsByIds),
    resolveEntities(Array.from(booleanIOIds), 'BooleanIO', loadBooleanIOsByIds),
  ]);

  const outputTupleMemberIds = new Set<string>();
  for (const t of outputTuples) {
    (t.memberEntries || []).forEach((id) => id && outputTupleMemberIds.add(id));
  }

  const outputTupleMembers = outputTupleMemberIds.size
    ? await resolveEntities<PersistedTupleMember>(Array.from(outputTupleMemberIds), 'TupleMember', loadTupleMembersByIds)
    : [];

  const allTupleMembersMap = new Map<string, PersistedTupleMember>();
  for (const m of inputTupleMembers) allTupleMembersMap.set(m.$id, m);
  for (const m of outputTupleMembers) allTupleMembersMap.set(m.$id, m);
  const allTupleMembers = Array.from(allTupleMembersMap.values()).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  // Collect individual input and output entity IDs from tuple members
  const inputIds = new Set<string>();
  const outputIds = new Set<string>();

  for (const member of inputTupleMembers) {
    if (member.variable) inputIds.add(member.variable);
  }

  for (const member of outputTupleMembers) {
    if (member.variable) outputIds.add(member.variable);
  }

  // Resolve individual input and output entities
  const [inputs, outputs] = await Promise.all([
    resolveEntities<PersistedQueryInputVariable>(Array.from(inputIds), 'QueryInputVariable', loadQueryInputVariablesByIds),
    resolveEntities<PersistedQueryOutputVariable>(Array.from(outputIds), 'QueryOutputVariable', loadQueryOutputVariablesByIds),
  ]);

  return {
    queryVersion: versionApi,
    limitParameters: limitParams.map(p => toRestApi<PersistedLimitParameter>(p)),
    offsetParameters: offsetParams.map(p => toRestApi<PersistedOffsetParameter>(p)),
    inputs: inputs.map(i => toRestApi<PersistedQueryInputVariable>(i)),
    outputs: outputs.map(o => toRestApi<PersistedQueryOutputVariable>(o)),
    inputTuples: inputTuples.map(t => toRestApi<PersistedQueryInputTuple>(t)),
    outputTuples: outputTuples.map(t => toRestApi<PersistedQueryOutputTuple>(t)),
    tupleMembers: allTupleMembers.map(m => toRestApi<PersistedTupleMember>(m)),
  };
}
