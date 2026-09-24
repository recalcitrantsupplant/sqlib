/**
 * The entities a query group version *composes*, against the real
 * `/query-groups` plugin.
 *
 * Swept with `query-groups.ts` into `route-coverage.test.ts`, using the question
 * `argument-sets.ts` handed on — **does this route name a second entity in its
 * body, and what is the caller doing with it?** — and the one `backends.ts`
 * added beside it: *what does this route answer before it decides?*
 *
 * A group version's nodes name stored entities that need not live in the
 * group's library: a `QueryNode`'s `queryId` is a `QueryVersion`, a
 * `RuleSetNode`'s `ruleSetVersion` a `RuleSetVersion`. The route guard resolves
 * the `:id` in the path and checks Write on the *group's* library; nothing
 * looked at the nodes. `POST /execute` then requires Execute on the group's
 * library and says nothing about the legs, and `ExecutorFactory` carries the
 * caller's grants only as far as the *backends*.
 *
 * So Write plus Execute on one library was a way to run another library's saved
 * queries and rule sets, and read what they returned. This is the pair
 * `POST /tuple-sets/:id/versions/from-etl` and
 * `POST /data-graphs/:id/versions/from-query` already carry, and the pins
 * `ArgumentSetService.createVersion` checks, through a fourth door — the widest
 * of them, since one version composes arbitrarily many legs in one request.
 *
 * The mode is `execute`, not `read`, for the reason `from-query` gives: this is
 * not copying stored data into a payload, it is committing that the query will
 * be run. It is checked at composition rather than at execution because that is
 * where the other three check, and because binding the author is what lets a
 * library curate what its members may run — the same shape as `allowedBackends`.
 *
 * The listing rows are the other half, and live in `listingVisibility.test.ts`
 * with the six collection GETs already there.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import type { AuthContext } from '../../src/auth/types.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const MINE = 'urn:sqlib:library:mine';
const THEIRS = 'urn:sqlib:library:theirs';
const MY_GROUP = 'urn:sqlib:group:mine';
const MY_QUERY_VERSION = 'urn:sqlib:queryversion:mine-v1';
const THEIR_QUERY_VERSION = 'urn:sqlib:queryversion:theirs-v1';
const THEIR_RULESET_VERSION = 'urn:sqlib:rulesetversion:theirs-v1';
const BACKEND = 'urn:sqlib:backend:shared';

/** The query text only a principal holding Execute on `THEIRS` may run. */
const SECRET_QUERY = 'SELECT ?salary WHERE { ?person <urn:salary> ?salary }';

const store = vi.hoisted(() => ({ entities: new Map<string, Record<string, unknown>>() }));

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
      list: (type: string) =>
        [...store.entities.values()].filter(entity => entity['@type'] === type),
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

/** Every mode on `MINE`, and so nothing at all on `THEIRS`. */
const mine = grantsOn([[MINE, ALL]]);
/** Holds Execute on both, which is what separates "refused" from "broken". */
const both = grantsOn([[MINE, ALL], [THEIRS, ['execute']]]);
/** Read on `THEIRS` is not Execute on it, which is the mode this checks. */
const readsTheirs = grantsOn([[MINE, ALL], [THEIRS, ['read']]]);

/** What `disabled` mode hands every request: no principal, full access. */
const authDisabled: AuthContext = {
  ...mine,
  subject: 'urn:sqlib:principal:anonymous',
  principals: [],
  issuer: null,
  fullAccess: true,
  mode: 'disabled',
};

async function inject(
  context: AuthContext,
  method: 'GET' | 'POST',
  url: string,
  payload?: object,
) {
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
  const plugin = (await import('../../src/routes/query-groups.js')).default;
  await app.register(plugin as never, { prefix: '/query-groups' });
  await app.ready();
  try {
    return await app.inject({ method, url, payload });
  } finally {
    await app.close();
  }
}

const GROUP_PATH = `/query-groups/${encodeURIComponent(MY_GROUP)}`;

const queryNodeVersion = (queryVersionId: string) => ({
  queryGroupVersion: {},
  executionNodes: [{
    id: 'urn:ui-temp:node-0',
    nodeType: 'QueryNode',
    queryId: queryVersionId,
    backendId: BACKEND,
  }],
  edges: [],
});

const ruleSetNodeVersion = (ruleSetVersionId: string) => ({
  queryGroupVersion: {},
  executionNodes: [{
    id: 'urn:ui-temp:node-0',
    nodeType: 'RuleSetNode',
    ruleSetVersion: ruleSetVersionId,
  }],
  edges: [],
});

beforeEach(() => {
  store.entities = new Map<string, Record<string, unknown>>([
    [MINE, { '@type': 'Library', $id: MINE, name: 'Mine' }],
    [THEIRS, { '@type': 'Library', $id: THEIRS, name: 'Theirs' }],
    [BACKEND, { '@type': 'Backend', $id: BACKEND, name: 'Shared' }],

    [MY_GROUP, { '@type': 'QueryGroup', $id: MY_GROUP, name: 'Mine', isPartOf: MINE }],

    ['urn:sqlib:query:mine', { '@type': 'Query', $id: 'urn:sqlib:query:mine', isPartOf: MINE }],
    [MY_QUERY_VERSION, {
      '@type': 'QueryVersion', $id: MY_QUERY_VERSION, isPartOf: 'urn:sqlib:query:mine',
      version: 1, queryString: 'SELECT * WHERE { ?s ?p ?o }',
    }],

    ['urn:sqlib:query:theirs', { '@type': 'Query', $id: 'urn:sqlib:query:theirs', isPartOf: THEIRS }],
    [THEIR_QUERY_VERSION, {
      '@type': 'QueryVersion', $id: THEIR_QUERY_VERSION, isPartOf: 'urn:sqlib:query:theirs',
      version: 1, queryString: SECRET_QUERY,
    }],

    ['urn:sqlib:ruleset:theirs', { '@type': 'RuleSet', $id: 'urn:sqlib:ruleset:theirs', isPartOf: THEIRS }],
    [THEIR_RULESET_VERSION, {
      '@type': 'RuleSetVersion', $id: THEIR_RULESET_VERSION, isPartOf: 'urn:sqlib:ruleset:theirs',
      version: 1,
    }],
  ]);
});

describe('POST /query-groups/:id/v — the query versions a node will run', () => {
  it('composes a version naming a query version in the caller\'s own library', async () => {
    const response = await inject(mine, 'POST', `${GROUP_PATH}/v`, queryNodeVersion(MY_QUERY_VERSION));

    expect(response.statusCode, response.payload.slice(0, 300)).toBe(201);
  });

  it('refuses a node naming a query version in a library the caller may not execute', async () => {
    const response = await inject(mine, 'POST', `${GROUP_PATH}/v`, queryNodeVersion(THEIR_QUERY_VERSION));

    expect(response.statusCode).toBe(403);
    // Not a 500: the refusal reaches the error handler rather than being
    // flattened into "the server broke" by the route's catch-all.
    expect(response.json().error).toMatch(/execute/i);
  });

  it('writes nothing when it refuses', async () => {
    await inject(mine, 'POST', `${GROUP_PATH}/v`, queryNodeVersion(THEIR_QUERY_VERSION));

    // The check sits at the staging/flush boundary, so a refusal leaves no
    // half-built version, no orphan nodes, and no burned version number.
    expect([...store.entities.values()].filter(e => e['@type'] === 'QueryGroupVersion')).toEqual([]);
    expect([...store.entities.values()].filter(e => e['@type'] === 'QueryNode')).toEqual([]);
    expect(store.entities.get(MY_GROUP)).not.toHaveProperty('currentVersion');
  });

  it('allows it once the caller holds Execute on that library', async () => {
    const response = await inject(both, 'POST', `${GROUP_PATH}/v`, queryNodeVersion(THEIR_QUERY_VERSION));

    expect(response.statusCode, response.payload.slice(0, 300)).toBe(201);
  });

  it('is Execute rather than Read: reading their library is not running its queries', async () => {
    const response = await inject(readsTheirs, 'POST', `${GROUP_PATH}/v`, queryNodeVersion(THEIR_QUERY_VERSION));

    expect(response.statusCode).toBe(403);
  });

  it('checks every leg, not the first, and names the one it refused', async () => {
    const response = await inject(mine, 'POST', `${GROUP_PATH}/v`, {
      queryGroupVersion: {},
      executionNodes: [
        { id: 'urn:ui-temp:node-0', nodeType: 'QueryNode', queryId: MY_QUERY_VERSION, backendId: BACKEND },
        { id: 'urn:ui-temp:node-1', nodeType: 'QueryNode', queryId: THEIR_QUERY_VERSION, backendId: BACKEND },
      ],
      edges: [],
    });

    expect(response.statusCode).toBe(403);
    // A version may compose many legs in one request, so "execute is required"
    // about an unnamed one of them is not something an author can act on.
    expect(response.json().error).toContain('executionNodes[1].queryId');
    expect(response.json().error).toContain(THEIR_QUERY_VERSION);
  });
});

describe('POST /query-groups/:id/v — the rule set versions a node will run', () => {
  it('refuses a RuleSetNode naming a rule set version in a library the caller may not execute', async () => {
    const response = await inject(mine, 'POST', `${GROUP_PATH}/v`, ruleSetNodeVersion(THEIR_RULESET_VERSION));

    expect(response.statusCode).toBe(403);
  });

  it('allows it once the caller holds Execute on that library', async () => {
    const response = await inject(both, 'POST', `${GROUP_PATH}/v`, ruleSetNodeVersion(THEIR_RULESET_VERSION));

    expect(response.statusCode, response.payload.slice(0, 300)).toBe(201);
  });
});

describe('what the refusal discloses', () => {
  it('reports a reference that resolves to nothing as the 422 it was', async () => {
    // The check runs after staging's own rejection, so an IRI naming nothing is
    // still the client's error to fix rather than a permission answer.
    const response = await inject(mine, 'POST', `${GROUP_PATH}/v`, queryNodeVersion('urn:sqlib:queryversion:nowhere'));

    expect(response.statusCode).toBe(422);
  });

  it('reports an IRI that is not a version at all the same way', async () => {
    // `ReferenceResolver` collapses "missing" and "wrong type" into one reason,
    // so this is not a type oracle over arbitrary IRIs — which is what bounds
    // the 403-against-422 signal to "is a version somewhere".
    const response = await inject(mine, 'POST', `${GROUP_PATH}/v`, queryNodeVersion(THEIRS));

    expect(response.statusCode).toBe(422);
    expect(response.json().error).toContain('does not exist');
  });
});

describe('the routes the guard already covers', () => {
  /*
   * The three version routes and `/validate` match `QueryGroupVersion` on
   * `isPartOf` and never read the group the path names — the shape that was a
   * live hole in `queries.ts`, `tuple-sets.ts` and `rule-sets.ts`, where the
   * guard's abstain-on-miss stopped covering a handler reading a different id.
   *
   * It is **not known to be reachable here**: `DELETE /query-groups/:id`
   * cascades its versions before deleting the group, unlike
   * `repos.Query.delete`, and a group whose *library* was deleted is refused by
   * the guard's dangling-container branch. So these rows say the guard is what
   * covers the reachable case, rather than claiming a hole was closed.
   */
  const stranger = grantsOn([]);

  it.each([
    ['the group', GROUP_PATH],
    ['its version list', `${GROUP_PATH}/v`],
    ['one version', `${GROUP_PATH}/v/1`],
    ['that version\'s validation report', `${GROUP_PATH}/v/1/validate`],
  ])('refuses a principal holding nothing %s', async (_what, url) => {
    await inject(mine, 'POST', `${GROUP_PATH}/v`, queryNodeVersion(MY_QUERY_VERSION));

    expect((await inject(stranger, 'GET', url)).statusCode).toBe(403);
  });
});

describe('disabled mode', () => {
  it('composes across libraries, as it did before', async () => {
    const response = await inject(authDisabled, 'POST', `${GROUP_PATH}/v`, queryNodeVersion(THEIR_QUERY_VERSION));

    expect(response.statusCode, response.payload.slice(0, 300)).toBe(201);
  });
});
