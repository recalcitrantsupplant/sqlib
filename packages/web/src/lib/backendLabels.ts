/**
 * Names a backend that a record points at but the backends list does not hold.
 *
 * The server lists only the backends the caller holds a grant on. A query,
 * library or ETL job can still name another one as its default, or one that
 * was deleted. The client cannot tell the two apart, and the id itself is not
 * for a caller without access, so both read as unavailable once the list has
 * loaded. Before the list loads, an id is taken at its word: a browser backend
 * that a share link chose is not in the list yet.
 */

export const UNAVAILABLE_BACKEND_LABEL = 'Unavailable backend';

/** The label for `id`: its name, or the unavailable label once the list has loaded, or the id before. */
export function backendDisplayName(
  id: string,
  backends: ReadonlyArray<{ id: string; name: string }>,
  listLoaded: boolean,
): string {
  const known = backends.find((backend) => backend.id === id);
  if (known) return known.name;
  return listLoaded ? UNAVAILABLE_BACKEND_LABEL : id;
}
