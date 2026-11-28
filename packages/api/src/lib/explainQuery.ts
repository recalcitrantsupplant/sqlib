/**
 * In-process `inject` calls to `/execute` can ask for the SPARQL text that
 * the call would run, with its arguments substituted, in place of the result.
 * The OGC routes use it for a collection's `sparql` link.
 *
 * The header carries a token made at start-up. A client outside the process
 * cannot know it, so `/execute` never shows query text to a caller who may
 * only run the query.
 */
export const EXPLAIN_HEADER = 'x-sqlib-explain';
export const EXPLAIN_TOKEN: string = globalThis.crypto.randomUUID();

export const SPARQL_QUERY_TYPE = 'application/sparql-query; charset=utf-8';

export function wantsExplain(headers: Record<string, string | string[] | undefined>): boolean {
  return headers[EXPLAIN_HEADER] === EXPLAIN_TOKEN;
}
