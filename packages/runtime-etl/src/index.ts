/**
 * `@sparql-query-lib/runtime-etl` — the sqlib ETL loop, with no server.
 *
 * Rows in chunks, mapped to SPARQL bindings by a column mapping, spliced into a
 * CONSTRUCT, run on any runtime `Executor`, and each chunk's RDF handed to a
 * sink. The API runs it with a DuckDB stream and its own executors; the CLI
 * will run it with the same stream and an in-process store.
 */
export {
  rowsToBindings,
  toArgumentSet,
  toLexicalForm,
  type Binding,
  type ColumnDefinition,
  type EtlWarning,
} from './columns.js';

export { runEtl, type EtlOutputChunk, type EtlResult, type EtlRun } from './run.js';
