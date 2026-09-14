import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';

// We will import these after setting envs via dynamic import
let memoryCacheManager: any;
let oxigraphStoreManager: any;

const resetAndImport = async () => {
  vi.resetModules();
  const lib = await import('../../src/lib/MemoryCacheManager.js');
  const storeMgr = await import('../../src/lib/OxigraphStoreManager.js');
  memoryCacheManager = lib.memoryCacheManager;
  oxigraphStoreManager = storeMgr.oxigraphStoreManager;
};

/**
 * Tests for durable (serializable) Oxigraph stores.
 *
 * NOTE: Oxigraph JS only supports in-memory stores. "Durable" stores are
 * serialized to .nq files on shutdown and restored on startup.
 * This is NOT true disk-backed persistence like RocksDB.
 */
describe('Durable library cache with Oxigraph', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `sqlib-durable-${Date.now()}`);
    await fs.mkdir(tmpDir, { recursive: true });

    process.env.INTERNAL_BACKEND_TYPE = 'oxigraph-persistent';
    process.env.LIBRARY_STORAGE_DIR = tmpDir;
    // Note: INTERNAL_OXIGRAPH_DB_PATH is deprecated and ignored
    // Serialization happens to .nq files in LIBRARY_STORAGE_DIR
    delete process.env.INTERNAL_OXIGRAPH_DB_PATH;
    delete process.env.INTERNAL_OXIGRAPH_LOAD_METHOD; // default none

    await resetAndImport();
  });

  afterEach(async () => {
    // Attempt clean shutdown of store manager and remove temp dir
    try { await oxigraphStoreManager.shutdown(); } catch {}
    try { await fs.rm(tmpDir, { recursive: true, force: true }); } catch {}
    delete process.env.INTERNAL_BACKEND_TYPE;
    delete process.env.LIBRARY_STORAGE_DIR;
    delete process.env.INTERNAL_OXIGRAPH_DB_PATH;
  });

  it('should CRUD Library entities against a durable Oxigraph store', async () => {
    await memoryCacheManager.loadAll();

    // Create
    const id = 'urn:sqlib:test:library:1';
    const created = await memoryCacheManager.create({ $id: id, name: 'Lib A' }, 'Library');
    expect(created.$id).toBe(id);

    // Read
    const fetched = memoryCacheManager.get(id);
    expect(fetched && (fetched as any).name).toBe('Lib A');

    // Update
    const updated = await memoryCacheManager.update(id, { description: 'desc' }, 'Library');
    expect(updated && (updated as any).description).toBe('desc');

    // Ensure store has some triples
    // Note: Stats are only updated on explicit load/serialize, so check the store directly
    const store = oxigraphStoreManager.getDurableStore('library-store');
    expect(store).not.toBeNull();
    expect(store!.size).toBeGreaterThan(0);

    // Delete
    await memoryCacheManager.delete(id, 'Library');
    const afterDelete = memoryCacheManager.get(id);
    expect(afterDelete).toBeNull();
  });
});
