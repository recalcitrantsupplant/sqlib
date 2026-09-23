# Contributing

## External pull requests are not being accepted before 1.0

sqlib is published under a review-only licence (see [LICENSE](LICENSE)) while it
is pre-1.0, and that licence does not let us take contributed code. Pull
requests from outside the project will be closed unmerged, whatever their
quality. Issues, bug reports, questions and design discussion are welcome and
are the useful way to engage with the project right now.

The rest of this page documents how the repository is built and checked. It
applies to anyone working in a fork for their own review purposes, and it is the
reference the maintainers work from.

## Local setup

```bash
corepack enable        # selects the pnpm version pinned in package.json
pnpm install
pnpm build
```

Node 24 (`.nvmrc`) and pnpm 11.1.2 (`packageManager` in the root
`package.json`). `pnpm build` runs `pnpm -r build` in topological order, so
`types` and `contracts` are built before the packages that import them. Nothing
in the workspace resolves internal packages from source at runtime, so an
unbuilt tree will not start.

Per-package work uses pnpm filters:

```bash
pnpm --filter @sparql-query-lib/api dev          # API only, watch mode
pnpm --filter @sparql-query-lib/api test         # one package's unit tests
pnpm --filter @sparql-query-lib/api test:watch
```

### Justfile recipes

The Justfile is the only task runner; there is no Taskfile. The recipes you are
likely to use:

| Recipe | What it does |
| --- | --- |
| `just run-local-memory` | API + MCP on port 3005, durable Oxigraph store under `packages/api/tmp/library-store`, assistant flag on |
| `just clean-local-memory` | Delete that store |
| `just run-frontend [API_URL]` | Nuxt dev server on port 3001, pointed at `http://localhost:3005` by default |
| `just run-local-rules-tests` | API as a rules workbench with the W3C SHACL 1.2 Rules suite seeded as runnable Tests, in its own store |
| `just run-frontend-rules` | The SPA with the matching feature flags — the API and the SPA read their own environments, so both halves must be set |
| `just clean-local-rules-tests` | Delete the rules-test store |
| `just run-local-patch-demo` / `just run-frontend-patch-demo` | The RDF Patch demo library and its SPA |
| `just uat-patch-demo` | Drive that demo in a real browser against a running API and SPA (start both first) |
| `just clean-local-patch-demo` | Delete the patch-demo store |
| `just run-local-like-docker` | The API alone, with the persistence settings the container uses |
| `just build-docker [TAG]` | Build the server image |
| `just run-docker-local [TAG]` / `just run-docker-persistent [TAG]` | Run that image with a mounted store |
| `just build-web-image [TAG]` | Build the web UI bundle image (static site at `/site`, nothing to run) |
| `just extract-web-bundle [TAG] [DEST]` | Copy that static site out of the image |
| `just setup-local-https`, `just run-local-https`, `just run-docker-https` | mkcert certificates and Traefik in front of the API and MCP on `https://localhost:3443` |

## Running the checks CI runs

```bash
bash scripts/ci/all.sh
```

`pnpm ci` is an alias for the same script. `.github/workflows/ci.yml` is a thin
dispatcher: every CI step is one `bash scripts/ci/<name>.sh`, so the whole
required pipeline is reproducible locally with no GitHub Actions involved.
`all.sh` runs, in order: `install.sh`, `lint.sh`, `ratchet-selftest.sh`,
`any-ratchet.sh`, `orphan-ratchet.sh`, `typecheck.sh`, `build.sh`,
`publish-check.sh`, `test.sh`.

What each one actually does:

- **`install.sh`** — `pnpm install --frozen-lockfile`.
- **`lint.sh`** — `pnpm -r --if-present lint`. Nine of the ten packages define
  `lint` as an `echo`, so the only real linting in the repo is stylelint over
  `packages/web/**/*.{vue,css}`, which enforces the design tokens (colour, font
  size, radius, and `padding`/`margin` on the `--space-*` scale). The script
  prints a warning naming every package whose lint script is a placeholder, so
  the size of the gap is visible in each run. No TypeScript linter gates today.
- **`typecheck.sh`** — `nuxi typecheck` over `packages/web`, compared against
  `packages/web/.typecheck-baseline`. The other packages typecheck as part of
  their build. It fails if the checker exits non-zero without printing a single
  `error TS` line, because a crashed checker and a clean tree both count zero.
- **`build.sh`** — `pnpm -r build`, topological. This doubles as the typecheck
  for every package except `web`.
- **`publish-check.sh`** — publish readiness for the packages that are not
  `private: true`. It checks the manifests (`scripts/check-publishable.mjs`),
  that each package's `public-api.md` still matches its built declarations
  (`check-public-api.mjs`), that the packed tarball installs, compiles under
  three module resolutions and loads in plain Node (`check-installable.mjs`),
  and that the declaration `sqlib export --typings` writes compiles in a
  consumer-shaped project (`check-generated-typings.mjs`). It publishes nothing
  and needs no token.
- **`test.sh`** — vitest, affected-aware. On a PR it runs the packages changed
  since the base branch plus their dependents; on a trunk push, or with
  `CI_TEST_MODE=full`, everything. It invokes vitest through
  `pnpm --filter X exec` rather than each package's `test` script, because pnpm
  11 does not forward trailing arguments to run-scripts. `SHARD=n/N` shards a
  run.
- **`commitlint.sh`** — runs on PRs only, warn-only.
- **`e2e.sh`** — Playwright. Not part of `all.sh` and not a required gate: the
  e2e job runs on `workflow_dispatch` only. It runs the web functional specs
  against a production preview build with the API mocked at the network layer,
  plus the `packages/api` demo-page suite. The `@visual` specs are excluded,
  because their baselines are rasterised with the authoring machine's fonts;
  run those locally with
  `pnpm --filter @sparql-query-lib/web test:e2e:visual`.

## The ratchets

Two gates measure the tree rather than a run, and both are baselines rather than
hard zeros so cleanup can land incrementally.

**`any-ratchet.sh`** runs `scripts/count-any.mjs`. It makes two different
promises: `packages/api/src` is a strict zone where any occurrence of `any`
fails, and the whole-repo count may fall but never rise. When a legitimate
cleanup lowers the count, record it:

```bash
node scripts/count-any.mjs --update
```

**`orphan-ratchet.sh`** runs `scripts/check-orphans.mjs`. A source file nothing
can reach — not an entry point, not a test, not a config, not Nuxt's routing —
fails the build unless it is named in `scripts/orphan-baseline.json`. The
baseline names files rather than counting them, because an accepted orphan is a
claim that someone looked at that specific file and decided it stays.

**When a ratchet trips**, the fix is the code, not the baseline. Remove the
`any` or delete the unreachable module. Adding an entry to
`scripts/orphan-baseline.json`, or raising the `any` baseline, is a decision to
be explained in the pull request, not a way past a red build.

**`ratchet-selftest.sh`** guards both of them: it checks that each still fails
when it measures nothing, since a crashed checker and a moved scan directory
both score as clean. It runs in about a second and needs no install.

## Commits

Conventional Commits: `feat:`, `fix:`, `chore:`, `test:`, `ci:`, `docs:`, and
`feat!:` or a `BREAKING CHANGE:` footer for a breaking change. The configuration
is `commitlint.config.cjs`, extending `@commitlint/config-conventional`.

`scripts/ci/commitlint.sh` is **warn-only**: a non-conforming commit prints a
warning and the job stays green. It becomes blocking when versioned releases are
adopted. Write commits as though it already blocked.

All changes land on `main` through a pull request.

## Packages and tests

Ten packages under `packages/*`. Eight are `private: true`; `runtime` and
`runtime-oxigraph` are not, because they are the parser-free static-export
runtime that a generated export loads as a dependency. They are
packaging-complete and gated by `publish-check.sh`, and no version of either has
been published yet.

Test layout, per package:

| Package | Unit tests | Notes |
| --- | --- | --- |
| `api` | `packages/api/test/` | The large suite. Subdirectories by area: `routes/`, `scenarios/`, `persistence/`, `lib/`, `server/`, `integration/`, `auth/`, `system-store/`, and others. `packages/api/tests/` holds the Playwright demo-page specs. |
| `web` | `packages/web/test/` | vitest with happy-dom. Playwright specs live in `packages/web/tests/e2e/` and are excluded from the unit run. |
| `srl` | `packages/srl/test/` | Includes the W3C SHACL 1.2 Rules harness (`w3c.harness.test.ts` and `w3c/`). |
| `runtime`, `runtime-oxigraph`, `rdf-delta`, `tools`, `mcp-server` | `packages/<name>/test/` | |
| `types`, `contracts` | none | Their `test` script is a placeholder, and `test.sh` selects only packages whose `test` script mentions vitest. |

`packages/api/test/README-TESTING-PATTERNS.md` describes the three shapes an API
test takes and when each applies: scenario tests that configure the global
`oxigraphStoreManager` and `MemoryCacheManager` singletons and register the real
Fastify app; dependency-injected unit tests that construct their own store
manager against a temporary directory; and mocked unit tests that stub
`CacheCoordinatorProvider` to exercise validation logic alone. Most of the
existing suite is the first shape. Read that file before adding a test that
touches storage — two suites sharing one on-disk Oxigraph store is a known
source of cross-test failures, and is why `test.sh` excludes the workspace root
project from its CI run.

Internal packages resolve to source in tests through a vitest `alias`, so a test
run needs no build.

## Gotchas

**pnpm 11 ignores `pnpm.overrides` in `package.json`.** It reads overrides only
from `pnpm-workspace.yaml`. A local install with an older pnpm writes an
`overrides` section into the lockfile; pnpm 11 in Docker reads no overrides,
sees the lockfile carrying some, and fails `pnpm install --frozen-lockfile`
with `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`. Moving the overrides into
`pnpm-workspace.yaml` hits the opposite pnpm bug, where the overrides are
stripped from the lockfile instead. Before adding an override, check whether it
is needed at all — `grep '<pkg>@' pnpm-lock.yaml | sort -u` — and drop it if
only one version already resolves. If Docker still appears to be reusing a stale
lockfile layer, rebuild with `--no-cache`.

**Generated schemas are checked in.**
`packages/contracts/src/schema/*.generated.ts` are tracked despite being
generated; regenerate them with
`pnpm --filter @sparql-query-lib/api generate-schemas`. Build artifacts —
`dist/`, `*.tsbuildinfo`, `.nuxt/`, `.output/` — are not.

**A dirty incremental rebuild can skip declaration emit** (`composite: true`
with tsup's `--clean false`). CI always builds clean, so this only bites
locally. If types look stale, run
`rm -rf packages/*/dist packages/*/*.tsbuildinfo` and rebuild.

**Cross-package dependencies use `workspace:*`**, never `file:../`.

**Adding a package**: create it under `packages/*` with `build`, `lint` and
`test` scripts, depend on internal packages with `workspace:*`, and add a vitest
config aliasing internal dependencies to `src` if it has tests. The dependency
graph and affected-aware testing pick it up without further wiring.
