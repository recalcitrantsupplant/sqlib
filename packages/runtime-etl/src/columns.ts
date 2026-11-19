/**
 * How a source row becomes a SPARQL binding.
 *
 * A column mapping names, for each SQL output column, the term it becomes: an
 * IRI, or a literal with a datatype or a language tag. The mapping has no other
 * logic:
 *
 * - The column binds the variable of the same name. Rename with an alias in the
 *   SQL (`SELECT station_name AS stationName`).
 * - The value is the IRI or the lexical form exactly as the source sent it.
 *   Build an IRI from a value with `BIND(IRI(CONCAT(...)))` in the CONSTRUCT.
 * - A NULL leaves the variable unbound (SPARQL's UNDEF). Drop rows with
 *   `WHERE ... IS NOT NULL` in the SQL.
 *
 * Moved from `packages/api/src/lib/EtlService.ts`, which now imports it, so the
 * API and the CLI map rows identically.
 */
import type { TemplateArgumentSet, TermValue } from '@sparql-query-lib/runtime';

/** One column of a mapping. */
export interface ColumnDefinition {
  /** The SQL output column, by its alias. It binds the variable of the same name. */
  columnName: string;
  termType: 'uri' | 'literal';
  /** For literals, e.g. `http://www.w3.org/2001/XMLSchema#decimal`. */
  datatypeIri?: string;
  /** For literals, e.g. `en`. */
  lang?: string;
}

/** One row of bindings: variable name to term. */
export type Binding = Record<string, TermValue>;

/** A column mapping that uses a field sqlib no longer applies. */
export class RetiredColumnFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetiredColumnFieldError';
  }
}

/**
 * Refuse a mapping that uses a field sqlib no longer applies.
 *
 * Mappings saved before these fields were removed can still hold them. If the
 * fields were ignored, a template column would bind its bare value as an IRI,
 * a `skipRow` column would keep rows it used to drop, and a renamed column
 * would bind a variable the template does not use. A stored value that means
 * what every mapping now does is accepted: `nullPolicy: "undef"`, and a
 * `targetVariable` equal to `columnName`.
 */
export function assertPlainColumns(columns: ReadonlyArray<unknown>): void {
  columns.forEach((column, index) => {
    if (!column || typeof column !== 'object') return;
    const record = column as Record<string, unknown>;
    const name = typeof record.columnName === 'string' ? `'${record.columnName}'` : `${index}`;
    if (record.iriTemplate !== undefined) {
      throw new RetiredColumnFieldError(
        `Column ${name} has an iriTemplate, which sqlib no longer applies. `
        + 'Map the column as a literal and build the IRI in the SPARQL template with BIND(IRI(CONCAT(...))).',
      );
    }
    if (record.targetVariable !== undefined && record.targetVariable !== record.columnName) {
      throw new RetiredColumnFieldError(
        `Column ${name} binds ?${String(record.targetVariable)}, and a column now binds the variable of its own name. `
        + `Rename it in the SQL: ${String(record.columnName)} AS ${String(record.targetVariable)}.`,
      );
    }
    if (record.nullPolicy !== undefined && record.nullPolicy !== 'undef') {
      throw new RetiredColumnFieldError(
        `Column ${name} has nullPolicy '${String(record.nullPolicy)}', which sqlib no longer applies. `
        + 'Drop those rows in the SQL with WHERE ... IS NOT NULL.',
      );
    }
  });
}

/**
 * A stored column list, as the mapping now has it.
 *
 * Refuses the retired fields (see {@link assertPlainColumns}) and removes the
 * ones that are accepted, so the returned columns have only the fields of
 * {@link ColumnDefinition}.
 */
export function toColumnDefinitions(columns: ReadonlyArray<unknown>): ColumnDefinition[] {
  assertPlainColumns(columns);
  return columns.map((column) => {
    const { nullPolicy: _nullPolicy, targetVariable: _targetVariable, ...rest } = column as ColumnDefinition & {
      nullPolicy?: unknown;
      targetVariable?: unknown;
    };
    return rest;
  });
}

/**
 * Map rows to bindings.
 *
 * Each column binds the variable of its name to `String(value)`: as an IRI for a `uri`
 * column, or as a literal with the column's datatype or language tag. A NULL
 * leaves the variable out of the binding. A value that is not a valid IRI
 * makes the run fail when the query text is built.
 */
export function rowsToBindings(
  rows: ReadonlyArray<Record<string, unknown>>,
  columns: ReadonlyArray<ColumnDefinition>,
): Binding[] {
  assertPlainColumns(columns);
  return rows.map((row) => {
    const binding: Binding = {};
    for (const column of columns) {
      const value = row[column.columnName];
      if (value === null || value === undefined) continue;
      if (column.termType === 'uri') {
        binding[column.columnName] = { type: 'uri', value: String(value) };
      } else {
        const literal: TermValue = { type: 'literal', value: String(value) };
        if (column.datatypeIri) literal.datatype = column.datatypeIri;
        if (column.lang) literal['xml:lang'] = column.lang;
        binding[column.columnName] = literal;
      }
    }
    return binding;
  });
}

/** The argument set a chunk's bindings fill: every mapped variable, one row per binding. */
export function toArgumentSet(
  bindings: Binding[],
  columns: ReadonlyArray<ColumnDefinition>,
): TemplateArgumentSet {
  return {
    head: { vars: columns.map(column => column.columnName) },
    results: { bindings },
  };
}
