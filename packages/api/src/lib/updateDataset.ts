/**
 * Dataset inputs for updates: the graphs `USING` and `USING NAMED` would name,
 * supplied at run time instead.
 *
 * SPARQL 1.1 Protocol §2.2.3 sends them as `using-graph-uri` and
 * `using-named-graph-uri`. They set the dataset that the `WHERE` clause of a
 * `DELETE/INSERT` operation reads. They do not change the graphs the update
 * writes to. The protocol makes it an error to send them with an update whose
 * text has `USING`, `USING NAMED` or `WITH`.
 *
 * An HTTP backend gets the protocol parameters. Oxigraph's `Store.update` has
 * no dataset option, so an in-process store gets the same dataset as `USING`
 * clauses added to the text by {@link withUsingClauses}.
 */

import { Generator, Parser } from '@sparql-query-lib/compiler';
import type { SparqlDataset } from '../server/ISparqlExecutor.js';
import { DATASET_PARTS, EMPTY_DATASET_GRAPH, hasDataset } from './dataset.js';

/** The protocol parameter that carries each part of an update's dataset. */
export const UPDATE_DATASET_PARTS = [
  { key: 'defaultGraphs', parameter: 'using-graph-uri' },
  { key: 'namedGraphs', parameter: 'using-named-graph-uri' },
] as const satisfies ReadonlyArray<{ key: (typeof DATASET_PARTS)[number]['key']; parameter: string }>;

/** Refused: the update names its own dataset, and a dataset was also given. */
export class UpdateDatasetConflictError extends Error {
  readonly statusCode = 400;

  constructor() {
    super(
      'This update names its graphs in its text (USING, USING NAMED or WITH), so it cannot also take '
      + 'defaultGraphs or namedGraphs. Remove one of them.',
    );
    this.name = 'UpdateDatasetConflictError';
  }
}

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

/**
 * Facts about an update's text that decide how a dataset applies to it.
 * `reads` is true when an operation has a `WHERE` clause. `namesDataset` is
 * true when an operation has `USING`, `USING NAMED` or `WITH`. Text that does
 * not parse gives `null`: the backend reports the syntax error.
 */
export function updateDatasetShape(updateText: string): { reads: boolean; namesDataset: boolean } | null {
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
  };
}

/**
 * Throws {@link UpdateDatasetConflictError} when a dataset is given for an
 * update whose text names its own. The check the protocol asks of a service.
 */
export function assertUpdateTakesDataset(updateText: string, dataset: SparqlDataset | undefined): void {
  if (!hasDataset(dataset)) return;
  if (updateDatasetShape(updateText)?.namesDataset) throw new UpdateDatasetConflictError();
}

/** Dataset clause nodes, parsed so that they carry the fields the generator expects. */
function datasetClauses(dataset: SparqlDataset): Node[] {
  const template = new Parser().parse(
    'DELETE { ?s ?p ?o } USING <urn:sqlib:default> USING NAMED <urn:sqlib:named> WHERE { ?s ?p ?o }',
  ) as unknown as Node;
  const [defaultClause, namedClause] = (operationsOf(template)[0].from as { clauses: Node[] }).clauses;
  const clauses: Node[] = [];
  for (const { key } of DATASET_PARTS) {
    const graphs = dataset[key];
    if (graphs === undefined) continue;
    const clause = key === 'defaultGraphs' ? defaultClause : namedClause;
    for (const graph of graphs.length > 0 ? graphs : [EMPTY_DATASET_GRAPH]) {
      const copy = structuredClone(clause) as { value: { value: string } };
      copy.value.value = graph;
      clauses.push(copy as unknown as Node);
    }
  }
  return clauses;
}

/**
 * `DELETE WHERE { Q }` as `DELETE { Q } WHERE { Q }`, the form that can take
 * `USING`. The quads of `Q` become the matching triple and `GRAPH` patterns.
 */
function deleteWhereAsModify(operation: Node): Node {
  const template = operationsOf(new Parser().parse('DELETE { ?s ?p ?o } WHERE { ?s ?p ?o }') as unknown as Node)[0];
  const data = Array.isArray(operation.data) ? (operation.data as Node[]) : [];
  const patterns = data.map((quads) => quads.type === 'graph'
    ? { type: 'pattern', subType: 'graph', name: quads.graph, patterns: [quads.triples], loc: quads.loc }
    : quads);
  return {
    ...template,
    delete: data,
    where: { ...(template.where as Node), patterns },
  };
}

/**
 * The update text with the dataset as `USING` and `USING NAMED` clauses on
 * every operation that has a `WHERE` clause. Other operations are left as they
 * are. Throws {@link UpdateDatasetConflictError} when an operation already
 * names its dataset. With no dataset, the text is returned unchanged.
 */
export function withUsingClauses(updateText: string, dataset: SparqlDataset | undefined): string {
  if (!hasDataset(dataset)) return updateText;
  const parsed = new Parser().parse(updateText) as unknown as Node;
  const updates = Array.isArray(parsed.updates) ? (parsed.updates as Node[]) : [];
  if (updates.some((update) => isNode(update.operation) && namesItsDataset(update.operation))) {
    throw new UpdateDatasetConflictError();
  }
  const clauses = datasetClauses(dataset);
  let changed = false;
  for (const update of updates) {
    if (!isNode(update.operation)) continue;
    const operation: Node = update.operation.subType === 'deletewhere'
      ? deleteWhereAsModify(update.operation)
      : update.operation;
    if (operation.subType !== 'modify') continue;
    update.operation = operation;
    const from = operation.from;
    operation.from = { ...(isNode(from) ? from : { type: 'datasetClauses' }), clauses: structuredClone(clauses) };
    changed = true;
  }
  return changed ? new Generator().generate(parsed as never) : updateText;
}
