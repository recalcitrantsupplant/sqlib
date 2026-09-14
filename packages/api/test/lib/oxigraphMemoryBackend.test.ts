/**
 * In-memory Oxigraph backends hydrated from data graphs.
 *
 * These run against a real Oxigraph store rather than a mock — the point of the
 * feature is that library content ends up queryable in-process, and a mocked
 * store could not tell us whether it did.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';

const hoisted = vi.hoisted(() => ({
  entities: new Map<string, Record<string, unknown>>(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    get: (id: string) => hoisted.entities.get(id) ?? null,
  }),
}));

const { OxigraphStoreManager } = await import('../../src/lib/OxigraphStoreManager.js');
const { hydrateStoreFromDataGraphs, classifyDataGraphSource, resolveDataGraphSource } = await import(
  '../../src/lib/dataGraphHydration.js'
);
const { ReadOnlySparqlExecutor, ReadOnlyBackendError } = await import(
  '../../src/server/ReadOnlySparqlExecutor.js'
);
const { OxigraphSparqlExecutor } = await import('../../src/server/OxigraphSparqlExecutor.js');
const oxigraph = await import('oxigraph');

const TURTLE = `@prefix ex: <http://example.org/> .
ex:a ex:knows ex:b .
ex:b ex:knows ex:c .
`;

const TURTLE_V2 = `@prefix ex: <http://example.org/> .
ex:a ex:knows ex:b .
ex:b ex:knows ex:c .
ex:c ex:knows ex:d .
`;

function registerVersion(id: string, graphId: string, content: string, tripleCount: number) {
  hoisted.entities.set(id, {
    $id: id,
    '@type': 'DataGraphVersion',
    isPartOf: graphId,
    contentString: content,
    contentFormat: 'text/turtle',
    tripleCount,
  });
}

function registerGraph(id: string, currentVersion: string | null) {
  hoisted.entities.set(id, {
    $id: id,
    '@type': 'DataGraph',
    name: id,
    currentVersion,
  });
}

describe('data graph source classification', () => {
  it('rejects a source that names both a pinned version and a tracked graph', () => {
    // The two mean different sync behaviours, so a config asking for both is one
    // whose author has not decided — guessing would bake in the wrong answer.
    expect(() =>
      classifyDataGraphSource({ dataGraphVersionId: 'v1', dataGraphId: 'g1' }),
    ).toThrow(/not both/);
  });

  it('rejects a source that names neither', () => {
    expect(() => classifyDataGraphSource({})).toThrow(/requires either/);
  });

  it('reports pinned and tracked sources distinctly', () => {
    expect(classifyDataGraphSource({ dataGraphVersionId: 'v1' })).toEqual({ tracked: false, id: 'v1' });
    expect(classifyDataGraphSource({ dataGraphId: 'g1' })).toEqual({ tracked: true, id: 'g1' });
  });
});

describe('resolving data graph sources', () => {
  beforeEach(() => {
    hoisted.entities.clear();
    registerVersion('v1', 'g1', TURTLE, 2);
    registerGraph('g1', 'v1');
  });

  it('resolves a pinned version to its exact content', () => {
    const resolved = resolveDataGraphSource({ dataGraphVersionId: 'v1' });
    expect(resolved.versionId).toBe('v1');
    expect(resolved.tracked).toBe(false);
    expect(resolved.dataGraphId).toBeUndefined();
    expect(resolved.content).toBe(TURTLE);
  });

  it('resolves a tracked graph through its current version', () => {
    const resolved = resolveDataGraphSource({ dataGraphId: 'g1' });
    expect(resolved.versionId).toBe('v1');
    expect(resolved.tracked).toBe(true);
    expect(resolved.dataGraphId).toBe('g1');
  });

  it('follows the head after a new version is saved', () => {
    registerVersion('v2', 'g1', TURTLE_V2, 3);
    registerGraph('g1', 'v2');
    expect(resolveDataGraphSource({ dataGraphId: 'g1' }).versionId).toBe('v2');
  });

  it('errors rather than hydrating nothing when a tracked graph has no version', () => {
    // Silently loading nothing would present a config mistake as an empty dataset.
    registerGraph('g-empty', null);
    expect(() => resolveDataGraphSource({ dataGraphId: 'g-empty' })).toThrow(/no saved version/);
  });

  it('errors on an unknown version id', () => {
    expect(() => resolveDataGraphSource({ dataGraphVersionId: 'nope' })).toThrow(/not found/);
  });

  it('errors on an unknown data graph id', () => {
    expect(() => resolveDataGraphSource({ dataGraphId: 'nope' })).toThrow(/not found/);
  });
});

describe('hydrating a store', () => {
  beforeEach(() => {
    hoisted.entities.clear();
    registerVersion('v1', 'g1', TURTLE, 2);
    registerGraph('g1', 'v1');
  });

  it('loads pinned content into the store and reports what it loaded', () => {
    const store = new oxigraph.Store();
    const result = hydrateStoreFromDataGraphs(store, [{ dataGraphVersionId: 'v1' }]);

    expect(store.size).toBe(2);
    expect(result.quadsLoaded).toBe(2);
    expect(result.trackedDataGraphIds).toEqual([]);
  });

  it('records the data graphs whose head it follows', () => {
    const store = new oxigraph.Store();
    const result = hydrateStoreFromDataGraphs(store, [{ dataGraphId: 'g1' }]);

    expect(result.trackedDataGraphIds).toEqual(['g1']);
    expect(store.size).toBe(2);
  });

  it('merges multiple sources in order', () => {
    registerVersion('v-extra', 'g2', '@prefix ex: <http://example.org/> .\nex:c ex:knows ex:d .\n', 1);
    const store = new oxigraph.Store();
    hydrateStoreFromDataGraphs(store, [{ dataGraphVersionId: 'v1' }, { dataGraphVersionId: 'v-extra' }]);
    expect(store.size).toBe(3);
  });

  it('loads a source into a named graph when asked', () => {
    const store = new oxigraph.Store();
    hydrateStoreFromDataGraphs(store, [
      { dataGraphVersionId: 'v1', namedGraph: 'http://example.org/graphs/one' },
    ]);

    const inNamed = store.match(null, null, null, oxigraph.namedNode('http://example.org/graphs/one'));
    expect(inNamed.length).toBe(2);
    expect(store.match(null, null, null, oxigraph.defaultGraph()).length).toBe(0);
  });

  it('makes hydrated content queryable', () => {
    const store = new oxigraph.Store();
    hydrateStoreFromDataGraphs(store, [{ dataGraphVersionId: 'v1' }]);
    const rows = store.query('SELECT ?o WHERE { <http://example.org/a> <http://example.org/knows> ?o }');
    expect(Array.isArray(rows) && rows.length).toBe(1);
  });

  it('treats no sources as an empty hydration rather than an error', () => {
    const store = new oxigraph.Store();
    expect(hydrateStoreFromDataGraphs(store, undefined).quadsLoaded).toBe(0);
  });
});

describe('OxigraphStoreManager memory stores', () => {
  let storeManager: InstanceType<typeof OxigraphStoreManager>;
  let tempDir: string;

  beforeEach(async () => {
    hoisted.entities.clear();
    registerVersion('v1', 'g1', TURTLE, 2);
    registerGraph('g1', 'v1');

    tempDir = path.join('/tmp', `oxigraph-memory-test-${process.pid}-${Math.random().toString(16).slice(2)}`);
    storeManager = new OxigraphStoreManager(tempDir);
    await storeManager.initialize();
  });

  afterEach(async () => {
    await storeManager.shutdown();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('hydrates a read-only store from pinned sources', async () => {
    const store = await storeManager.createMemoryStore('backend-ro', {
      storeType: 'ephemeral',
      mode: 'readOnly',
      sources: [{ dataGraphVersionId: 'v1' }],
    });

    expect(store.size).toBe(2);
    expect(storeManager.getMemoryStoreMode('backend-ro')).toBe('readOnly');
    expect(storeManager.getStoreStats('backend-ro')?.hydratedQuads).toBe(2);
  });

  it('defaults an unspecified mode to read-only', async () => {
    await storeManager.createMemoryStore('backend-default', {
      storeType: 'ephemeral',
      sources: [{ dataGraphVersionId: 'v1' }],
    });
    expect(storeManager.getMemoryStoreMode('backend-default')).toBe('readOnly');
  });

  it('returns the same store on a second call rather than re-hydrating', async () => {
    const first = await storeManager.createMemoryStore('backend-reuse', {
      storeType: 'ephemeral',
      sources: [{ dataGraphVersionId: 'v1' }],
    });
    const second = await storeManager.createMemoryStore('backend-reuse', {
      storeType: 'ephemeral',
      sources: [{ dataGraphVersionId: 'v1' }],
    });
    expect(second).toBe(first);
    expect(second.size).toBe(2);
  });

  it('deduplicates concurrent creation', async () => {
    const [a, b] = await Promise.all([
      storeManager.createMemoryStore('backend-concurrent', {
        storeType: 'ephemeral',
        sources: [{ dataGraphVersionId: 'v1' }],
      }),
      storeManager.createMemoryStore('backend-concurrent', {
        storeType: 'ephemeral',
        sources: [{ dataGraphVersionId: 'v1' }],
      }),
    ]);
    expect(a).toBe(b);
    expect(a.size).toBe(2);
  });

  it('does not cache a store whose hydration failed', async () => {
    // An empty "reference dataset" is a silent wrong answer; a throw is fixable.
    await expect(
      storeManager.createMemoryStore('backend-bad', {
        storeType: 'ephemeral',
        sources: [{ dataGraphVersionId: 'missing' }],
      }),
    ).rejects.toThrow(/not found/);

    expect(storeManager.getMemoryStore('backend-bad')).toBeNull();
    expect(storeManager.getStoresTrackingDataGraph('g1')).not.toContain('backend-bad');
  });

  describe('tracked sources', () => {
    it('invalidates stores following a graph whose head moved', async () => {
      await storeManager.createMemoryStore('backend-tracked', {
        storeType: 'ephemeral',
        mode: 'readOnly',
        sources: [{ dataGraphId: 'g1' }],
      });
      expect(storeManager.getStoresTrackingDataGraph('g1')).toEqual(['backend-tracked']);

      const affected = await storeManager.invalidateStoresTrackingDataGraph('g1');

      expect(affected).toEqual(['backend-tracked']);
      expect(storeManager.getMemoryStore('backend-tracked')).toBeNull();
    });

    it('leaves pinned stores alone when a graph is saved', async () => {
      // Pinned sources name an immutable version, so nothing about them changed.
      await storeManager.createMemoryStore('backend-pinned', {
        storeType: 'ephemeral',
        sources: [{ dataGraphVersionId: 'v1' }],
      });

      const affected = await storeManager.invalidateStoresTrackingDataGraph('g1');

      expect(affected).toEqual([]);
      expect(storeManager.getMemoryStore('backend-pinned')).not.toBeNull();
    });

    it('picks up the new version when rebuilt after invalidation', async () => {
      const config = {
        storeType: 'ephemeral' as const,
        mode: 'readOnly' as const,
        sources: [{ dataGraphId: 'g1' }],
      };
      const before = await storeManager.createMemoryStore('backend-rebuild', config);
      expect(before.size).toBe(2);

      registerVersion('v2', 'g1', TURTLE_V2, 3);
      registerGraph('g1', 'v2');
      await storeManager.invalidateStoresTrackingDataGraph('g1');

      const after = await storeManager.createMemoryStore('backend-rebuild', config);
      expect(after.size).toBe(3);
      expect(after).not.toBe(before);
    });
  });

  it('rebuilds when a tracked graph is saved mid-hydration', async () => {
    // Hydration is async, so a save can land between reading the head and
    // the store being registered. Without the epoch re-check the store would
    // be born stale and stay that way until something else invalidated it.
    const config = {
      storeType: 'ephemeral' as const,
      mode: 'readOnly' as const,
      sources: [{ dataGraphId: 'g1' }],
    };

    let savedDuringFirstLoad = false;
    const realGet = hoisted.entities.get.bind(hoisted.entities);
    const spy = vi.spyOn(hoisted.entities, 'get').mockImplementation((id: string) => {
      const value = realGet(id);
      if (id === 'v1' && !savedDuringFirstLoad) {
        savedDuringFirstLoad = true;
        // Simulate a save completing while this hydration is in flight.
        registerVersion('v2', 'g1', TURTLE_V2, 3);
        registerGraph('g1', 'v2');
        void storeManager.invalidateStoresTrackingDataGraph('g1');
      }
      return value;
    });

    try {
      const store = await storeManager.createMemoryStore('backend-race', config);
      expect(store.size).toBe(3);
    } finally {
      spy.mockRestore();
    }
  });

  describe('durable mode', () => {
    const durableConfig = {
      storeType: 'durable' as const,
      mode: 'durable' as const,
      sources: [{ dataGraphVersionId: 'v1' }],
    };

    it('seeds from data graphs on first boot', async () => {
      const store = await storeManager.createMemoryStore('backend-durable', durableConfig);
      expect(store.size).toBe(2);
    });

    it('restores from disk and does not re-apply the seed', async () => {
      // Seed, not mirror: once the store has its own disk state, that state is
      // the truth and drift from the seed graphs is expected.
      const first = await storeManager.createMemoryStore('backend-durable', durableConfig);
      first.update(
        'INSERT DATA { <http://example.org/local> <http://example.org/added> <http://example.org/here> }',
      );
      first.delete(
        oxigraph.quad(
          oxigraph.namedNode('http://example.org/a'),
          oxigraph.namedNode('http://example.org/knows'),
          oxigraph.namedNode('http://example.org/b'),
        ),
      );
      expect(first.size).toBe(2);

      await storeManager.serializeDurableStore('backend-durable');
      await storeManager.invalidateMemoryStore('backend-durable');

      const restored = await storeManager.createMemoryStore('backend-durable', durableConfig);

      // The locally added quad survived and the locally deleted seed quad did
      // not come back — the seed was not re-applied over the disk state.
      expect(restored.size).toBe(2);
      expect(
        restored.match(
          oxigraph.namedNode('http://example.org/local'),
          null,
          null,
          oxigraph.defaultGraph(),
        ).length,
      ).toBe(1);
      expect(
        restored.match(
          oxigraph.namedNode('http://example.org/a'),
          null,
          null,
          oxigraph.defaultGraph(),
        ).length,
      ).toBe(0);
    });

    it('serializes before dropping the store on invalidation', async () => {
      const store = await storeManager.createMemoryStore('backend-durable-save', durableConfig);
      store.update(
        'INSERT DATA { <http://example.org/x> <http://example.org/y> <http://example.org/z> }',
      );

      // No explicit serialize call: invalidation must save a durable store
      // itself, or the write is lost.
      await storeManager.invalidateMemoryStore('backend-durable-save');
      const restored = await storeManager.createMemoryStore('backend-durable-save', durableConfig);

      expect(
        restored.match(oxigraph.namedNode('http://example.org/x'), null, null, oxigraph.defaultGraph())
          .length,
      ).toBe(1);
    });
  });
});

describe('ReadOnlySparqlExecutor', () => {
  function build() {
    const store = new oxigraph.Store();
    store.load(TURTLE, { format: 'text/turtle' });
    return new ReadOnlySparqlExecutor(new OxigraphSparqlExecutor(store), 'backend-ro');
  }

  it('passes reads through', async () => {
    const exec = build();
    const { result } = await exec.selectQueryParsed('SELECT ?s WHERE { ?s ?p ?o }');
    expect((result as { results: { bindings: unknown[] } }).results.bindings.length).toBe(2);
  });

  it('passes ASK through', async () => {
    const exec = build();
    const { result } = await exec.askQuery('ASK { ?s ?p ?o }');
    expect(result).toBe(true);
  });

  it('rejects updates rather than accepting one that would be discarded', async () => {
    const exec = build();
    await expect(
      exec.update('INSERT DATA { <http://example.org/a> <http://example.org/b> <http://example.org/c> }'),
    ).rejects.toBeInstanceOf(ReadOnlyBackendError);
  });

  it('reports a refusal as 403 rather than a server error', async () => {
    const exec = build();
    await expect(exec.update('DELETE WHERE { ?s ?p ?o }')).rejects.toMatchObject({
      statusCode: 403,
      backendId: 'backend-ro',
    });
  });

  it('leaves the store untouched after a rejected update', async () => {
    const store = new oxigraph.Store();
    store.load(TURTLE, { format: 'text/turtle' });
    const exec = new ReadOnlySparqlExecutor(new OxigraphSparqlExecutor(store), 'backend-ro');

    await exec.update('DELETE WHERE { ?s ?p ?o }').catch(() => {});

    expect(store.size).toBe(2);
  });
});
