/**
 * Durable storage for the auth graph: a store of its own, never the library store.
 *
 * Grants decide who may see everything else, so they do not travel with the
 * libraries. A backup, restore or reset of the library store leaves them
 * alone, and no export or library-store query can reach them.
 *
 * Three kinds, chosen by `SQLIB_AUTH_STORE_TYPE` (see `config.ts`):
 * - `sqlite` (default): one SQLite file, written per change, with an audit
 *   trail. See `sqlitePersistence.ts`.
 * - `file`: one N-Quads file, rewritten whole on each change. The graph is
 *   small and changes rarely, so a whole-file write is the simple, safe choice.
 * - `sparql`: the `urn:sqlib:auth` graph of a SPARQL dataset of its own, for
 *   several instances that share their grants.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import * as oxigraph from 'oxigraph';
import { HttpSparqlExecutor } from '../server/HttpSparqlExecutor.js';
import type { ISparqlExecutor } from '../server/ISparqlExecutor.js';
import type { AuthGraphPersistence } from './AuthStore.js';
import type { AuthStoreConfig } from './config.js';
import { sqliteAuthGraphPersistence } from './sqlitePersistence.js';
import { AUTH_GRAPH_IRI } from './vocabulary.js';

export const AUTH_STORE_FILE = 'auth.nq';

export function authGraphPersistenceFor(config: AuthStoreConfig): AuthGraphPersistence {
  switch (config.type) {
    case 'sqlite':
      return sqliteAuthGraphPersistence(config.dir);
    case 'file':
      return fileAuthGraphPersistence(config.dir);
    case 'sparql':
      return sparqlAuthGraphPersistence(new HttpSparqlExecutor({
        queryUrl: config.queryUrl,
        updateUrl: config.updateUrl,
        username: config.username,
        password: config.password,
      }));
  }
}

/**
 * The auth graph as one N-Quads file in `dir`.
 *
 * Each write goes to a temporary file that is then renamed over the old one,
 * so a crash mid-write leaves the previous grants, never half of them.
 */
export function fileAuthGraphPersistence(dir: string): AuthGraphPersistence {
  const file = path.join(dir, AUTH_STORE_FILE);
  let mirror: oxigraph.Store | null = null;

  async function read(): Promise<string> {
    try {
      return await fs.readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
      throw error;
    }
  }

  async function loaded(): Promise<oxigraph.Store> {
    if (mirror) return mirror;
    const store = new oxigraph.Store();
    const text = await read();
    if (text.trim()) store.load(text, { format: 'application/n-quads' });
    mirror = store;
    return store;
  }

  return {
    async load(): Promise<string> {
      mirror = null;
      const store = await loaded();
      return store.dump({ format: 'application/n-quads' });
    },

    async apply({ insert, delete: toDelete }): Promise<void> {
      const store = await loaded();
      const next = new oxigraph.Store([...store.match()]);
      if (toDelete?.trim()) {
        for (const quad of new oxigraph.Store(parseQuads(toDelete)).match()) next.delete(quad);
      }
      if (insert?.trim()) {
        for (const quad of parseQuads(insert)) next.add(quad);
      }
      await fs.mkdir(dir, { recursive: true });
      const temporary = `${file}.${process.pid}.tmp`;
      await fs.writeFile(temporary, next.dump({ format: 'application/n-quads' }), { mode: 0o600 });
      await fs.rename(temporary, file);
      mirror = next;
    },
  };
}

function parseQuads(nquads: string): oxigraph.Quad[] {
  const store = new oxigraph.Store();
  store.load(nquads, { format: 'application/n-quads' });
  return [...store.match()];
}

/**
 * The auth graph in a SPARQL dataset, read and written with plain SPARQL.
 *
 * Writes name their quads explicitly (`INSERT DATA` / `DELETE DATA`) rather than
 * using patterns, so a malformed grant can never delete more than itself.
 */
export function sparqlAuthGraphPersistence(executor: ISparqlExecutor): AuthGraphPersistence {
  return {
    async load(): Promise<string> {
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
