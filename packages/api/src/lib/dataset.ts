/**
 * Dataset inputs: the graphs `FROM` and `FROM NAMED` would name, supplied at
 * run time instead (docs/proposals/dataset-inputs.md on the proposals branch).
 *
 * A caller supplies one on `/sparql` and `/execute`, and a query group supplies
 * one along a `DATASET` edge. Either way it reaches the executor as
 * `SparqlQueryOptions.dataset`: an HTTP backend gets the SPARQL 1.1 Protocol
 * parameters `default-graph-uri` and `named-graph-uri`, and Oxigraph gets the
 * equivalent query options. The query text is never rewritten.
 */

import { isIri } from '@sparql-query-lib/contracts/iri';
import type { SparqlDataset } from '../server/ISparqlExecutor.js';
import { ValidationError } from './validationError.js';

export type { SparqlDataset };

/**
 * The IRI sent for a part of the dataset that has no graphs.
 *
 * Over HTTP, sending no dataset parameters means "the endpoint's default
 * dataset", which is usually everything. An empty part is therefore sent as
 * one graph that names nothing, so the query runs against no data rather than
 * all of it. Oxigraph takes an empty list as it is.
 */
export const EMPTY_DATASET_GRAPH = 'urn:sqlib:empty-dataset';

/** The parts of a dataset, and the protocol parameter each one is sent as. */
export const DATASET_PARTS = [
  { key: 'defaultGraphs', parameter: 'default-graph-uri' },
  { key: 'namedGraphs', parameter: 'named-graph-uri' },
] as const;

/** True when a dataset restricts at least one part. */
export function hasDataset(dataset: SparqlDataset | null | undefined): dataset is SparqlDataset {
  return Boolean(dataset && (dataset.defaultGraphs !== undefined || dataset.namedGraphs !== undefined));
}

/**
 * A dataset from request fields, or undefined when neither part is present.
 *
 * Each part must be an array of IRIs. A literal or blank node has no place in
 * a dataset, and is refused here, before anything is sent. Duplicates are
 * dropped, keeping the first.
 */
export function datasetFromRequest(input: { defaultGraphs?: unknown; namedGraphs?: unknown }): SparqlDataset | undefined {
  const dataset: SparqlDataset = {};
  for (const { key } of DATASET_PARTS) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (!Array.isArray(value)) throw new ValidationError(`${key} must be an array of IRIs`);
    const graphs: string[] = [];
    for (const graph of value) {
      if (typeof graph !== 'string' || !isIri(graph)) {
        throw new ValidationError(`${key} must hold IRIs only; ${JSON.stringify(graph)} is not one`);
      }
      if (!graphs.includes(graph)) graphs.push(graph);
    }
    dataset[key] = graphs;
  }
  return hasDataset(dataset) ? dataset : undefined;
}

/**
 * The graphs both datasets allow, part by part.
 *
 * An absent part restricts nothing, so the other dataset's part stands. Used
 * where a caller's dataset meets a group's `DATASET` edge: replacing the
 * edge's restriction with the caller's would let a caller widen what the group
 * author narrowed.
 */
export function intersectDatasets(
  a: SparqlDataset | undefined,
  b: SparqlDataset | undefined,
): SparqlDataset | undefined {
  if (!hasDataset(a)) return hasDataset(b) ? b : undefined;
  if (!hasDataset(b)) return a;
  const out: SparqlDataset = {};
  for (const { key } of DATASET_PARTS) {
    const left = a[key];
    const right = b[key];
    if (left === undefined && right === undefined) continue;
    out[key] = left === undefined ? right : right === undefined ? left : left.filter((graph) => right.includes(graph));
  }
  return out;
}

/**
 * The SPARQL 1.1 Protocol parameters for a dataset, one pair per graph, with
 * {@link EMPTY_DATASET_GRAPH} standing in for a part that is present and empty.
 */
export function datasetProtocolParameters(dataset: SparqlDataset | undefined): Array<[string, string]> {
  if (!hasDataset(dataset)) return [];
  const pairs: Array<[string, string]> = [];
  for (const { key, parameter } of DATASET_PARTS) {
    const graphs = dataset[key];
    if (graphs === undefined) continue;
    for (const graph of graphs.length > 0 ? graphs : [EMPTY_DATASET_GRAPH]) pairs.push([parameter, graph]);
  }
  return pairs;
}
