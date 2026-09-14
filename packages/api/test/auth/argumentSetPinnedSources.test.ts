/**
 * The entities an argument set *pins*, against the real `/argument-sets` plugin.
 *
 * Swept with `argument-sets.ts` into `route-coverage.test.ts`, and found by the
 * question #483 handed on rather than the one the three sweeps before it used:
 * **does this route name a second entity in its body, and what is the caller
 * doing with it?**
 *
 * A tuple binding may pin `tupleSetVersions: [...]` and a graph binding may pin
 * `dataGraphVersionId` — IRIs of stored entities that are not the argument set
 * being written and need not live in its library. The route guard reads
 * `libraryId` off the body and checks Write *there*; nothing looked at the pins.
 * `exportRuntimePayload` then resolves both to content: `rowsFromTupleSetVersions`
 * reads the version's rows, `resolveDataGraphInput` reads the version's triples.
 *
 * So Write on a library you hold plus a Read on the export route was a way to
 * read rows and triples out of a library you hold nothing on. This is the pair
 * `POST /tuple-sets/:id/versions/from-etl` and
 * `POST /data-graphs/:id/versions/from-query` already carry — the guard checks
 * the entity being written, the handler checks the second entity the body names
 * — arriving through a third door.
 *
 * The mode is `read`, not `execute`: pinning stores no SQL and runs no query, it
 * copies stored data into a payload, which is what Read on that library governs
 * everywhere else (`GET /tuple-sets/:id/versions/:version`).
 *
 * The check sits in `ArgumentSetService.createVersion`, which is the one choke
 * point every creation path funnels through — `create` and `createForTarget`
 * both reach it via `writeSet` — so `POST /argument-sets`,
 * `POST /argument-sets/:id/v`, `POST /queries/:id/argument-sets` and
 * `POST /query-groups/:id/argument-sets` are all covered by one call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import type { AuthContext } from '../../src/auth/types.js';

const MINE = 'urn:sqlib:library:mine';
const THEIRS = 'urn:sqlib:library:theirs';

const MY_TUPLE_VERSION = 'urn:sqlib:tuplesetversion:mine-v1';
const THEIR_TUPLE_VERSION = 'urn:sqlib:tuplesetversion:theirs-v1';
const THEIR_GRAPH_VERSION = 'urn:sqlib:datagraphversion:theirs-v1';

/** Rows and triples that only a principal holding Read on `THEIRS` may see. */
const SECRET_ROW = 'classified-gauge';
const SECRET_TRIPLE = 'urn:secret:subject';

const store = vi.hoisted(() => ({ entities: new Map<string, Record<string, unknown>>() }));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getEntityRepositories: () => ({}),
  getCacheCoordinator: () => ({
    get: (id: string) => store.entities.get(id) ?? null,
    list: (type: string) =>
      [...store.entities.values()].filter(entity => entity['@type'] === type),
    create: async (type: string, entity: Record<string, unknown>) => {
      const id = String(entity.$id ?? entity.id);
      store.entities.set(id, { ...entity, $id: id, '@type': type });
      return store.entities.get(id);
    },
    update: async (_type: string, id: string, updates: Record<string, unknown>) => {
      const current = store.entities.get(id);
      if (!current) return null;
      const next = { ...current, ...updates };
      store.entities.set(id, next);
      return next;
    },
    delete: async (_type: string, id: string) => {
      store.entities.delete(id);
    },
  }),
}));

function grantsOn(library: string | null, ...modes: Array<'read' | 'write' | 'execute' | 'delete' | 'control'>): AuthContext {
  return {
    subject: 'urn:sqlib:principal:user:caller',
    principals: ['urn:sqlib:principal:user:caller', 'urn:sqlib:principal:authenticated'],
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: {
      admin: false,
      backends: new Map(),
      libraries: library ? new Map([[library, new Set(modes)]]) : new Map(),
    },
    claims: {},
    fullAccess: false,
    mode: 'required',
  };
}

/** Every mode on `MINE`, and so nothing at all on `THEIRS`. */
const mine = grantsOn(MINE, 'read', 'write', 'execute', 'delete', 'control');
/** Holds both, which is what separates "refused" from "broken". */
const both: AuthContext = {
  ...mine,
  grants: {
    admin: false,
    backends: new Map(),
    libraries: new Map([
      [MINE, new Set(['read', 'write', 'execute', 'delete', 'control'] as const)],
      [THEIRS, new Set(['read'] as const)],
    ]),
  },
};

/** What `disabled` mode hands every request: no principal, full access. */
const authDisabled: AuthContext = {
  ...mine,
  subject: 'urn:sqlib:principal:anonymous',
  principals: [],
  issuer: null,
  fullAccess: true,
  mode: 'disabled',
};

async function appAs(context: AuthContext): Promise<FastifyInstance> {
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

  const plugin = (await import('../../src/routes/argument-sets.js')).default;
  await app.register(plugin as never, { prefix: '/argument-sets' });
  await app.ready();
  return app;
}

async function inject(context: AuthContext, method: 'GET' | 'POST', url: string, payload?: object) {
  const app = await appAs(context);
  try {
    return await app.inject({ method, url, payload });
  } finally {
    await app.close();
  }
}

const rowsWith = (value: string) =>
  JSON.stringify({
    head: { vars: ['gauge'] },
    results: { bindings: [{ gauge: { type: 'literal', value } }] },
  });

beforeEach(() => {
  store.entities = new Map<string, Record<string, unknown>>([
    [MINE, { '@type': 'Library', $id: MINE, name: 'Mine' }],
    [THEIRS, { '@type': 'Library', $id: THEIRS, name: 'Theirs' }],

    ['urn:sqlib:tupleset:mine', { '@type': 'TupleSet', $id: 'urn:sqlib:tupleset:mine', isPartOf: MINE }],
    [MY_TUPLE_VERSION, {
      '@type': 'TupleSetVersion',
      $id: MY_TUPLE_VERSION,
      isPartOf: 'urn:sqlib:tupleset:mine',
      version: 1,
      tupleColumns: ['gauge'],
      contentString: rowsWith('ordinary-gauge'),
    }],

    ['urn:sqlib:tupleset:theirs', { '@type': 'TupleSet', $id: 'urn:sqlib:tupleset:theirs', isPartOf: THEIRS }],
    [THEIR_TUPLE_VERSION, {
      '@type': 'TupleSetVersion',
      $id: THEIR_TUPLE_VERSION,
      isPartOf: 'urn:sqlib:tupleset:theirs',
      version: 1,
      tupleColumns: ['gauge'],
      contentString: rowsWith(SECRET_ROW),
    }],

    ['urn:sqlib:datagraph:theirs', { '@type': 'DataGraph', $id: 'urn:sqlib:datagraph:theirs', isPartOf: THEIRS }],
    [THEIR_GRAPH_VERSION, {
      '@type': 'DataGraphVersion',
      $id: THEIR_GRAPH_VERSION,
      isPartOf: 'urn:sqlib:datagraph:theirs',
      version: 1,
      contentFormat: 'text/turtle',
      tripleCount: 1,
      contentString: `<${SECRET_TRIPLE}> <urn:secret:p> "v" .`,
    }],
  ]);
});

const tuplePin = (versionId: string) => ({
  name: 'pinned',
  libraryId: MINE,
  tupleBindings: [{ variables: ['gauge'], rows: [], tupleSetVersions: [versionId] }],
});

describe('a tuple set version pinned from a library the caller cannot read', () => {
  it('is refused at creation, and nothing is written', async () => {
    const response = await inject(mine, 'POST', '/argument-sets', tuplePin(THEIR_TUPLE_VERSION));

    expect(response.statusCode).toBe(403);
    expect([...store.entities.values()].some(e => e['@type'] === 'ArgumentSet')).toBe(false);
  });

  it('is accepted when the caller holds read on that library', async () => {
    const response = await inject(both, 'POST', '/argument-sets', tuplePin(THEIR_TUPLE_VERSION));
    expect(response.statusCode).toBe(201);
  });

  it('does not refuse a pin from the caller\'s own library', async () => {
    // The control. Without it, a check that refused everything would pass the
    // case above and say nothing.
    const response = await inject(mine, 'POST', '/argument-sets', tuplePin(MY_TUPLE_VERSION));
    expect(response.statusCode).toBe(201);
  });

  it('does not reach the export route, which is what the rows were for', async () => {
    const created = await inject(both, 'POST', '/argument-sets', tuplePin(THEIR_TUPLE_VERSION));
    const setId = created.json().id;

    // Holding read on THEIRS, the export is the rows: the pin is legitimate.
    const allowed = await inject(both, 'GET', `/argument-sets/${setId}/export`);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.body).toContain(SECRET_ROW);

    /*
     * And this is the reach being closed, stated as the export rather than the
     * create: a principal holding nothing on THEIRS may still read this set —
     * it lives in MINE — so if the pin had been allowed to be written, the rows
     * would come back here. They cannot be written, so they cannot come back.
     */
    const refused = await inject(mine, 'POST', '/argument-sets', tuplePin(THEIR_TUPLE_VERSION));
    expect(refused.statusCode).toBe(403);
  });
});

describe('a data graph version pinned from a library the caller cannot read', () => {
  const graphPin = (versionId: string) => ({
    name: 'pinned-graph',
    libraryId: MINE,
    graphBindings: [{ dataGraphVersionId: versionId }],
  });

  it('is refused at creation, and its triples do not reach an export', async () => {
    const response = await inject(mine, 'POST', '/argument-sets', graphPin(THEIR_GRAPH_VERSION));

    expect(response.statusCode).toBe(403);
    expect([...store.entities.values()].some(e => e['@type'] === 'ArgumentSet')).toBe(false);
  });

  it('is accepted when the caller holds read on that library', async () => {
    const response = await inject(both, 'POST', '/argument-sets', graphPin(THEIR_GRAPH_VERSION));
    expect(response.statusCode).toBe(201);
  });

  it('leaves inline content alone, which names no entity to check', async () => {
    const response = await inject(mine, 'POST', '/argument-sets', {
      name: 'inline-graph',
      libraryId: MINE,
      graphBindings: [{ contentString: '<urn:s> <urn:p> "o" .', contentFormat: 'text/turtle' }],
    });
    expect(response.statusCode).toBe(201);
  });
});

describe('a new version of an existing set', () => {
  /*
   * `POST /:id/v` is the second door onto the same write: the set already
   * exists in MINE, so the guard is satisfied by the path id alone and the
   * pins arrive in the body of a route that never looks at `libraryId`.
   */
  it('cannot pin what the set itself could not have been created with', async () => {
    const created = await inject(mine, 'POST', '/argument-sets', tuplePin(MY_TUPLE_VERSION));
    const setId = created.json().id;

    const refused = await inject(mine, 'POST', `/argument-sets/${setId}/v`, {
      tupleBindings: [{ variables: ['gauge'], rows: [], tupleSetVersions: [THEIR_TUPLE_VERSION] }],
    });
    expect(refused.statusCode).toBe(403);

    const allowed = await inject(both, 'POST', `/argument-sets/${setId}/v`, {
      tupleBindings: [{ variables: ['gauge'], rows: [], tupleSetVersions: [THEIR_TUPLE_VERSION] }],
    });
    expect(allowed.statusCode).toBe(201);
  });
});

describe('a pin whose owning library no longer resolves', () => {
  it('is refused rather than abstained on', async () => {
    // `requireLibraryMode(null, …)` refuses where the guard abstains — the
    // asymmetry #480 leant on, so "no resolvable library" is not a way through.
    store.entities.delete(THEIRS);

    const response = await inject(both, 'POST', '/argument-sets', tuplePin(THEIR_TUPLE_VERSION));
    expect(response.statusCode).toBe(403);
  });

  it('is refused for an id that names nothing at all', async () => {
    const response = await inject(both, 'POST', '/argument-sets', tuplePin('urn:sqlib:tuplesetversion:nowhere'));
    expect(response.statusCode).toBe(403);
  });
});

describe('disabled mode', () => {
  it('is unaffected: every pin is accepted', async () => {
    const tuple = await inject(authDisabled, 'POST', '/argument-sets', tuplePin(THEIR_TUPLE_VERSION));
    expect(tuple.statusCode).toBe(201);

    const graph = await inject(authDisabled, 'POST', '/argument-sets', {
      name: 'pinned-graph',
      libraryId: MINE,
      graphBindings: [{ dataGraphVersionId: THEIR_GRAPH_VERSION }],
    });
    expect(graph.statusCode).toBe(201);
  });
});
