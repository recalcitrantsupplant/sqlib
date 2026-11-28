/**
 * Move the `ogc` objects of query versions into OGC services, once.
 *
 * Before OGC services (`docs/proposals/ogc-services.md`), a query version
 * became a collection by carrying an `ogc` object, and a library's
 * collections were served at `/ogc/{library slug}`. At startup, for each
 * library whose queries' current versions carry `ogc` objects and that has no
 * OGC service with its slug yet, this makes one: the library's name, its
 * slug, and one collection per such query, following the query's version in
 * the environment. The old URLs then keep working. A collection that no
 * longer fits its query is left out and logged. Running it again changes
 * nothing, because the service with the library's slug then exists.
 */
import type { OgcServiceCollection } from '@sparql-query-lib/tools';
import { OGC_SERVICE_SLUG_PATTERN } from '@sparql-query-lib/tools';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { mintId } from './id.js';
import { toPersisted } from '../persistence/utils/id-adapter.js';
import { createOgcServiceVersion } from './OgcServiceVersionWriter.js';
import { resolveOgcCollection } from './publishedTools.js';
import type { PersistedLibrary } from '../persistence/schemas/LibrarySchema.js';
import type { PersistedQuery } from '../persistence/schemas/QuerySchema.js';
import type { PersistedQueryVersion } from '../persistence/schemas/QueryVersionSchema.js';
import type { PersistedOgcService } from '../persistence/schemas/OgcServiceSchema.js';

export async function migrateOgcObjects(log: (message: string) => void): Promise<number> {
  const cache = getCacheCoordinator();
  const services = cache.list('OgcService') as PersistedOgcService[];
  const taken = new Set(services.map(service => service.slug));
  const slugPattern = new RegExp(OGC_SERVICE_SLUG_PATTERN);
  let made = 0;
  for (const library of cache.list('Library') as PersistedLibrary[]) {
    if (!library.slug || taken.has(library.slug)) continue;
    const collections: OgcServiceCollection[] = [];
    for (const query of cache.list('Query') as PersistedQuery[]) {
      const parents = Array.isArray(query.isPartOf) ? query.isPartOf : [query.isPartOf];
      if (!parents.includes(library.$id) || !query.currentVersion) continue;
      const version = cache.get(query.currentVersion) as PersistedQueryVersion | null;
      if (version?.ogc) collections.push({ query: query.$id, ...version.ogc });
    }
    if (collections.length === 0) continue;
    if (!slugPattern.test(library.slug)) {
      log(`OGC migration: library "${library.name}" has collections, but its slug "${library.slug}" is not a service slug; make a service for it by hand.`);
      continue;
    }
    const service = await cache.create('OgcService', toPersisted({
      $id: mintId('ogcService'),
      '@type': 'OgcService',
      name: library.name,
      ...(library.description ? { description: library.description } : {}),
      slug: library.slug,
      isPartOf: [library.$id],
    })) as PersistedOgcService;
    const kept = collections.filter(entry => {
      const resolved = resolveOgcCollection({ service, libraryId: library.$id, entry });
      if (typeof resolved === 'string') log(`OGC migration: "${library.slug}" collection "${entry.collectionId}" left out: ${resolved}`);
      return typeof resolved !== 'string';
    });
    await createOgcServiceVersion(service, { collections: kept, comment: 'Made from the query versions\' ogc objects.' });
    taken.add(library.slug);
    made++;
    log(`OGC migration: made service "${library.slug}" with ${kept.length} collection(s).`);
  }
  return made;
}
