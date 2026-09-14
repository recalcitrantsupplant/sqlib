/**
 * `@sparql-query-lib/runtime-oxigraph` — run exported queries with no endpoint.
 *
 * The core runtime substitutes arguments and hands the query somewhere; usually
 * that somewhere is a SPARQL endpoint over `fetch`. This package is the other
 * option: an in-process Oxigraph store, so a page can hold both the queries and
 * the data and answer them entirely on its own.
 *
 * It is a separate package on purpose. Oxigraph is ~960 KiB of WebAssembly —
 * two orders of magnitude more than the runtime itself — so an app that talks to
 * an endpoint must never pull it in by accident. Import it lazily and the engine
 * downloads only if something actually needs local execution:
 *
 * ```ts
 * const { oxigraphExecutor } = await import('@sparql-query-lib/runtime-oxigraph');
 * const lib = fromBundle(bundle, { executor: await oxigraphExecutor({ data: turtle }) });
 * ```
 *
 * The engine is the same one the sqlib API runs — its Oxigraph has always been
 * the WebAssembly build — so results agree with the server's by construction
 * rather than by testing.
 *
 * See `docs/guides/static-export.md`.
 */

import type {
  ExecutionRequest,
  ExecutionResult,
  Executor,
  RdfPayload,
  SparqlAskResults,
  SparqlSelectResults,
} from '@sparql-query-lib/runtime';

/**
 * The subset of Oxigraph's `Store` this package uses.
 *
 * It is hand-written rather than re-exported, so that a consumer can hand us a
 * store — or a stand-in for one — without depending on Oxigraph's own types.
 * The cost of that is a promise about somebody else's class: this shape has to
 * keep being one the real `Store` satisfies, and nothing in a hand-written
 * subset says so by itself. {@link loadOxigraph} is where the compiler is made
 * to check it.
 */
export interface OxigraphStore {
  query(
    query: string,
    options?: { results_format?: string },
  ): boolean | string | unknown[] | Map<string, unknown>[];
  load(input: string, options: { format: string; base_iri?: string }): void;
  readonly size: number;
}

/** One document to load into the store before any query runs. */
export interface SeedDocument {
  content: string;
  /** Media type, e.g. `text/turtle`, `application/n-quads`. Default Turtle. */
  format?: string;
  baseIri?: string;
}

export interface OxigraphExecutorOptions {
  /**
   * An existing store to query. Supply one to share it across executors, to keep
   * data between calls, or to load documents yourself.
   */
  store?: OxigraphStore;
  /** Documents to load into a new store. A bare string is read as Turtle. */
  data?: string | SeedDocument | SeedDocument[];
  /** Serialisation asked of CONSTRUCT/DESCRIBE. Default `text/turtle`. */
  rdfFormat?: string;
}

const RESULTS_JSON = 'application/sparql-results+json';
const DEFAULT_RDF_FORMAT = 'text/turtle';

/**
 * Load Oxigraph, initialising the WebAssembly module when the build needs it.
 *
 * The browser build is a `wasm-bindgen` module whose default export must be
 * awaited before anything else works; the Node build has no such export and is
 * ready on import. Feature-detecting is what lets one entry point serve both.
 *
 * The import is deliberately **not** cast to the shape this package wants. The
 * `return` below is the one place the real class and {@link OxigraphStore} meet,
 * so annotating the return type makes `tsc` check the subset against Oxigraph's
 * own declarations on every build — the day `Store.query` or `Store.load`
 * changes shape, this file goes red rather than a consumer's `new Store()`.
 * `test/storeSubset.test.ts` covers what a type cannot see: that the browser
 * build, whose declarations are not the ones resolved here, still agrees.
 */
async function loadOxigraph(): Promise<{ Store: new () => OxigraphStore }> {
  const oxigraph = await import('oxigraph');

  // `oxigraph`'s `types` entry is the Node build, which declares no default
  // export, so the initialiser is named from the build that has one. That is
  // not decoration: it is what makes the sentence above checkable, and a
  // browser build that stopped exporting one would fail here.
  type WasmInit = typeof import('oxigraph/web.js').default;
  const init = (oxigraph as { default?: unknown }).default;
  if (typeof init === 'function') {
    await (init as WasmInit)();
  }

  return oxigraph;
}

function toDocuments(data: OxigraphExecutorOptions['data']): SeedDocument[] {
  if (data === undefined) return [];
  if (typeof data === 'string') return [{ content: data }];
  return Array.isArray(data) ? data : [data];
}

/**
 * An executor backed by an Oxigraph store.
 *
 * Asynchronous because the browser build has to instantiate its WebAssembly
 * first. The returned executor is synchronous underneath — every query runs in
 * this thread — so a large query will block the page; a Web Worker is the answer
 * if that matters, and nothing here prevents one.
 *
 * Results come back in the same serialisations an HTTP endpoint would return,
 * because Oxigraph is asked to produce them: SPARQL Results JSON for SELECT and
 * ASK, and the requested RDF media type for CONSTRUCT and DESCRIBE. That is what
 * makes the two executors interchangeable behind {@link Executor}, and it keeps
 * this package free of any term-conversion code of its own.
 */
export async function oxigraphExecutor(
  options: OxigraphExecutorOptions = {},
): Promise<Executor & { store: OxigraphStore }> {
  const rdfFormat = options.rdfFormat ?? DEFAULT_RDF_FORMAT;

  let store = options.store;
  if (!store) {
    const { Store } = await loadOxigraph();
    store = new Store();
  }

  const documents = toDocuments(options.data);
  for (const document of documents) {
    store.load(document.content, {
      format: document.format ?? DEFAULT_RDF_FORMAT,
      ...(document.baseIri ? { base_iri: document.baseIri } : {}),
    });
  }

  const resolved = store;

  return {
    store: resolved,

    async execute({ queryText, queryType }: ExecutionRequest): Promise<ExecutionResult> {
      if (queryType === 'CONSTRUCT' || queryType === 'DESCRIBE') {
        const data = resolved.query(queryText, { results_format: rdfFormat });
        if (typeof data !== 'string') {
          throw new TypeError(
            `Expected serialised RDF from a ${queryType} query, received ${typeof data}.`,
          );
        }
        return { contentType: rdfFormat, data } satisfies RdfPayload;
      }

      const json = resolved.query(queryText, { results_format: RESULTS_JSON });
      if (typeof json !== 'string') {
        throw new TypeError(
          `Expected SPARQL Results JSON from a ${queryType} query, received ${typeof json}.`,
        );
      }
      return JSON.parse(json) as SparqlSelectResults | SparqlAskResults;
    },
  };
}
