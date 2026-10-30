/**
 * The graphs a run reads: the dataset `FROM` and `FROM NAMED` would name,
 * chosen in the Arguments tab instead of written into the query.
 *
 * Nothing chosen means no restriction, and the run sends no dataset at all.
 * Once restricted, an empty list is a real answer: the run matches nothing.
 * That is the server's rule too, so the picker says it before the run does.
 */
import { ref, type Ref } from 'vue';

/** Which part of the dataset the one list fills, or `separate` for two lists. */
export type GraphApplyTo = 'both' | 'default' | 'named' | 'separate';

export interface GraphDataset {
  defaultGraphs?: string[];
  namedGraphs?: string[];
}

/** The most graphs the picker lists. One more than this says "there are more". */
export const GRAPH_LIST_LIMIT = 1000;

/** The query that lists a backend's named graphs for the picker. */
export const LIST_GRAPHS_QUERY = `SELECT DISTINCT ?g WHERE { GRAPH ?g {} } LIMIT ${GRAPH_LIST_LIMIT + 1}`;

/**
 * The IRI sent for a part with no graphs, over the SPARQL protocol.
 *
 * No parameter means "the endpoint's default dataset", usually everything, so
 * an empty part is sent as one graph that names nothing. The API uses the same
 * IRI for the same reason.
 */
export const EMPTY_DATASET_GRAPH = 'urn:sqlib:empty-dataset';

export interface GraphDatasetState {
  restricted: Ref<boolean>;
  applyTo: Ref<GraphApplyTo>;
  /** The one list, for every `applyTo` except `separate`. */
  graphs: Ref<string[]>;
  /** The two lists, for `separate`. */
  defaultGraphs: Ref<string[]>;
  namedGraphs: Ref<string[]>;
}

export function useGraphDataset() {
  const state: GraphDatasetState = {
    restricted: ref(false),
    applyTo: ref<GraphApplyTo>('both'),
    graphs: ref<string[]>([]),
    defaultGraphs: ref<string[]>([]),
    namedGraphs: ref<string[]>([]),
  };

  /** The request fields, or null when the run is not restricted. */
  function payload(): GraphDataset | null {
    return datasetOf({
      restricted: state.restricted.value,
      applyTo: state.applyTo.value,
      graphs: state.graphs.value,
      defaultGraphs: state.defaultGraphs.value,
      namedGraphs: state.namedGraphs.value,
    });
  }

  function clear() {
    state.restricted.value = false;
    state.graphs.value = [];
    state.defaultGraphs.value = [];
    state.namedGraphs.value = [];
  }

  return { ...state, payload, clear };
}

export type GraphDatasetComposable = ReturnType<typeof useGraphDataset>;

export function datasetOf(choice: {
  restricted: boolean;
  applyTo: GraphApplyTo;
  graphs: string[];
  defaultGraphs: string[];
  namedGraphs: string[];
}): GraphDataset | null {
  if (!choice.restricted) return null;
  switch (choice.applyTo) {
    case 'both':
      return { defaultGraphs: [...choice.graphs], namedGraphs: [...choice.graphs] };
    case 'default':
      return { defaultGraphs: [...choice.graphs] };
    case 'named':
      return { namedGraphs: [...choice.graphs] };
    case 'separate':
      return { defaultGraphs: [...choice.defaultGraphs], namedGraphs: [...choice.namedGraphs] };
  }
}

/** A short run-bar label: "all", "3 graphs" or "none". */
export function datasetSummary(dataset: GraphDataset | null): string {
  if (!dataset) return 'all';
  const graphs = new Set([...(dataset.defaultGraphs ?? []), ...(dataset.namedGraphs ?? [])]);
  if (graphs.size === 0) return 'none';
  return graphs.size === 1 ? '1 graph' : `${graphs.size} graphs`;
}

/** IRIs pasted as text: one per line, or separated by spaces or commas, with or without angle brackets. */
export function parseGraphIris(text: string): string[] {
  const iris: string[] = [];
  for (const token of text.split(/[\s,]+/)) {
    const iri = token.replace(/^<|>$/g, '').trim();
    if (/^[a-z][a-z0-9+.-]*:\S+$/i.test(iri) && !iris.includes(iri)) iris.push(iri);
  }
  return iris;
}

/** The SPARQL protocol parameters for a dataset, for a request the browser sends itself. */
export function datasetProtocolParams(dataset: GraphDataset | null | undefined): URLSearchParams {
  const params = new URLSearchParams();
  if (!dataset) return params;
  const parts = [
    ['default-graph-uri', dataset.defaultGraphs],
    ['named-graph-uri', dataset.namedGraphs],
  ] as const;
  for (const [name, graphs] of parts) {
    if (graphs === undefined) continue;
    for (const graph of graphs.length > 0 ? graphs : [EMPTY_DATASET_GRAPH]) params.append(name, graph);
  }
  return params;
}
