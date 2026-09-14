import { describe, it, expect } from 'vitest';
import { SparqlQueryParser } from '../../src/lib/parser.js';

describe('SparqlQueryParser - applyLimitOffsetParameters', () => {
  let parser: SparqlQueryParser;

  beforeEach(() => {
    parser = new SparqlQueryParser();
  });

  describe('Basic LIMIT parameter substitution', () => {
    it('should replace single LIMIT parameter', () => {
      const queryString = `
        SELECT ?s ?p ?o 
        WHERE { ?s ?p ?o }
        LIMIT 0001
      `;
      const limitParams = [{ name: '1', value: 10 }];
      
      const result = parser.applyLimitOffsetParameters(queryString, limitParams);
      
      expect(result).toContain('LIMIT 10');
      expect(result).not.toContain('LIMIT 0001');
    });

    it('should replace multiple LIMIT parameters with different values', () => {
      const queryString = `
        SELECT ?s ?p ?o 
        WHERE { 
          { SELECT ?s WHERE { ?s ?p ?o } LIMIT 0001 }
          UNION
          { SELECT ?p WHERE { ?s ?p ?o } LIMIT 0002 }
        }
        LIMIT 0003
      `;
      const limitParams = [
        { name: '1', value: 5 },
        { name: '2', value: 15 },
        { name: '3', value: 100 }
      ];
      
      const result = parser.applyLimitOffsetParameters(queryString, limitParams);
      
      expect(result).toContain('LIMIT 5');
      expect(result).toContain('LIMIT 15'); 
      expect(result).toContain('LIMIT 100');
      expect(result).not.toContain('0001');
      expect(result).not.toContain('0002');
      expect(result).not.toContain('0003');
    });

    it('should handle LIMIT parameters with leading zeros', () => {
      const queryString = `
        SELECT ?s ?p ?o 
        WHERE { ?s ?p ?o }
        LIMIT 00010
      `;
      const limitParams = [{ name: '10', value: 50 }];
      
      const result = parser.applyLimitOffsetParameters(queryString, limitParams);
      
      expect(result).toContain('LIMIT 50');
      expect(result).not.toContain('00010');
    });
  });

  describe('Basic OFFSET parameter substitution', () => {
    it('should replace single OFFSET parameter', () => {
      const queryString = `
        SELECT ?s ?p ?o 
        WHERE { ?s ?p ?o }
        OFFSET 0001
      `;
      const offsetParams = [{ name: '1', value: 20 }];
      
      const result = parser.applyLimitOffsetParameters(queryString, [], offsetParams);
      
      expect(result).toContain('OFFSET 20');
      expect(result).not.toContain('OFFSET 0001');
    });

    it('should replace multiple OFFSET parameters', () => {
      const queryString = `
        SELECT ?s ?p ?o 
        WHERE { 
          { SELECT ?s WHERE { ?s ?p ?o } OFFSET 0001 }
          UNION
          { SELECT ?p WHERE { ?s ?p ?o } OFFSET 0002 }
        }
        OFFSET 0003
      `;
      const offsetParams = [
        { name: '1', value: 0 },
        { name: '2', value: 10 },
        { name: '3', value: 50 }
      ];
      
      const result = parser.applyLimitOffsetParameters(queryString, [], offsetParams);
      
      expect(result).toContain('OFFSET 0');
      expect(result).toContain('OFFSET 10');
      expect(result).toContain('OFFSET 50');
      expect(result).not.toContain('0001');
      expect(result).not.toContain('0002'); 
      expect(result).not.toContain('0003');
    });
  });

  describe('Combined LIMIT and OFFSET substitution', () => {
    it('should replace both LIMIT and OFFSET in same query', () => {
      const queryString = `
        SELECT ?s ?p ?o 
        WHERE { ?s ?p ?o }
        LIMIT 0001
        OFFSET 0002
      `;
      const limitParams = [{ name: '1', value: 25 }];
      const offsetParams = [{ name: '2', value: 100 }];
      
      const result = parser.applyLimitOffsetParameters(queryString, limitParams, offsetParams);
      
      expect(result).toContain('LIMIT 25');
      expect(result).toContain('OFFSET 100');
      expect(result).not.toContain('0001');
      expect(result).not.toContain('0002');
    });

    it('should handle complex query with VALUES UNDEF, LIMIT and OFFSET', () => {
      const queryString = `
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT * WHERE {
          VALUES ?p { UNDEF }
          ?s ?p ?o .
        }
        LIMIT 0001
        OFFSET 0002
      `;
      const limitParams = [{ name: '1', value: 10 }];
      const offsetParams = [{ name: '2', value: 5 }];
      
      const result = parser.applyLimitOffsetParameters(queryString, limitParams, offsetParams);
      
      expect(result).toContain('LIMIT 10');
      expect(result).toContain('OFFSET 5');
      expect(result).toContain('VALUES ?p { UNDEF }'); // Should preserve UNDEF
      expect(result).not.toContain('0001');
      expect(result).not.toContain('0002');
    });

    it('should handle pagination scenario with multiple pages', () => {
      const queryString = `
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        SELECT ?item ?label
        WHERE {
          ?item rdfs:label ?label .
        }
        ORDER BY ?label
        LIMIT 0001
        OFFSET 0002
      `;
      
      // Test different pages
      const testCases = [
        { limitParams: [{ name: '1', value: 10 }], offsetParams: [{ name: '2', value: 0 }], expected: { limit: 10, offset: 0 } },   // Page 1
        { limitParams: [{ name: '1', value: 10 }], offsetParams: [{ name: '2', value: 10 }], expected: { limit: 10, offset: 10 } }, // Page 2
        { limitParams: [{ name: '1', value: 10 }], offsetParams: [{ name: '2', value: 20 }], expected: { limit: 10, offset: 20 } }, // Page 3
      ];

      testCases.forEach(({ limitParams, offsetParams, expected }, index) => {
        const result = parser.applyLimitOffsetParameters(queryString, limitParams, offsetParams);
        expect(result).toContain(`LIMIT ${expected.limit}`);
        expect(result).toContain(`OFFSET ${expected.offset}`);
        expect(result).not.toContain('0001');
        expect(result).not.toContain('0002');
      });
    });
  });

  describe('Edge cases and error handling', () => {
    it('should handle query with no parameterized LIMIT/OFFSET', () => {
      const queryString = `
        SELECT ?s ?p ?o 
        WHERE { ?s ?p ?o }
        LIMIT 100
        OFFSET 50
      `;
      const limitParams = [{ name: '1', value: 10 }];
      const offsetParams = [{ name: '2', value: 20 }];
      
      const result = parser.applyLimitOffsetParameters(queryString, limitParams, offsetParams);
      
      // Should return unchanged since no parameterized limits/offsets
      expect(result).toContain('LIMIT 100');
      expect(result).toContain('OFFSET 50');
    });

    it('should ignore parameters with no matching placeholders', () => {
      const queryString = `
        SELECT ?s ?p ?o 
        WHERE { ?s ?p ?o }
        LIMIT 0001
      `;
      const limitParams = [
        { name: '1', value: 10 },  // Should match
        { name: '2', value: 20 },  // No matching placeholder
        { name: '3', value: 30 }   // No matching placeholder
      ];
      
      const result = parser.applyLimitOffsetParameters(queryString, limitParams);
      
      expect(result).toContain('LIMIT 10');
      expect(result).not.toContain('0001');
    });

    it('should handle empty parameter arrays', () => {
      const queryString = `
        SELECT ?s ?p ?o 
        WHERE { ?s ?p ?o }
        LIMIT 0001
        OFFSET 0002
      `;
      
      const result = parser.applyLimitOffsetParameters(queryString, [], []);
      
      // Should return unchanged since no parameters provided
      expect(result).toContain('LIMIT 0001');
      expect(result).toContain('OFFSET 0002');
    });

    it('should throw error for invalid limit parameter format', () => {
      const queryString = `SELECT ?s ?p ?o WHERE { ?s ?p ?o } LIMIT 0001`;
      
      expect(() => {
        parser.applyLimitOffsetParameters(queryString, null as any);
      }).toThrow('Invalid limitParams format: Expected an array');

      expect(() => {
        parser.applyLimitOffsetParameters(queryString, 'invalid' as any);
      }).toThrow('Invalid limitParams format: Expected an array');
    });

    it('should throw error for invalid offset parameter format', () => {
      const queryString = `SELECT ?s ?p ?o WHERE { ?s ?p ?o } OFFSET 0001`;
      
      expect(() => {
        parser.applyLimitOffsetParameters(queryString, [], null as any);
      }).toThrow('Invalid offsetParams format: Expected an array');

      expect(() => {
        parser.applyLimitOffsetParameters(queryString, [], 'invalid' as any);
      }).toThrow('Invalid offsetParams format: Expected an array');
    });

    it('should throw error for malformed SPARQL query', () => {
      const malformedQuery = 'SELECT ?s ?p ?o WHERE { ?s ?p'; // Missing closing brace
      const limitParams = [{ name: '1', value: 10 }];
      
      expect(() => {
        parser.applyLimitOffsetParameters(malformedQuery, limitParams);
      }).toThrow(); // Should throw parsing error
    });
  });

  describe('Different query types', () => {
    it('should handle CONSTRUCT queries with LIMIT/OFFSET', () => {
      const queryString = `
        PREFIX ex: <http://example.org/>
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        CONSTRUCT { ?s ex:hasLabel ?o }
        WHERE { ?s rdfs:label ?o }
        LIMIT 0001
        OFFSET 0002
      `;
      const limitParams = [{ name: '1', value: 50 }];
      const offsetParams = [{ name: '2', value: 25 }];
      
      const result = parser.applyLimitOffsetParameters(queryString, limitParams, offsetParams);
      
      expect(result).toContain('LIMIT 50');
      expect(result).toContain('OFFSET 25');
      expect(result).toContain('CONSTRUCT');
    });

    it('should handle DESCRIBE queries with LIMIT/OFFSET', () => {
      const queryString = `
        DESCRIBE ?s
        WHERE { ?s a ?type }
        LIMIT 0001
        OFFSET 0002
      `;
      const limitParams = [{ name: '1', value: 5 }];
      const offsetParams = [{ name: '2', value: 10 }];
      
      const result = parser.applyLimitOffsetParameters(queryString, limitParams, offsetParams);
      
      expect(result).toContain('LIMIT 5');
      expect(result).toContain('OFFSET 10');
      expect(result).toContain('DESCRIBE');
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle e-commerce product listing with pagination', () => {
      const queryString = `
        PREFIX shop: <http://example.org/shop/>
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        
        SELECT ?product ?name ?price ?category
        WHERE {
          ?product rdf:type shop:Product ;
                   shop:name ?name ;
                   shop:price ?price ;
                   shop:category ?category .
          FILTER(?price > 10.00)
        }
        ORDER BY ?price
        LIMIT 0001
        OFFSET 0002
      `;
      
      // Page 2 of products, showing 20 per page
      const limitParams = [{ name: '1', value: 20 }];
      const offsetParams = [{ name: '2', value: 20 }];
      
      const result = parser.applyLimitOffsetParameters(queryString, limitParams, offsetParams);
      
      expect(result).toContain('LIMIT 20');
      expect(result).toContain('OFFSET 20');
      expect(result).toContain('ORDER BY ?price');
      expect(result).toContain('FILTER(?price > 10.00)');
    });

    it('should handle research dataset sampling', () => {
      const queryString = `
        PREFIX dcat: <http://www.w3.org/ns/dcat#>
        PREFIX foaf: <http://xmlns.com/foaf/0.1/>
        
        PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
        SELECT ?dataset ?title ?creator ?modified
        WHERE {
          ?dataset rdf:type dcat:Dataset ;
                   dcat:title ?title ;
                   dcat:creator ?creator ;
                   dcat:modified ?modified .
          VALUES ?creator { UNDEF }
        }
        ORDER BY DESC(?modified)
        LIMIT 0001
        OFFSET 0002
      `;
      
      // Get latest 100 datasets, starting from record 500
      const limitParams = [{ name: '1', value: 100 }];
      const offsetParams = [{ name: '2', value: 500 }];
      
      const result = parser.applyLimitOffsetParameters(queryString, limitParams, offsetParams);
      
      expect(result).toContain('LIMIT 100');
      expect(result).toContain('OFFSET 500');
      expect(result).toContain('VALUES ?creator { UNDEF }'); // Preserve for later argument substitution
      expect(result).toContain('ORDER BY DESC(?modified)');
    });

    it('should preserve existing non-parameterized limits while replacing parameterized ones', () => {
      const queryString = `
        PREFIX ex: <http://example.org/>
        
        SELECT ?item ?details WHERE {
          {
            SELECT ?item WHERE { 
              ?item a ex:MainItem 
            } 
            LIMIT 1000
          }
          {
            SELECT ?detail WHERE { 
              ?item ex:hasDetail ?detail 
            } 
            LIMIT 0001
          }
        }
        LIMIT 0002
        OFFSET 0003
      `;
      
      const limitParams = [
        { name: '1', value: 50 },   // Details per item  
        { name: '2', value: 200 }   // Overall results
      ];
      const offsetParams = [{ name: '3', value: 100 }]; // Skip first 100
      
      const result = parser.applyLimitOffsetParameters(queryString, limitParams, offsetParams);
      
      expect(result).toContain('LIMIT 1000');  // Preserved fixed limit
      expect(result).toContain('LIMIT 50');    // Replaced parameterized limit 
      expect(result).toContain('LIMIT 200');   // Replaced parameterized limit
      expect(result).toContain('OFFSET 100');  // Replaced parameterized offset
      expect(result).not.toContain('0001');
      expect(result).not.toContain('0002'); 
      expect(result).not.toContain('0003');
    });
  });
});