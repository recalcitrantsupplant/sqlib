/**
 * The `/queries` version routes, against the real plugin.
 *
 * `registerEntityAuthGuard` resolves the `:id` in the path to an entity, that
 * entity to its owning library, and requires a mode on it. When the cache
 * misses the id it abstains, and says why: "a miss is a 404 the handler will
 * produce; denying here would leak existence through the status code".
 *
 * That holds for every route whose handler looks the *same id* up. The three
 * version routes do not: they list `QueryVersion` and match on `isPartOf`,
 * never touching the query the path names. So for them the guard's premise is
 * false — a miss is not a 404, it is a 200 over rows the guard did not check.
 *
 * A query's versions outlive it. `DELETE /queries/:id` deletes one entity
 * (`CacheCoordinator.delete`), so its versions stay in the cache with
 * `isPartOf` naming an id that no longer resolves. Reading one then went
 * through no authorization check at all: not the guard's, which abstained, and
 * not the handler's, which was not there.
 *
 * The sibling routes are the control. `GET /queries/:id` and `PUT /queries/:id`
 * re-check in the handler with `requireEntityMode`, which is why the same
 * request against a live query is refused for the caller this file's version
 * cases were admitted for.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import type { AuthContext } from '../../src/auth/types.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const LIBRARY = 'urn:sqlib:library:hydrology';
const LIVE_QUERY = 'urn:sqlib:query:live';
const GHOST_QUERY = 'urn:sqlib:query:deleted';

const store = vi.hoisted(() => ({
  entities: new Map<string, Record<string, unknown>>(),
  versions: [] as Record<string, unknown>[],
  updates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
}));

/*
 * The repositories read the same coordinator in production
 * (`createEntityRepositories(getCacheCoordinator())`), so the stub keeps one
 * map behind both. What it must reproduce is the asymmetry the routes have:
 * `Query.get` answers by id, `QueryVersion.list` answers regardless of whether
 * any query still names them.
 */
overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({
    get: (id: string) => store.entities.get(id) ?? null,
  }),
  getEntityRepositories: () => ({
    Query: {
      get: (id: string) => store.entities.get(id) ?? null,
      list: () => [...store.entities.values()].filter(e => e['@type'] === 'Query'),
    },
    QueryVersion: {
      list: () => store.versions,
      get: (id: string) => store.versions.find(v => v.$id === id) ?? null,
      update: async (id: string, patch: Record<string, unknown>) => {
        store.updates.push({ id, patch });
        const existing = store.versions.find(v => v.$id === id);
        return existing ? { ...existing, ...patch } : null;
      },
    },
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
const writer = libraryMode('read', 'write');

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

  const plugin = (await import('../../src/routes/queries.js')).default;
  await app.register(plugin as never, { prefix: '/queries' });
  await app.ready();
  return app;
}

async function inject(
  context: AuthContext,
  method: 'GET' | 'PATCH',
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

beforeEach(() => {
  store.entities = new Map<string, Record<string, unknown>>([
    [LIBRARY, { '@type': 'Library', $id: LIBRARY, name: 'Hydrology' }],
    [LIVE_QUERY, { '@type': 'Query', $id: LIVE_QUERY, name: 'Gauges', isPartOf: [LIBRARY] }],
  ]);
  // The deleted query is deliberately absent from the map while its version
  // stays in the list — the state `DELETE /queries/:id` leaves behind.
  store.versions = [
    {
      '@type': 'QueryVersion',
      $id: `${LIVE_QUERY}:v1`,
      isPartOf: LIVE_QUERY,
      version: 1,
      queryString: 'SELECT ?gauge WHERE { ?gauge a <urn:Gauge> }',
    },
    {
      '@type': 'QueryVersion',
      $id: `${GHOST_QUERY}:v1`,
      isPartOf: GHOST_QUERY,
      version: 1,
      queryString: 'SELECT ?salary WHERE { ?person <urn:salary> ?salary }',
    },
  ];
  store.updates = [];
});

describe('a version of a query the caller may read', () => {
  it('is served to a reader and refused to a stranger', async () => {
    const allowed = await inject(reader, 'GET', `/queries/${LIVE_QUERY}/v/1`);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json().queryVersion.queryString).toContain('?gauge');

    const refused = await inject(stranger, 'GET', `/queries/${LIVE_QUERY}/v/1`);
    expect(refused.statusCode).toBe(403);
  });

  it('is listed for a reader, and the listing is refused to a stranger', async () => {
    // Here the guard does its job: `:id` resolves, so the refusal happens in
    // the preHandler and the handler's own filter never runs.
    expect((await inject(reader, 'GET', `/queries/${LIVE_QUERY}/v`)).json()).toHaveLength(1);
    expect((await inject(stranger, 'GET', `/queries/${LIVE_QUERY}/v`)).statusCode).toBe(403);
  });
});

describe('a version whose query no longer resolves', () => {
  /*
   * The control: the same caller against the same plugin, on a route whose
   * handler re-checks. If this ever stops being 403 the cases below prove
   * nothing, because the whole plugin would be open.
   */
  it('is the only unchecked door — the stable routes refuse this caller', async () => {
    expect((await inject(stranger, 'GET', `/queries/${LIVE_QUERY}`)).statusCode).toBe(403);
  });

  it('is not readable by a principal holding nothing', async () => {
    const response = await inject(stranger, 'GET', `/queries/${GHOST_QUERY}/v/1`);

    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain('salary');
  });

  it('is not readable by a principal holding every mode on another library', async () => {
    // The version's library cannot be resolved, so there is no grant that
    // reaches it — `requireLibraryMode(null)` refuses rather than abstains.
    const response = await inject(writer, 'GET', `/queries/${GHOST_QUERY}/v/1`);

    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain('salary');
  });

  it('is not listed, and the listing does not 404 on the way to saying so', async () => {
    const response = await inject(stranger, 'GET', `/queries/${GHOST_QUERY}/v`);

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it('cannot be annotated', async () => {
    const response = await inject(writer, 'PATCH', `/queries/${GHOST_QUERY}/v/1`, {
      comment: 'written by someone with no grant on it',
    });

    expect(response.statusCode).toBe(403);
    expect(store.updates).toEqual([]);
  });
});

describe('disabled mode', () => {
  it('is unaffected: every version route answers', async () => {
    expect((await inject(authDisabled, 'GET', `/queries/${LIVE_QUERY}/v/1`)).statusCode).toBe(200);
    expect((await inject(authDisabled, 'GET', `/queries/${GHOST_QUERY}/v/1`)).statusCode).toBe(200);
    expect((await inject(authDisabled, 'GET', `/queries/${GHOST_QUERY}/v`)).json()).toHaveLength(1);
  });
});
