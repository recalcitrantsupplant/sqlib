/**
 * Whether the loaded Oxigraph binding applies dataset options on
 * `Store.update` (docs/proposals/update-dataset.md, "In-process Oxigraph").
 *
 * The Rust core has the API (`PreparedSparqlUpdate::using_datasets_mut`). The
 * JavaScript binding reads only `base_iri` up to at least 0.5.13, and ignores
 * any other option with no error. A version check would be wrong for a patched
 * or pre-release build, so the answer comes from a probe, once per process.
 */

import * as oxigraph from 'oxigraph';

/** The probe, on a given store factory, so a test can probe a stub. */
export function probeUpdateDataset(createStore: () => oxigraph.Store): boolean {
  try {
    const store = createStore();
    store.add(oxigraph.quad(
      oxigraph.namedNode('urn:sqlib:probe:s'),
      oxigraph.namedNode('urn:sqlib:probe:p'),
      oxigraph.namedNode('urn:sqlib:probe:o'),
    ));
    // With an empty default graph the WHERE clause matches nothing, so a
    // binding that applies the option inserts nothing.
    store.update(
      'INSERT { <urn:sqlib:probe:s2> <urn:sqlib:probe:p> <urn:sqlib:probe:o> } WHERE { ?s ?p ?o }',
      { default_graph: [], named_graphs: [] } as never,
    );
    return store.size === 1;
  } catch {
    return false;
  }
}

let supported: boolean | undefined;

/** True when this process's Oxigraph binding applies dataset options on update. */
export function oxigraphSupportsUpdateDataset(): boolean {
  supported ??= probeUpdateDataset(() => new oxigraph.Store());
  return supported;
}

/** Test seam: set the answer, or `undefined` to probe again. */
export function setOxigraphUpdateDatasetSupport(value: boolean | undefined): void {
  supported = value;
}
