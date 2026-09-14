#!/usr/bin/env ts-node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QueryTypeIri } from '../src/constants/queryTypes.js';
import { SYSTEM_LIBRARY_ID, SYSTEM_QUERY_METADATA, type SystemQueryKey } from '../src/lib/system-queries/SystemQueryCatalog.js';
import {
  findLibraryById,
  createLibrary,
  updateLibrary,
} from '../src/persistence/utils/LibraryUtils.js';
import {
  findQueryById,
  createQuery,
  updateQuery,
} from '../src/persistence/utils/QueryUtils.js';
import {
  findQueryVersionById,
  createQueryVersion,
  updateQueryVersion,
} from '../src/persistence/utils/QueryVersionUtils.js';
import type { LDKitEntity } from '../src/persistence/utils/entityRepository.js';
import type { LdkitLibrary } from '../src/persistence/schemas/LibrarySchema.js';
import type { LdkitQuery } from '../src/persistence/schemas/QuerySchema.js';
import type { LdkitQueryVersion } from '../src/persistence/schemas/QueryVersionSchema.js';
import { loadSystemStore } from '../src/system-store/SystemStoreLoader.js';

function arraysEqual<T>(a: T[] | undefined | null, b: T[]): boolean {
  if (!a) return false;
  if (a.length !== b.length) return false;
  return a.every((value, idx) => value === b[idx]);
}

function getTypedAsset<T extends LDKitEntity>(assets: Map<string, LDKitEntity>, id: string, expectedType: string): T {
  const asset = assets.get(id);
  if (!asset) {
    throw new Error(`Missing system asset ${id}`);
  }
  const type = (asset as any)['@type'] || (asset as any).type;
  if (type !== expectedType) {
    throw new Error(`System asset ${id} has type ${type ?? 'unknown'}, expected ${expectedType}`);
  }
  return asset as T;
}

async function ensureSystemLibrary(systemAssets: Map<string, LDKitEntity>): Promise<void> {
  const seed = getTypedAsset<LdkitLibrary>(systemAssets, SYSTEM_LIBRARY_ID, 'Library');
  const desiredName = seed.name;
  const desiredDescription = seed.description ?? null;
  const existing = await findLibraryById(SYSTEM_LIBRARY_ID);
  if (!existing) {
    await createLibrary({
      $id: SYSTEM_LIBRARY_ID,
      name: desiredName,
      description: desiredDescription ?? undefined,
      defaultBackend: seed.defaultBackend ?? undefined,
    });
    console.log('✔ Created system library entity');
    return;
  }

  const updates: Record<string, any> = {};
  if (existing.name !== desiredName) {
    updates.name = desiredName;
  }
  if (existing.description !== desiredDescription) {
    updates.description = desiredDescription;
  }
  if (seed.defaultBackend !== undefined && existing.defaultBackend !== seed.defaultBackend) {
    updates.defaultBackend = seed.defaultBackend;
  }

  if (Object.keys(updates).length > 0) {
    await updateLibrary(SYSTEM_LIBRARY_ID, updates);
    console.log('✔ Updated system library metadata');
  } else {
    console.log('• System library already up to date');
  }
}

async function ensureSystemQuery(key: SystemQueryKey, systemAssets: Map<string, LDKitEntity>): Promise<void> {
  const metadata = SYSTEM_QUERY_METADATA[key];
  const querySeed = getTypedAsset<LdkitQuery>(systemAssets, metadata.queryId, 'Query');
  const versionSeed = getTypedAsset<LdkitQueryVersion>(systemAssets, metadata.versionId, 'QueryVersion');
  const desiredMembership = querySeed.isPartOf?.length ? querySeed.isPartOf : [SYSTEM_LIBRARY_ID];
  const desiredCurrentVersion = querySeed.currentVersion ?? metadata.versionId;
  const parentQueryId = versionSeed.isPartOf ?? metadata.queryId;

  let query = await findQueryById(metadata.queryId);
  if (!query) {
    await createQuery({
      $id: metadata.queryId,
      name: querySeed.name,
      description: querySeed.description ?? undefined,
      isPartOf: desiredMembership,
      currentVersion: desiredCurrentVersion,
      defaultBackend: querySeed.defaultBackend ?? undefined,
    } as any);
    query = await findQueryById(metadata.queryId);
    console.log(`✔ Created system query entity ${metadata.queryId}`);
  }

  const metadataUpdates: Record<string, any> = {};
  if (query?.name !== querySeed.name) {
    metadataUpdates.name = querySeed.name;
  }
  if (query?.description !== querySeed.description) {
    metadataUpdates.description = querySeed.description;
  }
  if (!arraysEqual(query?.isPartOf, desiredMembership)) {
    metadataUpdates.isPartOf = desiredMembership;
  }
  if (query?.currentVersion !== desiredCurrentVersion) {
    metadataUpdates.currentVersion = desiredCurrentVersion;
  }
  if (querySeed.defaultBackend !== undefined && query?.defaultBackend !== querySeed.defaultBackend) {
    metadataUpdates.defaultBackend = querySeed.defaultBackend;
  }

  if (Object.keys(metadataUpdates).length > 0) {
    await updateQuery(metadata.queryId, metadataUpdates);
    console.log(`✔ Updated system query metadata for ${metadata.queryId}`);
  }

  const existingVersion = await findQueryVersionById(metadata.versionId);
  if (!existingVersion) {
    await createQueryVersion({
      $id: metadata.versionId,
      isPartOf: parentQueryId,
      version: versionSeed.version ?? 1,
      queryString: versionSeed.queryString,
      queryType: versionSeed.queryType ?? QueryTypeIri.construct,
      comment: versionSeed.comment ?? undefined,
      immutable: versionSeed.immutable ?? true,
    } as any);
    console.log(`✔ Created system query version ${metadata.versionId}`);
  } else {
    const versionUpdates: Record<string, any> = {};
    if (existingVersion.queryString !== versionSeed.queryString) {
      versionUpdates.queryString = versionSeed.queryString;
    }
    if (existingVersion.queryType !== (versionSeed.queryType ?? QueryTypeIri.construct)) {
      versionUpdates.queryType = versionSeed.queryType ?? QueryTypeIri.construct;
    }
    if (existingVersion.isPartOf !== parentQueryId) {
      versionUpdates.isPartOf = parentQueryId;
    }
    if (existingVersion.version !== (versionSeed.version ?? 1)) {
      versionUpdates.version = versionSeed.version ?? 1;
    }
    if (existingVersion.immutable !== true) {
      versionUpdates.immutable = true;
    }
    if (existingVersion.comment !== (versionSeed.comment ?? undefined)) {
      versionUpdates.comment = versionSeed.comment ?? undefined;
    }
    if (Object.keys(versionUpdates).length > 0) {
      if (existingVersion.immutable) {
        console.log(`• Skipped updates for immutable system version ${metadata.versionId}; create a new version to change content.`);
      } else {
        await updateQueryVersion(metadata.versionId, versionUpdates);
        console.log(`✔ Updated system query version ${metadata.versionId}`);
      }
    }
  }

  const refreshedQuery = await findQueryById(metadata.queryId);
  if (!refreshedQuery?.currentVersion || refreshedQuery.currentVersion !== desiredCurrentVersion) {
    await updateQuery(metadata.queryId, { currentVersion: desiredCurrentVersion });
    console.log(`✔ Set currentVersion for ${metadata.queryId} -> ${desiredCurrentVersion}`);
  }
}

async function seedSystemLibrary(): Promise<void> {
  console.log('🚀 Seeding System Library and export queries...');
  const { cacheEntries, assetDir } = await loadSystemStore();
  console.log(`• Loaded system assets from ${assetDir}`);
  await ensureSystemLibrary(cacheEntries);
  for (const key of Object.keys(SYSTEM_QUERY_METADATA) as SystemQueryKey[]) {
    await ensureSystemQuery(key, cacheEntries);
  }
  console.log('✅ System Library seeding complete.');
}

const modulePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';

if (modulePath === invokedPath) {
  seedSystemLibrary()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('❌ Failed to seed System Library:', error);
      process.exit(1);
    });
}

export { seedSystemLibrary };
