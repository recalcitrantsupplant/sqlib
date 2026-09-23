/**
 * Running a query against a browser backend, from the browser.
 *
 * A browser backend is registered in the visitor's own storage
 * (`useBrowserBackends`), and this is the half that makes the claim on its
 * label true: the request goes from the tab to the endpoint, so neither the
 * endpoint, the query, the credentials nor the results pass through sqlib. On
 * a public deployment that is the difference between a demo and a proxy
 * someone can point at whatever the host can reach.
 *
 * **Why not `httpExecutor` from `@sparql-query-lib/runtime`.** It is the same
 * idea and the transport heuristic below is deliberately its heuristic, but it
 * owns two decisions this call site cannot give it. It picks `Accept` from the
 * query type, where the results panel lets a visitor ask for CSV or TSV; and it
 * returns parsed results, where every caller here wants the endpoint's own
 * bytes — the server path hands back a string and a content type, and a browser
 * backend that re-serialised through `JSON.stringify` would be a different
 * answer for the same query. It also has no update path, having been written
 * for exported read-only bundles. Keeping this separate leaves the runtime's
 * published surface alone.
 */
import { SparqlEndpointError } from '@sparql-query-lib/runtime';
import type { BrowserBackend } from '../composables/useBrowserBackends';

/** URL length above which a GET becomes a POST. `httpExecutor`'s figure. */
const MAX_URL_LENGTH = 1800;

const RESULTS_ACCEPT = 'application/sparql-results+json';

/**
 * The update verbs, for the fallback when a caller has no query type to pass.
 *
 * A real parse belongs on the server — it is what `POST /detect-inputs` is for,
 * and it stays available on a read-only deployment. This exists for the call
 * that has not asked yet, and it is a keyword scan rather than a parse on
 * purpose: shipping a SPARQL parser to the browser is the cost the parser-free
 * runtime exists to avoid.
 */
const UPDATE_VERBS =
  /^(INSERT|DELETE|LOAD|CLEAR|CREATE|DROP|ADD|MOVE|COPY|WITH)\b/i;

/** Strip comments and the PREFIX/BASE prologue, as `isSrlDocument` does server-side. */
function afterPrologue(query: string): string {
  return query.replace(
    /^(?:\s|#[^\n]*(?:\n|$)|(?:PREFIX\s+(?:[A-Za-z][\w-]*)?:\s*<[^>]*>|BASE\s*<[^>]*>)\s*)*/i,
    ''
  );
}

export function looksLikeUpdate(query: string): boolean {
  return UPDATE_VERBS.test(afterPrologue(query));
}

export interface BrowserExecutionRequest {
  backend: BrowserBackend;
  query: string;
  /** What the results panel asked for. Falls back to SPARQL Results JSON. */
  acceptMediaType?: string | null;
  /**
   * `'update'` or `'query'` when the caller already knows — it usually does,
   * having asked the server to detect inputs. Omitted, the keyword scan decides.
   */
  operation?: 'query' | 'update';
  signal?: AbortSignal;
}

export interface BrowserExecutionResult {
  body: string;
  contentType: string | null;
  timing: { breakdown: { clientTotalMs: number } };
}

/**
 * A request the browser would not let us make, or an endpoint that is not there.
 *
 * Worth its own type because the common cause has a specific fix and a generic
 * "failed to fetch" hides it: a SPARQL endpoint that sends no
 * `Access-Control-Allow-Origin` is invisible to a page on another origin, and
 * the browser reports that as an opaque network failure with no status. Telling
 * a visitor their endpoint is unreachable, when it is running and they can curl
 * it, is the kind of wrong answer that ends the demo.
 */
export class BrowserBackendUnreachableError extends Error {
  readonly endpoint: string;

  constructor(endpoint: string, cause: unknown) {
    super(
      `Could not reach ${endpoint} from your browser. ` +
        'The endpoint may be offline, or it may not allow browser requests from other ' +
        'sites (CORS): a SPARQL endpoint has to send an Access-Control-Allow-Origin ' +
        'header for a page like this one to read its answers. An endpoint that works ' +
        'from curl can still fail here for that reason.'
    );
    this.name = 'BrowserBackendUnreachableError';
    this.endpoint = endpoint;
    this.cause = cause;
  }
}

function acceptFor(request: BrowserExecutionRequest): string {
  const asked = request.acceptMediaType?.trim();
  return asked && asked.length > 0 ? asked : RESULTS_ACCEPT;
}

/**
 * Run it. Throws `BrowserBackendUnreachableError` when the browser refused or
 * the host did not answer, and `SparqlEndpointError` — the runtime's, so a
 * caller already handling one from an exported bundle needs no second branch —
 * when the endpoint answered with a non-2xx.
 */
export async function executeOnBrowserBackend(
  request: BrowserExecutionRequest,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch
): Promise<BrowserExecutionResult> {
  const { backend, query, signal } = request;
  const endpoint = backend.endpoint;
  const accept = acceptFor(request);
  const isUpdate = (request.operation ?? (looksLikeUpdate(query) ? 'update' : 'query')) === 'update';
  const started = Date.now();

  const getUrl = `${endpoint}${endpoint.includes('?') ? '&' : '?'}query=${encodeURIComponent(query)}`;
  /*
   * An update is always a POST: there is no GET form of one, and the
   * `queryMethod` a visitor chose describes how their endpoint likes to be
   * read. `'get'` is honoured as asked; `null` takes the length heuristic,
   * which keeps short queries cacheable and skips a CORS preflight.
   */
  const useGet =
    !isUpdate && (backend.queryMethod === 'get' || (backend.queryMethod === null && getUrl.length <= MAX_URL_LENGTH));

  let response: Response;
  try {
    if (useGet) {
      response = await fetchImpl(getUrl, {
        method: 'GET',
        headers: { Accept: accept, ...backend.headers },
        signal,
      });
    } else {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Accept: accept,
          'Content-Type': isUpdate ? 'application/sparql-update' : 'application/sparql-query',
          ...backend.headers,
        },
        body: query,
        signal,
      });
    }
  } catch (error) {
    // An abort is the caller's own doing; everything else here is the browser
    // declining to make the request or nobody answering.
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new BrowserBackendUnreachableError(endpoint, error);
  }

  const body = await response.text();

  if (!response.ok) {
    throw new SparqlEndpointError(
      `SPARQL endpoint returned ${response.status} ${response.statusText}.`,
      response.status,
      body.slice(0, 2000)
    );
  }

  return {
    body,
    contentType: response.headers.get('content-type'),
    // No server leg to report, so the client total is the whole of it.
    timing: { breakdown: { clientTotalMs: Date.now() - started } },
  };
}
