/**
 * Graph policies: a backend's policy query decides which graphs a caller may
 * read, every read is narrowed to them, and anything that goes wrong refuses
 * rather than opening up.
 *
 * Two real Oxigraph stores stand in for the auth backend and the data
 * backend, so the policy and the narrowed reads are real SPARQL.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import * as oxigraph from 'oxigraph';
import { AuthStore, inMemoryPersistence } from '../../src/auth/AuthStore.js';
import { resolveEffectiveGrants } from '../../src/auth/grants.js';
import { AuthorizationError } from '../../src/auth/enforce.js';
import { resetAuthConfig } from '../../src/auth/config.js';
import type { AuthContext, AuthMode } from '../../src/auth/types.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';
import { OxigraphSparqlExecutor } from '../../src/server/OxigraphSparqlExecutor.js';
import { GuardedSparqlExecutor, SERVICE_UNDER_POLICY_WARNING } from '../../src/auth/GuardedSparqlExecutor.js';
import {
  GraphPolicyError,
  bindPolicySubject,
  clearGraphPolicyCache,
  datasetFromPolicyResult,
  graphPolicyQueryProblem,
  mentionsService,
  setGraphPolicyRunner,
} from '../../src/auth/graphPolicy.js';
import { assertBackendAccess } from '../../src/auth/executionScope.js';

const EX = 'http://example.org/';
const ALICE = 'urn:sqlib:principal:user:alice';
const BOB = 'urn:sqlib:principal:user:bob';
const TEAM_A = 'urn:sqlib:principal:group:team-a';
const ADMIN = 'urn:sqlib:principal:user:admin';
const DATA = 'urn:sqlib:backend:data';
const AUTH = 'urn:sqlib:backend:auth';
const POLICY = 'urn:sqlib:query-version:policy';

const POLICY_TEXT = `
  PREFIX acl: <${EX}acl#>
  SELECT ?graph WHERE {
    { VALUES ?authGroup { UNDEF } ?grant acl:group ?authGroup ; acl:graph ?graph }
    UNION
    { VALUES ?authUser { UNDEF } ?grant acl:user ?authUser ; acl:graph ?graph }
  }
`;

const entities = new Map<string, unknown>();
overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({ get: (id: string) => entities.get(id) ?? null }),
  getEntityRepositories: () => ({}),
});

let grants: AuthStore;
let authExecutor: OxigraphSparqlExecutor;
let dataExecutor: OxigraphSparqlExecutor;

function contextFor(principals: string[], mode: AuthMode = 'required'): AuthContext {
  return {
    subject: principals[0],
    principals,
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: resolveEffectiveGrants(principals, grants),
    claims: {},
    fullAccess: false,
    mode,
  };
}

function requestFor(context: AuthContext): FastifyRequest {
  return {
    id: 'req-1',
    method: 'POST',
    url: '/sparql',
    log: { warn: vi.fn(), debug: vi.fn(), error: vi.fn(), info: vi.fn() },
    authContext: context,
  } as unknown as FastifyRequest;
}

function guarded(principals: string[], options: { mode?: AuthMode; onWarning?: (m: string) => void } = {}) {
  return new GuardedSparqlExecutor(dataExecutor, {
    request: requestFor(contextFor(principals, options.mode)),
    backendId: DATA,
    source: 'adhoc',
    onWarning: options.onWarning,
  });
}

/** The `?o` values a read returns, sorted. */
async function read(executor: GuardedSparqlExecutor, dataset?: { defaultGraphs?: string[]; namedGraphs?: string[] }) {
  const { result } = await executor.selectQueryParsed(
    `PREFIX ex: <${EX}> SELECT ?o WHERE { { ?s ex:p ?o } UNION { GRAPH ?g { ?s ex:p ?o } } }`,
    { dataset },
  );
  const bindings = (result as { results: { bindings: Array<{ o?: { value: string } }> } }).results.bindings;
  return [...new Set(bindings.map(row => row.o?.value).filter(Boolean))].sort();
}

beforeEach(async () => {
  resetAuthConfig({ SQLIB_AUTH_MODE: 'disabled' } as NodeJS.ProcessEnv);
  clearGraphPolicyCache();

  grants = new AuthStore(inMemoryPersistence());
  await grants.load();
  for (const principal of [ALICE, BOB, TEAM_A]) {
    await grants.createGrant({ principal, resourceKind: 'backend', resource: DATA, modes: ['query:adhoc'] });
  }
  await grants.createGrant({ principal: ADMIN, resourceKind: 'everything', resource: 'x', modes: ['control'] });

  const authStore = new oxigraph.Store();
  authStore.load(`
    @prefix acl: <${EX}acl#> .
    @prefix ex: <${EX}> .
    [] acl:group <${TEAM_A}> ; acl:graph ex:g1 .
    [] acl:user <${BOB}> ; acl:graph ex:g3 .
  `, { format: 'text/turtle' });
  authExecutor = new OxigraphSparqlExecutor(authStore);

  const dataStore = new oxigraph.Store();
  dataStore.load(`
    @prefix ex: <${EX}> .
    ex:g1 { ex:s1 ex:p "one" . }
    ex:g2 { ex:s2 ex:p "two" . }
    ex:g3 { ex:s3 ex:p "three" . }
  `, { format: 'application/trig' });
  dataExecutor = new OxigraphSparqlExecutor(dataStore);

  entities.clear();
  entities.set(AUTH, { '@type': 'Backend', $id: AUTH, authBackend: true });
  entities.set(DATA, { '@type': 'Backend', $id: DATA, graphPolicyQueryVersion: POLICY, graphPolicyBackend: AUTH });
  entities.set(POLICY, { '@type': 'QueryVersion', $id: POLICY, queryString: POLICY_TEXT });

  setGraphPolicyRunner(async (backendId, queryString) => {
    expect(backendId).toBe(AUTH);
    return (await authExecutor.selectQueryParsed(queryString)).result;
  });
});

afterEach(() => {
  setGraphPolicyRunner(null);
});

describe('graph policy reads', () => {
  it('narrows a read to the graphs the caller\'s groups are granted', async () => {
    expect(await read(guarded([ALICE, TEAM_A]))).toEqual(['one']);
  });

  it('reads a per-user rule through ?authUser', async () => {
    expect(await read(guarded([BOB]))).toEqual(['three']);
  });

  it('gives a caller with no matching rule no graphs, not every graph', async () => {
    expect(await read(guarded([ALICE]))).toEqual([]);
  });

  it('intersects the caller\'s own dataset, so a caller can narrow but not widen', async () => {
    expect(await read(guarded([ALICE, TEAM_A]), { defaultGraphs: [`${EX}g1`, `${EX}g2`], namedGraphs: [`${EX}g2`] }))
      .toEqual(['one']);
    expect(await read(guarded([ALICE, TEAM_A]), { defaultGraphs: [`${EX}g2`], namedGraphs: [] })).toEqual([]);
  });

  it('does not police an administrator', async () => {
    expect(await read(guarded([ADMIN]))).toEqual(['one', 'three', 'two']);
  });

  it('leaves a backend without a policy unrestricted', async () => {
    entities.set(DATA, { '@type': 'Backend', $id: DATA });
    expect(await read(guarded([ALICE]))).toEqual(['one', 'three', 'two']);
  });

  it('fails closed when the policy cannot run', async () => {
    setGraphPolicyRunner(async () => { throw new Error('auth backend down'); });
    await expect(read(guarded([ALICE, TEAM_A]))).rejects.toBeInstanceOf(GraphPolicyError);
  });

  it('fails closed when the policy names a backend that is not an auth backend', async () => {
    entities.set(AUTH, { '@type': 'Backend', $id: AUTH });
    await expect(read(guarded([ALICE, TEAM_A]))).rejects.toBeInstanceOf(GraphPolicyError);
  });

  it('keeps the policy\'s error out of the message a caller sees', async () => {
    setGraphPolicyRunner(async () => { throw new Error('secret detail'); });
    await expect(read(guarded([ALICE, TEAM_A]))).rejects.not.toThrow(/secret detail/);
  });

  it('only audits in dry-run, and reads unnarrowed', async () => {
    expect(await read(guarded([ALICE], { mode: 'dry-run' }))).toEqual(['one', 'three', 'two']);
  });

  it('warns, and still runs, when a policed read uses SERVICE', async () => {
    const onWarning = vi.fn();
    const executor = guarded([ALICE, TEAM_A], { onWarning });
    await executor.askQuery(`ASK { OPTIONAL { SERVICE <http://elsewhere/sparql> { ?s ?p ?o } } }`).catch(() => undefined);
    expect(onWarning).toHaveBeenCalledWith(SERVICE_UNDER_POLICY_WARNING);
  });

  it('caches per caller, and a cleared cache sees a changed policy', async () => {
    const runner = vi.fn(async (_backend: string, text: string) => (await authExecutor.selectQueryParsed(text)).result);
    setGraphPolicyRunner(runner);
    await read(guarded([ALICE, TEAM_A]));
    await read(guarded([ALICE, TEAM_A]));
    expect(runner).toHaveBeenCalledTimes(1);
    clearGraphPolicyCache();
    await read(guarded([ALICE, TEAM_A]));
    expect(runner).toHaveBeenCalledTimes(2);
  });
});

describe('backend modes on the guarded executor', () => {
  it('refuses ad-hoc text to a caller holding only query:saved', async () => {
    await grants.createGrant({ principal: 'urn:sqlib:principal:user:carol', resourceKind: 'backend', resource: DATA, modes: ['query:saved'] });
    await expect(read(guarded(['urn:sqlib:principal:user:carol']))).rejects.toBeInstanceOf(AuthorizationError);
  });

  it('refuses an update to a caller holding only query modes', async () => {
    await expect(guarded([ALICE, TEAM_A]).update(`INSERT DATA { <urn:a> <urn:b> <urn:c> }`))
      .rejects.toBeInstanceOf(AuthorizationError);
  });

  it('lets update:adhoc run ad-hoc and saved updates, and update:saved only saved ones', async () => {
    const carol = 'urn:sqlib:principal:user:carol';
    await grants.createGrant({ principal: carol, resourceKind: 'backend', resource: DATA, modes: ['update:saved'] });
    const saved = new GuardedSparqlExecutor(dataExecutor, { request: requestFor(contextFor([carol])), backendId: DATA, source: 'saved' });
    await expect(saved.update(`INSERT DATA { <urn:a> <urn:b> <urn:c> }`)).resolves.toBeDefined();
    const adhoc = new GuardedSparqlExecutor(dataExecutor, { request: requestFor(contextFor([carol])), backendId: DATA, source: 'adhoc' });
    await expect(adhoc.update(`INSERT DATA { <urn:a> <urn:b> <urn:d> }`)).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe('the auth backend', () => {
  it('is refused to a caller, even one holding a grant on it', async () => {
    await grants.createGrant({ principal: ALICE, resourceKind: 'backend', resource: AUTH, modes: ['query:adhoc'] });
    expect(() => assertBackendAccess({ request: requestFor(contextFor([ALICE])) }, AUTH)).toThrow(AuthorizationError);
  });

  it('is reachable by an administrator', () => {
    expect(() => assertBackendAccess({ request: requestFor(contextFor([ADMIN])) }, AUTH)).not.toThrow();
  });
});

describe('policy query rules', () => {
  it('accepts a SELECT of reserved names with the two auth slots', () => {
    expect(graphPolicyQueryProblem(POLICY_TEXT)).toBeNull();
  });

  it('refuses other projections, other slots, and non-SELECT forms', () => {
    expect(graphPolicyQueryProblem('SELECT ?g WHERE { GRAPH ?g {} }')).toMatch(/only \?graph/);
    expect(graphPolicyQueryProblem('SELECT ?graph WHERE { VALUES ?team { UNDEF } ?team <urn:p> ?graph }')).toMatch(/only the slots/);
    expect(graphPolicyQueryProblem('ASK { ?s ?p ?o }')).toMatch(/SELECT/);
  });

  it('binds zero ?authGroup rows for a caller with no groups, matching nothing', () => {
    const bound = bindPolicySubject(POLICY_TEXT, { user: ALICE, groups: [] });
    expect(bound).not.toMatch(/UNDEF/);
  });

  it('reads both parts from ?graph, and one part from each specific name', () => {
    const dataset = datasetFromPolicyResult({
      head: { vars: ['graph', 'defaultGraph', 'namedGraph'] },
      results: {
        bindings: [
          { graph: { type: 'uri', value: 'urn:g:both' } },
          { defaultGraph: { type: 'uri', value: 'urn:g:default' } },
          { namedGraph: { type: 'uri', value: 'urn:g:named' } },
          { namedGraph: { type: 'literal', value: 'not a graph' } },
        ],
      },
    });
    expect(dataset).toEqual({
      defaultGraphs: ['urn:g:both', 'urn:g:default'],
      namedGraphs: ['urn:g:both', 'urn:g:named'],
    });
  });

  it('spots SERVICE outside comments, strings and IRIs', () => {
    expect(mentionsService('SELECT * { SERVICE <http://x/> { ?s ?p ?o } }')).toBe(true);
    expect(mentionsService('SELECT * { ?s ?p "service" } # SERVICE')).toBe(false);
    expect(mentionsService('SELECT * { ?s <http://x/SERVICE> ?o }')).toBe(false);
  });
});
