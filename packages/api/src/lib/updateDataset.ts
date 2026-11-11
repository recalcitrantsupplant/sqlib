/**
 * Dataset inputs for updates: the graphs `USING` and `USING NAMED` would name,
 * supplied at run time instead (docs/proposals/update-dataset.md).
 *
 * SPARQL 1.1 Protocol §2.2.3 sends them as `using-graph-uri` and
 * `using-named-graph-uri`. They set the dataset that the `WHERE` clause of each
 * `DELETE/INSERT` operation reads. They do not change the graphs the update
 * writes to. The protocol makes it an error to send them with an update whose
 * text has `USING`, `USING NAMED` or `WITH`.
 *
 * sqlib applies the dataset through each backend's own mechanism, and never
 * changes the update text. An HTTP backend gets the protocol parameters. An
 * in-process Oxigraph store gets the dataset options of `Store.update`, when
 * its binding has them (`oxigraphUpdateDataset.ts`). An executor that cannot
 * apply a dataset says so with `supportsUpdateDataset: false`, and the update
 * is refused before it runs.
 */

import { Parser } from '@sparql-query-lib/compiler';
import type { SparqlDataset } from '../server/ISparqlExecutor.js';
import { EMPTY_DATASET_GRAPH, hasDataset } from './dataset.js';

/** The protocol parameter that carries each part of an update's dataset. */
export const UPDATE_DATASET_PARTS = [
  { key: 'defaultGraphs', parameter: 'using-graph-uri' },
  { key: 'namedGraphs', parameter: 'using-named-graph-uri' },
] as const;

export type UpdateDatasetErrorCode =
  | 'UPDATE_DATASET_CONFLICT'
  | 'UPDATE_DATASET_DELETE_WHERE'
  | 'UPDATE_DATASET_UNSUPPORTED';

/** Refused with 400: a dataset that cannot apply to this update on this backend. */
export class UpdateDatasetError extends Error {
  readonly statusCode = 400;

  constructor(readonly code: UpdateDatasetErrorCode, message: string) {
    super(message);
    this.name = 'UpdateDatasetError';
  }
}

export const conflictError = () => new UpdateDatasetError(
  'UPDATE_DATASET_CONFLICT',
  'This update names its graphs with USING, USING NAMED or WITH. Remove them, or remove defaultGraphs and namedGraphs.',
);

export const deleteWhereError = () => new UpdateDatasetError(
  'UPDATE_DATASET_DELETE_WHERE',
  'A dataset cannot apply to DELETE WHERE. Write it as DELETE { … } WHERE { … }.',
);

export const unsupportedError = (backendId: string | undefined) => new UpdateDatasetError(
  'UPDATE_DATASET_UNSUPPORTED',
  `Backend ${backendId ?? '(in-process)'} cannot limit the graphs an update reads. `
  + 'Run it without defaultGraphs and namedGraphs.',
);

type Node = Record<string, unknown>;
const isNode = (value: unknown): value is Node => typeof value === 'object' && value !== null;

/** The operations of a parsed update. */
function operationsOf(parsed: Node): Node[] {
  const updates = parsed.type === 'update' && Array.isArray(parsed.updates) ? (parsed.updates as Node[]) : [];
  return updates.map((update) => update.operation).filter(isNode);
}

/** True when a `DELETE/INSERT` operation has `USING`, `USING NAMED` or `WITH`. */
function namesItsDataset(operation: Node): boolean {
  if (operation.subType !== 'modify') return false;
  const from = isNode(operation.from) && Array.isArray(operation.from.clauses) ? operation.from.clauses : [];
  return from.length > 0 || isNode(operation.graph);
}

/**
 * The SPARQL 1.1 Protocol parameters for an update's dataset, one pair per
 * graph, with {@link EMPTY_DATASET_GRAPH} for a part that is present and empty.
 */
export function updateDatasetProtocolParameters(dataset: SparqlDataset | undefined): Array<[string, string]> {
  if (!hasDataset(dataset)) return [];
  const pairs: Array<[string, string]> = [];
  for (const { key, parameter } of UPDATE_DATASET_PARTS) {
    const graphs = dataset[key];
    if (graphs === undefined) continue;
    for (const graph of graphs.length > 0 ? graphs : [EMPTY_DATASET_GRAPH]) pairs.push([parameter, graph]);
  }
  return pairs;
}

/** Facts about an update's text that decide how a dataset applies to it. */
export interface UpdateDatasetShape {
  /** An operation has a `WHERE` clause: `DELETE/INSERT … WHERE` or `DELETE WHERE`. */
  reads: boolean;
  /** A `DELETE/INSERT` operation has `USING`, `USING NAMED` or `WITH`. */
  namesDataset: boolean;
  /** An operation is `DELETE WHERE`, which cannot take `USING`. */
  deleteWhere: boolean;
}

/**
 * The shape of an update's text. Text that does not parse gives `null`: the
 * backend reports the syntax error.
 */
export function updateDatasetShape(updateText: string): UpdateDatasetShape | null {
  let parsed: Node;
  try {
    parsed = new Parser().parse(updateText) as unknown as Node;
  } catch {
    return null;
  }
  const operations = operationsOf(parsed);
  return {
    reads: operations.some((operation) => operation.subType === 'modify' || operation.subType === 'deletewhere'),
    namesDataset: operations.some(namesItsDataset),
    deleteWhere: operations.some((operation) => operation.subType === 'deletewhere'),
  };
}

/**
 * Throws {@link UpdateDatasetError} when the text cannot take a dataset:
 * it has `USING`, `USING NAMED` or `WITH` (the protocol's 400), or it has
 * `DELETE WHERE`, which Fuseki runs over the whole store and Oxigraph over the
 * dataset. Does nothing when no dataset is given.
 */
export function assertUpdateTextTakesDataset(updateText: string, dataset: SparqlDataset | undefined): void {
  if (!hasDataset(dataset)) return;
  const shape = updateDatasetShape(updateText);
  if (shape?.namesDataset) throw conflictError();
  if (shape?.deleteWhere) throw deleteWhereError();
}

/**
 * Throws {@link UpdateDatasetError} when the text cannot take a dataset, or
 * the executor cannot apply one. Every check runs before the update is sent,
 * so a refused update writes nothing.
 */
export function assertUpdateTakesDataset(
  updateText: string,
  dataset: SparqlDataset | undefined,
  executor: { supportsUpdateDataset?: boolean },
  backendId?: string,
): void {
  if (!hasDataset(dataset)) return;
  assertUpdateTextTakesDataset(updateText, dataset);
  if (!executor.supportsUpdateDataset) throw unsupportedError(backendId);
}
