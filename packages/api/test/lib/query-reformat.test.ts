import { describe, it, expect } from 'vitest';
import { SparqlQueryParser } from '../../src/lib/parser.js';

// Reformatting now goes through the app's Traqula-based parser/generator
// (the vendored sparqljs fork was retired). Traqula preserves declared prefixes
// rather than pruning unused ones — see the Tier A migration notes.
describe('SPARQL Query Reformatting', () => {
  const sparql = new SparqlQueryParser();

  /**
   * Helper function to reformat a SPARQL query
   * @param queryString The original SPARQL query string
   * @returns The reformatted query string
   */
  const reformatQuery = (queryString: string): string => {
    return sparql.formatQuery(sparql.parseQuery(queryString));
  };

  it('should reformat a simple SELECT query', () => {
    const messyQuery = `SELECT   ?subject    ?predicate   ?object
    WHERE {
        ?subject   ?predicate   ?object .
    }`;

    const reformatted = reformatQuery(messyQuery);

    // Check that the query is reformatted (sparqljs has its own formatting style)
    expect(reformatted).toContain('SELECT');
    expect(reformatted).toContain('?subject');
    expect(reformatted).toContain('?predicate');
    expect(reformatted).toContain('?object');
    expect(reformatted).toContain('WHERE');

    // Log the output to see the formatting
    console.log('Original query:');
    console.log(messyQuery);
    console.log('\nReformatted query:');
    console.log(reformatted);
  });

  it('should reformat a complex query with FILTER and OPTIONAL', () => {
    const messyQuery = `PREFIX foaf: <http://xmlns.com/foaf/0.1/>
    SELECT ?name ?email WHERE {
      ?person foaf:name ?name .
      OPTIONAL { ?person foaf:email ?email }
      FILTER (?name = "John")
    }`;

    const reformatted = reformatQuery(messyQuery);

    expect(reformatted).toContain('PREFIX');
    expect(reformatted).toContain('foaf');
    expect(reformatted).toContain('SELECT');
    expect(reformatted).toContain('OPTIONAL');
    expect(reformatted).toContain('FILTER');

    console.log('\n--- Complex query test ---');
    console.log('Original query:');
    console.log(messyQuery);
    console.log('\nReformatted query:');
    console.log(reformatted);
  });

  it('should preserve query semantics after reformatting', () => {
    const originalQuery = `SELECT ?s ?p ?o WHERE { ?s ?p ?o }`;

    // Reformat once
    const reformatted1 = reformatQuery(originalQuery);

    // Reformat again - should be stable
    const reformatted2 = reformatQuery(reformatted1);

    // The reformatted versions should be identical (idempotent)
    expect(reformatted1).toBe(reformatted2);

    console.log('\n--- Idempotency test ---');
    console.log('First reformat:');
    console.log(reformatted1);
    console.log('\nSecond reformat:');
    console.log(reformatted2);
  });

  it('should handle UPDATE queries', () => {
    const messyUpdate = `PREFIX dc: <http://purl.org/dc/elements/1.1/>
    DELETE DATA {
      <http://example/book1> dc:title "A new book" .
    }`;

    const reformatted = reformatQuery(messyUpdate);

    expect(reformatted).toContain('PREFIX');
    expect(reformatted).toContain('DELETE DATA');

    console.log('\n--- UPDATE query test ---');
    console.log('Original update:');
    console.log(messyUpdate);
    console.log('\nReformatted update:');
    console.log(reformatted);
  });

  it('should handle queries with multiple prefixes', () => {
    const queryWithPrefixes = `PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX foaf: <http://xmlns.com/foaf/0.1/>
PREFIX dc: <http://purl.org/dc/elements/1.1/>

SELECT ?title ?name ?type
WHERE {
  ?book dc:title ?title .
  ?book dc:creator ?author .
  ?author foaf:name ?name .
  ?book rdf:type ?type .
}`;

    const reformatted = reformatQuery(queryWithPrefixes);

    // sparqljs will only include prefixes that are actually used in the query
    expect(reformatted).toContain('PREFIX rdf:');
    expect(reformatted).toContain('PREFIX foaf:');
    expect(reformatted).toContain('PREFIX dc:');

    console.log('\n--- Multiple prefixes test ---');
    console.log('Original query:');
    console.log(queryWithPrefixes);
    console.log('\nReformatted query:');
    console.log(reformatted);
    console.log('\nNote: sparqljs removes unused prefixes automatically');
  });
});
