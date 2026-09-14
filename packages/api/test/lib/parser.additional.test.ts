
import { describe, it, expect, beforeEach } from 'vitest';
import { SparqlQueryParser } from '../../src/lib/parser.js';

describe('SparqlQueryParser - Additional Tests', () => {
  let parser: SparqlQueryParser;

  beforeEach(() => {
    parser = new SparqlQueryParser();
  });

  describe('parseQuery - Additional', () => {
    it('should parse a valid CONSTRUCT query', () => {
      const queryString = 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }';
      const result = parser.parseQuery(queryString);
      expect(result.type).toBe('query');
      if (result.type === 'query') {
        expect(result.subType).toBe('construct');
      }
    });

    it('should parse a valid ASK query', () => {
      const queryString = 'ASK WHERE { ?s ?p ?o }';
      const result = parser.parseQuery(queryString);
      expect(result.type).toBe('query');
      if (result.type === 'query') {
        expect(result.subType).toBe('ask');
      }
    });

    it('should parse a valid DESCRIBE query', () => {
      const queryString = 'DESCRIBE ?s WHERE { ?s ?p ?o }';
      const result = parser.parseQuery(queryString);
      expect(result.type).toBe('query');
      if (result.type === 'query') {
        expect(result.subType).toBe('describe');
      }
    });

    it('should parse a valid INSERT DATA query', () => {
        const queryString = 'INSERT DATA { <http://example.com/s> <http://example.com/p> <http://example.com/o> }';
        const result = parser.parseQuery(queryString);
        expect(result.type).toBe('update');
        if (result.type === 'update') {
            expect((result.updates[0] as any).operation.subType).toBe('insertdata');
        }
    });

    it('should parse a valid DELETE DATA query', () => {
        const queryString = 'DELETE DATA { <http://example.com/s> <http://example.com/p> <http://example.com/o> }';
        const result = parser.parseQuery(queryString);
        expect(result.type).toBe('update');
        if (result.type === 'update') {
            expect((result.updates[0] as any).operation.subType).toBe('deletedata');
        }
    });

    it('should parse a valid DELETE/INSERT query', () => {
        const queryString = 'DELETE { ?s ?p ?o } INSERT { ?s ?p "new" } WHERE { ?s ?p ?o }';
        const result = parser.parseQuery(queryString);
        expect(result.type).toBe('update');
        if (result.type === 'update') {
            const update = (result.updates[0] as any).operation;
            expect(update.delete).toBeDefined();
            expect(update.insert).toBeDefined();
            expect(update.where).toBeDefined();
        }
    });
  });

  describe('detectInputs - Additional', () => {
    it('should detect inputs in a SERVICE clause', () => {
        const queryString = 'SELECT * WHERE { SERVICE <http://example.com/sparql> { VALUES ?s { UNDEF } ?s ?p ?o } }';
        const result = parser.detectInputs(queryString);
        expect(result.valuesInputs).toEqual([['s']]);
    });

    it('should detect inputs in a MINUS clause', () => {
        const queryString = 'SELECT * WHERE { ?s ?p ?o . MINUS { VALUES ?o { UNDEF } ?s ?p ?o } }';
        const result = parser.detectInputs(queryString);
        expect(result.valuesInputs).toEqual([['o']]);
    });

    it('should detect inputs in a GRAPH clause', () => {
        const queryString = 'SELECT * WHERE { GRAPH ?g { VALUES ?s { UNDEF } ?s ?p ?o } }';
        const result = parser.detectInputs(queryString);
        expect(result.valuesInputs).toEqual([['s']]);
    });
  });

  describe('detectQueryOutputs - Additional', () => {
    it('should detect variables for SELECT * in a query with UNION', () => {
        const queryString = 'SELECT * WHERE { { ?s a <http://example.com/C1> } UNION { ?s a <http://example.com/C2> . ?s <http://example.com/p> ?v } }';
        const result = parser.detectQueryOutputs(queryString);
        expect(result).toEqual(['s', 'v']);
    });

    it('should detect variables for SELECT * in a query with OPTIONAL', () => {
        const queryString = 'SELECT * WHERE { ?s ?p ?o . OPTIONAL { ?o <http://example.com/label> ?l } }';
        const result = parser.detectQueryOutputs(queryString);
        expect(result).toEqual(['l', 'o', 'p', 's']);
    });

    it('should detect variables for SELECT * in a query with a subquery', () => {
        const queryString = 'SELECT * WHERE { ?s ?p ?o . { SELECT ?o WHERE { ?o a <http://example.com/C> } } }';
        const result = parser.detectQueryOutputs(queryString);
        expect(result).toEqual(['o', 'p', 's']);
    });

    it('should correctly identify variables from BIND', () => {
        const queryString = 'SELECT * WHERE { ?s ?p ?o . BIND(1 as ?one) }';
        const result = parser.detectQueryOutputs(queryString);
        expect(result).toEqual(['o', 'one', 'p', 's']);
    });

    it('should correctly identify variables from VALUES', () => {
        const queryString = 'SELECT * WHERE { VALUES ?s { <http://example.com/s1> } ?s ?p ?o }';
        const result = parser.detectQueryOutputs(queryString);
        expect(result).toEqual(['o', 'p', 's']);
    });
  });

  describe('applyArguments - Additional', () => {
    it('should apply arguments to an INSERT query with a VALUES clause', () => {
        const queryString = 'INSERT { ?s ?p ?o } WHERE { VALUES (?s ?p ?o) { (UNDEF UNDEF UNDEF) } }';
        const argumentSets = [{
            head: { vars: ['s', 'p', 'o'] },
            arguments: { bindings: [{
                s: { type: 'uri', value: 'http://example.com/s' },
                p: { type: 'uri', value: 'http://example.com/p' },
                o: { type: 'literal', value: 'o' }
            }]}
        }];
        const result = parser.applyArguments(queryString, argumentSets);
        expect(result).not.toContain('UNDEF');
        expect(result).toContain('( <http://example.com/s> <http://example.com/p> "o" )');
    });

    it('should apply arguments to a DELETE/INSERT query', () => {
        const queryString = 'DELETE { ?s ?p ?o } INSERT { ?s ?p "new" } WHERE { VALUES ?s { UNDEF } ?s ?p ?o }';
        const argumentSets = [{
            head: { vars: ['s'] },
            arguments: { bindings: [{
                s: { type: 'uri', value: 'http://example.com/s' }
            }]}
        }];
        const result = parser.applyArguments(queryString, argumentSets);
        expect(result).not.toContain('UNDEF');
        expect(result).toContain('<http://example.com/s>');
    });

    it('should throw an error if argumentSets is not an array', () => {
        const queryString = 'SELECT * WHERE { VALUES ?s { UNDEF } }';
        expect(() => parser.applyArguments(queryString, {} as any)).toThrow("Invalid arguments format: Expected an array of argument sets.");
    });

    it('should throw an error for invalid argument set structure', () => {
        const queryString = 'SELECT * WHERE { VALUES ?s { UNDEF } }';
        const argumentSets = [{ head: { vars: ['s'] } }]; // Missing 'arguments'
        expect(() => parser.applyArguments(queryString, argumentSets as any)).toThrow("Invalid structure for argument set at index 0.");
    });
  });

  describe('applyLimitOffsetParameters - Additional', () => {
    it('should throw error for invalid limit parameter content', () => {
        const queryString = 'SELECT * WHERE { ?s ?p ?o } LIMIT 0001';
        const limitParams = [{ name: 1, value: '10' }];
        expect(() => parser.applyLimitOffsetParameters(queryString, limitParams as any, [])).toThrow("Invalid limit parameter: name must be string, value must be number.");
    });

    it('should throw error for invalid offset parameter content', () => {
        const queryString = 'SELECT * WHERE { ?s ?p ?o } OFFSET 0001';
        const offsetParams = [{ name: 1, value: '10' }];
        expect(() => parser.applyLimitOffsetParameters(queryString, [], offsetParams as any)).toThrow("Invalid offset parameter: name must be string, value must be number.");
    });

    it('should throw error if substitution results in invalid SPARQL', () => {
        // This is tricky to test as sparqljs might not throw for all invalid syntax
        // but we can try to create a case that is likely to fail
        const queryString = 'SELECT * WHERE { ?s ?p ?o } LIMIT 0001';
        const limitParams = [{ name: '1', value: "invalid" }];
        // The library currently stringifies the value, so this will become "LIMIT invalid"
        // which is a parse error.
        expect(() => parser.applyLimitOffsetParameters(queryString, limitParams as any, [])).toThrow("Invalid limit parameter: name must be string, value must be number.");
    });
  });

  describe('private methods through public interfaces', () => {
    it('isParameterSlot is false for non-values patterns', () => {
        const parserInstance = new (SparqlQueryParser as any)();
        const pattern = { type: 'bgp', triples: [] };
        expect(parserInstance.isParameterSlot(pattern)).toBe(false);
    });

    it('isParameterSlot is false for a block mixing an UNDEF row with author rows', () => {
        const parserInstance = new (SparqlQueryParser as any)();
        const pattern = { subType: 'values', values: [{ s: { value: 'x' } }, { s: undefined }] };
        expect(parserInstance.isParameterSlot(pattern)).toBe(false);
    });

    it('findVariablesInExpression handles unknown expression types', () => {
        const parserInstance = new (SparqlQueryParser as any)();
        const expression = { type: 'unknown' };
        const result = parserInstance.findVariablesInExpression(expression);
        expect(result.size).toBe(0);
    });
  });
});
