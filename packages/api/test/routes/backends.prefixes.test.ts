/**
 * `GET`/`POST /backends/:id/prefixes` — reading a store's own prefix map and
 * pushing to it, including who is allowed to do which.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import backendRoutes from '../../src/routes/backends.js';
import { BackendTypeIri, type LdkitBackend } from '../../src/persistence/schemas/BackendSchema.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import { AuthStore, inMemoryPersistence, setAuthStore } from '../../src/auth/AuthStore.js';
import { resetAuthConfig } from '../../src/auth/config.js';
import { resolveEffectiveGrants } from '../../src/auth/grants.js';
import type { AuthContext } from '../../src/auth/types.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

const repos = vi.hoisted(() => {
  const listRepo = () => ({
    list: vi.fn((): unknown[] => []),
    get: vi.fn((): unknown => null),
    update: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  });
  return {
    Backend: listRepo(),
    Library: listRepo(),
    Query: listRepo(),
    QueryNode: listRepo(),
    DynamicQueryNode: listRepo(),
    QueryGroup: listRepo(),
    QueryGroupVersion: listRepo(),
    BenchmarkExperiment: listRepo(),
    BenchmarkExperimentVersion: listRepo(),
  };
});

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => repos,
}));

const BACKEND = 'urn:sqlib:backend:fuseki';
const READER = 'urn:sqlib:principal:user:reader';

const fusekiBackend: LdkitBackend = {
  $id: BACKEND,
  name: 'Fuseki',
  backendType: BackendTypeIri.http,
  endpoint: 'http://store.example/ds/sparql',
};

const memoryBackend: LdkitBackend = {
  $id: 'urn:sqlib:backend:memory',
  name: 'Scratch',
  backendType: BackendTypeIri.oxigraphEphemeral,
  endpoint: '',
};

const realFetch = globalThis.fetch;
const url = `/backends/${encodeURIComponent(BACKEND)}/prefixes`;

/** Answer per URL suffix; anything else 404s, as a dataset without the service would. */
function serveJena(options: { rw?: boolean; pairs?: Record<string, string> } = {}) {
  const pairs = options.pairs ?? { ex: 'http://example.org/' };
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const target = input.toString();
    calls.push({ url: target, method: init?.method ?? 'GET' });
    const path = new URL(target).pathname;
    if (path.endsWith('/prefixes-rw')) {
      if (!options.rw) return new Response('', { status: 404 });
      return init?.method && init.method !== 'GET'
        ? new Response('', { status: 200 })
        : new Response(JSON.stringify(pairs), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (path.endsWith('/prefixes')) {
      return new Response(JSON.stringify(pairs), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('', { status: 404 });
  }) as never;
  return calls;
}

/** An app whose requests carry no auth context at all — the default deployment shape. */
async function buildTestApp(principal?: string): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  setupValidator(app);
  for (const schema of Object.values(schemas)) {
    if (schema && typeof schema === 'object' && '$id' in schema) {
      app.addSchema(schema as never);
    }
  }
  if (principal) {
    app.decorateRequest('authContext', undefined);
    app.addHook('onRequest', async (request) => {
      const context: AuthContext = {
        subject: principal,
        principals: [principal],
        issuer: 'https://issuer.test/',
        tokenType: 'user',
        grants: resolveEffectiveGrants([principal], authStore),
        claims: {},
        fullAccess: false,
        mode: 'required',
      };
      (request as { authContext?: AuthContext }).authContext = context;
    });
  }
  app.setErrorHandler((error, _request, reply) => {
    reply.status((error as { statusCode?: number }).statusCode ?? 500).send({ error: error.message });
  });
  await app.register(backendRoutes, { prefix: '/backends' });
  await app.ready();
  return app;
}

let authStore: AuthStore;

describe('Backend prefix routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    for (const repo of Object.values(repos)) {
      repo.list.mockReturnValue([]);
      repo.get.mockReturnValue(null);
    }
    repos.Backend.list.mockReturnValue([fusekiBackend, memoryBackend]);
    repos.Backend.get.mockImplementation(
      (id: string) => [fusekiBackend, memoryBackend].find((backend) => backend.$id === id) ?? null
    );
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  describe('GET', () => {
    it('returns the store\'s prefix map and whether it can be written', async () => {
      serveJena({ rw: true });

      const response = await app.inject({ method: 'GET', url });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        source: 'jena-prefixes',
        readOnly: false,
        mappings: [{ prefix: 'ex', namespace: 'http://example.org/' }],
      });
    });

    it('says read-only when the dataset declares no read-write endpoint', async () => {
      serveJena({ rw: false });

      expect((await app.inject({ method: 'GET', url })).json()).toMatchObject({ readOnly: true });
    });

    it('502s when the store exposes no prefix map at all', async () => {
      globalThis.fetch = vi.fn(async () => new Response('', { status: 404 })) as never;

      const response = await app.inject({ method: 'GET', url });

      expect(response.statusCode).toBe(502);
      expect(response.json().error).toContain('no prefix map');
    });

    it('409s for an in-process store, which has no prefix map to sync with', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/backends/${encodeURIComponent(memoryBackend.$id)}/prefixes`,
      });

      expect(response.statusCode).toBe(409);
    });

    it('404s for a backend that is not there', async () => {
      const response = await app.inject({ method: 'GET', url: '/backends/urn:sqlib:backend:ghost/prefixes' });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST', () => {
    it('applies the batch and reports each item', async () => {
      const calls = serveJena({ rw: true });

      const response = await app.inject({
        method: 'POST',
        url,
        payload: { upserts: [{ prefix: 'ex', namespace: 'http://example.org/' }], deletes: ['stale'] },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ applied: 2, failed: 0 });
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(1);
      expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1);
    });

    it('counts a partial failure rather than failing the whole call', async () => {
      globalThis.fetch = vi.fn(async (input: string | URL, init?: RequestInit) => {
        const target = input.toString();
        if (init?.method === 'POST') {
          return target.includes('prefix=bad')
            ? new Response('nope', { status: 400 })
            : new Response('', { status: 200 });
        }
        return new URL(target).pathname.endsWith('/prefixes-rw')
          ? new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
          : new Response('', { status: 404 });
      }) as never;

      const response = await app.inject({
        method: 'POST',
        url,
        payload: {
          upserts: [
            { prefix: 'good', namespace: 'http://good/' },
            { prefix: 'bad', namespace: 'http://bad/' },
          ],
        },
      });

      expect(response.json()).toMatchObject({ applied: 1, failed: 1 });
      expect(response.json().results[1]).toMatchObject({ prefix: 'bad', status: 'failed' });
    });

    it('409s with what the dataset is missing when there is no writable endpoint', async () => {
      serveJena({ rw: false });

      const response = await app.inject({
        method: 'POST',
        url,
        payload: { upserts: [{ prefix: 'ex', namespace: 'http://example.org/' }] },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().error).toContain('prefixes-rw');
    });

    it('touches nothing for an empty batch', async () => {
      const calls = serveJena({ rw: true });

      const response = await app.inject({ method: 'POST', url, payload: {} });

      expect(response.json()).toEqual({ results: [], applied: 0, failed: 0 });
      expect(calls).toHaveLength(0);
    });
  });

  /*
   * Pushing rewrites someone else's dataset configuration, so it takes `write`
   * on the backend where the GET beside it takes `use`. A principal holding
   * only `use` reading the map and being refused the push is the whole point
   * of the split.
   */
  describe('authorization', () => {
    let guarded: FastifyInstance;

    beforeEach(async () => {
      // The context each request carries is what says `required`; the global
      // config stays disabled so the test needs no issuer to point at.
      resetAuthConfig({ SQLIB_AUTH_MODE: 'disabled' } as NodeJS.ProcessEnv);
      authStore = new AuthStore(inMemoryPersistence());
      await authStore.load();
      setAuthStore(authStore);
      await authStore.createGrant({
        principal: READER,
        resourceKind: 'backend',
        resource: BACKEND,
        modes: ['use'],
      });
      guarded = await buildTestApp(READER);
    });

    afterEach(async () => {
      await guarded?.close();
      setAuthStore(null);
      resetAuthConfig({ SQLIB_AUTH_MODE: 'disabled' } as NodeJS.ProcessEnv);
    });

    it('lets `use` read the prefix map', async () => {
      serveJena({ rw: true });

      expect((await guarded.inject({ method: 'GET', url })).statusCode).toBe(200);
    });

    it('refuses a push from a principal holding only `use`', async () => {
      const calls = serveJena({ rw: true });

      const response = await guarded.inject({
        method: 'POST',
        url,
        payload: { upserts: [{ prefix: 'ex', namespace: 'http://example.org/' }] },
      });

      expect(response.statusCode).toBe(403);
      expect(calls.filter((call) => call.method === 'POST')).toHaveLength(0);
    });
  });
});
