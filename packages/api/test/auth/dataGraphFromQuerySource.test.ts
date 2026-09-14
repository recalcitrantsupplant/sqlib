/**
 * `POST /data-graphs/:id/versions/from-query` — the second entity, against the
 * real plugin.
 *
 * Found while sweeping `data-graphs.ts` into `route-coverage.test.ts`, and it is
 * not the version-route question the last three sweeps asked. Every `:id` route
 * in this plugin reads the graph the path names, so the guard's abstain-on-miss
 * premise holds throughout. What the guard cannot see is that this route names a
 * *second* entity in its body and runs it: a `QueryVersion`, whose stored query
 * text goes to a backend.
 *
 * So the guard required Write on the data graph's library, `assertBackendAccess`
 * required the backend to be reachable — through that same library's
 * `allowedBackends`, which is how curated execution is meant to work — and
 * nothing at all asked whether the caller may run the query. Write on one
 * library ran any other library's saved query and kept the graph it produced.
 *
 * `POST /tuple-sets/:id/versions/from-etl` carries exactly this pair and has
 * since #211: Write on the tuple set, Execute on the library owning the ETL job
 * version whose SQL runs. The rows below are that pair for this route.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';
import { BackendTypeIri } from '../../src/persistence/schemas/BackendSchema.js';
import type { AuthContext } from '../../src/auth/types.js';
import type { LibraryMode } from '../../src/auth/types.js';

const MINE = 'urn:sqlib:library:hydrology';
const THEIRS = 'urn:sqlib:library:payroll';
const GRAPH = 'urn:sqlib:data-graph:catchment';
const BACKEND = 'urn:sqlib:backend:shared';
/** Saved in a library the caller holds nothing on. */
const THEIR_QUERY_VERSION = 'urn:sqlib:query-version:salaries';
const MY_QUERY_VERSION = 'urn:sqlib:query-version:gauges';

const store = vi.hoisted(() => ({
  entities: new Map<string, Record<string, unknown>>(),
  created: [] as Array<{ parent: string; source: Record<string, unknown> }>,
  executed: [] as string[],
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({ get: (id: string) => store.entities.get(id) ?? null }),
  getEntityRepositories: () => ({
    DataGraph: {
      get: (id: string) => {
        const entity = store.entities.get(id);
        return entity && entity['@type'] === 'DataGraph' ? entity : null;
      },
      list: () => [...store.entities.values()].filter(e => e['@type'] === 'DataGraph'),
    },
  }),
}));

/*
 * The executor records the query text it was handed. That is the assertion that
 * matters on the refusal rows: a 403 that arrived *after* the query ran would
 * still have sent one library's SPARQL to a backend on another's behalf.
 */
vi.mock('../../src/lib/orchestration/ExecutorFactory.js', () => ({
  ExecutorFactory: class {
    async getExecutorForBackendId() {
      return {
        constructQueryParsed: async (queryString: string) => {
          store.executed.push(queryString);
          return {
            result: '<http://ex/s> <http://ex/p> <http://ex/o> .',
            contentType: 'application/n-triples',
          };
        },
      };
    }
  },
}));

vi.mock('../../src/lib/DataGraphVersionWriter.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/lib/DataGraphVersionWriter.js')>();
  return {
    ...actual,
    createDataGraphVersion: async (parent: string, input: Record<string, unknown>) => {
      store.created.push({ parent, source: input.source as Record<string, unknown> });
      return {
        '@type': 'DataGraphVersion',
        $id: `${parent}:v1`,
        isPartOf: parent,
        version: 1,
        contentString: String(input.contentString ?? ''),
        contentFormat: input.contentFormat,
      };
    },
  };
});

function contextWith(grants: Array<[library: string, modes: LibraryMode[]]>): AuthContext {
  return {
    subject: 'urn:sqlib:principal:user:caller',
    principals: ['urn:sqlib:principal:user:caller', 'urn:sqlib:principal:authenticated'],
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: {
      admin: false,
      backends: new Map([[BACKEND, new Set(['use'] as const)]]),
      libraries: new Map(grants.map(([library, modes]) => [library, new Set(modes)])),
    },
    claims: {},
    fullAccess: false,
    mode: 'required',
  };
}

/** Everything on the graph's own library, and nothing on the query's. */
const graphAuthor = contextWith([[MINE, ['read', 'write', 'execute', 'delete', 'control']]]);
/** The same, plus the one grant that makes running their query legitimate. */
const graphAuthorWhoMayRun = contextWith([
  [MINE, ['read', 'write', 'execute', 'delete', 'control']],
  [THEIRS, ['execute']],
]);
const authDisabled: AuthContext = {
  ...graphAuthor,
  subject: 'urn:sqlib:principal:anonymous',
  principals: [],
  issuer: null,
  fullAccess: true,
  mode: 'disabled',
};

async function fromQuery(context: AuthContext, queryVersionId: string) {
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
  const plugin = (await import('../../src/routes/data-graphs.js')).default;
  await app.register(plugin as never, { prefix: '/data-graphs' });
  await app.ready();
  try {
    return await app.inject({
      method: 'POST',
      url: `/data-graphs/${GRAPH}/versions/from-query`,
      payload: { queryVersionId, backendId: BACKEND },
    });
  } finally {
    await app.close();
  }
}

const CONSTRUCT = 'CONSTRUCT { ?s <http://ex/p> ?o } WHERE { ?s <http://ex/p> ?o }';

beforeEach(() => {
  store.entities = new Map<string, Record<string, unknown>>([
    [MINE, { '@type': 'Library', $id: MINE, name: 'Hydrology', allowedBackends: [BACKEND] }],
    [THEIRS, { '@type': 'Library', $id: THEIRS, name: 'Payroll', allowedBackends: [BACKEND] }],
    [GRAPH, { '@type': 'DataGraph', $id: GRAPH, name: 'Catchment graph', isPartOf: [MINE] }],
    [BACKEND, { '@type': 'Backend', $id: BACKEND, name: 'Shared store', backendType: BackendTypeIri.oxigraphEphemeral }],
    ['urn:sqlib:query:salaries', { '@type': 'Query', $id: 'urn:sqlib:query:salaries', isPartOf: [THEIRS] }],
    [THEIR_QUERY_VERSION, {
      '@type': 'QueryVersion',
      $id: THEIR_QUERY_VERSION,
      isPartOf: 'urn:sqlib:query:salaries',
      queryString: `${CONSTRUCT} # salaries`,
      queryType: QueryTypeIri.construct,
    }],
    ['urn:sqlib:query:gauges', { '@type': 'Query', $id: 'urn:sqlib:query:gauges', isPartOf: [MINE] }],
    [MY_QUERY_VERSION, {
      '@type': 'QueryVersion',
      $id: MY_QUERY_VERSION,
      isPartOf: 'urn:sqlib:query:gauges',
      queryString: `${CONSTRUCT} # gauges`,
      queryType: QueryTypeIri.construct,
    }],
  ]);
  store.created = [];
  store.executed = [];
});

describe('a query version in a library the caller holds nothing on', () => {
  it('is refused, and is not run first', async () => {
    const response = await fromQuery(graphAuthor, THEIR_QUERY_VERSION);

    expect(response.statusCode).toBe(403);
    expect(store.executed).toEqual([]);
    expect(store.created).toEqual([]);
  });

  it('is refused before the query type is considered', async () => {
    // A SELECT in another library answered 400 "not a CONSTRUCT or DESCRIBE",
    // which says the version exists and what kind of query it is. The check
    // sits above that, so both answers are the same 403.
    store.entities.set(THEIR_QUERY_VERSION, {
      ...store.entities.get(THEIR_QUERY_VERSION)!,
      queryType: QueryTypeIri.select,
    });

    expect((await fromQuery(graphAuthor, THEIR_QUERY_VERSION)).statusCode).toBe(403);
  });

  it('is refused although the backend itself is reachable', async () => {
    // The point of separating the two: `allowedBackends` on the graph's own
    // library makes the backend legitimate, and says nothing about whose query
    // may be sent to it.
    const response = await fromQuery(graphAuthor, THEIR_QUERY_VERSION);

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toContain('permission');
  });
});

describe('a query version the caller may execute', () => {
  it('runs and cuts a version when the grant is on the query\'s own library', async () => {
    const response = await fromQuery(graphAuthorWhoMayRun, THEIR_QUERY_VERSION);

    expect(response.statusCode).toBe(201);
    expect(store.executed).toEqual([`${CONSTRUCT} # salaries`]);
    expect(store.created).toHaveLength(1);
    expect(store.created[0]?.source.queryVersionId).toBe(THEIR_QUERY_VERSION);
  });

  it('runs when the query and the graph share a library', async () => {
    const response = await fromQuery(graphAuthor, MY_QUERY_VERSION);

    expect(response.statusCode).toBe(201);
    expect(store.executed).toEqual([`${CONSTRUCT} # gauges`]);
  });

  it('takes execute rather than read on that library', async () => {
    const reader = contextWith([
      [MINE, ['read', 'write', 'execute', 'delete', 'control']],
      [THEIRS, ['read']],
    ]);

    expect((await fromQuery(reader, THEIR_QUERY_VERSION)).statusCode).toBe(403);
    expect(store.executed).toEqual([]);
  });
});

describe('a query version whose library is gone', () => {
  it('is refused rather than abstained on', async () => {
    // `requireLibraryMode(null, …)` denies, which is what the guard now does
    // with a dangling container too — so a stranded query version is not a way
    // to run one.
    store.entities.delete(THEIRS);

    expect((await fromQuery(graphAuthorWhoMayRun, THEIR_QUERY_VERSION)).statusCode).toBe(403);
    expect(store.executed).toEqual([]);
  });
});

describe('disabled mode', () => {
  it('is unaffected: the run happens whatever library the query is in', async () => {
    const response = await fromQuery(authDisabled, THEIR_QUERY_VERSION);

    expect(response.statusCode).toBe(201);
    expect(store.executed).toEqual([`${CONSTRUCT} # salaries`]);
  });
});
