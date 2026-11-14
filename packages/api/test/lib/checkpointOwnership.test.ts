import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { OxigraphStoreManager } from '../../src/lib/OxigraphStoreManager.js';
import { OxigraphSparqlExecutor } from '../../src/server/OxigraphSparqlExecutor.js';
import { oxigraphCheckpointIntervalMs, oxigraphStorageDir } from '../../src/lib/oxigraphSettings.js';

/**
 * The manager starts the periodic checkpoint itself (#178).
 *
 * Start-up used to start the loop, and only for the `oxigraph-persistent`
 * library store. A durable backend beside a SQLite library was then written
 * at shutdown only, and a killed process lost each write since start-up.
 *
 * These tests build a manager the way a backend's first use does: with no
 * directory and no call to `startCheckpointing`.
 */
describe('OxigraphStoreManager periodic checkpoint', () => {
  const durableBackend = { storeType: 'ephemeral' as const, mode: 'durable' as const, loadMethod: 'none' as const };
  const libraryStore = { storeType: 'durable' as const, loadMethod: 'none' as const };
  const INSERT = 'INSERT DATA { <http://example.org/a> <http://example.org/b> "written" }';

  let tempDir: string;
  let manager: OxigraphStoreManager;
  const envBefore = {
    dir: process.env.OXIGRAPH_STORAGE_DIR,
    interval: process.env.INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS,
  };

  function setEnv(name: string, value: string | undefined): void {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  /** Wait for a file that holds the text, with no shutdown. */
  async function waitForFile(file: string, text: string, timeoutMs = 3000): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const content = await fs.readFile(file, 'utf8').catch(() => '');
      if (content.includes(text)) return content;
      if (Date.now() > deadline) throw new Error(`No "${text}" in ${file} after ${timeoutMs} ms`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'checkpoint-ownership-'));
    setEnv('OXIGRAPH_STORAGE_DIR', path.join(tempDir, 'oxigraph'));
    setEnv('INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS', '20');
    manager = new OxigraphStoreManager();
  });

  afterEach(async () => {
    await manager.shutdown();
    setEnv('OXIGRAPH_STORAGE_DIR', envBefore.dir);
    setEnv('INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS', envBefore.interval);
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('writes a durable backend to OXIGRAPH_STORAGE_DIR within the interval, when first use initialises the manager', async () => {
    expect(manager.isInitialized()).toBe(false);
    const store = await manager.createMemoryStore('urn:backend:records', durableBackend);
    await new OxigraphSparqlExecutor(store).update(INSERT);

    const file = path.join(tempDir, 'oxigraph', 'urn_backend_records.nq');
    expect(await waitForFile(file, '"written"')).toContain('<http://example.org/a>');
  });

  it('checkpoints a durable store that createDurableStore registers', async () => {
    const store = await manager.createDurableStore('library-store', libraryStore);
    await new OxigraphSparqlExecutor(store).update(INSERT);

    await waitForFile(path.join(tempDir, 'oxigraph', 'library_store.nq'), '"written"');
  });

  it('starts no timer for a store that is not durable', async () => {
    const start = vi.spyOn(manager, 'startCheckpointing');
    await manager.createMemoryStore('urn:backend:scratch', { ...durableBackend, mode: 'ephemeral' });
    await manager.createMemoryStore('urn:backend:reference', { ...durableBackend, mode: 'readOnly' });

    expect(start).not.toHaveBeenCalled();
  });

  it('starts one timer for several durable stores', async () => {
    const start = vi.spyOn(manager, 'startCheckpointing');
    await manager.createMemoryStore('urn:backend:one', durableBackend);
    await manager.createMemoryStore('urn:backend:two', durableBackend);

    expect(start).toHaveBeenCalledTimes(1);
    expect(start).toHaveBeenCalledWith(20);
  });

  it('starts no timer when the interval is 0, and still writes at shutdown', async () => {
    setEnv('INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS', '0');
    const start = vi.spyOn(manager, 'startCheckpointing');
    const store = await manager.createMemoryStore('urn:backend:records', durableBackend);
    await new OxigraphSparqlExecutor(store).update(INSERT);

    expect(start).not.toHaveBeenCalled();
    await manager.shutdown();
    const file = path.join(tempDir, 'oxigraph', 'urn_backend_records.nq');
    expect(await fs.readFile(file, 'utf8')).toContain('"written"');
  });

  it('keeps the library store in its own directory, and the backends in OXIGRAPH_STORAGE_DIR', async () => {
    const libraryDir = path.join(tempDir, 'library');
    await manager.initialize();
    const library = await manager.createPersistentStore('library-store', libraryStore, { storageDir: libraryDir });
    const backend = await manager.createMemoryStore('urn:backend:records', durableBackend);
    await new OxigraphSparqlExecutor(library).update(INSERT);
    await new OxigraphSparqlExecutor(backend).update(INSERT);
    await manager.shutdown();

    expect(await fs.readdir(libraryDir)).toEqual(['library_store.nq']);
    expect(await fs.readdir(path.join(tempDir, 'oxigraph'))).toEqual(['urn_backend_records.nq']);
  });

  it('copies a backend file from an earlier directory when OXIGRAPH_STORAGE_DIR has none', async () => {
    const earlierDir = path.join(tempDir, 'library');
    await fs.mkdir(earlierDir, { recursive: true });
    const earlierFile = path.join(earlierDir, 'urn_backend_records.nq');
    await fs.writeFile(earlierFile, '<http://example.org/a> <http://example.org/b> "earlier" .\n');
    manager.adoptSnapshotsFrom([earlierDir]);

    const store = await manager.createMemoryStore('urn:backend:records', durableBackend);

    expect(store.size).toBe(1);
    const copied = path.join(tempDir, 'oxigraph', 'urn_backend_records.nq');
    expect(await fs.readFile(copied, 'utf8')).toContain('"earlier"');
    // The original stays, so a rollback to the earlier version finds its data.
    expect(await fs.readFile(earlierFile, 'utf8')).toContain('"earlier"');
  });

  it('keeps the file in OXIGRAPH_STORAGE_DIR when an earlier directory also has one', async () => {
    const earlierDir = path.join(tempDir, 'library');
    await fs.mkdir(earlierDir, { recursive: true });
    await fs.mkdir(path.join(tempDir, 'oxigraph'), { recursive: true });
    await fs.writeFile(path.join(earlierDir, 'urn_backend_records.nq'), '<http://example.org/a> <http://example.org/b> "earlier" .\n');
    const current = path.join(tempDir, 'oxigraph', 'urn_backend_records.nq');
    await fs.writeFile(current, '<http://example.org/a> <http://example.org/b> "current" .\n');
    manager.adoptSnapshotsFrom([earlierDir]);

    await manager.createMemoryStore('urn:backend:records', durableBackend);

    expect(await fs.readFile(current, 'utf8')).toContain('"current"');
  });
});

describe('oxigraphSettings', () => {
  it('reads the directory from OXIGRAPH_STORAGE_DIR, with a default', () => {
    expect(oxigraphStorageDir({ OXIGRAPH_STORAGE_DIR: '/data/oxigraph' })).toBe(path.resolve('/data/oxigraph'));
    expect(oxigraphStorageDir({})).toBe(path.resolve('./storage/oxigraph'));
  });

  it('reads the interval, with a default of 60000 and 0 for off', () => {
    expect(oxigraphCheckpointIntervalMs({})).toBe(60000);
    expect(oxigraphCheckpointIntervalMs({ INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS: '' })).toBe(60000);
    expect(oxigraphCheckpointIntervalMs({ INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS: '5000' })).toBe(5000);
    expect(oxigraphCheckpointIntervalMs({ INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS: '0' })).toBe(0);
  });

  it.each(['abc', '-1', '1.5', '60s'])('refuses the interval "%s"', value => {
    expect(() => oxigraphCheckpointIntervalMs({ INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS: value }))
      .toThrow(/INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS/);
  });
});
