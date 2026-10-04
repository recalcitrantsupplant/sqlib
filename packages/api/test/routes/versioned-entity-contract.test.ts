/**
 * One status-code matrix, run over every noun the versioned-entity router
 * mounts — the acceptance test for WP20 (review finding D1).
 *
 * The drift this closes was measured route by route: DELETE answering 204 for
 * a missing id in one module and 404 in the next, cascading in some and
 * orphaning in others, version PATCH honouring If-Match only for queries, a
 * 412 body that said one thing here and another there. A per-module test pins
 * a module's own answer; only the same test over every module pins that the
 * answers agree. A noun that stops going through `registerVersionedEntityRoutes`
 * and answers differently fails here by name.
 *
 * The store is a map behind the coordinator and repositories, and auth is not
 * registered (full access): the routes' own rules are what is under test, and
 * the auth suites cover who may call them.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

type Entity = Record<string, unknown> & { $id: string; '@type': string };

const store = new Map<string, Entity>();
let clock = 0;
const stamp = () => new Date(Date.UTC(2026, 0, 1, 0, 0, clock++)).toISOString();

const coordinator = {
  get: (id: string) => store.get(id) ?? null,
  list: (type: string) => [...store.values()].filter(entity => entity['@type'] === type),
  create: async (type: string, entity: Record<string, unknown>) => {
    const created = { ...entity, '@type': type, dateModified: stamp() } as Entity;
    store.set(created.$id, created);
    return created;
  },
  update: async (type: string, id: string, updates: Record<string, unknown>) => {
    const current = store.get(id);
    if (!current || current['@type'] !== type) return null;
    const next = { ...current, ...updates, dateModified: stamp() } as Entity;
    store.set(id, next);
    return next;
  },
  delete: async (_type: string, id: string) => {
    store.delete(id);
  },
};

const repo = (type: string) => ({
  get: (id: string) => (store.get(id)?.['@type'] === type ? store.get(id)! : null),
  list: () => coordinator.list(type),
  create: (entity: Record<string, unknown>) => coordinator.create(type, entity),
  update: (id: string, updates: Record<string, unknown>) => coordinator.update(type, id, updates),
  delete: (id: string) => coordinator.delete(type, id),
});

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => coordinator,
  getEntityRepositories: () => new Proxy({}, { get: (_target, type) => repo(String(type)) }),
});

interface Noun {
  path: string;
  plugin: () => Promise<{ default: unknown }>;
  type: string;
  versionType: string;
  /** Query groups store one library IRI; every other noun a list. */
  single?: boolean;
}

const NOUNS: Noun[] = [
  { path: 'queries', plugin: () => import('../../src/routes/queries.js'), type: 'Query', versionType: 'QueryVersion' },
  { path: 'query-groups', plugin: () => import('../../src/routes/query-groups.js'), type: 'QueryGroup', versionType: 'QueryGroupVersion', single: true },
  { path: 'rules', plugin: () => import('../../src/routes/rules.js'), type: 'Rule', versionType: 'RuleVersion' },
  { path: 'rule-sets', plugin: () => import('../../src/routes/rule-sets.js'), type: 'RuleSet', versionType: 'RuleSetVersion' },
  { path: 'data-blocks', plugin: () => import('../../src/routes/data-blocks.js'), type: 'DataBlock', versionType: 'DataBlockVersion' },
  { path: 'data-graphs', plugin: () => import('../../src/routes/data-graphs.js'), type: 'DataGraph', versionType: 'DataGraphVersion' },
  { path: 'tuple-sets', plugin: () => import('../../src/routes/tuple-sets.js'), type: 'TupleSet', versionType: 'TupleSetVersion' },
  { path: 'tests', plugin: () => import('../../src/routes/tests.js'), type: 'Test', versionType: 'TestVersion' },
];

const LIBRARY = 'urn:sqlib:library:contract';
const MISSING = encodeURIComponent('urn:sqlib:missing:nothing');

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify({ logger: false });
  setupValidator(app);
  for (const schema of Object.values(schemas)) {
    if (schema && typeof schema === 'object' && '$id' in schema) app.addSchema(schema as never);
  }
  for (const noun of NOUNS) {
    await app.register((await noun.plugin()).default as never, { prefix: `/${noun.path}` });
  }
  await app.ready();
});

afterAll(async () => {
  await app.close();
  overrideCacheCoordinatorProvider(null);
});

beforeEach(() => {
  store.clear();
  store.set(LIBRARY, { $id: LIBRARY, '@type': 'Library', name: 'Contract' });
});

/** A stored entity with versions 1 and 2, v2 current. */
function seed(noun: Noun): { id: string; url: string; v1: string; v2: string } {
  const id = `urn:sqlib:${noun.path}:seeded`;
  const v1 = `${id}:v1`;
  const v2 = `${id}:v2`;
  store.set(id, {
    $id: id, '@type': noun.type, name: 'Seeded', isPartOf: noun.single ? LIBRARY : [LIBRARY],
    currentVersion: v2, dateModified: stamp(),
    // A test's subject; ignored by every other noun.
    subject: 'urn:sqlib:query:subject', subjectKind: 'query',
  });
  for (const [versionId, number] of [[v1, 1], [v2, 2]] as const) {
    store.set(versionId, {
      $id: versionId, '@type': noun.versionType, isPartOf: id, version: number, immutable: true,
      dateModified: stamp(),
      // The content field each noun's response schema requires; the others
      // are dropped by the serializer.
      queryString: 'SELECT * WHERE { ?s ?p ?o }', ruleString: '', dataString: '',
      contentString: '', contentFormat: 'text/turtle', expectationKind: 'smoke',
    });
  }
  return { id, url: `/${noun.path}/${encodeURIComponent(id)}`, v1, v2 };
}

/** A saved rule set version naming `versionId`, which pins it. */
function pin(versionId: string) {
  store.set('urn:sqlib:rule-set:holder', { $id: 'urn:sqlib:rule-set:holder', '@type': 'RuleSet', name: 'Holder', isPartOf: [LIBRARY] });
  store.set('urn:sqlib:rule-set:holder:v1', {
    $id: 'urn:sqlib:rule-set:holder:v1', '@type': 'RuleSetVersion', isPartOf: 'urn:sqlib:rule-set:holder',
    version: 1, hasRule: [versionId],
  });
}

const inject = (method: 'GET' | 'PUT' | 'PATCH' | 'DELETE' | 'POST', url: string, payload?: object, headers?: Record<string, string>) =>
  app.inject({ method, url, payload, headers });

describe.each(NOUNS)('/$path', noun => {
  it('answers 404 for a missing entity on every route, DELETE included', async () => {
    const base = `/${noun.path}/${MISSING}`;
    expect((await inject('GET', base)).statusCode).toBe(404);
    expect((await inject('PUT', base, { name: 'x' })).statusCode).toBe(404);
    expect((await inject('DELETE', base)).statusCode).toBe(404);
    expect((await inject('GET', `${base}/versions`)).statusCode).toBe(404);
    expect((await inject('GET', `${base}/versions/1`)).statusCode).toBe(404);
    expect((await inject('PATCH', `${base}/versions/1`, { comment: 'x' })).statusCode).toBe(404);
    expect((await inject('DELETE', `${base}/versions/1`)).statusCode).toBe(404);
  });

  it('answers 400 for a version that is not a number and 404 for one that does not exist', async () => {
    const { url } = seed(noun);
    expect((await inject('GET', `${url}/versions/latest`)).statusCode).toBe(400);
    expect((await inject('GET', `${url}/versions/9`)).statusCode).toBe(404);
  });

  it('lists versions oldest first', async () => {
    const { url } = seed(noun);
    const response = await inject('GET', `${url}/versions`);
    expect(response.statusCode).toBe(200);
    expect(response.json().map((version: { version: number }) => Number(version.version))).toEqual([1, 2]);
  });

  it('answers a stale If-Match on PUT with 412 and the entity as it stands', async () => {
    const { id, url } = seed(noun);
    const response = await inject('PUT', url, { name: 'Renamed' }, { 'if-match': '"stale"' });
    expect(response.statusCode).toBe(412);
    expect(response.json()).toMatchObject({ error: 'Precondition Failed', expected: store.get(id)!.dateModified });
    expect(response.json().current).toBeTruthy();
    expect(store.get(id)!.name).toBe('Seeded');
  });

  it('answers a stale If-Match on a version PATCH with the same 412', async () => {
    const { url, v1 } = seed(noun);
    const response = await inject('PATCH', `${url}/versions/1`, { comment: 'late' }, { 'if-match': '"stale"' });
    expect(response.statusCode).toBe(412);
    expect(response.json()).toMatchObject({ error: 'Precondition Failed', expected: store.get(v1)!.dateModified });
    expect(store.get(v1)!.comment).toBeUndefined();
  });

  it('refuses to delete a version a saved version pins, naming the holder', async () => {
    const { url, v1 } = seed(noun);
    pin(v1);
    const response = await inject('DELETE', `${url}/versions/1`);
    expect(response.statusCode).toBe(409);
    expect(response.json().usedBy).toEqual([expect.objectContaining({ version: v1, holderName: 'Holder' })]);
    expect(store.has(v1)).toBe(true);
  });

  it('refuses to delete an entity while any of its versions is pinned', async () => {
    const { id, url, v1, v2 } = seed(noun);
    pin(v1);
    const response = await inject('DELETE', url);
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toMatch(/pinned by rule set Holder/);
    expect([store.has(id), store.has(v1), store.has(v2)]).toEqual([true, true, true]);
  });

  it('deletes an unpinned entity together with its versions', async () => {
    const { id, url, v1, v2 } = seed(noun);
    expect((await inject('DELETE', url)).statusCode).toBe(204);
    expect([store.has(id), store.has(v1), store.has(v2)]).toEqual([false, false, false]);
  });

  it('deletes an unpinned version and moves the current pointer off it', async () => {
    const { id, url, v1, v2 } = seed(noun);
    expect((await inject('DELETE', `${url}/versions/2`)).statusCode).toBe(204);
    expect(store.has(v2)).toBe(false);
    expect(store.get(id)!.currentVersion).toBe(v1);
  });
});
