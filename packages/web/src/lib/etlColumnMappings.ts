/**
 * Fit an ETL column mapping to the columns that the SQL returns now.
 */

export interface EtlColumnMappingRow {
  columnName: string;
  targetVariable: string;
  termType: 'uri' | 'literal';
  datatypeIri?: string;
  lang?: string;
  iriTemplate?: string;
  nullPolicy: 'undef' | 'skipRow';
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
      targetVariable: columnName,
      termType: 'literal',
      datatypeIri: 'http://www.w3.org/2001/XMLSchema#string',
      nullPolicy: 'undef',
    } as T;
  });
}
