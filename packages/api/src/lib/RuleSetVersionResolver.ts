import type { LdkitRuleSetVersion } from '../persistence/schemas/RuleSetVersionSchema.js';
import type { LdkitRuleVersion } from '../persistence/schemas/RuleVersionSchema.js';
import type { LdkitRule } from '../persistence/schemas/RuleSchema.js';
import type { LdkitDataBlockVersion } from '../persistence/schemas/DataBlockVersionSchema.js';
import type { LdkitDataBlock } from '../persistence/schemas/DataBlockSchema.js';
import { toRestApi } from '../persistence/utils/id-adapter.js';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { loadRuleVersionsByIds } from '../persistence/utils/RuleVersionUtils.js';
import { loadDataBlockVersionsByIds } from '../persistence/utils/DataBlockVersionUtils.js';
import { findRuleById } from '../persistence/utils/RuleUtils.js';
import { findDataBlockById } from '../persistence/utils/DataBlockUtils.js';

type AnyRecord = Record<string, any>;

function getCachedEntity<T>(id: string, type?: string): T | null {
  if (!id) return null;
  try {
    const entity = getCacheCoordinator().get(id);
    if (entity && (!type || (entity as AnyRecord)['@type'] === type)) {
      return entity as T;
    }
  } catch (error) {
    // Cache may not be ready; fall back to repository loaders.
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
  loader: (missing: string[]) => Promise<T[]>,
): Promise<T[]> {
  if (ids.length === 0) return [];

  const { hits, misses } = partitionCacheHits<T>(ids, type);
  if (misses.length > 0) {
    try {
      const fetched = await loader(misses);
      for (const entity of fetched) {
        const entityId = (entity as AnyRecord).$id ?? (entity as AnyRecord)['@id'];
        if (entityId && !hits.has(entityId)) {
          hits.set(entityId, entity);
        }
      }
    } catch (error) {
      // Leave best-effort data if repository lookup fails.
    }
  }

  return ids
    .map(id => hits.get(id))
    .filter((entity): entity is T => Boolean(entity));
}

async function resolveStableEntity<T extends { $id: string }>(
  id: string | null | undefined,
  type: string,
  loader: (iri: string) => Promise<T | null>,
): Promise<T | null> {
  if (!id) return null;
  const cached = getCachedEntity<T>(id, type);
  if (cached) return cached;
  try {
    return await loader(id);
  } catch (error) {
    return null;
  }
}

type RestEntity<T extends { $id: string }> = Omit<T, '$id' | '@type'> & { id: string };

function toRestEntity<T extends { $id: string }>(entity: T): RestEntity<T> {
  return toRestApi<T>(entity) as unknown as RestEntity<T>;
}

function coerceImmutable<T extends { immutable?: unknown }>(entity: T): T {
  if (!entity || !Object.prototype.hasOwnProperty.call(entity, 'immutable')) return entity;
  const before = entity.immutable;
  const val = before;

  let after = before;
  if (typeof val === 'string') {
    const lower = val.toLowerCase();
    if (lower === 'true') after = true;
    else if (lower === 'false') after = false;
  } else if (val === true || val === false) {
    after = val;
  }

  entity.immutable = after;

  return entity;
}

function coerceExpandedImmutable(expanded: ExpandedRuleSetVersion): ExpandedRuleSetVersion {
  expanded.ruleSetVersion = coerceImmutable(expanded.ruleSetVersion);
  expanded.rules = expanded.rules.map(entry => ({
    ...entry,
    ruleVersion: coerceImmutable(entry.ruleVersion),
  }));
  expanded.dataBlocks = expanded.dataBlocks.map(entry => ({
    ...entry,
    dataBlockVersion: coerceImmutable(entry.dataBlockVersion),
  }));
  return expanded;
}

export interface ExpandedRuleSetVersion {
  ruleSetVersion: RestEntity<LdkitRuleSetVersion>;
  rules: Array<{
    ruleVersion: RestEntity<LdkitRuleVersion>;
    rule?: RestEntity<LdkitRule>;
  }>;
  dataBlocks: Array<{
    dataBlockVersion: RestEntity<LdkitDataBlockVersion>;
    dataBlock?: RestEntity<LdkitDataBlock>;
  }>;
}

export async function expandRuleSetVersion(version: LdkitRuleSetVersion): Promise<ExpandedRuleSetVersion> {
  const versionRest = coerceImmutable(toRestEntity(version));

  const ruleVersionIds = Array.isArray(version.hasRule)
    ? (version.hasRule as string[]).filter(Boolean)
    : [];
  const dataBlockVersionIds = Array.isArray(version.hasDataBlock)
    ? (version.hasDataBlock as string[]).filter(Boolean)
    : [];

  const [ruleVersions, dataBlockVersions] = await Promise.all([
    resolveEntities<LdkitRuleVersion>(ruleVersionIds, 'RuleVersion', loadRuleVersionsByIds),
    resolveEntities<LdkitDataBlockVersion>(dataBlockVersionIds, 'DataBlockVersion', loadDataBlockVersionsByIds),
  ]);

  const rules = await Promise.all(ruleVersions.map(async (ruleVersion) => {
    const rule = await resolveStableEntity<LdkitRule>(ruleVersion.isPartOf, 'Rule', findRuleById);
    return {
      ruleVersion: coerceImmutable(toRestEntity(ruleVersion)),
      ...(rule ? { rule: toRestEntity(rule) } : {}),
    };
  }));

  const dataBlocks = await Promise.all(dataBlockVersions.map(async (dataBlockVersion) => {
    const dataBlock = await resolveStableEntity<LdkitDataBlock>(dataBlockVersion.isPartOf, 'DataBlock', findDataBlockById);
    return {
      dataBlockVersion: coerceImmutable(toRestEntity(dataBlockVersion)),
      ...(dataBlock ? { dataBlock: toRestEntity(dataBlock) } : {}),
    };
  }));

  return coerceExpandedImmutable({
    ruleSetVersion: versionRest,
    rules,
    dataBlocks,
  });
}
