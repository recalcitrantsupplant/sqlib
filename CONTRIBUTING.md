# Contributing

## External pull requests are not being accepted before 1.0

Before 1.0, sqlib uses a review-only licence (see [LICENSE](LICENSE)). That
licence does not let us accept contributed code. We close pull requests from
outside the project without a merge, whatever their quality. Issues, bug
reports, questions and design discussion are welcome.

The rest of this page describes how the repository is built and checked. It
applies to a person who works in a fork for review, and the maintainers use it
as their reference.

## Local setup

```bash
npm install --global pnpm@11.1.2   # the version pinned in package.json
pnpm install
pnpm build
```

You need Node 26 (`.nvmrc`, the same major version as the Docker images) and
pnpm 11.1.2 (`packageManager` in the root `package.json`). `pnpm build` runs
`pnpm -r build` in topological order, so `types` and `contracts` build before the
packages that import them. At run time, no package resolves internal packages
from source, so a tree with no build does not start.

For work on one package, use pnpm filters:

```bash
pnpm --filter @sparql-query-lib/api dev          # API only, watch mode
pnpm --filter @sparql-query-lib/api test         # one package's unit tests
pnpm --filter @sparql-query-lib/api test:watch
```

### Justfile recipes

The Justfile is the only task runner. There is no Taskfile. The recipes that you
will probably use:

| Recipe | What it does |
| --- | --- |
| `just run-local-memory` | API + MCP on port 3005, durable Oxigraph store under `packages/api/tmp/library-store`, assistant flag on |
| `just clean-local-memory` | Delete that store |
| `just dev-auth` | API, MCP and SPA with each feature flag on, in `required` auth mode behind a local Rauthy on port 8080, with an administrator and three test people. See [a dev stack behind Rauthy](docs/guides/deploying.md#a-dev-stack-behind-rauthy) |
| `just rauthy-up` / `just rauthy-down` / `just clean-rauthy` | Start, stop or delete that Rauthy alone |
| `just clean-dev-auth` | Delete the library store and grants of `dev-auth` |
| `just run-frontend [API_URL]` | Nuxt dev server on port 3001, pointed at `http://localhost:3005` by default |
| `just run-local-rules-tests` | API as a rules workbench with the W3C SHACL 1.2 Rules suite seeded as runnable Tests, in its own store |
| `just run-frontend-rules` | The SPA with the matching feature flags. The API and the SPA read separate environments, so you must set both |
| `just clean-local-rules-tests` | Delete the rules-test store |
| `just run-local-patch-demo` / `just run-frontend-patch-demo` | The RDF Patch demo library and its SPA |
| `just uat-patch-demo` | Run that demo in a real browser, against a running API and SPA. Start both first |
| `just clean-local-patch-demo` | Delete the patch-demo store |
| `just run-local-like-docker` | The API alone, with the persistence settings of the container |
| `just build-docker [TAG]` | Build the server image |
| `just run-docker-local [TAG]` / `just run-docker-persistent [TAG]` | Run that image with a mounted store |
| `just build-web-image [TAG]` | Build the web UI bundle image (static site at `/site`, nothing to run) |
| `just extract-web-bundle [TAG] [DEST]` | Copy that static site out of the image |
| `just setup-local-https`, `just run-local-https`, `just run-docker-https` | mkcert certificates and Traefik in front of the API and MCP on `https://localhost:3443` |

## Running the checks CI runs

```bash
bash scripts/ci/all.sh
```

`pnpm ci` runs the same script. `.github/workflows/ci.yml` only calls scripts:
each CI step is one `bash scripts/ci/<name>.sh`. You can therefore run the whole
required pipeline locally, without GitHub Actions. `all.sh` runs, in order: `install.sh`, `lint.sh`, `ratchet-selftest.sh`,
`any-ratchet.sh`, `orphan-ratchet.sh`, `typecheck.sh`, `build.sh`,
`publish-check.sh`, `test.sh`.

What each script does:

- **`install.sh`**: `pnpm install --frozen-lockfile`.
- **`lint.sh`**: three checks.
  - `pnpm -r --if-present lint`: stylelint over
    `packages/web/**/*.{vue,css}`, for the design tokens (colour, font size,
    radius, and `padding`/`margin` on the `--space-*` scale).
  - The ESLint ratchet (`scripts/lint-ratchet.mjs`, below), over the TypeScript
    of each package.
  - The documentation link check.
- **`typecheck.sh`**: `nuxi typecheck` over `packages/web`, compared with
  `packages/web/.typecheck-baseline`. The other packages typecheck as part of
  their build. It fails if the checker exits non-zero and prints no `error TS`
  line, because a crashed checker and a clean tree both count zero.
- **`build.sh`**: `pnpm -r build`, in topological order. This is also the
  typecheck for each package except `web`.
- **`publish-check.sh`**: publish readiness for the packages that are not
  `private: true`. It checks:
  - the manifests (`scripts/check-publishable.mjs`);
  - that the `public-api.md` of each package still matches its built
    declarations (`check-public-api.mjs`);
  - that the packed tarball installs, compiles under three module resolutions,
    and loads in plain Node (`check-installable.mjs`);
  - that the declaration from `sqlib export --typings` compiles in a project
    like a consumer's (`check-generated-typings.mjs`).

  It publishes nothing, and needs no token.
- **`test.sh`**: vitest, for the affected packages. On a PR, it runs the packages
  changed since the base branch, and their dependents. On a trunk push, or with
  `CI_TEST_MODE=full`, it runs all packages. It calls vitest through
  `pnpm --filter X exec`, and not through the `test` script of each package,
  because pnpm 11 does not pass trailing arguments to run-scripts. `SHARD=n/N`
  shards a run.
- **`commitlint.sh`**: runs on PRs only. It fails the job on a commit that is not
  a Conventional Commit.
- **`e2e.sh`**: Playwright. It is not part of `all.sh`, because it needs a
  browser and a production build. The e2e job runs on each pull request and
  push, and the Dependabot auto-merge waits for it, as for the other jobs. It
  runs the web functional specs against a production preview build, with the
  API mocked at the network layer, and the `packages/api` demo-page suite. The
  `@visual` specs are excluded, because their baselines are rendered with the
  fonts of the author's computer. Run them locally with
  `pnpm --filter @sparql-query-lib/web test:e2e:visual`.

## The ratchets

Three gates measure the tree, and not a run. All three compare with a baseline,
and not with zero, so a cleanup can merge in steps.

**`lint.sh`** runs `scripts/lint-ratchet.mjs`: ESLint with the root
`eslint.config.mjs`. The rules are:

- the recommended rules of `typescript-eslint`;
- unused imports and variables;
- `no-explicit-any`;
- `no-console` outside scripts, tests and CLI entry points.
  `packages/web/src` can still use `console.warn` and `console.error`. Other
  web output goes through `debug()` from `src/lib/debug.ts`. API output goes
  through the logger in `packages/api/src/lib/log.ts`.

The ratchet counts problems for each package and rule, and compares the count
with `scripts/lint-baseline.json`. A count that increases fails. A package and
rule pair that the baseline does not name must stay at zero. To see the
problems behind a count, and to fix unused imports automatically:

```bash
pnpm exec eslint packages/api            # list them
pnpm exec eslint --fix packages/api      # fix what is fixable
pnpm lint:update                         # record a lower count
```

The root pins TypeScript 6 for ESLint only. `typescript-eslint` cannot parse
with TypeScript 7, and each package except `web` builds with TypeScript 7.

**`any-ratchet.sh`** runs `scripts/count-any.mjs`. It has two rules:

- `packages/api/src` is a strict zone. Each `as any` or `catch (x: any)` there
  fails.
- The count for the whole repository can decrease, and never increase. This
  count includes `: any` annotations, in `packages/api/src` and elsewhere.

When a cleanup lowers the count, record it:

```bash
node scripts/count-any.mjs --update
```

**`orphan-ratchet.sh`** runs `scripts/check-orphans.mjs`. A source file that
nothing can reach fails the build, unless `scripts/orphan-baseline.json` names
it. Entry points, tests, configs and the routing of Nuxt can each reach a file.
The baseline names files, and does not count them. Each accepted orphan states
that a person read that file and decided to keep it.

**When a ratchet fails**, fix the code. Remove the `any`, or delete the
unreachable module. A new entry in `scripts/orphan-baseline.json`, or a higher
`any` or lint baseline, is a decision. Explain it in the pull request.

**`ratchet-selftest.sh`** guards the `any` and orphan ratchets. It checks that
each still fails when it measures nothing, because a crashed checker and a
moved scan directory both count as clean. It runs in about one second, and
needs no install.

## Commits

Conventional Commits: `feat:`, `fix:`, `chore:`, `test:`, `ci:`, `docs:`, and
`feat!:` or a `BREAKING CHANGE:` footer for a breaking change. The configuration
is `commitlint.config.cjs`, extending `@commitlint/config-conventional`.

`scripts/ci/commitlint.sh` is **blocking** on pull requests. A commit that does
not conform fails the `verify` job. release-please makes releases from these
messages (`v0.1.0` is the first; see `CHANGELOG.md`). A commit that it cannot
parse gets no version bump and no changelog entry.

Each change merges to `main` through a pull request.

Write commit messages, pull requests, comments and documentation to
[docs/writing-style.md](docs/writing-style.md).

## Packages and tests

There are sixteen packages under `packages/*`. Eight are `private: true`. Eight
are not:

- `runtime` and `runtime-oxigraph`: the static-export runtime, with no parser.
  A generated export loads it as a dependency.
- `compiler`, `srl`, `runtime-duckdb`, `runtime-etl`, `runtime-srl` and `cli`:
  the `sqlib` command line. These six are ESM only.

Status of these eight:

- Done: each is ready to package, and `publish-check.sh` checks it.
- To do: publish them.

The test layout of each package:

| Package | Unit tests | Notes |
| --- | --- | --- |
| `api` | `packages/api/test/` | The large suite. Subdirectories by area: `routes/`, `scenarios/`, `persistence/`, `lib/`, `server/`, `integration/`, `auth/`, `system-store/`, and others. `packages/api/tests/` holds the Playwright demo-page specs. |
| `web` | `packages/web/test/` | vitest with happy-dom. The Playwright specs are in `packages/web/tests/e2e/`, and the unit run excludes them. |
| `srl` | `packages/srl/test/` | Includes the W3C SHACL 1.2 Rules harness (`w3c.harness.test.ts` and `w3c/`). |
| `runtime`, `runtime-oxigraph`, `compiler`, `runtime-duckdb`, `runtime-etl`, `runtime-srl`, `cli`, `rdf-delta`, `tools`, `mcp-server` | `packages/<name>/test/` | |
| `types`, `contracts` | none | Their `test` script is a placeholder. `test.sh` selects only packages whose `test` script names vitest. |

`packages/api/test/README-TESTING-PATTERNS.md` describes the three shapes of an
API test, and when to use each:

- scenario tests, which configure the global `oxigraphStoreManager` and
  `MemoryCacheManager` singletons, and register the real Fastify app;
- unit tests with dependency injection, which make their own store manager
  against a temporary directory;
- mocked unit tests, which stub `CacheCoordinatorProvider` to test validation
  logic alone.

Most of the current suite uses the first shape. Read that file before you add a
test that uses storage. When two suites share one Oxigraph store on disk, tests
can fail because of each other. For this reason, `test.sh` excludes the
workspace root project from its CI run.

In tests, internal packages resolve to source through a vitest `alias`, so a
test run needs no build.

## Known problems

**pnpm 11 ignores `pnpm.overrides` in `package.json`.** It reads overrides only
from `pnpm-workspace.yaml`. The problem:

1. A local install with an older pnpm writes an `overrides` section into the
   lockfile.
2. pnpm 11 in Docker reads no overrides, but finds some in the lockfile.
3. `pnpm install --frozen-lockfile` fails with
   `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH`.

If you move the overrides into `pnpm-workspace.yaml`, a different pnpm bug
removes them from the lockfile. Before you add an override, check whether it is
necessary, with `grep '<pkg>@' pnpm-lock.yaml | sort -u`. If only one version
already resolves, do not add it. If Docker still uses an old lockfile layer,
rebuild with `--no-cache`.

**Generated schemas are checked in.** Git tracks
`packages/contracts/src/schema/*.generated.ts`, although they are generated.
Generate them again with `pnpm --filter @sparql-query-lib/api generate-schemas`.
Git does not track build artifacts: `dist/`, `*.tsbuildinfo`, `.nuxt/` and
`.output/`.

**An incremental rebuild on a dirty tree can skip the declaration output**
(`composite: true` with `--clean false` in tsup). CI always builds from clean,
so this occurs only locally. If types look old, run
`rm -rf packages/*/dist packages/*/*.tsbuildinfo`, and build again.

**Cross-package dependencies use `workspace:*`**, never `file:../`.

**To add a package:**

1. Make it under `packages/*`, with `build` and `test` scripts. It needs no
   `lint` script, because the root ESLint configuration covers its TypeScript.
2. Depend on internal packages with `workspace:*`.
3. If it has tests, add a vitest config that aliases internal dependencies to
   `src`.

The dependency graph and the affected-package tests then include it with no
more configuration.
