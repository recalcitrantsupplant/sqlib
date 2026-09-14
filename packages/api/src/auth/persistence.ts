/**
 * Durable storage for the auth graph.
 *
 * The graph lives in the library storage backend, reached through the same
 * executor everything else uses. `ExecutorFactory` is imported dynamically: it
 * depends on the enforcement helpers, and a static import here would close a
 * module cycle for no benefit.
 */
import { LIBRARY_STORAGE_BACKEND_ID } from '@sparql-query-lib/types';
import type { AuthGraphPersistence } from './AuthStore.js';
import { AUTH_GRAPH_IRI } from './vocabulary.js';

async function libraryStorageExecutor() {
  const { ExecutorFactory } = await import('../lib/orchestration/ExecutorFactory.js');
  return new ExecutorFactory().getExecutorForBackendId(LIBRARY_STORAGE_BACKEND_ID);
}

/**
 * Reads and writes the auth graph with plain SPARQL.
 *
 * Writes name their quads explicitly (`INSERT DATA` / `DELETE DATA`) rather than
 * using patterns, so a malformed grant can never delete more than itself.
 */
export function sparqlAuthGraphPersistence(): AuthGraphPersistence {
  return {
    async load(): Promise<string> {
      const executor = await libraryStorageExecutor();
      const { result } = await executor.constructQueryParsed(
        `CONSTRUCT { ?s ?p ?o } WHERE { GRAPH <${AUTH_GRAPH_IRI}> { ?s ?p ?o } }`,
        { acceptHeader: 'application/n-triples' }
      );

      const triples = typeof result === 'string' ? result.trim() : '';
      if (!triples) return '';

      // CONSTRUCT returns triples; the store needs them back in the auth graph.
      return triples
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => `${line.replace(/\s*\.\s*$/, '')} <${AUTH_GRAPH_IRI}> .`)
        .join('\n');
    },

    async apply({ insert, delete: toDelete }): Promise<void> {
      const executor = await libraryStorageExecutor();

      if (toDelete?.trim()) {
        await executor.update(
          `DELETE DATA { GRAPH <${AUTH_GRAPH_IRI}> { ${stripGraphTerm(toDelete)} } }`
        );
      }
      if (insert?.trim()) {
        await executor.update(
          `INSERT DATA { GRAPH <${AUTH_GRAPH_IRI}> { ${stripGraphTerm(insert)} } }`
        );
      }
    },
  };
}

/**
 * Converts N-Quads to the triples a `GRAPH { … }` block expects: the graph term
 * is already stated by the block, and repeating it is a syntax error.
 */
function stripGraphTerm(nquads: string): string {
  return nquads
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const withoutDot = line.replace(/\s*\.\s*$/, '');
      const graphSuffix = ` <${AUTH_GRAPH_IRI}>`;
      const base = withoutDot.endsWith(graphSuffix)
        ? withoutDot.slice(0, -graphSuffix.length)
        : withoutDot;
      return `${base} .`;
    })
    .join('\n');
}
