/**
 * `POST /etl-jobs/:id/execute`, and what a run is allowed to reach.
 *
 * The guard settles who may *start* a run on the job in the path — that is
 * `etlJobRoutes.test.ts`, beside the rest of the plugin's route scoping. This
 * file is about the three things the body can still name once it has:
 *
 * - **the version.** `etlJobVersionId` came out of the body and ran whatever
 *   job it belonged to, so Execute on one library ran another library's SQL
 *   and SPARQL template.
 * - **the column mapping.** `columnMappingVersionId` types the rows, and a
 *   mapping of another job's version was read and parsed without complaint.
 * - **the backend.** With no `ExecutionAuthScope`, `assertBackendAccess`
 *   returns at its first line and `ExecutorFactory` runs the SPARQL leg as
 *   sqlib acting as itself — every backend the process is configured with, the
 *   one holding every entity and every grant included.
 *
 * The run log is mocked rather than stubbed away, because "was this refused?"
 * and "was a run recorded anyway?" are different questions: a 403 with a row
 * in the job's history is still a run of something. `runsBegun` is what says
 * the decision happened before the log opened.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import type { AuthContext } from '../../src/auth/types.js';

const LIBRARY = 'urn:sqlib:library:hydrology';
/** A library the caller holds nothing on. */
const OTHER_LIBRARY = 'urn:sqlib:library:geology';

const JOB = 'urn:sqlib:etl-job:gauges';
const OTHER_JOB = 'urn:sqlib:etl-job:boreholes';
const VERSION = 'urn:sqlib:etl-job-version:gauges-v1';
const OTHER_VERSION = 'urn:sqlib:etl-job-version:boreholes-v1';
const MAPPING = 'urn:sqlib:etl-column-mapping:gauges-map';
const OTHER_MAPPING = 'urn:sqlib:etl-column-mapping:boreholes-map';
const MAPPING_VERSION = 'urn:sqlib:etl-column-mapping-version:gauges-map-v1';
const OTHER_MAPPING_VERSION = 'urn:sqlib:etl-column-mapping-version:boreholes-map-v1';
const RUN = 'urn:sqlib:etl-execution:gauges-run';
const OTHER_RUN = 'urn:sqlib:etl-execution:boreholes-run';

const BACKEND = 'urn:sqlib:backend:store';
const OTHER_BACKEND = 'urn:sqlib:backend:elsewhere';

/** The id as `/etl-jobs` serves it: the prefix stripped off. */
const short = (urn: string): string => urn.replace(/^urn:sqlib:[^:]+:/, '');

const store = vi.hoisted(() => ({
  entities: new Map<string, Record<string, unknown>>(),
  written: [] as Array<{ op: string; id: string }>,
  runsBegun: [] as string[],
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    get: (id: string) => store.entities.get(id) ?? null,
    list: (kind: string) => [...store.entities.values()].filter(e => e['@type'] === kind),
    create: async (kind: string, entity: { $id: string }) => {
      store.written.push({ op: `create:${kind}`, id: entity.$id });
      return entity;
    },
    update: async (kind: string, id: string, patch: Record<string, unknown>) => {
      store.written.push({ op: `update:${kind}`, id });
      const existing = store.entities.get(id);
      return existing ? { ...existing, ...patch } : null;
    },
  }),
  getEntityRepositories: () => ({}),
}));

/*
 * The run log is the thing a refused execution must not reach: a request
 * answered 403 is not a run of anything, and a record of one in the job's
 * history says it was.
 */
vi.mock('../../src/lib/etlRunLog.js', () => ({
  beginEtlExecution: async (input: { etlJobVersionId: string }) => {
    store.runsBegun.push(input.etlJobVersionId);
    return RUN;
  },
  completeEtlExecution: async () => {},
  failEtlExecution: async () => {},
  recordEtlExecutionProgress: async () => {},
}));

function libraryModes(
  ...modes: Array<'read' | 'write' | 'execute' | 'delete' | 'control'>
): AuthContext {
  return {
    subject: 'urn:sqlib:principal:user:caller',
    principals: ['urn:sqlib:principal:user:caller', 'urn:sqlib:principal:authenticated'],
    issuer: 'https://issuer.test/',
    tokenType: 'user',
    grants: {
      admin: false,
      backends: new Map([[BACKEND, new Set(['use' as const])]]),
      libraries: modes.length ? new Map([[LIBRARY, new Set(modes)]]) : new Map(),
    },
    claims: {},
    fullAccess: false,
    mode: 'required',
  };
}

/** An authenticated principal holding nothing at all. */
const stranger = libraryModes();
const reader = libraryModes('read');
const writer = libraryModes('read', 'write');
const runner = libraryModes('read', 'execute');
/** Every mode on the one library — and so, on no other. */
const owner = libraryModes('read', 'write', 'execute', 'delete', 'control');

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

  const plugin = (await import('../../src/routes/etl-jobs.js')).default;
  await app.register(plugin as never, { prefix: '/etl-jobs' });
  await app.ready();
  return app;
}

async function inject(
  context: AuthContext,
  method: 'GET' | 'POST' | 'PATCH',
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

const COLUMNS = JSON.stringify([
  { columnName: 'gauge', targetVariable: 'gauge', termType: 'literal', nullPolicy: 'undef' },
]);

beforeEach(() => {
  store.entities = new Map<string, Record<string, unknown>>([
    [LIBRARY, { '@type': 'Library', $id: LIBRARY, name: 'Hydrology' }],
    [OTHER_LIBRARY, { '@type': 'Library', $id: OTHER_LIBRARY, name: 'Geology' }],

    [JOB, {
      '@type': 'EtlJob', $id: JOB, name: 'Gauges', isPartOf: [LIBRARY], currentVersion: VERSION,
    }],
    [OTHER_JOB, {
      '@type': 'EtlJob', $id: OTHER_JOB, name: 'Boreholes', isPartOf: [OTHER_LIBRARY],
      currentVersion: OTHER_VERSION,
    }],

    [VERSION, {
      '@type': 'EtlJobVersion', $id: VERSION, isPartOf: JOB, version: 1,
      sql: 'select 1 as gauge', sparqlTemplate: 'CONSTRUCT { ?gauge a <urn:g> } WHERE {}',
      backendId: BACKEND, currentColumnMappingVersion: MAPPING_VERSION,
    }],
    [OTHER_VERSION, {
      '@type': 'EtlJobVersion', $id: OTHER_VERSION, isPartOf: OTHER_JOB, version: 1,
      sql: 'select secret from geology', sparqlTemplate: 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }',
      backendId: OTHER_BACKEND, currentColumnMappingVersion: OTHER_MAPPING_VERSION,
    }],

    [MAPPING, { '@type': 'EtlColumnMapping', $id: MAPPING, name: 'Gauges', etlJobVersion: VERSION }],
    [OTHER_MAPPING, {
      '@type': 'EtlColumnMapping', $id: OTHER_MAPPING, name: 'Boreholes', etlJobVersion: OTHER_VERSION,
    }],
    [MAPPING_VERSION, {
      '@type': 'EtlColumnMappingVersion', $id: MAPPING_VERSION, isPartOf: MAPPING,
      version: 1, columns: COLUMNS,
    }],
    [OTHER_MAPPING_VERSION, {
      '@type': 'EtlColumnMappingVersion', $id: OTHER_MAPPING_VERSION, isPartOf: OTHER_MAPPING,
      version: 1, columns: COLUMNS, comment: 'geology-columns',
    }],

    [RUN, {
      '@type': 'EtlExecution', $id: RUN, etlJobVersion: VERSION, columnMappingVersion: MAPPING_VERSION,
      status: 'completed', startedAt: '2026-09-01T00:00:00.000Z',
    }],
    [OTHER_RUN, {
      '@type': 'EtlExecution', $id: OTHER_RUN, etlJobVersion: OTHER_VERSION,
      columnMappingVersion: OTHER_MAPPING_VERSION, status: 'completed',
      startedAt: '2026-09-02T00:00:00.000Z',
      outputFormat: 'application/n-quads', outputLocation: 'geology-run.nq',
    }],
  ]);
  store.written = [];
  store.runsBegun = [];
});


describe('executing a job', () => {
  it('takes execute on its library, not write', async () => {
    const refused = await inject(writer, 'POST', `/etl-jobs/${short(JOB)}/execute`, {});

    expect(refused.statusCode).toBe(403);
    expect(store.runsBegun).toEqual([]);
  });

  it('refuses a version of another job named in the body', async () => {
    // Execute on this caller's own library, aimed at a version stored in one
    // it holds nothing on: before this it ran that library's SQL and template.
    const response = await inject(runner, 'POST', `/etl-jobs/${short(JOB)}/execute`, {
      etlJobVersionId: short(OTHER_VERSION),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('is not a version of');
    expect(store.runsBegun).toEqual([]);
  });

  it('refuses a column mapping version belonging to another job\'s version', async () => {
    const response = await inject(runner, 'POST', `/etl-jobs/${short(JOB)}/execute`, {
      columnMappingVersionId: short(OTHER_MAPPING_VERSION),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain('does not map ETL job version');
    expect(store.runsBegun).toEqual([]);
  });

  it('refuses a backend the caller may not use, and records no run', async () => {
    // The version's backend is reached through the caller's own grants or
    // through its library's curated list — this caller holds `use` on
    // `BACKEND` alone, so a version naming another one is refused before the
    // log opens.
    store.entities.set(VERSION, {
      ...store.entities.get(VERSION)!,
      backendId: OTHER_BACKEND,
    });

    const response = await inject(runner, 'POST', `/etl-jobs/${short(JOB)}/execute`, {});

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toContain(OTHER_BACKEND);
    expect(store.runsBegun).toEqual([]);
  });

  it('refuses the library storage backend, which no ETL job may read', async () => {
    // Without a scope `assertBackendAccess` returns at its first line, and the
    // store holding every entity and every grant was one `backendId` away.
    store.entities.set(VERSION, {
      ...store.entities.get(VERSION)!,
      backendId: 'urn:sqlib:backend:library-storage',
    });

    const response = await inject(runner, 'POST', `/etl-jobs/${short(JOB)}/execute`, {});

    expect(response.statusCode).toBe(403);
    expect(store.runsBegun).toEqual([]);
  });

  it('lets an execute-holding caller through to the run itself', async () => {
    // The backend is granted and the version is the job's own, so this gets
    // past every check above and fails on the backend not being stored — which
    // is the run, not the decision. The opened run is the proof: the log is
    // only reached once the request has been allowed.
    const response = await inject(runner, 'POST', `/etl-jobs/${short(JOB)}/execute`, {});

    expect(response.statusCode).toBe(404);
    expect(response.json().error).toContain('Backend not found');
    expect(store.runsBegun).toEqual([VERSION]);
  });
});
