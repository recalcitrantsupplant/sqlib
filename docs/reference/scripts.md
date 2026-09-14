# Scripts reference

The commands a maintainer runs: the `Justfile` recipes, the workspace and
per-package `pnpm` scripts, and the checks under `scripts/`.

`Taskfile.yml` no longer exists. The `Justfile` is the only task runner in the
repository.

Contributor setup and the commit conventions are in
[CONTRIBUTING.md](../../CONTRIBUTING.md). What each environment variable a
recipe sets does is in [configuration](configuration.md).

## Justfile recipes

`just <recipe>`. Recipes taking a parameter show its default.

| Recipe | What it does |
| --- | --- |
| `run-local-memory` | API and MCP on `http://localhost:3005` (`/mcp` for MCP), library in a local Oxigraph store under `packages/api/tmp/library-store`, checkpointing every 60s, assistant on, telemetry off. Runs under `tsx watch` |
| `clean-local-memory` | Deletes `packages/api/tmp/library-store` |
| `setup-local-https` | One-time: installs the mkcert root and writes `certs/localhost.pem` and `certs/localhost-key.pem`. Fails if mkcert is not installed |
| `run-local-https` | The same dual API+MCP process on port 3300, plus a Traefik container terminating TLS on `https://localhost:3443`. Requires the certificates |
| `run-docker-https` | The built image plus Fuseki behind Traefik on `https://localhost:3443`, with no host pnpm process. Needs an image tagged `sparql-query-lib:aca-local` and the certificates |
| `run-local-rules-tests` | API on `http://localhost:3005` in its own store, seeded with the W3C SHACL 1.2 Rules suite as runnable tests. Queries, groups, rules, data graphs and tests on; benchmarks and ETL off; invalid save on, because a third of the suite's documents are meant not to parse. Seeding is idempotent |
| `run-frontend-rules API_URL=http://localhost:3005` | The web UI with the `NUXT_PUBLIC_FEATURE_*` flags matching that API |
| `clean-local-rules-tests` | Deletes `packages/api/tmp/rules-tests-store` |
| `run-local-patch-demo` | API on `http://localhost:3005` in its own store, seeded with a demo library of update queries for reading RDF patch previews. Queries, backends and data graphs on; everything else off |
| `run-frontend-patch-demo API_URL=http://localhost:3005` | The web UI with the matching flags |
| `uat-patch-demo API_URL=http://localhost:3005 WEB_URL=http://localhost:3001` | Drives that demo end to end in a real browser against a real API. Starts neither: run the two recipes above first |
| `clean-local-patch-demo` | Deletes `packages/api/tmp/patch-demo-store` |
| `run-local-like-docker` | The API alone, no MCP, with the persistence settings `run-docker-local` uses |
| `build-docker TAG=latest` | `docker build --network=host -t sparql-query-lib:<TAG> .` |
| `run-docker-local TAG=latest` | Runs that image with the persistent store on a host bind mount, API on `http://localhost:3005` |
| `run-docker-persistent TAG=latest` | The same image in `APP_MODE=api` on port 3000 |
| `run-frontend API_URL=http://localhost:3005` | The web UI against any API URL |

The frontend recipes exist as separate commands because the API and the SPA are
separate processes reading separate environments. Setting feature flags only on
the API leaves the rail showing sections the API no longer serves; see
[feature flags](feature-flags.md).

Three recipes export `FEATURE_QUERIES_ENABLED`, `FEATURE_RULES_ENABLED` and
`FEATURE_ETL_ENABLED`. Nothing reads those names — the real ones have no
`_ENABLED` suffix — so those recipes run with the default flags.

## Workspace scripts

Run from the repository root.

| Script | What it runs |
| --- | --- |
| `pnpm build` | Builds `types`, `contracts`, `runtime`, `tools`, `srl`, `rdf-delta` and `api`, in that order |
| `pnpm test` | The API package's vitest suite |
| `pnpm dev` | The API package's dev server |
| `pnpm dev:observability` | Brings up `docker-compose.dev.yml` (the local collector) |
| `pnpm dev:full` | `dev:observability` then `dev` |
| `pnpm dev:stop` | Takes `docker-compose.dev.yml` down |
| `pnpm generate-schemas` | Regenerates the API's JSON schemas |
| `pnpm any:count` / `pnpm any:update` | The `any` ratchet, and re-recording its baseline |
| `pnpm ci` | `bash scripts/ci/all.sh` — the whole required pipeline |

## Package scripts

Run one with `pnpm --filter @sparql-query-lib/<pkg> <script>`.

### `api`

| Script | What it runs |
| --- | --- |
| `build` | Generates schemas, then `tsc` against `tsconfig.build.json` |
| `dev` | `tsx watch src/index.ts` in development, telemetry off |
| `test`, `test:watch` | vitest |
| `test:clean` | Clears the vite cache first — for when a stale transform is suspected |
| `generate-schemas` | `tsx scripts/generate-schemas.ts`, the JSON Schema and contract generator |
| `seed:system-library` | `tsx scripts/seed-system-library.ts` |
| `export:bundle` | Compiles a library to a static export bundle |
| `export:library-store` / `import:library-store` | Moves a whole library store in and out as RDF |
| `migrate:grammar-type` | Rewrites stored grammar-type values to SRL |
| `backfill:srl-importable` | Recomputes the `srlImportable` hint on stored query versions whose `srlImportRevision` is behind |
| `smoke:provider` | Checks the assistant's model provider is reachable |
| `smoke:etl-extensions` | Checks DuckDB community extensions install on this platform |
| `smoke:storage` | Checks the storage directory is writable by this process |
| `clean`, `clean:test`, `clean:scripts` | Remove `dist` and any stray compiled `.js` beside the TypeScript sources |

The smoke scripts need a running service or network and are not part of the CI
pipeline.

### `web`

| Script | What it runs |
| --- | --- |
| `dev` | `nuxt dev` |
| `build` / `generate` | The Nuxt build; `generate` produces the static site |
| `preview` | Serves the built output on `WEB_PORT`, default 3001 |
| `lint`, `lint:css`, `lint:css:fix` | stylelint over `src/**/*.{vue,css}` |
| `typecheck` | `nuxi typecheck` |
| `test`, `test:watch` | vitest — unit tests only |
| `test:e2e` | Playwright, excluding `@perf` |
| `test:e2e:ci` | Playwright, excluding `@visual` and `@perf` — what CI runs |
| `test:e2e:visual` | The visual regression specs. A local gate: their baselines are rasterised with the authoring machine's fonts, and a CI runner renders text differently |
| `test:e2e:uat` | The patch-demo UAT run against a live API and UI |
| `test:perf`, `test:perf:report` | The performance budget and layout-shift specs, and the diagnostic pair |
| `build:srl-parser` | Rebuilds the browser-side SRL parser bundle |

### Other packages

`contracts`, `types`, `runtime` and `runtime-oxigraph` build with tsup plus a
declaration-only `tsc`; the two runtime packages then run
`scripts/emit-cjs-declarations.mjs` over `dist`. `mcp-server`, `srl`, `tools`
and `rdf-delta` build with `tsc`. All of them except `contracts` and `types`
have a vitest `test`.

`mcp-server` also has `dev` (stdio), `dev:http`, `dev:dual-http`,
`dev:debug-http` and the matching `start*` scripts, which set `MCP_TRANSPORT`
and run the built output.

`rdf-delta` has `poc:blob-snapshot` and `poc:patch-log`, two proof-of-concept
runners kept beside the package.

Nine of the ten packages define `lint` as `echo "TODO: add lint"`. The only
real linting in the repository is stylelint over `packages/web`. `pnpm -r
--if-present lint` therefore passes without reading a line of TypeScript, and
`scripts/ci/lint.sh` prints a warning naming the packages whose green tick means
an echo succeeded.

## The CI pipeline

All CI logic is in `scripts/ci/`, so every step runs locally with plain `bash
scripts/ci/<step>.sh`. The GitHub Actions workflow is a dispatcher. `bash
scripts/ci/all.sh` runs the required sequence:

1. `install.sh` — `pnpm install --frozen-lockfile`
2. `lint.sh` — `pnpm -r --if-present lint`, then `check-doc-links.mjs`
3. `ratchet-selftest.sh` — proves the ratchets still fail when they should
4. `any-ratchet.sh` — `count-any.mjs`
5. `orphan-ratchet.sh` — `check-orphans.mjs`
6. `typecheck.sh` — `nuxi typecheck` over `packages/web`, against a baseline
7. `build.sh` — `pnpm -r build` in topological order, which also typechecks every other package
8. `publish-check.sh` — four checks on the publishable packages
9. `test.sh` — vitest across the affected packages

Steps outside that sequence:

- `e2e.sh` — Playwright against the production preview build, with the API
  mocked at the network layer. No API server is started. It runs on
  `workflow_dispatch`, not as a required gate. `WEB_PORT` defaults to 3701 in CI
  so a locally running preview on 3001 cannot red out a job.
- `commitlint.sh` — conventional commits, **warn only**. It never fails a build;
  making it blocking means changing its final `exit 0` to `exit "$status"`.
- `fuzz-nightly.sh` — the query group property harness at `PHASE2_FUZZ_RUNS`
  (default 1000) and a clock-derived seed, over `test/phase2/` and `test/web/`.
  The PR suite runs the same files at a fixed seed and about 50 cases. The seed
  is printed before the run, so a red nightly reproduces with
  `PHASE2_FUZZ_SEED=<seed> PHASE2_FUZZ_RUNS=<n> bash scripts/ci/fuzz-nightly.sh`.
- `docker-build-push.sh` — builds the server image from the root `Dockerfile`
  and tags it `sha-<short>`, plus `latest` on trunk and `X.Y.Z` when building a
  `vX.Y.Z` tag or when `RELEASE_VERSION` is set. It only pushes when
  `PUSH=true`, so running it locally builds and stops. Login is the caller's
  job.
- `dependabot-automerge.sh` — merges Dependabot bumps whose CI is green. The
  calling job's `needs` list is the only gate, `image` included, because a base
  image bump once merged itself green and broke every publish afterwards.

`lib.sh` is sourced by each script. It sets `set -euo pipefail`, changes to the
repository root, and times the step. `scripts/ci/budgets.txt` gives per-step
budgets in seconds; exceeding one raises a warning annotation and never fails
the step, because wall-clock time is too variable to gate on.

## The ratchets

Three checks compare the tree against a recorded baseline rather than against
zero, so a cleanup can land incrementally while the number cannot regress.

### `any` — `scripts/count-any.mjs`

Counts `as any`, `: any` and `catch (x: any)` in TypeScript under `packages/`,
excluding `node_modules`, `dist`, `*.d.ts` and `*.generated.ts`, split into
source and test totals. The baseline is `scripts/any-baseline.json`.

Two different promises:

- **Whole repo**: only an *increase* over `srcTotal` or `testTotal` fails.
- **Strict zone** (`packages/api/src/`): any `as any` or `catch (x: any)` is an
  outright failure, not merely an increase. `: any` is not in the strict zone.

| Command | Effect |
| --- | --- |
| `node scripts/count-any.mjs` | Report, and fail on a rise or a strict-zone violation |
| `node scripts/count-any.mjs --update` | Rewrite the baseline to the current counts |
| `node scripts/count-any.mjs --json` | Machine-readable output |

**When it trips:** a strict-zone violation names the file; remove the `as any`.
A rise names the amount; remove the new occurrences, or if they are justified,
run `--update` in the same change so the new number is reviewable in the diff.
When counts *drop*, the script says so and asks you to run `--update` — an
unlowered baseline is slack that absorbs the next regression silently.

### Orphan modules — `scripts/check-orphans.mjs`

Reports source files nothing can reach. Roots are package entry points (`main`,
`module`, `exports`, `bin`), files named in package scripts, tests, tool
configs, and Nuxt's convention directories, since a page or component is reached
by the router rather than by an import. The baseline is
`scripts/orphan-baseline.json`, and it lists **paths**, not a count: an entry is
a claim that a human looked at that specific file and decided it stays.

| Command | Effect |
| --- | --- |
| `node scripts/check-orphans.mjs` | Report, and fail on an orphan not in the baseline |
| `node scripts/check-orphans.mjs --update` | Rewrite the baseline |
| `node scripts/check-orphans.mjs --json` | Machine-readable output |

**When it trips:** it names the unreachable files. Either delete the file, wire
it up, or — if it is deliberately kept, as the benchmark and debug scripts under
`packages/api/scripts/` are — accept it with `--update` so the addition appears
in review. When a baseline entry is no longer an orphan the script says so and
asks you to run `--update` to lower it.

### Web type errors — `scripts/ci/typecheck.sh`

Counts `error TS` lines from `nuxi typecheck` in `packages/web` and compares
against `packages/web/.typecheck-baseline`, a file holding a plain integer. It
is currently `0`.

**When it trips:** it prints the errors. Fix them, or — if the count went down —
lower the baseline with `echo <count> > packages/web/.typecheck-baseline`.

The script also fails when it cannot measure. A missing baseline file, a
baseline that is not a plain integer, and a checker that exits non-zero while
printing nothing countable are each a hard failure rather than a zero, because a
crashed checker and a clean run both produce no `error TS` lines. `TYPECHECK_CMD`
and `TYPECHECK_BASELINE_FILE` exist so the self-test can exercise those guards
against a stub.

### `scripts/ci/ratchet-selftest.sh`

Every gate that counts something reports the same number when it measured
nothing as when everything is fine. The guards that close that gap only fire in
situations a healthy CI run never reaches, so nothing would notice them rotting.
This script gives each guard a sandbox reproducing its failure, asserts the
script exits non-zero, and asserts a matching healthy case still passes. It runs
in about a second and needs no install.

## The publish lane

`scripts/ci/publish-check.sh` runs four checks over the packages that are not
`private: true` — `runtime` and `runtime-oxigraph`. It publishes nothing and
needs no token. It runs after `build.sh`, because what it checks is built
output. Each asks a different question:

| Script | Question |
| --- | --- |
| `check-publishable.mjs` | Is the manifest right? Required metadata and `publishConfig.access`; every `exports` target exists and is covered by `files`; a `types` condition beside every JS condition, `.d.cts` for `require` and `.d.ts` for `import`; no dependency on a package that stays private; `workspace:^` rather than `workspace:*` for peer ranges |
| `check-public-api.mjs` | What is in it? Derives the surface from the built declarations and compares it against `packages/<pkg>/public-api.md`, so every addition, removal, rename or signature change arrives as a readable diff in the same change. It also reports unnameable types: a public signature whose parameter or return type is exported by no entry point |
| `check-installable.mjs` | Does the tarball install? Packs each package, unpacks it into a sandbox `node_modules`, writes a consumer project against it, and compiles under nodenext-ESM, nodenext-CJS and bundler resolution, then loads every entry point in plain Node |
| `check-generated-typings.mjs` | Does the declaration `sqlib export --typings` writes compile? Builds a consumer-shaped project around the frozen bundle and the generated declaration and runs `tsc` over it, in both directions: the usage files must compile clean with every `@ts-expect-error` line actually erroring, and a canary run over a deliberately mutated declaration must fail |

The first three read the working tree or the tarball; the fourth reads an
artefact that exists only in someone else's project. All four are invisible from
inside the workspace, where every import resolves through pnpm's symlinks.

**When one trips:** each names the package and the specific expectation. For
`check-public-api.mjs` the fix is usually to regenerate or edit
`packages/<pkg>/public-api.md` in the same change as the surface change, which
is the point of the file.

## Other scripts

| Script | What it does |
| --- | --- |
| `scripts/check-doc-links.mjs` | Every relative markdown link in a tracked `.md` file resolves to a file that exists. A link with an anchor is checked as far as the file. Absolute URLs, `mailto:` and in-page anchors are out of scope. Runs in the lint step |
| `scripts/emit-cjs-declarations.mjs` | Copies each `.d.ts` in a `dist` directory to `.d.cts`, rewriting relative `.js` specifiers to `.cjs` so a `.d.cts` only ever reaches other `.d.cts` files. Without it a CommonJS consumer gets `TS7016` from a package that ships declarations. Usage: `node scripts/emit-cjs-declarations.mjs <dist-dir>` |
| `scripts/codemod-*.mjs` | One-off codemods kept for reference. Not part of any pipeline |
| `scripts/release/export-orphan.sh` | Exports the current tree as a fresh single-commit repository at a destination directory, optionally adding a remote. It never pushes, and refuses to run on a dirty tree or when the tree still matches its sweep list |
