/**
 * Executors: where a substituted query goes.
 *
 * The runtime's job ends at a query string. What runs it is behind this one
 * interface, which has exactly two implementations that matter: {@link httpExecutor},
 * a `fetch` to a SPARQL endpoint (this module), and an in-browser Oxigraph store
 * (`@sparql-query-lib/runtime-oxigraph`, kept in its own package so the ~1 MB of
 * WebAssembly is never on the path of an app that only needs the endpoint).
 *
 * `fetch` deliberately, not undici: this is the browser's transport, and the API's
 * `ISparqlExecutor` leaking undici's `Dispatcher.ResponseData` is the thing that
 * makes it unusable client-side.
 */

import type { TermValue } from './sparql-terms.js';
import type { ExportedQueryType } from './bundle.js';

/** SPARQL Results JSON, as returned for SELECT. */
export interface SparqlSelectResults {
  head: { vars: string[]; link?: string[] };
  results: { bindings: Array<Record<string, TermValue>> };
}

/** SPARQL Results JSON, as returned for ASK. */
export interface SparqlAskResults {
  head: Record<string, unknown>;
  boolean: boolean;
}

/** An RDF payload from CONSTRUCT or DESCRIBE, left in its serialised form. */
export interface RdfPayload {
  contentType: string;
  data: string;
}

export type ExecutionResult = SparqlSelectResults | SparqlAskResults | RdfPayload;

/** What the runtime hands an executor. */
export interface ExecutionRequest {
  queryText: string;
  queryType: ExportedQueryType;
  signal?: AbortSignal;
}

/** Anything that can run a substituted query. */
export interface Executor {
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
}

/** An endpoint answered with a non-2xx status, or with something unreadable. */
export class SparqlEndpointError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(message: string, status: number, body: string) {
    super(message);
    this.name = 'SparqlEndpointError';
    this.status = status;
    this.body = body;
  }
}

export interface HttpExecutorOptions {
  /** Extra headers — an API key, say. Merged over the computed `Accept`. */
  headers?: Record<string, string>;
  /**
   * `auto` (the default) sends short queries as `GET` so they hit HTTP caches and
   * CORS preflight is skipped, and anything longer as `POST`. Force one when the
   * endpoint only speaks the other.
   */
  method?: 'auto' | 'GET' | 'POST';
  /** URL length above which `auto` switches to POST. Conservative by default. */
  maxUrlLength?: number;
  /** Override the fetch implementation (tests, or a custom retry wrapper). */
  fetch?: typeof globalThis.fetch;
  /** Passed through to `fetch`, for endpoints behind a session cookie. */
  credentials?: RequestCredentials;
  /** Serialisation to ask for from CONSTRUCT/DESCRIBE. Default `text/turtle`. */
  rdfAccept?: string;
}

const RESULTS_ACCEPT = 'application/sparql-results+json';

function acceptFor(queryType: ExportedQueryType, rdfAccept: string): string {
  return queryType === 'CONSTRUCT' || queryType === 'DESCRIBE' ? rdfAccept : RESULTS_ACCEPT;
}

/**
 * Run queries against a SPARQL endpoint over HTTP.
 *
 * Note what this does *not* do: authorization. An exported bundle carries whatever
 * rights the endpoint grants the caller it can see — anonymous, or whatever the
 * `headers` option supplies. There is no server-side scoping left to rely on, so
 * do not export queries whose safety depended on it.
 */
export function httpExecutor(endpoint: string, options: HttpExecutorOptions = {}): Executor {
  const {
    headers = {},
    method = 'auto',
    maxUrlLength = 1800,
    credentials,
    rdfAccept = 'text/turtle',
  } = options;
  const doFetch = options.fetch ?? globalThis.fetch;
  if (typeof doFetch !== 'function') {
    throw new TypeError(
      'No fetch implementation is available; pass one as `fetch` in the executor options.',
    );
  }

  return {
    async execute({ queryText, queryType, signal }: ExecutionRequest): Promise<ExecutionResult> {
      const accept = acceptFor(queryType, rdfAccept);
      const getUrl = `${endpoint}${endpoint.includes('?') ? '&' : '?'}query=${encodeURIComponent(queryText)}`;
      const useGet = method === 'GET' || (method === 'auto' && getUrl.length <= maxUrlLength);

      const response = useGet
        ? await doFetch(getUrl, {
            method: 'GET',
            headers: { Accept: accept, ...headers },
            credentials,
            signal,
          })
        : await doFetch(endpoint, {
            method: 'POST',
            headers: {
              Accept: accept,
              'Content-Type': 'application/sparql-query',
              ...headers,
            },
            body: queryText,
            credentials,
            signal,
          });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new SparqlEndpointError(
          `SPARQL endpoint returned ${response.status} ${response.statusText}.`,
          response.status,
          body.slice(0, 2000),
        );
      }

      if (queryType === 'CONSTRUCT' || queryType === 'DESCRIBE') {
        return {
          contentType: response.headers.get('content-type') ?? rdfAccept,
          data: await response.text(),
        };
      }

      const payload = (await response.json()) as SparqlSelectResults | SparqlAskResults;
      return payload;
    },
  };
}
