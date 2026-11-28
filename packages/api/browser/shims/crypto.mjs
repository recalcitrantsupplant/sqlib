// node:crypto for the browser build: Web Crypto plus a synchronous SHA-256.
import { sha256 } from '@noble/hashes/sha256';
import { Buffer } from 'node:buffer';

class Hash {
  constructor(algorithm) {
    if (String(algorithm).toLowerCase() !== 'sha256') throw new Error(`createHash('${algorithm}') is not available in the browser build`);
    this.h = sha256.create();
  }
  update(data, encoding) { this.h.update(typeof data === 'string' ? Buffer.from(data, encoding ?? 'utf8') : new Uint8Array(data.buffer ?? data, data.byteOffset ?? 0, data.byteLength ?? data.length)); return this; }
  digest(encoding) { const b = Buffer.from(this.h.digest()); return encoding ? b.toString(encoding) : b; }
}
export function createHash(algorithm) { return new Hash(algorithm); }
export function randomUUID() { return globalThis.crypto.randomUUID(); }
export function randomBytes(n, cb) { const b = Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(n))); if (cb) { queueMicrotask(() => cb(null, b)); return; } return b; }
export function randomInt(min, max) { if (max === undefined) { max = min; min = 0; } return min + Math.floor(Math.random() * (max - min)); }
export function getRandomValues(a) { return globalThis.crypto.getRandomValues(a); }
export function timingSafeEqual(a, b) { if (a.length !== b.length) throw new RangeError('Input buffers must have the same byte length'); let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }
export function createHmac() { throw new Error('createHmac is not available in the browser build'); }
export const webcrypto = globalThis.crypto;
export const subtle = globalThis.crypto?.subtle;
export default { createHash, randomUUID, randomBytes, randomInt, getRandomValues, timingSafeEqual, createHmac, webcrypto, subtle };
