/**
 * The ETL loop: read rows a chunk at a time, map them to bindings, splice them
 * into the CONSTRUCT as one `VALUES` block, run it, and hand the RDF to a sink.
 *
 * Moved from `EtlService.runPipeline` in `packages/api`, which now calls it.
 * It has no source, store or transport of its own. The caller supplies the rows
 * (a DuckDB stream, or fixture rows in a test), the query (a compiled template,
 * or a function that applies arguments), the executor and the sink. So the API
 * and the CLI run the same loop, and differ only in what they plug into it.
 */
import {
  applyTemplateArguments,
  type Executor,
  type QueryTemplate,
  type TemplateArgumentSet,
} from '@sparql-query-lib/runtime';
import { rowsToBindings, toArgumentSet, type ColumnDefinition, type EtlWarning } from './columns.js';

/** What is known about one chunk's CONSTRUCT result besides its text. */
export interface EtlOutputChunk {
  /** Zero-based position of the chunk in the run. */
  index: number;
  /** The content type the executor reported for this result, if it did. */
  contentType?: string;
}

export interface EtlRun {
  /** The source rows, a chunk at a time. */
  source: AsyncIterable<{ rows: Record<string, unknown>[] }>;
  /**
   * The CONSTRUCT with one parameter slot the mapped variables fill. A compiled
   * template is spliced by the runtime; a function receives the chunk's
   * argument set and returns the query text, which is how a host with a parser
   * applies arguments its own way.
   */
  query: QueryTemplate | ((argumentSet: TemplateArgumentSet) => string);
  columns: ColumnDefinition[];
  /** Where each chunk's CONSTRUCT runs. */
  executor: Executor;
  /**
   * Where each chunk's RDF goes, as soon as it exists. The loop keeps no output
   * of its own, so the run holds one chunk's RDF at a time whatever the
   * source's size.
   */
  onOutput: (rdf: string, chunk: EtlOutputChunk) => Promise<void>;
  /** Progress, after each chunk. */
  onChunk?: (progress: { completedChunks: number; totalRows: number }) => Promise<void>;
  maxRows?: number;
  /**
   * What `maxRows` means. `stop` (the default) ends the run at the next chunk
   * boundary; `fail` throws, for a caller whose result is only meaningful whole.
   */
  maxRowsPolicy?: 'stop' | 'fail';
  /** Stop after the first chunk. */
  dryRun?: boolean;
  /** Stops the run at the next chunk, and is passed to each chunk's request. */
  signal?: AbortSignal;
  /** Turns an aborted signal into the error to throw. Default: its reason. */
  abortError?: (signal: AbortSignal) => Error;
  /** Rows that map with a problem the run continues past. */
  warn?: EtlWarning;
}

export interface EtlResult {
  totalRows: number;
  completedChunks: number;
}

function defaultAbortError(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : 'The run was aborted');
}

export async function runEtl(run: EtlRun): Promise<EtlResult> {
  const abortError = run.abortError ?? defaultAbortError;
  const render = typeof run.query === 'function'
    ? run.query
    : (() => {
        const template = run.query;
        return (argumentSet: TemplateArgumentSet) => applyTemplateArguments(template, [argumentSet]);
      })();
  // The cap under the `fail` policy, or null when there is none to fail on.
  const rowCap = run.maxRowsPolicy === 'fail' ? run.maxRows ?? null : null;
  let completedChunks = 0;
  let totalRows = 0;

  for await (const { rows } of run.source) {
    if (run.signal?.aborted) throw abortError(run.signal);
    totalRows += rows.length;

    // Checked before the rows are used rather than at the chunk boundary
    // below: a cap that must fail has to fail on the chunk that broke it, or
    // the run has already paid for what it then refuses to report.
    if (rowCap !== null && totalRows > rowCap) {
      throw new Error(
        `The source query produced more than ${rowCap} rows. `
        + 'This run stops rather than truncating, because a partial result is not the result.',
      );
    }

    const bindings = rowsToBindings(rows, run.columns, run.warn);

    if (bindings.length > 0) {
      const queryText = render(toArgumentSet(bindings, run.columns));
      const result = await run.executor.execute({ queryText, queryType: 'CONSTRUCT', signal: run.signal });
      if ('data' in result && typeof result.data === 'string') {
        await run.onOutput(result.data, {
          index: completedChunks,
          ...(result.contentType ? { contentType: result.contentType } : {}),
        });
      }
    }

    completedChunks++;
    await run.onChunk?.({ completedChunks, totalRows });

    // Dry run: stop after the first chunk. Leaving the loop ends the source
    // iterator, which closes whatever it reads from.
    if (run.dryRun) break;

    // Max rows: honoured at a chunk boundary. Not under the `fail` policy,
    // where stopping here would truncate silently a source of exactly
    // `maxRows + 1` rows, which is the outcome that policy refuses.
    if (rowCap === null && run.maxRows && totalRows >= run.maxRows) break;
  }

  return { totalRows, completedChunks };
}
