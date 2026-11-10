# Testing patterns for the API

`packages/api/test` has three shapes of test. Make each new test one of them.
They differ in how much of the app is real. A failure in each shape therefore
tells you different things.

| Shape | Where | What is real | What is faked |
| --- | --- | --- | --- |
| **Scenario** | `test/scenarios/**` | routes, cache, engine, an Oxigraph store | nothing but the network |
| **Route** | `test/routes/**`, `test/auth/**` | the route plugin under test, over `app.inject` | its storage, and anything the route reaches that the test is not about |
| **Unit** | `test/lib/**`, `test/persistence/**`, most others | the module under test | its collaborators, through setters |

---

## Scenario tests

Use the real app as a client does. `ScenarioTestBaseUnmocked`
(`test/scenarios/fixtures/scenario-test-base-unmocked.ts`) does these steps:

1. It sets the global `oxigraphStoreManager` to a temporary directory.
2. It loads the real `memoryCacheManager` in cache-only mode.
3. It registers the real route plugins on a new Fastify instance.

It also has helpers that load Turtle into a backend, and that create the
backend, library and query group for the start of a scenario.

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
complete example. Use this shape for a test that goes through the engine, or
for a bug that can occur between two modules.

## Route tests

Mount the route plugin under test on a new Fastify instance. Add
`setupValidator(app)` and the contract schemas, and call the routes with
`app.inject`. The handler, the schema validation and the auth guard are real.
The storage is fake.

Fake storage in one of two ways:

- **`installFakePersistenceAdapter(seed)`** from `test/support/`. Use it when
  the route must run over real repositories and a real cache coordinator. It
  puts an in-memory store behind both storage interfaces: the
  `PersistenceAdapter` and the repository lenses. Assertions then check what
  was stored, and not which function was called. Use this for new tests.
- **`overrideCacheCoordinatorProvider({ getCacheCoordinator, getEntityRepositories })`**.
  Use it when the test is about the decisions of the route for a fixed answer
  from storage, and a fake coordinator is the shortest way to give that
  answer.

Each route test file builds its own app, with its own copy of an error
handler. Until the shared helper exists, copy the shape of a nearby file in the
same directory.

To do: a shared `test/support/buildTestApp.ts` that mounts plugins with the
real error handler of the app. It waits for the route layer to be consolidated
(work packages WP20a, WP21 and WP35 in
`docs/proposals/2026-09-review-work-packages.md`).

## Unit tests

Call the module directly. Give it collaborators through the setters that the
app has. Do not mock modules:

| To fake | Use |
| --- | --- |
| entity storage | `installFakePersistenceAdapter` (`test/support/fakePersistenceAdapter.ts`) |
| the cache coordinator or repositories | `overrideCacheCoordinatorProvider` |
| repository lenses alone | `overrideRepositoryLenses` |
| the persistence adapter alone | `setPersistenceAdapter` |
| auth | `setAuthStore`, `resetAuthConfig` |
| feature flags | `overrideFeatureFlags` |
| a SPARQL executor | `new ExecutorFactory(...)` with a stub, passed to `ExecutionEngine` |

`ExecutionEngine` requires an `ExecutorFactory` argument. The factory sets the
grants that a run is checked against:

- `new ExecutorFactory({ request })` for a caller;
- `{ internal: true }` for sqlib itself;
- a test double.

Assert behaviour and error classes. Assert an exact error message only where
the message is the contract, for example a status body that a client reads. In
other places, use `toThrow(SomeError)` or `expect.stringContaining`. These
still pass when a message gets new words and the same meaning.

Use `vi.mock` only for a module with no seam. It moves the file into the
slower `isolated` project (see below). Also, a mock keyed to a file path
continues to pass when the behaviour of the real module changes.

---

## Module isolation: `shared` and `isolated` projects

`vitest.config.ts` divides the suite into two projects. It reads the files
again on each run to do this:

- **`isolated`**: each file that calls `vi.mock` or `vi.doMock`, directly or
  through a helper under `test/` that it imports. Also each file that imports
  the server entry point (`src/index.ts`). Each of these files gets a new
  module graph.
- **`shared`**: all other files, with `isolate: false`. The files in a worker
  share one module registry. Each worker evaluates the ~900 source modules
  once, and not once for each file. Most of the speed of the suite comes from
  this.

A shared file gets the module-level state that the previous file left. Before
each file, `test/setup-shared-registry.ts` therefore resets:

- the singletons of the app (cache coordinator, `oxigraphStoreManager`, auth,
  feature flags, ...);
- `process.env`;
- `globalThis.fetch`;
- the process error listeners.

This has two results for how you write tests:

- **Use a setter, and not `vi.mock`.** `vi.mock` puts a file in `isolated`,
  which is several times slower for each file. To fake the cache, use
  `overrideCacheCoordinatorProvider({ getCacheCoordinator, getEntityRepositories })`.
  `setPersistenceAdapter`, `setAuthStore` and `overrideFeatureFlags` do the
  same for their modules. The reset clears all of them before the next file.
- **Do not capture a singleton at module load.** `const c = getCacheCoordinator()`
  at the top of a `src` module keeps the coordinator of the first file for each
  file after it. Get the singleton where you use it.

A shared file can pass alone and fail in the full run. The cause is almost
always a module-level singleton that the reset does not know. Add it to
`setup-shared-registry.ts`. To find order dependence quickly, run
`vitest run --project shared --sequence.shuffle.files`.
