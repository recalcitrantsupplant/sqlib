import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as oxigraph from 'oxigraph';
import {
  MAX_STRING_LENGTH,
  StoreSnapshotError,
  restoreStoreFromSnapshot,
  writeStoreSnapshot,
  type SnapshotStore,
} from '../../src/lib/storeSnapshot.js';

/**
 * The snapshot is the whole of a durable store's durability, so these pin the
 * two things that decide whether it survives a restart: what the parser is
 * handed (bytes, never a string), and what happens when a snapshot exists and
 * cannot be used (loud, and the file left where it is).
 *
 * The size the read half is really about — over 512 MiB — is not exercised
 * here: reproducing it costs a 578 MB file and ~70 s of parsing. What is
 * checked instead is the property that removes the ceiling, which is the one a
 * later edit could quietly undo.
 */
describe('storeSnapshot', () => {
  let tempDir: string;
  let snapshotPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'store-snapshot-'));
    snapshotPath = path.join(tempDir, 'backend.nq');
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /** Records what `load` was given, so the test can say "bytes, not a string". */
  function recordingStore(): SnapshotStore & { loaded: unknown[] } {
    return {
      loaded: [] as unknown[],
      size: 0,
      load(input: string | Uint8Array) {
        this.loaded.push(input);
      },
      dump() {
        return '';
      },
    };
  }

  describe('restoreStoreFromSnapshot', () => {
    it('hands the parser bytes rather than a string', async () => {
      // The regression this module exists for: read as `utf8`, a snapshot over
      // V8's 512 MiB string limit throws before oxigraph is reached at all.
      await fs.writeFile(snapshotPath, '<http://a> <http://b> <http://c> <http://g> .\n');
      const store = recordingStore();

      const result = await restoreStoreFromSnapshot(store, snapshotPath);

      expect(result.restored).toBe(true);
      expect(store.loaded).toHaveLength(1);
      expect(store.loaded[0]).toBeInstanceOf(Uint8Array);
      expect(typeof store.loaded[0]).not.toBe('string');
    });

    it('loads a real snapshot into a real store', async () => {
      await fs.writeFile(
        snapshotPath,
        '<http://a> <http://b> <http://c> <http://g> .\n<http://a> <http://b> "lit" .\n',
      );
      const store = new oxigraph.Store();

      const result = await restoreStoreFromSnapshot(store, snapshotPath);

      expect(result).toMatchObject({ restored: true, quads: 2 });
      expect(store.size).toBe(2);
    });

    it('reports no snapshot when the file does not exist', async () => {
      const store = new oxigraph.Store();

      const result = await restoreStoreFromSnapshot(store, snapshotPath);

      expect(result).toMatchObject({ restored: false, bytes: 0 });
      expect(store.size).toBe(0);
    });

    it('reports no snapshot when the file holds only whitespace', async () => {
      await fs.writeFile(snapshotPath, '\n  \n\t\n');
      const store = new oxigraph.Store();

      const result = await restoreStoreFromSnapshot(store, snapshotPath);

      expect(result.restored).toBe(false);
      expect(store.size).toBe(0);
    });

    it('throws rather than starting empty when the snapshot cannot be read', async () => {
      // A directory where the snapshot should be: it exists, and reading it
      // fails with something that is not ENOENT.
      await fs.mkdir(snapshotPath);
      const store = new oxigraph.Store();

      await expect(restoreStoreFromSnapshot(store, snapshotPath)).rejects.toBeInstanceOf(
        StoreSnapshotError,
      );
    });

    it('throws on an unparseable snapshot and leaves it on disk', async () => {
      await fs.writeFile(snapshotPath, 'this is not n-quads\n');
      const store = new oxigraph.Store();

      await expect(restoreStoreFromSnapshot(store, snapshotPath)).rejects.toThrow(
        /Failed to parse store snapshot/,
      );
      // The bytes are still there to be recovered by hand — the point of
      // refusing rather than starting fresh.
      expect(await fs.readFile(snapshotPath, 'utf8')).toBe('this is not n-quads\n');
    });
  });

  describe('writeStoreSnapshot', () => {
    it('round-trips a store through the file', async () => {
      const store = new oxigraph.Store();
      store.load('<http://a> <http://b> <http://c> <http://g> .', { format: 'nq' });

      const written = await writeStoreSnapshot(store, snapshotPath);
      expect(written.quads).toBe(1);

      const restored = new oxigraph.Store();
      await restoreStoreFromSnapshot(restored, snapshotPath);
      expect(restored.size).toBe(1);
    });

    it('writes an empty store, because an emptied store is a state', async () => {
      const store = new oxigraph.Store();

      await writeStoreSnapshot(store, snapshotPath);

      expect(await fs.readFile(snapshotPath, 'utf8')).toBe('');
    });

    it('leaves no temp file behind', async () => {
      const store = new oxigraph.Store();
      store.load('<http://a> <http://b> <http://c> .', { format: 'nq' });

      await writeStoreSnapshot(store, snapshotPath);

      expect(await fs.readdir(tempDir)).toEqual(['backend.nq']);
    });

    it('keeps the previous snapshot when the dump traps, and says why', async () => {
      // Past the string limit `dump` traps inside wasm with
      // `RuntimeError: unreachable`, which on its own tells an operator
      // nothing. The store survives; the checkpoint is what is lost.
      await fs.writeFile(snapshotPath, '<http://a> <http://b> <http://c> .\n');
      const trapping: SnapshotStore = {
        size: 9_000_000,
        load() {},
        dump() {
          throw new WebAssembly.RuntimeError('unreachable');
        },
      };

      await expect(writeStoreSnapshot(trapping, snapshotPath)).rejects.toThrow(
        new RegExp(`${MAX_STRING_LENGTH}-character limit`),
      );
      expect(await fs.readFile(snapshotPath, 'utf8')).toBe('<http://a> <http://b> <http://c> .\n');
      expect(await fs.readdir(tempDir)).toEqual(['backend.nq']);
    });

    it('leaves the previous snapshot intact when the write fails', async () => {
      await fs.writeFile(snapshotPath, '<http://a> <http://b> <http://c> .\n');
      const store = new oxigraph.Store();
      store.load('<http://d> <http://e> <http://f> .', { format: 'nq' });

      // A path that cannot be written: the temp file's directory is gone.
      const missing = path.join(tempDir, 'nope', 'backend.nq');
      await expect(writeStoreSnapshot(store, missing)).rejects.toBeInstanceOf(StoreSnapshotError);

      expect(await fs.readFile(snapshotPath, 'utf8')).toBe('<http://a> <http://b> <http://c> .\n');
    });
  });
});
