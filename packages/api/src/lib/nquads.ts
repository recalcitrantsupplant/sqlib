/**
 * Writing RDF terms and quads as N-Quads, triple terms included.
 *
 * One module rather than a private helper per caller, because the executor's
 * dataset signature, the inference graph it hands back and the canonicaliser
 * that judges a test must all render the *same* term the same way. Two
 * renderings that disagree do not fail loudly: they diff as "one missing, one
 * unexpected" against a graph that is in fact identical.
 *
 * RDF 1.2 triple terms are the reason this is not three lines. Oxigraph parses
 * and stores them — `:s :p :o ~:r {| :w 9 |}` yields a quad whose object is a
 * `Quad` — so every renderer downstream meets one eventually, and the ones that
 * switched on term type used to throw `Unsupported RDF term type: Quad` at the
 * first W3C rules entry that used the syntax.
 */

/**
 * The shape this module renders.
 *
 * Structurally an RDF/JS term, but deliberately not typed as `oxigraph.Term`:
 * the canonicaliser walks plain objects that came back from an N-Quads parser
 * rather than from a store, and they render identically.
 */
export interface RenderableTerm {
  termType: string;
  value: string;
  language?: string;
  datatype?: { value: string };
  subject?: RenderableTerm;
  predicate?: RenderableTerm;
  object?: RenderableTerm;
  graph?: RenderableTerm;
}

export interface RenderableQuad {
  subject: RenderableTerm;
  predicate: RenderableTerm;
  object: RenderableTerm;
  graph?: RenderableTerm;
}

/** Render one quad as a single N-Quads line, without the trailing newline. */
export function quadToNQuad(quad: RenderableQuad): string {
  const subject = termToNQuad(quad.subject);
  const predicate = termToNQuad(quad.predicate);
  const object = termToNQuad(quad.object);
  const graph = quad.graph && quad.graph.termType !== 'DefaultGraph' ? ` ${termToNQuad(quad.graph)}` : '';
  return `${subject} ${predicate} ${object}${graph} .`;
}

/** Render one term in N-Quads syntax. Triple terms come out as `<<( s p o )>>`. */
export function termToNQuad(term: RenderableTerm): string {
  switch (term.termType) {
    case 'NamedNode':
      return `<${term.value}>`;
    case 'BlankNode':
      return `_:${term.value}`;
    case 'Literal': {
      const escaped = term.value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
      let literal = `"${escaped}"`;
      if (term.language) {
        literal += `@${term.language}`;
      } else if (term.datatype && term.datatype.value !== 'http://www.w3.org/2001/XMLSchema#string') {
        literal += `^^<${term.datatype.value}>`;
      }
      return literal;
    }
    // An RDF 1.2 triple term. Oxigraph reports one as a `Quad` whose graph is
    // the default graph — a triple term is a term, not a statement in a graph,
    // so the graph component is ignored rather than rendered.
    case 'Quad': {
      const { subject, predicate, object } = term;
      if (!subject || !predicate || !object) {
        throw new Error('Malformed triple term: subject, predicate and object are all required');
      }
      return `<<( ${termToNQuad(subject)} ${termToNQuad(predicate)} ${termToNQuad(object)} )>>`;
    }
    case 'DefaultGraph':
      return '';
    default:
      throw new Error(`Unsupported RDF term type: ${term.termType}`);
  }
}
