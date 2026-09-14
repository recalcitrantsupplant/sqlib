/**
 * The `/tuple-sets` version routes, against the real plugin.
 *
 * Same question as `queryVersionRoutes.test.ts`, asked while sweeping this
 * plugin into `route-coverage.test.ts`: **does the handler read the same id the
 * guard resolved?** `registerEntityAuthGuard` resolves the `:id`, walks it to a
 * library and requires a mode there, and on a cache miss it abstains — "a miss
 * is a 404 the handler will produce", which is true only where the handler
 * looks that id up.
 *
 * `GET /:id/versions` and `POST /:id/versions` do look it up and 404. The three
 * `/:id/versions/:version` routes did not: they list `TupleSetVersion` and
 * match on `isPartOf`, so what they served was reachable whether or not the
 * tuple set in the path resolved. One of the three is a DELETE, which is where
 * this differs from the query case — an unchecked read there, a destructive
 * call here.
 *
 * Two states reach it, and both are one API call:
 *
 * - **The set is gone, its versions are not.** `DELETE /tuple-sets/:id`
 *   cascades, so this is the rarer of the two — but a version whose set does
 *   not resolve is exactly what the guard abstains on, so the routes are
 *   checked for it rather than argued out of it.
 * - **The library is gone.** `DELETE /libraries/:id` deletes the library and
 *   its grants and nothing else, so every tuple set it held stays with
 *   `isPartOf` naming an id that no longer resolves. That one the guard now
 *   refuses on its own (`route-matrix.test.ts`), and the rows here are what
 *   says the plugin agrees.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import type { AuthContext } from '../../src/auth/types.js';

const LIBRARY = 'urn:sqlib:library:hydrology';
const GHOST_LIBRARY = 'urn:sqlib:library:decommissioned';
const LIVE_SET = 'urn:sqlib:tupleset:gauges';
/** Stored, but in a library that was deleted. */
const STRANDED_SET = 'urn:sqlib:tupleset:stranded';
/** Not stored at all — the id its versions still name. */
const GHOST_SET = 'urn:sqlib:tupleset:deleted';

const store = vi.hoisted(() => ({
  entities: new Map<string, Record<string, unknown>>(),
  versions: [] as Record<string, unknown>[],
  annotated: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  deleted: [] as string[],
  updated: [] as string[],
}));

/*
 * The repositories read the same coordinator in production
 * (`createEntityRepositories(getCacheCoordinator())`), so one map sits behind
 * both. What the stub must reproduce is the asymmetry the routes have:
 * `TupleSet.get` answers by id, `TupleSetVersion.list` answers regardless of
 * whether any tuple set still names them.
 */
vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    get: (id: string) => store.entities.get(id) ?? null,
  }),
  getEntityRepositories: () => ({
    TupleSet: {
      get: (id: string) => store.entities.get(id) ?? null,
      list: () => [...store.entities.values()].filter(e => e['@type'] === 'TupleSet'),
      update: async (id: string, patch: Record<string, unknown>) => {
        store.updated.push(id);
        const existing = store.entities.get(id);
        return existing ? { ...existing, ...patch } : null;
      },
      delete: async (id: string) => { store.deleted.push(id); },
    },
    TupleSetVersion: {
      list: () => store.versions,
      get: (id: string) => store.versions.find(v => v.$id === id) ?? null,
      delete: async (id: string) => { store.deleted.push(id); },
    },
  }),
}));

/* Annotation is the writer's job; here it only has to record that it ran. */
vi.mock('../../src/lib/TupleSetVersionWriter.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/TupleSetVersionWriter.js')>();
  return {
    ...actual,
    annotateTupleSetVersion: async (id: string, patch: Record<string, unknown>) => {
      store.annotated.push({ id, patch });
      const existing = store.versions.find(v => v.$id === id);
      return { ...existing, ...patch };
    },
  };
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

  const plugin = (await import('../../src/routes/tuple-sets.js')).default;
  await app.register(plugin as never, { prefix: '/tuple-sets' });
  await app.ready();
  return app;
}

async function inject(
  context: AuthContext,
  method: 'GET' | 'PATCH' | 'DELETE',
  url: string,
  payload?: object,
) {
  const app = await appAs(context);
  try {
    return await app.inject({ method, url, payload });
  } finally {
    await app.close();
  }
}

const ROWS = '{"head":{"vars":["gauge"]},"results":{"bindings":[]}}';

beforeEach(() => {
  store.entities = new Map<string, Record<string, unknown>>([
    [LIBRARY, { '@type': 'Library', $id: LIBRARY, name: 'Hydrology' }],
    [LIVE_SET, { '@type': 'TupleSet', $id: LIVE_SET, name: 'Gauges', isPartOf: [LIBRARY] }],
    // Its library is deliberately absent from the map.
    [STRANDED_SET, { '@type': 'TupleSet', $id: STRANDED_SET, name: 'Stranded', isPartOf: [GHOST_LIBRARY] }],
  ]);
  // The deleted set is absent while its version stays in the list.
  store.versions = [
    {
      '@type': 'TupleSetVersion',
      $id: `${LIVE_SET}:v1`,
      isPartOf: LIVE_SET,
      version: 1,
      contentString: ROWS,
      sourceFormat: 'csv',
      comment: 'gauge readings',
    },
    {
      '@type': 'TupleSetVersion',
      $id: `${STRANDED_SET}:v1`,
      isPartOf: STRANDED_SET,
      version: 1,
      contentString: ROWS,
      sourceFormat: 'csv',
      comment: 'stranded-rows',
    },
    {
      '@type': 'TupleSetVersion',
      $id: `${GHOST_SET}:v1`,
      isPartOf: GHOST_SET,
      version: 1,
      contentString: ROWS,
      sourceFormat: 'csv',
      comment: 'orphan-rows',
    },
  ];
  store.annotated = [];
  store.deleted = [];
  store.updated = [];
});

describe('a version of a tuple set the caller may reach', () => {
  it('is served to a reader and refused to a stranger', async () => {
    const allowed = await inject(reader, 'GET', `/tuple-sets/${LIVE_SET}/versions/1`);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().comment).toBe('gauge readings');

    expect((await inject(stranger, 'GET', `/tuple-sets/${LIVE_SET}/versions/1`)).statusCode).toBe(403);
  });

  it('takes write to annotate and delete to remove, not read', async () => {
    const refused = await inject(reader, 'PATCH', `/tuple-sets/${LIVE_SET}/versions/1`, {
      comment: 'a reader may not write',
    });
    expect(refused.statusCode).toBe(403);
    expect(store.annotated).toEqual([]);

    expect((await inject(reader, 'DELETE', `/tuple-sets/${LIVE_SET}/versions/1`)).statusCode).toBe(403);
    expect(store.deleted).toEqual([]);

    const allowed = await inject(owner, 'PATCH', `/tuple-sets/${LIVE_SET}/versions/1`, {
      comment: 'annotated by the owner',
    });
    expect(allowed.statusCode).toBe(200);
    expect(store.annotated).toHaveLength(1);
  });
});

describe('a version whose tuple set no longer resolves', () => {
  /*
   * The control: the same caller against the same plugin on a route whose
   * handler looks the set up. If this ever stops being a 404 the cases below
   * prove nothing about the version routes in particular.
   */
  it('is a 404 on the routes that read the set, not a 403', async () => {
    expect((await inject(stranger, 'GET', `/tuple-sets/${GHOST_SET}/versions`)).statusCode).toBe(404);
  });

  it('is not readable by a principal holding nothing', async () => {
    const response = await inject(stranger, 'GET', `/tuple-sets/${GHOST_SET}/versions/1`);

    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain('orphan-rows');
  });

  it('is not readable by a principal holding every mode on another library', async () => {
    // The version resolves to no library at all, and `requireLibraryMode(null)`
    // refuses rather than abstains — so a grant elsewhere reaches nothing here.
    const response = await inject(owner, 'GET', `/tuple-sets/${GHOST_SET}/versions/1`);

    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain('orphan-rows');
  });

  it('cannot be annotated', async () => {
    const response = await inject(owner, 'PATCH', `/tuple-sets/${GHOST_SET}/versions/1`, {
      comment: 'written by someone with no grant on it',
    });

    expect(response.statusCode).toBe(403);
    expect(store.annotated).toEqual([]);
  });

  it('cannot be deleted', async () => {
    // The one that was destructive: before this, a principal holding nothing
    // removed a stored version and was answered 204.
    const response = await inject(stranger, 'DELETE', `/tuple-sets/${GHOST_SET}/versions/1`);

    expect(response.statusCode).toBe(403);
    expect(store.deleted).toEqual([]);
  });
});

describe('a tuple set whose library was deleted', () => {
  it('is refused on the entity route, which the guard alone protects', async () => {
    expect((await inject(stranger, 'GET', `/tuple-sets/${STRANDED_SET}`)).statusCode).toBe(403);
  });

  it('is refused on the version routes too, for every principal below admin', async () => {
    expect((await inject(stranger, 'GET', `/tuple-sets/${STRANDED_SET}/versions/1`)).statusCode).toBe(403);
    expect((await inject(owner, 'GET', `/tuple-sets/${STRANDED_SET}/versions`)).statusCode).toBe(403);

    const remove = await inject(owner, 'DELETE', `/tuple-sets/${STRANDED_SET}/versions/1`);
    expect(remove.statusCode).toBe(403);
    expect(store.deleted).toEqual([]);
  });
});

describe('disabled mode', () => {
  it('is unaffected: every version route answers', async () => {
    expect((await inject(authDisabled, 'GET', `/tuple-sets/${LIVE_SET}/versions/1`)).statusCode).toBe(200);
    expect((await inject(authDisabled, 'GET', `/tuple-sets/${STRANDED_SET}/versions/1`)).statusCode).toBe(200);
    expect((await inject(authDisabled, 'GET', `/tuple-sets/${GHOST_SET}/versions/1`)).statusCode).toBe(200);
    expect((await inject(authDisabled, 'DELETE', `/tuple-sets/${GHOST_SET}/versions/1`)).statusCode).toBe(204);
  });
});
