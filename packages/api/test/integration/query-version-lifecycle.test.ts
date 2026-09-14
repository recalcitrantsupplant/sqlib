/**
 * The query/version lifecycle, as invariants over real operation sequences.
 *
 * The route suites beside this one check one call at a time against mocked
 * repositories: does POST return 201, does the payload validate. What they
 * cannot see is the property that actually decides whether the editor above
 * them can be correct — that after *any* sequence of writes, the stored shape
 * still holds together. `currentVersion` naming a version that exists, of this
 * query; version numbers dense and monotonic from 1; a new version becoming
 * current. The UI's own model
 * (`packages/web/src/lib/entityLifecycle.ts`) relies on all three, and
 * relied on them silently until this file.
 *
 * The store is a real `MemoryCacheManager` rather than a mock, because an
 * invariant asserted against a double is an invariant about the double.
 *
 * Companion to `docs/explanation/versioning-and-immutability.md`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { MemoryCacheManager } from '../../src/lib/MemoryCacheManager.js';
import queryRoutes from '../../src/routes/queries.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { setupValidator } from '../../src/lib/validator-setup.js';
import { registerNoStoreHook } from '../../src/lib/httpCaching.js';

let cacheManager: MemoryCacheManager | null = null;

const hoisted = vi.hoisted(() => ({
  list: vi.fn((type: string) => cacheManager?.getByType(type as never) ?? []),
  get: vi.fn((id: string) => cacheManager?.get(id) ?? null),
  create: vi.fn((type: string, entity: never) => cacheManager!.create(entity, type as never)),
  update: vi.fn((type: string, id: string, updates: never) => cacheManager!.update(id, updates, type as never)),
  delete: vi.fn((type: string, id: string) => cacheManager!.delete(id, type as never)),
  resolveExisting: vi.fn(async (id: string) => {
    const entity = cacheManager?.get(id) as { '@type'?: string } | null;
    return entity ? { type: entity['@type'], entity } : null;
  }),
}));

vi.mock('../../src/persistence/adapterRegistry', async () => {
  const { lensBackedAdapter } = await import('../persistence/lensBackedAdapter.js');
  return { getPersistenceAdapter: () => lensBackedAdapter, setPersistenceAdapter: () => {} };
});

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    list: hoisted.list,
    get: hoisted.get,
    create: hoisted.create,
    update: hoisted.update,
    delete: hoisted.delete,
    resolveExisting: hoisted.resolveExisting,
  }),
  getEntityRepositories: () => ({
    Query: {
      list: () => hoisted.list('Query'),
      get: (id: string) => hoisted.get(id),
      create: (entity: never) => hoisted.create('Query', entity),
      update: (id: string, updates: never) => hoisted.update('Query', id, updates),
      delete: (id: string) => hoisted.delete('Query', id),
    },
    QueryVersion: {
      list: () => hoisted.list('QueryVersion'),
      get: (id: string) => hoisted.get(id),
      create: (entity: never) => hoisted.create('QueryVersion', entity),
      update: (id: string, updates: never) => hoisted.update('QueryVersion', id, updates),
      delete: (id: string) => hoisted.delete('QueryVersion', id),
    },
    Library: {
      list: () => hoisted.list('Library'),
      get: (id: string) => hoisted.get(id),
      create: (entity: never) => hoisted.create('Library', entity),
      update: (id: string, updates: never) => hoisted.update('Library', id, updates),
      delete: (id: string) => hoisted.delete('Library', id),
    },
  }),
}));

vi.mock('../../src/persistence/utils/entityRepository.js', () => ({
  loadAllSystemEntities: vi.fn().mockResolvedValue(new Map()),
  createRepositoryLens: vi.fn(() => ({
    insert: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    find: vi.fn().mockResolvedValue([]),
    findByIri: vi.fn().mockResolvedValue(null),
    insertData: vi.fn().mockResolvedValue(undefined),
    deleteData: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../../src/persistence/utils/id-adapter.js', () => ({
  toRestApi: vi.fn((entity) => ({ id: entity.$id, ...entity })),
  toLdkit: vi.fn((entity) => entity),
}));

const LIBRARY_ID = 'urn:sqlib:library:lifecycle';

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  setupValidator(app);
  // As `index.ts` registers it: before the routes, so an entity read is
  // answered the way a browser actually receives it.
  registerNoStoreHook(app);
  app.setErrorHandler((error, _request, reply) => {
    reply.status(error.statusCode || 500).send({ error: error.message });
  });
  for (const schema of Object.values(schemas)) {
    if (schema && typeof schema === 'object' && '$id' in schema) {
      app.addSchema(schema);
    }
  }
  await app.register(queryRoutes, { prefix: '/queries' });
  await app.ready();
  return app;
}

interface StoredQuery {
  $id: string;
  currentVersion?: string | null;
}

interface StoredVersion {
  $id: string;
  isPartOf: string;
  version: number;
}

function storedQuery(id: string): StoredQuery | null {
  return (cacheManager?.get(id) as StoredQuery | null) ?? null;
}

function storedVersions(queryId: string): StoredVersion[] {
  const all = (cacheManager?.getByType('QueryVersion' as never) ?? []) as unknown as StoredVersion[];
  return all
    .filter((version) => version.isPartOf === queryId)
    .sort((a, b) => Number(a.version) - Number(b.version));
}

/**
 * What must hold of a query and its versions after any sequence of writes.
 *
 * Deliberately the *same three* properties the web model assumes, stated on
 * the side that actually guarantees them. A checker rather than a set of
 * assertions so every step of every sequence can be checked, not just the end.
 */
function checkInvariants(queryId: string): string[] {
  const violations: string[] = [];
  const query = storedQuery(queryId);
  if (!query) return [`query ${queryId} is gone`];

  const versions = storedVersions(queryId);
  const numbers = versions.map((version) => Number(version.version));

  // I1. Version numbers are dense and monotonic from 1.
  numbers.forEach((number, index) => {
    if (number !== index + 1) violations.push(`version numbering jumps: ${numbers.join(',')}`);
  });

  // I2. `currentVersion` resolves to a version of *this* query.
  if (query.currentVersion) {
    const target = versions.find((version) => version.$id === query.currentVersion);
    if (!target) {
      violations.push(`currentVersion ${query.currentVersion} is not a version of ${queryId}`);
    }
  } else if (versions.length) {
    violations.push(`query has ${versions.length} version(s) but no currentVersion`);
  }

  // I3. Two versions never share a number.
  if (new Set(numbers).size !== numbers.length) {
    violations.push(`duplicate version numbers: ${numbers.join(',')}`);
  }

  return violations;
}

describe('query + version lifecycle invariants', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    cacheManager = new MemoryCacheManager();
    await cacheManager.loadAll();
    await cacheManager.create(
      { $id: LIBRARY_ID, '@type': 'Library', name: 'Lifecycle' } as never,
      'Library' as never
    );
    app = await buildTestApp();
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  async function createQuery(name: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/queries',
      payload: { name, isPartOf: [LIBRARY_ID] },
    });
    expect(response.statusCode, response.payload).toBe(201);
    return JSON.parse(response.payload).id as string;
  }

  async function createVersion(queryId: string, queryString: string) {
    return app.inject({
      method: 'POST',
      url: `/queries/${encodeURIComponent(queryId)}/v`,
      payload: { queryVersion: { queryString, comment: null } },
    });
  }

  /** Both the create and the fetch wrap the version, as the web client reads it. */
  function versionOf(payload: string): { id: string; version: number } {
    return JSON.parse(payload).queryVersion;
  }

  /*
   * I4, and the reason this file grew a header assertion: a new version was
   * becoming current in the store and still reading as *not* current in the
   * editor. The three invariants above all held; what did not was the trip
   * back. `GET /queries/:id` carries `ETag` and `Last-Modified` for `If-Match`,
   * and a validator with no `Cache-Control` beside it lets a cache invent a
   * freshness lifetime for the response — so the reload after a save was
   * answered by the browser, out of a copy taken before it, naming the previous
   * version as current. An invariant about stored shape is worth nothing if the
   * shape the client reads is a stale one.
   */
  it('an entity read may not be reused from a cache', async () => {
    const queryId = await createQuery('Cacheable?');
    const response = await app.inject({
      method: 'GET',
      url: `/queries/${encodeURIComponent(queryId)}`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers.etag).toBeTruthy();
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('a query with no versions has no current version', async () => {
    const queryId = await createQuery('Empty');
    expect(storedQuery(queryId)?.currentVersion ?? null).toBeNull();
    expect(checkInvariants(queryId)).toEqual([]);
  });

  it('every version created becomes the current one, and numbering stays dense', async () => {
    const queryId = await createQuery('Growing');

    for (let expected = 1; expected <= 4; expected++) {
      const response = await createVersion(queryId, `SELECT ?s${expected} WHERE { ?s${expected} ?p ?o }`);
      expect(response.statusCode, response.payload).toBe(201);

      const created = versionOf(response.payload);
      expect(created.version).toBe(expected);

      // The property the editor's save path assumes when it adopts the new
      // version without refetching the query.
      expect(storedQuery(queryId)?.currentVersion).toBe(created.id);
      expect(checkInvariants(queryId), `after v${expected}`).toEqual([]);
    }

    expect(storedVersions(queryId).map((version) => Number(version.version))).toEqual([1, 2, 3, 4]);
  });

  it('two queries do not share a version sequence', async () => {
    // Numbering is per query, so an unscoped `count + 1` would show up here as
    // the second query starting at 3.
    const first = await createQuery('First');
    const second = await createQuery('Second');

    await createVersion(first, 'SELECT ?a WHERE { ?a ?p ?o }');
    await createVersion(first, 'SELECT ?b WHERE { ?b ?p ?o }');
    const response = await createVersion(second, 'SELECT ?c WHERE { ?c ?p ?o }');

    expect(versionOf(response.payload).version).toBe(1);
    expect(checkInvariants(first)).toEqual([]);
    expect(checkInvariants(second)).toEqual([]);
  });

  it('a version that fails to create leaves the query as it was', async () => {
    const queryId = await createQuery('Rejecting');
    await createVersion(queryId, 'SELECT ?a WHERE { ?a ?p ?o }');
    const before = storedQuery(queryId)?.currentVersion;

    const rejected = await createVersion(queryId, 'this is not SPARQL at all');
    expect(rejected.statusCode).toBe(400);

    // A rejected save must not move the query on: the editor keeps its
    // draft on a failure, and would be showing it against the wrong version.
    expect(storedQuery(queryId)?.currentVersion).toBe(before);
    expect(storedVersions(queryId)).toHaveLength(1);
    expect(checkInvariants(queryId)).toEqual([]);
  });

  it('the invariants hold across every interleaving of two queries growing', async () => {
    // Enumerated rather than sampled: every order in which two queries can
    // reach three versions between them. Small enough to be exhaustive, and
    // the point is the checker running after *every* step.
    const interleavings: Array<Array<0 | 1>> = [
      [0, 0, 1],
      [0, 1, 0],
      [0, 1, 1],
      [1, 0, 0],
      [1, 0, 1],
      [1, 1, 0],
    ];

    for (const order of interleavings) {
      cacheManager = new MemoryCacheManager();
      await cacheManager.loadAll();
      await cacheManager.create(
        { $id: LIBRARY_ID, '@type': 'Library', name: 'Lifecycle' } as never,
        'Library' as never
      );

      const ids = [await createQuery('A'), await createQuery('B')];
      const counts = [0, 0];

      for (const which of order) {
        counts[which] += 1;
        const response = await createVersion(ids[which], `SELECT ?v${counts[which]} WHERE { ?v${counts[which]} ?p ?o }`);
        expect(response.statusCode, response.payload).toBe(201);
        expect(versionOf(response.payload).version).toBe(counts[which]);

        for (const id of ids) {
          expect(checkInvariants(id), `${order.join('')} :: after ${id}`).toEqual([]);
        }
      }
    }
  });

  it('no sequence of API calls changes a version once it is created', async () => {
    // The property the whole of issue #192 exists for: a version reference means
    // something only if the version it names cannot move. Stated as a sequence
    // rather than one call, because the way this used to fail was a PATCH that
    // reached the store through a different path than the one the route guarded.
    const queryId = await createQuery('Frozen');
    const created = versionOf((await createVersion(queryId, 'SELECT ?a WHERE { ?a ?p ?o }')).payload);

    const before = JSON.stringify(
      storedVersions(queryId).find((version) => version.$id === created.id)
    );

    const attempts: Array<Record<string, unknown>> = [
      { queryString: 'SELECT ?b WHERE { ?b ?p ?o }' },
      { queryType: 'https://sqlib.org/ontology#Construct' },
      { defaultBackend: 'urn:sqlib:backend:other' },
      { comment: 'fine', queryString: 'SELECT ?c WHERE { ?c ?p ?o }' },
      { immutable: false },
    ];

    for (const payload of attempts) {
      const response = await app.inject({
        method: 'PATCH',
        url: `/queries/${encodeURIComponent(queryId)}/v/${created.version}`,
        payload,
      });
      expect(response.statusCode, `${JSON.stringify(payload)} -> ${response.payload}`).toBe(409);
      expect(
        JSON.stringify(storedVersions(queryId).find((version) => version.$id === created.id)),
        `${JSON.stringify(payload)} changed the stored version`
      ).toBe(before);
      expect(checkInvariants(queryId)).toEqual([]);
    }
  });

  it('a version is frozen the moment it is created', async () => {
    const queryId = await createQuery('BornFrozen');
    const created = versionOf((await createVersion(queryId, 'SELECT ?a WHERE { ?a ?p ?o }')).payload);
    const stored = storedVersions(queryId).find((version) => version.$id === created.id) as
      | (StoredVersion & { immutable?: boolean })
      | undefined;

    expect(stored?.immutable).toBe(true);
  });

  it('the comment stays writable, because it is about the snapshot rather than part of it', async () => {
    // Correcting a version comment invalidates no compatibility check, and a
    // typo that could never be fixed would buy nothing.
    const queryId = await createQuery('Annotated');
    const created = versionOf((await createVersion(queryId, 'SELECT ?a WHERE { ?a ?p ?o }')).payload);

    const response = await app.inject({
      method: 'PATCH',
      url: `/queries/${encodeURIComponent(queryId)}/v/${created.version}`,
      payload: { comment: 'the one that fixed the timeout bug' },
    });

    expect(response.statusCode, response.payload).toBe(200);
    const stored = storedVersions(queryId).find((version) => version.$id === created.id) as
      | (StoredVersion & { comment?: string; queryString?: string })
      | undefined;
    expect(stored?.comment).toBe('the one that fixed the timeout bug');
    expect(stored?.queryString).toBe('SELECT ?a WHERE { ?a ?p ?o }');
    expect(checkInvariants(queryId)).toEqual([]);
  });

  it('a version can be fetched by the number the create call reported', async () => {
    // The editor addresses versions by number, not IRI — `?version=2` and the
    // `GET /:id/v/:version` behind it — so the number a save reports has to
    // be the number that fetches it back.
    const queryId = await createQuery('Addressable');
    const created = versionOf((await createVersion(queryId, 'SELECT ?a WHERE { ?a ?p ?o }')).payload);
    const second = versionOf((await createVersion(queryId, 'SELECT ?b WHERE { ?b ?p ?o }')).payload);

    for (const version of [created, second]) {
      const fetched = await app.inject({
        method: 'GET',
        url: `/queries/${encodeURIComponent(queryId)}/v/${version.version}`,
      });
      expect(fetched.statusCode, fetched.payload).toBe(200);
      expect(versionOf(fetched.payload).version).toBe(version.version);
    }

    const missing = await app.inject({
      method: 'GET',
      url: `/queries/${encodeURIComponent(queryId)}/v/99`,
    });
    expect(missing.statusCode).toBe(404);
  });
});
