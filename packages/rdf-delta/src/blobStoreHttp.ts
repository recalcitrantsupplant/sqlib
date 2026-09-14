/**
 * A {@link ConditionalBlobStore} over HTTP, in both dialects at once.
 *
 * Azure and S3 speak the same conditional-write protocol over the same two
 * headers, and disagree on one status code (`blobStore.ts` has the table). This
 * adapter is the place that difference stops: it reads both services' way of
 * reporting an error code and folds both refusals into `precondition-failed`.
 *
 * ## The package still has no network dependency
 *
 * `fetch` is a required argument rather than a reach for a global. That keeps
 * the package's boundary intact — it imports nothing and opens nothing on its
 * own — while letting
 * a caller hand over the one it already has, signed, proxied, retried or
 * instrumented as its deployment needs. A browser passes `window.fetch`; the
 * API passes an undici pool; a test passes the emulator's.
 *
 * The response is taken structurally for the same reason: naming `Response`
 * would put a DOM or undici type in the package's public surface, and every
 * consumer would then have to agree with us about which one.
 */

import type {
  BlobGetOutcome,
  BlobPutCondition,
  BlobPutOutcome,
  ConditionalBlobStore,
} from './blobStore.js';

/** The subset of a `Response` this adapter reads. */
export interface BlobResponseLike {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** The subset of `fetch` this adapter calls. */
export type BlobFetch = (
  url: string,
  init: { method: string; headers?: Record<string, string>; body?: Uint8Array },
) => Promise<BlobResponseLike>;

export interface HttpBlobStoreOptions {
  /** Container or bucket URL. A key is appended to it as a path segment. */
  baseUrl: string;
  fetch: BlobFetch;
  /** Sent on every write. N-Triples, since a per-graph blob does not repeat its graph name. */
  contentType?: string;
}

/** A response neither stored nor refused: the caller's problem, not the sink's. */
export class BlobStoreError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'BlobStoreError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Both services' way of naming what went wrong.
 *
 * Azure puts it in a header as well as the body; S3 only in the body. Reading
 * the header first is not a preference — a `HEAD`-like error response can carry
 * the header with an empty body, and `poc/blobSnapshot.ts` read only the body,
 * so it reported `undefined` for exactly the refusal it was written to explain.
 */
async function errorCode(response: BlobResponseLike): Promise<string | undefined> {
  const header = response.headers.get('x-ms-error-code');
  if (header) return header;
  const body = await response.text().catch(() => '');
  return /<Code>([^<]+)<\/Code>/.exec(body)?.[1];
}

/**
 * Is this status the service saying "the condition you gave me does not hold"?
 *
 * 412 always is. 409 is only where Azure sends it — a refused create — and
 * folding it there rather than everywhere is deliberate: 409 on other operations
 * and other services means a genuine conflict (`OperationAborted`,
 * `BucketAlreadyExists`), and a sink that read those as "somebody beat me to it"
 * would rebase against a state that was never written.
 */
function isPreconditionFailure(status: number, condition: BlobPutCondition): boolean {
  if (status === 412) return true;
  return status === 409 && condition.kind === 'create';
}

export function httpConditionalBlobStore(options: HttpBlobStoreOptions): ConditionalBlobStore {
  const contentType = options.contentType ?? 'application/n-triples';
  const base = options.baseUrl.replace(/\/+$/, '');
  const url = (key: string): string => `${base}/${key}`;

  return {
    async get(key: string): Promise<BlobGetOutcome> {
      const response = await options.fetch(url(key), { method: 'GET' });
      if (response.status === 404) return { outcome: 'absent' };
      if (response.status !== 200) {
        throw new BlobStoreError(
          `blob ${key}: GET answered ${response.status}`,
          response.status,
          await errorCode(response),
        );
      }
      return {
        outcome: 'found',
        body: new Uint8Array(await response.arrayBuffer()),
        etag: response.headers.get('etag') ?? undefined,
      };
    },

    async put(key: string, body: Uint8Array, condition: BlobPutCondition): Promise<BlobPutOutcome> {
      const headers: Record<string, string> = { 'content-type': contentType };
      if (condition.kind === 'create') headers['if-none-match'] = '*';
      else headers['if-match'] = condition.etag;

      const response = await options.fetch(url(key), { method: 'PUT', headers, body });

      if (response.status < 400) {
        return { outcome: 'stored', etag: response.headers.get('etag') ?? undefined };
      }

      const code = await errorCode(response);
      if (isPreconditionFailure(response.status, condition)) {
        return { outcome: 'precondition-failed', status: response.status, code };
      }
      throw new BlobStoreError(`blob ${key}: PUT answered ${response.status}`, response.status, code);
    },
  };
}
