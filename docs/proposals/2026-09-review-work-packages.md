# Work packages from the September 2026 review

Status: proposed. Companion to [2026-09-review.md](2026-09-review.md), which
holds the findings this plan addresses; finding ids (S1, C1, D1, E1 …) refer to
that document.

Each work package (WP) is meant to be one branch and one pull request, small
enough to review in a sitting, with its own tests as the acceptance criterion.
Sizes: **S** under a day, **M** one to three days, **L** a week or more.
Dependencies are stated so packages can run in parallel where they do not
touch the same files.

Seven phases, ordered by risk. Phase 1 closes the authorization holes and is
independent of everything else; ship it first. Phases 2 and 3 fix correctness
in the cache and the engine. Phase 4 is the route-layer consolidation that
stops the drift from recurring. Phases 5 to 7 are the web, the smaller
packages and the engineering infrastructure.

Decisions the plan needs from the maintainer are collected at the end; each
WP that depends on one names it.

---

## Phase 1 — Authorization closure

Status: done, WP1–WP7, on `claude/phase-1-changes-2578nw`. D2 was decided
as an owning library for benchmark experiments, and D3 as refusing UPDATE over
GET with no flag. What changed from the plan: ETL execution is administrator-only
through handler checks rather than `adminSuffixes`, because suffixes match every
method. Caller-supplied ids stay allowed on create, since the coordinator now
refuses any id already in use under any type.

### WP1 — Refuse create on an existing id · S · deps: none · closes S1, part of D9

**Goal.** No create path can overwrite an entity that already exists, in any
library, under any type.

**Changes.**
- `packages/api/src/lib/CacheCoordinator.ts` `create()`: throw a new
  `EntityExistsError` when `_idToType.has($id)` or the store already holds the
  subject (under `CACHE_PRELOAD=false`, fall back to `resolveExisting`).
- Map that error to `409 Conflict` in `route-helpers.ts` (both wrappers) and in
  the global error handler in `index.ts`, so every create route gets it.
- Remove the local 409 check in `routes/libraries.ts:491` in favour of the
  coordinator's (keep its test).
- Decide per route whether a caller-supplied `id` is allowed at all; for
  non-admin routes, either strip it or require it to match `^urn:sqlib:<kind>:`
  for that kind, so a Query can never be minted at a library IRI.

**Acceptance.** One test per create route (`queries`, `query-groups`, `tags`,
`tuple-sets`, `backends`, `libraries`, plus every version create) asserting
409 on an existing id, and a test that `POST /queries {id: <library IRI>}` is
refused and leaves `cache.get(libraryIri)['@type'] === 'Library'`.

### WP2 — Scope every execution path · M · deps: none · closes S2, engine #1/#2/#13

**Goal.** Every `ISparqlExecutor` handed out on behalf of a request comes from
a scoped `ExecutorFactory`, as `architecture.md` step 5 claims.

**Changes.**
- `lib/TestRunner.ts` and `lib/BenchmarkRunner.ts`: take an
  `ExecutionAuthScope` in the constructor (or per call) and build their
  `ExecutorFactory` and `ExecutionEngine` from it; remove the default
  `new ExecutorFactory()`.
- `routes/tests.ts:1063,1171` and `routes/benchmarks.ts:30,251`: construct the
  runners per request with `{ request, viaLibrary }`; the module-level
  `const runner = new BenchmarkRunner()` goes.
- `routes/tests.ts` create (`:632-727`): `requireLibraryMode(subjectLibrary,
  'execute')` and, when a backend is named, `requireBackendMode(backend, 'use')`.
- Benchmarks: give `BenchmarkExperiment` an owning library (`isPartOf`, schema +
  generated contracts + a one-off backfill script) so the entity guard applies,
  **or** make the whole plugin admin-only. Needs decision D2.
- Delete `ExecutorFactory.getExecutorForNodeSync` (no callers, skips the check).
- `auth/executionScope.ts`: keep the `if (!scope) return` for genuinely
  internal callers, but add a comment listing them and make the factory
  constructor require an explicit `internal: true` for the unscoped form so a
  new caller cannot get one by omission.

**Acceptance.** `test/auth/route-matrix.test.ts:242-245` rows flip from
`UNGUARDED … 200` to `403`. New tests: a principal with execute+write on
library A cannot run a test whose subject lives in library B, nor one whose
backend they hold no `use` on; same for a benchmark subject spec.
`security-model.md` "Tier 1 ships" becomes true and says so.

### WP3 — DynamicQueryNode resolution guard · S · deps: WP2 · closes S7

**Changes.** `orchestration/ExecutionEngine.ts:1361-1414`: after resolving the
`QueryVersion`, require that its parent query is in the group's library (or a
library the caller may `execute`), and that its `queryType` matches what the
node's outgoing edges can carry (SELECT for `VARIABLE_BINDINGS`, CONSTRUCT for
`RDF_GRAPH`, never UPDATE). Make `refuseUnroutedArguments` skip only the
dynamic node's own ports rather than disabling itself.

**Acceptance.** Engine tests: a `QUERY_ID` value naming a version in another
library is refused; an UPDATE version is refused; a SELECT version in the same
library still runs.

### WP4 — Second-entity checks the guard cannot see · M · deps: WP1 · closes S3, S6

**Changes.**
- ETL: `adminSuffixes` for `/:id/versions` (POST) and `/:id/execute` on the
  etl-jobs plugin; `requireAdmin` in `lib/tupleSetFromEtl.ts:142`; extend
  `test/auth/sqlRoutesAdminOnly.test.ts` to all four SQL-taking routes.
- `lib/ArgumentSetService.exportRuntimePayload` takes `{ request }` and
  `requireLibraryMode(set's library, 'read')` per set; update `routes/execute.ts:430`
  and `routes/sparql.ts`.
- `lib/RuleSetVersionWriter.ts:49-78`: for each `RuleVersion`/`DataBlockVersion`
  pin, check the caller may `execute` its owning library (mirror
  `GroupVersionWriter.ts:536`, issue #489).
- Move-between-libraries: every PUT that accepts `isPartOf` checks `write` on
  the destination library as well as the source. Do it once in a helper
  (`requireContainmentWritable(request, before, after)`) and call it from
  `queries`, `rules`, `data-blocks`, `data-graphs`, `tests`, `tuple-sets`,
  `query-groups` (WP20 will absorb this into the generic router).
- `routes/query-groups.ts:298-440`: adopt the dangling-parent handling and
  `filterReadable` from `queries.ts:213-228`; `expandGroupVersionDetailed`
  withholds node query text the caller may not read (reuse
  `partitionByReadableNodes`); drop `details: e.message` on 500.

**Acceptance.** A test per bullet, each with a stranger principal under
`required`. `queryGroupComposedSources.test.ts` gains a rule-set twin.

### WP5 — `/sparql` method semantics, read-only gate, CORS · S · deps: none · closes S4, S5

**Changes.**
- `routes/sparql.ts`: factor the shared body of GET and POST into one function.
  GET refuses UPDATE operations (405 with a message) and applies the same
  `record=patch` read-only check as POST. Needs decision D3 only if you want
  GET updates kept.
- `config/readOnly.ts`: keep the method list, but add a per-route opt-in
  (`config: { readOnlyMutating: true }`) so a GET that writes can be gated.
- `index.ts:701`: replace `origin: "*"` with an allowlist from
  `SQLIB_CORS_ORIGINS` (comma-separated; default: the SPA dev origin in
  development, none in production); `credentials: true` only when the list is
  not `*`. Same in `packages/mcp-server/src/http-server.ts:43-44`. Add an
  OPTIONS handler for `/mcp`. Document the variable in `reference/configuration.md`.

**Acceptance.** `GET /sparql?record=patch` under `SQLIB_READ_ONLY=true` is
refused; `GET /sparql` with an UPDATE body is 405; a request from an origin
not on the list gets no `access-control-allow-origin`.

### WP6 — Token verification hardening · S · deps: none · closes S9

**Changes.** `auth/config.ts`: in `required` and `dry-run`, refuse to start
without `SQLIB_AUTH_AUDIENCE` unless `SQLIB_AUTH_AUDIENCE_UNCHECKED=true` is
set explicitly. `auth/tokenVerifier.ts:280-295`: `ERR_JWKS_NO_MATCHING_KEY`
maps to 401, only timeouts and network errors map to 503. `auth/plugin.ts`
`isPublicPath` and `entityGuard.ts:232-243` match on `request.routeOptions.url`
(the pattern) rather than the raw URL, as `readOnly.ts` already does.

**Acceptance.** Tests for each: token for another audience is 401; unknown
`kid` is 401 and does not trigger a JWKS refetch inside the cooldown; a route
registered at `/backends/:id/health` is not public.

### WP7 — MCP HTTP transport · M · deps: WP5 · closes S8

**Changes.** `packages/mcp-server/src/http-server.ts`:
- POST with an unknown `mcp-session-id` → 404 (spec), so clients re-initialise.
- Create a transport only when the body is an `initialize` request; otherwise
  400 without allocating anything. Register `onclose`/timeout cleanup for a
  transport that never initialises.
- Bind a session to its creator: store a hash of the `Authorization` header (or
  the token subject under `required`) on the session and refuse GET/POST/DELETE
  from a different caller with 403.
- Scope `addContentTypeParser('*')` to the `/mcp` routes (register them in an
  encapsulated plugin) so REST routes keep their 415 behaviour in `dual-http`.
- Tests (there are none): initialise → tool call → delete; stale id → 404;
  non-initialise POST leaks no session (assert `sessions.size`); a second
  bearer cannot attach to or delete the first's session; `/mcp` under
  `SQLIB_AUTH_MODE=required` refuses a missing bearer (closes the gap
  `security-model.md:88` admits).

---

## Phase 2 — Cache and persistence correctness

Status: done, WP8–WP12, in #52. What changed from the plan: WP10 covers
eleven version writers, not five (rules, data blocks, data graphs, tests,
tuple sets, argument sets and ETL jobs too), and its lock is per process. WP12
names two exceptions to freezing by type: a benchmark experiment version stays
a draft until frozen, and an ETL job version may still move its
`currentColumnMappingVersion`. WP8 refuses an update whose read-back finds
nothing in the store, which needed suites writing through to stub stores to
turn write-through off.

### WP8 — Null clearing, no-op updates, date normalisation · S · deps: none · closes C1, C13 (update half), D8

**Changes.**
- `lib/CacheCoordinator.ts:326`: stop rewriting `null` to `undefined`; the
  generator and serialiser already clear on `null`.
- `update()`: when write-through is on and the post-update `findByIri` returns
  `null`, throw (`EntityNotPersistedError`) instead of returning the merged
  copy; route wrappers map it to 500 with an audit log line.
- `persistence/EntityAssembler.ts:32-40`: emit ISO strings for `xsd:dateTime`
  so the interfaces (`string`) are true; delete the `typeof`/`instanceof`
  branch in `route-helpers.ts:121-135`.

**Acceptance.** Coordinator-level test: `update(id, { defaultBackend: null })`
produces a DELETE in the store and reads back absent after a forced refresh.
Backend delete (`routes/backends.ts:1024-1038`) test: the library's
`defaultBackend` is absent from the store, not just the cache. A test that an
`update` on a cache-only entity fails. A type check that no entity field is
ever a `Date` after assembly.

### WP9 — Refresh cannot overwrite a write · M · deps: WP8 · closes C2, C13 (boot half), D11 perf

**Changes.** `lib/CacheCoordinator.ts`:
- Per-type and per-id write epochs (`Map<EntityType, number>`, `Map<id, number>`),
  bumped in `create`, `update`, `delete`, `addEphemeral`.
- Type refresh: record the epoch before `findAll`; after the await, if the
  epoch moved, either discard the result or merge only ids whose own epoch did
  not move. Never delete-then-replace wholesale.
- Id refresh: same check before `setInCache`.
- `triggerTypeRefreshIfStale`: use `cache.cache.size` and a per-type
  `lastLoadedAt` instead of walking `_idToType`; allow a refresh for a type
  with zero entries once `lastLoadedAt` is older than the TTL, so a type that
  failed at boot recovers.
- `getStats()`: cache the byte estimate per type and invalidate on write.

**Acceptance.** Tests that race `create`/`update` against an in-flight type
refresh and an id refresh and assert cache *contents* afterwards (the current
suite asserts call counts only). A test that a type whose boot load threw is
repopulated by a later `list()`.

### WP10 — One version allocator · M · deps: WP1 · closes C3

**Changes.**
- `lib/versionNumbering.ts` becomes the only implementation:
  `allocateVersion(parentId, versionType)` with a per-parent async mutex
  (`Map<parentId, Promise>`), a store fallback when `CACHE_PRELOAD=false`
  (SELECT MAX over `isPartOf`), and a uniqueness assertion before insert.
- `QueryVersionWriter.ts:125`, `RuleSetVersionWriter.ts:88`,
  `GroupVersionWriter.ts:563`, `BenchmarkExperimentService.ts:199`,
  `RuleVersionWriter.ts` all call it; the sort/max copies go.
- The `currentVersion` pointer flip is one helper that throws on `null`
  everywhere (three writers currently discard the result).
- Hold the mutex across the child-entity creates and the pointer flip in
  `QueryVersionWriter` so two saves cannot interleave.

**Acceptance.** Concurrent `POST /queries/:id/versions` ×10 yields versions
1..10 with no duplicate number and `currentVersion` pointing at the highest.
Same with `CACHE_PRELOAD=false` after a restart against a store holding v3
(next is v4).

### WP11 — Store modes do what they say · S · deps: none · closes C4

**Changes.** `orchestration/ExecutorFactory.ts:261-270`: `oxigraph-memory`
creates a plain `new oxigraph.Store()` registered as ephemeral, never a
durable store; `OxigraphStoreManager.shutdown` skips it. Delete the
`persistPath` plumbing the docs already mark deprecated. Update
`storage-and-caching.md:105-115` to a plain statement instead of a warning.

**Acceptance.** Test: boot with `INTERNAL_BACKEND_TYPE=oxigraph-memory`, write,
shut down; no `.nq` exists under any storage dir; a second boot starts empty.

### WP12 — Immutability by type · S · deps: WP1 · closes D9, persistence #8

**Changes.** `lib/immutability.ts`: key the guard on `isImmutableType(type)`
(all twelve `*Version` types plus `TestCase`/`TestCaseDataGraph`), not on the
stored `immutable` flag; keep accepting the `absent→true` annotation. Apply
the guard in `create()` too: a create whose id already exists as a frozen
type is refused (WP1 makes this moot, but the guard should say so). Add a
one-off backfill script that sets `immutable: true` on legacy versions.

**Acceptance.** Table test over all version types: content patch through
`coordinator.update` is refused regardless of the flag; annotation patch is
accepted.

---

## Phase 3 — Execution engine

### WP13 — Per-run ephemeral stores · S · deps: none · closes C5

**Changes.** `orchestration/GraphBuilder.ts:159-176` (or the engine on
`execute`): namespace `storeId` as `${runId}:${storeId}`; `ExecutionEngine`
destroys exactly the stores it created; `ExecutorFactory.createEphemeralExecutor`
never reuses an existing store for a different run. Fix the comment at
`ExecutorFactory.ts:72-77` to match.

**Acceptance.** Two concurrent runs of one group version with a shared author
`storeId` each see only their own seeded data, and the first to finish does
not break the second (`materializeRdfResult` no longer warns-and-returns).

### WP14 — RDF hand-offs agree on format · S · deps: WP13 · closes C10

**Changes.** `ExecutionEngine.ts:164-166`: pass `initialGraphFormat` derived
from the same `resolveRdfFormatFromAccept` the materialisation path uses.
EndNode fan-in (`:396-401`): parse each output into a store and re-serialise in
the requested format rather than `join('\n')`. `materializeRdfResult:1319-1327`:
a missing store or empty payload is an `ExecutionNodeError`, not a warning.
Move materialisation inside the node `try` so `failedNodeId` is set.

**Acceptance.** Scenario: CONSTRUCT → RuleSetNode under `Accept: text/turtle`;
CONSTRUCT ×2 → EndNode under `application/ld+json`.

### WP15 — Row semantics in VALUES hops · S · deps: none · closes C9, engine #10

**Changes.** `ExecutionEngine.ts:717-733`: drop a row whose mapped cells are
all unbound (or route it through `whenEmpty` if the whole set becomes empty);
never emit `{}` beside bound rows. `applyArgumentsInOrder:805-835`: match
initial args by `normalizedSignature` as `refuseUnroutedArguments` does, so a
group accepts what `/execute` accepts. Update the engine test at
`ExecutionEngine.test.ts:1425-1441` to the new behaviour.

**Acceptance.** Scenario with an OPTIONAL upstream column feeding a VALUES
input runs; an argument set with reordered variables is accepted by a group.

### WP16 — Deadlines, cancellation, and caller-facing caps · L · deps: WP2 · closes C11, D13

**Changes.**
- `ExecutionEngine.execute` and `RuleSetExecutor.execute` take an
  `AbortSignal` and an overall `deadlineMs`; each node checks the signal before
  starting and the HTTP executor passes it to `undici`.
- Oxigraph: `Store.query` is synchronous. Run in-process queries on a worker
  thread (`worker_threads`, one per store or a small pool) so a deadline can
  terminate the worker; if that is too large, at minimum enforce a per-query
  `LIMIT` cap and a fixpoint iteration cap and document that in-process
  queries cannot be interrupted. Needs decision D4.
- `RuleSetExecutor.ts:882-887`: check the deadline *before* each rule, not
  after. `BenchmarkRunner.runWithRetries:689-695`: clear the timer; on timeout
  abort the signal.
- `routes/rules.ts:459`: remove `destroyStore:false` from the public body;
  `maxIterations` gets a `maximum` from config. `routes/execute.ts:1127,1160`:
  log argument shapes, not values.
- `RuleSetExecutor.captureDatasetState` (`:889`) only when a `trace` option is
  set; per-rule quad diffs returned only under that option.
- In-group ETL node (`ExecutionEngine.ts:614-654`) reuses
  `EtlService.runPipeline` with `maxRows` and the `fail` policy.

**Acceptance.** A group whose HTTP leg hangs is aborted at the deadline with
`failedNodeId`; a rule set that never converges stops at the cap; a client
disconnect cancels the run (`request.raw.on('close')`).

### WP17 — One invocation path · M · deps: WP2, WP13, WP14, WP15 · closes D4, engine #11/#12

**Changes.**
- `lib/invokeCallable.ts`: the single applyLimitOffset → applyArguments →
  switch(queryType) → executor function, used by the engine's query-node
  branch, `TestRunner.invokeQuery`, `BenchmarkRunner.executeQueryVersion`.
  Runners call `getExecutorForBackendId`, not a fake `ResolvedNode`.
- One `resolveInputTupleNames`/`resolveOutputTupleNames` (engine and
  GraphBuilder currently disagree on error behaviour).
- One `convertRowsToBindings` (the `EtlService` version with
  `encodeURIComponent` and row skipping is the correct one).
- `ExecutionEngine.execute`: extract the Kahn advance block (pasted five
  times) into `advance(nodeId)`; per-node-type branches become a
  `Map<NodeType, NodeRunner>`.
- `determineNodeType` fallback guessing (`:446-461`) goes; `@type` is required.
- `ResolvedNode` becomes a discriminated union.

**Acceptance.** No behaviour change: the existing scenario suite is the gate.
Add a test that an ETL job produces the same IRIs run directly and as a node.

### WP18 — LIMIT/OFFSET on the AST · M · deps: none · closes D6

**Changes.** `lib/parser.ts:279-296`: detect named limit/offset from the parsed
query's `limit`/`offset` values (a value ≥ 1000 whose source text starts with
`000` — the parser has to expose the lexeme, or detect on tokens rather than
on raw text, skipping comments and strings). Substitution sets the AST field
and regenerates. Delete the sentinel dance in `formatQueryString:174-200`.
The runtime template path keeps its recorded offsets (it is parser-free by
design); `architecture.md` step 6 is corrected either way.

**Acceptance.** `# LIMIT 0001` in a comment and `"LIMIT 0001"` in a literal
declare no parameter; `pageParametersFor` and the argument-set `fits`
verdict agree.

### WP19 — Small engine fixes · S · deps: none · closes C15, engine #14

**Changes.** `server/OxigraphSparqlExecutor.ts:116,146`: `import { Readable }
from 'node:stream'`. Add a five-line test that a `SERVICE <http://…>` query
against an in-process backend is refused (or document that Oxigraph's N-API
build does not federate). Decide on a `SERVICE` allowlist for HTTP backends
(decision D5) and, if adopted, enforce it in `applyExecutionArguments` since
every query is parsed there anyway.

---

## Phase 4 — Route layer consolidation

### WP20 — Generic versioned-entity router · L (split into a + one PR per module) · deps: WP1, WP4, WP10, WP12 · closes D1, routes #9/#10

**WP20a — framework + queries as the reference.**
- Write down the drift decisions first (decision D1 covers the path segment):
  DELETE on a missing id → 404; DELETE cascades versions (queries currently
  orphans them) unless a pin exists → 409 listing the pins; version PATCH
  honours If-Match everywhere; `ImmutableEntityError` → 409 everywhere;
  version create failure → 500 with masked details, 400 only for
  `ValidationError`; version listing filters readable and 404s a missing
  parent; one wording for "must belong to exactly one library"; 412 body is
  `{ error, expected, current }` everywhere.
- `routes/versionedEntity.ts`: `registerVersionedEntityRoutes(fastify, {
  noun, type, versionType, schemas, versionWriter, hooks: { beforeCreate,
  afterCreate, beforeUpdate, … } })` producing list/create/get/put/delete +
  list-versions/create-version/get-version/patch-version/delete-version, with
  the explicit checks from WP4 built in (`requireContainmentWritable`,
  `requireEntityMode`, `filterReadable`).
- `route-helpers.ts`: one error wrapper (delete the second copy at
  `:295-353` and the third in `index.ts`).
- Migrate `queries.ts`; keep its test file green as the reference.

**WP20b–h — one PR each:** `rules`, `data-blocks`, `data-graphs`,
`tuple-sets`, `tests`, `rule-sets`, `query-groups` (`argument-sets` and
`benchmarks` if their shapes fit). Each PR deletes the hand-written handlers,
keeps the module's entity-specific hooks, and updates its tests to the agreed
status codes. `packages/contracts/src/schema/contract-routes.ts` is
regenerated or deleted per WP31.

**Acceptance.** A single parametrised route-contract test that runs the same
status-code matrix over every registered noun; the drift table in
[2026-09-review.md](2026-09-review.md) D1 has no remaining rows.

### WP21 — `index.ts` decomposition and flag gating · M · deps: WP20a · closes D14, routes #12

**Changes.** Split `packages/api/src/index.ts` (988 lines) into
`server/bootstrap.ts` (process handlers, dotenv, otel), `server/swagger.ts`,
`server/health.ts` (one schema, reused for 200 and 503), `server/metrics.ts`,
`server/registerRoutes.ts`, `server/seed.ts`. Gate `/sparql` and `/detect-*`
under `queries`; register `/playground/etl/*` only under `playgroundEtl`;
`argumentSetRoutes` when `tests` is on. Replace the emoji `console.error`
handler with the logger.

**Acceptance.** `test/server/index.bootstrap.test.ts` still passes; a flag
matrix test asserts the registered route set per flag combination.

### WP22 — Concurrency headers · S · deps: WP20a · closes routes #10, #13

**Changes.** `route-helpers.ts:27-36`: parse weak validators (`W/"…"`) and
comma lists per RFC 9110. ETag from `dateModified` plus a monotonic per-entity
revision counter so two writes in one millisecond differ. `filterReadable`
logs `would-deny` per hidden item in `dry-run`.

---

## Phase 5 — Web

### WP23 — Change feed dispatches by entity · S · deps: none · closes C7

**Changes.** `composables/useLibraryRefresh.ts`: a registry
`{ query: queriesStore, ruleSet: ruleSetsStore, … }` keyed by the API's
`event.entity`; `applyBatch` in `useLibraryEvents.ts` groups ids by entity and
calls `loadX()` + `fetchX(id)` per store. `pages/index.vue:811` passes the open
entity of *any* section. Validate SSE frames with a zod schema instead of
`raw as unknown as LibraryChangeEvent`.

**Acceptance.** Composable test: a `changed` frame for a rule set refreshes the
rule-set store and refreshes its concurrency token; no `GET /queries/<ruleSetId>`
is issued.

### WP24 — Contracts are the wire · L · deps: WP31 (for the generated shapes) · closes C8, D3, web #10

**Changes.**
- Replace the 20 local zod schemas in `useApiClient.ts:295-615` with the
  generated ones from `@sparql-query-lib/contracts`; the first proof is
  `testCaseSchema` carrying `dataGraphs`, then `TestWorkArea.bodyOfVersion`
  and `versionBody` round-trip it.
- Generate the client: a small script over `routes.generated.ts` (or the
  swagger JSON) emitting typed `request<TBody, TResponse>` functions; split
  `useApiClient` into `api/<entity>.ts` modules that wrap the generated calls.
- Remove every `as never` (≈49) by making `*CreateInput`/`*UpdateInput` match
  what the UI sends; where the UI sends a client-only field, mark it in the
  type rather than casting.
- `src/types/*`: delete what contracts already provides; keep and label
  client-only types (`nodeKind`, `basedOnVersion`).
- Log a failed request once, not three times.

**Acceptance.** A multi-graph test created over the API round-trips through the
UI with its graphs intact (Playwright, mocked API). `grep -c "as never" src`
is 0 and `useApiClient` imports zero local `z.object` schemas.

### WP25 — One entity lifecycle · L · deps: WP23 · closes C12, D2, web #5

**Changes.**
- `composables/useEntityDraft.ts`: `persistDraft`, the 500 ms debounce,
  `hydratingRecord`, `matchesSaved`, `discardDraft`, `locallySavedAt`,
  `removeDraft`, driven by `{ section, id, editorBody, applyBody, savedBody }`.
- `composables/createVersionedEntityStore.ts`: `loadX`, `fetchX`, `concurrency`,
  `deriveIfMatchToken`, save-with-If-Match, one 412 handling path that surfaces
  a conflict to the user (toast with "reload / overwrite").
- `useCallableDrafts.ts`: a per-section `body` union instead of the
  query-shaped envelope; `MAX_BYTES` and per-entry cap; try/catch on
  `setItem` with a visible "draft not saved" state; a `storage` event listener
  so tabs converge.
- Migrate the eight WorkAreas and six stores; `entityLifecycle.ts` becomes the
  checker it says it is (a test that every section's store passes the matrix).
- Tests, ETL jobs and argument sets stores send `If-Match`.

**Acceptance.** `grep -c "function persistDraft" src/components` is 0;
`entityLifecycleMatrix.test.ts` runs over every section; a quota error leaves
other sections' drafts intact and shows the state.

### WP26 — Route the sections · M · deps: WP25 · closes D5

**Changes.** `pages/index.vue` → `pages/[section]/[[id]].vue` with the WorkArea
chosen from `lib/sections.ts`; `selectedId` from the route param; per-section
`onSaved`/`onDeleted` registered in `sections.ts` rather than 41 `handle*`
functions. Keep the old `?query=` URLs working with a redirect middleware for
one release.

**Acceptance.** Existing Playwright navigation specs pass against the new
URLs; `pages/index.vue` is under 300 lines.

### WP27 — Dead web code · S · deps: none · closes E5 (web half), web #7

**Changes.** Move `pages/tests/*`, `pages/wireframe-*`, `pages/examples/*`
behind a `definePageMeta({ middleware: 'dev-only' })` or delete them; delete
the 9 unreferenced components and 3 composables listed in web #7; extend
`scripts/check-orphans.mjs` to root only `pages/**`, `app.vue`, `plugins/**`
and resolve `components/` and `composables/` through imports and template
tags (Nuxt auto-import names). Turn `designSystem.test.ts` residue lists into
a stylelint/custom-lint rule or delete the residue.

**Acceptance.** Production build has no `/tests/*` or `/wireframe-*` routes;
the orphan ratchet catches an unreferenced component in a self-test.

---

## Phase 6 — Packages

### WP28 — SRL stratifier expansion invariant · S · deps: none · closes C6, packages #11

**Changes.** `packages/srl/src/stratify.ts`: either expand IRIs itself or
assert every term is expanded (as `tuples/compile.ts:47-61` does) and throw
otherwise. `packages/api/src/lib/srlChecks.ts:82` and
`packages/srl/test/w3c.harness.test.ts:51,68` expand before calling. Harness
fixes: order-insensitive manifest parsing, `scoreboard.json` written to a
temp path or only under an env flag, `expected-pass.json` never self-seeded,
and run the `eval`/`eval2` suites in the srl package (or import the API's
harness).

**Acceptance.** The negative-cycle document from the review is reported
non-stratifiable through `srlChecks`; the W3C stratification score is
recomputed and committed.

### WP29 — Runtime publish hardening · M · deps: none · closes C14, D12, packages #9/#10

**Changes.** `bundle.ts`: hash the canonical JSON of the whole `ExportedQuery`
(and the group graph); validate prefix rows on load (`[string, string]`,
`SAFE_PREFIX`, absolute namespace). `library.ts:153`: `QueryHandle.exported`
returns a frozen deep copy. `public-api.md`: cut the surface to what an
exported page needs; move `renderValuesBlock`, `alignArgumentSets`,
`substituteLimitOffset`, `hashTemplateText` and friends under an
`@sparql-query-lib/runtime/internal` entry with no semver promise.
`TermValue.type` becomes the literal union; accept `typed-literal` and `bnode`
(normalise `typed-literal` to `literal` with `datatype`; reject `bnode` with a
clear error) so `types` and `runtime` agree. Move `parser.injection.test.ts`'s
hostile-value table into `packages/runtime/test/sparql-terms.security.test.ts`
(the file `sparql-terms.ts:18` already cites). `httpExecutor`: non-JSON 200 →
`SparqlEndpointError`. Reject a literal carrying both `datatype` and
`xml:lang`.

**Acceptance.** `publish-check.sh` passes with the smaller `public-api.md`;
an edited prefix namespace fails integrity; a Virtuoso-shaped
`typed-literal` row chains through a group.

### WP30 — rdf-delta stays pure · M · deps: none · closes D10, packages #5

**Changes.** Move `blobStoreHttp.ts`, snapshot/checkpoint/rebase and the
DuckDB `patchLog.ts` SQL builders out of `packages/rdf-delta` (into
`packages/api/src/lib/patch/` or a new `patch-log` package; decision D6);
drop `poc/` from the build. `derive.ts:385`: detect union-default-graph
endpoints (a probe or a backend flag) and scope default-graph membership
with `GRAPH ?g` accordingly. Add an equivalence case whose oracle relabels
blank nodes in CONSTRUCT results, so the HTTP path is exercised.

### WP31 — contracts hygiene · S · deps: none · closes D11, persistence #10

**Changes.** Move `generated/query-version.ts`, `query-group-version.ts`,
`ruleset-version.ts` to `src/hand-written/`; fix or generate
`generated/sparql.ts`; make `schema/contract-routes.ts` either the generator's
output or deleted (decision D7). CI step: `generate-schemas && git diff
--exit-code packages/contracts`. `test/scripts/route-generation.snapshot.test.ts`
generates into a temp dir and compares with the committed files. Add a
contracts test that every route schema's `$id` is unique and every entity
schema referenced by a route exists. Reduce `any` in `generate-schemas.ts`
core converters.

### WP32 — Persistence residue · S · deps: WP9 · closes D7

**Changes.** Delete `LENS_BY_TYPE`, `getLensForType`, `CommonLens` and the
~50 `*Utils` imports in `EntityRegistry.ts` (keep `TTL_MS` and the repository
map keyed by `ENTITY_TYPE_NAMES`); remove the dynamic import in
`EntityStore.ts:30-38` the cycle forced; rename `LdkitQuery`/`toLdkit`
(`ldkit:IRI` in the vocabulary stays, as `entity-model.md` explains); fix the
comments citing `readParity.test.ts`/`createParity` or restore those tests.
Bring `TestRun`/`TestRunCase` and the benchmark run types through the
coordinator, or document in `storage-and-caching.md` that they are a second
discipline and why.

---

## Phase 7 — Engineering infrastructure

Status: WP33 and WP34 done, WP35 in part, on `claude/nice-einstein-r2f7g8`.
Node is aligned on 26 (the images' major) rather than tested on two. The lint
gate is a per-package, per-rule ratchet (`scripts/lint-ratchet.mjs`) rather
than an `any` count alone; `no-console` is at zero in every package. WP35's
fake store is `test/support/fakePersistenceAdapter.ts`, which stands behind the
repository lenses as well as the adapter, since the `*Utils` modules reach
storage through the lenses; it replaced 84 of the 104 module mocks, leaving
`MemoryCacheManager.test.ts`, a test of the cache's calls to storage. Still
open, because they wait on WP20a/WP21: the shared `buildTestApp` and the
exact-message assertions. e2e already ran on every push; it now also gates
Dependabot's auto-merge.

### WP33 — First run and docs reconciliation · S · deps: none · closes E1, E4, E6

**Changes.** `Justfile:30,302`: 3005. Remove inert env vars
(`FEATURE_*_ENABLED`, `RULESET_CANON_DEBUG`, `SQLIB_BACKEND_QMS_FUSEKI_DEV_*`)
from the Justfile and `packages/api/package.json`. Root `build` → `pnpm -r
build`; `Dockerfile` builds via the same; `web/package.json:70-71` →
`workspace:*`. CONTRIBUTING: commitlint is blocking, releases exist (`v0.1.0`),
the `any` zone forbids `as any` only (or make it forbid `: any` and fix 53).
README "Nothing has been released" → the truth. `architecture.md:234` route
count. Delete `packages/web/tests/TESTING_SUMMARY.md`. Update
`security-model.md` after Phase 1 lands (a checklist item in WP2, WP4, WP5).
Fix `docker-compose.mcp-https-image.yml` to a buildable Fuseki image.

### WP34 — A real linter · M · deps: none · closes E2

**Changes.** Root `eslint.config.js` with `typescript-eslint` recommended,
`unused-imports`, `no-console` (allow in `scripts/`), `no-explicit-any` as a
ratchet (baseline count per package, falling only); `lint.sh` runs it and
drops the "placeholder" warning. Remove the unused dependencies in E2 (seven
in api, three in web). Replace `console.*` in `api/src` (149) with the
logger; in `web/src` (160) with a `debug` helper stripped in production.
Align Node: `.nvmrc`, Dockerfiles, CI matrix on one major (or test on both).

### WP35 — Test suite health · M · deps: WP20a · closes E3

**Changes.** Delete `test/scenarios/fixtures/scenario-test-base.ts`; one
`test/support/buildTestApp.ts` replacing the 21 private builders; a fake
`PersistenceAdapter` injected via `setPersistenceAdapter` so the 102
`vi.mock('…/persistence/utils/*Utils')` calls go; replace exact-message
assertions with error classes where the message is not the contract; update
`README-TESTING-PATTERNS.md` to the three shapes that actually exist. Web:
unit-mount `QueryWorkArea` and `QueryGroupWorkArea` at least once each with
the fake API; make `e2e.sh` a required gate on `main` pushes (or a nightly)
once it is stable.

---

## Sequencing

| Order | Packages | Can run in parallel with | Notes |
| --- | --- | --- | --- |
| 1 | WP1, WP2, WP5, WP6, WP8, WP11, WP13, WP19, WP23, WP27, WP28, WP33 | each other | all small, no shared files |
| 2 | WP3, WP4, WP7, WP9, WP12, WP14, WP15, WP31, WP34 | each other | depend only on order 1 |
| 3 | WP10, WP16, WP18, WP22, WP29, WP30, WP32 | each other | |
| 4 | WP17, WP20a, WP24 | WP17 ∥ WP24 | WP20a before any other route work |
| 5 | WP20b–h, WP21, WP25, WP35 | WP20x ∥ WP25 | one module per PR |
| 6 | WP26 | | last, on top of WP25 |

Phase 1 (WP1–WP7) is the release blocker for any deployment under
`SQLIB_AUTH_MODE=required`. Everything in order 1 is a good first week.

## Decisions needed

- **D1 — path segment.** `/v` (queries, query-groups, argument-sets,
  benchmarks) or `/versions` (the other seven). Pre-1.0, so pick one and drop
  the other; the plan assumes `/versions` with no alias. Needed by WP20a.
- **D2 — benchmark ownership.** Give `BenchmarkExperiment` an `isPartOf`
  library (schema change, backfill) or make the plugin admin-only. The plan
  assumes the library. Needed by WP2.
- **D3 — `GET /sparql` updates.** The plan refuses UPDATE over GET. If a
  client depends on it, keep it behind an explicit flag. Needed by WP5.
- **D4 — in-process query cancellation.** Worker-thread Oxigraph (real
  cancellation, larger change) versus caps only (small, documented gap).
  Needed by WP16.
- **D5 — `SERVICE` policy.** Strip, allowlist per backend, or leave to the
  store. Needed by WP19.
- **D6 — where the blob store and patch-log SQL live** once they leave
  `rdf-delta`. Needed by WP30.
- **D7 — `contract-routes.ts`.** Generate it or delete it. Needed by WP31.
