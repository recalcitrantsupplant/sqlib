/**
 * Test and benchmark runs execute for their caller, not for the server.
 *
 * Both runners used to build a bare `ExecutorFactory`, which
 * `assertBackendAccess` reads as sqlib acting as itself: a caller who could run
 * a test or a benchmark reached every backend in the deployment through it,
 * and ran subjects in libraries they held nothing on. The routes now hand the
 * runners the request, and these are the two refusals that follow from it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { AuthStore, inMemoryPersistence } from '../../src/auth/AuthStore.js';
import { resolveEffectiveGrants } from '../../src/auth/grants.js';
import { AuthorizationError } from '../../src/auth/enforce.js';
import type { AuthContext } from '../../src/auth/types.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';
import { TestRunner } from '../../src/lib/TestRunner.js';
import { BenchmarkRunner } from '../../src/lib/BenchmarkRunner.js';

const ALICE = 'urn:sqlib:principal:user:alice';
const ADMIN = 'urn:sqlib:principal:user:admin';
const MINE = 'urn:sqlib:library:mine';
const THEIRS = 'urn:sqlib:library:theirs';
const BACKEND = 'urn:sqlib:backend:warehouse';

const entities = new Map<string, Record<string, unknown>>();

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({
    get: (id: string) => entities.get(id) ?? null,
    list: (type: string) => [...entities.values()].filter(entity => entity['@type'] === type),
  }),
  getEntityRepositories: () => ({}),
});

let store: AuthStore;

function requestFor(principal: string): FastifyRequest {
  const context: AuthContext = {
    subject: principal,
    principals: [principal],
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: resolveEffectiveGrants([principal], store),
    claims: {},
    fullAccess: false,
    mode: 'required',
  };
  return {
    id: 'req-1',
    method: 'POST',
    url: '/run',
    log: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
    authContext: context,
  } as unknown as FastifyRequest;
}

/** A query and its version in `library`, the version named `<query>:v1`. */
function query(id: string, library: string): string {
  entities.set(id, { '@type': 'Query', $id: id, isPartOf: [library] });
  const versionId = `${id}:v1`;
  entities.set(versionId, {
    '@type': 'QueryVersion', $id: versionId, isPartOf: id, version: 1,
    queryString: 'SELECT * WHERE { ?s ?p ?o }', immutable: true,
  });
  return versionId;
}

/** A test in MINE over `subject`, and its version, named `<test>:v1`. */
function test(id: string, subject: string, fields: Record<string, unknown> = {}): string {
  entities.set(id, { '@type': 'Test', $id: id, isPartOf: [MINE], subject, subjectKind: 'query' });
  const versionId = `${id}:v1`;
  entities.set(versionId, {
    '@type': 'TestVersion', $id: versionId, isPartOf: id, version: 1, expectationKind: 'smoke', ...fields,
  });
  return versionId;
}

beforeEach(async () => {
  store = new AuthStore(inMemoryPersistence());
  await store.load();
  entities.clear();
  entities.set(MINE, { '@type': 'Library', $id: MINE });
  entities.set(THEIRS, { '@type': 'Library', $id: THEIRS });

  await store.createGrant({
    principal: ALICE, resourceKind: 'library', resource: MINE, modes: ['read', 'write', 'execute'],
  });
  await store.createGrant({
    principal: ADMIN, resourceKind: 'everything', resource: 'x', modes: ['control'],
  });
});

describe('TestRunner under a caller', () => {
  it('refuses a test whose subject lives in a library the caller cannot execute', async () => {
    query('urn:sqlib:query:theirs', THEIRS);
    const versionId = test('urn:sqlib:test:reaches-over', 'urn:sqlib:query:theirs', { backend: BACKEND });

    await expect(new TestRunner({ request: requestFor(ALICE) }).runTestVersion(versionId))
      .rejects.toBeInstanceOf(AuthorizationError);
  });

  it('refuses a test that runs against a backend the caller may not use', async () => {
    query('urn:sqlib:query:mine', MINE);
    const versionId = test('urn:sqlib:test:uses-warehouse', 'urn:sqlib:query:mine', { backend: BACKEND });

    // A refusal for the run, not a red case blaming the subject.
    await expect(new TestRunner({ request: requestFor(ALICE) }).runTestVersion(versionId))
      .rejects.toThrow(`Missing "use" permission on backend ${BACKEND}`);
  });

  it('lets a caller who holds both through to the run itself', async () => {
    query('urn:sqlib:query:mine', MINE);
    const versionId = test('urn:sqlib:test:uses-warehouse', 'urn:sqlib:query:mine', { backend: BACKEND });

    // Past authorization, the backend not existing is the subject failing.
    const result = await new TestRunner({ request: requestFor(ADMIN) }).runTestVersion(versionId);
    expect(result.cases[0].message).toMatch(/Backend not found/);
  });
});

describe('BenchmarkRunner under a caller', () => {
  const benchmark = (subject: string) => {
    const versionId = 'urn:sqlib:benchmark-version:1';
    entities.set(BACKEND, { '@type': 'Backend', $id: BACKEND });
    entities.set(versionId, {
      '@type': 'BenchmarkExperimentVersion', $id: versionId, version: 1, immutable: true,
      subjectSpecs: JSON.stringify([{ subject, backends: [BACKEND] }]),
    });
    return versionId;
  };

  it('refuses a subject in a library the caller cannot execute', async () => {
    const versionId = benchmark(query('urn:sqlib:query:theirs', THEIRS));

    await expect(new BenchmarkRunner({ request: requestFor(ALICE) }).runExperimentVersion(versionId))
      .rejects.toBeInstanceOf(AuthorizationError);
  });

  it('refuses a backend the caller may not use, before any task runs', async () => {
    const versionId = benchmark(query('urn:sqlib:query:mine', MINE));

    await expect(new BenchmarkRunner({ request: requestFor(ALICE) }).runExperimentVersion(versionId))
      .rejects.toThrow(`Missing "use" permission on backend ${BACKEND}`);
  });
});
