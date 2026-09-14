/**
 * An Oxigraph-backed {@link DeltaStore}.
 *
 * In-process Oxigraph is the reference target: it is the one place where the
 * templates are instantiated and the patch applied under the same lock, and the
 * only one that can answer a membership question about a blank node — so it is
 * where the equivalence suite pins the rewrite's correctness.
 *
 * Oxigraph is not imported here. The store is taken structurally, which keeps
 * this package free of the ~1 MiB WebAssembly build and lets a caller pass the
 * store it already has — the API's `OxigraphStoreManager`, a browser store, a
 * throwaway one in a test.
 *
 * That same rule is why simulation needs a `createStore` factory rather than a
 * `new oxigraph.Store()` here: forking means *making* a store, which is the one
 * thing a structural interface cannot do. A caller that passes the factory opts
 * into multi-operation preview; one that does not keeps the refusal.
 */

import type { DeltaStore, SimulationStore } from './deltaStore.js';
import type { QuadLike, TermLike } from './terms.js';

const N_QUADS = 'application/n-quads';

/** The subset of Oxigraph's `Store` this adapter uses. */
export interface OxigraphStoreLike {
  query(query: string, options?: Record<string, unknown>): unknown;
  match(subject?: unknown, predicate?: unknown, object?: unknown, graph?: unknown): unknown[];
  /** Simulation only: reading the store out, writing a copy back, advancing it. */
  dump?(options: { format: string }): string;
  load?(data: string, options: { format: string }): void;
  update?(update: string, options?: Record<string, unknown>): void;
}

export interface OxigraphDeltaStoreOptions {
  /**
   * How to make an empty store, which is what a fork is copied into.
   *
   * Supplying it is what makes multi-operation programs previewable against
   * this store: without it `fork` is absent and such a program is refused by
   * name rather than derived against the wrong state.
   */
  createStore?: () => OxigraphStoreLike;
}

/**
 * Wrap an Oxigraph store as a {@link DeltaStore}.
 *
 * `has` goes through `match` rather than a SPARQL `ASK`, which is what makes it
 * exact for blank nodes: the terms handed back to us are the store's own, so
 * matching on them compares node identity instead of a label that SPARQL text
 * could not have carried anyway.
 */
export function oxigraphDeltaStore(
  store: OxigraphStoreLike,
  options: OxigraphDeltaStoreOptions = {},
): DeltaStore {
  const base: DeltaStore = {
    async construct(sparql: string): Promise<QuadLike[]> {
      return (store.query(sparql) as QuadLike[]) ?? [];
    },

    async select(sparql: string): Promise<Array<Record<string, TermLike>>> {
      const rows = (store.query(sparql) as Array<Map<string, TermLike>>) ?? [];
      return rows.map((row) => Object.fromEntries(row));
    },

    has(quad: QuadLike): boolean {
      const graph = quad.graph && quad.graph.termType !== 'DefaultGraph' ? quad.graph : undefined;
      const matches = store.match(quad.subject, quad.predicate, quad.object, graph);
      if (graph) return matches.length > 0;
      // `match` with no graph searches every graph, so the default-graph case
      // has to be filtered back down; anything else would report a triple as
      // present because a *different* graph holds it.
      return matches.some((match) => {
        const found = (match as QuadLike).graph;
        return !found || found.termType === 'DefaultGraph' || found.value === '';
      });
    },
  };

  const createStore = options.createStore;
  if (!createStore || !store.dump) return base;

  return {
    ...base,
    async fork(): Promise<SimulationStore> {
      const copy = createStore();
      const nquads = store.dump!({ format: N_QUADS });
      if (nquads.trim()) copy.load?.(nquads, { format: N_QUADS });
      return {
        ...(oxigraphDeltaStore(copy, options) as SimulationStore),
        update(sparql: string): void {
          copy.update?.(sparql);
        },
      };
    },
  };
}
