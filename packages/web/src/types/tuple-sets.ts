/**
 * Tuple sets: named tabular assets a library holds.
 *
 * The tabular sibling of a data graph. A data graph is RDF *input* — the store
 * a rule set runs against — and a tuple set is tabular *input*: the rows a
 * query's `VALUES` clause or a rule set's `TUPLE(…)` declaration is filled
 * with. Rows are never loaded into a store; they are spliced into a query as a
 * `VALUES` block and consumed. That is the whole reason the two are separate
 * entities with separate homes.
 *
 * Stored content is always a standard SPARQL Results JSON document, whatever
 * dialect it arrived in — the same shape `/execute` takes for each argument, so
 * a version's content can be passed to a run unchanged. See `docs/concepts.md`.
 */
import type { SparqlBinding, SparqlValue } from './argument-sets';

/*
 * The source-format and column-type vocabularies are the contracts' — one
 * declaration the API's persistence schema, its tuple parser and this app all
 * read, where each used to keep a copy that "mirrored" another.
 */
export {
  TUPLE_SOURCE_FORMATS,
  type TupleSourceFormat,
  SUGGESTED_COLUMN_TYPES,
  type SuggestedColumnType,
  type ColumnTypeSuggestion,
} from '@sparql-query-lib/contracts';
import type { TupleSourceFormat, SuggestedColumnType } from '@sparql-query-lib/contracts';

/**
 * What the import dialog offers, and what each choice means for typing.
 *
 * `query-results` is absent deliberately: it is not something you pick, it is
 * what "save these results as a tuple set" writes. Offering it would ask an
 * author to assert a provenance they cannot have.
 *
 * Plain TSV and SPARQL Results TSV are both here, adjacent and separately
 * described, because they share an extension and differ entirely in what a
 * cell means. Sniffing only pre-selects; the author still states the choice.
 */
export const TUPLE_IMPORT_FORMATS: Array<{
  value: TupleSourceFormat;
  label: string;
  hint: string;
}> = [
  {
    value: 'csv',
    label: 'CSV',
    hint: 'Comma-separated. Every cell becomes a plain string literal — a CSV carries no types.',
  },
  {
    value: 'tsv',
    label: 'TSV (plain)',
    hint: 'Tab-separated. Every cell becomes a plain string literal, exactly as CSV.',
  },
  {
    value: 'sparql-results-tsv',
    label: 'TSV (SPARQL results)',
    hint: 'Tab-separated with ?vars in the header and Turtle terms in the cells — <iri>, "lit"@en, "lit"^^<dt>. A cell that will not parse is an error, not a string.',
  },
  {
    value: 'sparql-results-json',
    label: 'SPARQL Results JSON',
    hint: 'A full results document. Validated and stored as-is.',
  },
];

/*
 * A type an untyped column can be promoted to at import (issue #208). Purely an
 * import-time proposal the author accepts or rejects per column — it changes
 * what gets persisted, never how persisted content is read back.
 */

/** How a suggested type reads in the accept/reject control. */
export const SUGGESTED_COLUMN_TYPE_LABELS: Record<SuggestedColumnType, string> = {
  'xsd:integer': 'a whole number',
  'xsd:date': 'a date',
  uri: 'a URI',
};

/** A SPARQL Results JSON document, as stored on a version. */
export interface TupleDocument {
  head: { vars: string[] };
  results: { bindings: SparqlBinding[] };
}

export interface ParsedTupleDocument {
  columns: string[];
  rows: SparqlBinding[];
}

/**
 * Read a stored `contentString` back into columns and rows.
 *
 * Total by construction: content that will not parse yields an empty table
 * rather than throwing. Every caller is a preview or a row count on a screen
 * that has other things to draw, and the server has already validated anything
 * that reached storage — so a parse failure here means a bug, not bad input,
 * and blanking one panel beats blanking the page.
 */
export function readTupleDocument(contentString: string | null | undefined): ParsedTupleDocument {
  if (!contentString) return { columns: [], rows: [] };
  try {
    const parsed = JSON.parse(contentString) as Partial<TupleDocument>;
    const columns = Array.isArray(parsed?.head?.vars)
      ? parsed.head.vars.map((name) => String(name).replace(/^\?/, ''))
      : [];
    const rows = Array.isArray(parsed?.results?.bindings)
      ? (parsed.results.bindings as SparqlBinding[])
      : [];
    return { columns, rows };
  } catch {
    return { columns: [], rows: [] };
  }
}

/**
 * The cell's text, or an empty string where the row does not bind that column.
 *
 * An absent key is UNDEF, which the grid draws as blank — the same convention
 * `pruneUndef` enforces on the way out. `""` would be the empty literal, which
 * binds and matches nothing.
 */
export function cellText(row: SparqlBinding, column: string): string {
  return row[column]?.value ?? '';
}

/** How a cell is drawn beside its value: `uri`, a datatype, or a language tag. */
export function cellAnnotation(value: SparqlValue | undefined): string {
  if (!value) return '';
  if (value.type === 'uri') return 'uri';
  if (value['xml:lang']) return `@${value['xml:lang']}`;
  if (value.datatype) return value.datatype.replace(/^.*[#/]/, '');
  return '';
}
