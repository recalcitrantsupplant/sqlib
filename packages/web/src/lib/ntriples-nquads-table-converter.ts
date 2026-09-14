/**
 * Parses N-Triples and N-Quads content into tabular format using N3.js
 */

import { Parser, type Term } from 'n3';

/**
 * Represents a structured RDF term value similar to SPARQL binding values
 */
export interface RdfTermValue {
  value: string;
  type: 'uri' | 'bnode' | 'literal' | 'default-graph';
  datatype?: string;
  'xml:lang'?: string;
}

export interface TripleRow {
  s: RdfTermValue;
  p: RdfTermValue;
  o: RdfTermValue;
}

export interface QuadRow extends TripleRow {
  g: RdfTermValue | undefined;
}

export type RdfRow = TripleRow | QuadRow;

/**
 * Converts an N3 term to a structured RDF term value.
 *
 * n3.js types subject/predicate/object/graph as non-optional `Term`, so this
 * never actually receives `undefined` — the parameter stays required to keep
 * the return type non-optional for callers.
 */
function termToValue(term: Term): RdfTermValue {
  // Handle DefaultGraph - return a special value for empty graph in N-Quads
  if (term.termType === 'DefaultGraph') {
    return {
      value: '(Default Graph)',
      type: 'default-graph',
    };
  }

  // Handle different term types from N3.js
  if (term.termType === 'NamedNode') {
    return {
      value: term.value,
      type: 'uri',
    };
  } else if (term.termType === 'BlankNode') {
    return {
      value: term.value, // Already in _:xxx format
      type: 'bnode',
    };
  } else if (term.termType === 'Literal') {
    const result: RdfTermValue = {
      value: term.value,
      type: 'literal',
    };

    if (term.language) {
      result['xml:lang'] = term.language;
    } else if (term.datatype && term.datatype.value !== 'http://www.w3.org/2001/XMLSchema#string') {
      result.datatype = term.datatype.value;
    }

    return result;
  }

  return {
    value: term.value || String(term),
    type: 'literal',
  };
}

/**
 * Parses N-Triples content into an array of triple objects
 */
export function parseNTriples(content: string): TripleRow[] {
  const parser = new Parser({ format: 'N-Triples' });
  const triples: TripleRow[] = [];

  try {
    const quads = parser.parse(content);

    for (const quad of quads) {
      triples.push({
        s: termToValue(quad.subject),
        p: termToValue(quad.predicate),
        o: termToValue(quad.object),
      });
    }
  } catch (error) {
    console.error('Error parsing N-Triples:', error);
    // Return what we have so far
  }

  return triples;
}

/**
 * Parses N-Quads content into an array of quad objects
 */
export function parseNQuads(content: string): QuadRow[] {
  const parser = new Parser({ format: 'N-Quads' });
  const quads: QuadRow[] = [];

  try {
    const parsedQuads = parser.parse(content);

    for (const quad of parsedQuads) {
      quads.push({
        s: termToValue(quad.subject),
        p: termToValue(quad.predicate),
        o: termToValue(quad.object),
        g: termToValue(quad.graph),
      });
    }
  } catch (error) {
    console.error('Error parsing N-Quads:', error);
    // Return what we have so far
  }

  return quads;
}

/**
 * Determines if content type is N-Triples
 */
export function isNTriplesContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const normalized = contentType.split(';')[0].trim().toLowerCase();
  return normalized === 'application/n-triples';
}

/**
 * Determines if content type is N-Quads
 */
export function isNQuadsContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const normalized = contentType.split(';')[0].trim().toLowerCase();
  return normalized === 'application/n-quads';
}
