/**
 * SPARQL over a library kept in SQLite: a read-only Oxigraph copy, built when
 * asked for.
 *
 * In the RDF modes the library store *is* a SPARQL store, so admin `/sparql`,
 * library export (CONSTRUCT system queries) and a graph policy run on the
 * library backend all query it directly. In `sqlite` mode nothing does until
 * one of them is used: then every row's triples are loaded into an in-memory
 * store, and that store answers until the next write makes it stale.
 *
 * So the normal case keeps one copy of the library in memory (the entity cache)
 * and one on disk, and the second in-memory copy exists only while something
 * needs SPARQL. Updates are refused: entity writes go through `EntityStore`,
 * which keeps the rows, the cache and their change events in step, and a
 * SPARQL update here would bypass all three.
 */
import * as oxigraph from 'oxigraph';
import type { Dispatcher } from 'undici';
import type {
  ISparqlExecutor,
  SparqlExecutionResult,
  SparqlQueryOptions,
  SparqlSelectJsonOutput,
} from '../server/ISparqlExecutor.js';
import { OxigraphSparqlExecutor } from '../server/OxigraphSparqlExecutor.js';
import { ReadOnlyBackendError } from '../server/ReadOnlySparqlExecutor.js';
import { allTriples, fromBinding, libraryWriteCount, openLibraryDatabase } from './sqliteEntityStore.js';

let built: { writes: number; executor: OxigraphSparqlExecutor } | null = null;

/** The copy as of the last write, rebuilt if a write has happened since. */
function current(dir: string): OxigraphSparqlExecutor {
  const database = openLibraryDatabase(dir);
  // Read after opening: a newly opened database counts as a write.
  const writes = libraryWriteCount();
  if (built && built.writes === writes) return built.executor;

  const quads: oxigraph.Quad[] = [];
  for (const { s, triples } of allTriples(database)) {
    const subject = oxigraph.namedNode(s);
    for (const { p, o } of triples) {
      quads.push(oxigraph.quad(subject, oxigraph.namedNode(p), fromBinding(o)));
    }
  }
  built = { writes, executor: new OxigraphSparqlExecutor(new oxigraph.Store(quads)) };
  return built.executor;
}

/** Drops the copy, for memory or for tests. The next query builds it again. */
export function dropLibrarySparqlView(): void {
  built = null;
}

export class LibrarySparqlViewExecutor implements ISparqlExecutor {
  constructor(private readonly dir: string) {}

  selectQueryParsed(query: string, options?: SparqlQueryOptions): Promise<SparqlExecutionResult<SparqlSelectJsonOutput | string>> {
    return current(this.dir).selectQueryParsed(query, options);
  }

  constructQueryParsed(query: string, options?: SparqlQueryOptions): Promise<SparqlExecutionResult<string>> {
    return current(this.dir).constructQueryParsed(query, options);
  }

  selectQueryStream(query: string, options?: SparqlQueryOptions): Promise<Dispatcher.ResponseData> {
    return current(this.dir).selectQueryStream(query, options);
  }

  constructQueryStream(query: string, options?: SparqlQueryOptions): Promise<Dispatcher.ResponseData> {
    return current(this.dir).constructQueryStream(query, options);
  }

  askQuery(query: string, options?: SparqlQueryOptions): Promise<SparqlExecutionResult<boolean | string>> {
    return current(this.dir).askQuery(query, options);
  }

  async update(): Promise<SparqlExecutionResult<void>> {
    throw new ReadOnlyBackendError(
      'The library store is kept in SQLite, and SPARQL over it is read-only. Change entities through the API.',
    );
  }
}
