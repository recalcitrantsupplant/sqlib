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

/**
 * The RDF dataset a query runs over, in place of `FROM` / `FROM NAMED` in its
 * text (SPARQL 1.1 Protocol §2.1.4). An absent part is left to the store; an
 * empty one means no graphs.
 */
export interface SparqlDataset {
  /** IRIs merged into the default graph. */
  defaultGraphs?: string[];
  /** IRIs available to `GRAPH` patterns. */
  namedGraphs?: string[];
}

/** What the runtime hands an executor. */
export interface ExecutionRequest {
  queryText: string;
  queryType: ExportedQueryType;
  signal?: AbortSignal;
  /** The dataset to run over. Executors that cannot apply one must refuse it. */
  dataset?: SparqlDataset;
}

/**
 * Sent for a part of the dataset that is present and empty. An endpoint given
 * no dataset parameters uses its whole default dataset, so an empty part is
 * sent as one graph that names nothing.
 */
export const EMPTY_DATASET_GRAPH = 'urn:sqlib:empty-dataset';

/** The protocol's `default-graph-uri` / `named-graph-uri` pairs for a dataset. */
export function datasetParameters(dataset: SparqlDataset | undefined): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  if (!dataset) return pairs;
  const parts = [['default-graph-uri', dataset.defaultGraphs], ['named-graph-uri', dataset.namedGraphs]] as const;
  for (const [parameter, graphs] of parts) {
    if (graphs === undefined) continue;
    for (const graph of graphs.length > 0 ? graphs : [EMPTY_DATASET_GRAPH]) pairs.push([parameter, graph]);
  }
  return pairs;
}

/** What a caller hands an executor to run a SPARQL UPDATE. */
export interface UpdateRequest {
  updateText: string;
  signal?: AbortSignal;
}

/**
 * Anything that can run a substituted query.
 *
 * `update` is optional. A bundle carries read queries only, so a page that runs
 * one needs no more than `execute`, and an executor that cannot write simply
 * leaves `update` out. A caller that writes — a rule set adding inferred
 * triples, say — checks for it and refuses an executor without it.
 */
export interface Executor {
  execute(request: ExecutionRequest): Promise<ExecutionResult>;
  update?(request: UpdateRequest): Promise<void>;
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
  /**
   * Where to POST a SPARQL UPDATE. Most servers take updates at a different URL
   * from queries (Fuseki's `/update` beside `/query`), so there is no guessing
   * it from the query endpoint. The executor has an `update` method only when
   * this is set.
   */
  updateEndpoint?: string;
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

  const { updateEndpoint } = options;

  const update = async ({ updateText, signal }: UpdateRequest): Promise<void> => {
    const response = await doFetch(updateEndpoint!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sparql-update', ...headers },
      body: updateText,
      credentials,
      signal,
    });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new SparqlEndpointError(
        `SPARQL update endpoint returned ${response.status} ${response.statusText}.`,
        response.status,
        body.slice(0, 2000),
      );
    }
  };

  return {
    ...(updateEndpoint ? { update } : {}),
    async execute({ queryText, queryType, signal, dataset }: ExecutionRequest): Promise<ExecutionResult> {
      const accept = acceptFor(queryType, rdfAccept);
      // The dataset rides with the query: in the URL for GET, so `auto` counts
      // it in the length, and in a form body for POST, since a
      // `application/sparql-query` body would push it into the URL anyway.
      const graphs = datasetParameters(dataset);
      const form = new URLSearchParams([['query', queryText], ...graphs]).toString();
      const getUrl = `${endpoint}${endpoint.includes('?') ? '&' : '?'}${graphs.length > 0 ? form : `query=${encodeURIComponent(queryText)}`}`;
      const useGet = method === 'GET' || (method === 'auto' && getUrl.length <= maxUrlLength);

      const response = useGet
        ? await doFetch(getUrl, {
            method: 'GET',
            headers: { Accept: accept, ...headers },
            credentials,
            signal,
          })
        : graphs.length > 0
          ? await doFetch(endpoint, {
              method: 'POST',
              headers: {
                Accept: accept,
                'Content-Type': 'application/x-www-form-urlencoded',
                ...headers,
              },
              body: form,
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
