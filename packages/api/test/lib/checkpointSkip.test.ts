import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { OxigraphStoreManager } from '../../src/lib/OxigraphStoreManager.js';
import { OxigraphSparqlExecutor } from '../../src/server/OxigraphSparqlExecutor.js';

/**
 * The periodic checkpoint's skip (#443).
 *
 * `Store.dump` is synchronous into wasm, so a checkpoint of a store nobody has
 * written is not idle work — it is a stop of the event loop (~107ms at 50,000
 * quads, ~3.7s at a million) to write a file identical to the one on disk.
 *
 * These pin the two halves that make skipping safe: it happens when and only
 * when the store has taken no writes, and it never reaches the paths that mean
 * "save now" — `serializeDurableStore` and `shutdown`.
 */
describe('checkpointAllStores', () => {
  let manager: OxigraphStoreManager;
  let tempDir: string;
  const config = { storeType: 'durable' as const, loadMethod: 'none' as const };

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'checkpoint-skip-'));
    manager = new OxigraphStoreManager(tempDir);
    await manager.initialize();
  });

  afterEach(async () => {
    await manager.shutdown();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /** How many times the manager has actually serialized this backend. */
  function countSerializations(): { calls: () => number; restore: () => void } {
    const spy = vi.spyOn(manager, 'serializeDurableStore');
    return { calls: () => spy.mock.calls.length, restore: () => spy.mockRestore() };
  }

  it('checkpoints a store it has never checkpointed before', async () => {
    await manager.createDurableStore('backend-a', config);
    const spy = countSerializations();

    await manager.checkpointAllStores();

    // No recorded checkpoint means the snapshot may not reflect the store, so
    // the first pass writes rather than assuming.
    expect(spy.calls()).toBe(1);
    spy.restore();
  });

  it('skips a store that has taken no writes since its last checkpoint', async () => {
    await manager.createDurableStore('backend-a', config);
    await manager.checkpointAllStores();
    const spy = countSerializations();

    await manager.checkpointAllStores();
    await manager.checkpointAllStores();

    expect(spy.calls()).toBe(0);
    spy.restore();
  });

  it('checkpoints again after a SPARQL update', async () => {
    const store = await manager.createDurableStore('backend-a', config);
    await manager.checkpointAllStores();
    const spy = countSerializations();

    await new OxigraphSparqlExecutor(store).update(
      'INSERT DATA { <http://a> <http://b> <http://c> }',
    );
    await manager.checkpointAllStores();

    expect(spy.calls()).toBe(1);

    // And settles again once that write is on disk.
    await manager.checkpointAllStores();
    expect(spy.calls()).toBe(1);
    spy.restore();
  });

  it('checkpoints again after a delete that leaves the size unchanged', async () => {
    // The case a `store.size` comparison cannot see, and the reason the skip
    // rests on a write count instead.
    const store = await manager.createDurableStore('backend-a', config);
    const executor = new OxigraphSparqlExecutor(store);
    await executor.update('INSERT DATA { <http://a> <http://b> <http://c> }');
    await manager.checkpointAllStores();
    const sizeBefore = store.size;
    const spy = countSerializations();

    await executor.update(
      'DELETE DATA { <http://a> <http://b> <http://c> } ; ' +
        'INSERT DATA { <http://d> <http://e> <http://f> }',
    );
    expect(store.size).toBe(sizeBefore);

    await manager.checkpointAllStores();
    expect(spy.calls()).toBe(1);
    spy.restore();
  });

  it('checkpoints again after a load through the manager', async () => {
    const store = await manager.createDurableStore('backend-a', config);
    await manager.checkpointAllStores();
    const spy = countSerializations();

    await manager.loadDataFromString(
      store,
      '<http://example.org/s> <http://example.org/p> "o" .',
      'turtle',
    );
    await manager.checkpointAllStores();

    expect(spy.calls()).toBe(1);
    spy.restore();
  });

  it('the skipped store keeps the snapshot the last checkpoint wrote', async () => {
    // What the skip claims is that the file is already right. This is that
    // claim, read off disk rather than off the call count.
    const store = await manager.createDurableStore('backend-a', config);
    await new OxigraphSparqlExecutor(store).update(
      'INSERT DATA { <http://a> <http://b> <http://c> }',
    );
    await manager.checkpointAllStores();

    const snapshotPath = path.join(tempDir, 'backend_a.nq');
    const afterFirst = await fs.readFile(snapshotPath, 'utf8');
    expect(afterFirst).toContain('http://a');

    await manager.checkpointAllStores();

    expect(await fs.readFile(snapshotPath, 'utf8')).toBe(afterFirst);
  });

  it('force checkpoints a store that has taken no writes', async () => {
    await manager.createDurableStore('backend-a', config);
    await manager.checkpointAllStores();
    const spy = countSerializations();

    await manager.checkpointAllStores({ force: true });

    expect(spy.calls()).toBe(1);
    spy.restore();
  });

  it('shutdown serializes every store, skip or no skip', async () => {
    // The safety net the skip rests on: if a write path ever fails to declare
    // itself, a clean exit still puts the store on disk, so the failure costs
    // a redundant write rather than data.
    const store = await manager.createDurableStore('backend-a', config);
    await manager.checkpointAllStores();

    // A write the counter cannot see, standing in for a path that forgot to
    // call `markStoreWritten`.
    store.update('INSERT DATA { <http://x> <http://y> <http://z> }');
    await manager.checkpointAllStores();

    const snapshotPath = path.join(tempDir, 'backend_a.nq');
    expect(await fs.readFile(snapshotPath, 'utf8')).not.toContain('http://x');

    await manager.shutdown();
    expect(await fs.readFile(snapshotPath, 'utf8')).toContain('http://x');
  });

  it('an explicit serializeDurableStore is never skipped', async () => {
    const store = await manager.createDurableStore('backend-a', config);
    await manager.checkpointAllStores();
    store.update('INSERT DATA { <http://x> <http://y> <http://z> }');

    await manager.serializeDurableStore('backend-a');

    const snapshotPath = path.join(tempDir, 'backend_a.nq');
    expect(await fs.readFile(snapshotPath, 'utf8')).toContain('http://x');
  });

  it('reports how long the checkpoint took', async () => {
    // The pause is the whole argument for the skip, so a checkpoint that does
    // not report its duration cannot make that argument on another machine.
    const store = await manager.createDurableStore('backend-a', config);
    await new OxigraphSparqlExecutor(store).update(
      'INSERT DATA { <http://a> <http://b> <http://c> }',
    );
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await manager.checkpointAllStores();

    const lines = log.mock.calls.map(call => String(call[0]));
    expect(lines.some(line => /Checkpointed backend-a: 1 quads in \d+ms/.test(line))).toBe(true);
    log.mockRestore();
  });

  it('drops a store id from the checkpoint record when the store is dropped', async () => {
    // The count belongs to the store object. A store rebuilt under the same id
    // has its own, and must not be measured against the previous one's history.
    const durableMemory = {
      storeType: 'durable' as const,
      mode: 'durable' as const,
      sources: [],
    };
    await manager.createMemoryStore('backend-mem', durableMemory);
    await manager.checkpointAllStores();

    await manager.invalidateMemoryStore('backend-mem');
    await manager.createMemoryStore('backend-mem', durableMemory);
    const spy = countSerializations();

    await manager.checkpointAllStores();

    expect(spy.calls()).toBe(1);
    spy.restore();
  });
});
