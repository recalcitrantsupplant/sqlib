/**
 * The sqlib API in a Worker in this tab, for a deployment with no server.
 *
 * A site whose `apiBaseUrl` is `browser` (in `config.json` or
 * `NUXT_PUBLIC_API_BASE_URL`) loads the API bundle that
 * `packages/api/browser/build.mjs` makes, from `sqlib-api/` beside the app.
 * Every `fetch` to the API base then goes to that Worker, which runs the
 * request through the API's own routes with Fastify's `inject()`. The rest of
 * the app is unchanged: it builds the same URLs and reads the same responses.
 *
 * The library is the SQLite file the build put beside the Worker. The Worker
 * keeps it in this browser's origin storage (OPFS), so a visitor's changes
 * stay after a reload, and `reset()` starts again from the file. Queries on
 * in-memory backends run on Oxigraph in the Worker. Queries on an endpoint go
 * from the Worker to the endpoint, so the endpoint must allow CORS.
 */

/** The `apiBaseUrl` value that selects the in-browser API. */
export const BROWSER_API = 'browser';

/** A request the Worker has not answered in this time restarts it. */
const REQUEST_TIMEOUT_MS = 60_000;

/** The change feed. A library with one reader has no changes to send, so it stays open and silent. */
const SILENT_STREAM_PATHS = ['/events'];

interface WorkerResponse {
  type: 'response';
  id: number;
  status: number;
  headers: Record<string, string>;
  body: ArrayBuffer;
}

type WorkerReply =
  | { type: 'ready'; persistent: boolean; startMs: number }
  | { type: 'failed'; message: string }
  | WorkerResponse;

interface Pending {
  resolve: (reply: WorkerResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface BrowserApi {
  /** The origin and path the app uses as its API base. */
  baseUrl: string;
  /** Resolves when the API has loaded the library. `persistent` is false when the browser offers no OPFS. */
  ready: Promise<{ startMs: number; persistent: boolean }>;
  /** Deletes this browser's copy of the library and starts again from the site's file. */
  reset(): Promise<void>;
}

let installed: BrowserApi | null = null;

/** The in-browser API this page installed, or null on a deployment with a server. */
export function browserApi(): BrowserApi | null {
  return installed;
}

export function isBrowserApi(apiBaseUrl: string | undefined | null): boolean {
  return apiBaseUrl === BROWSER_API;
}

/**
 * Start the Worker and route API calls to it.
 *
 * @param assetBase URL of the directory that holds `sqlib-api-worker.js`.
 * @param baseUrl The API base the app will use. Requests under it go to the Worker.
 * @param options.duckdbBaseUrl Where duckdb-wasm is loaded from on the first ETL run. Default: jsDelivr.
 */
export function installBrowserApi(assetBase: string, baseUrl: string, options: { duckdbBaseUrl?: string } = {}): BrowserApi {
  const root = baseUrl.replace(/\/$/, '');
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const pending = new Map<number, Pending>();
  let nextId = 1;
  let worker: Worker;
  let ready: Promise<{ startMs: number; persistent: boolean }>;

  function start(reset = false): void {
    worker = new Worker(new URL('sqlib-api-worker.js', assetBase), { type: 'module', name: 'sqlib-api' });
    ready = new Promise((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<WorkerReply>) => {
        const message = event.data;
        if (message.type === 'ready') resolve({ startMs: message.startMs, persistent: message.persistent });
        else if (message.type === 'failed') reject(new Error(message.message));
        else {
          const entry = pending.get(message.id);
          if (!entry) return;
          clearTimeout(entry.timer);
          pending.delete(message.id);
          entry.resolve(message);
        }
      };
      worker.onerror = event => reject(new Error(event.message || 'The API worker failed to start'));
    });
    worker.postMessage({
      type: 'init',
      libraryUrl: new URL('library.sqlite', assetBase).href,
      oxigraphWasmUrl: new URL('oxigraph.wasm', assetBase).href,
      sqliteWasmUrl: new URL('sqlite3.wasm', assetBase).href,
      duckdbBaseUrl: options.duckdbBaseUrl,
      persist: true,
      reset,
    });
  }

  /** A query that never returns holds the Worker. Start a new one and fail what was waiting. */
  function restart(reason: string, reset = false): void {
    worker.terminate();
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(reason));
      pending.delete(id);
    }
    start(reset);
  }

  function send(method: string, path: string, headers: Record<string, string>, body: Uint8Array | null, signal: AbortSignal | null): Promise<WorkerResponse> {
    return ready.then(() => new Promise<WorkerResponse>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => restart(`The request ${method} ${path} took longer than ${REQUEST_TIMEOUT_MS / 1000} s and was stopped`), REQUEST_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
      signal?.addEventListener('abort', () => {
        const entry = pending.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        pending.delete(id);
        reject(signal.reason ?? new DOMException('The operation was aborted.', 'AbortError'));
      }, { once: true });
      worker.postMessage({ type: 'request', id, method, url: path, headers, body }, body ? [body.buffer] : []);
    }));
  }

  async function browserFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const absolute = new URL(url, globalThis.location?.href).href;
    if (absolute !== root && !absolute.startsWith(`${root}/`) && !absolute.startsWith(`${root}?`)) {
      return nativeFetch(input, init);
    }
    const request = new Request(absolute, init ?? (input instanceof Request ? input : undefined));
    const target = new URL(absolute);
    const path = target.pathname.slice(new URL(root).pathname.replace(/\/$/, '').length) || '/';

    if (SILENT_STREAM_PATHS.includes(path)) return silentStream(request.signal);

    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => { headers[key] = value; });
    const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
    const body = hasBody ? new Uint8Array(await request.arrayBuffer()) : null;
    const reply = await send(request.method, path + target.search, headers, body && body.byteLength > 0 ? body : null, init?.signal ?? null);
    const nullBody = reply.status === 204 || reply.status === 304 || request.method === 'HEAD';
    return new Response(nullBody ? null : reply.body, { status: reply.status, headers: reply.headers });
  }

  start();
  globalThis.fetch = browserFetch as typeof fetch;
  installed = {
    baseUrl: root,
    get ready() { return ready; },
    async reset() {
      restart('The library was reset', true);
      await ready;
    },
  };
  return installed;
}

function silentStream(signal: AbortSignal): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      signal.addEventListener('abort', () => controller.close(), { once: true });
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}
