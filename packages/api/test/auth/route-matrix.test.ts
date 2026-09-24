/**
 * The route matrix (design §7.1) as an executable spec.
 *
 * A fixture of principals is run against the entity routes in `required` mode
 * and asserted against expected status codes.
 *
 * This file covers the guard *shapes*: what each combination of
 * execute/admin/exempt suffixes does to each principal. It cannot cover route
 * *coverage*, because the app it builds is a stand-in — adding a real route
 * changes nothing here. `route-coverage.test.ts` is the half that fails when
 * someone adds a route without saying who may call it; this header used to
 * claim that job and could not do it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { AuthStore, inMemoryPersistence, setAuthStore } from '../../src/auth/AuthStore.js';
import { resetAuthConfig } from '../../src/auth/config.js';
import { resolveEffectiveGrants } from '../../src/auth/grants.js';
import { registerEntityAuthGuard } from '../../src/auth/entityGuard.js';
import { requireLibraryMode } from '../../src/auth/enforce.js';
import type { AuthContext } from '../../src/auth/types.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const OWNER = 'urn:sqlib:principal:user:owner';
const READER = 'urn:sqlib:principal:user:reader';
const RUNNER = 'urn:sqlib:principal:user:runner';
const STRANGER = 'urn:sqlib:principal:user:stranger';
const ADMIN = 'urn:sqlib:principal:user:admin';

const LIBRARY = 'urn:sqlib:library:hydrology';
/**
 * A library that was deleted. `DELETE /libraries/:id` removes the library
 * entity and its grants and nothing else, so what it held stays in the cache
 * naming an id that no longer resolves.
 */
const GHOST_LIBRARY = 'urn:sqlib:library:decommissioned';
const QUERY = 'urn:sqlib:query:flow';
/** A query in that library: still stored, and now owned by nothing findable. */
const STRANDED_QUERY = 'urn:sqlib:query:stranded';
const TEST = 'urn:sqlib:test:flow-is-monotonic';
/** Account-level: no `isPartOf`, which is the whole point of the rows below. */
const BENCHMARK = 'urn:sqlib:benchmark:flow-under-load';

const entities = new Map<string, unknown>();

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({ get: (id: string) => entities.get(id) ?? null }),
  getEntityRepositories: () => ({}),
});

let store: AuthStore;

function contextFor(principal: string): AuthContext {
  return {
    subject: principal,
    principals: [principal],
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: resolveEffectiveGrants([principal], store),
    claims: {},
    fullAccess: false,
    mode: 'required',
  };
}

/**
 * A stand-in route plugin shaped like the entity routes: `:id` CRUD plus an
 * execute sub-route, guarded exactly as the real ones are.
 */
async function buildApp(principal: string | null): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  app.decorateRequest('authContext', undefined);
  app.addHook('onRequest', async request => {
    if (principal) request.authContext = contextFor(principal);
  });
  app.setErrorHandler((error, _request, reply) => {
    reply.status((error as { statusCode?: number }).statusCode ?? 500).send({ error: error.message });
  });

  await app.register(async instance => {
    registerEntityAuthGuard(instance, { executeSuffixes: ['/execute'] });

    instance.get('/:id', async () => ({ ok: true }));
    instance.put('/:id', async () => ({ ok: true }));
    instance.delete('/:id', async (_request, reply) => reply.status(204).send());
    instance.post('/:id/execute', async () => ({ ok: true }));
    instance.post('/', async (request, reply) => {
      // Creation resolves its library from the body, as the real routes do.
      const body = request.body as { isPartOf?: string[] };
      requireLibraryMode(request, body?.isPartOf?.[0] ?? null, 'write');
      return reply.status(201).send({ ok: true });
    });
  }, { prefix: '/queries' });

  /*
   * The ETL shape: two stateless helpers with no entity to resolve, one of
   * which takes arbitrary DuckDB SQL. Exempt is right for the harmless one and
   * wrong for the dangerous one — see issue #132 §4d.
   */
  await app.register(async instance => {
    registerEntityAuthGuard(instance, {
      executeSuffixes: ['/execute'],
      adminSuffixes: ['/preview'],
      exemptSuffixes: ['/analyze'],
    });

    instance.post('/preview', async () => ({ ok: true }));
    instance.post('/analyze', async () => ({ ok: true }));
  }, { prefix: '/etl-jobs' });

  // The Test shape: library-scoped like a query, with `/run` as its execute.
  await app.register(async instance => {
    registerEntityAuthGuard(instance, { executeSuffixes: ['/run'], exemptSuffixes: [] });

    instance.get('/:id', async () => ({ ok: true }));
    instance.put('/:id', async () => ({ ok: true }));
    instance.delete('/:id', async (_request, reply) => reply.status(204).send());
    instance.post('/:id/run', async () => ({ ok: true }));
  }, { prefix: '/tests' });

  /*
   * The benchmark shape: guarded identically, but over an entity with no
   * owning library. `resolveOwningLibrary` returns null, the guard abstains,
   * and `benchmarks.ts` adds no check of its own — so these rows record what
   * the deployment actually does, not what it ought to.
   */
  await app.register(async instance => {
    registerEntityAuthGuard(instance, {
      executeSuffixes: ['/execute', '/execute/stream', '/run'],
      exemptSuffixes: ['/preview'],
    });

    instance.get('/:id', async () => ({ ok: true }));
    instance.put('/:id', async () => ({ ok: true }));
    instance.delete('/:id', async (_request, reply) => reply.status(204).send());
    instance.post('/:id/v/:version/run', async () => ({ ok: true }));
  }, { prefix: '/benchmark-experiments' });

  await app.ready();
  return app;
}

beforeEach(async () => {
  resetAuthConfig({ SQLIB_AUTH_MODE: 'disabled' } as NodeJS.ProcessEnv);
  store = new AuthStore(inMemoryPersistence());
  await store.load();
  setAuthStore(store);

  entities.clear();
  entities.set(LIBRARY, { '@type': 'Library', $id: LIBRARY });
  entities.set(QUERY, { '@type': 'Query', $id: QUERY, isPartOf: [LIBRARY] });
  // Deliberately no entry for GHOST_LIBRARY: the container is named and gone.
  entities.set(STRANDED_QUERY, { '@type': 'Query', $id: STRANDED_QUERY, isPartOf: [GHOST_LIBRARY] });
  entities.set(TEST, { '@type': 'Test', $id: TEST, isPartOf: [LIBRARY] });
  // Deliberately no `isPartOf` — this is how the schema stores an experiment.
  entities.set(BENCHMARK, { '@type': 'BenchmarkExperiment', $id: BENCHMARK });

  await store.createGrant({
    principal: OWNER, resourceKind: 'library', resource: LIBRARY,
    modes: ['read', 'write', 'execute', 'delete', 'control'],
  });
  await store.createGrant({
    principal: READER, resourceKind: 'library', resource: LIBRARY, modes: ['read'],
  });
  await store.createGrant({
    principal: RUNNER, resourceKind: 'library', resource: LIBRARY, modes: ['execute'],
  });
  await store.createGrant({
    principal: ADMIN, resourceKind: 'everything', resource: 'x', modes: ['control'],
  });
});

afterEach(() => setAuthStore(null));

type Case = [name: string, principal: string, method: 'GET' | 'PUT' | 'DELETE' | 'POST', url: string, expected: number];

const MATRIX: Case[] = [
  // owner holds every mode
  ['owner reads', OWNER, 'GET', `/queries/${QUERY}`, 200],
  ['owner writes', OWNER, 'PUT', `/queries/${QUERY}`, 200],
  ['owner deletes', OWNER, 'DELETE', `/queries/${QUERY}`, 204],
  ['owner executes', OWNER, 'POST', `/queries/${QUERY}/execute`, 200],

  // reader: r only
  ['reader reads', READER, 'GET', `/queries/${QUERY}`, 200],
  ['reader cannot write', READER, 'PUT', `/queries/${QUERY}`, 403],
  ['reader cannot delete', READER, 'DELETE', `/queries/${QUERY}`, 403],
  ['reader cannot execute', READER, 'POST', `/queries/${QUERY}/execute`, 403],

  // runner: x only — deliberately independent of r (saved callables)
  ['runner executes', RUNNER, 'POST', `/queries/${QUERY}/execute`, 200],
  ['runner cannot read the definition', RUNNER, 'GET', `/queries/${QUERY}`, 403],
  ['runner cannot write', RUNNER, 'PUT', `/queries/${QUERY}`, 403],

  // stranger: nothing
  ['stranger cannot read', STRANGER, 'GET', `/queries/${QUERY}`, 403],
  ['stranger cannot execute', STRANGER, 'POST', `/queries/${QUERY}/execute`, 403],
  ['stranger cannot delete', STRANGER, 'DELETE', `/queries/${QUERY}`, 403],

  // admin: everything
  ['admin reads', ADMIN, 'GET', `/queries/${QUERY}`, 200],
  ['admin deletes', ADMIN, 'DELETE', `/queries/${QUERY}`, 204],

  /*
   * Arbitrary-SQL routes are administrator-only, not merely authenticated.
   * The owner holds every mode on the library and still cannot reach it:
   * "may do anything to my own queries" is not "may read the host filesystem".
   */
  ['owner cannot preview ETL', OWNER, 'POST', '/etl-jobs/preview', 403],
  ['reader cannot preview ETL', READER, 'POST', '/etl-jobs/preview', 403],
  ['runner cannot preview ETL', RUNNER, 'POST', '/etl-jobs/preview', 403],
  ['stranger cannot preview ETL', STRANGER, 'POST', '/etl-jobs/preview', 403],
  ['admin previews ETL', ADMIN, 'POST', '/etl-jobs/preview', 200],

  // …and an exempt helper stays exempt: the change is scoped to the SQL route.
  ['stranger reaches an exempt helper', STRANGER, 'POST', '/etl-jobs/analyze', 200],

  /*
   * Tests are library-scoped, so they behave exactly as queries do. Worth
   * stating rather than assuming: `/run` is Execute, which is independent of
   * Read, so the runner may run a test whose definition it may not read.
   */
  ['owner reads a test', OWNER, 'GET', `/tests/${TEST}`, 200],
  ['reader reads a test', READER, 'GET', `/tests/${TEST}`, 200],
  ['reader cannot write a test', READER, 'PUT', `/tests/${TEST}`, 403],
  ['reader cannot run a test', READER, 'POST', `/tests/${TEST}/run`, 403],
  ['runner runs a test', RUNNER, 'POST', `/tests/${TEST}/run`, 200],
  ['runner cannot read a test', RUNNER, 'GET', `/tests/${TEST}`, 403],
  ['stranger cannot read a test', STRANGER, 'GET', `/tests/${TEST}`, 403],
  ['stranger cannot delete a test', STRANGER, 'DELETE', `/tests/${TEST}`, 403],

  /*
   * Benchmarks: every one of these is a 200 or a 204 for a principal holding
   * no grant whatsoever, because a BenchmarkExperiment has no owning library
   * for the guard to resolve and the routes add no check of their own.
   *
   * These rows are the hole written down. They are not what the matrix wants
   * to be true; they are what is true, pinned so that giving experiments a
   * resolvable scope turns these red and says exactly which routes changed.
   * See `route-coverage.test.ts`, which counts them.
   */
  ['UNGUARDED: stranger reads a benchmark', STRANGER, 'GET', `/benchmark-experiments/${BENCHMARK}`, 200],
  ['UNGUARDED: stranger rewrites a benchmark', STRANGER, 'PUT', `/benchmark-experiments/${BENCHMARK}`, 200],
  ['UNGUARDED: stranger deletes a benchmark', STRANGER, 'DELETE', `/benchmark-experiments/${BENCHMARK}`, 204],
  ['UNGUARDED: stranger runs a benchmark', STRANGER, 'POST', `/benchmark-experiments/${BENCHMARK}/v/1/run`, 200],

  /*
   * An entity whose library is gone is the other way `resolveOwningLibrary`
   * answers null, and it is not the benchmark case above. The benchmark names
   * no container; this one names a container that no longer resolves, and
   * treating the two alike made deleting a library the way to publish what it
   * held — every entity in it reachable by anyone authenticated, on every
   * route whose handler does not re-check.
   *
   * Nobody can hold a grant on a library that is not there, so nobody but an
   * administrator gets through. The owner's row is the one that says this is a
   * denial rather than a resolution: it holds every mode on the *live* library
   * and is still refused here.
   */
  ['stranger cannot read a stranded entity', STRANGER, 'GET', `/queries/${STRANDED_QUERY}`, 403],
  ['owner cannot read a stranded entity', OWNER, 'GET', `/queries/${STRANDED_QUERY}`, 403],
  ['owner cannot delete a stranded entity', OWNER, 'DELETE', `/queries/${STRANDED_QUERY}`, 403],
  ['admin reads a stranded entity', ADMIN, 'GET', `/queries/${STRANDED_QUERY}`, 200],
  ['admin deletes a stranded entity', ADMIN, 'DELETE', `/queries/${STRANDED_QUERY}`, 204],
];

describe('entity route matrix (required mode)', () => {
  it.each(MATRIX)('%s', async (_name, principal, method, url, expected) => {
    const app = await buildApp(principal);
    const response = await app.inject({ method, url });

    expect(response.statusCode).toBe(expected);
    await app.close();
  });

  it('allows creation inside a library the caller may write', async () => {
    const app = await buildApp(OWNER);
    const response = await app.inject({
      method: 'POST', url: '/queries', payload: { isPartOf: [LIBRARY] },
    });

    expect(response.statusCode).toBe(201);
    await app.close();
  });

  it('refuses creation inside a library the caller may only read', async () => {
    const app = await buildApp(READER);
    const response = await app.inject({
      method: 'POST', url: '/queries', payload: { isPartOf: [LIBRARY] },
    });

    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it('leaves a 404 as a 404 rather than turning it into a 403', async () => {
    // Denying on an unknown id would leak existence through the status code.
    const app = await buildApp(STRANGER);
    const response = await app.inject({ method: 'GET', url: '/queries/urn:sqlib:query:nope' });

    expect(response.statusCode).toBe(200); // handler decides; the guard abstains
    await app.close();
  });

  it('applies no restriction at all when the plugin never ran', async () => {
    const app = await buildApp(null);
    expect((await app.inject({ method: 'DELETE', url: `/queries/${QUERY}` })).statusCode).toBe(204);
    await app.close();
  });
});
