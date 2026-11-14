import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { QueryTypeIri } from '../../../src/constants/queryTypes.js';
import { getCacheCoordinator } from '../../../src/lib/CacheCoordinatorProvider.js';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../fixtures/scenario-test-base-unmocked.js';

/**
 * The library Activity feed (`GET /libraries/:id/activity`) and the `Removal`
 * records that deletes leave for it.
 */
describe('Library activity', () => {
  let context: ScenarioTestContext;
  let keptId: string;
  let goneId: string;
  let envId: string;

  const enc = encodeURIComponent;

  async function createQuery(name: string): Promise<string> {
    const res = await context.app.inject({
      method: 'POST', url: '/queries/',
      payload: { name, isPartOf: [context.libraryId], defaultBackend: context.backendId },
    });
    expect(res.statusCode, res.payload).toBe(201);
    return res.json().id;
  }

  async function createVersion(id: string, label: string): Promise<string> {
    const res = await context.app.inject({
      method: 'POST', url: `/queries/${enc(id)}/versions`,
      payload: { queryVersion: { queryString: `SELECT ?v WHERE { BIND("${label}" AS ?v) }`, queryType: QueryTypeIri.select } },
    });
    expect(res.statusCode, res.payload).toBe(201);
    return res.json().queryVersion.id;
  }

  async function activity(query = '') {
    const res = await context.app.inject({ method: 'GET', url: `/libraries/${enc(context.libraryId)}/activity${query}` });
    expect(res.statusCode, res.payload).toBe(200);
    return res.json() as { items: Array<Record<string, unknown>>; next?: string | null };
  }

  const removals = () => (getCacheCoordinator().list('Removal') as Array<{ isPartOf?: string; removedEntity?: string }>)
    .filter((removal) => removal.isPartOf === context.libraryId);

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('library-activity');
    await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'Activity Backend');
    await ScenarioTestBaseUnmocked.createLibrary(context, 'Activity Library');

    keptId = await createQuery('Kept');
    const v1 = await createVersion(keptId, 'one');
    await createVersion(keptId, 'two');
    goneId = await createQuery('Old churn');
    await createVersion(goneId, 'gone');

    const env = await context.app.inject({
      method: 'POST', url: '/environments/', payload: { name: 'prod', isPartOf: context.libraryId },
    });
    expect(env.statusCode, env.payload).toBe(201);
    envId = env.json().id;
    const move = await context.app.inject({
      method: 'PUT', url: `/environments/${enc(envId)}/pointers`, payload: { entity: keptId, version: v1 },
    });
    expect(move.statusCode, move.payload).toBe(200);
  }, 30000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  it('records one removal for a delete, and none for the versions it takes with it', async () => {
    const del = await context.app.inject({ method: 'DELETE', url: `/queries/${enc(goneId)}` });
    expect([200, 204]).toContain(del.statusCode);
    expect(removals().map((removal) => removal.removedEntity)).toEqual([goneId]);

    const version = await context.app.inject({ method: 'DELETE', url: `/queries/${enc(keptId)}/versions/2` });
    expect([200, 204]).toContain(version.statusCode);
    expect(removals()).toHaveLength(1);
  });

  it('lists creates, saves, moves and deletes, newest first', async () => {
    const { items } = await activity();
    const summary = items.map((item) => [item.kind, item.entityName, item.versionNumber ?? item.toVersionNumber ?? null]);
    expect(summary[0]).toEqual(['deleted', 'Old churn', null]);
    expect(summary).toContainEqual(['moved', 'Kept', 1]);
    expect(summary).toContainEqual(['saved', 'Kept', 1]);
    expect(summary).toContainEqual(['created', 'Kept', null]);
    expect(summary).toContainEqual(['created', 'prod', null]);
    // The deleted query's own create and version went with it.
    expect(summary.filter((row) => row[1] === 'Old churn')).toHaveLength(1);
    const moved = items.find((item) => item.kind === 'moved');
    expect(moved).toMatchObject({ environment: envId, environmentName: 'prod', fromVersionNumber: null });
    const ats = items.map((item) => String(item.at));
    expect([...ats].sort().reverse()).toEqual(ats);
  });

  it('filters by kind and pages with the cursor', async () => {
    expect((await activity('?kind=deleted')).items.map((item) => item.kind)).toEqual(['deleted']);
    expect(new Set((await activity('?kind=edited')).items.map((item) => item.kind))).toEqual(new Set(['saved']));
    expect((await activity('?actor=urn:sqlib:principal:user:nobody')).items).toEqual([]);

    const all = (await activity()).items;
    const first = await activity('?limit=2');
    expect(first.items).toEqual(all.slice(0, 2));
    expect(typeof first.next).toBe('string');
    const second = await activity(`?limit=2&before=${enc(String(first.next))}`);
    expect(second.items).toEqual(all.slice(2, 4));
  });

  it('records the delete of an environment and answers 404 for an unknown library', async () => {
    const del = await context.app.inject({ method: 'DELETE', url: `/environments/${enc(envId)}` });
    expect(del.statusCode).toBe(204);
    const { items } = await activity('?kind=deleted');
    expect(items.map((item) => item.entityName)).toEqual(['prod', 'Old churn']);
    // Its moves went with it.
    expect((await activity('?kind=moved')).items).toEqual([]);

    const unknown = await context.app.inject({ method: 'GET', url: '/libraries/urn%3Asqlib%3Alibrary%3Anone/activity' });
    expect(unknown.statusCode).toBe(404);
  });

  it('deletes the removals with the library', async () => {
    const del = await context.app.inject({ method: 'DELETE', url: `/libraries/${enc(context.libraryId)}` });
    expect([200, 204]).toContain(del.statusCode);
    expect(removals()).toEqual([]);
  });
});
