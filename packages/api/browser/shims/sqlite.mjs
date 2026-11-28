// node:sqlite's DatabaseSync, on the official SQLite WebAssembly build.
//
// `initSqlite()` must finish before the API opens a database, because
// DatabaseSync is synchronous and loading the WebAssembly module is not.
// A database is kept in OPFS (the `opfs-sahpool` VFS) when the browser
// offers it, and in memory otherwise. `provideDatabase()` seeds a file
// that does not exist yet from bytes, such as the demo's library.sqlite.
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

let sqlite3 = null;
let pool = null;
const seeds = new Map();

export async function initSqlite({ opfs = true, wasmUrl } = {}) {
  if (sqlite3) return { persistent: !!pool };
  sqlite3 = await sqlite3InitModule(wasmUrl ? { locateFile: () => wasmUrl } : {});
  if (opfs && typeof sqlite3.installOpfsSAHPoolVfs === 'function') {
    try {
      pool = await sqlite3.installOpfsSAHPoolVfs({ name: 'sqlib', directory: '/sqlib' });
    } catch {
      pool = null;
    }
  }
  return { persistent: !!pool };
}

/** Seed `file` from `bytes` when it is opened and does not exist yet. */
export function provideDatabase(file, bytes) {
  // A file written by a server in WAL mode says so in bytes 18 and 19 of its
  // header. No browser VFS has WAL, so mark it as a rollback-journal file.
  if (bytes.byteLength > 20 && (bytes[18] === 2 || bytes[19] === 2)) {
    bytes = new Uint8Array(bytes);
    bytes[18] = 1;
    bytes[19] = 1;
  }
  seeds.set(normalise(file), bytes);
}

/** Delete a stored database so the next open seeds it again. */
export function resetDatabase(file) {
  if (pool) pool.unlink(normalise(file));
}

/** Delete every stored database, so each one seeds again or starts empty. */
export async function resetAllDatabases() {
  if (pool) await pool.wipeFiles();
}

function normalise(file) {
  return '/' + String(file).replace(/^\.?\/+/, '');
}

function bindOf(params) {
  if (params.length === 0) return undefined;
  if (params.length === 1 && params[0] !== null && typeof params[0] === 'object' && !(params[0] instanceof Uint8Array)) return params[0];
  return params;
}

class StatementSync {
  constructor(db, sql) { this.db = db; this.sql = sql; }
  get(...params) { return this.db.selectObject(this.sql, bindOf(params)); }
  all(...params) { return this.db.selectObjects(this.sql, bindOf(params)); }
  run(...params) {
    this.db.exec({ sql: this.sql, bind: bindOf(params) });
    return { changes: this.db.changes(), lastInsertRowid: Number(this.db.selectValue('SELECT last_insert_rowid()')) };
  }
  *iterate(...params) { yield* this.all(...params); }
}

export class DatabaseSync {
  constructor(file = ':memory:') {
    if (!sqlite3) throw new Error('initSqlite() must finish before a database is opened');
    const name = file === ':memory:' ? null : normalise(file);
    const seed = name ? seeds.get(name) : undefined;
    if (name && pool) {
      if (seed && !pool.getFileNames().includes(name)) pool.importDb(name, seed);
      this.db = new pool.OpfsSAHPoolDb(name);
    } else {
      this.db = new sqlite3.oo1.DB(':memory:', 'c');
      if (seed) {
        const p = sqlite3.wasm.allocFromTypedArray(seed);
        const rc = sqlite3.capi.sqlite3_deserialize(this.db.pointer, 'main', p, seed.byteLength, seed.byteLength,
          sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE | sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE);
        this.db.checkRc(rc);
      }
    }
    this.isOpen = true;
  }
  exec(sql) {
    // WAL needs shared memory, which no browser VFS has. The pragma is ignored.
    this.db.exec(String(sql).replace(/PRAGMA\s+journal_mode\s*=\s*WAL\s*;?/gi, ''));
  }
  prepare(sql) { return new StatementSync(this.db, sql); }
  close() { if (this.isOpen) { this.db.close(); this.isOpen = false; } }
  get isTransaction() { return !this.db.isAutocommit?.() ? false : false; }
}

export default { DatabaseSync, initSqlite, provideDatabase, resetDatabase, resetAllDatabases };
