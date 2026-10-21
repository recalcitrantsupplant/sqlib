# A `sqlib` CLI and in-process runs

Status: decided (D1 to D7 agreed 2026-10-19), not yet started. Companion to [static-export.md](../guides/static-export.md),
which draws the line this proposal extends: the server authors and compiles,
and something smaller runs the result with no server present.

## The problem

An ETL pipeline runs in a container. It reads rows from blob storage, converts
them to RDF, and writes the RDF back. Today the conversion is
`POST /etl-jobs/:id/execute` on a running sqlib server. That puts a Fastify
process, the entity store, auth and a feature flag between the rows and the
RDF. None of them does work in the loop. The same is true of a rule set run:
`RuleSetExecutor` already runs inside the process against an Oxigraph store and
never needed an endpoint.

The run loops contain no HTTP. `EtlService.runPipeline` is: DuckDB stream →
rows to bindings → VALUES splice → CONSTRUCT on an executor → sink callback.
`RuleSetExecutor.execute` is: load rule versions → compile with `srl` →
stratify → SPARQL UPDATE per rule per iteration on an ephemeral store. In both,
the route only starts the loop.

What stands in the way of running them elsewhere is where the code lives, not
what it does. Both loops sit in `packages/api` and reach for the cache
coordinator, the DuckDB singleton configured from the environment, the OTEL
logger and `ISparqlExecutor`. This proposal moves the loops out, adds the
compiled forms of ETL jobs and rule sets to the export bundle, and puts a thin
command-line tool over the result.

## What the result looks like

```sh
# compile once, on the server; pull the result (the store-direct export exists today as a pnpm script)
sqlib pull --from http://sqlib.internal --library urn:sqlib:library:main --out lib.json

# run many times, in a container with no sqlib server
sqlib etl run   --bundle lib.json --job customers --allow-filesystem --out out.nt --report run.json
sqlib rules run --bundle lib.json --rule-set dependencies --data out.nt --out inferred.nt
sqlib query     --bundle lib.json --query people-by-city --arg city=<http://example.org/Perth> --data inferred.nt

# or from text, with the parser in the process
sqlib rules run --srl rules/customers.srl --data base.ttl --out inferred.nt
sqlib query     --file q.rq --arg city=<http://example.org/Perth> --endpoint https://…
sqlib check     --srl rules/*.srl --file queries/*.rq
```

Data in and out is stdin and stdout when the path is `-`, so commands compose:

```sh
sqlib etl run --bundle lib.json --job customers --allow-filesystem --out - \
  | sqlib rules run --srl rules/customers.srl --data - --out inferred.nt
```

The run container ships the CLI, Oxigraph and DuckDB. Nothing from
`packages/api` is in it.

## Decisions

All seven are decided. Each work package that depends on one names it.

**D1. The parser ships in the CLI. Decided: yes.** The Traqula parser, generator and rules
packages are pure JavaScript built on Chevrotain. Unpacked they are a few
megabytes, against roughly 50 to 70 MB for the DuckDB native binding and 10 to
20 MB for Oxigraph. Size is not the cost. The risk is two substitution paths
that can drift. The plan avoids that: text is compiled to a `QueryTemplate`
with `compileVerifiedTemplate`, and the template is then spliced by the same
runtime code a bundle uses. One splice, two template sources. This is what
the exporter and the runtime already do, now in one process. The parser also
buys `sqlib check`, SRL from a file, and input detection for ad-hoc queries.
Decision: yes, as a separate `compiler` package (WP1), so the browser runtime
stays parser-free.

**D2. Query groups are out of scope. Decided: skip; revisit on a real need.** See [Groups](#groups-why-not) below. A
group whose nodes are all exportable already runs through the runtime's
`GroupHandle`, and the CLI gets that for free. The orchestration engine is not
extracted.

**D3. Compiled ETL jobs and rule sets go into bundle v1 as optional members.
Decided: yes, included by default.** `etlJobs` and `ruleSets`, keyed by slug
like `queries`. Additive fields do not bump the version, because the reader
ignores fields it does not know. The exporter includes both whenever the
library has them; a later UI control can exclude them. Rule sets also run from
SRL text directly, so a bundle is one of two sources for them.

**D4. DuckDB capability defaults differ between server and CLI. Decided: yes.**
The server
defaults every capability to off, because submitted SQL reaches the API host.
The CLI runs in the operator's own process, and reading local files is the
point. Proposed CLI defaults: filesystem on, HTTP off, extension install off,
memory limit and query timeout as the server's. Every flag has a `--no-` form,
and the resolved profile is printed to stderr once per run, as the server logs
it at boot.

**D5. The CLI pulls a bundle from a server; it does not open the store.
Decided: yes, as `sqlib pull`.** The store-direct export stays where it is, a
script in `packages/api` that also runs in the server image. The CLI's `pull`
calls `GET /libraries/:id/export-bundle` on a running server and writes the
file. This keeps `api` out of the CLI's dependency graph, which is the whole
point of the image size. The verb is `pull` rather than `export` or `import`:
the server exports, and `import` already means loading into a store
(`import:library-store`, `POST /rule-sets/:id/srl`).

**D6. Streamed ETL output is N-Triples by default. Decided: yes.** Chunks are appended to one
file. Concatenated Turtle documents repeat prefix declarations, and a reader
that is strict about them fails. N-Triples appends and splits safely. Turtle
is allowed when the run is a single chunk, or through a final conversion pass.

**D7. Package names. Decided: yes.** `@sparql-query-lib/compiler`, `@sparql-query-lib/runtime-etl`,
`@sparql-query-lib/runtime-duckdb`, `@sparql-query-lib/runtime-srl`,
`@sparql-query-lib/cli` with the bin `sqlib`. The `runtime-*` prefix follows
`runtime-oxigraph`: packages that run exported artifacts and have no server
dependency.

## Work packages

Each work package is one branch and one pull request with its own tests.
Sizes: **S** under a day, **M** one to three days, **L** a week or more.

### Phase 1 — Extract pure compute from `api`

These packages exist because a second host needs the same code. The rule from
[architecture.md](../explanation/architecture.md) applies: `api` imports them
rather than copying, so the server and the CLI agree by construction.

#### WP1 — `compiler` package (M) · needs D1

Move the parser-dependent half of `packages/api/src/lib/parser.ts` into
`packages/compiler`:

- `parseQuery`, `formatQuery`, `formatQueryString`
- `detectInputs`, `detectQueryOutputs`
- `applyArguments`
- `compileVerifiedTemplate`, and `locatePageParameters` from
  `lib/export/queryBundle.ts`
- `detectSparqlOperation` and the exportable-type table

Dependencies: `@traqula/parser-sparql-1-2`, `@traqula/generator-sparql-1-2`,
`@traqula/rules-sparql-1-2`, `@sparql-query-lib/runtime`. Nothing else.

The six OTEL logger calls become an optional `diagnostics` callback on the
constructor. `api`'s `parser.ts` becomes a subclass or wrapper that supplies the
logger. Tests under `packages/api/test/lib/parser*.test.ts` move with the code;
a thin test stays in `api` for the wrapper.

Acceptance: `api` tests pass unchanged. `packages/compiler` has no import from
`api`. `scripts/check-public-api.mjs` lists its exports. The Dockerfile's
builder and production stages copy the new package (both stages list every
package by hand; a missing line fails the image build, not the local build).

#### WP2 — `runtime-duckdb` package (M) · needs D4

Move `DuckDbService` out of `api`:

- The class, `DuckDbCapabilities`, `DuckDbLimits`, `withDeadline`,
  `streamChunks`, `getSchema`, `preview`, `mapDuckDbTypeToXsd`, the fixture
  database path, and the two error classes.
- The constructor keeps taking an explicit profile and limits. The
  environment-reading `resolveDuckDbCapabilities` and `resolveDuckDbLimits`
  stay in `api`, as does the `duckDbService` proxy singleton.

`@duckdb/node-api` becomes this package's dependency, not `api`'s. The
`etl-extension-smoke.ts` script moves here as a bin-less script the CLI later
exposes as `sqlib duckdb check`.

Acceptance: `EtlService` tests and `DuckDbService` tests pass. The package
builds with `tsup` in the `runtime-oxigraph` pattern (ESM and CJS, declarations
for both, `oxigraph`-style external for the native binding).

#### WP3 — `runtime-etl` package (M) · needs WP1

Status: done. What changed from this plan is recorded below.

The pipeline loop and the row mapping, with the DuckDB dependency injected:

```ts
export interface EtlRun {
  source: AsyncIterable<{ rows: Record<string, unknown>[] }>;
  query: QueryTemplate | ((argumentSet: TemplateArgumentSet) => string);
  columns: ColumnDefinition[];
  executor: Executor;                      // the runtime's interface
  onOutput: (rdf: string, chunk: EtlOutputChunk) => Promise<void>;
  onChunk?: (p: { completedChunks: number; totalRows: number }) => Promise<void>;
  maxRows?: number; maxRowsPolicy?: 'stop' | 'fail'; dryRun?: boolean; signal?: AbortSignal;
  abortError?: (signal: AbortSignal) => Error;
  warn?: (message: string, context: Record<string, unknown>) => void;
}
export function runEtl(run: EtlRun): Promise<{ totalRows: number; completedChunks: number }>;
```

Moved from `EtlService`: `toLexicalForm`, the row mapping (now
`rowsToBindings`), `bindingsToArgumentSet` (now `toArgumentSet`), the loop body
of `runPipeline`, and the `ColumnDefinition` type. The persistence schema
re-exports the type.

What changed from the plan:

- **`query` takes a template or a function.** The plan had `api` compile the
  stored template once per run. A stored query that does not compile to a
  verified template would then have stopped running, where today it falls
  back to the AST path. So `api` passes its parser's `applyArguments`, which
  uses the compiled template whenever the query compiles. The CLI passes a
  template it compiled itself.
- **`abortError` and `warn` are hooks.** `api` keeps its own abort error (a 499
  for a non-`Error` reason) and its pino warnings; a host that passes neither
  gets the abort reason and silence.
- **`api` asks for N-Quads.** Both `api` executors return N-Quads for a
  CONSTRUCT when nothing is asked for, so asking for it explicitly changes no
  run's output. One label changes: when an HTTP endpoint reported no content
  type, the output file used to be labelled Turtle; it is now labelled N-Quads,
  which is what it holds.
- **The parity test compares sorted N-Quads lines.** The mapped values contain
  no blank nodes, so sorting the lines is a complete comparison and
  canonicalisation adds nothing.

Acceptance: `packages/api/test/lib/etlParity.test.ts` runs one job, read from
DuckDB in chunks, through `EtlService.runPipeline` and through `runEtl` with a
template compiled from text on the runtime's Oxigraph executor, and requires
the same RDF. The `EtlService` and execute-job tests pass unchanged.

#### WP4 — One executor interface (S) · needed by WP3 and WP5

`api` has `ISparqlExecutor` (`selectQueryParsed`, `constructQueryParsed`,
`update`, …). `runtime` has `Executor` (`ExecutionRequest` → `ExecutionResult`).
The runtime's interface has no `update`.

- Add an optional `update(text, options)` to `runtime`'s `Executor`.
- Implement it in `runtime-oxigraph`, over `store.update`.
- Add `toRuntimeExecutor(ISparqlExecutor)` in `api`, so `HttpSparqlExecutor`
  and `OxigraphSparqlExecutor` can be handed to the new packages unchanged.

Acceptance: `runtime` and `runtime-oxigraph` tests cover `update`;
`check-public-api` records the new export.

#### WP5 — `runtime-srl` package (L) · needs WP4

Status: done. What changed from this plan is recorded below.

The fixpoint loop from `RuleSetExecutor`, taking prepared rules rather than
version ids:

```ts
export interface RuleSetSource {
  id: string; ruleCount: number; dataBlockCount: number;
  prepareRules(): PreparedRule[];             // validated, stratified, in run order
  prepareDataBlocks(): PreparedDataBlock[];   // called after the base graph is loaded
  tupleSeeds?: string | null;
}
export class RuleSetRunner {
  run(source: RuleSetSource, options?: RuleSetRunOptions): Promise<RuleSetExecutionResult>;
}
```

Moved: the run itself (DATA blocks, stratum scheduling, iteration and cycle
detection, run-once rules, tuple capture), the record and result types,
`TupleStore` with `injectTupleReads` and `renderBindingValue`, `nquads.ts`,
dataset hashing and diffing, and `serializeStore`. `api` re-exports the tuple
store and the N-Quads helpers from their old paths.

Stays in `api`: loading rule and DATA block versions from the cache, refusing
invalid ones, preparing and normalising rule programs, `RuleStratifier`,
feature flags, the iteration cap, the deadline, the managed ephemeral store,
and the W3C suite seeding. `RuleSetExecutor.execute` is now the host: it
implements the source from its cache and passes its own Oxigraph executor and
store loader.

What changed from the plan:

- **A source the runner calls, not a prepared set it is given.** The run
  interleaves loading with store work in an order that shapes its result: an
  invalid DATA block is refused after the base graph is loaded, so its failure
  result already holds that graph. A source called at the same points keeps
  every failure result identical. Refusing is throwing, because the run already
  turns any error into a `failed` result with its message.
- **`RuleStratifier` stays in `api`.** It reads stored rule versions and feature
  flags, which are the host's. The CLI layers rules with `srl`'s `stratify`, as
  the parity test does.
- **The executor is a port.** `api`'s Oxigraph executor rewrites error messages
  ("SPARQL UPDATE query execution failed: …"), and rule records carry them, so
  `api` passes its own and every message is unchanged. The runner's default
  executor, for the CLI, uses the same wording.
- **One test moved off a list.** `storeWriteSites.test.ts` enumerates every
  direct store write in `api`. The runner's writes left with it: they are to the
  inference store it builds itself, or to the tuple store, which is not
  Oxigraph. When `api` runs a rule set, every write to its store still goes
  through its executor and store manager, which declare it to the checkpoint.

Acceptance:

- The W3C SHACL 1.2 Rules suite harness scores 203 of 203, every category in
  full, with no regression against its ratchet and no newly conforming entry:
  the same verdicts as before.
- `packages/api/test/lib/srlParity.test.ts` runs one rule set, recursive and
  negating across strata, through `RuleSetExecutor` from stored versions and
  through `RuleSetRunner` from SRL text, and requires the same inference graph.
- The `RuleSetExecutor` and execution-limit tests pass unchanged.

### Phase 2 — Artifacts

#### WP6 — Bundle v1: `etlJobs` (M) · needs D3, WP1, WP3

In `runtime/src/bundle.ts`:

```ts
export interface ExportedEtlJob {
  sql: string;
  template: QueryTemplate;         // compiled CONSTRUCT, same shape as a query's
  columns: ColumnDefinition[];
  chunkSize: number;
  textHash: string;                // of template.text
  sqlHash: string;
  description?: string; tags?: string[];
  sourceJob?: string; sourceVersion?: string; sourceMappingVersion?: string;
}
// ExportBundle gains: etlJobs?: Record<string, ExportedEtlJob>;
```

`assertValidBundle` checks the member when present. In `api`,
`lib/export/collectLibraryEtlJobs.ts` reads the library's jobs, resolves the
current column mapping version, compiles the template with the compiler, and
`attachEtlJobsToBundle` adds them. `scripts/export-bundle.ts` and
`GET /libraries/:id/export-bundle` include jobs by default (D3) and take
`--no-etl` / `etl=false` to leave them out. The job's `backendId` is not
exported: a run names its executor.

Acceptance: `packages/runtime/test/fixtures/bundle-v1.json` gains one job and
the committed-bundle test still loads it in a reader that predates the field
(the "ignore unknown members" test). A job whose template does not compile to a
verified template is skipped with a reason, as a query is.

#### WP7 — Bundle v1: `ruleSets` (M) · needs D3, WP5

```ts
export interface ExportedRuleSet {
  rules: ExportedRule[];           // name, program, producesTuples, tupleReads, tupleWrites, stratum
  dataBlocks: Array<{ name: string; quads: string }>;
  stratification?: StratificationReport;
  srl?: string;                    // the canonical document, for `sqlib check` and for humans
  description?: string; tags?: string[];
  sourceRuleSet?: string; sourceVersion?: string;
}
// ExportBundle gains: ruleSets?: Record<string, ExportedRuleSet>;
```

The exporter reuses `api`'s prepare step from WP5. A rule set with an invalid
rule version is skipped with a reason.

Acceptance: as WP6. The fixture bundle gains one rule set with one data block.

### Phase 3 — The CLI

#### WP8 — `cli` package and bin (M) · needs D5, WP1, WP3, WP5, WP6, WP7

`packages/cli`, bin `sqlib`, `private: false`. Argument parsing with Node's
`util.parseArgs`, as the existing scripts do, so no dependency is added.
Conventions:

- Data on stdout, logs on stderr, non-zero exit on failure.
- `-` means stdin or stdout for `--data`, `--out`, `--file`.
- `--bundle <path>` or a text source (`--file`, `--srl`) selects the template
  source. Both lead to one run path.
- `--endpoint <url>` or `--data <file…>` selects the executor: `httpExecutor`
  or `oxigraphExecutor` seeded with the files. `etl run` defaults to an empty
  in-process store, because the template only reads its own VALUES rows.

Commands:

| Command | Does |
| --- | --- |
| `sqlib pull --from <server> --library <iri> [--tag…] --out lib.json` | Fetches the bundle from a running server (D5) |
| `sqlib query --query <slug> \| --file q.rq [--arg v=term…] [--limit n=…]` | Runs a read query; prints SPARQL Results JSON or RDF |
| `sqlib etl run --job <slug> [--chunk-size] [--max-rows] [--dry-run] --out` | Runs an ETL job; streams N-Triples |
| `sqlib rules run --rule-set <slug> \| --srl file --data <files> --out [--trace]` | Runs a rule set; writes the inference graph |
| `sqlib check [--file…] [--srl…]` | Parses, detects inputs, checks SRL well-formedness; exit code is the verdict |
| `sqlib duckdb check [ext…]` | The extension and platform smoke test from `api`, relocated |

`--arg` takes a term in SPARQL syntax: `<iri>`, `"text"@en`, `"1"^^xsd:int`
with the bundle's prefixes. Argument rows from a file (`--args args.json`) take
the same SPARQL Results JSON `POST /execute` takes.

Acceptance: a test runs each command against the fixture bundle and the
fixture CSV with a temporary DuckDB. The `etl run` output equals the API's
output for the same job after canonicalisation. `check-publishable`,
`check-installable` and `check-public-api` cover the package.

#### WP9 — DuckDB flags and profile (S) · needs D4, WP2, WP8

`--allow-filesystem` (default on), `--allow-http`, `--allow-extension-install`,
`--unrestricted`, `--memory-limit`, `--query-timeout`, each with a `--no-`
form. The resolved profile prints to stderr once. HTTP implies filesystem,
as in the server; the CLI says so when `--allow-http --no-allow-filesystem` is
asked for.

#### WP10 — Run report (S) · needs WP8

`--report <path|->` writes JSON after the run: bundle `textHash` and `sqlHash`
of the job, source job and version IRIs, rows, chunks, bytes written, SHA-256
of the output, wall time per stage, the DuckDB profile and limits, and the
error if any. This replaces the server's `EtlExecution` record for a run the
server never saw. A later `--post-report <url>` is out of scope.

#### WP11 — Output formats (S) · needs D6, WP8

`etl run`: N-Triples by default; `--format turtle` is refused for a run of more
than one chunk unless `--merge` is passed, which does a final pass through
Oxigraph. `rules run`: `n-triples`, `turtle`, `n-quads`, `--inference-only`
versus the whole graph, matching the API's options.

### Phase 4 — Packaging and documentation

#### WP12 — Example Dockerfiles (S) · needs WP8

Under `examples/docker/`, none of them the published image:

- `cli-minimal/Dockerfile`: `node:26-bookworm-slim`, `npm install -g
  @sparql-query-lib/cli`, entrypoint `sqlib`. Glibc, because DuckDB
  community extensions are published for `linux_amd64` and not for musl at the
  pinned DuckDB version (see [etl.md](../guides/etl.md)).
- `cli-duckdb-azure/Dockerfile`: the above plus `INSTALL httpfs; INSTALL
  azure;` at build time into the image's extension directory, so a run loads
  them under the default profile without `--allow-extension-install`. A build
  step asserts `pragma_platform()` is not musl, as the server image does.
- `cli-azcopy/`: the minimal image plus `azcopy`, with a `run.sh` that copies
  in, runs `sqlib etl run`, and copies out. The simplest shape when DuckDB
  does not need to see the blob store at all.

A CI job builds `cli-minimal` and runs `sqlib etl run` on the fixture bundle
and CSV inside it. The other two are built but not run; they need credentials.

#### WP13 — Documentation (S) · needs WP8

- `docs/guides/cli.md`: install, the commands, composition with pipes, the
  profile flags, the report, the example images.
- `docs/guides/static-export.md`: the two new bundle members; "what the
  runtime cannot do" loses "runs a rule set or an ETL job".
- `docs/explanation/architecture.md`: the package table gains five rows and
  the "why the split is where it is" section names the CLI as the second host.
- `docs/reference/scripts.md`: the relocated smoke scripts.
- `docs/guides/etl.md`: a section on the CLI's defaults and why they differ.

#### WP14 — Build and release plumbing (S) · alongside every new package

- Dockerfile builder and production stages: `COPY` lines for each new
  package. `api` fails to start in the image otherwise.
- `tsconfig.json` references, `pnpm-workspace.yaml` needs nothing.
- `scripts/check-publishable.mjs`, `check-installable.mjs`,
  `check-public-api.mjs`: add the packages that are not private.
- release-please: the new packages are released with the workspace.

### Phase 5 — Groups (optional, L) · needs D2 revisited

Not planned. See the next section for what would change the decision.

## Dependencies between packages

```
WP1 compiler ──────────┬──► WP3 runtime-etl ──► WP6 etlJobs ──┐
WP2 runtime-duckdb ────┘                                       ├──► WP8 cli ──► WP9, WP10, WP11, WP12, WP13
WP4 executor ──────────┬──► WP5 runtime-srl ──► WP7 ruleSets ──┘
                       └──► WP3
WP14 runs with each new package.
```

WP1, WP2 and WP4 touch different files and can run in parallel. WP3 and WP5
can run in parallel once their dependencies land. WP6 and WP7 can run in
parallel.

## Groups: why not

The question is whether `sqlib run --group <slug>` belongs in the CLI, so that
an ETL job feeding a rule set feeding a patch runs as one stored, versioned
definition.

For it:

- The group is authored and versioned in sqlib. A shell pipe is versioned
  somewhere else.
- Edge semantics come with it: variable mappings, `whenEmpty`, RDF format
  conversion between nodes, the patch node's delta store.
- One invocation, one report.

Against it:

- The engine is the most store-coupled code in `api`: cache coordinator,
  auth enforcement per node, the executor factory, delta store and patch
  targets, callable invocation. Extracting it is the largest package in this
  plan, and it is the one that would change `api` the most.
- A batch pipeline already has a DAG runner: the scheduler that started the
  container. A second DAG inside the container is the same information twice.
- Files between commands are a better debugging surface than an in-memory
  handoff. The intermediate N-Triples can be kept, diffed and replayed.
- The one group type the runtime already runs, SELECT-chained queries, comes
  free through `GroupHandle`. Nothing in this plan loses it.

What would change the decision: a real pipeline that needs a patch node
(deltas against a target store) or `whenEmpty` semantics in the container.
Neither has a batch use yet. Until one does, the CLI composes by files:

```sh
sqlib etl run   … --out - | sqlib rules run … --data - --out inferred.nt
```

and the report of each command names its input hash, so the chain is
reconstructible from the reports.

## The parser in the CLI: pros and cons, recorded

Recorded here because D1 reverses an earlier assumption that the run side
should stay parser-free.

Pros:

- Ad-hoc queries with parameters from a file, with `detectInputs`, like `arq`.
- SRL from a file in a repository, so rules can be run and checked in CI
  without a sqlib server or an export step.
- `sqlib check` as a lint step for queries and rules.
- The compile step is the server's own code, so what the CLI compiles is what
  the server would have exported.

Cons:

- Two template sources (bundle, text) to test. One run path, so the test is
  "same template from both sources".
- Chevrotain grammar construction at startup, in the order of a hundred
  milliseconds. Irrelevant for batch; noticeable for a shell loop of many
  tiny invocations. `--bundle` avoids it.
- The browser runtime must stay parser-free, which is why the parser is its
  own package and `runtime` does not depend on it.

## Risks

- **The Dockerfile lists packages by hand.** Every new package needs lines in
  both stages, or the server image breaks while local builds pass. WP14 makes
  this part of each package's PR.
- **`ColumnDefinition` is a persistence type today.** Moving it changes imports
  across `api` and `web`. Keep the name and re-export from the schema.
- **`RuleStratifier` and `srl`'s `stratify` may overlap.** Resolve in WP5 with
  one implementation.
- **Parity.** The parity tests in WP3, WP5 and WP8 are the acceptance
  criterion for the whole plan. If the CLI and the API disagree on one job,
  the plan has failed at its one promise.
- **DuckDB defaults.** A CLI that reads the filesystem by default is correct
  for an operator's container and wrong for a server. D4 keeps the two
  resolvers separate so neither default leaks into the other.
