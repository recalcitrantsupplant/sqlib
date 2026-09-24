/**
 * The `/backends` plugin, against the real routes.
 *
 * Backends are not library-scoped. `resolveOwningLibrary` has nothing to find
 * on a `Backend`, so the plugin registers no entity guard — correctly, since a
 * guard that abstained on every route would read as coverage — and each handler
 * requires a `BackendMode` on the backend in the path instead. That makes the
 * handler the whole of the protection, and a handler that forgets is not
 * visible from anywhere else. Two forgot.
 *
 * **`GET /:id/references` checked nobody.** It answers the same question as
 * `GET /:id/usage` directly above it — what points at this backend — over two
 * of the same four collections, and `/usage` has required `use` throughout. A
 * principal holding no grant on the backend was refused by one and answered
 * `200` by the other, with the id and name of every library and query in the
 * deployment naming it as their `defaultBackend`.
 *
 * **The three in-process-store routes checked last.** `GET /:id/stats`,
 * `POST /:id/upload` and `DELETE /:id/data` ran the existence lookup and the
 * backend-type test before `requireBackendMode`, so an unauthorized caller got
 * three different answers for three different states: `404` for an id that is
 * not stored, `400` for one that is stored and is not an in-process store,
 * `403` for one that is both. The request never succeeded — but the backend
 * table's shape came back in the status code, including which entries hold
 * their data in this process, which is the set worth uploading to or clearing.
 *
 * The table below is the regression guard for both: every route in the plugin
 * that names a backend, asserted to refuse a principal holding nothing, so a
 * route that loses its check — or arrives without one — fails here by name.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { backendTypeKeyToIri } from '../../src/persistence/schemas/BackendSchema.js';
import type { AuthContext } from '../../src/auth/types.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const HTTP_BACKEND = 'urn:sqlib:backend:private';
const OXIGRAPH_BACKEND = 'urn:sqlib:backend:in-process';
const ABSENT_BACKEND = 'urn:sqlib:backend:absent';

const LIBRARY = 'urn:sqlib:library:hydrology';
const QUERY = 'urn:sqlib:query:gauges';

// Through the mapper rather than written out, so a renamed namespace fails
// here as a type error rather than as a serializer throwing 500 at every
// assertion below.
const HTTP_TYPE = backendTypeKeyToIri('http');
const OXIGRAPH_TYPE = backendTypeKeyToIri('oxigraphMemory');

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
    update: async () => null,
    delete: async () => true,
  });
  return {
    getCacheCoordinator: () => ({ get: (id: string) => store.entities.get(id) ?? null }),
    getEntityRepositories: () => ({
      Backend: repo('Backend'),
      Library: repo('Library'),
      Query: repo('Query'),
      // `collectBackendUsage` walks all of these, so `GET /:id/usage` reaches
      // a 200 rather than a 500 for an authorized caller — which is what makes
      // "not 403" in the table below mean "reached the handler".
      QueryNode: repo('QueryNode'),
      DynamicQueryNode: repo('DynamicQueryNode'),
      QueryGroup: repo('QueryGroup'),
      QueryGroupVersion: repo('QueryGroupVersion'),
      BenchmarkExperiment: repo('BenchmarkExperiment'),
      BenchmarkExperimentVersion: repo('BenchmarkExperimentVersion'),
      Patch: repo('Patch'),
    }),
  };
})());

type BackendMode = 'use' | 'write' | 'control';

function principal(
  backends: Array<[string, BackendMode[]]>,
  options: { admin?: boolean } = {}
): AuthContext {
  return {
    subject: 'urn:sqlib:principal:user:caller',
    principals: ['urn:sqlib:principal:user:caller', 'urn:sqlib:principal:authenticated'],
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: {
      admin: options.admin ?? false,
      backends: new Map(backends.map(([id, modes]) => [id, new Set(modes)])),
      // Deliberately generous on the library side, so that nothing below can
      // pass because of a library grant: these routes are backend-scoped, and
      // library grants must say nothing about them in either direction.
      libraries: new Map([[LIBRARY, new Set(['read', 'write', 'execute', 'delete', 'control'])]]),
    },
    claims: {},
    fullAccess: false,
    mode: 'required',
  } as unknown as AuthContext;
}

/** Authenticated, holding no grant on any backend. */
const stranger = principal([]);
/** `use` on both stored backends and nothing more. */
const user = principal([[HTTP_BACKEND, ['use']], [OXIGRAPH_BACKEND, ['use']]]);
/** Every backend mode there is, and still not an administrator. */
const owner = principal([
  [HTTP_BACKEND, ['use', 'write', 'control']],
  [OXIGRAPH_BACKEND, ['use', 'write', 'control']],
]);
const admin = principal([], { admin: true });

/** What `disabled` mode hands every request: no principal, full access. */
const authDisabled: AuthContext = {
  ...stranger,
  subject: 'urn:sqlib:principal:anonymous',
  principals: [],
  issuer: null,
  fullAccess: true,
  mode: 'disabled',
} as AuthContext;

async function appAs(context: AuthContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  setupValidator(app);
  for (const schema of Object.values(schemas)) {
    if (schema && typeof schema === 'object' && '$id' in schema) app.addSchema(schema);
  }
  app.setErrorHandler((error, _request, reply) => {
    reply
      .status((error as { statusCode?: number }).statusCode ?? 500)
      .send({ error: error.message });
  });
  app.decorateRequest('authContext', undefined);
  app.addHook('onRequest', async request => {
    request.authContext = context;
  });

  const plugin = (await import('../../src/routes/backends.js')).default;
  await app.register(plugin as never, { prefix: '/backends' });
  await app.ready();
  return app;
}

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

async function inject(context: AuthContext, method: Method, url: string, payload?: object) {
  const app = await appAs(context);
  try {
    return await app.inject({ method, url, payload });
  } finally {
    await app.close();
  }
}

/** Ids are IRIs, and every route takes them percent-encoded in the path. */
const at = (id: string) => encodeURIComponent(id);

beforeEach(() => {
  store.entities = new Map<string, Record<string, unknown>>([
    [HTTP_BACKEND, {
      '@type': 'Backend', $id: HTTP_BACKEND, name: 'Private store',
      backendType: HTTP_TYPE, endpoint: 'https://private.test/sparql',
    }],
    [OXIGRAPH_BACKEND, {
      '@type': 'Backend', $id: OXIGRAPH_BACKEND, name: 'In-process store',
      backendType: OXIGRAPH_TYPE,
    }],
    [LIBRARY, {
      '@type': 'Library', $id: LIBRARY, name: 'Hydrology', defaultBackend: HTTP_BACKEND,
    }],
    [QUERY, {
      '@type': 'Query', $id: QUERY, name: 'Gauges', isPartOf: [LIBRARY],
      defaultBackend: HTTP_BACKEND,
    }],
  ]);
});

/**
 * Every route of the plugin that names a backend in its path, with the mode the
 * manifest in `route-coverage.test.ts` classifies it under.
 *
 * The `admin` rows are here for the same reason the rest are: an administrator-
 * only route must refuse a principal holding *every* backend mode, and that is
 * only checkable by naming it.
 */
const SCOPED_ROUTES: ReadonlyArray<
  [label: string, method: Method, path: string, mode: BackendMode | 'admin', body?: object]
> = [
  ['the backend', 'GET', '', 'use'],
  ['a probe of it', 'POST', '/probe', 'use'],
  ['its probe history', 'GET', '/probe-history', 'use'],
  ['its prefix map', 'GET', '/prefixes', 'use'],
  ['what uses it', 'GET', '/usage', 'use'],
  ['what references it', 'GET', '/references', 'use'],
  ['its patch list', 'GET', '/patches', 'use'],
  ['its patch log', 'GET', '/patch-log', 'use'],
  ['a prefix push', 'POST', '/prefixes', 'write', { upserts: [{ prefix: 'ex', namespace: 'http://e/' }] }],
  ['its env vars', 'GET', '/env', 'admin'],
  ['deleting it', 'DELETE', '', 'admin'],
];

describe('every backend-scoped route requires a grant on the backend', () => {
  describe.each(SCOPED_ROUTES)('%s', (_label, method, path, mode, body) => {
    const url = `/backends/${at(HTTP_BACKEND)}${path}`;

    /*
     * The row `GET /:id/references` failed. It answered 200 to this caller,
     * with the libraries and queries pointing at the backend, while `/usage`
     * on the line above it in the same file refused them.
     */
    it('refuses a principal holding no grant at all', async () => {
      const response = await inject(stranger, method, url, body);
      expect(response.statusCode, response.body).toBe(403);
    });

    it('lets a holder of the mode it asks for reach the handler', async () => {
      const holder = mode === 'admin' ? admin : mode === 'use' ? user : owner;
      const response = await inject(holder, method, url, body);
      // Not 200: several of these reach a network call or a store that is not
      // loaded and fail after the check. Reaching the handler is the claim.
      expect(response.statusCode, response.body).not.toBe(403);
    });

    it('lets `disabled` mode through, as it does everywhere', async () => {
      const response = await inject(authDisabled, method, url, body);
      expect(response.statusCode, response.body).not.toBe(403);
    });
  });

  /*
   * `use` is not `write`, and `control` on a backend is not administrator.
   * Both are asserted rather than assumed, because the whole value of splitting
   * the manifest's `backend-handler` into `backend-use` and `backend-write` is
   * that a route quietly changing which one it asks for should be visible.
   */
  it('does not let `use` stand in for `write`', async () => {
    const response = await inject(user, 'POST', `/backends/${at(HTTP_BACKEND)}/prefixes`, {
      upserts: [{ prefix: 'ex', namespace: 'http://e/' }],
    });
    expect(response.statusCode, response.body).toBe(403);
  });

  it('does not let every backend mode stand in for administrator', async () => {
    const response = await inject(owner, 'GET', `/backends/${at(HTTP_BACKEND)}/env`);
    expect(response.statusCode, response.body).toBe(403);
  });

  it('does not let a grant on one backend reach another', async () => {
    const onlyOther = principal([[OXIGRAPH_BACKEND, ['use', 'write', 'control']]]);
    const response = await inject(onlyOther, 'GET', `/backends/${at(HTTP_BACKEND)}/references`);
    expect(response.statusCode, response.body).toBe(403);
  });
});

describe('GET /:id/references', () => {
  /*
   * The hole, stated as what it handed out rather than as a status code. These
   * are names and ids of entities in a library the caller may well hold nothing
   * on — and here holds *everything* on, which is the point: the grant that
   * mattered was on the backend, and the caller had none.
   */
  it('does not name the libraries and queries pointing at a backend', async () => {
    const response = await inject(stranger, 'GET', `/backends/${at(HTTP_BACKEND)}/references`);

    expect(response.statusCode).toBe(403);
    expect(response.body).not.toContain(QUERY);
    expect(response.body).not.toContain(LIBRARY);
    expect(response.body).not.toContain('Gauges');
  });

  it('still answers a holder of `use`, which is what `/usage` beside it takes', async () => {
    const response = await inject(user, 'GET', `/backends/${at(HTTP_BACKEND)}/references`);

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({
      libraries: [{ id: LIBRARY, name: 'Hydrology' }],
      queries: [{ id: QUERY, name: 'Gauges' }],
    });
  });

  /*
   * And its sibling, on the same fixture and the same grant — the pair being
   * the point. `/usage` answers over four collections where `/references`
   * answers over two of them, which is why one bar rather than a new one.
   */
  it('agrees with `/usage`, which answers the same question more fully', async () => {
    const response = await inject(user, 'GET', `/backends/${at(HTTP_BACKEND)}/usage`);

    expect(response.statusCode, response.body).toBe(200);
    const usage = response.json();
    expect(usage.libraries.items ?? usage.libraries).toBeDefined();
    expect(JSON.stringify(usage)).toContain(QUERY);
  });
});

describe('the in-process-store routes check before they look', () => {
  /*
   * One principal, three states of the id, one answer. Before the check was
   * hoisted these were 404, 400 and 403 respectively — so the difference
   * between "no such backend", "stored, not in-process" and "stored and
   * in-process" was readable by a caller entitled to none of them.
   *
   * Each case is its own expectation so a regression names the state that
   * started leaking, rather than just the route.
   */
  const IN_PROCESS_ROUTES: ReadonlyArray<[Method, string]> = [
    ['GET', '/stats'],
    ['POST', '/upload'],
    ['DELETE', '/data'],
  ];

  describe.each(IN_PROCESS_ROUTES)('%s /:id%s', (method, path) => {
    it('answers 403 for a backend that is not stored', async () => {
      const response = await inject(stranger, method, `/backends/${at(ABSENT_BACKEND)}${path}`);
      expect(response.statusCode, response.body).toBe(403);
    });

    it('answers 403 for a stored backend that is not an in-process store', async () => {
      const response = await inject(stranger, method, `/backends/${at(HTTP_BACKEND)}${path}`);
      expect(response.statusCode, response.body).toBe(403);
    });

    it('answers 403 for a stored in-process store', async () => {
      const response = await inject(stranger, method, `/backends/${at(OXIGRAPH_BACKEND)}${path}`);
      expect(response.statusCode, response.body).toBe(403);
    });
  });

  /*
   * And the rule the hoist had to preserve: an authorized caller still gets the
   * diagnostic the route exists to give. `GET /:id/stats` on an HTTP backend is
   * a 400 that says so — the answer that was leaking, given to someone entitled
   * to it.
   */
  it('still tells an authorized caller that the backend is not in-process', async () => {
    const response = await inject(user, 'GET', `/backends/${at(HTTP_BACKEND)}/stats`);
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('not an in-process oxigraph backend');
  });

  it('still 404s an authorized caller on a backend that is not stored', async () => {
    const authorized = principal([[ABSENT_BACKEND, ['use', 'write']]]);
    const response = await inject(authorized, 'GET', `/backends/${at(ABSENT_BACKEND)}/stats`);
    expect(response.statusCode, response.body).toBe(404);
  });
});

describe('the collection listings', () => {
  /*
   * `backend-listing` rather than `readable-listing`: `filterReadable` resolves
   * an entity's owning library and a backend has none, so these narrow on
   * `grants.backends` directly. An empty array rather than a 403, the same
   * shape every other listing takes.
   */
  it('shows a principal holding nothing an empty list', async () => {
    const response = await inject(stranger, 'GET', '/backends');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it('shows a holder only the backends it holds', async () => {
    const onlyOne = principal([[HTTP_BACKEND, ['use']]]);
    const response = await inject(onlyOne, 'GET', '/backends');
    expect(response.json().map((backend: { id: string }) => backend.id)).toEqual([HTTP_BACKEND]);
  });

  it('shows an administrator everything', async () => {
    const response = await inject(admin, 'GET', '/backends');
    expect(response.json()).toHaveLength(2);
  });

  it('shows `disabled` mode everything, as it does everywhere', async () => {
    const response = await inject(authDisabled, 'GET', '/backends');
    expect(response.json()).toHaveLength(2);
  });

  /*
   * The cached probe results are the same list one fact along — whether each
   * store answered — so they are narrowed by the same rule. `visibleBackends`
   * is what makes that one rule rather than two.
   */
  it('narrows the cached probe results the same way', async () => {
    const response = await inject(stranger, 'GET', '/backends/probes');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().probes).toEqual([]);
  });

  /*
   * And `Probe all`, which is the one that reaches the network: a principal
   * holding nothing probes nothing, which is the behaviour worth pinning —
   * there is no unauthorized way to make the process open connections.
   */
  it('probes nothing on behalf of a principal holding nothing', async () => {
    const response = await inject(stranger, 'POST', '/backends/probes');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().probes).toEqual([]);
  });
});

describe('the administrator-only routes', () => {
  /*
   * Creating, reconfiguring and deleting a backend edit the set of stores this
   * process will connect to, which is not a fact about one connection that a
   * grant on that connection should buy. `control` is deliberately not enough:
   * `owner` holds it on both stored backends.
   */
  it('refuses creation to a principal holding every backend mode', async () => {
    const response = await inject(owner, 'POST', '/backends', {
      name: 'New store',
      backendType: 'http',
      endpoint: 'https://new.test/sparql',
    });
    expect(response.statusCode, response.body).toBe(403);
  });

  it('refuses reconfiguration to the same principal', async () => {
    const response = await inject(owner, 'PUT', `/backends/${at(HTTP_BACKEND)}`, {
      name: 'Renamed',
    });
    expect(response.statusCode, response.body).toBe(403);
  });
});
