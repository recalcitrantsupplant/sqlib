/**
 * The `/query-groups` version routes, against the real plugin: the group-side
 * twin of `queryVersionRoutes.test.ts`.
 *
 * Three things, each the group routes did not do while the query routes did:
 *
 * - **A version whose group no longer resolves.** The version routes match
 *   `QueryGroupVersion` on `isPartOf` and never look the path's group up, so
 *   the guard's abstain-on-miss was the only thing between such a version and
 *   any caller. `DELETE /query-groups/:id` cascades its versions, so this is
 *   not a state the API is known to leave behind — which is why the stub below
 *   builds it by hand, and why the handler should not depend on the cascade.
 * - **The query text a node pins from another library.** Composing a node over
 *   another library's query version needs Execute there (#489), and Execute is
 *   not Read. The expanded version carried every leg's `queryString`, so Read
 *   on the group's library was a read of the other library's queries.
 * - **500 bodies.** The version routes answered with the thrown message. The
 *   collection routes also built `details` and `stack`, which their 500
 *   schema happened to strip on the way out; the rows for them guard the
 *   handler rather than a leak the serializer let through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import type { AuthContext } from '../../src/auth/types.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const MINE = 'urn:sqlib:library:mine';
const THEIRS = 'urn:sqlib:library:theirs';
const MY_GROUP = 'urn:sqlib:group:mine';
const GHOST_GROUP = 'urn:sqlib:group:deleted';
const GHOST_VERSION = 'urn:sqlib:groupversion:deleted-v1';
const MY_QUERY_VERSION = 'urn:sqlib:queryversion:mine-v1';
const THEIR_QUERY = 'urn:sqlib:query:theirs';
const THEIR_QUERY_VERSION = 'urn:sqlib:queryversion:theirs-v1';
const BACKEND = 'urn:sqlib:backend:shared';

/** Text only a principal holding Read on `THEIRS` may see. */
const SECRET_QUERY = 'SELECT ?salary WHERE { ?person <urn:salary> ?salary }';
/** The name of the query that text belongs to, equally theirs. */
const SECRET_NAME = 'Payroll by person';

const store = vi.hoisted(() => ({
  entities: new Map<string, Record<string, unknown>>(),
  updates: [] as string[],
  failListing: null as string | null,
}));

overrideCacheCoordinatorProvider((() => {
  const get = (id: string) => store.entities.get(id) ?? null;
  return {
    getEntityRepositories: () => ({
      QueryGroup: {
        get: (id: string) => {
          const entity = store.entities.get(id);
          return entity && entity['@type'] === 'QueryGroup' ? entity : null;
        },
      },
    }),
    getCacheCoordinator: () => ({
      get,
      list: (type: string) => {
        if (store.failListing) throw new Error(store.failListing);
        return [...store.entities.values()].filter(entity => entity['@type'] === type);
      },
      resolveExisting: async (id: string, candidateTypes: readonly string[] = []) => {
        const entity = get(id);
        if (!entity) return null;
        const type = entity['@type'] as string;
        if (candidateTypes.length && !candidateTypes.includes(type)) return null;
        return { type, entity };
      },
      create: async (type: string, entity: Record<string, unknown>) => {
        const id = String(entity.$id ?? entity.id);
        store.entities.set(id, { ...entity, $id: id, '@type': type });
        return store.entities.get(id);
      },
      update: async (_type: string, id: string, updates: Record<string, unknown>) => {
        const current = store.entities.get(id);
        if (!current) return null;
        store.updates.push(id);
        const next = { ...current, ...updates };
        store.entities.set(id, next);
        return next;
      },
      delete: async (_type: string, id: string) => {
        store.entities.delete(id);
      },
    }),
  };
})());

type Mode = 'read' | 'write' | 'execute' | 'delete' | 'control';

function grantsOn(entries: Array<[string, Mode[]]>): AuthContext {
  return {
    subject: 'urn:sqlib:principal:user:caller',
    principals: ['urn:sqlib:principal:user:caller', 'urn:sqlib:principal:authenticated'],
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: {
      admin: false,
      backends: new Map(),
      libraries: new Map(entries.map(([library, modes]) => [library, new Set(modes)])),
    },
    claims: {},
    fullAccess: false,
    mode: 'required',
  };
}

const ALL: Mode[] = ['read', 'write', 'execute', 'delete', 'control'];

/** An authenticated principal holding nothing at all. */
const stranger = grantsOn([]);
/** Every mode on `MINE`, and so a stranger to `THEIRS`. */
const mine = grantsOn([[MINE, ALL]]);
/** May run `THEIRS`'s queries, which is what composing over them needs — and not read them. */
const runsTheirs = grantsOn([[MINE, ALL], [THEIRS, ['execute']]]);
/** May read `THEIRS` too: the control that tells "withheld" from "missing". */
const readsTheirs = grantsOn([[MINE, ALL], [THEIRS, ['read', 'execute']]]);

/** What `disabled` mode hands every request: no principal, full access. */
const authDisabled: AuthContext = {
  ...stranger,
  subject: 'urn:sqlib:principal:anonymous',
  principals: [],
  issuer: null,
  fullAccess: true,
  mode: 'disabled',
};

async function inject(
  context: AuthContext,
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  options: { payload?: object; headers?: Record<string, string> } = {},
) {
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
  const plugin = (await import('../../src/routes/query-groups.js')).default;
  await app.register(plugin as never, { prefix: '/query-groups' });
  await app.ready();
  try {
    return await app.inject({ method, url, payload: options.payload, headers: options.headers });
  } finally {
    await app.close();
  }
}

const GROUP_PATH = `/query-groups/${encodeURIComponent(MY_GROUP)}`;
const GHOST_PATH = `/query-groups/${encodeURIComponent(GHOST_GROUP)}`;

/** One group version with a leg in each library. */
const twoLibraryVersion = {
  queryGroupVersion: {},
  executionNodes: [
    { id: 'urn:ui-temp:node-0', nodeType: 'QueryNode', queryId: MY_QUERY_VERSION, backendId: BACKEND },
    { id: 'urn:ui-temp:node-1', nodeType: 'QueryNode', queryId: THEIR_QUERY_VERSION, backendId: BACKEND },
  ],
  edges: [],
};

async function composeTwoLibraryVersion() {
  const created = await inject(readsTheirs, 'POST', `${GROUP_PATH}/v`, { payload: twoLibraryVersion });
  expect(created.statusCode, created.payload.slice(0, 300)).toBe(201);
}

beforeEach(() => {
  store.updates = [];
  store.failListing = null;
  store.entities = new Map<string, Record<string, unknown>>([
    [MINE, { '@type': 'Library', $id: MINE, name: 'Mine' }],
    [THEIRS, { '@type': 'Library', $id: THEIRS, name: 'Theirs' }],
    [BACKEND, { '@type': 'Backend', $id: BACKEND, name: 'Shared' }],

    [MY_GROUP, { '@type': 'QueryGroup', $id: MY_GROUP, name: 'Mine', isPartOf: MINE }],

    ['urn:sqlib:query:mine', { '@type': 'Query', $id: 'urn:sqlib:query:mine', name: 'Mine', isPartOf: MINE }],
    [MY_QUERY_VERSION, {
      '@type': 'QueryVersion', $id: MY_QUERY_VERSION, isPartOf: 'urn:sqlib:query:mine',
      version: 1, queryString: 'SELECT * WHERE { ?s ?p ?o }',
    }],

    [THEIR_QUERY, { '@type': 'Query', $id: THEIR_QUERY, name: SECRET_NAME, isPartOf: THEIRS }],
    [THEIR_QUERY_VERSION, {
      '@type': 'QueryVersion', $id: THEIR_QUERY_VERSION, isPartOf: THEIR_QUERY,
      version: 1, queryString: SECRET_QUERY,
    }],

    // The group is deliberately absent while its version stays — the state a
    // version's `isPartOf` is in once whatever it names stops resolving.
    [GHOST_VERSION, {
      '@type': 'QueryGroupVersion', $id: GHOST_VERSION, isPartOf: GHOST_GROUP,
      version: 1, comment: 'salary review', executionNodes: [], edges: [],
    }],
  ]);
});

describe('a version whose group no longer resolves', () => {
  it('is not listed, and the listing does not 404 on the way to saying so', async () => {
    for (const caller of [stranger, mine]) {
      const response = await inject(caller, 'GET', `${GHOST_PATH}/v`);

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([]);
    }
  });

  it('is not readable by a stranger, nor by a principal holding every mode on another library', async () => {
    // No library resolves for it, so no grant reaches it:
    // `requireLibraryMode(null)` refuses rather than abstains.
    for (const caller of [stranger, mine]) {
      const response = await inject(caller, 'GET', `${GHOST_PATH}/v/1`);

      expect(response.statusCode).toBe(403);
      expect(response.body).not.toContain('salary');
    }
  });

  it('has no validation report for them either', async () => {
    const response = await inject(mine, 'GET', `${GHOST_PATH}/v/1/validate`);

    expect(response.statusCode).toBe(403);
  });

  it('cannot be annotated', async () => {
    const response = await inject(mine, 'PATCH', `${GHOST_PATH}/v/1`, {
      payload: { comment: 'written by someone with no grant on it' },
    });

    expect(response.statusCode).toBe(403);
    expect(store.updates).toEqual([]);
  });

  it('is unaffected in disabled mode', async () => {
    expect((await inject(authDisabled, 'GET', `${GHOST_PATH}/v`)).json()).toHaveLength(1);
    expect((await inject(authDisabled, 'GET', `${GHOST_PATH}/v/1`)).statusCode).toBe(200);
  });
});

describe('the query text a node pins from another library', () => {
  it('is withheld from a reader of the group who is a stranger to that library', async () => {
    await composeTwoLibraryVersion();

    const response = await inject(mine, 'GET', `${GROUP_PATH}/v/1`);

    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(SECRET_QUERY);
    expect(response.body).not.toContain(SECRET_NAME);
    const body = response.json();
    expect(body.queryVersions.map((v: { id: string }) => v.id)).toEqual([MY_QUERY_VERSION]);
    expect(body.iriMap).not.toHaveProperty(THEIR_QUERY_VERSION);
    // The graph is the group's, so its shape is still served: the node and
    // the pin it carries, just not what the pin points at.
    expect(body.queryNodes.map((n: { queryId: string }) => n.queryId)).toContain(THEIR_QUERY_VERSION);
  });

  it('is served once the caller may read that library', async () => {
    await composeTwoLibraryVersion();

    const response = await inject(readsTheirs, 'GET', `${GROUP_PATH}/v/1`);

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain(SECRET_QUERY);
    expect(response.json().iriMap[THEIR_QUERY_VERSION]).toBe(SECRET_NAME);
  });

  it('is withheld from the author who could run it but not read it', async () => {
    // Execute is what composing checks, and it is not Read: the echo of the
    // version they just saved is expanded for them like any other read. The
    // 201 schema does not list `queryVersions` today, so this guards the
    // expansion against that schema growing the field.
    const response = await inject(runsTheirs, 'POST', `${GROUP_PATH}/v`, { payload: twoLibraryVersion });

    expect(response.statusCode, response.payload.slice(0, 300)).toBe(201);
    expect(response.body).not.toContain(SECRET_QUERY);
  });

  it('is withheld from the annotation echo and from the 412 body', async () => {
    await composeTwoLibraryVersion();

    const annotated = await inject(mine, 'PATCH', `${GROUP_PATH}/v/1`, { payload: { comment: 'reviewed' } });
    expect(annotated.statusCode).toBe(200);
    expect(annotated.body).not.toContain(SECRET_QUERY);

    const stale = await inject(mine, 'PATCH', `${GROUP_PATH}/v/1`, {
      payload: { comment: 'reviewed again' },
      headers: { 'if-match': '"not-the-current-tag"' },
    });
    expect(stale.statusCode).toBe(412);
    expect(stale.body).not.toContain(SECRET_QUERY);
  });

  it('is behind the guard altogether for a principal holding nothing', async () => {
    await composeTwoLibraryVersion();

    expect((await inject(stranger, 'GET', `${GROUP_PATH}/v/1`)).statusCode).toBe(403);
  });
});

describe('500 bodies', () => {
  const INTERNAL = 'store unreachable at /var/lib/sqlib/oxigraph';

  it.each([
    ['the group listing', '/query-groups', 'Failed to fetch query groups'],
    ['a version listing', `${GROUP_PATH}/v`, 'Failed to list query group versions'],
    ['a version', `${GROUP_PATH}/v/1`, 'Failed to fetch query group version'],
  ])('do not echo the internal message on %s', async (_what, url, failure) => {
    store.failListing = INTERNAL;
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const response = await inject(mine, 'GET', url);

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: failure });
    expect(response.body).not.toContain('oxigraph');
    // Still logged: the operator needs it even if the caller does not.
    expect(errors.mock.calls.flat().map(String).join('\n')).toContain(INTERNAL);
    errors.mockRestore();
  });
});
