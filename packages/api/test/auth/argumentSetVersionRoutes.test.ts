/**
 * The `/argument-sets` version routes, against the real plugin.
 *
 * The question the last four sweeps have asked of every version route: **does
 * the handler read the same id the guard resolved?** `registerEntityAuthGuard`
 * resolves the `:id`, walks it to a library and requires a mode there, and on a
 * cache miss it abstains — "a miss is a 404 the handler will produce", true only
 * where the handler looks that id up.
 *
 * `GET /:id/v` and `POST /:id/v` do look it up and 404. The three
 * `/:id/v/:version` routes do not: `ArgumentSetService.getVersion` matches
 * `ArgumentSetVersion` on `isPartOf` and never reads the set in the path.
 *
 * **Where this differs from `queries.ts` and `tuple-sets.ts`**, which had the
 * same shape as a live hole: no single API call is known to reach the state
 * here. `ArgumentSetService.delete` cascades to the versions, unlike
 * `repos.Query.delete`, and a set whose *library* was deleted is refused by the
 * guard's own dangling-container branch (#480) before any handler runs — the
 * third describe block below is what says so.
 *
 * So the middle block is the shape checked rather than argued out of. A cascade
 * that ever misses one, or a later route that removes a set without one, must
 * not silently become a way to read a set's bindings — and the third of these
 * routes answers with the bindings resolved to *content*, not metadata.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import type { AuthContext } from '../../src/auth/types.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const LIBRARY = 'urn:sqlib:library:hydrology';
const GHOST_LIBRARY = 'urn:sqlib:library:decommissioned';
const LIVE_SET = 'urn:sqlib:argumentset:gauges';
/** Stored, but in a library that was deleted. */
const STRANDED_SET = 'urn:sqlib:argumentset:stranded';
/** Not stored at all — the id its versions still name. */
const GHOST_SET = 'urn:sqlib:argumentset:deleted';

const SECRET_ROW = 'orphan-gauge';

const store = vi.hoisted(() => ({ entities: new Map<string, Record<string, unknown>>() }));

overrideCacheCoordinatorProvider({
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
    delete: async (_type: string, id: string) => { store.entities.delete(id); },
  }),
});

function libraryMode(...modes: Array<'read' | 'write' | 'execute' | 'delete' | 'control'>): AuthContext {
  return {
    subject: 'urn:sqlib:principal:user:caller',
    principals: ['urn:sqlib:principal:user:caller', 'urn:sqlib:principal:authenticated'],
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: {
      admin: false,
      backends: new Map(),
      libraries: modes.length ? new Map([[LIBRARY, new Set(modes)]]) : new Map(),
    },
    claims: {},
    fullAccess: false,
    mode: 'required',
  };
}

/** An authenticated principal holding nothing at all. */
const stranger = libraryMode();
const reader = libraryMode('read');
/** Every mode on the live library — and so, on no other. */
const owner = libraryMode('read', 'write', 'execute', 'delete', 'control');

/** What `disabled` mode hands every request: no principal, full access. */
const authDisabled: AuthContext = {
  ...stranger,
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

async function inject(context: AuthContext, method: 'GET' | 'PATCH', url: string, payload?: object) {
  const app = await appAs(context);
  try {
    return await app.inject({ method, url, payload });
  } finally {
    await app.close();
  }
}

/** One version of `setId`, with a tuple binding whose rows are inline. */
function seedVersion(setId: string, rowValue: string) {
  const bindingId = `${setId}:binding`;
  store.entities.set(bindingId, {
    '@type': 'ArgumentTupleBinding',
    $id: bindingId,
    isPartOf: setId,
    position: 0,
    tupleSignature: 'gauge',
    variables: ['gauge'],
    contentString: JSON.stringify({
      head: { vars: ['gauge'] },
      results: { bindings: [{ gauge: { type: 'literal', value: rowValue } }] },
    }),
  });
  store.entities.set(`${setId}:v1`, {
    '@type': 'ArgumentSetVersion',
    $id: `${setId}:v1`,
    isPartOf: setId,
    version: 1,
    tupleBindings: [bindingId],
  });
}

beforeEach(() => {
  store.entities = new Map<string, Record<string, unknown>>([
    [LIBRARY, { '@type': 'Library', $id: LIBRARY, name: 'Hydrology' }],
    [LIVE_SET, { '@type': 'ArgumentSet', $id: LIVE_SET, name: 'Gauges', isPartOf: LIBRARY }],
    // Its library is deliberately absent from the map.
    [STRANDED_SET, { '@type': 'ArgumentSet', $id: STRANDED_SET, name: 'Stranded', isPartOf: GHOST_LIBRARY }],
  ]);
  seedVersion(LIVE_SET, 'ordinary-gauge');
  seedVersion(STRANDED_SET, 'stranded-gauge');
  // The ghost set is absent while its version stays in the list.
  seedVersion(GHOST_SET, SECRET_ROW);
});

describe('a version of an argument set the caller may reach', () => {
  it('is served to a reader and refused to a stranger', async () => {
    const allowed = await inject(reader, 'GET', `/argument-sets/${LIVE_SET}/v/1`);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().version).toBe(1);

    expect((await inject(stranger, 'GET', `/argument-sets/${LIVE_SET}/v/1`)).statusCode).toBe(403);
  });

  it('takes write to annotate, not read', async () => {
    // The body is empty because every content field is refused with a 409; what
    // is being asserted is which check answers first.
    expect((await inject(reader, 'PATCH', `/argument-sets/${LIVE_SET}/v/1`, {})).statusCode).toBe(403);
    expect((await inject(owner, 'PATCH', `/argument-sets/${LIVE_SET}/v/1`, {})).statusCode).toBe(200);
  });

  it('exports its payload to a reader and not to a stranger', async () => {
    const allowed = await inject(reader, 'GET', `/argument-sets/${LIVE_SET}/v/1/export`);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.body).toContain('ordinary-gauge');

    expect((await inject(stranger, 'GET', `/argument-sets/${LIVE_SET}/v/1/export`)).statusCode).toBe(403);
  });
});

describe('a version whose argument set no longer resolves', () => {
  /*
   * The control: the same caller against the same plugin on a route whose
   * handler looks the set up. If this ever stops being a 404 the cases below
   * prove nothing about the version routes in particular.
   */
  it('is a 404 on the routes that read the set, not a 403', async () => {
    expect((await inject(stranger, 'GET', `/argument-sets/${GHOST_SET}/v`)).statusCode).toBe(404);
  });

  it('is not readable by a principal holding nothing', async () => {
    const response = await inject(stranger, 'GET', `/argument-sets/${GHOST_SET}/v/1`);
    expect(response.statusCode).toBe(403);
  });

  it('is not readable by a principal holding every mode on another library', async () => {
    // The version resolves to no library at all, and `requireLibraryMode(null)`
    // refuses rather than abstains — so a grant elsewhere reaches nothing here.
    expect((await inject(owner, 'GET', `/argument-sets/${GHOST_SET}/v/1`)).statusCode).toBe(403);
  });

  it('cannot be annotated', async () => {
    expect((await inject(owner, 'PATCH', `/argument-sets/${GHOST_SET}/v/1`, {})).statusCode).toBe(403);
  });

  it('does not export its bindings, which is the route that answers with content', async () => {
    const response = await inject(owner, 'GET', `/argument-sets/${GHOST_SET}/v/1/export`);

    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain(SECRET_ROW);
  });
});

describe('an argument set whose library was deleted', () => {
  it('is refused on the entity route, which the guard alone protects', async () => {
    expect((await inject(stranger, 'GET', `/argument-sets/${STRANDED_SET}`)).statusCode).toBe(403);
  });

  it('is refused on the version routes too, for every principal below admin', async () => {
    expect((await inject(stranger, 'GET', `/argument-sets/${STRANDED_SET}/v/1`)).statusCode).toBe(403);
    expect((await inject(owner, 'GET', `/argument-sets/${STRANDED_SET}/v`)).statusCode).toBe(403);
    expect((await inject(owner, 'GET', `/argument-sets/${STRANDED_SET}/v/1/export`)).statusCode).toBe(403);
  });
});

describe('disabled mode', () => {
  it('is unaffected: every version route answers', async () => {
    expect((await inject(authDisabled, 'GET', `/argument-sets/${LIVE_SET}/v/1`)).statusCode).toBe(200);
    expect((await inject(authDisabled, 'GET', `/argument-sets/${STRANDED_SET}/v/1`)).statusCode).toBe(200);
    expect((await inject(authDisabled, 'GET', `/argument-sets/${GHOST_SET}/v/1`)).statusCode).toBe(200);
    expect((await inject(authDisabled, 'GET', `/argument-sets/${GHOST_SET}/v/1/export`)).statusCode).toBe(200);
  });
});
