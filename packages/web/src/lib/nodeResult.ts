/**
 * One node's result from a query group run, in the shape the results viewer
 * takes.
 *
 * `/execute` with `nodeDetail: 'results'` hands back each node's own result
 * beside the group's. A CONSTRUCT or DESCRIBE node's result is a string of
 * N-Triples; a SELECT or ASK node's is a SPARQL JSON document. The server caps
 * what it sends, so a node with no result here may still have run.
 */
import type { InjectionKey } from 'vue';
import type { NodeExecutionDetail } from '../composables/queryGroupTypes';

/** Provided by the group work area: open the Results tab on one node's result. */
export const SHOW_NODE_RESULT: InjectionKey<(nodeId: string) => void> = Symbol('showNodeResult');

export interface NodeResultView {
  raw: string;
  json: unknown;
  contentType: 'application/n-triples' | 'application/sparql-results+json';
}

export function nodeResultView(detail: NodeExecutionDetail | null | undefined): NodeResultView | null {
  const result = detail?.result;
  if (result === undefined || result === null) return null;
  if (typeof result === 'string') {
    return { raw: result, json: null, contentType: 'application/n-triples' };
  }
  if (typeof result === 'object') {
    return { raw: JSON.stringify(result), json: result, contentType: 'application/sparql-results+json' };
  }
  return null;
}

/** "12 rows", "3 triples", or null when the run reported no count. */
export function nodeResultSize(detail: NodeExecutionDetail): string | null {
  if (typeof detail.tripleCount === 'number') {
    return `${detail.tripleCount} ${detail.tripleCount === 1 ? 'triple' : 'triples'}`;
  }
  if (typeof detail.rowCount === 'number') {
    return `${detail.rowCount} ${detail.rowCount === 1 ? 'row' : 'rows'}`;
  }
  return null;
}
