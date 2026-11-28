/**
 * Writes OGC service versions: the collections, checked and frozen.
 *
 * Each collection is resolved as the OGC routes will serve it
 * (`resolveOgcCollection`): its query is in the service's library, the `ogc`
 * object fits the query version's parameters and outputs, and the JSON-LD
 * terms name properties the collection returns. A version is refused with
 * the first problem, so a saved version always served when it was saved.
 * See `docs/proposals/ogc-services.md`.
 */
import type { OgcServiceCollection } from '@sparql-query-lib/tools';
import { mintId } from './id.js';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { allocateVersion, setCurrentVersion } from './versionNumbering.js';
import { toPersisted } from '../persistence/utils/id-adapter.js';
import { ValidationError } from './validationError.js';
import { resolveOgcCollection } from './publishedTools.js';
import type { PersistedOgcService } from '../persistence/schemas/OgcServiceSchema.js';
import type { PersistedOgcServiceVersion } from '../persistence/schemas/OgcServiceVersionSchema.js';

export interface CreateOgcServiceVersionInput {
  collections: OgcServiceCollection[];
  comment?: string | null;
}

/** The library a service is in. */
function libraryOf(service: PersistedOgcService): string {
  const cache = getCacheCoordinator();
  const parents = Array.isArray(service.isPartOf) ? service.isPartOf : [service.isPartOf];
  const library = parents.find(id => (cache.get(id) as { '@type'?: string } | null)?.['@type'] === 'Library');
  if (!library) throw new ValidationError('The OGC service is in no library.');
  return library;
}

/** Throw a `ValidationError` naming the first collection that cannot be served. */
export function checkOgcServiceCollections(service: PersistedOgcService, collections: unknown): asserts collections is OgcServiceCollection[] {
  if (!Array.isArray(collections)) throw new ValidationError('collections must be a list');
  const libraryId = libraryOf(service);
  const ids = new Set<string>();
  collections.forEach((entry: OgcServiceCollection, index) => {
    const label = `collections[${index}]${entry?.collectionId ? ` ("${entry.collectionId}")` : ''}`;
    if (ids.has(entry.collectionId)) throw new ValidationError(`${label}: the service already has a collection "${entry.collectionId}".`);
    ids.add(entry.collectionId);
    const resolved = resolveOgcCollection({ service, libraryId, entry });
    if (typeof resolved === 'string') throw new ValidationError(`${label}: ${resolved}`);
  });
}

/** Create the next version and point the service at it, under the parent's version lock. */
export async function createOgcServiceVersion(
  service: PersistedOgcService,
  body: CreateOgcServiceVersionInput,
): Promise<PersistedOgcServiceVersion> {
  checkOgcServiceCollections(service, body.collections);
  return allocateVersion('OgcServiceVersion', service.$id, async (nextVersion) => {
    const versionId = mintId('ogcServiceVersion');
    const created = await getCacheCoordinator().create('OgcServiceVersion', toPersisted({
      $id: versionId,
      '@type': 'OgcServiceVersion',
      isPartOf: service.$id,
      version: nextVersion,
      immutable: true,
      collections: body.collections,
      comment: body.comment ?? undefined,
    }));
    await setCurrentVersion('OgcService', service.$id, versionId);
    return created as PersistedOgcServiceVersion;
  });
}

/** Set a version's comment, the one thing about a saved version that may change. */
export async function annotateOgcServiceVersion(
  versionId: string,
  body: { comment?: string | null },
): Promise<PersistedOgcServiceVersion> {
  const cacheCoordinator = getCacheCoordinator();
  const current = cacheCoordinator.get(versionId) as PersistedOgcServiceVersion | null;
  if (!current || current['@type'] !== 'OgcServiceVersion') {
    throw new Error(`OgcServiceVersion ${versionId} not found`);
  }
  if (body.comment === undefined) return current;
  const updated = await cacheCoordinator.update('OgcServiceVersion', versionId, { comment: body.comment });
  if (!updated) throw new Error(`Failed to update OgcServiceVersion ${versionId}`);
  return updated as PersistedOgcServiceVersion;
}
