# E2E Tests

Playwright end-to-end tests for the web app. Every spec mocks the API at the
network layer — **no backend needs to be running**, and none is started.

There is one exception, and it lives elsewhere: `../uat/`, run by
`playwright.uat.config.ts`, drives a **real** API and a **real** store. It is
not part of this suite or of CI. See [The UAT lane](#the-uat-lane) below.

## Running

The Playwright config starts the **production preview build**, not the dev
server: the dev server re-optimises Vite dependencies mid-run and serves a 500
for dynamically imported pages, which made the suite flaky in ways that looked
like product bugs.

```bash
# Everything (builds first; ~2 min for the build)
pnpm test:e2e

# What CI runs: functional specs only
pnpm test:e2e:ci

# Visual regression only
pnpm test:e2e:visual

# Keep a preview running and the build cost is paid once
pnpm build && pnpm preview &
npx playwright test main-panel
```

## Layout

| file | covers |
|---|---|
| `fixtures/entities.ts` | Frozen entities — library, backend, query, rule, data block, rule set, query group, benchmark — behind one route table. Use for specs that need a populated app. |
| `fixtures/collections.ts` | Empty defaults for the seven collection endpoints the sidebar loads. Layer spec-specific routes on top. |
| `query-group-test-helpers.ts` | Stateful mock API for the canvas write paths. |
| `visual-regression.spec.ts` | 42 screenshot baselines, both themes. Tagged `@visual`. |
| `visual-canvas-states.spec.ts` | The query group canvas in the five states it is actually used in — empty, ran, failed, refused by validation, and its arguments. Tagged `@visual`. |
| `visual-helpers.ts` | `setTheme`, `stabilise`, `FIXED_NOW` — what both visual specs do before every shot. |
| everything else | Functional specs: navigation, dialogs, CRUD, versions, rule set execution. |

### The one thing that bites everyone

`NavigationSidebar.loadLibrariesData` fetches libraries, queries, query groups,
rules, data blocks and rule sets in a **single `Promise.all`**. One unmocked
endpoint rejects the whole thing and the sidebar renders empty — which looks
exactly like a broken selector. `mockSidebarCollections` exists to stop that.

Two more traps worth knowing:

- Contracts are `.strict()`. A stray key (`comment` on a `Query`, say) is a hard
  parse error, and the same entity can have **different shapes on different
  endpoints** — a rule from `GET /rules` carries `rulesetMembership`, the same
  rule inside an expanded rule-set version carries `comment` instead.
- The Libraries **section** starts expanded; individual libraries and their
  categories start collapsed. Blind `.click()` on the section toggle collapses
  it. Expand idempotently by checking for `.arrow.expanded`.
- A **canvas fixture has to describe a group the canvas calls healthy**, and
  neither of them did. A group whose expansion omits `queryVersions`, or whose
  control-flow edge names a port, opens with a blocking error on it — which no
  functional spec notices, because each asserts on the thing it came to see,
  and which a screenshot baselines as if it were the design.
  `test/lib/canvasFixtureHealth.test.ts` runs the live validator over both
  fixtures and over what a save answers with, so a fixture cannot go red
  unnoticed again.
- Clicking a **canvas node** at its centre does not select it. A collapsed node
  is mostly its own `.node-toggle`, and that button stops propagation so opening
  a node does not also select it — the click never reaches VueFlow's
  `@node-click`, and the inspector stays on "Nothing selected". Click clear of
  the toggle (`selectQueryNode` uses the node's corner), and remember the object
  editor is the inspector's **Editor** tab, not Details.

## Visual regression

Baselines live beside the spec that takes them, in
`<spec>.ts-snapshots/`. Re-baseline with `--update-snapshots` and review the
diffs before committing.

They are excluded from CI: baselines are rasterised with the authoring
machine's font stack and a GitHub runner renders text differently, so they
would fail there for reasons unrelated to the change. See `scripts/ci/e2e.sh`.

### The inventory is checked even though the lane is not run

Excluding the lane from CI means nothing notices when a shot and its baseline
part company, and twice they had: the playground → section rename left three
screens' baselines on disk with no spec reading them, and three shots with
nothing to compare against. `test/visualBaselines.test.ts` now compares the two
lists by name — no browser needed, so it runs in CI with every other unit test.
It fails on a baseline no shot reads, and on a shot with no baseline unless the
shot is listed in `visual-baselines-pending.txt`.

**Pending is for shots that cannot be baselined where they were written.** A
baseline carries the authoring machine's font stack, so one written anywhere
else is worse than none. Add the line, and delete it in the same run that makes
the image — the guard fails on a pending entry that already has a baseline, so
the list cannot rot.

**`benchmarks-light` / `benchmarks-dark` are stale.** The benchmark work area
was rebuilt as the Plan/Runs screens, so the baselines show a screen that no
longer exists. They were deliberately not regenerated: that has to happen on
the authoring machine, or the new baselines carry this container's font stack
and every later run fails against them.

## Known failures, deliberately left marked

Marked `fixme` rather than deleted, so the finding is not lost:

- **`query-version-etag` → "should maintain separate etags…"** — after
  switching versions, the client sends the *query entity's* `Last-Modified` as
  `If-Match` for a version PATCH, so the update is rejected 412.

## Removed specs

- **`query-crud.spec.ts`** — asserted an inline query-creation flow (always-
  visible fields, editor overlays, creation-context banner) that no longer
  exists; creation is a dialog now. The dialog flow is covered by
  `query-crud-mocked.spec.ts`.
- **`backends-dropdown.spec.ts`** — drove a live API through
  `http://localhost:3001` (the *web* server, not the API), so it could never
  have passed. Backend-dropdown behaviour is covered by
  `library-backend-selection.spec.ts` and `library-backend-edit.spec.ts`.

## The UAT lane

`tests/uat/patch-demo-uat.spec.ts`, run by `playwright.uat.config.ts`, is the
one set of specs that talks to a live API. Mocking would defeat it: what it
checks is whether the RDF Patch an update query previews is the diff that update
would actually make against a store, and a fixture can only tell you the app
renders what it was handed.

It starts nothing. Bring both halves up first:

```bash
just run-local-patch-demo      # API on :3005, seeded with the demo library
just run-frontend-patch-demo   # SPA on :3001
just uat-patch-demo            # the specs
```

Serial and single-worker on purpose — the specs share one store, and the last
of them writes to it (and reverts). `PW_CHROMIUM_PATH` points the run at a
system Chromium where Playwright cannot download its own.
