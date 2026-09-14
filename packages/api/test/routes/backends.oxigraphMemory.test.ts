/**
 * Route-level validation of the `oxigraphMemory` config.
 *
 * Catching a bad source reference at write time matters because the alternative
 * is discovering it at hydration — far away from whoever wrote the config, and
 * only once something happens to query the backend.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import backendRoutes from '../../src/routes/backends.js';
import { BackendTypeIri } from '../../src/persistence/schemas/BackendSchema.js';
import { oxigraphStoreManager } from '../../src/lib/OxigraphStoreManager.js';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

const repo = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

const libraryRepo = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn() }));
const queryRepo = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn() }));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({
    Backend: repo,
    Library: libraryRepo,
    Query: queryRepo,
  }),
}));

async function buildTestApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  setupValidator(app);
  for (const schema of Object.values(schemas)) {
    if (schema && typeof schema === 'object' && '$id' in schema) {
      app.addSchema(schema);
    }
  }
  await app.register(backendRoutes, { prefix: '/backends' });
  await app.ready();
  return app;
}

function createBody(oxigraphConfig: unknown) {
  return {
    name: 'Reference data',
    backendType: 'oxigraphMemory',
    oxigraphConfig: JSON.stringify(oxigraphConfig),
  };
}

describe('POST /backends - oxigraphMemory config', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    repo.create.mockReset();
    repo.list.mockReturnValue([]);
    libraryRepo.list.mockReturnValue([]);
    queryRepo.list.mockReturnValue([]);
    repo.create.mockImplementation(async (payload: Record<string, unknown>) => ({
      ...payload,
      '@type': 'Backend',
    }));
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts a pinned source', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/backends',
      payload: createBody({
        storeType: 'ephemeral',
        mode: 'readOnly',
        sources: [{ dataGraphVersionId: 'urn:dgv:1' }],
      }),
    });

    expect(response.statusCode).toBe(201);
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({ backendType: BackendTypeIri.oxigraphMemory }),
    );
  });

  it('accepts a tracked source', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/backends',
      payload: createBody({ storeType: 'ephemeral', mode: 'durable', sources: [{ dataGraphId: 'urn:dg:1' }] }),
    });

    expect(response.statusCode).toBe(201);
  });

  it('rejects a source naming both a version and a graph', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/backends',
      payload: createBody({
        storeType: 'ephemeral',
        sources: [{ dataGraphVersionId: 'urn:dgv:1', dataGraphId: 'urn:dg:1' }],
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/not both/);
    expect(repo.create).not.toHaveBeenCalled();
  });

  it('rejects a source naming neither', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/backends',
      payload: createBody({ storeType: 'ephemeral', sources: [{}] }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/requires either/);
  });

  it('rejects an unknown mode', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/backends',
      payload: createBody({ storeType: 'ephemeral', mode: 'read-only' }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/mode must be one of/);
  });

  it('rejects sources that are not an array', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/backends',
      payload: createBody({ storeType: 'ephemeral', sources: { dataGraphId: 'urn:dg:1' } }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/must be an array/);
  });

  it('does not require the referenced ids to exist yet', async () => {
    // A backend may legitimately be created before the data graph it points at,
    // and existence is re-checked at hydration anyway.
    const response = await app.inject({
      method: 'POST',
      url: '/backends',
      payload: createBody({ storeType: 'ephemeral', sources: [{ dataGraphId: 'urn:dg:not-yet' }] }),
    });

    expect(response.statusCode).toBe(201);
  });

  it('leaves configs without memory fields alone', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/backends',
      payload: {
        name: 'Legacy ephemeral',
        backendType: 'oxigraphEphemeral',
        oxigraphConfig: JSON.stringify({ storeType: 'ephemeral', loadMethod: 'none' }),
      },
    });

    expect(response.statusCode).toBe(201);
  });
});

describe('write endpoints against a read-only memory backend', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    repo.list.mockReturnValue([]);
    libraryRepo.list.mockReturnValue([]);
    queryRepo.list.mockReturnValue([]);
  });

  afterAll(async () => {
    await app.close();
  });

  function backendWithMode(mode: string | undefined) {
    return {
      $id: 'urn:backend:ro',
      '@type': 'Backend',
      name: 'Reference data',
      backendType: BackendTypeIri.oxigraphMemory,
      oxigraphConfig: mode === undefined ? { storeType: 'ephemeral' } : { storeType: 'ephemeral', mode },
    };
  }

  it('refuses DELETE /:id/data on a read-only backend', async () => {
    repo.get.mockReturnValue(backendWithMode('readOnly'));

    const response = await app.inject({ method: 'DELETE', url: '/backends/urn:backend:ro/data' });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toMatch(/read-only/);
  });

  it('refuses a clear on a backend with no explicit mode', async () => {
    // Same default as the executor: an under-specified memory backend is
    // read-only, not writable.
    repo.get.mockReturnValue(backendWithMode(undefined));

    const response = await app.inject({ method: 'DELETE', url: '/backends/urn:backend:ro/data' });

    expect(response.statusCode).toBe(403);
  });

  it('lets a clear through on an ephemeral backend', async () => {
    repo.get.mockReturnValue(backendWithMode('ephemeral'));
    await oxigraphStoreManager.createMemoryStore('urn:backend:ro', {
      storeType: 'ephemeral',
      mode: 'ephemeral',
    });

    const response = await app.inject({ method: 'DELETE', url: '/backends/urn:backend:ro/data' });

    expect(response.statusCode).toBe(200);
    await oxigraphStoreManager.invalidateMemoryStore('urn:backend:ro');
  });

  it('still reports a non-oxigraph backend as unsupported', async () => {
    repo.get.mockReturnValue({
      $id: 'urn:backend:http',
      '@type': 'Backend',
      name: 'Remote',
      backendType: BackendTypeIri.http,
      endpoint: 'http://example.org/sparql',
    });

    const response = await app.inject({ method: 'DELETE', url: '/backends/urn:backend:http/data' });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatch(/not an in-process oxigraph backend/);
  });
});
