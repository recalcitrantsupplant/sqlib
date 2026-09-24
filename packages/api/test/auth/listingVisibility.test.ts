/**
 * What a collection GET shows a caller, against the real plugins.
 *
 * A `/rule-sets` or `/tests` listing has no `:id` for `registerEntityAuthGuard`
 * to resolve, so the guard abstains by construction and what the caller sees is
 * the handler's decision. `/queries`, `/tuple-sets` and `/tags` make it with
 * `filterReadable`. These two made no decision at all: they listed every entity
 * of their kind in the deployment — names, descriptions, subjects, current
 * version pointers — for any authenticated principal, including one holding no
 * grant anywhere.
 *
 * `route-coverage.test.ts` had classified both as "returns what the caller may
 * see, filtered downstream", which was a claim about a handler nobody had read.
 * The classification is split now — `readable-listing` against
 * `unfiltered-listing` — and these are the rows that say which each one is.
 *
 * Not a 403: an empty array is the answer to "which of these may I see" when
 * the answer is none, and it says nothing about what exists.
 *
 * `/rules`, `/data-blocks` and `/data-graphs` join them, which is what sweeping
 * those three plugins into `route-coverage.test.ts` was for. The note left
 * there predicted the shape from a grep; all three had it. A rule carries the
 * SPARQL its library infers with, a data block the triples a rule set is tested
 * against, and a data graph the pointer to the version a `from-query` run may
 * be aimed at — so "only names and descriptions" was never the whole answer
 * either.
 *
 * `/query-groups` is the seventh and was found the same way, sweeping that
 * plugin. It is the one where the pointer matters most: a group row carries
 * `currentVersion`, and a group version is the only entity in the system whose
 * *content* is a set of references to other libraries' queries and rule sets —
 * so the collection was a way to find the group ids worth aiming
 * `GET /:id/v/:version` at, before the guard on that route had anything to say.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import type { AuthContext } from '../../src/auth/types.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const MINE = 'urn:sqlib:library:hydrology';
const THEIRS = 'urn:sqlib:library:payroll';

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
  });
  return {
    getCacheCoordinator: () => ({
      get: (id: string) => store.entities.get(id) ?? null,
      // `query-groups.ts` lists through the coordinator rather than a repo.
      list: (type: string) => byType(type),
    }),
    getEntityRepositories: () => ({
      RuleSet: repo('RuleSet'),
      RuleSetVersion: repo('RuleSetVersion'),
      Rule: repo('Rule'),
      RuleVersion: repo('RuleVersion'),
      DataBlock: repo('DataBlock'),
      DataBlockVersion: repo('DataBlockVersion'),
      DataGraph: repo('DataGraph'),
      DataGraphVersion: repo('DataGraphVersion'),
      Test: repo('Test'),
      TestVersion: repo('TestVersion'),
      TestRun: repo('TestRun'),
    }),
  };
})());

function contextFor(library: string | null): AuthContext {
  return {
    subject: 'urn:sqlib:principal:user:caller',
    principals: ['urn:sqlib:principal:user:caller', 'urn:sqlib:principal:authenticated'],
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: {
      admin: false,
      backends: new Map(),
      libraries: library ? new Map([[library, new Set(['read'] as const)]]) : new Map(),
    },
    claims: {},
    fullAccess: false,
    mode: 'required',
  };
}

const reader = contextFor(MINE);
const stranger = contextFor(null);
const authDisabled: AuthContext = {
  ...stranger,
  subject: 'urn:sqlib:principal:anonymous',
  principals: [],
  issuer: null,
  fullAccess: true,
  mode: 'disabled',
};

type Plugin = 'rule-sets' | 'tests' | 'rules' | 'data-blocks' | 'data-graphs' | 'query-groups';

async function list(context: AuthContext, plugin: Plugin, url: string) {
  const app: FastifyInstance = Fastify({ logger: false });
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
  const module = plugin === 'rule-sets'
    ? await import('../../src/routes/rule-sets.js')
    : plugin === 'tests'
      ? await import('../../src/routes/tests.js')
      : plugin === 'rules'
        ? await import('../../src/routes/rules.js')
        : plugin === 'data-blocks'
          ? await import('../../src/routes/data-blocks.js')
          : plugin === 'query-groups'
            ? await import('../../src/routes/query-groups.js')
            : await import('../../src/routes/data-graphs.js');
  await app.register(module.default as never, { prefix: `/${plugin}` });
  await app.ready();
  try {
    return await app.inject({ method: 'GET', url });
  } finally {
    await app.close();
  }
}

beforeEach(() => {
  store.entities = new Map<string, Record<string, unknown>>([
    [MINE, { '@type': 'Library', $id: MINE, name: 'Hydrology' }],
    [THEIRS, { '@type': 'Library', $id: THEIRS, name: 'Payroll' }],
    ['urn:sqlib:ruleset:mine', {
      '@type': 'RuleSet', $id: 'urn:sqlib:ruleset:mine', name: 'Gauge inference', isPartOf: [MINE],
    }],
    ['urn:sqlib:ruleset:theirs', {
      '@type': 'RuleSet', $id: 'urn:sqlib:ruleset:theirs', name: 'Salary banding', isPartOf: [THEIRS],
    }],
    ['urn:sqlib:test:mine', {
      '@type': 'Test', $id: 'urn:sqlib:test:mine', name: 'Flow is monotonic', isPartOf: [MINE],
      subject: 'urn:sqlib:query:flow', subjectKind: 'query',
    }],
    ['urn:sqlib:test:theirs', {
      '@type': 'Test', $id: 'urn:sqlib:test:theirs', name: 'Salary is not negative', isPartOf: [THEIRS],
      subject: 'urn:sqlib:query:salary', subjectKind: 'query',
    }],
    ['urn:sqlib:rule:mine', {
      '@type': 'Rule', $id: 'urn:sqlib:rule:mine', name: 'Gauge is a station', isPartOf: [MINE],
    }],
    ['urn:sqlib:rule:theirs', {
      '@type': 'Rule', $id: 'urn:sqlib:rule:theirs', name: 'Salary implies band', isPartOf: [THEIRS],
    }],
    ['urn:sqlib:datablock:mine', {
      '@type': 'DataBlock', $id: 'urn:sqlib:datablock:mine', name: 'Gauge fixtures', isPartOf: [MINE],
    }],
    ['urn:sqlib:datablock:theirs', {
      '@type': 'DataBlock', $id: 'urn:sqlib:datablock:theirs', name: 'Payroll fixtures', isPartOf: [THEIRS],
    }],
    ['urn:sqlib:datagraph:mine', {
      '@type': 'DataGraph', $id: 'urn:sqlib:datagraph:mine', name: 'Catchment graph', isPartOf: [MINE],
    }],
    ['urn:sqlib:datagraph:theirs', {
      '@type': 'DataGraph', $id: 'urn:sqlib:datagraph:theirs', name: 'Salary graph', isPartOf: [THEIRS],
      currentVersion: 'urn:sqlib:datagraph:theirs:v1',
    }],
    ['urn:sqlib:group:mine', {
      '@type': 'QueryGroup', $id: 'urn:sqlib:group:mine', name: 'Catchment rollup', isPartOf: MINE,
    }],
    ['urn:sqlib:group:theirs', {
      '@type': 'QueryGroup', $id: 'urn:sqlib:group:theirs', name: 'Payroll rollup', isPartOf: THEIRS,
      currentVersion: 'urn:sqlib:groupversion:theirs-v1',
    }],
  ]);
});

describe('GET /rule-sets', () => {
  it('shows a reader its own library and not another', async () => {
    const response = await list(reader, 'rule-sets', '/rule-sets');

    expect(response.statusCode).toBe(200);
    expect(response.json().map((item: { name: string }) => item.name)).toEqual(['Gauge inference']);
    expect(response.body).not.toContain('Salary banding');
  });

  it('shows a principal holding nothing an empty list, not a 403 and not everything', async () => {
    const response = await list(stranger, 'rule-sets', '/rule-sets');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });
});

describe('GET /tests', () => {
  it('shows a reader its own library and not another', async () => {
    const response = await list(reader, 'tests', '/tests');

    expect(response.statusCode).toBe(200);
    expect(response.json().map((item: { name: string }) => item.name)).toEqual(['Flow is monotonic']);
    expect(response.body).not.toContain('Salary is not negative');
  });

  it('filters after the querystring narrows, not instead of it', async () => {
    // `?subject=` is a search, and a search that returns another library's rows
    // is the same disclosure in a narrower shape.
    const response = await list(stranger, 'tests', '/tests?subject=urn:sqlib:query:salary');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });
});

describe('GET /rules', () => {
  it('shows a reader its own library and not another', async () => {
    const response = await list(reader, 'rules', '/rules');

    expect(response.statusCode).toBe(200);
    expect(response.json().map((item: { name: string }) => item.name)).toEqual(['Gauge is a station']);
    expect(response.body).not.toContain('Salary implies band');
  });

  it('shows a principal holding nothing an empty list, not a 403 and not everything', async () => {
    const response = await list(stranger, 'rules', '/rules');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });
});

describe('GET /data-blocks', () => {
  it('shows a reader its own library and not another', async () => {
    const response = await list(reader, 'data-blocks', '/data-blocks');

    expect(response.statusCode).toBe(200);
    expect(response.json().map((item: { name: string }) => item.name)).toEqual(['Gauge fixtures']);
    expect(response.body).not.toContain('Payroll fixtures');
  });

  it('shows a principal holding nothing an empty list', async () => {
    expect((await list(stranger, 'data-blocks', '/data-blocks')).json()).toEqual([]);
  });
});

describe('GET /data-graphs', () => {
  it('shows a reader its own library and not another', async () => {
    const response = await list(reader, 'data-graphs', '/data-graphs');

    expect(response.statusCode).toBe(200);
    expect(response.json().map((item: { name: string }) => item.name)).toEqual(['Catchment graph']);
    expect(response.body).not.toContain('Salary graph');
  });

  it('does not hand a stranger the version pointer a from-query run would take', async () => {
    // The listing carried `currentVersion`, so the collection was also a way to
    // enumerate other libraries' materialized versions by id.
    const response = await list(stranger, 'data-graphs', '/data-graphs');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
    expect(response.body).not.toContain('urn:sqlib:datagraph:theirs:v1');
  });
});

describe('GET /query-groups', () => {
  it('shows a reader its own library and not another', async () => {
    const response = await list(reader, 'query-groups', '/query-groups');

    expect(response.statusCode).toBe(200);
    expect(response.json().map((item: { name: string }) => item.name)).toEqual(['Catchment rollup']);
    expect(response.body).not.toContain('Payroll rollup');
  });

  it('does not hand a stranger the version pointer its legs are named in', async () => {
    // A group row carries `currentVersion`, and that version is the entity
    // whose content names other libraries' query versions — so the listing was
    // the way to find which group to aim `GET /:id/v/:version` at.
    const response = await list(stranger, 'query-groups', '/query-groups');

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
    expect(response.body).not.toContain('urn:sqlib:groupversion:theirs-v1');
  });
});

describe('disabled mode', () => {
  it('lists everything, as it did before', async () => {
    expect((await list(authDisabled, 'rule-sets', '/rule-sets')).json()).toHaveLength(2);
    expect((await list(authDisabled, 'tests', '/tests')).json()).toHaveLength(2);
    expect((await list(authDisabled, 'rules', '/rules')).json()).toHaveLength(2);
    expect((await list(authDisabled, 'data-blocks', '/data-blocks')).json()).toHaveLength(2);
    expect((await list(authDisabled, 'data-graphs', '/data-graphs')).json()).toHaveLength(2);
    expect((await list(authDisabled, 'query-groups', '/query-groups')).json()).toHaveLength(2);
  });
});
