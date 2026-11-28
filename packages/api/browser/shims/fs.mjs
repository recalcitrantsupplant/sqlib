// An in-memory node:fs for the browser build. The prelude puts the demo's
// configuration files in it (people.json, grants.ttl). Everything the API
// writes here is lost when the Worker stops; the library itself lives in
// SQLite, which has its own storage.
import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';

const files = new Map();
const dirs = new Set(['/']);

function norm(p) {
  p = String(p instanceof URL ? p.pathname : p);
  if (!p.startsWith('/')) p = '/' + p;
  const out = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop(); else out.push(seg);
  }
  return '/' + out.join('/');
}
function parent(p) { const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i); }
function enoent(p, op) { const e = new Error(`ENOENT: no such file or directory, ${op} '${p}'`); e.code = 'ENOENT'; e.errno = -2; e.syscall = op; e.path = p; return e; }
function mkdirp(p) { while (p !== '/' && !dirs.has(p)) { dirs.add(p); p = parent(p); } }
function encode(data, enc) { if (typeof data === 'string') return Buffer.from(data, typeof enc === 'string' ? enc : enc?.encoding ?? 'utf8'); return Buffer.from(data.buffer ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : data); }
function decode(buf, opts) { const enc = typeof opts === 'string' ? opts : opts?.encoding; return enc ? buf.toString(enc) : buf; }

class Stats {
  constructor(isDir, size) { this._d = isDir; this.size = size; this.mode = isDir ? 0o40755 : 0o100644; this.mtime = this.ctime = this.atime = this.birthtime = new Date(0); this.mtimeMs = 0; }
  isDirectory() { return this._d; }
  isFile() { return !this._d; }
  isSymbolicLink() { return false; }
}

export function seedFile(path, data) { const p = norm(path); mkdirp(parent(p)); files.set(p, encode(data)); }
export function existsSync(p) { p = norm(p); return files.has(p) || dirs.has(p); }
export function readFileSync(p, opts) { const n = norm(p); const f = files.get(n); if (!f) throw enoent(n, 'open'); return decode(Buffer.from(f), opts); }
export function writeFileSync(p, data, opts) { const n = norm(p); const flag = typeof opts === 'object' ? opts?.flag : undefined; mkdirp(parent(n)); if (flag === 'a' && files.has(n)) { files.set(n, Buffer.concat([files.get(n), encode(data, opts)])); } else files.set(n, encode(data, opts)); }
export function appendFileSync(p, data, opts) { writeFileSync(p, data, { ...(typeof opts === 'object' ? opts : { encoding: opts }), flag: 'a' }); }
export function mkdirSync(p) { mkdirp(norm(p)); return undefined; }
export function readdirSync(p, opts) {
  const n = norm(p); if (!dirs.has(n)) throw enoent(n, 'scandir');
  const prefix = n === '/' ? '/' : n + '/';
  const names = new Set();
  for (const k of [...files.keys(), ...dirs]) if (k.startsWith(prefix) && k !== n) names.add(k.slice(prefix.length).split('/')[0]);
  const list = [...names].sort();
  if (opts?.withFileTypes) return list.map(name => { const full = prefix + name; const d = dirs.has(full); return { name, parentPath: n, path: n, isDirectory: () => d, isFile: () => !d, isSymbolicLink: () => false }; });
  return list;
}
export function statSync(p, opts) { const n = norm(p); if (dirs.has(n)) return new Stats(true, 0); const f = files.get(n); if (f) return new Stats(false, f.length); if (opts?.throwIfNoEntry === false) return undefined; throw enoent(n, 'stat'); }
export const lstatSync = statSync;
export function accessSync(p) { if (!existsSync(p)) throw enoent(norm(p), 'access'); }
export function unlinkSync(p) { const n = norm(p); if (!files.delete(n)) throw enoent(n, 'unlink'); }
export function rmSync(p, opts) { const n = norm(p); const had = files.delete(n) | dirs.delete(n); for (const k of [...files.keys()]) if (k.startsWith(n + '/')) files.delete(k); for (const k of [...dirs]) if (k.startsWith(n + '/')) dirs.delete(k); if (!had && !opts?.force) throw enoent(n, 'rm'); }
export function rmdirSync(p) { rmSync(p, { force: true }); }
export function renameSync(a, b) { const x = norm(a), y = norm(b); const f = files.get(x); if (!f) throw enoent(x, 'rename'); files.delete(x); mkdirp(parent(y)); files.set(y, f); }
export function copyFileSync(a, b) { writeFileSync(b, readFileSync(a)); }
export function realpathSync(p) { return norm(p); }
realpathSync.native = realpathSync;
export function mkdtempSync(prefix) { const p = norm(prefix + Math.random().toString(36).slice(2, 8)); mkdirp(p); return p; }
let fdNext = 10; const fds = new Map();
export function openSync(p, flags = 'r') { const n = norm(p); if (flags.startsWith('r') && !files.has(n)) throw enoent(n, 'open'); if (!files.has(n) || flags.startsWith('w')) writeFileSync(n, ''); const fd = fdNext++; fds.set(fd, n); return fd; }
export function closeSync(fd) { fds.delete(fd); }
export function fsyncSync() {}
export function writeSync(fd, data) { appendFileSync(fds.get(fd), data); return typeof data === 'string' ? data.length : data.byteLength; }
export function readlinkSync(p) { const e = new Error(`EINVAL: invalid argument, readlink '${p}'`); e.code = 'EINVAL'; throw e; }
export const readlink = (p, cb) => queueMicrotask(() => { try { readlinkSync(p); } catch (e) { cb(e); } });
export const lstat = (p, o, cb) => stat(p, o, cb);
export const realpath = (p, cb) => queueMicrotask(() => cb(null, realpathSync(p)));
export function chmodSync() {}
export function utimesSync() {}
export function watch() { return { close() {}, on() { return this; } }; }
export function createReadStream(p, opts = {}) {
  const n = norm(p);
  const f = files.get(n);
  if (!f) {
    const stream = new Readable({ read() {} });
    queueMicrotask(() => stream.destroy(enoent(n, 'open')));
    return stream;
  }
  const start = opts.start ?? 0;
  const end = opts.end === undefined ? f.length : opts.end + 1;
  const chunk = Buffer.from(f.subarray(start, end));
  const encoding = typeof opts === 'string' ? opts : opts.encoding;
  return Readable.from([encoding ? chunk.toString(encoding) : chunk], { objectMode: false });
}
export function createWriteStream() { throw new Error('createWriteStream is not available in the browser build'); }

const cbify = fn => (...args) => { const cb = typeof args[args.length - 1] === 'function' ? args.pop() : null; try { const r = fn(...args); if (cb) queueMicrotask(() => cb(null, r)); } catch (e) { if (cb) queueMicrotask(() => cb(e)); else throw e; } };
export const readFile = cbify(readFileSync);
export const writeFile = cbify(writeFileSync);
export const stat = cbify(statSync);
export const mkdir = cbify(mkdirSync);
export const readdir = cbify(readdirSync);
export const unlink = cbify(unlinkSync);
export const access = cbify(accessSync);
export function exists(p, cb) { queueMicrotask(() => cb(existsSync(p))); }

const pr = fn => async (...args) => fn(...args);
export const promises = {
  readFile: pr(readFileSync), writeFile: pr(writeFileSync), appendFile: pr(appendFileSync), mkdir: pr(mkdirSync),
  readdir: pr(readdirSync), stat: pr(statSync), lstat: pr(statSync), access: pr(accessSync), unlink: pr(unlinkSync),
  rm: pr(rmSync), rmdir: pr(rmdirSync), rename: pr(renameSync), copyFile: pr(copyFileSync), realpath: pr(realpathSync),
  mkdtemp: pr(mkdtempSync), readlink: pr(readlinkSync), chmod: pr(chmodSync), utimes: pr(utimesSync),
  open: async (p, flags) => {
    const fd = openSync(p, flags);
    const file = fds.get(fd);
    return {
      fd,
      sync: async () => {},
      close: async () => closeSync(fd),
      readFile: async opts => readFileSync(file, opts),
      writeFile: async d => writeFileSync(file, d),
      write: async d => writeSync(fd, d),
      stat: async () => statSync(file),
      createReadStream: opts => createReadStream(file, opts),
    };
  },
};
export const constants = { F_OK: 0, R_OK: 4, W_OK: 2, X_OK: 1, O_RDONLY: 0, O_WRONLY: 1, O_RDWR: 2, O_CREAT: 64, O_EXCL: 128, O_TRUNC: 512, O_APPEND: 1024 };
export const F_OK = 0, R_OK = 4, W_OK = 2, X_OK = 1;
export default {
  seedFile, existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync, statSync, lstatSync, accessSync,
  unlinkSync, rmSync, rmdirSync, renameSync, copyFileSync, realpathSync, mkdtempSync, openSync, closeSync, fsyncSync, writeSync,
  readlinkSync, readlink, lstat, realpath, chmodSync, utimesSync, watch, createReadStream, createWriteStream, readFile, writeFile, stat, mkdir, readdir, unlink, access,
  exists, promises, constants, F_OK, R_OK, W_OK, X_OK,
};
