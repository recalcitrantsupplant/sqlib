/**
 * `docs/guides/etl.md` §3, executed against the real route plugins.
 *
 * §3 names the routes that take arbitrary DuckDB SQL and says both require
 * administrator access under `SQLIB_AUTH_MODE=required` — the claim
 * `docs/guides/rest-api-walkthrough.md` repeats to a client
 * deciding what to turn on. Submitted SQL is a host filesystem read primitive,
 * so the bar is not "authenticated" and not "holds every grant on every
 * library"; it is administrator.
 *
 * Half of that was checked and half was prose. `POST /playground/etl/execute`
 * is covered against its real plugin by `routes/playground.etl.test.ts`.
 * `POST /etl-jobs/preview` was covered only by `route-matrix.test.ts`, whose
 * app is a stand-in that *re-declares* `adminSuffixes: ['/preview']` on a
 * plugin of its own — so it pins the guard's shape and can say nothing about
 * whether the real `etl-jobs` plugin still asks for it. Deleting
 * `adminSuffixes: ['/preview']` from `src/routes/etl-jobs.ts` left the whole
 * `packages/api` suite green: 3,394 tests, no failure, a route documented as
 * administrator-only open to any authenticated principal.
 *
 * So this mounts the real plugins and runs real contexts at them, and it takes
 * the route list out of §3 rather than repeating it here. Both directions
 * fail: a route added to §3 that no guard refuses, and a guard deleted from a
 * route §3 names.
 */
import { describe, it, expect, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';
import type { AuthContext } from '../../src/auth/types.js';

const DOC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/guides/etl.md',
);

/*
 * Nothing here reaches a store or a DuckDB process: every assertion is about
 * who is turned away at the door. The stubs exist so the *admitted* case ends
 * in some ordinary failure rather than hanging, since "not 403" is what proves
 * the check discriminates instead of refusing everyone.
 */
vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    get: () => null,
    addEphemeral: (entity: unknown) => entity,
    removeEphemeral: () => {},
  }),
  getEntityRepositories: () => ({}),
}));

vi.mock('../../src/config/featureFlags.js', () => ({
  getFeatureFlags: () => ({ etl: true, playgroundEtl: true }),
}));

vi.mock('../../src/lib/EtlService.js', () => ({
  etlService: {
    preview: () => Promise.reject(new Error('stubbed: the SQL is never run here')),
  },
}));

vi.mock('../../src/lib/DuckDbService.js', () => ({
  duckDbService: {
    streamChunks: () => {
      throw new Error('stubbed: the SQL is never run here');
    },
  },
}));

/**
 * The routes listed under "Who may submit SQL" in the ETL guide.
 *
 * Matched on the heading's words rather than a section number: the guide is
 * prose a person maintains, and a renumbering should not silently empty this
 * list — which is what would make the assertions below pass by measuring
 * nothing.
 */
async function routesNamedInSqlSection(): Promise<string[]> {
  const markdown = await fs.readFile(DOC, 'utf8');
  const section = markdown.match(/^## Who may submit SQL[^\n]*\n([\s\S]*?)(?=^## )/m);
  expect(section, `No "## Who may submit SQL" section in ${DOC}`).not.toBeNull();

  const routes = [...section![1].matchAll(/^- `(POST|PUT|PATCH|GET|DELETE) (\/\S*)`/gm)]
    .map(match => `${match[1]} ${match[2]}`);
  return [...new Set(routes)].sort();
}

/*
 * Which plugin mounts each path, and where. Derived from the path's first
 * segment rather than listed per route, so a second admin-only route on a
 * plugin already here needs no entry — and asserted complete below, so one on
 * a plugin that is *not* here fails by name instead of being skipped.
 */
const PLUGINS: Record<string, string> = {
  '/etl-jobs': '../../src/routes/etl-jobs.js',
  '/playground': '../../src/routes/playground.js',
};

/** The real plugin that serves `route`, mounted alone, answering as `context`. */
async function appFor(route: string, context: AuthContext): Promise<FastifyInstance> {
  const prefix = `/${route.split(' ')[1].split('/')[1]}`;
  const specifier = PLUGINS[prefix];
  expect(specifier, `No plugin mapped for the prefix "${prefix}" (route ${route})`).toBeDefined();

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

  const plugin = (await import(specifier)).default;
  await app.register(plugin as never, { prefix });
  await app.ready();
  return app;
}

const LIBRARY = 'urn:sqlib:library:everything';

/**
 * A principal holding every mode on a library, and not administrator. The
 * point of §3 is that this is still not enough: "may do anything to my own
 * queries" is not "may read the host filesystem".
 */
const grantedButNotAdmin: AuthContext = {
  subject: 'urn:sqlib:principal:user:owner',
  principals: ['urn:sqlib:principal:user:owner', 'urn:sqlib:principal:authenticated'],
  issuer: 'https://issuer.test/',
  tokenType: 'user',
  grants: {
    admin: false,
    backends: new Map(),
    libraries: new Map([[LIBRARY, new Set(['read', 'write', 'execute', 'delete', 'control'] as const)]]),
  },
  claims: {},
  fullAccess: false,
  mode: 'required',
};

const administrator: AuthContext = {
  ...grantedButNotAdmin,
  subject: 'urn:sqlib:principal:user:admin',
  principals: ['urn:sqlib:principal:user:admin', 'urn:sqlib:principal:authenticated'],
  grants: { ...grantedButNotAdmin.grants, admin: true },
};

/** What `disabled` mode hands every request: no principal, full access. */
const authDisabled: AuthContext = {
  ...grantedButNotAdmin,
  subject: 'urn:sqlib:principal:anonymous',
  principals: [],
  issuer: null,
  grants: { admin: false, backends: new Map(), libraries: new Map() },
  fullAccess: true,
  mode: 'disabled',
};

/**
 * A body the route's schema accepts, so a 400 from validation cannot be
 * mistaken for the refusal being tested. It is never executed: SQL reaching
 * DuckDB would mean the guard let it through, which is the thing asserted
 * against.
 */
const BODIES: Record<string, object> = {
  'POST /etl-jobs/preview': {
    sql: "SELECT 'nobody runs this' AS name",
    limit: 1,
  },
  'POST /playground/etl/execute': {
    sql: "SELECT 'nobody runs this' AS name",
    sparqlTemplate: 'CONSTRUCT { ?s ?p ?o } WHERE { VALUES (?name) { (UNDEF) } }',
    backendId: 'urn:sqlib:backend:ephemeral',
    columns: [{ columnName: 'name', targetVariable: '?name', termType: 'literal', nullPolicy: 'undef' }],
  },
};

describe('the SQL-taking routes the ETL guide names', () => {
  it('names routes at all, and every one of them is mapped to a plugin', async () => {
    const routes = await routesNamedInSqlSection();

    // A guard that enumerates nothing passes vacuously.
    expect(routes.length).toBeGreaterThanOrEqual(2);
    expect(routes).toContain('POST /etl-jobs/preview');
    expect(routes).toContain('POST /playground/etl/execute');

    const unmapped = routes.filter(route => !(`/${route.split(' ')[1].split('/')[1]}` in PLUGINS));
    expect(unmapped, 'Routes in §3 with no plugin in PLUGINS to mount them from').toEqual([]);
    const unbodied = routes.filter(route => !(route in BODIES));
    expect(unbodied, 'Routes in §3 with no request body to send them').toEqual([]);
  });

  it('refuses a principal who holds every library grant but is not administrator', async () => {
    for (const route of await routesNamedInSqlSection()) {
      const [method, url] = route.split(' ');
      const app = await appFor(route, grantedButNotAdmin);
      const response = await app.inject({ method: method as 'POST', url, payload: BODIES[route] });
      await app.close();

      expect(response.statusCode, `${route} admitted a non-administrator`).toBe(403);
      expect(JSON.parse(response.body).error).toMatch(/administrator/i);
    }
  });

  it('admits an administrator, so the refusal discriminates rather than blocking everyone', async () => {
    for (const route of await routesNamedInSqlSection()) {
      const [method, url] = route.split(' ');
      const app = await appFor(route, administrator);
      const response = await app.inject({ method: method as 'POST', url, payload: BODIES[route] });
      await app.close();

      // Not the success code: the stubbed service fails on purpose, and where
      // it fails is `routes/playground.etl.test.ts`'s business rather than
      // this file's. Getting past the door is what is asserted.
      expect(response.statusCode, `${route} refused an administrator`).not.toBe(403);
    }
  });

  it('is a no-op under the default disabled mode, as the guide says', async () => {
    for (const route of await routesNamedInSqlSection()) {
      const [method, url] = route.split(' ');
      const app = await appFor(route, authDisabled);
      const response = await app.inject({ method: method as 'POST', url, payload: BODIES[route] });
      await app.close();

      // The flag, not the authorization check, is what protects a default
      // deployment — which is why ETL ships off.
      expect(response.statusCode, `${route} refused a request in disabled mode`).not.toBe(403);
    }
  });
});
