/**
 * Terms and quads, structurally.
 *
 * The package deliberately does not depend on an RDF library. Everything it
 * touches comes back from a store — Oxigraph in process, an HTTP endpoint's
 * results parser elsewhere — and every such term already satisfies the RDF/JS
 * `Term` interface, so the structural subset below is all that is needed to
 * accept them without conversion.
 *
 * The one thing this file is opinionated about is **equality**. Issue #165
 * documents what happens when RDF terms are compared as rendered strings:
 * `:rel` and `<http://…/rel>` denote the same IRI and miss each other. Every
 * comparison here goes through {@link quadKey}, which is built from the parsed
 * components — term type, absolute IRI, lexical form, datatype, language — and
 * never from the source text.
 */

export interface NamedNodeLike {
  termType: 'NamedNode';
  value: string;
}

export interface BlankNodeLike {
  termType: 'BlankNode';
  value: string;
}

export interface LiteralLike {
  termType: 'Literal';
  value: string;
  language?: string;
  datatype?: { value: string };
}

export interface DefaultGraphLike {
  termType: 'DefaultGraph';
  value: string;
}

/** An RDF 1.2 triple term, as Oxigraph hands one back. */
export interface QuadTermLike {
  termType: 'Quad' | 'Triple';
  subject: TermLike;
  predicate: TermLike;
  object: TermLike;
}

export type TermLike =
  | NamedNodeLike
  | BlankNodeLike
  | LiteralLike
  | DefaultGraphLike
  | QuadTermLike;

/** What can stand in graph position: never a literal, never a triple term. */
export type GraphTermLike = NamedNodeLike | BlankNodeLike | DefaultGraphLike;

/**
 * A quad. `graph` absent, or a `DefaultGraph`, both mean the default graph —
 * RDF/JS says the latter, CONSTRUCT results say the former, and treating them
 * as the same thing is cheaper than normalising at every boundary.
 */
export interface QuadLike {
  subject: TermLike;
  predicate: TermLike;
  object: TermLike;
  graph?: GraphTermLike | null;
}

const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string';

/** IRI of the graph a quad is in, or `undefined` for the default graph. */
export function graphIri(quad: QuadLike): string | undefined {
  const graph = quad.graph;
  if (!graph || graph.termType === 'DefaultGraph' || graph.value === '') return undefined;
  return graph.value;
}

/**
 * The same triple, in another graph.
 *
 * `undefined` means the default graph, and is written as an explicit `null` on
 * the quad: a CONSTRUCT result has no graph at all, and stamping the graph the
 * template asked for is what turns triples back into quads.
 */
export function withGraph(quad: QuadLike, graph: string | undefined): QuadLike {
  return {
    subject: quad.subject,
    predicate: quad.predicate,
    object: quad.object,
    graph: graph === undefined ? null : { termType: 'NamedNode', value: graph },
  };
}

/** True when a term is, or contains, a blank node. */
export function hasBlankNode(term: TermLike): boolean {
  if (term.termType === 'BlankNode') return true;
  if (term.termType === 'Quad' || term.termType === 'Triple') {
    return hasBlankNode(term.subject) || hasBlankNode(term.predicate) || hasBlankNode(term.object);
  }
  return false;
}

/** True when any position of the quad is, or contains, a blank node. */
export function quadHasBlankNode(quad: QuadLike): boolean {
  return (
    hasBlankNode(quad.subject) ||
    hasBlankNode(quad.predicate) ||
    hasBlankNode(quad.object) ||
    (quad.graph ? hasBlankNode(quad.graph) : false)
  );
}

/**
 * Render one term as N-Triples.
 *
 * Also the term syntax SPARQL accepts in a `VALUES` block, which is why the
 * existence queries in `derive.ts` can be built from it directly.
 */
export function termToNTriples(term: TermLike): string {
  switch (term.termType) {
    case 'NamedNode':
      return `<${term.value}>`;
    case 'BlankNode':
      return `_:${term.value}`;
    case 'DefaultGraph':
      return '';
    case 'Quad':
    case 'Triple':
      return `<<( ${termToNTriples(term.subject)} ${termToNTriples(term.predicate)} ${termToNTriples(term.object)} )>>`;
    case 'Literal': {
      const lexical = `"${escapeLiteral(term.value)}"`;
      if (term.language) return `${lexical}@${term.language}`;
      const datatype = term.datatype?.value;
      if (!datatype || datatype === XSD_STRING) return lexical;
      return `${lexical}^^<${datatype}>`;
    }
  }
}

function escapeLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/** Render one quad as an N-Quads line, without the trailing newline. */
export function quadToNQuad(quad: QuadLike): string {
  const graph = graphIri(quad);
  const triple = `${termToNTriples(quad.subject)} ${termToNTriples(quad.predicate)} ${termToNTriples(quad.object)}`;
  return graph === undefined ? `${triple} .` : `${triple} <${graph}> .`;
}

/** Render quads as an N-Quads document. */
export function quadsToNQuads(quads: readonly QuadLike[]): string {
  return quads.length === 0 ? '' : `${quads.map(quadToNQuad).join('\n')}\n`;
}

/**
 * The identity of a quad, for set membership.
 *
 * N-Quads over parsed components: two quads share a key exactly when they are
 * the same RDF quad. Blank node labels take part, which is what makes a quad
 * carrying a store blank node match the same quad read back from the store, and
 * a freshly minted template blank node match nothing.
 */
export function quadKey(quad: QuadLike): string {
  return quadToNQuad(quad);
}

/** A set of quads, keyed by {@link quadKey}. */
export class QuadSet {
  private readonly byKey = new Map<string, QuadLike>();

  constructor(quads: Iterable<QuadLike> = []) {
    for (const quad of quads) this.add(quad);
  }

  add(quad: QuadLike): void {
    this.byKey.set(quadKey(quad), quad);
  }

  has(quad: QuadLike): boolean {
    return this.byKey.has(quadKey(quad));
  }

  delete(quad: QuadLike): void {
    this.byKey.delete(quadKey(quad));
  }

  get size(): number {
    return this.byKey.size;
  }

  values(): QuadLike[] {
    return [...this.byKey.values()];
  }
}
