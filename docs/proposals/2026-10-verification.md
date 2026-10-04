# Verification of the review work packages (4 October 2026)

Scope: every phase of [2026-09-review-work-packages.md](2026-09-review-work-packages.md)
except Phase 4, which is in progress. Verified at `main` 401f23e by reading the
code and tests for each acceptance criterion, re-running the whole suite, and
reproducing the original findings where a fix was claimed. Finding ids (S1,
C1, …) refer to [2026-09-review.md](2026-09-review.md).

Suite at this commit, all green, working tree clean afterwards:

| Suite | Files | Tests | Was |
| --- | --- | --- | --- |
| api | 375 | 4120 | 352 / 3839 |
| web | 228 | 2540 | 211 / 2034 |
| mcp-server | 5 | 62 | 2 / 14 |
| srl, rdf-delta, runtime, runtime-oxigraph, tools | 34 | 666 | unchanged |

`scripts/ci/lint.sh`, `check-doc-links.mjs` and `check-orphans.mjs` pass.

## Scorecard

| WP | Status | Note |
| --- | --- | --- |
| **Phase 1** | | |
| WP1 refuse create on existing id | done | under `CACHE_PRELOAD=false` the store probe is same-type-or-Library only |
| WP2 scope every execution path | done | route-matrix rows flipped to 403; `InternalExecution` discriminant |
| WP3 DynamicQueryNode guard | done | |
| WP4 second-entity checks | **partial** | `PUT /rule-sets/:id` move has no destination check; route-level move tests only for queries |
| WP5 `/sparql`, read-only, CORS | done | `readOnlyMutating` opt-in exists but is used by no route |
| WP6 token verification | done | entityGuard pattern-match change untested |
| WP7 MCP HTTP transport | done | 11 transport tests added |
| **Phase 2** | | |
| WP8 null / no-op / dates | done | dead `Date` branch left in `route-helpers.ts` |
| WP9 refresh vs write | done | per-id epochs, finer than planned |
| WP10 one version allocator | done | 11 writers; no pre-insert uniqueness assertion; lock per process |
| WP11 store modes | done | |
| WP12 immutability by type | done | two documented exceptions, ETL pointer one is debatable |
| **Phase 3** | | no Status paragraph was recorded; all verified from code |
| WP13 per-run ephemeral stores | done | |
| WP14 RDF hand-off formats | done | unknown media type defaults to N-Quads |
| WP15 VALUES row semantics | done | |
| WP16 deadlines and caps | done | D4 decided as caps; single-query `/execute` has no deadline |
| WP17 one invocation path | **partial** | `ResolvedNode` union deferred (recorded in commit b0b9af7) |
| WP18 LIMIT/OFFSET placement | done | tokens over masked text, not AST; sound given Traqula keeps no lexeme |
| WP19 small engine fixes | done | D5 decided as "leave SERVICE to the store" |
| **Phase 5** | | |
| WP23 change feed by entity | done | tuple sets missing on both API and web sides |
| WP24 contracts are the wire | **partial** | local schemas and `as never` gone; client not generated or split (waits on WP31, as recorded) |
| WP25 one entity lifecycle | done | draft body still query-shaped; argument sets half-guarded |
| WP26 route the sections | done | volume moved into a 2,025-line `LibraryWorkspace.vue`; 11 `selected*Id` refs remain |
| WP27 dead web code | **partial** | `pages/examples/*` still ship; orphan baseline grew |
| **Phase 6** | | **nothing landed** apart from the lint sweep |
| WP28 stratifier expansion | **not done** | C6 reproduces at HEAD |
| WP29 runtime publish hardening | **not done** | public surface grew 142 → 152 |
| WP30 rdf-delta boundary | **not done** | |
| WP31 contracts hygiene | **partial** | `hand-written/` exists (from WP24); no CI drift check, no tests, `contract-routes.ts` undecided |
| WP32 persistence residue | **not done** | premise changed: `getLensForType` now has production callers |
| **Phase 7** | | |
| WP33 first run and docs | done | |
| WP34 a real linter | done | two `any` ratchets now coexist |
| WP35 test-suite health | **partial** | fake adapter replaced 84 of 104 util mocks; no shared `buildTestApp`; no QueryWorkArea unit mounts |

Totals over the 30 packages in scope: 21 done, 5 partial, 4 not done. The
four not done are all Phase 6.

## Items that should be fixed before Phase 4 lands

These are small, and two of them are security.

1. **`PUT /rule-sets/:id` can move a rule set into a library the caller cannot write.**
   `packages/api/src/routes/rule-sets.ts:353-386` validates the new `isPartOf`
   with `analyseReferences` only. Add `requireContainmentWritable(request,
   current, updates)` as the other seven routes do (`routes/rules.ts:273`), and
   a row in `test/auth/containmentMoves.test.ts`. (S6 residual; the plan's
   seven-route list omitted rule sets.)
2. **Move tests only cover queries.** `test/auth/containmentMoves.test.ts:102-131`
   drives `PUT /queries/:id` alone; removing the call from any other route
   fails no test. Add rows for rules, data-blocks, data-graphs, tests,
   tuple-sets, query-groups, rule-sets.
3. **Stratifier (C6) still reproduces.** `packages/srl/src/stratify.ts:336`
   compares `(prefix, local)` text; `packages/api/src/lib/srlChecks.ts:82` and
   `packages/srl/test/w3c.harness.test.ts:68` call it un-expanded. The
   conformance verdict for a document mixing `ex:q` and `<http://example.org/q>`
   is wrong today. WP28 is a one-file fix plus two call sites.
4. **Tuple sets are outside the change feed.** `packages/api/src/lib/changeEvents.ts:134-147`
   has no `tuple-sets` segment, and `packages/web/src/composables/useLibraryRefresh.ts:80-125`
   has no `tupleSet` refresher, so an MCP edit leaves the tuple-set editor
   stale with a stale token (the C7 failure mode for one kind).
5. **Single-query `/execute` has no deadline.** Only the group path wraps the
   engine in `executionDeadlineMs()`; `routes/execute.ts:990,1005,1032` pass
   the disconnect signal alone, and `ExecutionAbortedError` is mapped to
   504/499 only in the group branch (`:1124`). Wrap with
   `executionSignal(signal, executionDeadlineMs())` and map in both branches.
6. **WP1 under `CACHE_PRELOAD=false`.** `CacheCoordinator.ts:387` probes the
   store for `[type, 'Library']` only, so a create over an uncached id of a
   third type is not refused in that mode. Either widen the probe (a
   store-wide `ASK { <id> ?p ?o }`) or state the narrower guarantee in WP1's
   Status and add a cross-type test next to `test/lib/CacheCoordinator.test.ts:144`.

## Residuals by phase

### Phase 1
- `RuleSetVersionWriter.createRuleSetVersion` takes `authScope?` optionally
  (`src/lib/RuleSetVersionWriter.ts:46,63`); make it `{ request } |
  InternalExecution` like `ExecutorFactory` so a new caller cannot skip the
  pin check by omission.
- `readOnlyMutating` (`src/config/readOnly.ts:46,143`) is set on no route; the
  `GET /sparql?record=patch` gate lives in the handler. Delete the unused knob
  or point its comment at the handler gate.
- Dead mocks of the removed `getExecutorForNodeSync` in
  `test/routes/execute.v1.test.ts:17` and `test/routes/execute.completion.test.ts:19`.
- No test that an entity route whose `:id` is spelled like an exempt suffix
  (`POST /queries/preview`) is still guarded (`src/auth/entityGuard.ts:109-112,247-258`).

### Phase 2
- `src/routes/route-helpers.ts:46-62,73-76`: the `Date` branch is now dead.
- `src/lib/CacheCoordinator.ts:439-442`: a *thrown* read-back in `'log'` mode
  still reports the update saved (store-absence is refused, store-failure is
  not).
- `src/lib/versionNumbering.ts:33-35`: `nextVersionNumber` is still exported
  and unlocked; nothing in `src` uses it.
- Pointer flips outside the allocator: `src/routes/tuple-sets.ts:730-737`
  (re-point after version delete, outside the parent lock) and
  `src/lib/EtlService.ts:584-587` (column-mapping pointer, result discarded).
- `src/lib/immutability.ts:37-39`: the ETL `currentColumnMappingVersion`
  exception makes a frozen version's behaviour movable; create the mapping
  inside the version write or hang the pointer off the mutable `EtlJob`.
- Tests to add: EtlJob leg of backend-delete clearing; delete racing an id
  refresh.

### Phase 3
- Record a Status paragraph for Phase 3 and close D4 (caps, see
  `packages/api/src/config/executionLimits.ts`, `docs/reference/configuration.md:146`)
  and D5 (leave `SERVICE` to the store, `docs/explanation/security-model.md:146-153`)
  in the plan's decisions list, which still shows them open.
- `ResolvedNode` is still a flat optional bag (`src/lib/orchestration/types.ts:135-159`).
- No per-query bound for a synchronous in-process Oxigraph query
  (`src/server/OxigraphSparqlExecutor.ts:56,82`); the plan's stated minimum
  for the caps option was a default `LIMIT` injection. Accept and document, or
  add it.
- `src/lib/orchestration/rdfHandoff.ts:26`: unknown media types fall back to
  N-Quads and will be mis-parsed; throw or extend the table.
- `packages/runtime/src/limit-offset.ts:167`: the scanner matches
  `?s ex:LIMIT 0001 .` (prefixed-name predicate, integer object). Low priority;
  add a negative test.
- `ExecutionEngine.ts:208`: the untyped-node refusal is thrown outside the
  `onNodeError` boundary and has no test.
- `src/lib/orchestration/ExecutorFactory.ts:293-296`: `oxigraphEphemeral`
  backend-type stores are keyed by backend id, shared across runs and never
  destroyed (adjacent to C5, not covered by WP13).
- `src/lib/invokeCallable.ts:68`: UPDATE legs never receive the abort signal
  by design; say so in `configuration.md:146`.
- No route-level test drives a real client disconnect through `POST /execute`.

### Phase 5
- Argument sets send `dateModified` as `If-Match` directly and skip the 412
  replay (`useArgumentSets.ts:505-508,612,650`, `useArgumentSetsStore.ts:81,96`);
  `useDataGraphsStore.ts:59-76` and `useTupleSetsStore.ts:67-82` keep their own
  concurrency maps rather than the shared core.
- `useCallableDrafts.ts:80` `body: unknown` and `useEntityDraft.ts:132-143`
  still stamp `type: 'query'`; the per-section body union is open.
- `pages/examples/index.vue`, `pages/examples/sudoku-solver.vue`,
  `components/SudokuGrid.vue` ship as production routes with no guard.
  `pages/tests/query-results-bench.vue` stays for the perf harness (recorded).
- `scripts/orphan-baseline.json` accepted 11 `components/build/*.vue`, 16
  `components/ui/*` files and 4 composables as dead rather than deleting them,
  on top of the 13 `packages/api/scripts/*` entries.
- `test/components/designSystem.test.ts:26` `MOCKUPS` regex is stale; the five
  `RESIDUE` maps are still a test, not a lint rule.
- `test/components/DataGraphWorkArea.drafts.test.ts` makes 14 unmocked
  fetches to `api.test` that fail and are swallowed.
- `useApiClient.ts` is 3,057 lines, hand-written; generation and the
  per-entity split wait on WP31 (recorded). `src/types/{query,backend,library,queryGroup}.ts`
  carry no client-only label.
- `LibraryWorkspace.vue` is 2,025 lines with 11 `selected*Id` refs; the
  route-derived single selection the plan described is not realised.
- Playwright was not run in this verification; the WP24 round-trip is covered
  by a vitest component test plus `packages/api/test/contracts/test-route-parity.test.ts`.

### Phase 6 (all open)
- WP28: expand or `assertExpandedTerms` in `stratify`; expand in `srlChecks.ts:82`
  and `w3c.harness.test.ts:68`; harness: order-insensitive manifest parsing
  (`:33-42`), `scoreboard.json` out of the source tree (`:91`, rewritten on
  every run today), no self-seeded `expected-pass.json` (`:98-101`), run
  `eval`/`eval2` in the package (`:30`).
- WP29: `bundle.ts:514-520` hashes `template.text` only and `:18` still says
  "catches any edit"; `:274` validates prefix rows as `Array.isArray` only;
  `library.ts:155-157` returns the mutable query; `public-api.md` is 152
  names with no `./internal` entry; `sparql-terms.ts:23` type collapses to
  `string`, `:149-184` rejects `typed-literal`/`bnode` with one message,
  `:165-171` datatype wins over lang; `executor.ts:152` non-JSON 200 is a bare
  `SyntaxError`; `sparql-terms.security.test.ts` cited at `:18` does not exist.
- WP30: `rdf-delta/src/index.ts:60-92` still exports blob store, patch-log SQL
  and snapshot machinery; `package.json:20` still builds `poc/`; no
  union-default-graph handling in `derive.ts`; decision D6 not taken;
  `architecture.md:23` still calls it pure derivation.
- WP31: `generated/sparql.ts:1-4` false banner; `schema/contract-routes.ts`
  still exists and `schema/index.ts:17-18` still says the two disagree (D7);
  no `generate-schemas && git diff --exit-code` in CI;
  `test/scripts/route-generation.snapshot.test.ts:11-13,26-31` still writes
  into the committed files and asserts `length > 0`; `contracts` has no tests.
- WP32: `EntityRegistry.ts:53-160,258-272` lens plumbing intact, now with
  production callers (`CacheCoordinator.ts:639`, `EntityRepositories.ts:3`), so
  the deletion needs a replacement map keyed by `ENTITY_TYPE_NAMES`;
  `EntityStore.ts:46` dynamic import; `EntityAssembler.ts:5` and
  `EntitySerialiser.ts:17` cite tests that do not exist; `TestRunStore.ts:30-31`
  still writes through lenses and `storage-and-caching.md` does not say so.

### Phase 7
- Two `any` ratchets coexist (`scripts/count-any.mjs` + `any-baseline.json`,
  ESLint `no-explicit-any` in `lint-baseline.json`); keep one.
- WP35 open items, as recorded: shared `buildTestApp` (21 private builders,
  100 files call `Fastify(` inline), ~90 exact-message assertions, no unit
  mount of `QueryWorkArea`/`QueryGroupWorkArea`. e2e gates Dependabot
  auto-merge only; branch protection cannot be verified from the checkout.
- `debug()` helper is imported by two files; the web's 160 `console.*` were
  reclassified to `warn`/`error` rather than routed through it.

## Deviations from the plan, judged

| Where | What | Verdict |
| --- | --- | --- |
| WP2 | benchmarks got an owning library (D2) | right call |
| WP4 | ETL admin gate in handlers, not `adminSuffixes` | sound, suffixes match every method |
| WP9 | per-id epochs instead of per-type + per-id | finer than planned, sound |
| WP12 | two freeze exceptions | benchmark draft is justified; ETL pointer is content-like, revisit |
| WP16 | caps instead of worker threads (D4) | acceptable, but the stated minimum (per-query cap) was not added |
| WP18 | token scan over masked text, not AST | sound, Traqula keeps no lexeme |
| WP24 | hand-written expansions over generated leaves, parity-tested | sound; client generation still owed |
| WP25 | 412 handled by one replay, not a toast | reasonable for field-level updates |
| WP26 | one optional-param page, workspace component | fine, but the volume moved rather than shrank |

## What to do with Phase 6

WP28 is small and affects conformance results; do it now. WP31 unblocks the
rest of WP24 and should follow Phase 4 (WP20a decides `contract-routes.ts`).
WP29 matters only before the first `runtime` publish. WP30 and WP32 are
hygiene and can trail.
