import { describe, it, expect, beforeEach } from 'vitest';
import { SparqlQueryParser } from '../../src/lib/parser.js';

describe('SparqlQueryParser - parseQuery', () => {
  let parser: SparqlQueryParser;

  beforeEach(() => {
    parser = new SparqlQueryParser();
  });

  it('should parse a valid SPARQL query', () => {
    // Arrange
    const queryString = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      
      SELECT ?subject ?predicate ?object
      WHERE {
        ?subject ?predicate ?object .
      }
      LIMIT 10
    `;

    // Act
    const result = parser.parseQuery(queryString) as any;

    // Assert (Traqula AST shape)
    expect(result).toBeDefined();
    expect(result.type).toBe('query');
    expect(result.subType).toBe('select');
    expect(result.variables.map((v: any) => ({ subType: v.subType, value: v.value }))).toEqual([
      { subType: 'variable', value: 'subject' },
      { subType: 'variable', value: 'predicate' },
      { subType: 'variable', value: 'object' }
    ]);
    // WHERE is a single group pattern wrapping the BGP.
    expect(result.where.subType).toBe('group');
    expect(result.where.patterns).toHaveLength(1);
    expect(result.solutionModifiers.limitOffset.limit).toBe(10);
  });

  it('should throw an error for an invalid SPARQL query', () => {
    // Arrange
    const invalidQuery = 'SELECT * WHERE { INVALID SYNTAX }';

    // Act & Assert
    // Wrap the call in a function for expect(...).toThrow()
    const parseAction = () => parser.parseQuery(invalidQuery);
    expect(parseAction).toThrow(/^Failed to parse SPARQL query:/); // Check for specific error message start
  });
});
