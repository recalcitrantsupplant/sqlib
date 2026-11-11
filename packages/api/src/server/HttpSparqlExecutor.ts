import { Dispatcher, Agent } from 'undici'; // Import Agent
import { ISparqlExecutor, SparqlSelectJsonOutput, SparqlQueryOptions, SparqlExecutionResult, type SparqlDataset } from './ISparqlExecutor.js'; // Import SparqlQueryOptions
import { datasetProtocolParameters, hasDataset } from '../lib/dataset.js';
import { config } from './config.js';
import { log } from '../lib/log.js';
// Define a simpler config type specifically for the HTTP executor's needs
// This avoids requiring a full Backend entity for internal setup.
interface HttpExecutorConfig {
    queryUrl: string;
    updateUrl?: string; // Optional, defaults to queryUrl if not provided
    username?: string; // Optional basic auth username
    password?: string; // Optional basic auth password
    authHeader?: string; // Optional explicit Authorization header (Bearer, Basic, etc.)
    connectTimeout?: number; // Connection timeout in milliseconds (default: 60000)
    bodyTimeout?: number; // Body/response timeout in milliseconds (default: 120000)
    queryMethod?: 'post' | 'get' | 'query'; // HTTP method for SPARQL queries (default: 'post')
}

/**
 * The longest URL sent with the QUERY method. A dataset goes in the URL of a
 * QUERY request, so a long graph list is sent as a POST form instead. The
 * value matches the browser and runtime executors.
 */
export const QUERY_METHOD_MAX_URL_LENGTH = 1800;

/** How long a backend that refused QUERY is sent POST instead. */
export const QUERY_METHOD_REFUSAL_TTL_MS = 10 * 60 * 1000;

/**
 * Query endpoints that answered QUERY with 405 or 501, and when. RFC 10008
 * QUERY is new (June 2026), so a server or a proxy in front of it can refuse
 * it. A SPARQL query is safe to send again, so sqlib retries it as a POST.
 */
const queryMethodRefusals = new Map<string, number>();

function queryMethodRefused(endpoint: string): boolean {
  const at = queryMethodRefusals.get(endpoint);
  if (at === undefined) return false;
  if (Date.now() - at > QUERY_METHOD_REFUSAL_TTL_MS) {
    queryMethodRefusals.delete(endpoint);
    return false;
  }
  return true;
}

/** Forget every QUERY refusal. For tests. */
export function resetQueryMethodRefusals(): void {
  queryMethodRefusals.clear();
}


// Keep-Alive Agent for connection reuse with IPv4-only to avoid dual-stack connection issues
const keepAliveAgent = new Agent({
    keepAliveTimeout: 60 * 1000, // 1 minute
    keepAliveMaxTimeout: 5 * 60 * 1000, // 5 minutes
    connect: {
        timeout: 60 * 1000, // 60 second connection timeout (default is ~10s)
        family: 4, // Force IPv4 only to avoid dual-stack connection issues
    },
    bodyTimeout: 120 * 1000, // 120 second body/response timeout
    headersTimeout: 60 * 1000, // 60 second headers timeout
});


// --- Helper Functions (Internal to HTTP Executor) ---

/**
 * Executes a raw SPARQL request via HTTP and returns the undici response object.
 * Handles authentication and content negotiation.
 * @internal
 */
async function executeHttpRequestRaw(
  executorConfig: HttpExecutorConfig, // Use the simpler config type
  query: string,
  acceptHeader: string,
  isUpdate: boolean = false, // Flag to determine which endpoint to use
  signal?: AbortSignal,
  dataset?: SparqlDataset,
): Promise<{response: Dispatcher.ResponseData, duration: number}> { // Return duration
  // Destructure the simpler config type
  const { username, password, authHeader, queryUrl, updateUrl: configUpdateUrl, queryMethod = 'post' } = executorConfig;

  // Determine the endpoint URL to use
  const updateEndpoint = configUpdateUrl || queryUrl; // Default update URL to query URL
  const endpointUrl = isUpdate ? updateEndpoint : queryUrl;

  if (!endpointUrl) { // Should not happen if constructor validates, but check anyway
    throw new Error(`HTTP SPARQL ${isUpdate ? 'update' : 'query'} endpoint URL is not configured.`);
  }

  // Auth precedence: Basic (username+password) > explicit header > none
  const basicAuth = username && password ? `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` : undefined;
  const effectiveAuth = basicAuth || authHeader || undefined;

  const targetUrl = new URL(endpointUrl); // Start with the base URL as a URL object

  // Build common headers
  const baseHeaders: Record<string, string> = {
    'Accept': acceptHeader,
    'User-Agent': process.env.HTTP_SPARQL_USER_AGENT || 'sparql-query-lib/adhoc',
    ...(effectiveAuth ? { 'Authorization': effectiveAuth } : {})
  };

  const send = async (requestOptions: Dispatcher.RequestOptions, url: URL) => {
    const requestUrlString = url.toString(); // Get the full URL string for logging/request
    const requestLabel = `HTTP SPARQL ${isUpdate ? 'UPDATE' : 'Query'} Request (${requestOptions.method}) to ${requestUrlString}`;
    const startTime = performance.now();
    try {
      // Use keepAliveAgent.request instead of global request
      const response = await keepAliveAgent.request({
          origin: url.origin, // Need to provide origin separately for agent.request
          ...requestOptions, // Spread the rest of the options (method, path, headers, body)
          // Aborts the request and its body when the execution it serves stops.
          ...(signal ? { signal } : {}),
      });
      const duration = performance.now() - startTime;
      if (config.enableTimingLogs) log.info({ durationMs: Math.round(duration) }, requestLabel);
      return { response, duration };
    } catch (error) {
      const duration = performance.now() - startTime;
      if (config.enableTimingLogs) log.info({ durationMs: Math.round(duration) }, requestLabel);
      log.error({ err: error, url: requestUrlString }, `Error executing ${requestLabel}`);
      throw error; // Re-throw network or setup errors
    }
  };

  // --- SPARQL Query (POST form) ---
  // A dataset goes in the form body: one `default-graph-uri` or
  // `named-graph-uri` pair per graph soon outgrows a URL (Fuseki answered 414
  // at 10,000 graphs, and an 8 KB proxy limit holds about 145), so a GET
  // backend is sent a POST when a dataset is present, and a QUERY backend when
  // the URL would pass QUERY_METHOD_MAX_URL_LENGTH.
  const postForm = (): Dispatcher.RequestOptions => ({
    method: 'POST',
    headers: {
      ...baseHeaders,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: [['query', query], ...datasetProtocolParameters(dataset)]
      .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
      .join('&'),
    path: targetUrl.pathname + targetUrl.search,
  });

  if (isUpdate) {
    // --- SPARQL Update (POST) ---
    // UPDATE operations MUST use POST per SPARQL 1.1 Protocol specification.
    // QUERY (RFC 10008) is a safe method, so it never carries an update.
    const body = `update=${encodeURIComponent(query)}`;
    return send({
      method: 'POST',
      headers: {
        ...baseHeaders,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
      path: targetUrl.pathname + targetUrl.search
    }, targetUrl);
  }

  if (queryMethod === 'get' && !hasDataset(dataset)) {
    // --- SPARQL Query (GET) ---
    targetUrl.searchParams.set('query', query);
    return send({
      method: 'GET',
      headers: {
        ...baseHeaders,
      },
      path: targetUrl.pathname + targetUrl.search
    }, targetUrl);
  }

  if (queryMethod === 'query' && !queryMethodRefused(queryUrl)) {
    // --- SPARQL Query (QUERY, RFC 10008) ---
    // The query is the body, as for a direct POST (SPARQL 1.2 Protocol §2.1),
    // and the dataset goes in the URL. A form body is not used: Fuseki finds
    // the `query` parameter through the servlet API, which reads a form body
    // for POST only.
    const queryTarget = new URL(targetUrl);
    for (const [name, value] of datasetProtocolParameters(dataset)) queryTarget.searchParams.append(name, value);
    if (queryTarget.toString().length <= QUERY_METHOD_MAX_URL_LENGTH) {
      const sent = await send({
        method: 'QUERY',
        headers: {
          ...baseHeaders,
          'Content-Type': 'application/sparql-query',
        },
        body: query,
        path: queryTarget.pathname + queryTarget.search,
      }, queryTarget);
      const status = sent.response.statusCode;
      if (status !== 405 && status !== 501) return sent;
      // The server, or a proxy in front of it, does not take QUERY. Send the
      // same query as a POST, and keep sending POST for a while.
      await sent.response.body.text().catch(() => undefined);
      queryMethodRefusals.set(queryUrl, Date.now());
      log.warn({ endpoint: queryUrl, status }, 'SPARQL endpoint refused the QUERY method; sending POST instead');
    }
  }

  return send(postForm(), targetUrl);
}

/**
 * Checks the HTTP response status code and throws an error if not successful (2xx).
 * Reads the body text for inclusion in the error message.
 * @internal
 */
async function checkHttpResponseStatus(response: Dispatcher.ResponseData): Promise<void> {
  if (response.statusCode < 200 || response.statusCode >= 300) {
    let responseBody = '';
    try {
      responseBody = await response.body.text();
    } catch (e) {
      responseBody = '(Failed to read response body)';
    }
    throw new Error(`HTTP SPARQL query failed with status ${response.statusCode}: ${responseBody}`);
  }
}


// --- HTTP SPARQL Executor Implementation ---

/**
 * Implements ISparqlExecutor for standard SPARQL endpoints via HTTP.
 * Expects fully formed query strings as input.
 */
export class HttpSparqlExecutor implements ISparqlExecutor {
  private executorConfig: HttpExecutorConfig; // Store the simpler config

  constructor(executorConfig: HttpExecutorConfig) { // Accept simpler config
    // Validate the configuration
    if (!executorConfig || !executorConfig.queryUrl) {
      throw new Error("Cannot initialize HttpSparqlExecutor: queryUrl is required in configuration.");
    }
    // Store the validated config with defaults
    this.executorConfig = {
        ...executorConfig,
        // Ensure updateUrl defaults to queryUrl if not provided
        updateUrl: executorConfig.updateUrl || executorConfig.queryUrl,
        // Ensure queryMethod defaults to 'post' if not provided
        queryMethod: executorConfig.queryMethod || 'post'
    };
  }

  /**
   * Executes a SPARQL SELECT query and returns the parsed JSON output object.
   * If a non-JSON Accept header is provided, returns the raw response as text.
   */
  async selectQueryParsed(
    sparqlQuery: string, // Expects final query string
    options?: SparqlQueryOptions
  ): Promise<SparqlExecutionResult<SparqlSelectJsonOutput | string>> {
    // Determine the Accept header: use provided option or default
    const acceptHeader = options?.acceptHeader || 'application/sparql-results+json';
    // Use the stored executorConfig
    const { response, duration } = await executeHttpRequestRaw(this.executorConfig, sparqlQuery, acceptHeader, false, options?.signal, options?.dataset);
    await checkHttpResponseStatus(response); // Throw on non-2xx status

    // Check the actual Content-Type returned by the server
    const contentType = response.headers['content-type']?.toString().toLowerCase() || '';

    // If the response is JSON, parse it as JSON
    if (contentType.includes('application/sparql-results+json') || contentType.includes('application/json')) {
      try {
        const results = await response.body.json() as SparqlSelectJsonOutput;
        // Basic validation of the result structure
        if (!results || !results.head || !results.results) {
          throw new Error('Invalid SPARQL JSON output format received.');
        }
        return { result: results, duration, contentType: response.headers['content-type']?.toString() };
      } catch (error) {
        log.error({ err: error }, 'Error parsing SPARQL JSON output');
        throw new Error(`Failed to parse SPARQL JSON output: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      // For non-JSON responses (e.g., text/turtle, application/rdf+xml), return as text
      try {
        const textResult = await response.body.text();
        return { result: textResult, duration, contentType: response.headers['content-type']?.toString() };
      } catch (error) {
        log.error({ err: error }, 'Error reading response body as text');
        throw new Error(`Failed to read response body: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  /**
   * Executes a SPARQL CONSTRUCT query and returns the resulting RDF graph as a string.
   */
  async constructQueryParsed(
    sparqlQuery: string, // Expects final query string
    options?: SparqlQueryOptions
  ): Promise<SparqlExecutionResult<string>> {
    // Determine the Accept header: use provided option or default (N-Quads is a reasonable default for parsed string)
    const acceptHeader = options?.acceptHeader || 'application/n-quads';
    // Use the stored executorConfig
    const { response, duration } = await executeHttpRequestRaw(this.executorConfig, sparqlQuery, acceptHeader, false, options?.signal, options?.dataset);
    await checkHttpResponseStatus(response); // Throw on non-2xx status

    try {
      const nquadsString = await response.body.text();
      // Optional: Add basic validation (e.g., check if empty) if needed
      return { result: nquadsString, duration, contentType: response.headers['content-type']?.toString() };
    } catch (error) {
      log.error({ err: error }, 'Error reading N-Quads response body');
      throw new Error(`Failed to read N-Quads response body: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Executes a SPARQL SELECT query and returns the raw undici response object for streaming.
   */
  async selectQueryStream(
    sparqlQuery: string, // Expects final query string
    options?: SparqlQueryOptions
  ): Promise<Dispatcher.ResponseData> {
      // Determine the Accept header: use provided option or default
      const acceptHeader = options?.acceptHeader || 'application/sparql-results+json';
      // Use the stored executorConfig
      const { response } = await executeHttpRequestRaw(this.executorConfig, sparqlQuery, acceptHeader, false, options?.signal, options?.dataset);
      await checkHttpResponseStatus(response); // Ensure it's a successful response before returning stream
      return response;
  }

  /**
   * Executes a SPARQL CONSTRUCT query and returns the raw undici response object for streaming.
   */
  async constructQueryStream(
    sparqlQuery: string, // Expects final query string
    options?: SparqlQueryOptions
  ): Promise<Dispatcher.ResponseData> {
      // Determine the Accept header: use provided option or default
      const acceptHeader = options?.acceptHeader || 'application/n-triples';
      // Use the stored executorConfig
      const { response } = await executeHttpRequestRaw(this.executorConfig, sparqlQuery, acceptHeader, false, options?.signal, options?.dataset);
      await checkHttpResponseStatus(response); // Ensure it's a successful response before returning stream
      return response;
  }

  /**
   * Executes a SPARQL UPDATE query (e.g., INSERT, DELETE).
   */
  async update(sparqlUpdateQuery: string): Promise<SparqlExecutionResult<void>> {
    // Use the stored executorConfig, executeHttpRequestRaw handles using updateUrl
    const { response, duration } = await executeHttpRequestRaw(this.executorConfig, sparqlUpdateQuery, '*/*', true);
    await checkHttpResponseStatus(response); // Check status even for updates
    return { result: undefined, duration };
  }

  /**
   * Executes a SPARQL ASK query and returns the boolean result.
   * If a non-JSON Accept header is provided, returns the raw response as text.
   */
  async askQuery(
    sparqlAskQuery: string,
    options?: SparqlQueryOptions
  ): Promise<SparqlExecutionResult<boolean | string>> {
    // ASK queries typically return JSON with a "boolean" field
    const acceptHeader = options?.acceptHeader || 'application/sparql-results+json';
    const { response, duration } = await executeHttpRequestRaw(this.executorConfig, sparqlAskQuery, acceptHeader, false, options?.signal, options?.dataset);
    await checkHttpResponseStatus(response); // Throw on non-2xx status

    // Check the actual Content-Type returned by the server
    const contentType = response.headers['content-type']?.toString().toLowerCase() || '';

    // If the response is JSON, parse it as JSON
    if (contentType.includes('application/sparql-results+json') || contentType.includes('application/json')) {
      try {
        // The result structure is { head: {}, boolean: true/false }
        const results = await response.body.json() as { head: object; boolean: boolean };
        if (typeof results.boolean !== 'boolean') {
          throw new Error('Invalid SPARQL ASK JSON output format received: "boolean" field missing or not a boolean.');
        }
        return { result: results.boolean, duration, contentType: response.headers['content-type']?.toString() };
      } catch (error) {
        log.error({ err: error }, 'Error parsing SPARQL ASK JSON output');
        throw new Error(`Failed to parse SPARQL ASK JSON output: ${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      // For non-JSON responses, return as text
      try {
        const textResult = await response.body.text();
        return { result: textResult, duration, contentType: response.headers['content-type']?.toString() };
      } catch (error) {
        log.error({ err: error }, 'Error reading response body as text');
        throw new Error(`Failed to read response body: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
