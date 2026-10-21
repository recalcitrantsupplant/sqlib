/**
 * How a source row becomes a SPARQL binding.
 *
 * A column mapping names, for each SQL output column, the variable it binds,
 * whether it becomes an IRI or a literal, and what to do with a NULL. Moved
 * from `packages/api/src/lib/EtlService.ts`, which now imports it, so the API
 * and the CLI map rows identically.
 */
import type { TemplateArgumentSet, TermValue } from '@sparql-query-lib/runtime';

/** One column of a mapping. */
export interface ColumnDefinition {
  /** The SQL output column, by its alias. */
  columnName: string;
  /** The variable it binds, without `?`, e.g. `customer`. */
  targetVariable: string;
  termType: 'uri' | 'literal';
  /** For literals, e.g. `http://www.w3.org/2001/XMLSchema#decimal`. */
  datatypeIri?: string;
  /** For literals, e.g. `en`. */
  lang?: string;
  /** For IRIs, e.g. `http://ex/customer/{value}`; the value is URI-encoded. */
  iriTemplate?: string;
  /** `undef` leaves the variable unbound; `skipRow` drops the row. */
  nullPolicy: 'undef' | 'skipRow';
}

/** One row of bindings: variable name to term. */
export type Binding = Record<string, TermValue>;

/** Something worth reporting that did not stop the run. */
export type EtlWarning = (message: string, context: Record<string, unknown>) => void;

const XSD_DATE_TIME = 'http://www.w3.org/2001/XMLSchema#dateTime';
const DUCKDB_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/;

/**
 * The lexical form of a source value for the literal it is mapped to.
 *
 * Source rows arrive as JSON values, so almost everything is already the string
 * the literal wants. The one shape that is not is DuckDB's TIMESTAMP, whose
 * JSON form separates date and time with a space — `2020-01-02 03:04:05` —
 * while `xsd:dateTime` requires `T`. The rewrite is scoped to columns mapped to
 * `xsd:dateTime`, so a VARCHAR column that happens to look like a timestamp is
 * left as it was sent.
 */
export function toLexicalForm(value: unknown, datatypeIri?: string): string {
  const lexical = String(value);
  if (datatypeIri === XSD_DATE_TIME && DUCKDB_TIMESTAMP.test(lexical)) {
    return lexical.replace(' ', 'T');
  }
  return lexical;
}

/**
 * Map rows to bindings.
 *
 * A NULL under `skipRow` drops the row; under `undef` the variable is left out
 * of the binding, which is SPARQL's UNDEF. A value that would make an invalid
 * IRI, or that fails to convert, is left out of its binding and reported to
 * `warn`; the row is kept.
 */
export function rowsToBindings(
  rows: ReadonlyArray<Record<string, unknown>>,
  columns: ReadonlyArray<ColumnDefinition>,
  warn: EtlWarning = () => {},
): Binding[] {
  const bindings: Binding[] = [];

  for (const row of rows) {
    const binding: Binding = {};
    let skipRow = false;

    for (const column of columns) {
      const value = row[column.columnName];

      if (value === null || value === undefined) {
        if (column.nullPolicy === 'skipRow') {
          skipRow = true;
          break;
        }
        continue;
      }

      try {
        if (column.termType === 'uri') {
          const iri = column.iriTemplate
            ? column.iriTemplate.replace('{value}', encodeURIComponent(String(value)))
            : String(value);

          if (!/^[a-z][a-z0-9+.-]*:/i.test(iri)) {
            warn('Invalid IRI generated, skipping binding', { iri });
            continue;
          }

          binding[column.targetVariable] = { type: 'uri', value: iri };
        } else {
          const literal: TermValue = { type: 'literal', value: toLexicalForm(value, column.datatypeIri) };
          if (column.datatypeIri) literal.datatype = column.datatypeIri;
          if (column.lang) literal['xml:lang'] = column.lang;
          binding[column.targetVariable] = literal;
        }
      } catch (error) {
        warn('Error converting column, skipping binding', { err: error, column: column.columnName });
        continue;
      }
    }

    if (!skipRow) bindings.push(binding);
  }

  return bindings;
}

/** The argument set a chunk's bindings fill: every mapped variable, one row per binding. */
export function toArgumentSet(
  bindings: Binding[],
  columns: ReadonlyArray<ColumnDefinition>,
): TemplateArgumentSet {
  return {
    head: { vars: columns.map(column => column.targetVariable) },
    results: { bindings },
  };
}
