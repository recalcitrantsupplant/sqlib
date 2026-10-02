/**
 * What a coordinator write leaves in the store, not just in the cache.
 *
 * The coordinator suite runs against a stub adapter and asserts cache state;
 * these run against the real one. Each failure here was a case where the cache
 * said one thing and the store another, and the store won on the next refresh:
 * a `null` that cleared nothing, an update to an entity the store never held
 * reported as saved, and dates that were `Date`s or strings depending on which
 * path wrote them.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  ScenarioTestBaseUnmocked,
  type ScenarioTestContext,
} from '../scenarios/fixtures/scenario-test-base-unmocked.js';
import { getCacheCoordinator } from '../../src/lib/CacheCoordinatorProvider.js';
import { EntityNotPersistedError } from '../../src/lib/CacheCoordinator.js';
import { getPersistenceAdapter } from '../../src/persistence/adapterRegistry.js';
import type { EntityType } from '../../src/lib/EntityRegistry.js';

describe('CacheCoordinator write-through', () => {
  let context: ScenarioTestContext;
  let writeThroughBefore: string | undefined;

  const post = (url: string, payload: Record<string, unknown>) =>
    context.app.inject({ method: 'POST', url, payload });

  const stored = (type: EntityType, id: string) =>
    getPersistenceAdapter().findByIri(type, id) as Promise<Record<string, unknown> | null>;

  beforeAll(async () => {
    writeThroughBefore = process.env.CACHE_WRITE_THROUGH;
    context = await ScenarioTestBaseUnmocked.createTestContext('cache-write-through');
    // The scenario harness runs cache-only; the store is the subject here.
    process.env.CACHE_WRITE_THROUGH = 'true';
    await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'backend');
    await ScenarioTestBaseUnmocked.createLibrary(context, 'library');
  }, 60000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
    if (writeThroughBefore === undefined) delete process.env.CACHE_WRITE_THROUGH;
    else process.env.CACHE_WRITE_THROUGH = writeThroughBefore;
  });

  it('clears a property in the store when it is updated to null', async () => {
    const coordinator = getCacheCoordinator();
    await coordinator.update('Library', context.libraryId, { defaultBackend: context.backendId });
    expect((await stored('Library', context.libraryId))?.defaultBackend).toBe(context.backendId);

    await coordinator.update('Library', context.libraryId, { defaultBackend: null });

    expect((await stored('Library', context.libraryId))?.defaultBackend).toBeNull();
    await coordinator.refreshEntityType('Library');
    expect(coordinator.get(context.libraryId)?.defaultBackend ?? null).toBeNull();
  });

  it('deleting a backend clears the defaults that named it in the store', async () => {
    const backend = await post('/backends/', { name: 'doomed', backendType: 'oxigraphEphemeral' });
    expect(backend.statusCode, backend.payload).toBe(201);
    const backendId = backend.json().id as string;

    const query = await post('/queries/', {
      name: 'q',
      isPartOf: [context.libraryId],
      defaultBackend: backendId,
    });
    expect(query.statusCode, query.payload).toBe(201);
    const queryId = query.json().id as string;
    await getCacheCoordinator().update('Library', context.libraryId, { defaultBackend: backendId });

    const removed = await context.app.inject({ method: 'DELETE', url: `/backends/${encodeURIComponent(backendId)}` });
    expect(removed.statusCode, removed.payload).toBeLessThan(300);

    expect((await stored('Library', context.libraryId))?.defaultBackend).toBeNull();
    expect((await stored('Query', queryId))?.defaultBackend).toBeNull();
  });

  it('refuses to report an update to an entity the store does not hold', async () => {
    const coordinator = getCacheCoordinator();
    const id = 'urn:sqlib:tag:cache-only';
    coordinator.cache.set(id, { $id: id, '@type': 'Tag', name: 'cache only', isPartOf: context.libraryId });

    await expect(coordinator.update('Tag', id, { name: 'renamed' })).rejects.toBeInstanceOf(EntityNotPersistedError);
    expect(coordinator.get(id)?.name).toBe('cache only');
    coordinator.cache.delete(id);
  });

  it('still updates an ephemeral entity, which lives in the cache by design', async () => {
    const coordinator = getCacheCoordinator();
    const id = 'urn:sqlib:tag:ephemeral';
    coordinator.addEphemeral({ $id: id, name: 'scratch', isPartOf: context.libraryId }, 'Tag');

    const updated = await coordinator.update('Tag', id, { name: 'renamed' });

    expect(updated?.name).toBe('renamed');
    coordinator.removeEphemeral(id);
  });

  it('reads dates back as ISO strings, the same as it writes them', async () => {
    const library = await stored('Library', context.libraryId);

    for (const field of ['dateCreated', 'dateModified']) {
      expect(typeof library?.[field], field).toBe('string');
      expect(new Date(library?.[field] as string).toISOString()).toBe(library?.[field]);
    }
  });
});
