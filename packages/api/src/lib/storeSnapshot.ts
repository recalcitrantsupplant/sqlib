/**
 * Reading and writing the `.nq` snapshot a durable Oxigraph store is restored from.
 *
 * One module rather than three copies inside `OxigraphStoreManager`, because the
 * snapshot is the whole of a durable store's durability — the JS bindings hold
 * everything in memory — and both halves of it run into the same limit of the
 * JavaScript runtime: a V8 string cannot exceed `0x1fffffe8` (512 MiB)
 * characters.
 *
 * **The read half is fixable, and is fixed here.** `Store.load` takes
 * `string | Uint8Array` (oxigraph 0.5.11), so the file goes to the parser as
 * bytes and never becomes a JavaScript string at all. Reading it with `utf8`
 * instead put a ceiling on how large a durable store could be and still come
 * back: measured on a 578 MB / 4.3M-quad snapshot, `readFile(path, 'utf8')`
 * throws `Invalid string length` while the same file loads from a `Buffer` in
 * ~67 s.
 *
 * **The write half is not fixable from here.** `Store.dump` returns a string,
 * and past the cap the wasm module traps (`RuntimeError: unreachable`) rather
 * than throwing something a caller can read. So a store can grow to a size it
 * can be restored at but no longer checkpointed at, and the only honest answer
 * is to say so loudly and leave the last good snapshot alone — see
 * `writeStoreSnapshot`.
 *
 * The rule both halves follow: **a snapshot that exists and cannot be used is
 * never treated as a snapshot that is not there.** A missing file means a first
 * boot and an empty store is correct; an unreadable one means the data is still
 * on disk, and starting empty would let the next checkpoint write over it.
 */

import * as fs from 'fs/promises';

/**
 * The store surface these functions need.
 *
 * Structural rather than `oxigraph.Store` so a test can hand in a stub and
 * assert what the parser was given — which is the property that regressed:
 * bytes, not a string.
 */
export interface SnapshotStore {
  readonly size: number;
  load(input: string | Uint8Array, options: { format: string }): void;
  dump(options: { format: string }): string;
}

/**
 * V8's maximum string length, in characters (`String::kMaxLength`).
 *
 * Named here because it is the number behind both halves of this module, and
 * because `buffer.constants.MAX_STRING_LENGTH` reads like a Buffer limit when
 * it is really a limit on every string in the process.
 */
export const MAX_STRING_LENGTH = 0x1fffffe8;

export class StoreSnapshotError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'StoreSnapshotError';
  }
}

/** Is this byte one of the four N-Quads whitespace characters? */
function isWhitespaceByte(byte: number): boolean {
  return byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d;
}

/**
 * Does the snapshot hold anything but whitespace?
 *
 * The string form of this test was `savedData.trim()`, which needs the whole
 * file as a string — the thing this module exists to avoid. Scanning bytes
 * stops at the first non-whitespace one, so the usual answer costs one byte.
 */
function hasContent(bytes: Uint8Array): boolean {
  for (const byte of bytes) {
    if (!isWhitespaceByte(byte)) return true;
  }
  return false;
}

export interface SnapshotRestoreResult {
  /** False only when there is no snapshot yet, or it holds no quads. */
  restored: boolean;
  /** Size of the snapshot on disk, in bytes. */
  bytes: number;
  /** Quads the store holds afterwards. */
  quads: number;
}

/**
 * Load `filePath` into `store`, as bytes.
 *
 * Returns `restored: false` for the one case that is not a fault — no file, so
 * a first boot. Everything else throws: a snapshot that exists and cannot be
 * read or parsed is a fault the operator has to see, because the alternative is
 * a store that comes up empty and a checkpoint that then writes the empty store
 * over the data.
 */
export async function restoreStoreFromSnapshot(
  store: SnapshotStore,
  filePath: string,
): Promise<SnapshotRestoreResult> {
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { restored: false, bytes: 0, quads: store.size };
    }
    throw new StoreSnapshotError(
      `Failed to read store snapshot ${filePath}: ${errorMessage(error)}`,
      error,
    );
  }

  if (!hasContent(bytes)) {
    return { restored: false, bytes: bytes.length, quads: store.size };
  }

  try {
    store.load(bytes, { format: 'nq' });
  } catch (error) {
    throw new StoreSnapshotError(
      `Failed to parse store snapshot ${filePath} (${bytes.length} bytes): ${errorMessage(error)}. ` +
        'The snapshot has been left on disk; move it aside to start from empty.',
      error,
    );
  }

  return { restored: true, bytes: bytes.length, quads: store.size };
}

export interface SnapshotWriteResult {
  /** Size of the snapshot written, in bytes. */
  bytes: number;
  /** Quads it holds. */
  quads: number;
}

/**
 * Serialize `store` to `filePath`.
 *
 * Two things it does not do naively. It never overwrites in place: the dump
 * goes to a sibling temp file and is renamed over the target, so a crash or a
 * full disk mid-write leaves the previous snapshot intact rather than a
 * truncated file that the next boot would refuse to parse.
 *
 * And it translates the ceiling. Past `MAX_STRING_LENGTH` characters of
 * N-Quads, `dump` traps inside wasm with `RuntimeError: unreachable`, which
 * tells an operator nothing about what is wrong or what to do; a store that
 * size needs a real triplestore behind it (oxigraph-server as a sidecar over
 * HTTP) rather than this file. The store itself survives the trap and keeps
 * answering queries — what is lost is the checkpoint, so the message says that
 * the snapshot on disk is now stale rather than wrong.
 */
export async function writeStoreSnapshot(
  store: SnapshotStore,
  filePath: string,
): Promise<SnapshotWriteResult> {
  let nquads: string;
  try {
    nquads = store.dump({ format: 'nq' });
  } catch (error) {
    throw new StoreSnapshotError(
      `Failed to serialize store to ${filePath}: ${errorMessage(error)}. ` +
        `A store of ${store.size} quads may exceed the ${MAX_STRING_LENGTH}-character limit on a ` +
        'JavaScript string, which is the largest snapshot these bindings can write; the snapshot ' +
        'already on disk is unchanged and is now stale.',
      error,
    );
  }

  // A sibling, so the rename is within one filesystem and therefore atomic.
  // Unique per call as well as per process: a periodic checkpoint and an
  // explicit one can be in flight for the same backend at once, and two writers
  // sharing a temp file would rename an interleaved one into place.
  const tempPath = `${filePath}.tmp-${process.pid}-${++tempFileCounter}`;
  try {
    await fs.writeFile(tempPath, nquads, 'utf8');
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw new StoreSnapshotError(
      `Failed to write store snapshot ${filePath}: ${errorMessage(error)}`,
      error,
    );
  }

  return { bytes: Buffer.byteLength(nquads, 'utf8'), quads: store.size };
}

let tempFileCounter = 0;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
