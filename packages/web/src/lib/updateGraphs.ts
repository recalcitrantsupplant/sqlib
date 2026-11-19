/**
 * Whether an update can take graphs chosen at run time, and if not, why.
 *
 * The graphs an update takes are the ones its `WHERE` clause reads: the API
 * sends them as `using-graph-uri` and `using-named-graph-uri` (SPARQL 1.1
 * Protocol §2.2.3). The API refuses them for an update with `USING`,
 * `USING NAMED` or `WITH` in its text, and for `DELETE WHERE`
 * (`packages/api/src/lib/updateDataset.ts`). This reads the same facts from
 * the text, so the run bar can say so before a run.
 */
import { Parser } from '@traqula/parser-sparql-1-2';

/**
 * - `choose`: the update reads, and graphs can be chosen.
 * - `none`: no operation has a `WHERE` clause, so graphs change nothing.
 * - `text`: an operation has `USING`, `USING NAMED` or `WITH`.
 * - `deleteWhere`: an operation is `DELETE WHERE`.
 * - `backend`: the backend cannot apply graphs to an update.
 */
export type UpdateGraphsState = 'choose' | 'none' | 'text' | 'deleteWhere' | 'backend';

type Node = Record<string, unknown>;
const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null;

/**
 * Backend types that run updates in-process with Oxigraph. Oxigraph 0.5.13's
 * `Store.update` takes no dataset, so the API refuses graphs on an update
 * there (`UPDATE_DATASET_UNSUPPORTED`, decided by the probe in
 * `packages/api/src/lib/oxigraphUpdateDataset.ts`). Remove a type from this
 * list when the probe passes for it.
 */
const NO_UPDATE_GRAPHS_BACKEND_TYPES = new Set(['oxigraphMemory', 'oxigraphEphemeral']);

const parser = new Parser();

/**
 * The state for a text on a backend type. `query` for a query, which always
 * takes graphs. `unparsed` for text that does not parse: the caller decides
 * from the type it already knows, and the run reports the syntax error.
 */
export function updateGraphsState(
  text: string,
  backendType: string | null | undefined,
): UpdateGraphsState | 'query' | 'unparsed' {
  let parsed: unknown;
  try {
    parsed = parser.parse(text);
  } catch {
    return 'unparsed';
  }
  if (!isNode(parsed) || parsed.type !== 'update') return 'query';
  const updates = Array.isArray(parsed.updates) ? (parsed.updates as unknown[]) : [];
  const operations = updates.map((update) => (isNode(update) ? update.operation : undefined)).filter(isNode);

  const namesGraphs = operations.some((operation) => {
    if (operation.subType !== 'modify') return false;
    const clauses = isNode(operation.from) && Array.isArray(operation.from.clauses) ? operation.from.clauses : [];
    return clauses.length > 0 || isNode(operation.graph);
  });
  if (namesGraphs) return 'text';
  if (operations.some((operation) => operation.subType === 'deletewhere')) return 'deleteWhere';
  if (!operations.some((operation) => operation.subType === 'modify')) return 'none';
  if (backendType && NO_UPDATE_GRAPHS_BACKEND_TYPES.has(backendType)) return 'backend';
  return 'choose';
}
