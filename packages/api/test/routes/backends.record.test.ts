/**
 * The routes the backend record page reads: probes, environment-variable
 * presence, and usage counts.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import backendRoutes from '../../src/routes/backends.js';
import { BackendTypeIri, type LdkitBackend } from '../../src/persistence/schemas/BackendSchema.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import { clearProbeResults } from '../../src/lib/backendProbe.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const repos = vi.hoisted(() => {
  const listRepo = () => ({ list: vi.fn(() => [] as any[]), get: vi.fn(() => null as any), update: vi.fn(), create: vi.fn(), delete: vi.fn() });
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

overrideCacheCoordinatorProvider({
  getEntityRepositories: () => repos,
});

const httpBackend: LdkitBackend = {
  $id: 'urn:sqlib:backend:main',
  name: 'Main store',
  backendType: BackendTypeIri.http,
  endpoint: 'http://store.example/sparql',
  authEnvKey: 'MAIN_STORE',
} as any;

const realFetch = globalThis.fetch;

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  setupValidator(app);
  for (const schema of Object.values(schemas)) {
    if (schema && typeof schema === 'object' && '$id' in schema) {
      app.addSchema(schema as never);
    }
  }
  await app.register(backendRoutes, { prefix: '/backends' });
  await app.ready();
  return app;
}

describe('Backend record routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    clearProbeResults();
    for (const repo of Object.values(repos)) {
      repo.list.mockReturnValue([]);
      repo.get.mockReturnValue(null);
    }
    repos.Backend.list.mockReturnValue([httpBackend]);
    repos.Backend.get.mockImplementation((id: string) => (id === httpBackend.$id ? httpBackend : null));
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('SQLIB_BACKEND_')) delete process.env[key];
    }
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  describe('probes', () => {
    it('starts empty and fills in once a backend is probed', async () => {
      globalThis.fetch = vi.fn(async () => new Response('', { status: 200, headers: { server: 'Fuseki/4.9' } })) as never;

      const before = await app.inject({ method: 'GET', url: '/backends/probes' });
      expect(before.json()).toEqual({ probes: [] });

      const probe = await app.inject({ method: 'POST', url: `/backends/${encodeURIComponent(httpBackend.$id)}/probe` });
      expect(probe.statusCode).toBe(200);
      expect(probe.json()).toMatchObject({ backendId: httpBackend.$id, health: 'healthy', product: 'Fuseki/4.9' });

      const after = await app.inject({ method: 'GET', url: '/backends/probes' });
      expect(after.json().probes).toHaveLength(1);
    });

    it('keeps a short history, newest first', async () => {
      let status = 200;
      globalThis.fetch = vi.fn(async () => new Response('', { status })) as never;
      const url = `/backends/${encodeURIComponent(httpBackend.$id)}/probe`;

      await app.inject({ method: 'POST', url });
      status = 403;
      await app.inject({ method: 'POST', url });

      const history = await app.inject({
        method: 'GET',
        url: `/backends/${encodeURIComponent(httpBackend.$id)}/probe-history`,
      });

      const probes = history.json().probes;
      expect(probes).toHaveLength(2);
      expect(probes[0]).toMatchObject({ health: 'unreachable', httpStatus: 403 });
      expect(probes[0].error).toContain('403');
      expect(probes[1]).toMatchObject({ health: 'healthy', httpStatus: 200 });
    });

    it('404s probing a backend that is not there', async () => {
      const response = await app.inject({ method: 'POST', url: '/backends/urn:sqlib:backend:ghost/probe' });
      expect(response.statusCode).toBe(404);
    });

    it('probes every backend on Probe all', async () => {
      globalThis.fetch = vi.fn(async () => new Response('', { status: 200 })) as never;
      repos.Backend.list.mockReturnValue([
        httpBackend,
        { ...httpBackend, $id: 'urn:sqlib:backend:second', endpoint: 'http://second.example/sparql' },
      ]);

      const response = await app.inject({ method: 'POST', url: '/backends/probes' });

      expect(response.statusCode).toBe(200);
      expect(response.json().probes).toHaveLength(2);
    });
  });

  describe('GET /:id/env', () => {
    it('names the three variables and reports presence, never values', async () => {
      process.env.SQLIB_BACKEND_MAIN_STORE_USERNAME = 'sekrit-operator';

      const response = await app.inject({ method: 'GET', url: `/backends/${encodeURIComponent(httpBackend.$id)}/env` });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.authEnvKey).toBe('MAIN_STORE');
      expect(body.variables).toEqual([
        { name: 'SQLIB_BACKEND_MAIN_STORE_USERNAME', role: 'Basic auth username', set: true },
        { name: 'SQLIB_BACKEND_MAIN_STORE_PASSWORD', role: 'Basic auth password', set: false },
        { name: 'SQLIB_BACKEND_MAIN_STORE_AUTH_HEADER', role: 'Authorization header override', set: false },
      ]);
      expect(JSON.stringify(body)).not.toContain('sekrit-operator');
    });

    it('returns no variables when the backend has no environment key', async () => {
      repos.Backend.get.mockReturnValue({ ...httpBackend, authEnvKey: null });

      const response = await app.inject({ method: 'GET', url: `/backends/${encodeURIComponent(httpBackend.$id)}/env` });

      expect(response.json()).toEqual({ authEnvKey: null, variables: [] });
    });
  });

  describe('GET /:id/usage', () => {
    it('counts queries, libraries, groups through their current version, and benchmarks', async () => {
      repos.Query.list.mockReturnValue([
        { $id: 'q1', name: 'One', defaultBackend: httpBackend.$id },
        { $id: 'q2', name: 'Two', defaultBackend: 'urn:sqlib:backend:other' },
      ]);
      repos.Library.list.mockReturnValue([{ $id: 'lib1', name: 'Ontology QA', defaultBackend: httpBackend.$id }]);
      repos.QueryNode.list.mockReturnValue([{ $id: 'node1', backendId: httpBackend.$id }]);
      repos.DynamicQueryNode.list.mockReturnValue([{ $id: 'node2', backendId: 'urn:sqlib:backend:other' }]);
      repos.QueryGroup.list.mockReturnValue([
        { $id: 'g1', name: 'Group one', currentVersion: 'g1v2' },
        { $id: 'g2', name: 'Group two', currentVersion: 'g2v1' },
      ]);
      repos.QueryGroupVersion.get.mockImplementation((id: string) =>
        id === 'g1v2' ? { $id: id, executionNodes: ['node1'] } : { $id: id, executionNodes: ['node2'] }
      );
      repos.BenchmarkExperiment.list.mockReturnValue([{ $id: 'b1', name: 'Latency', currentVersion: 'b1v1' }]);
      repos.BenchmarkExperimentVersion.get.mockReturnValue({
        $id: 'b1v1',
        subjectSpecs: JSON.stringify([{ subject: 'q1', backends: [httpBackend.$id] }]),
      });

      const response = await app.inject({ method: 'GET', url: `/backends/${encodeURIComponent(httpBackend.$id)}/usage` });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        queries: { count: 1, sample: [{ id: 'q1', name: 'One' }] },
        queryGroups: { count: 1, sample: [{ id: 'g1', name: 'Group one' }] },
        benchmarks: { count: 1, sample: [{ id: 'b1', name: 'Latency' }] },
        libraries: { count: 1, sample: [{ id: 'lib1', name: 'Ontology QA' }] },
      });
    });

    it('treats an unparseable benchmark version as naming nothing', async () => {
      repos.BenchmarkExperiment.list.mockReturnValue([{ $id: 'b1', name: 'Latency', currentVersion: 'b1v1' }]);
      repos.BenchmarkExperimentVersion.get.mockReturnValue({ $id: 'b1v1', subjectSpecs: 'not json' });

      const response = await app.inject({ method: 'GET', url: `/backends/${encodeURIComponent(httpBackend.$id)}/usage` });

      expect(response.json().benchmarks).toEqual({ count: 0, sample: [] });
    });

    it('404s for a backend that is not there', async () => {
      const response = await app.inject({ method: 'GET', url: '/backends/urn:sqlib:backend:ghost/usage' });
      expect(response.statusCode).toBe(404);
    });
  });
});
