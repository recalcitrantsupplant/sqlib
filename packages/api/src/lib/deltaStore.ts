/**
 * Reaching a backend as a {@link DeltaStore}.
 *
 * `packages/rdf-delta` asks for two read-only entry points and, optionally, an
 * exact membership test. In-process Oxigraph satisfies all three directly — the
 * package ships that adapter. This module is the other case: a backend reachable
 * only over SPARQL, where both entry points have to be built out of an
 * `ISparqlExecutor` and the membership test cannot be offered at all.
 *
 * That asymmetry is not an implementation detail, it is the honest difference
 * between the two backend kinds, and it is why in-process Oxigraph is the
 * reference target: only there can a quad carrying a blank node be asked about,
 * and only there can derive-and-apply happen under one lock.
 */

import * as oxigraph from 'oxigraph';
import type { DeltaStore, QuadLike, TermLike } from '@sparql-query-lib/rdf-delta';
import { oxigraphDeltaStore } from '@sparql-query-lib/rdf-delta';
import type { ISparqlExecutor } from '../server/ISparqlExecutor.js';
import type { SparqlResultsJson } from './query-chaining.js';

export { oxigraphDeltaStore };

const N_QUADS = 'application/n-quads';

/**
 * A SPARQL term as it arrives in results JSON, including the `triple` form
 * SPARQL 1.2 uses for an RDF 1.2 triple term.
 */
type ResultTerm =
  | { type: 'uri' | 'bnode'; value: string }
  | { type: 'literal'; value: string; datatype?: string; 'xml:lang'?: string }
  | { type: 'triple'; value: { subject: ResultTerm; predicate: ResultTerm; object: ResultTerm } };

/**
 * A {@link DeltaStore} over anything that speaks SPARQL.
 *
 * No `has`: naming a blank node in SPARQL text is impossible, so the exact
 * membership test cannot be honoured over this transport. Leaving it off is
 * what makes `packages/rdf-delta` fall back to its `VALUES`-batched existence
 * query and report `netEffectExact: false` where that is not enough — rather
 * than an adapter here quietly answering a question it cannot.
 *
 * No `fork` either, and for a blunter reason: forking means copying the dataset,
 * and dragging a remote store across the wire to preview one multi-operation
 * program is a cost nobody asked for. Such a program is refused by name here,
 * which is what the issue asks for — simulation where it is cheap, an honest
 * refusal where it is not.
 */
export function executorDeltaStore(executor: ISparqlExecutor): DeltaStore {
  return {
    async construct(sparql: string): Promise<QuadLike[]> {
      const { result } = await executor.constructQueryParsed(sparql, { acceptHeader: N_QUADS });
      return parseNQuads(typeof result === 'string' ? result : '');
    },

    async select(sparql: string): Promise<Array<Record<string, TermLike>>> {
      const { result } = await executor.selectQueryParsed(sparql, {
        acceptHeader: 'application/sparql-results+json',
      });
      if (typeof result === 'string') {
        throw new Error('Backend returned SELECT results as text where JSON was requested');
      }
      const bindings = (result as SparqlResultsJson).results?.bindings ?? [];
      return bindings.map((binding) => {
        const row: Record<string, TermLike> = {};
        for (const [variable, value] of Object.entries(binding)) {
          row[variable] = fromResultTerm(value as ResultTerm);
        }
        return row;
      });
    },
  };
}

/**
 * Parse an N-Quads document into quads.
 *
 * Through Oxigraph rather than a hand-rolled reader: the same parser the rest of
 * the stack reads RDF with, so a literal escape or a triple term that round-trips
 * everywhere else round-trips here too.
 */
function parseNQuads(document: string): QuadLike[] {
  if (!document.trim()) return [];
  const store = new oxigraph.Store();
  store.load(document, { format: N_QUADS });
  return store.match(null, null, null, null) as unknown as QuadLike[];
}

function fromResultTerm(term: ResultTerm): TermLike {
  switch (term.type) {
    case 'uri':
      return { termType: 'NamedNode', value: term.value };
    case 'bnode':
      return { termType: 'BlankNode', value: term.value };
    case 'triple':
      return {
        termType: 'Quad',
        subject: fromResultTerm(term.value.subject),
        predicate: fromResultTerm(term.value.predicate),
        object: fromResultTerm(term.value.object),
      };
    case 'literal':
    default: {
      const literal = term as Extract<ResultTerm, { type: 'literal' }>;
      return {
        termType: 'Literal',
        value: literal.value,
        language: literal['xml:lang'],
        datatype: literal.datatype ? { value: literal.datatype } : undefined,
      };
    }
  }
}
