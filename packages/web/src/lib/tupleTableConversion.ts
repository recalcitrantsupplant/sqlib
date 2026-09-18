/**
 * Converting between the two table shapes.
 *
 * Both are SPARQL Results JSON, so each direction is a projection plus one
 * question — and the two shapes are different because the things they fill are
 * different:
 *
 * - a **tuple set** fills a rule set's `TUPLE(…)`, which matches by arity and
 *   position, so its column names are labels;
 * - an **argument table** fills a query's `VALUES`, which matches by variable
 *   name, so its names are identifiers.
 *
 * That asymmetry is the whole of what a conversion has to handle. Going to an
 * argument table, a label is a *guess* at a variable name and the person
 * confirms it. Going the other way, the names are kept — as labels, and the
 * warning says so rather than pretending they were dropped.
 *
 * **Neither direction is a link.** A conversion is a copy, taken once, and the
 * two entities go their own ways afterwards — which is the whole reason this is
 * safe where a save-time side effect was not. `copiedFrom` is recorded so "used
 * by" can be answered loosely, without anything pinning anything.
 */
import type { ArgumentRow, SparqlBinding, SparqlValue } from '../types/argument-sets';

/** One column's answer to "which variable does this fill?" */
export interface ColumnMapping {
  /** The tuple set's own label for the column — a name to read, not to match. */
  label: string;
  /** The variable it will fill. Pre-filled from the label, and editable. */
  variable: string;
  /**
   * True while the pre-fill has not been confirmed.
   *
   * A label is not an identifier, so a pre-fill is a guess and the dialog says
   * so. Editing a row answers the question; so does confirming the form.
   */
  unverified: boolean;
  /** Left out of the result — the `TUPLE(:seed, …)` lead column. */
  stripped: boolean;
}

/**
 * The starting point for the tuple set → argument table dialog.
 *
 * Every column pre-filled from its label and marked unverified. With
 * `stripLeading`, the first column is dropped instead: a rule-set table may
 * lead with a ground term, which fills no variable at all.
 */
export function defaultMapping(columns: string[], stripLeading = false): ColumnMapping[] {
  return columns.map((label, index) => ({
    label,
    variable: stripLeading && index === 0 ? '' : label.replace(/^\?/, '').trim(),
    unverified: true,
    stripped: stripLeading && index === 0,
  }));
}

/** The variables a mapping produces, in column order. */
export function mappedVariables(mapping: ColumnMapping[]): string[] {
  return mapping.filter((column) => !column.stripped).map((column) => column.variable.trim()).filter(Boolean);
}

/**
 * Tuple set rows → argument rows, under a confirmed mapping.
 *
 * Rows arrive keyed by the tuple set's labels and leave keyed by the variables
 * the mapping names. A column with no variable — stripped, or simply left
 * blank — contributes nothing rather than a cell named after a label, because a
 * cell the clause does not declare binds nothing and would only be noise in the
 * editor.
 */
export function toArgumentRows(
  rows: SparqlBinding[],
  mapping: ColumnMapping[],
): ArgumentRow[] {
  const pairs = mapping
    .filter((column) => !column.stripped && column.variable.trim().length > 0)
    .map((column) => [column.label, column.variable.trim()] as const);

  return rows.map((row) => {
    const values: SparqlBinding = {};
    for (const [label, variable] of pairs) {
      const term = row[label] as SparqlValue | undefined;
      // A missing cell is UNDEF, which this editor spells as an empty term —
      // the variable is left unconstrained rather than bound to the empty IRI.
      values[variable] = term ? { ...term } : { type: 'uri', value: '' };
    }
    return { values };
  });
}

/**
 * Narrow converted rows to the clause actually being filled.
 *
 * The mapping says what each column *is*; this says what the clause *takes*. A
 * variable the mapping did not produce becomes a blank cell — how this editor
 * spells UNDEF, so it is left unconstrained rather than bound to the empty
 * IRI — and a variable the clause does not declare is dropped, because it has
 * nothing to bind to.
 */
export function projectOnto(rows: ArgumentRow[], variables: string[]): ArgumentRow[] {
  return rows.map((row) => {
    const values: SparqlBinding = {};
    for (const name of variables) {
      const term = row.values[name] as SparqlValue | undefined;
      values[name] = term ? { ...term } : { type: 'uri', value: '' };
    }
    return { values };
  });
}

/** What a tuple set becomes on the way to a rule set's `TUPLE(…)`. */
export interface TupleTable {
  /** Labels, in position order. Never read when the set fills a parameter. */
  columns: string[];
  rows: SparqlBinding[];
}

/**
 * Argument rows → a tuple set's table.
 *
 * The variable names are kept as the new set's labels. `prependIri` adds the
 * ground lead column a declaration like `TUPLE(:seed, ?x, ?y)` expects — the
 * mirror of "strip the leading fixed column" going the other way.
 *
 * The lead column's label is `fixed` and means nothing: like every other label
 * here it is there to be read. What makes it fill the declaration's `:seed` is
 * its position and its value.
 */
export function toTupleTable(
  variables: string[],
  rows: ArgumentRow[],
  options?: { prependIri?: string | null; leadLabel?: string },
): TupleTable {
  const lead = options?.prependIri?.trim() || null;
  const leadLabel = options?.leadLabel ?? 'fixed';
  const names = variables.map((variable) => variable.replace(/^\?/, ''));
  const columns = lead ? [leadLabel, ...names] : [...names];

  const converted = rows.map((row) => {
    const values: SparqlBinding = {};
    if (lead) values[leadLabel] = { type: 'uri', value: lead };
    for (const name of names) {
      const term = row.values[name] as SparqlValue | undefined;
      // A blank cell is left out rather than written as an empty IRI: a tuple
      // set's row is data, and an empty IRI is not a term anybody meant.
      if (term && term.value !== '') values[name] = { ...term };
    }
    return values;
  });

  return { columns, rows: converted };
}

/** The document a tuple set version stores, from a converted table. */
export function toTupleDocument(table: TupleTable): string {
  return JSON.stringify({
    head: { vars: table.columns },
    results: { bindings: table.rows },
  });
}

/**
 * The warning shown on the way to a tuple set.
 *
 * Not "we will drop your names" — that would be a lie, and the lie would then
 * have to be un-taught the first time someone saw the names on the other side.
 */
export const TO_TUPLE_SET_WARNING =
  'Rule sets match by arity and position. These names are kept on the tuple set so you can read it, '
  + 'and are never used when it fills a TUPLE(…).';
