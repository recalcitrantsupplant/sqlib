/**
 * A read-only view over another executor.
 *
 * Oxigraph's `Store` has no read-only flag — the Rust API has no such concept
 * and the WASM bindings expose none — so "read-only backend" has to be a
 * property of how we execute, not of the store. This decorator is that seam.
 *
 * Why it must be explicit rather than best-effort: a read-only store that
 * quietly *accepts* an update would apply it in memory and then lose it on the
 * next reload, because the store is rebuilt from its data graphs. That is a
 * silent wrong answer — the caller believes their write landed, and the data
 * disagrees later. A rejection is the honest outcome, and the error names the
 * reason so a caller can fix their config rather than guess.
 */

import type { Dispatcher } from 'undici';
import type {
  ISparqlExecutor,
  SparqlExecutionResult,
  SparqlQueryOptions,
  SparqlSelectJsonOutput,
} from './ISparqlExecutor.js';

/**
 * Thrown when a write reaches a read-only backend.
 *
 * Carries its own name so routes can map it to a 403 rather than a 500: the
 * request was understood and refused, not broken.
 */
export class ReadOnlyBackendError extends Error {
  readonly backendId?: string;
  /**
   * Read by the routes' generic error handling, which already maps a carried
   * `statusCode` onto the response. Setting it here means every path that can
   * reach a read-only backend reports 403 without each one learning about this
   * error type.
   */
  readonly statusCode = 403;

  constructor(message: string, backendId?: string) {
    super(message);
    this.name = 'ReadOnlyBackendError';
    this.backendId = backendId;
  }
}

export class ReadOnlySparqlExecutor implements ISparqlExecutor {
  constructor(
    private readonly inner: ISparqlExecutor,
    private readonly backendId?: string,
  ) {}

  /** The executor being guarded, for callers that need the unguarded reads. */
  get delegate(): ISparqlExecutor {
    return this.inner;
  }

  selectQueryParsed(
    sparqlQuery: string,
    options?: SparqlQueryOptions,
  ): Promise<SparqlExecutionResult<SparqlSelectJsonOutput | string>> {
    return this.inner.selectQueryParsed(sparqlQuery, options);
  }

  constructQueryParsed(
    sparqlQuery: string,
    options?: SparqlQueryOptions,
  ): Promise<SparqlExecutionResult<string>> {
    return this.inner.constructQueryParsed(sparqlQuery, options);
  }

  selectQueryStream(sparqlQuery: string, options?: SparqlQueryOptions): Promise<Dispatcher.ResponseData> {
    return this.inner.selectQueryStream(sparqlQuery, options);
  }

  constructQueryStream(sparqlQuery: string, options?: SparqlQueryOptions): Promise<Dispatcher.ResponseData> {
    return this.inner.constructQueryStream(sparqlQuery, options);
  }

  askQuery(
    sparqlAskQuery: string,
    options?: SparqlQueryOptions,
  ): Promise<SparqlExecutionResult<boolean | string>> {
    return this.inner.askQuery(sparqlAskQuery, options);
  }

  update(_sparqlUpdateQuery: string): Promise<SparqlExecutionResult<void>> {
    const target = this.backendId ? ` ${this.backendId}` : '';
    return Promise.reject(
      new ReadOnlyBackendError(
        `Backend${target} is read-only: it is hydrated from data graphs, so an update would be discarded on the next reload. ` +
          'Set the backend mode to "ephemeral" or "durable", or write to the underlying data graph instead.',
        this.backendId,
      ),
    );
  }
}
