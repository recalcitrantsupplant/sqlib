/**
 * Term serialisation shared by the generated persistence queries.
 */

/**
 * Renders an IRI as a SPARQL term.
 *
 * Predicate and class IRIs come from compiled-in schemas and are trusted; entity
 * ids come from callers and are not. Anything that could close the angle bracket
 * and continue the query is refused rather than escaped, because a legitimate
 * entity id never contains these characters.
 */
export function iri(value: string): string {
  if (/[<>"{}|\\^`\s]/.test(value)) {
    throw new Error(`Refusing to build a query with an unsafe IRI: ${JSON.stringify(value)}`);
  }
  return `<${value}>`;
}

export const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type';

/** Escapes a lexical form for an N-Triples/SPARQL quoted literal. */
export function escapeLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Renders a literal term. A plain literal is emitted when no datatype is given,
 * matching what LDKit writes for `xsd:string` — and in RDF 1.1 the two are the
 * same term anyway.
 */
export function literal(value: string, datatype: string | null): string {
  const quoted = `"${escapeLiteral(value)}"`;
  return datatype ? `${quoted}^^${iri(datatype)}` : quoted;
}
