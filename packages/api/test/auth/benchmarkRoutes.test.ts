/**
 * Who may see and use a benchmark experiment, against the real plugin.
 *
 * An experiment belongs to a library, and the entity guard resolves it for
 * every `/:id` route. Two shapes the guard cannot see are the handler's: an
 * experiment stored before experiments had an owner (administrator-only rather
 * than open to all), and a run, which is stored outside the cache and reaches
 * its library through the version that defined it.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import type { AuthContext, LibraryMode } from '../../src/auth/types.js';
import { installFakePersistenceAdapter } from '../support/fakePersistenceAdapter.js';

const MINE = 'urn:sqlib:library:hydrology';
const THEIRS = 'urn:sqlib:library:payroll';
const OURS = 'urn:sqlib:benchmark-experiment:flow';
const LEGACY = 'urn:sqlib:benchmark-experiment:before-owners';
const VERSION = 'urn:sqlib:benchmark-experiment-version:flow-1';
const RUN = 'urn:sqlib:benchmark-run:flow-1';

let store: Awaited<ReturnType<typeof installFakePersistenceAdapter>>;

function contextFor(modes: LibraryMode[], admin = false): AuthContext {
  return {
    subject: 'urn:sqlib:principal:user:caller',
    principals: ['urn:sqlib:principal:user:caller'],
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: { admin, backends: new Map(), libraries: new Map([[MINE, new Set(modes)]]) },
    claims: {},
    fullAccess: false,
    mode: 'required',
  };
}

const owner = contextFor(['read', 'write', 'execute', 'delete']);
const reader = contextFor(['read']);
const stranger = contextFor([]);
const admin = contextFor([], true);

async function call(context: AuthContext, method: 'GET' | 'POST' | 'DELETE', url: string, payload?: object) {
  const app = Fastify({ logger: false });
  setupValidator(app);
  for (const schema of Object.values(schemas)) {
    if (schema && typeof schema === 'object' && '$id' in schema) app.addSchema(schema);
  }
  app.setErrorHandler((error, _request, reply) => {
    reply.status((error as { statusCode?: number }).statusCode ?? 500).send({ error: error.message });
  });
  app.decorateRequest('authContext', undefined);
  app.addHook('onRequest', async request => {
    request.authContext = context;
  });
  const { default: benchmarkRoutes } = await import('../../src/routes/benchmarks.js');
  await app.register(benchmarkRoutes, { prefix: '/benchmark-experiments' });
  await app.ready();
  const response = await app.inject({ method, url, payload });
  await app.close();
  return response;
}

const at = (id: string) => `/benchmark-experiments/${encodeURIComponent(id)}`;

beforeEach(async () => {
  store = await installFakePersistenceAdapter([
    { type: 'Library', entity: { '@type': 'Library', $id: MINE } },
    { type: 'Library', entity: { '@type': 'Library', $id: THEIRS } },
    { type: 'BenchmarkExperiment', entity: { '@type': 'BenchmarkExperiment', $id: OURS, name: 'Flow', isPartOf: MINE } },
    { type: 'BenchmarkExperiment', entity: { '@type': 'BenchmarkExperiment', $id: LEGACY, name: 'Old' } },
    {
      type: 'BenchmarkExperimentVersion',
      entity: { '@type': 'BenchmarkExperimentVersion', $id: VERSION, isPartOf: OURS, version: 1 },
    },
  ]);
  // Runs are stored outside the cache, so they go in behind it.
  store.put('BenchmarkRun', {
    $id: RUN, '@type': 'BenchmarkRun', definedBy: VERSION, runStatus: 'Completed',
    tasksTotal: 0, tasksCompleted: 0, structure: 'urn:x', startedAt: '2026-01-01T00:00:00.000Z',
  });
});

afterEach(() => store.restore());

describe('GET /benchmark-experiments', () => {
  it('lists the experiments whose library the caller may read, and not unowned ones', async () => {
    const response = await call(reader, 'GET', '/benchmark-experiments');

    expect(response.statusCode, response.payload).toBe(200);
    expect(response.json().map((experiment: { id: string }) => experiment.id)).toEqual([OURS]);
  });

  it('lists nothing for a stranger', async () => {
    const response = await call(stranger, 'GET', '/benchmark-experiments');
    expect(response.json()).toEqual([]);
  });
});

describe('POST /benchmark-experiments', () => {
  it('creates inside a library the caller may write', async () => {
    const response = await call(owner, 'POST', '/benchmark-experiments', { name: 'New', isPartOf: MINE });

    expect(response.statusCode, response.payload).toBe(201);
    expect(response.json().isPartOf).toBe(MINE);
    expect(store.get(response.json().id)).toMatchObject({ name: 'New', isPartOf: MINE });
  });

  it('refuses a library the caller may only read', async () => {
    const response = await call(reader, 'POST', '/benchmark-experiments', { name: 'New', isPartOf: MINE });
    expect(response.statusCode).toBe(403);
    expect(store.all('BenchmarkExperiment')).toHaveLength(2);
  });

  it('refuses a create that names no library', async () => {
    const response = await call(owner, 'POST', '/benchmark-experiments', { name: 'New' });
    expect(response.statusCode).toBe(400);
  });
});

describe('an experiment', () => {
  it('is readable by its library\'s reader and not by a stranger', async () => {
    expect((await call(reader, 'GET', at(OURS))).statusCode).toBe(200);
    expect((await call(stranger, 'GET', at(OURS))).statusCode).toBe(403);
  });

  it('cannot be deleted by a stranger', async () => {
    expect((await call(stranger, 'DELETE', at(OURS))).statusCode).toBe(403);
    expect(store.get(OURS)).toMatchObject({ name: 'Flow' });
  });

  it('stored with no owner is administrator-only, not open', async () => {
    expect((await call(owner, 'GET', at(LEGACY))).statusCode).toBe(403);
    expect((await call(admin, 'GET', at(LEGACY))).statusCode).toBe(200);
  });
});

describe('GET /benchmark-experiments/runs/:id', () => {
  it('follows the run to its library', async () => {
    expect((await call(reader, 'GET', `/benchmark-experiments/runs/${encodeURIComponent(RUN)}`)).statusCode).toBe(200);
    expect((await call(stranger, 'GET', `/benchmark-experiments/runs/${encodeURIComponent(RUN)}`)).statusCode).toBe(403);
    expect((await call(stranger, 'GET', `/benchmark-experiments/runs/${encodeURIComponent(RUN)}/observations`)).statusCode)
      .toBe(403);
  });
});
