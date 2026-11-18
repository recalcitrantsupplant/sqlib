/**
 * Fit an ETL column mapping to the columns that the SQL returns now.
 */

export interface EtlColumnMappingRow {
  columnName: string;
  termType: 'uri' | 'literal';
  datatypeIri?: string;
  lang?: string;
}

/**
 * A row with only the fields a mapping has. A mapping saved before
 * `targetVariable`, `iriTemplate` and `nullPolicy` were removed can still hold
 * them, and the API refuses a new mapping that sends them.
 */
export function toMappingRow(column: EtlColumnMappingRow): EtlColumnMappingRow {
  const row: EtlColumnMappingRow = { columnName: column.columnName, termType: column.termType };
  if (column.datatypeIri) row.datatypeIri = column.datatypeIri;
  if (column.lang) row.lang = column.lang;
  return row;
}

/**
 * One row per column in `schema`, in schema order.
 *
 * - A column that `current` maps keeps its row unchanged.
 * - A new column takes its row from `inferred`, or a string literal row when
 *   `inferred` has none.
 * - A column that `schema` does not list loses its row.
 */
export function mergeColumnMappings<T extends EtlColumnMappingRow>(
  current: readonly T[],
  schema: readonly { columnName: string }[],
  inferred: readonly T[],
): T[] {
  const byName = new Map(current.map((row) => [row.columnName, row]));
  const inferredByName = new Map(inferred.map((row) => [row.columnName, row]));
  return schema.map(({ columnName }) => {
    const kept = byName.get(columnName);
    if (kept) return { ...kept };
    const proposed = inferredByName.get(columnName);
    if (proposed) return { ...proposed };
    return {
      columnName,
      termType: 'literal',
      datatypeIri: 'http://www.w3.org/2001/XMLSchema#string',
    } as T;
  });
}
