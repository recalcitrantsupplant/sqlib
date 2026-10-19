/**
 * Present an API executor as a runtime `Executor`.
 *
 * The API runs SPARQL through `ISparqlExecutor`, which has a method per query
 * form and, for the HTTP case, undici response types. The packages that run
 * outside the API (`@sparql-query-lib/runtime` and the ETL and rule runtimes
 * built on it) take the runtime's `Executor`: one `execute`, plus `update`. This
 * adapter lets the API hand either of its executors, HTTP or Oxigraph, to that
 * code unchanged, so a loop moved out of the API keeps running against the
 * backend and credentials the API resolved.
 */
import type {
  ExecutionRequest,
  ExecutionResult,
  Executor,
  SparqlSelectResults,
  UpdateRequest,
} from '@sparql-query-lib/runtime';
import type { ISparqlExecutor } from './ISparqlExecutor.js';

const RESULTS_JSON = 'application/sparql-results+json';

export interface RuntimeExecutorOptions {
  /** Serialisation to ask for from CONSTRUCT/DESCRIBE. Default `text/turtle`. */
  rdfAccept?: string;
}

/**
 * Parse a result an executor could only return as text.
 *
 * Both API executors fall back to the response text when an endpoint answers
 * with something other than JSON. The runtime's contract is parsed results, so
 * text is parsed here, and text that is not JSON is refused rather than passed
 * on as if it were a result.
 */
function parseResultsText(text: string, queryType: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `The ${queryType} query returned a body that is not SPARQL Results JSON: ${text.slice(0, 200)}`,
    );
  }
}

export function toRuntimeExecutor(
  executor: ISparqlExecutor,
  options: RuntimeExecutorOptions = {},
): Executor & { update(request: UpdateRequest): Promise<void> } {
  const rdfAccept = options.rdfAccept ?? 'text/turtle';

  return {
    async execute({ queryText, queryType, signal }: ExecutionRequest): Promise<ExecutionResult> {
      switch (queryType) {
        case 'CONSTRUCT':
        case 'DESCRIBE': {
          const { result, contentType } = await executor.constructQueryParsed(queryText, {
            acceptHeader: rdfAccept,
            signal,
          });
          return { contentType: contentType ?? rdfAccept, data: result };
        }
        case 'ASK': {
          const { result } = await executor.askQuery(queryText, { acceptHeader: RESULTS_JSON, signal });
          if (typeof result === 'boolean') return { head: {}, boolean: result };
          const parsed = parseResultsText(result, queryType) as { boolean?: unknown };
          if (typeof parsed.boolean !== 'boolean') {
            throw new Error('The ASK query returned SPARQL Results JSON with no boolean.');
          }
          return { head: {}, boolean: parsed.boolean };
        }
        case 'SELECT': {
          const { result } = await executor.selectQueryParsed(queryText, { acceptHeader: RESULTS_JSON, signal });
          return (typeof result === 'string' ? parseResultsText(result, queryType) : result) as SparqlSelectResults;
        }
        default:
          throw new Error(`Unsupported query type: ${String(queryType)}`);
      }
    },

    async update({ updateText, signal }: UpdateRequest): Promise<void> {
      // `ISparqlExecutor.update` takes no signal, so the abort is honoured
      // before the update starts and not during it.
      signal?.throwIfAborted();
      await executor.update(updateText);
    },
  };
}
