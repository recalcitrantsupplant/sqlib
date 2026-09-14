/**
 * Every route, classified — the completeness half of the route matrix.
 *
 * `route-matrix.test.ts` runs principals against stand-in plugins shaped like
 * the real ones. That checks the *guard shapes* thoroughly and route coverage
 * not at all: its app is synthetic, so adding a real route changes nothing it
 * looks at. Its header claims to be "the test that fails when someone adds a
 * route without thinking about who may call it", and it could not be, because
 * it never saw the real route table.
 *
 * This registers the real plugins, enumerates what Fastify actually mounted,
 * and requires every one to appear in the manifest below with a stated
 * classification. Adding a route fails this test by name until someone writes
 * down who may call it; deleting one fails it too, so the manifest cannot
 * quietly describe a route table that no longer exists.
 *
 * The classification is what the guard *does* today, which is not always what
 * it should do — see `unguarded-unowned` below.
 */
import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupValidator } from '../../src/lib/validator-setup.js';
import * as schemas from '@sparql-query-lib/contracts/schema';

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({ get: () => null }),
  getEntityRepositories: () => ({}),
}));

/**
 * How a route is protected.
 *
 * - `read` / `write` / `delete` / `execute` — the guard resolves the entity in
 *   the path to its owning library and requires that mode on it.
 * - `write-from-body` — no `:id` in the path, so the container comes from the
 *   body's `isPartOf` / `library` / `targetEntity`.
 * - `execute-from-body` — the same shape one mode along: no `:id` either, and
 *   the handler requires Execute on the library owning the body's `targetId`.
 *   Unlike the guard it *refuses* when that library does not resolve, because
 *   `requireLibraryMode(null)` denies where the guard abstains.
 * - `handler` — the route guard cannot resolve a single library, and the
 *   handler does the checking itself, per library the request reaches.
 * - `stateless` — the route reads no stored entity: it analyses text from the
 *   request body and answers. There is nothing to resolve and nothing to
 *   check, which is what the guard's `exemptSuffixes` is for. The claim is
 *   about the *handler*, not the path — a route whose suffix matches but which
 *   loads an entity is not this (see `POST /rule-sets/:id/srl/preview`).
 * - `unguarded-unowned` — the entity has no owning library, so the guard
 *   abstains and nothing else checks. **This is a hole, not a design.** It is
 *   recorded rather than hidden so that the count is visible and a fix has
 *   something to delete.
 * - `readable-listing` — a collection GET with no id to resolve, answered
 *   through `filterReadable`: the caller sees the entities whose library it
 *   may read, and an empty array rather than a 403 when that is none.
 * - `unfiltered-listing` — a collection GET that returns every entity of its
 *   kind in the deployment, whatever the caller holds. Also a hole rather than
 *   a design, and counted like `unguarded-unowned` below.
 * - `backend-handler` — the route is scoped to a *backend* rather than a
 *   library, and the handler requires a `BackendMode` on it. `/patches` is the
 *   whole of this: a `Patch.isPartOf` names the backend the patch was derived
 *   against, so `resolveOwningLibrary` has nothing to find and the plugin
 *   registers no entity guard at all — correctly, since a guard that abstained
 *   on every route would read as coverage. Library grants say nothing about
 *   these routes in either direction.
 *
 * `readable-listing` and `unfiltered-listing` were one value, `unrestricted-
 * listing`, glossed as "returns what the caller may see, filtered downstream".
 * That was true of `/queries` and false of `/tests`, where nothing downstream
 * filtered anything — a classification is a claim about the handler, so the
 * two cases now have two names and the wrong one is countable.
 */
type Protection =
  | 'read' | 'write' | 'delete' | 'execute'
  | 'write-from-body' | 'execute-from-body' | 'handler' | 'stateless'
  | 'backend-handler'
  | 'unguarded-unowned' | 'readable-listing' | 'unfiltered-listing';

const MANIFEST: Record<string, Protection> = {
  /*
   * Benchmark experiments are account-level: the schema has no `isPartOf`, so
   * `resolveOwningLibrary` returns null and the entity guard abstains on every
   * one of these routes. `benchmarks.ts` adds no handler-level check either.
   *
   * In `required` mode that means any authenticated principal — including one
   * holding no grants at all — may read, rewrite, delete and run any benchmark
   * experiment in the deployment. `route-matrix.test.ts` pins that behaviour
   * as it stands, labelled, so the fix has a failing expectation to flip
   * rather than a silent gap to discover.
   *
   * The listing below is unfiltered for the same reason: there is nothing to
   * filter it *by*. It is the one `unfiltered-listing` that a `filterReadable`
   * call would not fix — that would empty the collection for everyone below
   * admin — so it moves when experiments gain a scope, with the rows under it.
   */
  'GET /benchmark-experiments': 'unfiltered-listing',
  'POST /benchmark-experiments': 'unguarded-unowned',
  'GET /benchmark-experiments/:id': 'unguarded-unowned',
  'PUT /benchmark-experiments/:id': 'unguarded-unowned',
  'DELETE /benchmark-experiments/:id': 'unguarded-unowned',
  'GET /benchmark-experiments/:id/v': 'unguarded-unowned',
  'POST /benchmark-experiments/:id/v': 'unguarded-unowned',
  'GET /benchmark-experiments/:id/v/:version': 'unguarded-unowned',
  'PATCH /benchmark-experiments/:id/v/:version': 'unguarded-unowned',
  'GET /benchmark-experiments/:id/v/:version/runs': 'unguarded-unowned',
  'POST /benchmark-experiments/:id/v/:version/freeze': 'unguarded-unowned',
  'POST /benchmark-experiments/:id/v/:version/run': 'unguarded-unowned',
  'GET /benchmark-experiments/runs/:id': 'unguarded-unowned',
  'GET /benchmark-experiments/runs/:id/observations': 'unguarded-unowned',
  'GET /benchmark-experiments/runs/:id/node-observations': 'unguarded-unowned',
  'GET /benchmark-experiments/runs/:id/iteration-observations': 'unguarded-unowned',

  // Tests are library-scoped, so the guard resolves and enforces normally.
  'GET /tests': 'readable-listing',
  'POST /tests': 'write-from-body',
  'GET /tests/:id': 'read',
  'PUT /tests/:id': 'write',
  'DELETE /tests/:id': 'delete',
  'GET /tests/:id/versions': 'read',
  'POST /tests/:id/versions': 'write',
  'GET /tests/:id/versions/:version': 'read',
  'PATCH /tests/:id/versions/:version': 'write',
  'DELETE /tests/:id/versions/:version': 'delete',
  'POST /tests/:id/run': 'execute',
  // History, not execution: reading what a run said needs Read on the library,
  // the same as reading the test it judged.
  'GET /tests/:id/runs': 'read',
  'GET /tests/:id/runs/:runId': 'read',
  /*
   * Run-by-tag names no entity in its path. The guard reads the optional
   * `library` body key to narrow, and the handler then requires Execute on
   * *every* library the tag selection reaches — which is the check that
   * matters, since a tag selection can span libraries the guard could not have
   * resolved to one answer.
   */
  'POST /tests/run': 'handler',

  /*
   * Queries are library-scoped, and the plugin re-checks in the handler on
   * every route where the entity it serves is not the one the guard resolved.
   * That is not belt and braces: the guard resolves the `:id` through the
   * cache and abstains on a miss, on the stated ground that "a miss is a 404
   * the handler will produce" — which holds only for a handler reading the
   * same id. The three version routes read `QueryVersion` and match on
   * `isPartOf`, so they check the version they are about to serve. See
   * `queryVersionRoutes.test.ts`, which runs real principals at them.
   */
  'GET /queries': 'readable-listing',
  'POST /queries': 'write-from-body',
  'GET /queries/:id': 'read',
  'PUT /queries/:id': 'write',
  'DELETE /queries/:id': 'delete',
  'GET /queries/:id/v': 'read',
  'POST /queries/:id/v': 'write',
  'GET /queries/:id/v/:version': 'read',
  'PATCH /queries/:id/v/:version': 'write',
  // An argument set is created under the query it targets, so the query's
  // library decides both of these — Read to list, Write to add one.
  'GET /queries/:id/argument-sets': 'read',
  'POST /queries/:id/argument-sets': 'write',

  /*
   * `/execute` registers no guard at all: the target is named in the body (or
   * the querystring), so there is no `:id` for the guard to resolve, and the
   * shared handler requires Execute on the target's owning library before
   * anything runs. Execute is independent of Read by design (§4.2), and the
   * backend the request reaches is checked separately by `ExecutorFactory`,
   * which carries the caller's grants into every leg of a group.
   */
  'POST /execute': 'execute-from-body',
  'GET /execute': 'execute-from-body',

  /*
   * Tuple sets are library-scoped. The three `/versions/:version` routes match
   * versions on `isPartOf` and never read the set in the path, so the guard's
   * abstain-on-miss does not cover them and each checks the version it is
   * about to serve — `read`, `write` and `delete` respectively, asserted
   * against real principals in `tupleSetVersionRoutes.test.ts`. The two
   * `/versions` routes do read the set and 404, which is what makes the
   * guard's classification the whole story for them.
   */
  'GET /tuple-sets': 'readable-listing',
  'POST /tuple-sets': 'write-from-body',
  'GET /tuple-sets/:id': 'read',
  'PUT /tuple-sets/:id': 'write',
  'DELETE /tuple-sets/:id': 'delete',
  'GET /tuple-sets/:id/versions': 'read',
  'POST /tuple-sets/:id/versions': 'write',
  /*
   * Write on this tuple set's library, *and* Execute on the library owning the
   * ETL job version whose SQL is about to run (`tupleSetFromEtl.ts`, #211):
   * without the second, Write on one library would run any other library's
   * stored DuckDB SQL.
   */
  'POST /tuple-sets/:id/versions/from-etl': 'write',
  'GET /tuple-sets/:id/versions/:version': 'read',
  'PATCH /tuple-sets/:id/versions/:version': 'write',
  'DELETE /tuple-sets/:id/versions/:version': 'delete',
  /*
   * Exempt, and correctly: both parse a string from the body and store
   * nothing. They are the reason `exemptSuffixes` exists, and the contrast
   * with the rule-set plugin's `/preview` — which named an entity — is what
   * makes "touches no stored entity" the test rather than the suffix.
   */
  'POST /tuple-sets/detect-format': 'stateless',
  'POST /tuple-sets/preview': 'stateless',

  /*
   * Rule sets are library-scoped too, with three routes worth naming.
   *
   * `PATCH /:id/versions/:version` is the tuple-set shape again: it matches on
   * `isPartOf` where its GET and DELETE siblings fetch the set and 404, so it
   * checks the version it is about to annotate.
   *
   * `POST /:id/srl/preview` was exempt from the guard — the plugin inherited
   * `exemptSuffixes: ['/preview', …]` from the plugins that have a stateless
   * preview, and this plugin's only `/preview` route names an entity and reads
   * its stored composition. Guarded as the POST it is now.
   *
   * The three `/srl/*` helpers at the end are the genuinely stateless ones:
   * they compile, analyse and convert text from the body and store nothing, so
   * there is no entity for the guard to resolve and nothing to check.
   * `ruleSetRoutes.test.ts` runs real principals at the first two.
   */
  'GET /rule-sets': 'readable-listing',
  'POST /rule-sets': 'write-from-body',
  'GET /rule-sets/:id': 'read',
  'PUT /rule-sets/:id': 'write',
  'DELETE /rule-sets/:id': 'delete',
  'GET /rule-sets/:id/versions': 'read',
  'POST /rule-sets/:id/versions': 'write',
  'GET /rule-sets/:id/versions/:version': 'read',
  'PATCH /rule-sets/:id/versions/:version': 'write',
  'DELETE /rule-sets/:id/versions/:version': 'delete',
  'POST /rule-sets/:id/execute': 'execute',
  'POST /rule-sets/:id/execute/stream': 'execute',
  'GET /rule-sets/:id/srl': 'read',
  'POST /rule-sets/:id/srl': 'write',
  'POST /rule-sets/:id/srl/preview': 'write',
  'POST /rule-sets/srl/compile': 'stateless',
  'POST /rule-sets/srl/analyze': 'stateless',
  'POST /rule-sets/srl/from-sparql': 'stateless',

  /*
   * Rules are library-scoped, and this is the plugin where the guard's
   * abstain-on-miss premise holds everywhere: every `:id` route reads
   * `repos.Rule.get(id)` and 404s before it does anything, including all three
   * `/versions/:version` routes — the shape `tests.ts` has and `queries.ts`,
   * `tuple-sets.ts` and `rule-sets.ts` did not. So the classification below is
   * the guard's own decision and the whole story.
   *
   * `POST /preview/normalize` is genuinely stateless: it validates a
   * `ruleString` from the body and answers with its normalized form. The
   * plugin's exempt list is now exactly that one path — it also carried a bare
   * `/preview`, and its execute list `/execute/stream` and `/run`, none of
   * which it mounts.
   */
  'GET /rules': 'readable-listing',
  'POST /rules': 'write-from-body',
  'GET /rules/:id': 'read',
  'PUT /rules/:id': 'write',
  'DELETE /rules/:id': 'delete',
  'GET /rules/:id/versions': 'read',
  'POST /rules/:id/versions': 'write',
  // Iterative evaluation against an ephemeral store: Execute, not Write, even
  // though it is a POST.
  'POST /rules/:id/execute': 'execute',
  'GET /rules/:id/versions/:version': 'read',
  'PATCH /rules/:id/versions/:version': 'write',
  'DELETE /rules/:id/versions/:version': 'delete',
  'POST /rules/preview/normalize': 'stateless',

  /*
   * Data blocks are the same shape again: every `:id` route fetches the block
   * and 404s, so the guard covers the version routes too. The plugin declared
   * five execute/exempt suffixes and mounts no route for any of them.
   */
  'GET /data-blocks': 'readable-listing',
  'POST /data-blocks': 'write-from-body',
  'GET /data-blocks/:id': 'read',
  'PUT /data-blocks/:id': 'write',
  'DELETE /data-blocks/:id': 'delete',
  'GET /data-blocks/:id/versions': 'read',
  'POST /data-blocks/:id/versions': 'write',
  'GET /data-blocks/:id/versions/:version': 'read',
  'PATCH /data-blocks/:id/versions/:version': 'write',
  'DELETE /data-blocks/:id/versions/:version': 'delete',

  /*
   * Data graphs, with one route that needs more than its classification says.
   *
   * `POST /:id/versions/from-query` is `write` on the graph's own library —
   * *and* Execute on the library owning the `QueryVersion` whose stored query
   * is about to run, which `materializeDataGraphVersionFromQuery` now requires
   * (`dataGraphFromQuerySource.test.ts`). Exactly the pair
   * `POST /tuple-sets/:id/versions/from-etl` carries, and for the same reason:
   * without the second, Write on one library ran any other library's saved
   * query and kept the graph it produced.
   *
   * The backend is checked separately, by `assertBackendAccess` through the
   * graph's library `allowedBackends` — which is why the query check is not
   * redundant: the backend a caller may reach says nothing about whose query
   * they may send to it.
   */
  'GET /data-graphs': 'readable-listing',
  'POST /data-graphs': 'write-from-body',
  'GET /data-graphs/:id': 'read',
  'PUT /data-graphs/:id': 'write',
  'DELETE /data-graphs/:id': 'delete',
  'GET /data-graphs/:id/versions': 'read',
  'POST /data-graphs/:id/versions': 'write',
  'POST /data-graphs/:id/versions/from-query': 'write',
  'GET /data-graphs/:id/versions/:version': 'read',
  'PATCH /data-graphs/:id/versions/:version': 'write',
  'DELETE /data-graphs/:id/versions/:version': 'delete',

  /*
   * Argument sets, swept with the question #483 handed on: **does this route
   * name a second entity in its body, and what is the caller doing with it?**
   * Here it does, twice over, and the answer was "reading it".
   *
   * A tuple binding may pin `tupleSetVersions` and a graph binding may pin
   * `dataGraphVersionId` — stored entities that need not live in the library
   * the set is written to. The guard reads `libraryId` off the body and checks
   * Write *there*; nothing looked at the pins, and `exportRuntimePayload`
   * resolves both to content. So Write on a library you hold bought a read of
   * rows and triples out of one you hold nothing on, through the export routes.
   * `ArgumentSetService.createVersion` requires Read on each pinned version's
   * library now — the pair `from-etl` and `from-query` carry, by a third door —
   * and `argumentSetPinnedSources.test.ts` runs real principals at it.
   *
   * `GET /argument-sets` is `handler` rather than a listing: `libraryId` is a
   * required *querystring* parameter, which the guard cannot see
   * (`containerRefsFrom` reads the body), and the handler requires Read on it.
   * It refuses rather than filtering, which is why it is neither listing value.
   *
   * The three `/v/:version` routes match versions on `isPartOf` and never read
   * the set in the path, so each checks the version it serves — the shape that
   * was a live hole in `queries.ts` and `tuple-sets.ts`. It is not known to be
   * reachable here (`ArgumentSetService.delete` cascades, unlike
   * `repos.Query.delete`), which `argumentSetVersionRoutes.test.ts` says in its
   * header rather than leaving as an implication.
   *
   * `GET /:id/export` takes either spelling — a set id or a version id — and
   * the guard resolves both, a version through `isPartOf` to its set to the
   * library.
   */
  'GET /argument-sets': 'handler',
  'POST /argument-sets': 'write-from-body',
  'GET /argument-sets/:id': 'read',
  'DELETE /argument-sets/:id': 'delete',
  'GET /argument-sets/:id/export': 'read',
  'GET /argument-sets/:id/v': 'read',
  'POST /argument-sets/:id/v': 'write',
  'GET /argument-sets/:id/v/:version': 'read',
  'PATCH /argument-sets/:id/v/:version': 'write',
  'GET /argument-sets/:id/v/:version/export': 'read',

  /*
   * Patches are the first plugin swept that is not library-scoped at all, and
   * the first that registers no entity guard — both correct. `Patch.isPartOf`
   * names the *backend* the patch was derived against, so there is no library
   * for `resolveOwningLibrary` to reach and a guard would abstain on every
   * route while looking like coverage. Each handler requires a `BackendMode`
   * on that backend instead, and an unresolvable backend is refused, since
   * `requireBackendMode(null)` denies.
   *
   * The `use`/`write` split on identical-looking routes is the feature rather
   * than an oversight: preview is read-only by construction — two CONSTRUCTs
   * and an existence check — so a caller who may use a backend can be shown
   * what a write would do without being trusted to do it, which is the whole
   * trust story for agent-proposed writes (`2026-08-25-rdf-patch-write-
   * patterns.md` §6). `GET /:id` reads a derived diff, so it takes `use` too.
   */
  'POST /patches/preview': 'backend-handler',
  'POST /patches/apply': 'backend-handler',
  'POST /patches/:id/revert': 'backend-handler',
  'GET /patches/:id': 'backend-handler',
};

const PLUGINS: ReadonlyArray<[specifier: string, prefix: string]> = [
  ['../../src/routes/benchmarks.js', '/benchmark-experiments'],
  ['../../src/routes/tests.js', '/tests'],
  ['../../src/routes/queries.js', '/queries'],
  ['../../src/routes/execute.js', '/execute'],
  ['../../src/routes/tuple-sets.js', '/tuple-sets'],
  ['../../src/routes/rule-sets.js', '/rule-sets'],
  ['../../src/routes/rules.js', '/rules'],
  ['../../src/routes/data-blocks.js', '/data-blocks'],
  ['../../src/routes/data-graphs.js', '/data-graphs'],
  ['../../src/routes/argument-sets.js', '/argument-sets'],
  ['../../src/routes/patches.js', '/patches'],
];

/*
 * The plugins this file does not sweep yet, named so the gap is a debt with a
 * size rather than an impression. "Every route, classified" is true of the
 * eleven plugins above and of nothing else: the other eleven can gain a route,
 * or lose the guard on one, with every test here still green.
 *
 * Each entry is a manifest somebody has to write, so they land as they are
 * worked on rather than in one unreviewable sweep. What must not happen
 * silently is a *new* route file joining them, which is what the pin below is
 * for — `src/routes/*.ts` with a default export is either swept or listed, and
 * a twenty-third fails this test by name until someone chooses which.
 *
 * `etl-jobs` and `playground` are the two that carry a published security
 * claim (`docs/guides/etl.md`, "Who may submit SQL": those routes are administrator-
 * only). Until they are swept here, that claim is pinned against the real
 * plugins by `sqlRoutesAdminOnly.test.ts` rather than by a classification.
 *
 * The three named here last time — `rules.ts`, `data-blocks.ts` and
 * `data-graphs.ts`, whose collection GETs looked like `GET /rule-sets` before
 * it learned to filter — are swept above now, and the grep was right about all
 * three: each listed every entity of its kind in the deployment. What it could
 * not see is the rest of what asking the manifest's question turned up.
 *
 * `argument-sets.ts` and `patches.ts` are swept above now too, with the
 * question that sweep handed on — *does this route name a second entity in its
 * body, and what is the caller doing with it?* Argument sets answered it twice
 * and patches not at all, which is the more useful pair than it sounds.
 *
 * `query-groups.ts` was named in the same breath as those two and is **not**
 * swept here. Its `POST /:id/argument-sets` shares the fix above — it reaches
 * `createForTarget`, so the pins in its body are checked — but the plugin has
 * thirteen more routes and a `/:id/v/:version/validate` that composes a group's
 * legs, and settling those wants what settled this one rather than a guess.
 */
const NOT_SWEPT: readonly string[] = [
  'assistant.ts',
  'auth.ts',
  'backends.ts',
  'detection.ts',
  'etl-jobs.ts',
  'events.ts',
  'libraries.ts',
  'playground.ts',
  'query-groups.ts',
  'sparql.ts',
  'tags.ts',
];

/** Every `src/routes/*.ts` that is a Fastify plugin, by file name. */
async function routePluginFiles(): Promise<string[]> {
  const dir = fileURLToPath(new URL('../../src/routes/', import.meta.url));
  const files = (await readdir(dir)).filter((name) => name.endsWith('.ts')).sort();

  const plugins: string[] = [];
  for (const name of files) {
    // `route-helpers.ts` and `argument-set-schemas.ts` are shared pieces, not
    // plugins. Asking the file rather than listing them keeps that true.
    const source = await readFile(join(dir, name), 'utf8');
    if (/^export default/m.test(source)) plugins.push(name);
  }
  return plugins;
}

async function mountedRoutes(): Promise<string[]> {
  const app = Fastify({ logger: false });
  setupValidator(app);
  // The shared schema registry the server builds at startup: several route
  // schemas `$ref` into it, and Fastify refuses to build a serializer for a
  // ref it cannot resolve — so without this a plugin fails to mount and its
  // routes go unenumerated rather than unclassified.
  for (const schema of Object.values(schemas)) {
    if (schema && typeof schema === 'object' && '$id' in schema) app.addSchema(schema);
  }

  const seen = new Set<string>();
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      // HEAD is mounted automatically alongside every GET and is the same
      // route as far as who may call it goes.
      if (method === 'HEAD') continue;
      seen.add(`${method} ${route.path}`);
    }
  });

  for (const [specifier, prefix] of PLUGINS) {
    const plugin = (await import(specifier)).default;
    await app.register(plugin as never, { prefix });
  }
  await app.ready();
  await app.close();
  return [...seen].sort();
}

describe('route coverage', () => {
  it('classifies every route the app actually mounts', async () => {
    const mounted = await mountedRoutes();
    const manifested = Object.keys(MANIFEST).sort();

    const unclassified = mounted.filter((route) => !(route in MANIFEST));
    const stale = manifested.filter((route) => !mounted.includes(route));

    expect(
      unclassified,
      'Routes with no entry in MANIFEST. Add one saying who may call each, '
      + 'rather than deleting this expectation.',
    ).toEqual([]);
    expect(
      stale,
      'MANIFEST entries for routes that are no longer mounted.',
    ).toEqual([]);
    expect(mounted).toEqual(manifested);

    // A guard that enumerates nothing passes vacuously.
    expect(mounted.length).toBeGreaterThan(25);
    /*
     * Not the 5s default: this mounts every swept plugin for real, and each one
     * added to `PLUGINS` is another module graph imported and another schema
     * set built. It cleared 5s comfortably when run alone and did not under a
     * full parallel suite, which is a property of the machine rather than of
     * the route table — so the budget is stated rather than left to be
     * rediscovered by the next sweep that adds a plugin.
     */
  }, 60_000);

  it('records how many routes are protected by nothing at all', async () => {
    /*
     * Pinned as a number so it can only move deliberately. Every one of these
     * is a benchmark route: the fix is to give BenchmarkExperiment an owning
     * scope the guard can resolve, at which point this count drops and this
     * expectation is what says so.
     */
    const unguarded = Object.entries(MANIFEST)
      .filter(([, protection]) => protection === 'unguarded-unowned')
      .map(([route]) => route);

    expect(unguarded.length, unguarded.join('\n')).toBe(15);
    expect(unguarded.every((route) => route.includes('/benchmark-experiments'))).toBe(true);
  });

  it('records how many collection listings answer with everything', async () => {
    /*
     * The listing counterpart of the count above, and pinned for the same
     * reason: `unfiltered-listing` is a hole with a size rather than a design.
     * It reached one after `GET /rule-sets` and `GET /tests` learned to filter,
     * and the one left is the benchmark collection, which cannot filter until
     * an experiment has a scope to filter by — so this count and the one above
     * move together or not at all.
     */
    const unfiltered = Object.entries(MANIFEST)
      .filter(([, protection]) => protection === 'unfiltered-listing')
      .map(([route]) => route);

    expect(unfiltered, unfiltered.join('\n')).toEqual(['GET /benchmark-experiments']);
  });

  /*
   * The completeness of the completeness half. Everything above is about the
   * routes of nine plugins; this is about which plugins those are, so "adding
   * a route fails this test by name" cannot quietly mean "adding a route to
   * one of nine files".
   */
  it('accounts for every route plugin, swept or listed as not yet swept', async () => {
    const plugins = await routePluginFiles();
    const swept = PLUGINS.map(([specifier]) => specifier.split('/').pop()!.replace(/\.js$/, '.ts'));

    // A guard that enumerates nothing passes vacuously.
    expect(plugins.length).toBeGreaterThan(15);
    expect(plugins).toContain('tests.ts');

    const unaccounted = plugins.filter(
      (name) => !swept.includes(name) && !NOT_SWEPT.includes(name),
    );
    expect(
      unaccounted,
      'Route plugins that are neither swept by PLUGINS nor listed in NOT_SWEPT. '
      + 'Add a manifest for the routes, or add the file to NOT_SWEPT with the '
      + 'others — but do not let a new route table arrive unclassified and unnamed.',
    ).toEqual([]);

    const gone = [...swept, ...NOT_SWEPT].filter((name) => !plugins.includes(name));
    expect(gone, 'Named plugins that no longer exist.').toEqual([]);

    // Pinned so the number can only move deliberately: down as plugins are
    // swept, and never up without someone saying so.
    expect(NOT_SWEPT.length, NOT_SWEPT.join('\n')).toBe(11);
  });
});
