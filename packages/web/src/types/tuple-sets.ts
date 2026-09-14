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
 * dialect it arrived in. The app's arguments-JSON — which renames `results` to
 * `arguments` and adds `whenEmpty` — is ephemeral wire format and never
 * touches storage. See `docs/concepts.md`.
 */
import type { SparqlBinding, SparqlValue } from './argument-sets';

/**
 * Where a version's rows came from.
 *
 * Provenance only — it records which dialect was parsed at import, never how
 * stored content is read back. Mirrors `TUPLE_SOURCE_FORMATS` in
 * `packages/api/src/persistence/schemas/TupleSetVersionSchema.ts`.
 */
export const TUPLE_SOURCE_FORMATS = [
  'csv',
  'tsv',
  'sparql-results-tsv',
  'sparql-results-json',
  'query-results',
  'etl-results',
] as const;

export type TupleSourceFormat = (typeof TUPLE_SOURCE_FORMATS)[number];

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

/**
 * A type an untyped column can be promoted to at import (issue #208).
 *
 * Mirrors `SUGGESTED_COLUMN_TYPES` in `packages/api/src/lib/tupleContent.ts`.
 * Purely an import-time proposal the author accepts or rejects per column —
 * it changes what gets persisted, never how persisted content is read back.
 */
export const SUGGESTED_COLUMN_TYPES = ['xsd:integer', 'xsd:date', 'uri'] as const;
export type SuggestedColumnType = (typeof SUGGESTED_COLUMN_TYPES)[number];

export interface ColumnTypeSuggestion {
  column: string;
  suggested: SuggestedColumnType;
}

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
