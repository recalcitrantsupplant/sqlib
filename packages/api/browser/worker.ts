/**
 * The sqlib API in a dedicated Worker.
 *
 * The page posts `{ type: 'init' }` once, then one `{ type: 'request' }` per
 * API call. Each call goes through Fastify's `inject()`, so it runs the same
 * routing, hooks, validation and handlers as the server, with no socket.
 */
import './prelude.mjs';
import { initSqlite, provideDatabase, resetAllDatabases } from './shims/sqlite.mjs';
import type { WorkerInit, WorkerMessage, WorkerReply } from './protocol.js';

const LIBRARY_FILE = '/opt/sqlib-demo/store/library.sqlite';

type InjectApp = {
  inject(opts: { method: string; url: string; headers: Record<string, string>; payload?: string | Uint8Array }): Promise<{
    statusCode: number;
    headers: Record<string, string | string[] | number | undefined>;
    rawPayload: Uint8Array;
  }>;
};

let ready: Promise<InjectApp> | null = null;

async function start(init: WorkerInit): Promise<InjectApp> {
  const t0 = performance.now();
  (globalThis as { __SQLIB_DUCKDB__?: { baseUrl?: string } }).__SQLIB_DUCKDB__ = { baseUrl: init.duckdbBaseUrl };
  const { persistent } = await initSqlite({ opfs: init.persist !== false, wasmUrl: init.sqliteWasmUrl });
  const seed = await fetch(init.libraryUrl);
  if (!seed.ok) throw new Error(`The demo library could not be loaded: ${seed.status} ${init.libraryUrl}`);
  const bytes = new Uint8Array(await seed.arrayBuffer());
  // The stored databases start from one library file. When the site ships a
  // different file, they start again from it, and the visitor's changes go.
  const seedId = await sha256(bytes);
  if (persistent && (init.reset || await storedSeedId() !== seedId)) {
    await resetAllDatabases();
    await storeSeedId(seedId);
  }
  provideDatabase(LIBRARY_FILE, bytes);
  const oxigraph = await import('oxigraph');
  await (oxigraph as unknown as { default: (opts: { module_or_path: string | URL }) => Promise<unknown> }).default({
    module_or_path: init.oxigraphWasmUrl ?? new URL('oxigraph.wasm', self.location.href),
  });
  const { app, configureApp } = await import('../src/index.js');
  await configureApp(app, { registerSwagger: false, enableCacheMonitoring: false });
  await app.ready();
  post({ type: 'ready', persistent, startMs: performance.now() - t0 });
  return app as unknown as InjectApp;
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
}

const SEED_ID_FILE = 'sqlib-seed.sha256';

/** The hash of the library file the stored databases started from. */
async function storedSeedId(): Promise<string | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await (await (await root.getFileHandle(SEED_ID_FILE)).getFile()).text();
  } catch {
    return null;
  }
}

async function storeSeedId(id: string): Promise<void> {
  const root = await navigator.storage.getDirectory();
  const writable = await (await root.getFileHandle(SEED_ID_FILE, { create: true })).createWritable();
  await writable.write(id);
  await writable.close();
}

function post(message: WorkerReply, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(message, transfer);
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const message = event.data;
  if (message.type === 'init') {
    ready ??= start(message);
    ready.catch(error => post({ type: 'failed', message: String(error?.stack ?? error) }));
    return;
  }
  if (!ready) {
    post({ type: 'response', id: message.id, status: 503, headers: {}, body: new TextEncoder().encode('{"error":"not started"}').buffer });
    return;
  }
  try {
    const app = await ready;
    // light-my-request sends a Buffer as bytes and serialises any other object as JSON.
    const payload = message.body instanceof Uint8Array ? Buffer.from(message.body.buffer, message.body.byteOffset, message.body.byteLength) : message.body ?? undefined;
    const res = await app.inject({ method: message.method, url: message.url, headers: message.headers, payload });
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers)) if (v !== undefined) headers[k] = Array.isArray(v) ? v.join(', ') : String(v);
    const bytes = res.rawPayload;
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    post({ type: 'response', id: message.id, status: res.statusCode, headers, body }, [body]);
  } catch (error) {
    const body = new TextEncoder().encode(JSON.stringify({ error: String((error as Error)?.message ?? error) })).buffer as ArrayBuffer;
    post({ type: 'response', id: message.id, status: 500, headers: { 'content-type': 'application/json' }, body }, [body]);
  }
};
