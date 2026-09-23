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
 * - `read` / `write` / `delete` / `execute` — the entity in the path is resolved
 *   to its owning library and that mode is required on it. Usually by the route
 *   guard; in `libraries.ts` by the handler itself, because the entity in the
 *   path *is* the library and that plugin registers no guard. The claim these
 *   rows make is about the mode required, which is the same either way — see
 *   `library-create` for the one route of that plugin where it is not.
 * - `write-from-body` — no `:id` in the path, so the container comes from the
 *   body's `isPartOf` / `library` / `targetEntity`.
 * - `read-from-body` — the same shape one mode down: no `:id`, nothing stored,
 *   and the handler requires Read on the library the body names. `POST
 *   /assistant/sessions` is the whole of this — a session is not an entity, but
 *   the library it names is the one its drafts are staged for.
 * - `execute-from-body` — the same shape one mode along: no `:id` either, and
 *   the handler requires Execute on the library owning the body's `targetId`.
 *   Unlike the guard it *refuses* when that library does not resolve, because
 *   `requireLibraryMode(null)` denies where the guard abstains.
 * - `handler` — the route guard cannot resolve a single library, and the
 *   handler does the checking itself, per library the request reaches.
 * - `admin` — administrator access outright, whatever the caller's library or
 *   backend grants say. For an operation whose blast radius is not an entity,
 *   so resolution has nothing to check but the capability is not one every
 *   principal should hold: ETL's `/preview` takes arbitrary DuckDB SQL, which
 *   is a host filesystem read primitive (issue #132 §4d) — as does
 *   `POST /playground/etl/execute`, the other half of that claim — and creating,
 *   reconfiguring or deleting a backend is editing the set of stores the
 *   process will connect to — as is reading a backend's env-var names, which
 *   is the same scope that may edit the key itself.
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
 * - `library-create` — the route creates the container everything else is
 *   checked against, so there is nothing to resolve it to. `requireLibraryCreate`
 *   applies the deployment's creation policy
 *   (`SQLIB_AUTH_ALLOW_LIBRARY_CREATE`: anyone authenticated, or admins only),
 *   and the creator is granted every mode on what it made in the same
 *   operation, so a library cannot be created with nobody able to administer
 *   it (design §4.2). `POST /libraries` is the whole of this.
 * - `backend-use` / `backend-write` — the route is scoped to a *backend*
 *   rather than a library, and the handler requires that `BackendMode` on it.
 *   `resolveOwningLibrary` has nothing to find for these (a `Patch.isPartOf`
 *   names the backend it was derived against; a `Backend` names nothing), so
 *   both plugins register no entity guard at all — correctly, since a guard
 *   that abstained on every route would read as coverage. Library grants say
 *   nothing about these routes in either direction.
 *
 *   One value until `backends.ts` was swept, and split because the `use`/
 *   `write` line is the feature rather than an accident of these handlers:
 *   preview is read-only by construction, so a caller who may *use* a backend
 *   can be shown exactly what a write would do without being trusted to do it
 *   (`docs/explanation/rdf-patch.md`). A classification that
 *   cannot say which mode a route takes cannot notice a route quietly
 *   changing which one it asks for, which is the only thing these rows are
 *   for.
 * - `backend-listing` — a collection GET over backends, narrowed to the ones
 *   the caller holds a grant on. The `readable-listing` of the backend world,
 *   and a separate value because the rule is different: `filterReadable`
 *   resolves an entity's owning library, and a backend has none, so these
 *   filter on `grants.backends` directly. Admin and full-access callers see
 *   everything, as they do everywhere.
 * - `backend-by-operation` — backend-scoped like the two above, but the mode
 *   is not a property of the route: `/sparql` requires `write` on the backend
 *   when the query parses to an update and `use` when it does not, and
 *   administrator outright for an arbitrary `endpoint` or the library storage
 *   backend. A separate value rather than a gloss on `backend-use` and
 *   `backend-write`, because "which mode" is decided per request here and per
 *   route there, and a row that cannot say so cannot notice the difference
 *   collapsing.
 * - `session-owner` — the route names an assistant session, which is not a
 *   stored entity and which no grant in the vocabulary can mention. The handler
 *   requires the caller to be the principal that opened it: not a library
 *   grant, and deliberately not an admin one either. The refusal is a 404
 *   byte-identical to an unknown id, since the id is the only thing keeping a
 *   session private. `assistantSessions.test.ts` is the rows.
 * - `auth-graph` — the route writes the auth graph itself: a grant, which is
 *   the state `required` mode consults. Checked in the handler like `handler`,
 *   and unlike every other classification here it refuses in **every** mode,
 *   `dry-run` included, because what it writes outlives the mode it was
 *   written in. A full-access context counts only where it means `disabled`
 *   (`isOpenDeployment`), since a `dry-run` request carrying no token arrives
 *   full-access too.
 * - `self-describing` — the route answers the caller about the caller and
 *   reaches no row the caller is not already standing on. `GET /auth/me` is
 *   the whole of this. Distinct from `stateless`, which reads no stored state
 *   at all: this one reads the caller's own grants.
 *
 * `readable-listing` and `unfiltered-listing` were one value, `unrestricted-
 * listing`, glossed as "returns what the caller may see, filtered downstream".
 * That was true of `/queries` and false of `/tests`, where nothing downstream
 * filtered anything — a classification is a claim about the handler, so the
 * two cases now have two names and the wrong one is countable.
 */
type Protection =
  | 'read' | 'write' | 'delete' | 'execute'
  | 'write-from-body' | 'read-from-body' | 'execute-from-body' | 'handler'
  | 'stateless' | 'admin'
  | 'backend-use' | 'backend-write' | 'backend-listing' | 'library-create'
  | 'backend-by-operation' | 'session-owner'
  | 'auth-graph' | 'self-describing'
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
   * ETL jobs, swept because the classification is what this plugin most needed
   * and least had. Asking the manifest's question of it turned up three things,
   * and only the first was on record (issue #211):
   *
   * 1. `EtlExecution` and `EtlColumnMapping` reach their library through
   *    `etlJobVersion`, not `isPartOf`, so `resolveOwningLibrary` followed
   *    nothing and the guard abstained — `unguarded-unowned` for the two
   *    execution routes and the mapping-version route.
   * 2. **Every** route here was unguarded in ordinary use, which is the one
   *    that matters. The guard resolves the path parameter as written; this
   *    plugin's handlers mint a URN from it (`EtlService.toUrn`) and its
   *    responses hand out the bare form. So the classification below was true
   *    only of a URL nobody constructs. `shortIdKinds` is what makes these
   *    rows describe the plugin rather than a spelling of it, and
   *    `etlJobRoutes.test.ts` runs real principals at both forms.
   * 3. `GET /etl-jobs` was an `unfiltered-listing` — every job in the
   *    deployment to any principal — and is `readable-listing` now, the same
   *    fix `GET /tests` took.
   *
   * `/:id/execute` is Execute rather than Write: it runs the job's SQL against
   * its backend, and Execute is independent of Read by design. `/preview` is
   * the admin-only one, for the reason the plugin's own header gives.
   */
  'GET /etl-jobs': 'readable-listing',
  'POST /etl-jobs': 'write-from-body',
  'GET /etl-jobs/:id': 'read',
  'PATCH /etl-jobs/:id': 'write',
  'GET /etl-jobs/:id/versions': 'read',
  'POST /etl-jobs/:id/versions': 'write',
  'GET /etl-jobs/versions/:versionId': 'read',
  'PATCH /etl-jobs/versions/:versionId': 'write',
  'POST /etl-jobs/versions/:versionId/column-mappings': 'write',
  'POST /etl-jobs/preview': 'admin',
  'POST /etl-jobs/:id/execute': 'execute',
  'GET /etl-jobs/:id/executions': 'read',
  'GET /etl-jobs/executions/:executionId': 'read',
  'GET /etl-jobs/executions/:executionId/output': 'read',
  'GET /etl-jobs/column-mappings/versions/:versionId': 'read',

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
  'PUT /argument-sets/:id': 'write',
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
   * trust story for agent-proposed writes (`docs/explanation/rdf-patch.md`).
   * `GET /:id` reads a derived diff, so it takes `use` too.
   *
   * Which is why these four say *which* mode now: the split was the point of
   * recording them, and `backend-handler` could not express it.
   */
  'POST /patches/preview': 'backend-use',
  'POST /patches/apply': 'backend-write',
  'POST /patches/:id/revert': 'backend-write',
  'GET /patches/:id': 'backend-use',

  /*
   * Backends, the plugin the argument-set and patch sweep named as the place
   * `backend-handler` would get its second user or its first correction. It
   * got both: the vocabulary above splits by mode, and asking the manifest's
   * question of these nineteen routes turned up one route checking nobody and
   * three checking too late.
   *
   * 1. `GET /:id/references` took **no check at all**. It answers the same
   *    question as `GET /:id/usage` directly above it, over two of the same
   *    four collections, and `/usage` has required `use` throughout — so a
   *    principal holding no grant on the backend was refused one and answered
   *    200 by the other, with the id and name of every library and query in
   *    the deployment pointing at it.
   * 2. The three in-process-store routes checked *last*, after the existence
   *    lookup and the backend-type test, so an unauthorized caller got 404,
   *    400 and 403 for three different states and could read the backend
   *    table's shape out of the difference. Every other route here checks
   *    first; those three do now.
   *
   * `POST /`, `PUT /:id`, `DELETE /:id` and `GET /:id/env` are `admin`
   * outright rather than `control` on the backend, and deliberately: the
   * first three edit the set of stores this process will connect to, and the
   * env route reports which `SQLIB_BACKEND_*` variables are set on the runner.
   * Neither is a fact about one connection that a grant on that connection
   * should buy.
   */
  'GET /backends': 'backend-listing',
  'POST /backends': 'admin',
  'GET /backends/probes': 'backend-listing',
  'POST /backends/probes': 'backend-listing',
  'GET /backends/:id': 'backend-use',
  'PUT /backends/:id': 'admin',
  'DELETE /backends/:id': 'admin',
  'GET /backends/:id/env': 'admin',
  'POST /backends/:id/probe': 'backend-use',
  'GET /backends/:id/probe-history': 'backend-use',
  'GET /backends/:id/prefixes': 'backend-use',
  'POST /backends/:id/prefixes': 'backend-write',
  'GET /backends/:id/usage': 'backend-use',
  'GET /backends/:id/references': 'backend-use',
  'GET /backends/:id/stats': 'backend-use',
  'POST /backends/:id/upload': 'backend-write',
  'DELETE /backends/:id/data': 'backend-write',
  'GET /backends/:id/patches': 'backend-use',
  'GET /backends/:id/patch-log': 'backend-use',

  /*
   * Tags, and the shortest sweep in the lane: five routes, all correct, all
   * written down. The plugin registers the entity guard with no exemptions and
   * no execute suffixes, so the four `:id` routes and the create are the guard
   * doing exactly what its classification says, and the listing filters.
   *
   * Worth one sentence because it is the reason there was nothing to find:
   * `tagMembership.ts` already enforces the model's one tag invariant — a tag
   * may only be applied inside the library it belongs to — so `DELETE /:id`'s
   * unlabelling sweep walks every taggable type but can only ever touch
   * entities in the tag's own library. Without that rule, Delete on one
   * library would be a write to entities in another; with it, the sweep is
   * bounded by the same grant the guard already required.
   */
  'GET /tags': 'readable-listing',
  'POST /tags': 'write-from-body',
  'GET /tags/:id': 'read',
  'PUT /tags/:id': 'write',
  'DELETE /tags/:id': 'delete',

  /*
   * The SPARQL proxy: two routes that take a query the caller wrote and run it
   * against a backend the caller names. No entity, no library, so the plugin
   * registers no guard and each handler asks `requireBackendMode` — with the
   * mode chosen by the *operation the query parses to*, which is what
   * `backend-by-operation` says and no existing value could.
   *
   * The change-feed sweep read this plugin on its way past and recorded the
   * two things worth not re-deriving: an arbitrary `endpoint` and
   * `LIBRARY_STORAGE_BACKEND_ID` are both administrator-only,
   * and substitution cannot turn a SELECT's grant into an UPDATE, because
   * `applyExecutionArguments` lands values as terms in an AST rather than as
   * text. Its open question — caller-named `argumentSetIds` handed to
   * `exportRuntimePayload` with no Read check — is unchanged and deliberately
   * still the owner's: `/execute` says nothing there either, and narrowing one
   * route would make it disagree with the route every client uses.
   */
  'POST /sparql': 'backend-by-operation',
  'GET /sparql': 'backend-by-operation',

  /*
   * The playground: two routes that run what the request body contains rather
   * than anything stored, which is why neither registers a guard.
   *
   * `POST /etl/execute` is `admin` and says so in its own comment: arbitrary
   * DuckDB SQL is a host filesystem read primitive, so "authenticated" is the
   * wrong bar and `requireAdmin` is the right one (#132 §4d).
   *
   * `POST /rules/execute` had **no check of any kind**, and for almost the
   * right reason. Everything it runs is text the caller just typed — an SRL
   * document, split into rules and data blocks, executed in an ephemeral
   * store — so `stateless` would have been the honest classification but for
   * one field. `dataGraphVersionId` names a stored `DataGraphVersion`, in any
   * library, whose triples seed the store the caller's own rules then read.
   * The response does not echo the base graph (the executor subtracts the
   * baseline), but a rule that matches it and writes what it matched puts
   * those triples in the inference output, which the response does carry.
   *
   * `handler`, then: the route has no single library to resolve, and the
   * handler checks Read on the library owning whatever stored graph the body
   * named. The check lives in `resolveDataGraphInput` rather than here,
   * because this was the fourth door to it and the other three were open too
   * — see `dataGraphSources.test.ts`.
   */
  'POST /playground/rules/execute': 'handler',
  'POST /playground/etl/execute': 'admin',

  /*
   * The assistant is the first plugin swept whose resource no grant can name.
   * A session is not a stored entity: it lives in a `Map` in the process, it is
   * explicitly not a library artifact, and `resolveOwningLibrary` has nothing
   * to reach — so the entity guard would have abstained on every one of these
   * while reading as coverage, exactly as it would have on `/patches`.
   *
   * What is left when no grant applies is who opened it, which is what
   * `session-owner` is. The sweep that added these rows is what put an owner on
   * a session in the first place: before it, `service.get(id)` answered any
   * caller holding the id.
   *
   * `POST /sessions` is the odd one and is `read-from-body` rather than
   * `write-from-body`: it stores nothing in a library, but the library it names
   * is the one the session's drafts are staged for and its tools are narrowed
   * to, so opening a session on a library is a read of it.
   *
   * `POST /models` is `stateless` in the same sense `/detection`'s routes are —
   * it resolves nothing and stores nothing. Recorded rather than fixed, because
   * it is a property of the feature rather than of this sweep: an
   * `openai-compatible` provider takes a caller-supplied `baseUrl`, so the
   * server fetches a URL the caller chose. It is the caller's own key and their
   * own endpoint by design (a local Ollama is the use case), and what comes back
   * is shaped down to `data[].id` with failures reduced to a status code — but
   * it is still the one route here that makes the server reach somewhere a
   * caller named, and a deployment that is not `local-or-trusted-network`
   * should know it.
   */
  'POST /assistant/sessions': 'read-from-body',
  'GET /assistant/sessions/:id': 'session-owner',
  'POST /assistant/sessions/:id/interrupt': 'session-owner',
  'POST /assistant/sessions/:id/messages': 'session-owner',
  'POST /assistant/models': 'stateless',
  'GET /assistant/tools': 'stateless',

  /*
   * `/auth` is the auth graph's own control surface, so nothing here resolves
   * to a library and the plugin registers no entity guard — correct, for the
   * reason `/patches` registers none.
   *
   * `GET /me` answers the caller about the caller. It reads the auth graph but
   * discloses only the row the caller is already standing on, so there is
   * nothing to check and no check is registered.
   *
   * The two writes are `auth-graph`: the only routes in the API that refuse in
   * `dry-run`, because a grant is the state `required` mode consults and
   * therefore outlives the mode it was written in.
   *
   * The reads are classified by what they do, which is *not* uniform and is
   * left that way deliberately — §4 of that note. `GET /grants` unfiltered is
   * plain `handler`: it follows `dry-run` like the rest of the API. The other
   * two refuse in every mode, as they always have.
   */
  'GET /auth/me': 'self-describing',
  'GET /auth/grants': 'handler',
  'POST /auth/grants': 'auth-graph',
  'DELETE /auth/grants/:id': 'auth-graph',
  'GET /auth/principals': 'handler',

  /*
   * Detection is the first plugin whose every route is `stateless`. Each takes
   * SPARQL or SRL text from the body or the query string, hands it to a parser,
   * and answers about the text — no store is read, no entity is named, and
   * `getCacheCoordinator` is never reached. There is nothing for a guard to
   * resolve, which is why the plugin registers none.
   *
   * That makes them readable by any authenticated principal in `required`
   * mode, which is the intended reach: the editor calls them on every keystroke
   * to highlight a syntax error, for text the caller just typed and already
   * holds. The claim being pinned here is the one that could stop being true —
   * that none of them grows a lookup. A route that loaded an entity would have
   * to leave this list.
   */
  'POST /detect-inputs': 'stateless',
  'GET /detect-inputs': 'stateless',
  'POST /detect-outputs': 'stateless',
  'GET /detect-outputs': 'stateless',
  'POST /validate': 'stateless',
  'POST /validate-rule-data': 'stateless',
  'POST /format': 'stateless',
  /*
   * Substitution without execution: it names no backend, reaches no executor
   * and writes nothing, which is what lets a read-only deployment serve it —
   * see `config/readOnly.ts`. Reading a stored argument set is the one thing it
   * does touch, and that is a read.
   */
  'POST /substitute': 'stateless',

  /*
   * One route, and the only one in the API whose answer is a subscription
   * rather than a response. It stays open and writes a frame every time
   * anybody, anywhere in the deployment, writes an entity — so "who may call
   * it" is the wrong question and "what may it tell them" is the right one,
   * re-decided per frame rather than once per request.
   *
   * `handler`, because there is no single library to resolve: the handler holds
   * a grant check inside the subscription callback and applies it to each frame
   * as it goes. That check was there and was very nearly inert — see
   * `changeFeedVisibility.test.ts` for what it was reading and why it missed.
   */
  'GET /events': 'handler',

  /*
   * Libraries are the container every other row resolves *to*, so this plugin
   * registers no entity guard: `resolveOwningLibrary` on a `Library` returns
   * the library itself, and each handler requires its mode directly. The rows
   * below are therefore claims about handlers, one per route, in a file where
   * nothing else is checking.
   *
   * Two of them were decided by a request header until this sweep. `GET /:id`
   * checked Read in its JSON branch and not in the RDF branch above it, and
   * `GET /` filtered its JSON with `filterReadable` and answered its RDF branch
   * with `libraryCollection` — a CONSTRUCT over every stored `Library`.
   * `GET /export` is that query again with no `:id` and no check of its own.
   * All three narrow to the readable libraries now, which is what makes the two
   * listings `readable-listing` rather than `unfiltered-listing`, which
   * `libraryRoutes.test.ts` pins.
   *
   * `GET /:id/export-bundle` is `read` on the library named in the path, and
   * that is the whole of its check *after* this sweep as well — but what it
   * compiles is no longer only that library's: a group's node names a query
   * version that need not live here, so the ones the caller may not read are
   * withheld and reported in `skipped` beside the groups the static runtime
   * cannot run.
   */
  'GET /libraries': 'readable-listing',
  'GET /libraries/export': 'readable-listing',
  'POST /libraries': 'library-create',
  'GET /libraries/:id': 'read',
  'PUT /libraries/:id': 'write',
  'DELETE /libraries/:id': 'delete',
  'GET /libraries/:id/export': 'read',
  'GET /libraries/:id/export-bundle': 'read',

  /*
   * Query groups, swept with the question `argument-sets.ts` handed on — *does
   * this route name a second entity in its body, and what is the caller doing
   * with it?* — which this plugin answers more widely than any before it.
   *
   * `POST /:id/v` is the whole of that. A group version's nodes name stored
   * entities that need not live in the group's library: a `QueryNode`'s
   * `queryId` is a `QueryVersion`, a `RuleSetNode`'s `ruleSetVersion` a
   * `RuleSetVersion`. The guard checks Write on the group; nothing looked at
   * the nodes, and `POST /execute` requires Execute on the *group's* library
   * and says nothing about the legs — so Write plus Execute on one library ran
   * any other library's saved queries and rule sets. `createGroupVersionFlat`
   * requires Execute on each composed version's library now, at the
   * staging/flush boundary so a refusal writes nothing;
   * `queryGroupComposedSources.test.ts` runs real principals at it. The
   * classification stays `write` — that is what the guard does, and the second
   * check is the handler's, exactly as for `from-etl` and `from-query`.
   *
   * `GET /query-groups` listed every group in the deployment, the seventh
   * collection GET with that shape and the one carrying `currentVersion` — the
   * pointer at the entity whose content names other libraries' queries. It
   * filters now (`listingVisibility.test.ts`).
   *
   * The three version routes and `/:id/v/:version/validate` match
   * `QueryGroupVersion` on `isPartOf` and never read the group in the path —
   * the shape that was live in `queries.ts`, `tuple-sets.ts` and
   * `rule-sets.ts`. It is *not known to be reachable* here: `DELETE /:id`
   * cascades its versions, unlike `repos.Query.delete`, and a group whose
   * library is gone is refused by the guard's dangling-container branch. The
   * rows that pin the reachable case are in `queryGroupComposedSources.test.ts`,
   * labelled as the shape checked rather than a hole closed — as
   * `argumentSetVersionRoutes.test.ts` does for the same shape.
   *
   * `/validate` is `read` and composes the group's legs, but discloses nothing
   * a `GET` of the same version does not: it reports on entity IRIs already
   * stored in that version, and the writer refuses to store one that does not
   * resolve to the right type.
   */
  'GET /query-groups': 'readable-listing',
  'POST /query-groups': 'write-from-body',
  'GET /query-groups/:id': 'read',
  'PUT /query-groups/:id': 'write',
  'DELETE /query-groups/:id': 'delete',
  'GET /query-groups/:id/v': 'read',
  'POST /query-groups/:id/v': 'write',
  'GET /query-groups/:id/v/:version': 'read',
  'PATCH /query-groups/:id/v/:version': 'write',
  'GET /query-groups/:id/v/:version/validate': 'read',
  // The pair beside `/queries/:id/argument-sets`, reaching the same
  // `createForTarget`, so the pins in the body are checked by one call.
  'GET /query-groups/:id/argument-sets': 'read',
  'POST /query-groups/:id/argument-sets': 'write',
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
  ['../../src/routes/etl-jobs.js', '/etl-jobs'],
  ['../../src/routes/argument-sets.js', '/argument-sets'],
  ['../../src/routes/patches.js', '/patches'],
  ['../../src/routes/tags.js', '/tags'],
  ['../../src/routes/playground.js', '/playground'],
  // Mounted at the root in `index.ts`, and it declares `/sparql` itself, so
  // the prefix here is the empty one the server uses rather than a tidier
  // `/sparql` that would enumerate the routes at the wrong paths.
  ['../../src/routes/sparql.js', ''],
  ['../../src/routes/assistant.js', '/assistant'],
  ['../../src/routes/auth.js', '/auth'],
  // Mounted at the root in `index.ts`, so the prefix is empty here too — the
  // manifest keys are the paths the app actually serves.
  ['../../src/routes/detection.js', ''],
  ['../../src/routes/events.js', '/events'],
  ['../../src/routes/libraries.js', '/libraries'],
  ['../../src/routes/backends.js', '/backends'],
  ['../../src/routes/query-groups.js', '/query-groups'],
];

/*
 * The plugins this file does not sweep yet — **empty**, for the first time.
 * "Every route, classified" is now true of the whole route table rather than
 * of a list with a remainder beside it, so the list's job changes: it is no
 * longer a debt being paid down, it is the place a *new* route file lands if
 * somebody adds one without a manifest.
 *
 * The pin below is what keeps that honest. `src/routes/*.ts` with a default
 * export is either swept or listed, and a twenty-third fails this test by name
 * until someone chooses which — so the way to regress the sweep is to add a
 * name here, which is a line in a diff rather than a silence.
 *
 * Kept as an empty list rather than deleted, because deleting it would take
 * that pin with it: `unaccounted` is computed against it, and a file that is
 * neither swept nor listed has to have somewhere to not be.
 *
 * `etl-jobs` and `playground` are the two that carried a published security
 * claim (`docs/guides/etl.md`, "Who may submit SQL": those routes are
 * administrator-only), and both are classifications above now —
 * `POST /playground/etl/execute` is `admin`, and `sqlRoutesAdminOnly.test.ts`
 * pins the pair against the real plugins beside them.
 *
 * It is worth saying what asking the question of `etl-jobs` cost, because the
 * answer was not a classification: every route in that plugin was answering
 * unguarded in ordinary use, because the guard resolved the path parameter as
 * written and the plugin is the only one that takes short ids. The manifest is
 * what made that visible — writing down "`GET /etl-jobs/:id` is `read`" is what
 * prompted checking whether it was, and it was not.
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
 * `query-groups.ts` is swept above now — the one the last sweep named and
 * declined to guess at. Its `/:id/v/:version/validate` turned out to be the
 * quiet one and `POST /:id/v` the loud one: a group version's nodes name other
 * libraries' query and rule set versions, and running them needed nothing on
 * those libraries.
 *
 * `assistant.ts` is swept above now too, and it is the first plugin here whose
 * resource no grant can name — see `session-owner`. It could not be asked any
 * of the questions above, because all of them end at a library IRI and a chat
 * session ends nowhere; the one it had to invent is what it hands on: *who owns
 * this, when no grant can say?*
 *
 * `auth.ts` and `detection.ts` are swept above now, taking the question the
 * assistant sweep handed on — *who owns this, when no grant can say?* They
 * answer it from opposite ends. Detection owns nothing at all: seven routes
 * that parse text the caller supplied and answer about it. `/auth` owns the
 * grants themselves, and asking the question of them found the one place in
 * the API where `dry-run` is not safe.
 *
 * `libraries.ts` is swept above now, with the question query groups handed on
 * — *which of this route's checks is a check on the entity it is about to act
 * on?* Three of its routes answered "none of them, once you send an Accept
 * header", which no reading of the guards could have found: this plugin has no
 * guards.
 *
 * `backends.ts` is swept above now — §6 of the argument-sets and patches note
 * sent the next sweep here, to give `backend-handler` its second user or its
 * first correction, and it took both. The vocabulary splits by mode, and
 * `GET /:id/references` turned out to be checking nobody at all.
 *
 * `events.ts` is swept above now too, and it is the one that answers to none of
 * the questions the other sweeps handed on, because it is not a CRUD table: one
 * route, one grant check, and that check applied per *frame* rather than per
 * request. Asking it the manifest's question anyway is what found that the
 * check was reading a field the API does not produce — the details, and the
 * question it hands on, are recorded with that change.
 *
 * `tags.ts`, `sparql.ts` and `playground.ts` are swept above now — the three
 * this lane had left over rather than chosen, taken together because two of
 * them turned out to have nothing to find and saying so is most of their
 * value. The one that did is `POST /playground/rules/execute`, which took no
 * check at all and reads a stored `DataGraphVersion` out of any library; the
 * finding generalised, because it was the fourth route reaching
 * `resolveDataGraphInput` with a caller-named id and the first three were
 * open too.
 *
 * It hands on the question that found it, which is the one the change-feed
 * sweep asked, turned around: **which shared helper resolves a caller-named id
 * to stored content, and does every route reaching it ask the same question of
 * the caller?** `ReferenceResolver` and `Backends.findByIri` are the two other
 * helpers of that shape.
 */
const NOT_SWEPT: readonly string[] = [
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
   * routes of twenty-two plugins; this is about which plugins those are, so
   * "adding a route fails this test by name" cannot quietly mean "adding a
   * route to one of twenty-two files".
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

    // Zero, and pinned there. It reached zero by being paid down one sweep at
    // a time; from here the only way it moves is *up*, which is a route file
    // somebody added without a manifest. That must not happen quietly.
    expect(NOT_SWEPT.length, NOT_SWEPT.join('\n')).toBe(0);
  });
});
