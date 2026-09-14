import { describe, it, expect } from 'vitest';
import { detectSparqlOperation } from '../../src/lib/queryTypeDetector.js';
import { QueryTypeIri } from '../../src/constants/queryTypes.js';

describe('detectSparqlOperation', () => {
  it('detects SELECT queries with PREFIX declarations', () => {
    const query = `
      PREFIX foaf: <http://xmlns.com/foaf/0.1/>
      SELECT ?name WHERE { ?person foaf:name ?name }
    `;
    expect(detectSparqlOperation(query)).toBe(QueryTypeIri.select);
  });

  it('detects ASK queries', () => {
    expect(detectSparqlOperation('ASK { ?s ?p ?o }')).toBe(QueryTypeIri.ask);
  });

  it('detects CONSTRUCT queries', () => {
    expect(detectSparqlOperation('CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }')).toBe(QueryTypeIri.construct);
  });

  it('detects DESCRIBE queries', () => {
    expect(detectSparqlOperation('DESCRIBE ?s WHERE { ?s ?p ?o } LIMIT 1')).toBe(QueryTypeIri.describe);
  });

  it('detects INSERT DATA updates', () => {
    expect(detectSparqlOperation('INSERT DATA { <urn:s> <urn:p> <urn:o> }')).toBe(QueryTypeIri.update);
  });

  it('detects DELETE WHERE updates', () => {
    expect(detectSparqlOperation('DELETE WHERE { ?s ?p ?o }')).toBe(QueryTypeIri.update);
  });

  it('detects LOAD updates', () => {
    expect(detectSparqlOperation('LOAD <http://example.org/data.ttl> INTO GRAPH <http://example.org/graph>')).toBe(QueryTypeIri.update);
  });

  it('detects WITH DELETE/INSERT updates', () => {
    const update = `
      WITH <http://example.org/graph>
      DELETE { ?s ?p ?o }
      INSERT { ?s ?p "updated" }
      WHERE { ?s ?p ?o }
    `;
    expect(detectSparqlOperation(update)).toBe(QueryTypeIri.update);
  });

  it('throws for empty queries', () => {
    expect(() => detectSparqlOperation('')).toThrow(/empty/i);
  });

  it('throws for invalid query text', () => {
    expect(() => detectSparqlOperation('VALUES ?s { <urn:s> }')).toThrow(/Failed to parse SPARQL query/i);
  });
});
