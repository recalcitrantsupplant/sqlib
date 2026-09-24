# Testing Patterns for SPARQL Query Library

## Overview

This document describes recommended testing patterns for different types of tests in this codebase.

---

## Pattern A: Scenario/Integration Tests (Prod-Like)

**Use Case:** End-to-end integration tests that simulate production behavior

**Example:** `test/scenarios/query-groups/02-simple-ab-integration.test.ts`

### Key Principles:
- Use **global singletons** for storage (`oxigraphStoreManager`)
- For routes, prefer `CacheCoordinatorProvider` wired to a real `MemoryCacheManager` per test
- Real Fastify app with all routes registered
- Actual backend executors (Oxigraph, HTTP)
- Minimal mocking (only external network calls)

### Pattern:

```typescript
import { oxigraphStoreManager } from '../../../src/lib/OxigraphStoreManager.js';
import { memoryCacheManager } from '../../../src/lib/MemoryCacheManager.js';

class ScenarioTestBase {
  static async createTestContext(scenarioName: string) {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `scenario-test-${scenarioName}-`));

    // Configure GLOBAL singleton with test directory
    await oxigraphStoreManager.initialize(tempDir);
    await memoryCacheManager.loadAll();

    // Create real Fastify app
    const app = Fastify({ logger: false });
    await app.register(allRoutes);

    return { app, tempDir, ... };
  }

  static async loadTurtleDataIntoBackend(context, filename) {
    // Use GLOBAL singleton (same instance ExecutorFactory will use)
    const store = await oxigraphStoreManager.createPersistentStore(backendId, config);
    await oxigraphStoreManager.loadDataFromString(store, turtleData, 'turtle');
  }
}
```

### Why This Works:
- ExecutorFactory uses `oxigraphStoreManager` singleton
- Test configures the same singleton instance via `initialize(tempDir)`
- All components share the same store instance
- Matches production behavior where singleton is used throughout

### Route Integration Variant (Repos)
**Use Case:** Integration tests that hit route handlers using `withReposHandler`

Key idea: keep a real `MemoryCacheManager` instance, but route access goes through `CacheCoordinatorProvider`.

```typescript
const hoisted = vi.hoisted(() => ({
  cacheManager: null,
  list: vi.fn((type) => hoisted.cacheManager?.getByType(type) ?? []),
  get: vi.fn((id) => hoisted.cacheManager?.get(id) ?? null),
  create: vi.fn((type, entity) => hoisted.cacheManager!.create(entity, type)),
  update: vi.fn((type, id, updates) => hoisted.cacheManager!.update(id, updates, type)),
  delete: vi.fn((type, id) => hoisted.cacheManager!.delete(id, type)),
}));

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({
    list: hoisted.list,
    get: hoisted.get,
    create: hoisted.create,
    update: hoisted.update,
    delete: hoisted.delete,
  }),
});

beforeEach(async () => {
  hoisted.cacheManager = new MemoryCacheManager();
  await hoisted.cacheManager.loadAll();
});
```

---

## Pattern B: Isolated Unit Tests (Dependency Injection)

**Use Case:** Fast, isolated unit tests for individual classes/functions

**Example:** Future unit tests for `ExecutionEngine`, `GraphBuilder`, etc.

### Key Principles:
- **Dependency injection** instead of singletons
- Mock only what's necessary for the test
- Fast execution (no I/O when possible)
- Explicit dependencies

### Pattern:

```typescript
import { OxigraphStoreManager } from '../../../src/lib/OxigraphStoreManager.js';
import { ExecutorFactory } from '../../../src/lib/orchestration/ExecutorFactory.js';

describe('ExecutorFactory', () => {
  it('should create Oxigraph executor with provided store manager', async () => {
    // Create LOCAL instance for test isolation
    const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'unit-test-'));
    const storeManager = new OxigraphStoreManager(testDir);
    await storeManager.initialize();

    // Inject dependencies explicitly
    const executorFactory = new ExecutorFactory(storeManager); // Hypothetical API

    // Test...

    // Cleanup (won't affect other tests)
    await fs.rm(testDir, { recursive: true });
  });
});
```

### Benefits:
- **Test isolation:** Each test has its own store manager
- **No global state:** Tests can run in parallel
- **Faster:** Can use in-memory stores
- **Clearer dependencies:** Explicit what the test needs

### Implementation Notes:

To support this pattern, components like `ExecutorFactory` should accept optional dependencies:

```typescript
export class ExecutorFactory {
  constructor(
    private readonly storeManager = oxigraphStoreManager  // Default to singleton
  ) {}

  async createOxigraphExecutor(backend: Backend) {
    // Use injected storeManager instead of import
    const store = await this.storeManager.createPersistentStore(...);
    return new OxigraphSparqlExecutor(store);
  }
}
```

Similarly for `ExecutionEngine`:

```typescript
export class ExecutionEngine {
  constructor(
    private readonly executorFactory = new ExecutorFactory(),  // Default
    private readonly parser = new SparqlQueryParser()
  ) {}
}
```

This allows:
- **Production:** Use defaults (singletons)
- **Integration tests:** Use defaults (but reconfigure via `initialize()`)
- **Unit tests:** Inject test-specific instances

---

## Pattern C: Mocked Unit Tests

**Use Case:** Testing logic in isolation with mocked dependencies

**Example:** Testing edge validation without real backends

### Pattern:

```typescript
describe('GraphBuilder validation', () => {
  it('should reject CONTROL_FLOW edges with I/O references', () => {
    // Serve a fake coordinator (see "Module isolation" below for why not vi.mock)
    overrideCacheCoordinatorProvider({
      getCacheCoordinator: () => ({
        get: vi.fn((id) => mockEntities[id]),
        list: vi.fn(),
      }),
    });

    const builder = new GraphBuilder();
    // Test validation logic
    expect(() => builder.validateEdge(invalidEdge)).toThrow();
  });
});
```

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

---

## When to Use Each Pattern

| Pattern | Use Case | Speed | Isolation | Prod-Like |
|---------|----------|-------|-----------|-----------|
| **A: Scenario/Integration** | E2E workflows, query execution | Slow | Low | High |
| **B: Unit (DI)** | Class behavior, algorithms | Fast | High | Medium |
| **C: Unit (Mock)** | Logic validation, edge cases | Very Fast | Very High | Low |

---

## Migration Path

Currently, the codebase uses:
- ✅ **Pattern A** for integration tests (fixed with `initialize()` support)
- ❌ **Pattern B/C** not yet available (requires dependency injection refactor)

Future work:
1. Add optional constructor parameters to key classes
2. Create unit test examples using Pattern B
3. Document mocking strategies for Pattern C
