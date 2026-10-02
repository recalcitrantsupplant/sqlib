/**
 * Version numbers, and the one lock every version writer takes.
 *
 * Each writer used to read the highest stored version and write the next one
 * with nothing in between, so two saves of the same entity that overlapped
 * both took the same number, and with `CACHE_PRELOAD=false` the cache did not
 * know about earlier versions at all and numbering restarted at 1. They now all
 * go through `allocateVersion`, which holds a per-parent lock from reading the
 * number until the writer has created the version and moved the parent's
 * `currentVersion` pointer, so the next save starts from a finished one.
 *
 * The lock is per process. Two sqlib instances writing one library still need
 * a store-side primitive, which nothing here provides.
 */

import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import type { EntityTypeName } from '../persistence/entityTypeNames.js';
import type { EntityType } from './EntityRegistry.js';

interface VersionLike {
  isPartOf?: string;
  version?: number;
}

/**
 * The next version number for `parentId` that the cache knows of, starting at 1.
 *
 * Numbers are read from what is stored rather than counted, so deleting v2 of
 * three versions still yields 4 rather than reissuing 3 — a reused version
 * number would make an id that used to mean one thing quietly mean another.
 * Writers call `allocateVersion`, which also asks the store and holds the lock.
 */
export function nextVersionNumber(versionType: EntityTypeName, parentId: string): number {
  return highestCachedVersion(versionType, parentId) + 1;
}

function highestCachedVersion(versionType: EntityTypeName, parentId: string): number {
  return (getCacheCoordinator().list(versionType) as VersionLike[])
    .filter(version => version.isPartOf === parentId)
    .reduce((highest, version) => Math.max(highest, Number(version.version) || 0), 0);
}

/**
 * With the cache preloaded it holds every version, so it is the answer. Without
 * preload it holds only what this process has touched, and the store is asked
 * for the rest.
 */
async function highestVersion(versionType: EntityTypeName, parentId: string): Promise<number> {
  const cached = highestCachedVersion(versionType, parentId);
  const { config } = await import('../server/config.js');
  if (config.cachePreloadEnabled) return cached;
  const { highestVersionInStore } = await import('../persistence/EntityStore.js');
  const { SCHEMA_BY_TYPE } = await import('../persistence/schemaRegistry.js');
  const schema = SCHEMA_BY_TYPE[versionType as EntityType] as unknown as Record<string, unknown> | undefined;
  if (!schema) return cached;
  return Math.max(cached, await highestVersionInStore(schema, parentId));
}

const locks = new Map<string, Promise<unknown>>();

/**
 * Run `write` with the next version number for `parentId`, holding that
 * parent's lock until `write` settles.
 *
 * `write` should create the version and move the parent's pointer
 * (`setCurrentVersion`); anything it does is serialised against every other
 * version write for the same parent. A failed write releases the lock and
 * takes no number: the next writer reads the store again.
 */
export async function allocateVersion<R>(
  versionType: EntityTypeName,
  parentId: string,
  write: (version: number) => Promise<R>,
): Promise<R> {
  const key = `${versionType} ${parentId}`;
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.catch(() => {}).then(async () => write((await highestVersion(versionType, parentId)) + 1));
  locks.set(key, run);
  try {
    return await run;
  } finally {
    if (locks.get(key) === run) locks.delete(key);
  }
}

/**
 * Point a parent at its newest version. A parent that cannot be updated (it was
 * deleted while the version was being written) is an error: the version would
 * otherwise exist with nothing pointing at it and the caller told it saved.
 */
export async function setCurrentVersion(parentType: EntityType, parentId: string, versionId: string): Promise<void> {
  const updated = await getCacheCoordinator().update(parentType, parentId, { currentVersion: versionId } as never);
  if (!updated) {
    throw new Error(`Failed to set currentVersion on ${parentType} ${parentId}`);
  }
}
