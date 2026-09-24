/**
 * The `/etl-jobs` plugin, against the real routes.
 *
 * Two holes, found one after the other, both of which left routes answering a
 * principal holding no grant at all.
 *
 * **The id the guard reads is not the id the handler reads.** Every other
 * plugin takes full URNs in its path parameters, so `registerEntityAuthGuard`
 * looking the parameter up in the cache as written is sound: a miss there is a
 * miss in the handler too, and abstaining leaves a 404 rather than leaking
 * existence through a 403. `/etl-jobs` is the exception. Its handlers go
 * through `EtlService.toUrn(id, kind)`, and its responses report ids with the
 * prefix stripped — so the id a caller is *given* is `gauges`, the guard's
 * `cache.get('gauges')` missed, and the handler's
 * `cache.get('urn:sqlib:etl-job:gauges')` did not. Every `:id`, `:versionId`
 * and `:executionId` route in the plugin answered the short form unguarded,
 * `PATCH` and `/:id/execute` included. That is what `shortIdKinds` is for, and
 * the pairs below are what says the two spellings now agree.
 *
 * **Two entities had no owner to find.** `EtlExecution` and `EtlColumnMapping`
 * name their parent `etlJobVersion` rather than `isPartOf`, so
 * `resolveOwningLibrary` followed nothing and the guard abstained even on the
 * full URN — the narrower gap recorded on issue #211. `containerRefsOf` now
 * carries that key for both, which is why an execution reached by URN refuses
 * here and did not before.
 *
 * The two compose: `GET /etl-jobs/executions/:executionId` needed both fixes,
 * and a test that only sent short ids would have passed on half of them.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import type { AuthContext } from '../../src/auth/types.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

const LIBRARY = 'urn:sqlib:library:hydrology';
const GHOST_LIBRARY = 'urn:sqlib:library:decommissioned';

const JOB = 'urn:sqlib:etl-job:gauges';
const JOB_VERSION = 'urn:sqlib:etl-job-version:gauges-1';
const MAPPING = 'urn:sqlib:etl-column-mapping:gauges-map';
const MAPPING_VERSION = 'urn:sqlib:etl-column-mapping-version:gauges-map-1';
const EXECUTION = 'urn:sqlib:etl-execution:run-1';

/** A run whose job version is gone: the dangling-container case, one link out. */
const STRANDED_EXECUTION = 'urn:sqlib:etl-execution:run-stranded';
/** Stored, but under a library that was deleted. */
const STRANDED_JOB = 'urn:sqlib:etl-job:stranded';
const STRANDED_JOB_VERSION = 'urn:sqlib:etl-job-version:stranded-1';

/** The short forms, as the plugin's own responses report them. */
const short = (urn: string) => urn.replace(/^urn:sqlib:[^:]+:/, '');

const store = vi.hoisted(() => ({ entities: new Map<string, Record<string, unknown>>() }));

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({
    get: (id: string) => store.entities.get(id) ?? null,
    list: (type: string) => [...store.entities.values()].filter(e => e['@type'] === type),
  }),
  getEntityRepositories: () => ({}),
});

function libraryMode(
  ...modes: Array<'read' | 'write' | 'execute' | 'delete' | 'control'>
): AuthContext {
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
    reply
      .status((error as { statusCode?: number }).statusCode ?? 500)
      .send({ error: error.message });
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
  method: 'GET' | 'PATCH' | 'POST',
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
  { columnName: 'gauge', targetVariable: 'gauge', termType: 'Literal', nullPolicy: 'skip' },
]);

beforeEach(() => {
  store.entities = new Map<string, Record<string, unknown>>([
    [LIBRARY, { '@type': 'Library', $id: LIBRARY, name: 'Hydrology' }],

    [JOB, {
      '@type': 'EtlJob', $id: JOB, name: 'Gauges', isPartOf: [LIBRARY],
      currentVersion: JOB_VERSION,
    }],
    [JOB_VERSION, {
      '@type': 'EtlJobVersion', $id: JOB_VERSION, isPartOf: JOB, version: 1,
      sql: 'select 1', sparqlTemplate: 'INSERT DATA {}',
      backendId: 'urn:sqlib:backend:store',
      currentColumnMappingVersion: MAPPING_VERSION,
    }],

    // Reaches its library only through `etlJobVersion` — no `isPartOf` at all.
    [MAPPING, {
      '@type': 'EtlColumnMapping', $id: MAPPING, name: 'Gauge columns',
      etlJobVersion: JOB_VERSION, currentVersion: MAPPING_VERSION,
    }],
    [MAPPING_VERSION, {
      '@type': 'EtlColumnMappingVersion', $id: MAPPING_VERSION,
      isPartOf: MAPPING, version: 1, columns: COLUMNS,
    }],
    [EXECUTION, {
      '@type': 'EtlExecution', $id: EXECUTION,
      etlJobVersion: JOB_VERSION, columnMappingVersion: MAPPING_VERSION,
      status: 'completed', startedAt: '2026-09-14T00:00:00.000Z',
      completedAt: '2026-09-14T00:00:05.000Z', totalRows: 3,
    }],

    // The stranded chain: the job's library is absent from the map.
    [STRANDED_JOB, {
      '@type': 'EtlJob', $id: STRANDED_JOB, name: 'Stranded',
      isPartOf: [GHOST_LIBRARY],
    }],
    [STRANDED_JOB_VERSION, {
      '@type': 'EtlJobVersion', $id: STRANDED_JOB_VERSION, isPartOf: STRANDED_JOB,
      version: 1, sql: 'select 1', sparqlTemplate: 'INSERT DATA {}',
      backendId: 'urn:sqlib:backend:store',
    }],
    // Its job version is not stored at all.
    [STRANDED_EXECUTION, {
      '@type': 'EtlExecution', $id: STRANDED_EXECUTION,
      etlJobVersion: 'urn:sqlib:etl-job-version:deleted',
      columnMappingVersion: MAPPING_VERSION,
      status: 'completed', startedAt: '2026-09-14T00:00:00.000Z',
    }],
  ]);
});

/**
 * Every route that names a stored entity, in both spellings.
 *
 * The short form is the one the plugin hands out, so it is the one that was
 * reachable; the URN form is kept beside it because two of these rows — the
 * execution and the mapping version — were unguarded in *both* spellings until
 * `containerRefsOf` learned `etlJobVersion`.
 */
const SCOPED_ROUTES: ReadonlyArray<[label: string, method: 'GET' | 'PATCH', urn: string]> = [
  ['the job', 'GET', `/etl-jobs/${JOB}`],
  ['the job, annotated', 'PATCH', `/etl-jobs/${JOB}`],
  ['its versions', 'GET', `/etl-jobs/${JOB}/versions`],
  ['one version', 'GET', `/etl-jobs/versions/${JOB_VERSION}`],
  ['its run log', 'GET', `/etl-jobs/${JOB}/executions`],
  ['one run', 'GET', `/etl-jobs/executions/${EXECUTION}`],
  ["a run's output", 'GET', `/etl-jobs/executions/${EXECUTION}/output`],
  ['a column mapping version', 'GET', `/etl-jobs/column-mappings/versions/${MAPPING_VERSION}`],
];

/** The same list with every id in the form the plugin's responses report. */
const shortened = (url: string) => url.replace(/urn:sqlib:[^:/]+:([^/]+)/g, '$1');

describe('/etl-jobs is library-scoped', () => {
  describe.each(SCOPED_ROUTES)('%s', (_label, method, urnUrl) => {
    const shortUrl = shortened(urnUrl);
    const payload = method === 'PATCH' ? { description: 'annotated' } : undefined;

    it('refuses a principal holding no grant, by full URN', async () => {
      const response = await inject(stranger, method, urnUrl, payload);
      expect(response.statusCode, response.body).toBe(403);
    });

    /*
     * The row that was 200 before `shortIdKinds`. It is written as its own
     * expectation rather than folded into the one above so that a regression
     * names the spelling that broke.
     */
    it('refuses the same principal by short id', async () => {
      const response = await inject(stranger, method, shortUrl, payload);
      expect(response.statusCode, response.body).toBe(403);
    });

    it('lets the owning library through', async () => {
      const granted = method === 'PATCH' ? libraryMode('read', 'write') : reader;
      const response = await inject(granted, method, shortUrl, payload);
      // Not 200: `/output` has no file on disk and 404s *after* the guard, and
      // that is the point — reaching the handler at all is what is asserted.
      expect(response.statusCode, response.body).not.toBe(403);
    });

    it('lets `disabled` mode through, as it does everywhere', async () => {
      const response = await inject(authDisabled, method, shortUrl, payload);
      expect(response.statusCode, response.body).not.toBe(403);
    });
  });
});

describe('the collection listing', () => {
  /*
   * A collection GET names no entity, so the guard abstains by construction and
   * the handler is the only thing that can narrow it. Nothing did: every ETL
   * job in the deployment — names, descriptions and the libraries holding them
   * — went to any authenticated principal. The same shape `GET /tests` and
   * `GET /rule-sets` were fixed in, and `route-coverage.test.ts` is what counts
   * the ones still open.
   */
  it('shows a principal holding nothing an empty list, not a 403', async () => {
    const response = await inject(stranger, 'GET', '/etl-jobs');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual([]);
  });

  it('shows the owning library its own jobs', async () => {
    const response = await inject(reader, 'GET', '/etl-jobs');
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().map((job: { id: string }) => job.id)).toEqual([short(JOB)]);
  });

  /*
   * The stranded job is in a library that no longer resolves, so it is in
   * nobody's grants — and must not fall through the filter for that reason.
   */
  it('does not leak a job whose library was deleted', async () => {
    const response = await inject(reader, 'GET', '/etl-jobs');
    expect(response.json().map((job: { id: string }) => job.id)).not.toContain(short(STRANDED_JOB));
  });

  it('shows `disabled` mode everything, as it does everywhere', async () => {
    const response = await inject(authDisabled, 'GET', '/etl-jobs');
    expect(response.json()).toHaveLength(2);
  });
});

describe('creating a job', () => {
  /*
   * `POST /` names its container in the body rather than the path, and that is
   * a second place the short spelling reaches. `shortIdKinds` re-asks for a
   * *path* parameter; the guard's body branch resolves `libraryId` as written,
   * so on the spelling this plugin's own clients hold it found nothing and
   * abstained — leaving the create unchecked, the hole the `:id` routes had.
   *
   * Asked in the handler, in the form the cache is keyed by, and through
   * `requireLibraryMode`, which refuses on a library that does not resolve
   * where the guard abstains.
   */
  const body = (libraryId: string) => ({ name: 'New job', libraryId });

  it('refuses a principal holding nothing on the library named', async () => {
    const response = await inject(stranger, 'POST', '/etl-jobs', body(short(LIBRARY)));
    expect(response.statusCode, response.body).toBe(403);
  });

  it('refuses a reader, since creating is a write', async () => {
    const response = await inject(reader, 'POST', '/etl-jobs', body(short(LIBRARY)));
    expect(response.statusCode, response.body).toBe(403);
  });

  it('refuses the short and the full spelling alike', async () => {
    const response = await inject(reader, 'POST', '/etl-jobs', body(LIBRARY));
    expect(response.statusCode, response.body).toBe(403);
  });

  it('lets a writer on that library through the check', async () => {
    const response = await inject(libraryMode('write'), 'POST', '/etl-jobs', body(short(LIBRARY)));
    expect(response.statusCode, response.body).not.toBe(403);
  });

  /*
   * `requireLibraryMode(null)` denies, so a body naming a library that is not
   * stored is refused rather than abstained on — the create is the one route
   * where abstaining would write the entity anyway.
   */
  it('refuses a library that resolves to nothing rather than abstaining', async () => {
    const response = await inject(
      libraryMode('write'), 'POST', '/etl-jobs', body(short(GHOST_LIBRARY)),
    );
    expect(response.statusCode, response.body).toBe(403);
  });
});

describe('what the guard must not start refusing', () => {
  /*
   * The rule the short-id lookup had to preserve: a miss is a 404 the handler
   * will produce, and answering 403 instead would tell an unprivileged caller
   * which ids exist.
   */
  it('abstains on an id that resolves under no prefix', async () => {
    const response = await inject(stranger, 'GET', '/etl-jobs/no-such-job');
    expect(response.statusCode, response.body).toBe(404);
  });

  it('abstains on a full URN that is not stored', async () => {
    const response = await inject(stranger, 'GET', '/etl-jobs/urn:sqlib:etl-job:absent');
    expect(response.statusCode, response.body).toBe(404);
  });

  /*
   * A short id is re-minted under the declared prefixes only. `hydrology` is a
   * real library id, and `urn:sqlib:etl-job:hydrology` is not an entity, so
   * this must stay a 404 rather than resolving the library and scoping to it.
   */
  it('does not reach outside the prefixes the plugin declares', async () => {
    const response = await inject(stranger, 'GET', `/etl-jobs/${short(LIBRARY)}`);
    expect(response.statusCode, response.body).toBe(404);
  });
});

describe('a container that is gone', () => {
  /*
   * `resolveOwningLibrary` answers null for "unowned" and for "owned by
   * something deleted", and only the second is a denial. Both of these reach it
   * through `etlJobVersion`, which is the key `containerRefsOf` gained — so
   * without the matching change in `danglingContainer` they would abstain here
   * while resolving there.
   */
  it('refuses a run whose job version is not stored', async () => {
    const response = await inject(stranger, 'GET', `/etl-jobs/executions/${short(STRANDED_EXECUTION)}`);
    expect(response.statusCode, response.body).toBe(403);
  });

  /*
   * And the boundary of that rule, recorded rather than argued about.
   *
   * `STRANDED_JOB_VERSION` names a job that *is* stored; the job names a
   * library that is not. `danglingContainer` asks only about the entity's own
   * container, which resolves — so the guard abstains, exactly as its docblock
   * says it does for "a container that resolves but is not a library".
   *
   * That is a deliberate limit and not this change's to move: the same shape is
   * every query in a group whose library was deleted, and widening the check to
   * walk the chain would change what every plugin refuses. Pinned here so the
   * hole has a size and a name — and so that whoever does move it finds a test
   * that fails and says why, rather than silence.
   */
  it('abstains one link further out, where the deletion is the job\'s library', async () => {
    const response = await inject(stranger, 'GET', `/etl-jobs/versions/${short(STRANDED_JOB_VERSION)}`);
    expect(response.statusCode, response.body).toBe(200);
  });
});

describe('the id space this plugin is the exception for', () => {
  /*
   * Every row above is a consequence of one property of one module, and
   * nothing in `src/` says which module. A second service that shortened ids
   * would reproduce all of them in full, silently, with its plugin's guard
   * registered and green — so the property is pinned here rather than left as
   * a paragraph in a design note.
   *
   * The match is the shortening itself: stripping a `urn:sqlib:<kind>:` prefix
   * off an id that is about to leave the process. Finding it somewhere new is
   * not a bug on its own — it means that plugin needs `shortIdKinds` on its
   * guard and a suite like this one.
   */
  const SHORTENS_IDS = /urn:sqlib:\[\^:\]\+:|urn:sqlib:\[a-zA-Z0-9-\]\+:/;

  async function sourceFiles(dir: string): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...await sourceFiles(full));
      else if (entry.name.endsWith('.ts')) files.push(full);
    }
    return files;
  }

  it('is EtlService and nothing else', async () => {
    const root = fileURLToPath(new URL('../../src/', import.meta.url));
    const shortening: string[] = [];
    for (const file of await sourceFiles(root)) {
      const source = await readFile(file, 'utf8');
      // The replace, not the regex literal in a comment: a `.replace(` on the
      // line is what makes it a conversion rather than a mention.
      for (const line of source.split('\n')) {
        if (SHORTENS_IDS.test(line) && line.includes('.replace(')) {
          shortening.push(relative(root, file));
          break;
        }
      }
    }

    expect(
      shortening,
      'A service that strips the `urn:sqlib:` prefix off ids serves ids the '
      + 'entity guard cannot resolve: it will miss the cache and abstain on '
      + 'every route of the plugin above it. Give that plugin `shortIdKinds` on '
      + 'its `registerEntityAuthGuard` call and a suite like this one, then add '
      + 'it here.',
    ).toEqual(['lib/EtlService.ts']);
  });
});
