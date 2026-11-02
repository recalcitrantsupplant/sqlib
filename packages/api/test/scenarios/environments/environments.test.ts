import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { QueryTypeIri } from '../../../src/constants/queryTypes.js';
import { ScenarioTestBaseUnmocked, type ScenarioTestContext } from '../fixtures/scenario-test-base-unmocked.js';

/**
 * Environments: named version pointers inside one library.
 *
 * One query gets three versions. "dev" points to v2 and "prod" to v1. A run
 * that names an environment must run the version it points to; a run that
 * names none runs the current version (`latest`).
 */
describe('Environments', () => {
  let context: ScenarioTestContext;
  let queryId: string;
  let otherQueryId: string;
  const versions: string[] = [];
  let otherVersion: string;
  let devId: string;
  let prodId: string;

  const text = (label: string) =>
    `SELECT ?v WHERE { BIND("${label}" AS ?v) }`;

  async function createQuery(name: string, libraryId = context.libraryId): Promise<string> {
    const res = await context.app.inject({
      method: 'POST',
      url: '/queries/',
      payload: { name, isPartOf: [libraryId], defaultBackend: context.backendId },
    });
    expect(res.statusCode, res.payload).toBe(201);
    return res.json().id;
  }

  async function createVersion(id: string, label: string): Promise<string> {
    const res = await context.app.inject({
      method: 'POST',
      url: `/queries/${encodeURIComponent(id)}/versions`,
      payload: { queryVersion: { queryString: text(label), queryType: QueryTypeIri.select } },
    });
    expect(res.statusCode, res.payload).toBe(201);
    return res.json().queryVersion.id;
  }

  async function run(environment?: string, targetId = queryId) {
    return context.app.inject({
      method: 'POST',
      url: '/execute/',
      payload: { targetId, backendId: context.backendId, ...(environment ? { environment } : {}) },
    });
  }

  type SelectJson = { results?: { bindings?: Array<{ v?: { value?: string } }> } };
  function label(res: { json(): unknown }): string | undefined {
    return (res.json() as SelectJson)?.results?.bindings?.[0]?.v?.value;
  }

  async function point(envId: string, entity: string, version: string | null, from?: string | null) {
    return context.app.inject({
      method: 'PUT',
      url: `/environments/${encodeURIComponent(envId)}/pointers`,
      payload: { entity, version, ...(from !== undefined ? { from } : {}) },
    });
  }

  beforeAll(async () => {
    context = await ScenarioTestBaseUnmocked.createTestContext('environments');
    await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'Environments Backend');
    await ScenarioTestBaseUnmocked.createLibrary(context, 'Environments Library');

    queryId = await createQuery('Promoted query');
    for (const v of ['v1', 'v2', 'v3']) versions.push(await createVersion(queryId, v));
    otherQueryId = await createQuery('Other query');
    otherVersion = await createVersion(otherQueryId, 'other');
  }, 30000);

  afterAll(async () => {
    await ScenarioTestBaseUnmocked.cleanupTestContext(context);
  });

  afterEach(() => {
    delete process.env.SQLIB_DEFAULT_ENVIRONMENT;
  });

  it('creates environments and refuses a reserved or duplicate name', async () => {
    const dev = await context.app.inject({
      method: 'POST', url: '/environments/',
      payload: { name: 'dev', isPartOf: context.libraryId, position: 0 },
    });
    expect(dev.statusCode, dev.payload).toBe(201);
    devId = dev.json().id;

    const prod = await context.app.inject({
      method: 'POST', url: '/environments/',
      payload: { name: 'prod', isPartOf: context.libraryId, position: 1, defaultBackend: context.backendId },
    });
    expect(prod.statusCode, prod.payload).toBe(201);
    prodId = prod.json().id;

    const latest = await context.app.inject({
      method: 'POST', url: '/environments/',
      payload: { name: 'latest', isPartOf: context.libraryId },
    });
    expect(latest.statusCode).toBe(400);

    const duplicate = await context.app.inject({
      method: 'POST', url: '/environments/',
      payload: { name: 'prod', isPartOf: context.libraryId },
    });
    expect(duplicate.statusCode).toBe(409);

    const list = await context.app.inject({
      method: 'GET', url: `/environments/?library=${encodeURIComponent(context.libraryId)}`,
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as Array<{ name: string }>).map(e => e.name)).toEqual(['dev', 'prod']);
  });

  it('refuses to run in an environment the query has no version in', async () => {
    const res = await run('prod');
    expect(res.statusCode).toBe(409);
  });

  it('moves pointers with compare-and-set', async () => {
    expect((await point(prodId, queryId, versions[0], null)).statusCode).toBe(200);
    expect((await point(devId, queryId, versions[1])).statusCode).toBe(200);

    // A stale `from` is refused, and the reply names the current version.
    const stale = await point(prodId, queryId, versions[2], versions[1]);
    expect(stale.statusCode).toBe(409);
    expect(stale.json().current).toBe(versions[0]);

    // A version of another query cannot stand in for this one.
    const wrong = await point(prodId, queryId, otherVersion);
    expect(wrong.statusCode).toBe(400);

    const rows = await context.app.inject({
      method: 'GET', url: `/environments/${encodeURIComponent(prodId)}/pointers`,
    });
    expect(rows.statusCode).toBe(200);
    expect(rows.json()).toEqual([
      expect.objectContaining({ entity: queryId, version: versions[0], versionNumber: 1 }),
    ]);
  });

  it('runs the version each environment points to', async () => {
    const none = await run();
    expect(none.statusCode, none.payload).toBe(200);
    expect(label(none)).toBe('v3');

    const latest = await run('latest');
    expect(label(latest)).toBe('v3');

    const prod = await run('prod');
    expect(prod.statusCode, prod.payload).toBe(200);
    expect(label(prod)).toBe('v1');
    expect(prod.headers['x-resolved-environment']).toBe('prod');

    const dev = await run('dev');
    expect(label(dev)).toBe('v2');

    const unknown = await run('nope');
    expect(unknown.statusCode).toBe(400);
  });

  it('uses SQLIB_DEFAULT_ENVIRONMENT when the caller names none', async () => {
    process.env.SQLIB_DEFAULT_ENVIRONMENT = 'prod';
    expect(label(await run())).toBe('v1');
    // An explicit name still wins.
    expect(label(await run('latest'))).toBe('v3');
  });

  it('runs latest in a library with no environments, whatever the default', async () => {
    const libRes = await context.app.inject({
      method: 'POST', url: '/libraries/',
      payload: { id: 'urn:scenario:library:environments-none', name: 'No environments' },
    });
    expect(libRes.statusCode, libRes.payload).toBe(201);
    const plain = await createQuery('Plain query', 'urn:scenario:library:environments-none');
    await createVersion(plain, 'plain');

    process.env.SQLIB_DEFAULT_ENVIRONMENT = 'prod';
    const res = await run(undefined, plain);
    expect(res.statusCode, res.payload).toBe(200);
    expect(label(res)).toBe('plain');
  });

  it('protects a pointed-to version from delete', async () => {
    const res = await context.app.inject({
      method: 'DELETE',
      url: `/queries/${encodeURIComponent(queryId)}/versions/1`,
    });
    expect(res.statusCode).toBe(409);
  });

  it('exports the versions an environment points to', async () => {
    const res = await context.app.inject({
      method: 'GET',
      url: `/libraries/${encodeURIComponent(context.libraryId)}/export-bundle?environment=prod`,
    });
    expect(res.statusCode, res.payload).toBe(200);
    expect(res.payload).toContain(versions[0]);
    expect(res.payload).not.toContain(versions[2]);

    const unknown = await context.app.inject({
      method: 'GET',
      url: `/libraries/${encodeURIComponent(context.libraryId)}/export-bundle?environment=nope`,
    });
    expect(unknown.statusCode).toBe(400);
  });

  it('refuses to promote a query that only a group uses', async () => {
    const res = await context.app.inject({
      method: 'POST',
      url: '/queries/',
      payload: { name: 'Part', isPartOf: [context.libraryId], groupOnly: true },
    });
    expect(res.statusCode, res.payload).toBe(201);
    const partId: string = res.json().id;
    expect(res.json().groupOnly).toBe(true);
    const partVersion = await createVersion(partId, 'part');

    const move = await point(prodId, partId, partVersion);
    expect(move.statusCode).toBe(400);
    expect(move.json().error).toContain('Promote the group');
  });

  it('starts a new environment from latest or from another environment', async () => {
    const fromLatest = await context.app.inject({
      method: 'POST', url: '/environments/',
      payload: { name: 'seeded-latest', isPartOf: context.libraryId, startFrom: 'latest' },
    });
    expect(fromLatest.statusCode, fromLatest.payload).toBe(201);
    const latestPointers = fromLatest.json().versions as string[];
    expect(latestPointers).toContain(versions[2]);
    expect(latestPointers).toContain(otherVersion);
    expect(latestPointers).not.toContain(versions[0]);

    const fromProd = await context.app.inject({
      method: 'POST', url: '/environments/',
      payload: { name: 'seeded-prod', isPartOf: context.libraryId, startFrom: prodId },
    });
    expect(fromProd.statusCode, fromProd.payload).toBe(201);
    expect(fromProd.json().versions).toEqual((await context.app.inject({
      method: 'GET', url: `/environments/${encodeURIComponent(prodId)}`,
    })).json().versions);

    const unknown = await context.app.inject({
      method: 'POST', url: '/environments/',
      payload: { name: 'seeded-unknown', isPartOf: context.libraryId, startFrom: 'urn:sqlib:environment:missing' },
    });
    expect(unknown.statusCode).toBe(400);

    for (const created of [fromLatest, fromProd]) {
      await context.app.inject({ method: 'DELETE', url: `/environments/${encodeURIComponent(created.json().id)}` });
    }
  });

  it('clears a pointer and deletes an environment', async () => {
    expect((await point(devId, queryId, null)).statusCode).toBe(200);
    expect((await run('dev')).statusCode).toBe(409);

    const del = await context.app.inject({ method: 'DELETE', url: `/environments/${encodeURIComponent(devId)}` });
    expect([200, 204]).toContain(del.statusCode);
    expect((await run('dev')).statusCode).toBe(400);
  });
});
