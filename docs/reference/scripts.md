# Scripts reference

This page lists the commands that a maintainer runs: the `Justfile` recipes, the
`pnpm` scripts of the workspace and of each package, and the checks under
`scripts/`.

`Taskfile.yml` no longer exists. The `Justfile` is the only task runner in the
repository.

[CONTRIBUTING.md](../../CONTRIBUTING.md) gives the contributor setup and the
commit conventions. [Configuration](configuration.md) gives the effect of each
environment variable that a recipe sets.

## Justfile recipes

Run `just <recipe>`. A recipe that takes a parameter shows its default.

| Recipe | What it does |
| --- | --- |
| `run-local-memory` | API and MCP on `http://localhost:3005` (`/mcp` for MCP), library in a local Oxigraph store under `packages/api/tmp/library-store`, checkpointing every 60s, assistant on, telemetry off. Runs under `tsx watch` |
| `clean-local-memory` | Deletes `packages/api/tmp/library-store` |
| `setup-local-https` | One-time: installs the mkcert root and writes `certs/localhost.pem` and `certs/localhost-key.pem`. Fails if mkcert is not installed |
| `run-local-https` | The same dual API+MCP process on port 3300, plus a Traefik container terminating TLS on `https://localhost:3443`. Requires the certificates |
| `run-docker-https` | The built image plus Fuseki behind Traefik on `https://localhost:3443`, with no host pnpm process. Needs an image tagged `sparql-query-lib:aca-local` and the certificates |
| `run-local-rules-tests` | API on `http://localhost:3005` in its own store, seeded with the W3C SHACL 1.2 Rules suite as runnable tests. Queries, groups, rules, data graphs and tests on. Benchmarks and ETL off. Invalid save on, because a third of the documents in the suite must not parse. Seeding is idempotent |
| `run-frontend-rules API_URL=http://localhost:3005` | The web UI with the `NUXT_PUBLIC_FEATURE_*` flags matching that API |
| `clean-local-rules-tests` | Deletes `packages/api/tmp/rules-tests-store` |
| `run-local-patch-demo` | API on `http://localhost:3005` in its own store, seeded with a demo library of update queries for reading RDF patch previews. Queries, backends and data graphs on. All other features off |
| `run-frontend-patch-demo API_URL=http://localhost:3005` | The web UI with the matching flags |
| `uat-patch-demo API_URL=http://localhost:3005 WEB_URL=http://localhost:3001` | Runs that demo from start to end in a real browser, against a real API. It starts neither. Run the two recipes above first |
| `clean-local-patch-demo` | Deletes `packages/api/tmp/patch-demo-store` |
| `run-local-like-docker` | The API alone, no MCP, with the persistence settings `run-docker-local` uses |
| `build-docker TAG=latest` | `docker build --network=host -t sparql-query-lib:<TAG> .` |
| `run-docker-local TAG=latest` | Runs that image with the persistent store on a host bind mount, API on `http://localhost:3005` |
| `run-docker-persistent TAG=latest` | The same image in `APP_MODE=api` on port 3000 |
| `run-frontend API_URL=http://localhost:3005` | The web UI against any API URL |

The frontend recipes are separate commands, because the API and the SPA are
separate processes that read separate environments. If you set feature flags on
the API only, the rail shows sections that the API does not serve. See
[feature flags](feature-flags.md).

Three recipes export `FEATURE_QUERIES_ENABLED`, `FEATURE_RULES_ENABLED` and
`FEATURE_ETL_ENABLED`. No code reads those names, because the real names have no
`_ENABLED` suffix. Those recipes therefore run with the default flags.

## Workspace scripts

Run from the repository root.

| Script | What it runs |
| --- | --- |
| `pnpm build` | Builds `types`, `contracts`, `runtime`, `compiler`, `runtime-duckdb`, `runtime-etl`, `tools`, `srl`, `runtime-srl`, `rdf-delta` and `api`, in that order |
| `pnpm test` | The vitest suite of the API package |
| `pnpm dev` | The dev server of the API package |
| `pnpm dev:observability` | Brings up `docker-compose.dev.yml` (`grafana/otel-lgtm`: collector, Tempo, Loki, Prometheus, Grafana) |
| `pnpm dev:full` | `dev:observability`, then `dev` sending telemetry to it |
| `pnpm dev:stop` | Takes `docker-compose.dev.yml` down |
| `pnpm generate-schemas` | Generates the JSON schemas of the API again |
| `pnpm any:count` / `pnpm any:update` | The `any` ratchet, and a new record of its baseline |
| `pnpm ci` | `bash scripts/ci/all.sh`: the whole required pipeline |

## Package scripts

Run one with `pnpm --filter @sparql-query-lib/<pkg> <script>`.

### `api`

| Script | What it runs |
| --- | --- |
| `build` | Generates schemas, then `tsc` against `tsconfig.build.json` |
| `dev` | `tsx watch src/index.ts` in development, telemetry off |
| `test`, `test:watch` | vitest |
| `test:clean` | Clears the vite cache first. Use it when you suspect an old transform |
| `generate-schemas` | `tsx scripts/generate-schemas.ts`, the JSON Schema and contract generator |
| `seed:system-library` | `tsx scripts/seed-system-library.ts` |
| `export:bundle` | Compiles a library to a static export bundle |
| `export:library-store` / `import:library-store` | Moves a whole library store out or in as RDF |
| `migrate:grammar-type` | Rewrites stored grammar-type values to SRL |
| `backfill:srl-importable` | Calculates the `srlImportable` hint again on stored query versions whose `srlImportRevision` is old |
| `smoke:provider` | Checks that the model provider of the assistant is reachable |
| `smoke:etl-extensions` | Checks that DuckDB community extensions install on this platform |
| `smoke:storage` | Checks that this process can write to the storage directory |
| `clean`, `clean:test`, `clean:scripts` | Remove `dist`, and any compiled `.js` file next to the TypeScript sources |

The smoke scripts need a running service or a network, and are not part of the CI
pipeline.

### `web`

| Script | What it runs |
| --- | --- |
| `dev` | `nuxt dev` |
| `build` / `generate` | The Nuxt build; `generate` produces the static site |
| `preview` | Serves the built output on `WEB_PORT`, default 3001 |
| `lint`, `lint:css`, `lint:css:fix` | stylelint over `src/**/*.{vue,css}` |
| `typecheck` | `nuxi typecheck` |
| `test`, `test:watch` | vitest, unit tests only |
| `test:e2e` | Playwright, excluding `@perf` |
| `test:e2e:ci` | Playwright, excluding `@visual` and `@perf`. CI runs this |
| `test:e2e:visual` | The visual regression specs. Run them locally only: their baselines are rendered with the fonts of the author's computer, and a CI runner renders text differently |
| `test:e2e:uat` | The patch-demo UAT run against a live API and UI |
| `test:perf`, `test:perf:report` | The performance budget and layout-shift specs, and the diagnostic pair |
| `build:srl-parser` | Rebuilds the browser-side SRL parser bundle |

### Other packages

`contracts`, `types`, `runtime` and `runtime-oxigraph` build with tsup, and a
`tsc` run for declarations only. The two runtime packages then run
`scripts/emit-cjs-declarations.mjs` over `dist`. `mcp-server`, `srl`, `tools`,
`compiler`, `runtime-duckdb`, `runtime-etl`, `runtime-srl` and `rdf-delta` build
with `tsc`. All of them, except `contracts` and `types`, have a vitest `test`.

`mcp-server` also has `dev` (stdio), `dev:http`, `dev:dual-http`,
`dev:debug-http` and the matching `start*` scripts, which set `MCP_TRANSPORT`
and run the built output.

`rdf-delta` has `poc:blob-snapshot` and `poc:patch-log`, two proof-of-concept
runners in the package.

Only `packages/web` defines a `lint` script: stylelint over
`src/**/*.{vue,css}`. ESLint covers the TypeScript of each package through the
ratchet in `scripts/lint-ratchet.mjs`. See
[CONTRIBUTING.md](../../CONTRIBUTING.md#the-ratchets).

## The CI pipeline

All CI logic is in `scripts/ci/`, so you can run each step locally with
`bash scripts/ci/<step>.sh`. The GitHub Actions workflow only calls these
scripts. `bash scripts/ci/all.sh` runs the required sequence:

1. `install.sh`: `pnpm install --frozen-lockfile`.
2. `lint.sh`: `pnpm -r --if-present lint`, the ESLint ratchet
   (`lint-ratchet.mjs`), then `check-doc-links.mjs`.
3. `ratchet-selftest.sh`: checks that the ratchets still fail when they must.
4. `any-ratchet.sh`: `count-any.mjs`.
5. `orphan-ratchet.sh`: `check-orphans.mjs`.
6. `typecheck.sh`: `nuxi typecheck` over `packages/web`, against a baseline.
7. `build.sh`: `pnpm -r build` in topological order. This also typechecks each
   other package.
8. `publish-check.sh`: four checks on the publishable packages.
9. `test.sh`: vitest across the affected packages.

Steps outside that sequence:

- `e2e.sh`: Playwright against the production preview build, with the API
  mocked at the network layer. No API server starts. The `e2e` job runs on each
  pull request and push, and `dependabot-automerge.sh` waits for it. In CI,
  `WEB_PORT` defaults to 3701, so a local preview on 3001 cannot fail a job.
- `commitlint.sh`: conventional commits, **blocking**, on pull requests only. A
  commit that release-please cannot parse gets no version bump and no changelog
  entry, so the check fails the job.
- `fuzz-nightly.sh`: the query group property harness, at `PHASE2_FUZZ_RUNS`
  (default 1000) and a seed from the clock, over `test/phase2/` and
  `test/web/`. The PR suite runs the same files with a fixed seed and about 50
  cases. The script prints the seed before the run. To reproduce a failed
  nightly run, use
  `PHASE2_FUZZ_SEED=<seed> PHASE2_FUZZ_RUNS=<n> bash scripts/ci/fuzz-nightly.sh`.
- `docker-build-push.sh`: builds the server image from the root `Dockerfile`,
  and tags it `sha-<short>`. It also adds `latest` on trunk, and `X.Y.Z` for a
  `vX.Y.Z` tag or when `RELEASE_VERSION` is set. It pushes only when
  `PUSH=true`, so a local run builds and stops. The caller must log in.
- `docker-build-push-web.sh`: the same, for the web UI bundle image, built from
  `Dockerfile.web` and tagged under `ghcr.io/<owner>/sqlib-web`. That image holds
  the static site at `/site`, and runs nothing. See
  [deploying](../guides/deploying.md#the-bundle-image). The script passes the
  commit, version and build time as build arguments. They become the OCI labels
  of the image, and its `/bundle-info.json`.
- `dependabot-automerge.sh`: merges Dependabot updates whose CI passes. The only
  gate is the `needs` list of the calling job, with `image` and `web-image`. A
  base image update once merged itself after CI passed, and broke each later
  publish.

Each script sources `lib.sh`. It sets `set -euo pipefail`, changes to the
repository root, and times the step. `scripts/ci/budgets.txt` gives a time
budget in seconds for each step. A step over its budget gets a warning
annotation, and never fails, because wall-clock time varies too much for a
gate.

## The ratchets

Four checks compare the tree with a recorded baseline: the ESLint ratchet (see
[CONTRIBUTING.md](../../CONTRIBUTING.md#the-ratchets)) and the three below. A cleanup can therefore
merge in steps, and the number cannot increase.

### `any`: `scripts/count-any.mjs`

Counts `as any`, `: any` and `catch (x: any)` in TypeScript under `packages/`,
excluding `node_modules`, `dist`, `*.d.ts` and `*.generated.ts`, split into
source and test totals. The baseline is `scripts/any-baseline.json`.

The check has two rules:

- **Whole repo**: only an *increase* over `srcTotal` or `testTotal` fails.
- **Strict zone** (`packages/api/src/`): each `as any` or `catch (x: any)` is a
  failure, also with no increase. `: any` is not in the strict zone.

| Command | Effect |
| --- | --- |
| `node scripts/count-any.mjs` | Report, and fail on a rise or a strict-zone violation |
| `node scripts/count-any.mjs --update` | Rewrite the baseline to the current counts |
| `node scripts/count-any.mjs --json` | Machine-readable output |

**When it fails:** a strict-zone violation names the file. Remove the `as any`.
An increase names the amount. Remove the new occurrences. If they are necessary,
run `--update` in the same change, so that a reviewer sees the new number in the
diff. When the counts *decrease*, the script says so, and asks you to run
`--update`. A baseline that stays high would hide the next increase.

### Orphan modules: `scripts/check-orphans.mjs`

Reports source files that nothing can reach. The roots are:

- package entry points (`main`, `module`, `exports`, `bin`);
- files named in package scripts;
- tests and tool configs;
- the convention directories of Nuxt, because the router reaches a page or
  component with no import.

The baseline is `scripts/orphan-baseline.json`. It lists **paths**, and no count.
Each entry states that a person read that file and decided to keep it.

| Command | Effect |
| --- | --- |
| `node scripts/check-orphans.mjs` | Report, and fail on an orphan not in the baseline |
| `node scripts/check-orphans.mjs --update` | Rewrite the baseline |
| `node scripts/check-orphans.mjs --json` | Machine-readable output |

**When it fails:** it names the unreachable files. Delete the file, or import it.
If you must keep it, as for the benchmark and debug scripts under
`packages/api/scripts/`, accept it with `--update`. The addition then shows in
review. When a baseline entry is no longer an orphan, the script says so, and
asks you to run `--update` to remove it.

### Web type errors: `scripts/ci/typecheck.sh`

Counts the `error TS` lines from `nuxi typecheck` in `packages/web`, and
compares the count with `packages/web/.typecheck-baseline`, a file that holds a
plain integer. The value is now `0`.

**When it fails:** it prints the errors. Fix them. If the count decreased, lower
the baseline with `echo <count> > packages/web/.typecheck-baseline`.

The script also fails when it cannot measure. Each of these is a failure, and
not a zero:

- a missing baseline file;
- a baseline that is not a plain integer;
- a checker that exits non-zero and prints nothing to count.

A crashed checker and a clean run both give no `error TS` lines, so a zero
would hide a crash. `TYPECHECK_CMD` and `TYPECHECK_BASELINE_FILE` let the
self-test run those guards against a stub.

### `scripts/ci/ratchet-selftest.sh`

A gate that counts reports the same number when it measured nothing as when all
is correct. The guards for this case fire only in situations that a healthy CI
run never reaches. Without a test, nobody would see a guard that stopped
working. This script gives each guard a sandbox that reproduces its failure. It
checks that the script exits non-zero, and that a matching healthy case still
passes. It runs in about one second, and needs no install.

## The publish lane

`scripts/ci/publish-check.sh` runs four checks over the packages that are not
`private: true`: `runtime`, `runtime-oxigraph`, and the six packages of the CLI
(`compiler`, `srl`, `runtime-duckdb`, `runtime-etl`, `runtime-srl`, `cli`). It
publishes nothing, and needs no token. It runs after `build.sh`, because it
checks built output. Each check asks a different question:

| Script | Question |
| --- | --- |
| `check-publishable.mjs` | Is the manifest correct? Required metadata and `publishConfig.access`. Each `exports` target exists, and `files` covers it. A `types` condition next to each JS condition: `.d.cts` for `require` and `.d.ts` for `import`. No dependency on a package that stays private. `workspace:^`, and not `workspace:*`, for peer ranges |
| `check-public-api.mjs` | What does it contain? Derives the surface from the built declarations, and compares it with `packages/<pkg>/public-api.md`. Each addition, removal, rename or signature change therefore shows as a readable diff in the same change. It also reports types that cannot be named: a public signature whose parameter or return type no entry point exports |
| `check-installable.mjs` | Does the tarball install? Packs each package, unpacks it into a sandbox `node_modules`, writes a consumer project for it, and compiles under nodenext-ESM, nodenext-CJS and bundler resolution. Then loads each entry point in plain Node. A package that its consumer entry marks `esmOnly` skips the CommonJS consumer and `require()`, and must have no `require` condition |
| `check-generated-typings.mjs` | Does the declaration from `sqlib export --typings` compile? Builds a project like a consumer's, around the frozen bundle and the generated declaration, and runs `tsc` over it in two directions. The usage files must compile with no errors, and each `@ts-expect-error` line must give an error. A canary run over an intentionally changed declaration must fail |

The first three read the working tree or the tarball. The fourth reads an
artefact that exists only in a consumer project. Inside the workspace, each
import resolves through the pnpm symlinks, so none of these problems shows
there.

**When one fails:** each check names the package and the expectation. For
`check-public-api.mjs`, the usual fix is to generate or edit
`packages/<pkg>/public-api.md` in the same change as the surface change. That is
the purpose of the file.

## Other scripts

| Script | What it does |
| --- | --- |
| `scripts/check-doc-links.mjs` | Checks that each relative Markdown link in a tracked `.md` file resolves to a file that exists. For a link with an anchor, it checks the file only. It does not check absolute URLs, `mailto:` or in-page anchors. Runs in the lint step |
| `scripts/emit-cjs-declarations.mjs` | Copies each `.d.ts` in a `dist` directory to `.d.cts`, and changes relative `.js` specifiers to `.cjs`, so a `.d.cts` only reaches other `.d.cts` files. Without it, a CommonJS consumer gets `TS7016` from a package that ships declarations. Usage: `node scripts/emit-cjs-declarations.mjs <dist-dir>` |
| `scripts/codemod-*.mjs` | One-off codemods, kept for reference. Not part of a pipeline |
| `scripts/release/export-orphan.sh` | Exports the current tree as a new repository with one commit, in a destination directory, and can add a remote. It never pushes. It refuses to run on a dirty tree, or when the tree still matches its sweep list |
