/**
 * Creating a test is composing a standing request to execute its subject.
 *
 * The entity guard checks `write` on the library the test goes into. It cannot
 * see the subject, which may live in another library, nor the backend a version
 * names, which every run of it will reach. Both are the handler's checks: a
 * test over a subject the author could not run, or against a backend they may
 * not use, would have the next runner do it for them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import type { AuthContext, LibraryMode } from '../../src/auth/types.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const MINE = 'urn:sqlib:library:hydrology';
const THEIRS = 'urn:sqlib:library:payroll';
const MY_QUERY = 'urn:sqlib:query:flow';
const THEIR_QUERY = 'urn:sqlib:query:salaries';
const MY_TEST = 'urn:sqlib:test:flow';
const BACKEND = 'urn:sqlib:backend:warehouse';

const store = vi.hoisted(() => ({ entities: new Map<string, Record<string, unknown>>() }));

const byType = (type: string) =>
  [...store.entities.values()].filter(entity => entity['@type'] === type);

overrideCacheCoordinatorProvider((() => {
  const repo = (type: string) => ({
    get: (id: string) => {
      const entity = store.entities.get(id);
      return entity && entity['@type'] === type ? entity : null;
    },
    list: () => byType(type),
    create: async (entity: Record<string, unknown>) => {
      const stored = { ...entity, '@type': type, dateModified: new Date().toISOString() };
      store.entities.set(entity.$id as string, stored);
      return stored;
    },
  });
  return {
    getCacheCoordinator: () => ({
      get: (id: string) => store.entities.get(id) ?? null,
      list: (type: string) => byType(type),
    }),
    getEntityRepositories: () => ({
      Test: repo('Test'),
      TestVersion: repo('TestVersion'),
      TestCase: repo('TestCase'),
    }),
  };
})());

const caller: AuthContext = {
  subject: 'urn:sqlib:principal:user:caller',
  principals: ['urn:sqlib:principal:user:caller'],
  issuer: 'https://issuer.test/',
  tokenType: 'user',
  grants: {
    admin: false,
    backends: new Map(),
    libraries: new Map([[MINE, new Set<LibraryMode>(['read', 'write', 'execute'])]]),
  },
  claims: {},
  fullAccess: false,
  mode: 'required',
};

async function post(url: string, payload: Record<string, unknown>) {
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
    request.authContext = caller;
  });
  const { default: testRoutes } = await import('../../src/routes/tests.js');
  await app.register(testRoutes, { prefix: '/tests' });
  await app.ready();
  const response = await app.inject({ method: 'POST', url, payload });
  await app.close();
  return response;
}

beforeEach(() => {
  store.entities.clear();
  store.entities.set(MINE, { '@type': 'Library', $id: MINE });
  store.entities.set(THEIRS, { '@type': 'Library', $id: THEIRS });
  store.entities.set(MY_QUERY, { '@type': 'Query', $id: MY_QUERY, isPartOf: [MINE] });
  store.entities.set(THEIR_QUERY, { '@type': 'Query', $id: THEIR_QUERY, isPartOf: [THEIRS] });
  store.entities.set(MY_TEST, {
    '@type': 'Test', $id: MY_TEST, isPartOf: [MINE], subject: MY_QUERY, subjectKind: 'query',
  });
});

describe('POST /tests', () => {
  it('refuses a subject in a library the author cannot execute', async () => {
    const response = await post('/tests', {
      name: 'reaches over', isPartOf: [MINE], subject: THEIR_QUERY, subjectKind: 'query',
    });

    expect(response.statusCode, response.payload).toBe(403);
    expect(byType('Test')).toHaveLength(1);
  });

  it('creates a test over a subject the author can execute', async () => {
    const response = await post('/tests', {
      name: 'stays home', isPartOf: [MINE], subject: MY_QUERY, subjectKind: 'query',
    });

    expect(response.statusCode, response.payload).toBe(201);
  });
});

describe('POST /tests/:id/versions', () => {
  it('refuses a backend the author may not use', async () => {
    const response = await post(`/tests/${encodeURIComponent(MY_TEST)}/versions`, {
      expectationKind: 'smoke', backend: BACKEND,
    });

    expect(response.statusCode, response.payload).toBe(403);
    expect(response.json().error).toContain(BACKEND);
    expect(byType('TestVersion')).toHaveLength(0);
  });
});
