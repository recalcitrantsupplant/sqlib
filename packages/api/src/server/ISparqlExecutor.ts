import { Dispatcher } from 'undici';

/**
 * Represents the standard structure of SPARQL JSON results for SELECT queries.
 * Contains the header (`head`) with variable names and the results (`results`)
 * with the actual data bindings (query outputs).
 * Uses the canonical SparqlValue and SparqlResultsJson types.
 */
import type { SparqlResultsJson as SparqlSelectJsonOutput, SparqlValue } from '../lib/query-chaining.js';

// Re-export SparqlSelectJsonOutput for clarity in this module if needed elsewhere,
// but ISparqlExecutor methods will use the imported type directly.
export type { SparqlSelectJsonOutput };


/**
 * Options for executing SPARQL queries.
 */
export type SparqlQueryOptions = {
  /**
   * The desired Accept header for the request.
   * If not provided, the executor may use a default based on the query type or backend configuration.
   */
  acceptHeader?: string;
};

/**
 * Wraps a SPARQL execution result with its duration and content type.
 */
export type SparqlExecutionResult<T> = {
  /** The result of the SPARQL query. */
  result: T;
  /** The duration of the query execution in milliseconds. */
  duration: number;
  /** The Content-Type of the response from the backend (if available). */
  contentType?: string;
};


/**
 * Defines the contract for executing SPARQL queries against a backend.
 * Implementations expect a fully formed SPARQL query string.
 * Supports both parsed results and raw streaming for SELECT and CONSTRUCT queries.
 */
export interface ISparqlExecutor {
  /**
   * Executes a SPARQL SELECT query and returns the parsed JSON output object.
   * When a non-JSON Accept header is provided, returns the response as a string.
   * @param sparqlQuery The complete SELECT query string.
   * @param options Optional execution parameters, including the Accept header.
   * @returns A promise resolving to the parsed SPARQL JSON output object (`SparqlSelectJsonOutput`) or raw text string.
   */
  selectQueryParsed(sparqlQuery: string, options?: SparqlQueryOptions): Promise<SparqlExecutionResult<SparqlSelectJsonOutput | string>>;

  /**
   * Executes a SPARQL CONSTRUCT query and returns the resulting RDF graph as a string (format determined by Accept header or default).
   * @param sparqlQuery The complete CONSTRUCT query string.
   * @param options Optional execution parameters, including the Accept header.
   * @returns A promise resolving to the RDF graph output as a string (e.g., N-Quads, Turtle).
   */
  constructQueryParsed(sparqlQuery: string, options?: SparqlQueryOptions): Promise<SparqlExecutionResult<string>>;

  /**
   * Executes a SPARQL SELECT query and returns the raw undici response object for streaming.
   * TODO: Consider how options (like Accept header) should apply to streaming methods.
   * The caller is responsible for consuming the response body stream (expected SPARQL JSON).
   * @param sparqlQuery The complete SELECT query string.
   * @param options Optional execution parameters, including the Accept header.
   * @returns A promise resolving to the raw `undici` response object after checking the status code.
   * Note: The return type is Dispatcher.ResponseData for compatibility with the HTTP implementation.
   * Other implementations might need to adapt or provide alternative streaming mechanisms.
   */
  selectQueryStream(sparqlQuery: string, options?: SparqlQueryOptions): Promise<Dispatcher.ResponseData>;

  /**
   * Executes a SPARQL CONSTRUCT query and returns the raw undici response object for streaming.
   * The caller is responsible for consuming the response body stream (format determined by Accept header or default).
   * TODO: Consider how options (like Accept header) should apply to streaming methods.
   * @param sparqlQuery The complete CONSTRUCT query string.
   * @param options Optional execution parameters, including the Accept header.
   * @returns A promise resolving to the raw `undici` response object after checking the status code.
   * Note: The return type is Dispatcher.ResponseData for compatibility with the HTTP implementation.
   * Other implementations might need to adapt or provide alternative streaming mechanisms.
   */
  constructQueryStream(sparqlQuery: string, options?: SparqlQueryOptions): Promise<Dispatcher.ResponseData>;

  /**
   * Executes a SPARQL UPDATE query (e.g., INSERT, DELETE).
   * Does not typically return data, but should signal success or failure.
   * @param sparqlUpdateQuery The complete UPDATE query string.
   * @returns A promise resolving when the update is complete, or rejecting on error.
   */
  update(sparqlUpdateQuery: string): Promise<SparqlExecutionResult<void>>;

  /**
   * Executes a SPARQL ASK query and returns the boolean result.
   * When a non-JSON Accept header is provided, returns the response as a string.
   * @param sparqlAskQuery The complete ASK query string.
   * @param options Optional execution parameters, including the Accept header.
   * @returns A promise resolving to `true` or `false`, or raw text string for non-JSON responses.
   */
  askQuery(sparqlAskQuery: string, options?: SparqlQueryOptions): Promise<SparqlExecutionResult<boolean | string>>;
}
