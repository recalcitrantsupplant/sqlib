import type { ISparqlExecutor } from '../server/ISparqlExecutor.js';
import { SparqlQueryParser, type ApplyArgumentSet } from './parser.js';
import { QueryTypeIri } from '../constants/queryTypes.js';
import { toQueryTypeIri } from './queryTypes.js';
import type { NodeResult } from './orchestration/types.js';

/** A `LIMIT`/`OFFSET` value, named by the placeholder it fills. */
export type PageParameter = { name: string; value: number };

export type InvokeCallableOptions = {
  /** Table arguments, one per VALUES slot the caller has resolved. */
  argumentSets?: ApplyArgumentSet[];
  limits?: PageParameter[];
  offsets?: PageParameter[];
  /** For CONSTRUCT/DESCRIBE: the RDF syntax to ask the backend for. */
  acceptHeader?: string | null;
  /**
   * Stops a query in flight. Not passed to an UPDATE: aborting a write a
   * remote store may already be applying would leave its outcome unknown, so
   * an update is never cancelled once sent (a caller may stop waiting for it).
   */
  signal?: AbortSignal;
  parser?: SparqlQueryParser;
};

export type InvokeCallableResult = {
  result: NodeResult;
  /** What the backend said its answer is, for RDF results. */
  contentType?: string;
};

const defaultParser = new SparqlQueryParser();

/**
 * Run one saved query: page parameters, then table arguments, then the
 * executor call its type calls for.
 *
 * The one implementation of "invoke a callable". A query node in a group, a
 * test case and a benchmark task each did this for themselves, and the copies
 * drifted: one skipped UPDATE and ran it as a SELECT, two left an unfilled
 * VALUES slot in the text sent to the endpoint. Numbers go first because
 * substitution rewrites `LIMIT 000name` in the text, before the AST rewrite
 * that splices VALUES blocks; arguments are always applied, even when there
 * are none, so an open slot is resolved by its `whenEmpty` rather than shipped
 * as an UNDEF row.
 */
export async function invokeCallable(
  executor: ISparqlExecutor,
  queryString: string,
  queryType: string | null | undefined,
  options: InvokeCallableOptions = {},
): Promise<InvokeCallableResult> {
  const parser = options.parser ?? defaultParser;
  const limits = options.limits ?? [];
  const offsets = options.offsets ?? [];
  const paged = limits.length || offsets.length
    ? parser.applyLimitOffsetParameters(queryString, limits, offsets)
    : queryString;
  const query = parser.applyArguments(paged, options.argumentSets ?? []);
  const signal = options.signal;

  const type = toQueryTypeIri(queryType) || QueryTypeIri.select;
  if (type === QueryTypeIri.ask) {
    const { result } = await executor.askQuery(query, { signal });
    return { result };
  }
  if (type === QueryTypeIri.update) {
    await executor.update(query);
    return { result: { success: true } };
  }
  if (type === QueryTypeIri.construct || type === QueryTypeIri.describe) {
    const { result, contentType } = await executor.constructQueryParsed(query, {
      acceptHeader: options.acceptHeader || undefined,
      signal,
    });
    return { result, contentType };
  }
  const { result } = await executor.selectQueryParsed(query, { signal });
  return { result };
}
