/**
 * Canonicalising an RDF dataset, so that "are these two graphs the same graph?"
 * is a string comparison.
 *
 * RDFC-1.1 (URDNA2015, via `rdf-canonize`) answers that for RDF 1.1. It does
 * not answer it for RDF 1.2: `rdf-canonize` neither parses nor emits triple
 * terms, and its blank-node labelling walks a quad's subject and object as flat
 * terms, so a blank node that occurs only inside a triple term is never issued
 * an identifier at all.
 *
 * Rather than wait for a canonicalisation algorithm that covers RDF 1.2, a
 * dataset containing triple terms is *rewritten* into one that does not, in a
 * way that preserves isomorphism exactly, canonicalised, and rewritten back.
 * Each triple term becomes a fresh blank node carrying its three components
 * under a reserved vocabulary — a reification in all but name. The rewrite is
 * injective and structure-preserving, so two datasets are isomorphic if and
 * only if their rewrites are; and because the components are ordinary quads,
 * blank nodes nested inside a triple term take part in the labelling like any
 * other.
 */

import rdfCanonize from 'rdf-canonize';
import * as oxigraph from 'oxigraph';
import { quadToNQuad, type RenderableQuad, type RenderableTerm } from './nquads.js';

/**
 * The reserved predicates the rewrite hangs a triple term's components off.
 *
 * They must not occur in the data, or decoding would consume a triple the
 * caller wrote. `urn:` rather than a resolvable IRI, because nothing should
 * ever dereference these: they exist for the length of one comparison.
 */
const TT_NS = 'urn:sqlib:rdf-canonize:triple-term#';
const TT_SUBJECT = `${TT_NS}subject`;
const TT_PREDICATE = `${TT_NS}predicate`;
const TT_OBJECT = `${TT_NS}object`;

/**
 * Canonicalize an RDF dataset expressed as N-Quads using URDNA2015 (RDFC-1.1 compatible).
 * Returns canonical N-Quads (newline-delimited). Falls back to empty string when input is empty.
 */
export async function canonicalizeNQuads(nquads: string): Promise<string> {
  if (!nquads || !nquads.trim()) {
    return '';
  }

  // The common case is RDF 1.1, and it goes through `rdf-canonize` untouched:
  // the rewrite below is correct for those too, but routing every comparison
  // in the product through an Oxigraph parse to serve a minority of them would
  // be paying for triple terms on every test that has none.
  if (!nquads.includes('<<(')) {
    // Parse to quad objects first so invalid lines are caught eagerly
    const dataset = rdfCanonize.NQuads.parse(nquads);
    return rdfCanonize.canonize(dataset, { algorithm: 'URDNA2015', format: 'application/n-quads' });
  }

  return canonicalizeWithTripleTerms(nquads);
}

async function canonicalizeWithTripleTerms(nquads: string): Promise<string> {
  if (nquads.includes(TT_NS)) {
    throw new Error(`Cannot canonicalize a dataset that uses the reserved namespace <${TT_NS}>`);
  }

  // Oxigraph, not `rdf-canonize`, because only Oxigraph's parser knows RDF 1.2
  // syntax. A `Store` also folds duplicate quads, which canonicalisation would
  // have folded anyway.
  const store = new oxigraph.Store();
  store.load(nquads, { format: 'application/n-quads' });
  const quads = store.match() as unknown as RenderableQuad[];

  const encoded: RenderableQuad[] = [];
  const surrogates = new Map<string, RenderableTerm>();
  const mint = surrogateMinter(quads);

  /**
   * Replace a triple term by its surrogate blank node, emitting the component
   * quads that stand in for it. Equal triple terms intern to the same blank
   * node, so the rewrite preserves the fact that they are the same term.
   */
  const encodeTerm = (term: RenderableTerm): RenderableTerm => {
    if (term.termType !== 'Quad') return term;
    const subject = encodeTerm(term.subject!);
    const predicate = encodeTerm(term.predicate!);
    const object = encodeTerm(term.object!);
    const key = `${quadToNQuad({ subject, predicate, object })}`;
    const existing = surrogates.get(key);
    if (existing) return existing;

    const node: RenderableTerm = { termType: 'BlankNode', value: mint() };
    surrogates.set(key, node);
    const defaultGraph: RenderableTerm = { termType: 'DefaultGraph', value: '' };
    encoded.push(
      { subject: node, predicate: { termType: 'NamedNode', value: TT_SUBJECT }, object: subject, graph: defaultGraph },
      { subject: node, predicate: { termType: 'NamedNode', value: TT_PREDICATE }, object: predicate, graph: defaultGraph },
      { subject: node, predicate: { termType: 'NamedNode', value: TT_OBJECT }, object: object, graph: defaultGraph },
    );
    return node;
  };

  for (const quad of quads) {
    encoded.push({
      subject: encodeTerm(quad.subject),
      predicate: encodeTerm(quad.predicate),
      object: encodeTerm(quad.object),
      graph: quad.graph ?? { termType: 'DefaultGraph', value: '' },
    });
  }

  const canonical: string = await rdfCanonize.canonize(encoded, {
    algorithm: 'URDNA2015',
    format: 'application/n-quads',
  });
  return decodeTripleTerms(canonical);
}

/**
 * A blank-node label generator that cannot collide with a label already in the
 * dataset — including one nested inside a triple term, which is exactly the
 * kind of label a scan of the input text would be tempted to miss.
 */
function surrogateMinter(quads: RenderableQuad[]): () => string {
  const taken = new Set<string>();
  const collect = (term: RenderableTerm | undefined): void => {
    if (!term) return;
    if (term.termType === 'BlankNode') taken.add(term.value);
    if (term.termType === 'Quad') {
      collect(term.subject);
      collect(term.predicate);
      collect(term.object);
    }
  };
  for (const quad of quads) {
    collect(quad.subject);
    collect(quad.predicate);
    collect(quad.object);
    collect(quad.graph);
  }

  let counter = 0;
  return () => {
    let label = `ttcanon${counter++}`;
    while (taken.has(label)) label = `ttcanon${counter++}`;
    taken.add(label);
    return label;
  };
}

/**
 * Undo the rewrite on the canonical N-Quads that came back, and re-sort.
 *
 * The result is still a deterministic function of the canonical form — the same
 * dataset always decodes to the same text — which is all a comparison needs.
 * Canonical labels survive on the blank nodes that were in the data; the
 * surrogates disappear along with their component quads, so the labels that
 * remain have gaps in them. That is cosmetic, and preferable to renumbering,
 * which would be one more thing that has to agree on both sides of a diff.
 */
function decodeTripleTerms(canonical: string): string {
  const quads = rdfCanonize.NQuads.parse(canonical) as RenderableQuad[];

  const components = new Map<string, Partial<Record<'subject' | 'predicate' | 'object', RenderableTerm>>>();
  const rest: RenderableQuad[] = [];
  for (const quad of quads) {
    const slot = componentSlot(quad);
    if (!slot) {
      rest.push(quad);
      continue;
    }
    const entry = components.get(quad.subject.value) ?? {};
    entry[slot] = quad.object;
    components.set(quad.subject.value, entry);
  }

  // Nesting is finite — a triple term cannot contain itself — but the input to
  // this function is only trusted as far as `rdf-canonize` round-tripped what
  // we handed it. A cycle would otherwise be an unbounded recursion.
  const expand = (term: RenderableTerm, seen: Set<string>): RenderableTerm => {
    if (term.termType !== 'BlankNode') return term;
    const entry = components.get(term.value);
    if (!entry) return term;
    if (seen.has(term.value)) {
      throw new Error('Cyclic triple term encountered while decoding a canonicalized dataset');
    }
    const { subject, predicate, object } = entry;
    if (!subject || !predicate || !object) {
      throw new Error(`Incomplete triple term _:${term.value} in a canonicalized dataset`);
    }
    const nested = new Set(seen).add(term.value);
    return {
      termType: 'Quad',
      value: '',
      subject: expand(subject, nested),
      predicate: expand(predicate, nested),
      object: expand(object, nested),
    };
  };

  const lines = rest.map(quad =>
    quadToNQuad({
      subject: expand(quad.subject, new Set()),
      predicate: expand(quad.predicate, new Set()),
      object: expand(quad.object, new Set()),
      graph: quad.graph,
    }),
  );
  lines.sort();
  // Line-terminated, not line-separated: that is what `rdf-canonize` returns on
  // the other branch, and the two must be interchangeable.
  return lines.map(line => `${line}\n`).join('');
}

function componentSlot(quad: RenderableQuad): 'subject' | 'predicate' | 'object' | null {
  if (quad.subject.termType !== 'BlankNode' || quad.predicate.termType !== 'NamedNode') return null;
  switch (quad.predicate.value) {
    case TT_SUBJECT:
      return 'subject';
    case TT_PREDICATE:
      return 'predicate';
    case TT_OBJECT:
      return 'object';
    default:
      return null;
  }
}
