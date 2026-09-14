/**
 * ExecutorFactory wiring for `oxigraphMemory` backends, and the save hook
 * that keeps head-tracking stores current.
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

vi.mock('../../src/server/config.js', () => ({
  config: {
    internalBackend: {
      type: 'http',
      baseUrl: 'http://internal',
      queryUrl: 'http://internal/query',
      updateUrl: 'http://internal/update',
    },
  },
}));

const { ExecutorFactory } = await import('../../src/lib/orchestration/ExecutorFactory.js');
const { oxigraphStoreManager } = await import('../../src/lib/OxigraphStoreManager.js');
const { ReadOnlyBackendError } = await import('../../src/server/ReadOnlySparqlExecutor.js');
const { BackendTypeIri } = await import('../../src/persistence/schemas/BackendSchema.js');

const TURTLE = `@prefix ex: <http://example.org/> .
ex:a ex:knows ex:b .
ex:b ex:knows ex:c .
`;

function registerBackend(id: string, oxigraphConfig: Record<string, unknown> | string) {
  hoisted.entities.set(id, {
    $id: id,
    '@type': 'Backend',
    name: id,
    backendType: BackendTypeIri.oxigraphMemory,
    oxigraphConfig,
  });
}

describe('ExecutorFactory - oxigraphMemory backends', () => {
  let tempDir: string;

  beforeEach(async () => {
    hoisted.entities.clear();
    hoisted.entities.set('v1', {
      $id: 'v1',
      '@type': 'DataGraphVersion',
      isPartOf: 'g1',
      contentString: TURTLE,
      contentFormat: 'text/turtle',
      tripleCount: 2,
    });
    hoisted.entities.set('g1', { $id: 'g1', '@type': 'DataGraph', name: 'g1', currentVersion: 'v1' });

    tempDir = path.join('/tmp', `oxi-exec-test-${process.pid}-${Math.random().toString(16).slice(2)}`);
    await oxigraphStoreManager.initialize(tempDir);
  });

  afterEach(async () => {
    await oxigraphStoreManager.shutdown();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it('serves queries from a store hydrated from the backend sources', async () => {
    registerBackend('b-ro', { storeType: 'ephemeral', mode: 'readOnly', sources: [{ dataGraphVersionId: 'v1' }] });

    const exec = await new ExecutorFactory().getExecutorForBackendId('b-ro');
    const { result } = await exec.selectQueryParsed('SELECT ?s WHERE { ?s ?p ?o }');

    expect((result as { results: { bindings: unknown[] } }).results.bindings.length).toBe(2);
  });

  it('hydrates a backend whose persisted configuration is a JSON string', async () => {
    registerBackend('b-persisted', JSON.stringify({
      storeType: 'ephemeral', mode: 'readOnly', sources: [{ dataGraphVersionId: 'v1' }],
    }));

    const exec = await new ExecutorFactory().getExecutorForBackendId('b-persisted');
    const { result } = await exec.selectQueryParsed('SELECT ?s WHERE { ?s ?p ?o }');

    expect((result as { results: { bindings: unknown[] } }).results.bindings.length).toBe(2);
  });

  it('reads the mode out of a persisted configuration rather than defaulting it', async () => {
    // The string form is the one a restarted store hands back, and a reader
    // that reached for `.mode` on it found `undefined` and fell back to
    // read-only — a writable backend that silently refused writes.
    registerBackend('b-persisted-rw', JSON.stringify({
      storeType: 'ephemeral', mode: 'ephemeral', sources: [{ dataGraphVersionId: 'v1' }],
    }));

    const exec = await new ExecutorFactory().getExecutorForBackendId('b-persisted-rw');
    await exec.update('INSERT DATA { <http://example.org/x> <http://example.org/y> <http://example.org/z> }');

    const { result } = await exec.selectQueryParsed('SELECT ?s WHERE { ?s ?p ?o }');
    expect((result as { results: { bindings: unknown[] } }).results.bindings.length).toBe(3);
  });

  it('refuses to build an executor over an unreadable configuration', async () => {
    // The literal a pre-fix write left behind. Hydrating an empty store from
    // it would answer every query with nothing at all, so this says so.
    registerBackend('b-mangled', '[object Object]');

    await expect(new ExecutorFactory().getExecutorForBackendId('b-mangled'))
      .rejects.toThrow(/unreadable oxigraphConfig/);
  });

  it('refuses updates against a read-only backend', async () => {
    registerBackend('b-ro2', { storeType: 'ephemeral', mode: 'readOnly', sources: [{ dataGraphVersionId: 'v1' }] });

    const exec = await new ExecutorFactory().getExecutorForBackendId('b-ro2');

    await expect(
      exec.update('INSERT DATA { <http://example.org/x> <http://example.org/y> <http://example.org/z> }'),
    ).rejects.toBeInstanceOf(ReadOnlyBackendError);
  });

  it('defaults a backend with no mode to read-only', async () => {
    // An under-specified memory backend is pointed at library data; accepting
    // writes that vanish on the next reload is the worse reading.
    registerBackend('b-default', { storeType: 'ephemeral', sources: [{ dataGraphVersionId: 'v1' }] });

    const exec = await new ExecutorFactory().getExecutorForBackendId('b-default');

    await expect(exec.update('DELETE WHERE { ?s ?p ?o }')).rejects.toBeInstanceOf(ReadOnlyBackendError);
  });

  it('allows updates against an ephemeral backend', async () => {
    registerBackend('b-rw', { storeType: 'ephemeral', mode: 'ephemeral', sources: [{ dataGraphVersionId: 'v1' }] });

    const exec = await new ExecutorFactory().getExecutorForBackendId('b-rw');
    await exec.update('INSERT DATA { <http://example.org/x> <http://example.org/y> <http://example.org/z> }');

    const { result } = await exec.selectQueryParsed('SELECT ?s WHERE { ?s ?p ?o }');
    expect((result as { results: { bindings: unknown[] } }).results.bindings.length).toBe(3);
  });

  it('does not serve a stale store after an invalidation', async () => {
    // The factory deliberately does not cache memory executors: some factories
    // are long-lived, and a cached one would keep querying the replaced store.
    registerBackend('b-track', { storeType: 'ephemeral', mode: 'readOnly', sources: [{ dataGraphId: 'g1' }] });
    const factory = new ExecutorFactory();

    const before = await factory.getExecutorForBackendId('b-track');
    expect(
      ((await before.selectQueryParsed('SELECT ?s WHERE { ?s ?p ?o }')).result as {
        results: { bindings: unknown[] };
      }).results.bindings.length,
    ).toBe(2);

    hoisted.entities.set('v2', {
      $id: 'v2',
      '@type': 'DataGraphVersion',
      isPartOf: 'g1',
      contentString: `${TURTLE}<http://example.org/c> <http://example.org/knows> <http://example.org/d> .\n`,
      contentFormat: 'text/turtle',
      tripleCount: 3,
    });
    hoisted.entities.set('g1', { $id: 'g1', '@type': 'DataGraph', name: 'g1', currentVersion: 'v2' });
    await oxigraphStoreManager.invalidateStoresTrackingDataGraph('g1');

    const after = await factory.getExecutorForBackendId('b-track');
    expect(
      ((await after.selectQueryParsed('SELECT ?s WHERE { ?s ?p ?o }')).result as {
        results: { bindings: unknown[] };
      }).results.bindings.length,
    ).toBe(3);
  });

  it('surfaces an unresolvable source as an error rather than an empty dataset', async () => {
    registerBackend('b-broken', { storeType: 'ephemeral', mode: 'readOnly', sources: [{ dataGraphVersionId: 'gone' }] });

    await expect(new ExecutorFactory().getExecutorForBackendId('b-broken')).rejects.toThrow(/not found/);
  });
});
