/**
 * `GET` and `PUT /:id/browser-defaults` — what the web app selects when a
 * callable opens.
 *
 * Through `app.inject`, because the body schema is half the contract: a
 * field the owner kind does not take is refused, and so is a target outside
 * the owner's library. The last block holds the rule that makes a browser
 * default safe to have at all — nothing that executes reads one.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

const store = new Map<string, Record<string, unknown>>();
const libraryModeCalls: Array<{ libraryId: string | null; mode: string }> = [];

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({}),
  getCacheCoordinator: () => ({
    get: (iri: string) => store.get(iri) ?? null,
    list: (type: string) => [...store.values()].filter(entity => entity['@type'] === type),
    create: async (type: string, entity: Record<string, unknown>) => {
      const id = String(entity.$id ?? entity.id);
      store.set(id, { ...entity, $id: id, '@type': type });
      return store.get(id);
    },
    update: async (_type: string, id: string, updates: Record<string, unknown>) => {
      const current = store.get(id);
      if (!current) return null;
      const next = { ...current, ...updates, dateModified: '2026-10-04T00:00:00.000Z' };
      store.set(id, next);
      return next;
    },
    delete: async (_type: string, id: string) => { store.delete(id); },
  }),
}));

vi.mock('../../src/auth/enforce.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../../src/auth/enforce.js');
  return {
    ...actual,
    requireEntityMode: (_request: unknown, entity: unknown, mode: string) => {
      const resolve = actual.resolveOwningLibrary as (entity: unknown) => string | null;
      libraryModeCalls.push({ libraryId: resolve(entity), mode });
    },
  };
});

const { registerBrowserDefaultsRoutes } = await import('../../src/routes/browser-defaults.js');
const {
  clearBrowserDefaultsIfMoved,
  clearBrowserDefaultsNaming,
  deleteBrowserDefaultsOf,
  readBrowserDefaults,
} = await import('../../src/lib/browserDefaults.js');

const LIBRARY = 'urn:sqlib:library:lib1';
const OTHER_LIBRARY = 'urn:sqlib:library:lib2';
const QUERY = 'urn:sqlib:query:q1';
const GROUP = 'urn:sqlib:query-group:g1';
const RULE_SET = 'urn:sqlib:rule-set:r1';
const SET = 'urn:sqlib:argument-set:s1';
const SET_V1 = 'urn:sqlib:argument-set-version:s1v1';
const FOREIGN_SET = 'urn:sqlib:argument-set:s2';
const GRAPH = 'urn:sqlib:data-graph:d1';
const GRAPH_V1 = 'urn:sqlib:data-graph-version:d1v1';
const GRAPH_2 = 'urn:sqlib:data-graph:d2';
const FOREIGN_GRAPH = 'urn:sqlib:data-graph:d3';

function seed() {
  store.clear();
  libraryModeCalls.length = 0;
  const put = (entity: Record<string, unknown>) => store.set(String(entity.$id), entity);
  put({ $id: LIBRARY, '@type': 'Library', name: 'Lib' });
  put({ $id: OTHER_LIBRARY, '@type': 'Library', name: 'Other' });
  put({ $id: QUERY, '@type': 'Query', name: 'Q', isPartOf: [LIBRARY] });
  put({ $id: GROUP, '@type': 'QueryGroup', name: 'G', isPartOf: LIBRARY });
  put({ $id: RULE_SET, '@type': 'RuleSet', name: 'R', isPartOf: [LIBRARY] });
  put({ $id: SET, '@type': 'ArgumentSet', name: 'S', isPartOf: LIBRARY });
  put({ $id: SET_V1, '@type': 'ArgumentSetVersion', isPartOf: SET, version: 1 });
  put({ $id: FOREIGN_SET, '@type': 'ArgumentSet', name: 'S2', isPartOf: OTHER_LIBRARY });
  put({ $id: GRAPH, '@type': 'DataGraph', name: 'D', isPartOf: [LIBRARY] });
  put({ $id: GRAPH_V1, '@type': 'DataGraphVersion', isPartOf: GRAPH, version: 1 });
  put({ $id: GRAPH_2, '@type': 'DataGraph', name: 'D2', isPartOf: [LIBRARY] });
  put({ $id: FOREIGN_GRAPH, '@type': 'DataGraph', name: 'D3', isPartOf: [OTHER_LIBRARY] });
}

const children = () => [...store.values()].filter(entity => entity['@type'] === 'BrowserDefaultDataGraph');

describe('/:id/browser-defaults', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });
    setupValidator(app);
    app.setErrorHandler((error, _request, reply) => {
      reply.status(error.statusCode || 500).send({ error: error.message });
    });
    for (const schema of Object.values(schemas)) {
      if (schema && typeof schema === 'object' && '$id' in schema) app.addSchema(schema);
    }
    await app.register(async (f) => registerBrowserDefaultsRoutes(f, 'Query'), { prefix: '/queries' });
    await app.register(async (f) => registerBrowserDefaultsRoutes(f, 'QueryGroup'), { prefix: '/query-groups' });
    await app.register(async (f) => registerBrowserDefaultsRoutes(f, 'RuleSet'), { prefix: '/rule-sets' });
    await app.ready();
  });

  afterAll(async () => { await app.close(); });
  beforeEach(() => { seed(); });

  const get = (path: string) => app.inject({ method: 'GET', url: `${path}/browser-defaults` });
  const put = (path: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'PUT', url: `${path}/browser-defaults`, payload });

  describe('reading', () => {
    it('is empty until someone sets one: a default is opt-in', async () => {
      const response = await get(`/queries/${QUERY}`);
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ argumentSet: null, dataGraphs: [] });
      expect(libraryModeCalls).toContainEqual({ libraryId: LIBRARY, mode: 'read' });
    });

    it('answers 404 for an id of another kind', async () => {
      expect((await get(`/queries/${GROUP}`)).statusCode).toBe(404);
    });
  });

  describe('a query', () => {
    it('takes an argument set, floating or pinned, and needs write', async () => {
      const floating = await put(`/queries/${QUERY}`, { argumentSet: SET });
      expect(floating.statusCode).toBe(200);
      expect(floating.json()).toEqual({ argumentSet: SET, dataGraphs: [] });
      expect(store.get(QUERY)?.browserDefaultArgumentSet).toBe(SET);
      expect(libraryModeCalls).toContainEqual({ libraryId: LIBRARY, mode: 'write' });

      const pinned = await put(`/queries/${QUERY}`, { argumentSet: SET_V1 });
      expect(pinned.json().argumentSet).toBe(SET_V1);
    });

    it('takes no data graph: its store is its backend', async () => {
      const response = await put(`/queries/${QUERY}`, { dataGraphs: [GRAPH] });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/takes no data graph/);
    });

    it('refuses an argument set from another library', async () => {
      const response = await put(`/queries/${QUERY}`, { argumentSet: FOREIGN_SET });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/not in this Query's library/);
    });

    it('refuses an id that names something else', async () => {
      const response = await put(`/queries/${QUERY}`, { argumentSet: GRAPH });
      expect(response.statusCode).toBe(400);
      expect(response.json().error).toMatch(/is not a ArgumentSet or ArgumentSetVersion/);
    });

    it('clears on {}', async () => {
      await put(`/queries/${QUERY}`, { argumentSet: SET });
      const cleared = await put(`/queries/${QUERY}`, {});
      expect(cleared.json()).toEqual({ argumentSet: null, dataGraphs: [] });
      expect(store.get(QUERY)?.browserDefaultArgumentSet).toBeNull();
    });

    it('refuses an unknown field rather than dropping it', async () => {
      expect((await put(`/queries/${QUERY}`, { argumentSets: [SET] })).statusCode).toBe(400);
    });
  });

  describe('a rule set', () => {
    it('takes one data graph', async () => {
      const response = await put(`/rule-sets/${RULE_SET}`, { dataGraphs: [GRAPH_V1] });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ argumentSet: null, dataGraphs: [GRAPH_V1] });
      expect(children()).toHaveLength(1);
      expect(children()[0]).toMatchObject({ isPartOf: RULE_SET, position: 0, dataGraph: GRAPH_V1 });
    });

    it('refuses a second graph and an argument set', async () => {
      expect((await put(`/rule-sets/${RULE_SET}`, { dataGraphs: [GRAPH, GRAPH_2] })).statusCode).toBe(400);
      const withSet = await put(`/rule-sets/${RULE_SET}`, { argumentSet: SET });
      expect(withSet.statusCode).toBe(400);
      expect(withSet.json().error).toMatch(/takes no argument set/);
    });

    it('refuses a graph from another library', async () => {
      expect((await put(`/rule-sets/${RULE_SET}`, { dataGraphs: [FOREIGN_GRAPH] })).statusCode).toBe(400);
    });
  });

  describe('a query group', () => {
    it('takes an argument set and one graph per input, keeping a hole where an input has none', async () => {
      const response = await put(`/query-groups/${GROUP}`, { argumentSet: SET, dataGraphs: [null, GRAPH] });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ argumentSet: SET, dataGraphs: [null, GRAPH] });
      expect(children()).toHaveLength(1);
      expect(children()[0]).toMatchObject({ position: 1, dataGraph: GRAPH });

      expect((await get(`/query-groups/${GROUP}`)).json()).toEqual({ argumentSet: SET, dataGraphs: [null, GRAPH] });
    });

    it('drops trailing holes, which name no input', async () => {
      const response = await put(`/query-groups/${GROUP}`, { dataGraphs: [GRAPH, null, null] });
      expect(response.json().dataGraphs).toEqual([GRAPH]);
    });

    it('replaces the whole value, leaving no stale child behind', async () => {
      await put(`/query-groups/${GROUP}`, { dataGraphs: [GRAPH, GRAPH_2] });
      await put(`/query-groups/${GROUP}`, { dataGraphs: [GRAPH_2] });
      expect(children()).toHaveLength(1);
      expect((await get(`/query-groups/${GROUP}`)).json().dataGraphs).toEqual([GRAPH_2]);
    });
  });
});

describe('cleanup', () => {
  beforeEach(() => { seed(); });

  async function seedDefaults() {
    const { validateBrowserDefaults, writeBrowserDefaults } = await import('../../src/lib/browserDefaults.js');
    const owner = (id: string) => store.get(id) as { $id: string };
    await writeBrowserDefaults('QueryGroup', owner(GROUP),
      validateBrowserDefaults('QueryGroup', owner(GROUP), { argumentSet: SET_V1, dataGraphs: [GRAPH_V1, GRAPH_2] }));
    await writeBrowserDefaults('Query', owner(QUERY),
      validateBrowserDefaults('Query', owner(QUERY), { argumentSet: SET }));
  }

  it('clears a default naming a deleted argument set or one of its versions', async () => {
    await seedDefaults();
    await clearBrowserDefaultsNaming(new Set([SET, SET_V1]));
    expect(store.get(QUERY)?.browserDefaultArgumentSet).toBeNull();
    expect(store.get(GROUP)?.browserDefaultArgumentSet).toBeNull();
  });

  it('removes a graph default naming a deleted graph version, and only that one', async () => {
    await seedDefaults();
    await clearBrowserDefaultsNaming(new Set([GRAPH, GRAPH_V1]));
    expect(readBrowserDefaults(store.get(GROUP) as { $id: string }).dataGraphs).toEqual([null, GRAPH_2]);
    expect(children()).toHaveLength(1);
  });

  it('deletes an owner\'s children with the owner', async () => {
    await seedDefaults();
    await deleteBrowserDefaultsOf(store.get(GROUP) as { $id: string });
    expect(children()).toHaveLength(0);
  });

  it('clears an owner\'s defaults when it moves to another library', async () => {
    await seedDefaults();
    const before = { ...store.get(QUERY) } as { $id: string };
    store.set(QUERY, { ...store.get(QUERY), isPartOf: [OTHER_LIBRARY] });
    const moved = await clearBrowserDefaultsIfMoved('Query', before, store.get(QUERY) as { $id: string });
    expect(moved).not.toBeNull();
    expect(store.get(QUERY)?.browserDefaultArgumentSet).toBeNull();
  });

  it('keeps them when an update leaves the library alone', async () => {
    await seedDefaults();
    const before = { ...store.get(QUERY) } as { $id: string };
    store.set(QUERY, { ...store.get(QUERY), name: 'Renamed' });
    expect(await clearBrowserDefaultsIfMoved('Query', before, store.get(QUERY) as { $id: string })).toBeNull();
    expect(store.get(QUERY)?.browserDefaultArgumentSet).toBe(SET);
  });
});

describe('the generic PUT cannot set a default', () => {
  /*
   * `@readOnly` keeps the fields off the generated update bodies, so the
   * same-library check in `PUT /:id/browser-defaults` is the only way in.
   */
  it.each([
    ['updateQuerySchema', 'browserDefaultArgumentSet'],
    ['updateQueryGroupSchema', 'browserDefaultArgumentSet'],
    ['updateQueryGroupSchema', 'browserDefaultDataGraphs'],
    ['updateRuleSetSchema', 'browserDefaultDataGraphs'],
  ])('%s has no %s', (schemaName, field) => {
    const route = (schemas as unknown as Record<string, { body?: { properties?: Record<string, unknown> } }>)[schemaName];
    expect(route?.body?.properties).toBeDefined();
    expect(route?.body?.properties).not.toHaveProperty(field);
  });
});

describe('nothing that executes reads a browser default', () => {
  /*
   * The rule the feature rests on: an empty call means "no arguments", and a
   * default someone changes in the web app must not change what a script
   * computes. So the fields are read in exactly the modules that store and
   * serve them, and a new reader elsewhere fails here by file name.
   */
  const ALLOWED = new Set([
    'browserDefaults.ts',
    'browser-defaults.ts',
    'BrowserDefaultDataGraphSchema.ts',
    'BrowserDefaultDataGraphUtils.ts',
    'QuerySchema.ts',
    'QueryGroupSchema.ts',
    'RuleSetSchema.ts',
    'schema.ts',
    'namespaces.ts',
    'schemaRegistry.ts',
    'entityTypeNames.ts',
    'EntityRegistry.ts',
    'id.ts',
  ]);

  async function sourceFiles(dir: string, out: Array<[string, string]> = []) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await sourceFiles(full, out);
      else if (entry.name.endsWith('.ts')) out.push([entry.name, await readFile(full, 'utf8')]);
    }
    return out;
  }

  /** What a file outside the stored-and-served set may name: clean-up and registration, never a field. */
  const CALLS = new Set([
    'registerBrowserDefaultsRoutes',
    'deleteBrowserDefaultsOf',
    'clearBrowserDefaultsIfMoved',
    'clearBrowserDefaultsNaming',
    'browserDefaults',
    'browser-defaults',
  ]);

  it('is read only where it is stored and served', async () => {
    const root = fileURLToPath(new URL('../../src/', import.meta.url));
    const reads: string[] = [];
    for (const [name, source] of await sourceFiles(root)) {
      if (ALLOWED.has(name)) continue;
      for (const match of source.matchAll(/[\w-]*[bB]rowser-?[dD]efault[\w-]*/g)) {
        if (!CALLS.has(match[0])) reads.push(`${name}: ${match[0]}`);
      }
    }
    expect(reads).toEqual([]);
  });
});
