/**
 * The data graph a rule set runs against, as the UI needs to talk about it.
 *
 * These two shapes used to live on `rules/DataGraphStrip.vue`, which is gone:
 * the data graph is a runtime *input*, so it moved out of the editor column and
 * into the Inputs tab. Two screens name the types (the rule set work area and
 * the data graph record page), so they belong to neither.
 */

/** The serialisations the server will accept for inline content. */
export type DataGraphFormat = 'text/turtle' | 'application/n-triples' | 'application/n-quads';

export const DATA_GRAPH_FORMATS: Array<{ value: DataGraphFormat; label: string }> = [
  { value: 'text/turtle', label: 'Turtle' },
  { value: 'application/n-triples', label: 'N-Triples' },
  { value: 'application/n-quads', label: 'N-Quads' },
];

/** One selectable saved graph: its newest version, and what to say about it. */
export interface DataGraphOption {
  versionId: string;
  /** The graph's name, without the version — the picker shows the two apart. */
  name: string;
  version: number;
  /** "13 triples, text/turtle" — the line under the picker. */
  detail: string;
  /** The graph entity, so "open in Data" has something to point at. */
  graphId: string;
}

/** One selectable saved tuple set: same shape, different noun. */
export interface TupleSetOption {
  versionId: string;
  name: string;
  version: number;
  detail: string;
  tupleSetId: string;
  /** `head.vars` in order — the columns a row is read positionally against. */
  columns: string[];
}
