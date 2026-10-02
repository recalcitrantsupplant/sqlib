# Testing patterns for the API

Three shapes of test exist in `packages/api/test`, and a new test should be one
of them. They differ in how much of the app is real, and so in what a failure
tells you.

| Shape | Where | What is real | What is faked |
| --- | --- | --- | --- |
| **Scenario** | `test/scenarios/**` | routes, cache, engine, an Oxigraph store | nothing but the network |
| **Route** | `test/routes/**`, `test/auth/**` | the route plugin under test, over `app.inject` | its storage, and anything the route reaches that the test is not about |
| **Unit** | `test/lib/**`, `test/persistence/**`, most others | the module under test | its collaborators, through setters |

---

## Scenario tests

Drive the real app the way a client does. `ScenarioTestBaseUnmocked`
(`test/scenarios/fixtures/scenario-test-base-unmocked.ts`) points the global
`oxigraphStoreManager` at a temporary directory, loads the real
`memoryCacheManager` in cache-only mode, registers the real route plugins on a
fresh Fastify instance, and offers helpers to load Turtle into a backend and to
create the backend, library and query group a scenario starts from.

```typescript
let context: ScenarioTestContext;

beforeAll(async () => {
  context = await ScenarioTestBaseUnmocked.createTestContext('single-node-basic');
  await ScenarioTestBaseUnmocked.loadTurtleDataIntoBackend(context, 'people-skills-projects.ttl');
  await ScenarioTestBaseUnmocked.createOxigraphBackend(context, 'Backend');
  await ScenarioTestBaseUnmocked.createLibrary(context, 'Library');
}, 30000);

afterAll(() => ScenarioTestBaseUnmocked.cleanupTestContext(context));

it('runs the group', async () => {
  const res = await context.app.inject({ method: 'POST', url: '/execute', payload: { ... } });
  expect(res.statusCode).toBe(200);
});
```

`test/scenarios/query-groups/00-single-node-basic.test.ts` is the smallest
complete example. Use this shape for anything that crosses the engine, or
whose bug would live between two modules rather than inside one.

## Route tests

Mount the route plugin under test on a fresh Fastify instance, with
`setupValidator(app)` and the contract schemas added, and drive it with
`app.inject`. The handler, the schema validation and the auth guard are real;
storage is not.

Fake storage in one of two ways:

- **`installFakePersistenceAdapter(seed)`** from `test/support/`, when the
  route should run over real repositories and a real cache coordinator. It puts
  an in-memory store behind both storage doors (the `PersistenceAdapter` and
  the repository lenses), so assertions are on what was stored rather than on
  which function was called. Prefer this for new tests.
- **`overrideCacheCoordinatorProvider({ getCacheCoordinator, getEntityRepositories })`**,
  when the test is about the route's decisions given a fixed answer from
  storage, and a fake coordinator is the shortest way to give it.

Each route test file still builds its own app, with its own copy of an error
handler. A shared `test/support/buildTestApp.ts` that mounts plugins with the
app's real error handler is planned once the route layer is consolidated
(work packages WP20a, WP21 and WP35 in
`docs/proposals/2026-09-review-work-packages.md`); until then, copy the shape
of a neighbouring file in the same directory.

## Unit tests

Call the module directly. Give it collaborators through the setters the app
already has rather than by mocking modules:

| To fake | Use |
| --- | --- |
| entity storage | `installFakePersistenceAdapter` (`test/support/fakePersistenceAdapter.ts`) |
| the cache coordinator or repositories | `overrideCacheCoordinatorProvider` |
| repository lenses alone | `overrideRepositoryLenses` |
| the persistence adapter alone | `setPersistenceAdapter` |
| auth | `setAuthStore`, `resetAuthConfig` |
| feature flags | `overrideFeatureFlags` |
| a SPARQL executor | `new ExecutorFactory(...)` with a stub, passed to `ExecutionEngine` |

`ExecutionEngine` takes its `ExecutorFactory` as a required argument because the
factory carries whose grants a run is checked against: `new ExecutorFactory({ request })`
for a caller, `{ internal: true }` for sqlib itself, or a test double.

Assert on behaviour and on error classes. An exact error-message assertion is
right only where the message is the contract (a status body a client reads);
elsewhere `toThrow(SomeError)` or `expect.stringContaining` survives a reworded
message that changed nothing.

`vi.mock` is the last resort, for a module with no seam. It moves the file into
the slower `isolated` project (below), and a mock keyed to a file path keeps
passing when the module it replaces changes behaviour.

---

## Module isolation: `shared` and `isolated` projects

`vitest.config.ts` splits the suite in two, worked out from the files on every
run:

- **`isolated`** — any file that calls `vi.mock`/`vi.doMock`, directly or through
  a helper under `test/` it imports, or that imports the server entry point
  (`src/index.ts`). These get a fresh module graph per file, as before.
- **`shared`** — everything else, run with `isolate: false`: files in a worker
  share one module registry, so the ~900 source modules are evaluated once per
  worker instead of once per file. This is most of the suite's speed.

A shared file inherits whatever module-level state the previous file left, so
`test/setup-shared-registry.ts` puts the app's singletons (cache coordinator,
`oxigraphStoreManager`, auth, feature flags, ...), `process.env`,
`globalThis.fetch` and process error listeners back before each one. Two
consequences for writing tests:

- **Prefer a setter to `vi.mock`.** `vi.mock` puts a file in `isolated`, which
  is several times slower per file. To fake the cache, use
  `overrideCacheCoordinatorProvider({ getCacheCoordinator, getEntityRepositories })`;
  `setPersistenceAdapter`, `setAuthStore` and `overrideFeatureFlags` do the same
  for their modules. The reset clears all of them before the next file.
- **Don't capture a singleton at module load.** `const c = getCacheCoordinator()`
  at the top of a `src` module keeps the first file's coordinator for every file
  after it. Resolve it where it is used.

A shared file that passes alone and fails in the full run is almost always a
module-level singleton the reset does not know about yet: add it to
`setup-shared-registry.ts`. `vitest run --project shared --sequence.shuffle.files`
is a quick way to shake out order dependence.
