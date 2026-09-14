import { describe, it, expect, beforeEach } from 'vitest';
import { SparqlQueryParser } from '../../src/lib/parser.js';

// Define a type for the argument set structure for clarity in tests
type ArgumentSet = {
  head: { vars: string[] };
  arguments: {
    bindings: Array<Record<string, { type: 'uri' | 'literal'; value: string; datatype?: string; 'xml:lang'?: string }>>;
  }
};

describe('SparqlQueryParser - VALUES UNDEF Comprehensive Scenarios', () => {
  let parser: SparqlQueryParser;

  beforeEach(() => {
    parser = new SparqlQueryParser();
  });

  describe('Nesting scenarios', () => {
    it('should handle VALUES UNDEF in deeply nested OPTIONAL blocks', () => {
      const queryString = `
        PREFIX ex: <http://example.org/>
        SELECT * WHERE {
          ?s ex:hasProperty ?p .
          OPTIONAL {
            ?s ex:hasNested ?n .
            OPTIONAL {
              ?n ex:hasDeeper ?d .
              OPTIONAL {
                VALUES (?d ?type) { (UNDEF UNDEF) }
                ?d a ?type .
              }
            }
          }
        }
      `;

      const argumentSets: ArgumentSet[] = [
        {
          head: { vars: ['d', 'type'] },
          arguments: {
            bindings: [
              {
                d: { type: 'uri', value: 'http://example.org/deep1' },
                type: { type: 'uri', value: 'http://example.org/Type1' }
              }
            ]
          }
        }
      ];

      const result = parser.applyArguments(queryString, argumentSets);

      expect(result).toContain('ex:deep1');
      expect(result).toContain('ex:Type1');
      expect(result).not.toContain('UNDEF');
    });

    it('should handle VALUES UNDEF in nested UNION branches', () => {
      const queryString = `
        PREFIX ex: <http://example.org/>
        SELECT * WHERE {
          {
            ?s ex:type1 ?o .
            {
              VALUES (?s) { (UNDEF) }
              ?s ex:prop1 ?v1 .
            }
            UNION
            {
              VALUES (?o) { (UNDEF) }
              ?s ex:prop2 ?o .
            }
          }
          UNION
          {
            ?s ex:type2 ?o2 .
          }
        }
      `;

      const argumentSets: ArgumentSet[] = [
        {
          head: { vars: ['s'] },
          arguments: {
            bindings: [
              { s: { type: 'uri', value: 'http://example.org/subject1' } },
              { s: { type: 'uri', value: 'http://example.org/subject2' } }
            ]
          }
        },
        {
          head: { vars: ['o'] },
          arguments: {
            bindings: [
              { o: { type: 'literal', value: 'test value' } }
            ]
          }
        }
      ];

      const result = parser.applyArguments(queryString, argumentSets);

      expect(result).toContain('ex:subject1');
      expect(result).toContain('ex:subject2');
      expect(result).toContain('"test value"');
      expect(result).not.toContain('UNDEF');
    });

    it('should handle VALUES UNDEF in nested FILTER EXISTS blocks', () => {
      const queryString = `
        PREFIX ex: <http://example.org/>
        SELECT * WHERE {
          ?s ?p ?o .
          FILTER EXISTS {
            ?s ex:hasRelated ?r .
            FILTER EXISTS {
              VALUES (?r ?type) { (UNDEF UNDEF) }
              ?r a ?type .
            }
          }
        }
      `;

      const argumentSets: ArgumentSet[] = [
        {
          head: { vars: ['r', 'type'] },
          arguments: {
            bindings: [
              {
                r: { type: 'uri', value: 'http://example.org/related1' },
                type: { type: 'uri', value: 'http://example.org/RelatedType' }
              }
            ]
          }
        }
      ];

      const result = parser.applyArguments(queryString, argumentSets);

      expect(result).toContain('ex:related1');
      expect(result).toContain('ex:RelatedType');
      expect(result).not.toContain('UNDEF');
    });

    it('should handle VALUES UNDEF in GRAPH clauses', () => {
      const queryString = `
        PREFIX ex: <http://example.org/>
        SELECT * WHERE {
          GRAPH ?g {
            ?s ?p ?o .
            VALUES (?g ?s) { (UNDEF UNDEF) }
          }
        }
      `;

      const argumentSets: ArgumentSet[] = [
        {
          head: { vars: ['g', 's'] },
          arguments: {
            bindings: [
              {
                g: { type: 'uri', value: 'http://example.org/graph1' },
                s: { type: 'uri', value: 'http://example.org/subject1' }
              }
            ]
          }
        }
      ];

      const result = parser.applyArguments(queryString, argumentSets);

      expect(result).toContain('ex:graph1');
      expect(result).toContain('ex:subject1');
      expect(result).not.toContain('UNDEF');
    });

    it('should handle VALUES UNDEF in MINUS clauses', () => {
      const queryString = `
        PREFIX ex: <http://example.org/>
        SELECT * WHERE {
          ?s ex:hasProperty ?p .
          MINUS {
            ?s ex:excludeProperty ?exclude .
            VALUES (?exclude) { (UNDEF) }
          }
        }
      `;

      const argumentSets: ArgumentSet[] = [
        {
          head: { vars: ['exclude'] },
          arguments: {
            bindings: [
              { exclude: { type: 'uri', value: 'http://example.org/excluded' } }
            ]
          }
        }
      ];

      const result = parser.applyArguments(queryString, argumentSets);

      expect(result).toContain('ex:excluded');
      expect(result).not.toContain('UNDEF');
    });
  });

  describe('LIMIT and OFFSET with VALUES scenarios', () => {
    it('should handle VALUES UNDEF with standard LIMIT', () => {
      const queryString = `
        PREFIX ex: <http://example.org/>
        SELECT * WHERE {
          ?s ?p ?o .
          VALUES (?s ?p) { (UNDEF UNDEF) }
        }
        LIMIT 10
      `;

      const argumentSets: ArgumentSet[] = [
        {
          head: { vars: ['s', 'p'] },
          arguments: {
            bindings: [
              {
                s: { type: 'uri', value: 'http://example.org/subject1' },
                p: { type: 'uri', value: 'http://example.org/predicate1' }
              }
            ]
          }
        }
      ];

      const result = parser.applyArguments(queryString, argumentSets);

      expect(result).toContain('ex:subject1');
      expect(result).toContain('ex:predicate1');
      expect(result).toContain('LIMIT 10');
      expect(result).not.toContain('UNDEF');
    });

    it('should handle VALUES UNDEF with standard OFFSET', () => {
      const queryString = `
        PREFIX ex: <http://example.org/>
        SELECT * WHERE {
          ?s ?p ?o .
          VALUES (?s) { (UNDEF) }
        }
        OFFSET 5
      `;

      const argumentSets: ArgumentSet[] = [
        {
          head: { vars: ['s'] },
          arguments: {
            bindings: [
              { s: { type: 'uri', value: 'http://example.org/subject1' } },
              { s: { type: 'uri', value: 'http://example.org/subject2' } }
            ]
          }
        }
      ];

      const result = parser.applyArguments(queryString, argumentSets);

      expect(result).toContain('ex:subject1');
      expect(result).toContain('ex:subject2');
      expect(result).toContain('OFFSET 5');
      expect(result).not.toContain('UNDEF');
    });

    it('should handle VALUES UNDEF with both LIMIT and OFFSET', () => {
      const queryString = `
        PREFIX ex: <http://example.org/>
        SELECT * WHERE {
          VALUES (?type) { (UNDEF) }
          ?s a ?type .
          ?s ex:hasValue ?v .
        }
        LIMIT 20
        OFFSET 10
      `;

      const argumentSets: ArgumentSet[] = [
        {
          head: { vars: ['type'] },
          arguments: {
            bindings: [
              { type: { type: 'uri', value: 'http://example.org/Person' } },
              { type: { type: 'uri', value: 'http://example.org/Organization' } }
            ]
          }
        }
      ];

      const result = parser.applyArguments(queryString, argumentSets);

      expect(result).toContain('ex:Person');
      expect(result).toContain('ex:Organization');
      expect(result).toContain('LIMIT 20');
      expect(result).toContain('OFFSET 10');
      expect(result).not.toContain('UNDEF');
    });

    it('should handle VALUES UNDEF in subqueries with LIMIT/OFFSET', () => {
      const queryString = `
        PREFIX ex: <http://example.org/>
        SELECT * WHERE {
          {
            SELECT ?s WHERE {
              VALUES (?s) { (UNDEF) }
              ?s a ex:Person .
            }
            LIMIT 5
          }
          ?s ex:hasName ?name .
        }
        LIMIT 10
      `;

      const argumentSets: ArgumentSet[] = [
        {
          head: { vars: ['s'] },
          arguments: {
            bindings: [
              { s: { type: 'uri', value: 'http://example.org/person1' } },
              { s: { type: 'uri', value: 'http://example.org/person2' } }
            ]
          }
        }
      ];

      const result = parser.applyArguments(queryString, argumentSets);

      expect(result).toContain('ex:person1');
      expect(result).toContain('ex:person2');
      expect(result).toContain('LIMIT 5');
      expect(result).toContain('LIMIT 10');
      expect(result).not.toContain('UNDEF');
    });
  });

  describe('Non-parameterized VALUES scenarios', () => {
    it('should not affect any VALUES clause carrying author rows (mixed case)', () => {
      // Neither block is a parameter slot: one has no UNDEF row at all, the other
      // mixes an UNDEF row with author data. Both are left exactly as written.
      const queryString = `
        PREFIX ex: <http://example.org/>
        SELECT * WHERE {
          VALUES ?type {
            ex:Person
            ex:Organization
          }
          VALUES (?s ?role) {
            (ex:alice ex:employee)
            (UNDEF UNDEF)
          }
          ?s a ?type .
          ?s ex:hasRole ?role .
        }
      `;

      expect(parser.detectInputs(queryString).valuesInputs).toEqual([]);

      const result = parser.applyArguments(queryString, []);

      expect(result).toContain('ex:Person');
      expect(result).toContain('ex:Organization');
      expect(result).toContain('ex:alice');
      expect(result).toContain('ex:employee');
      expect(result).toContain('UNDEF');
    });

    it('should handle VALUES with partial UNDEF (mixed row)', () => {
      const queryString = `
        PREFIX ex: <http://example.org/>
        SELECT * WHERE {
          VALUES (?s ?p ?o) {
            (ex:alice ex:hasName "Alice")
            (UNDEF ex:hasAge UNDEF)
            (ex:bob ex:hasName "Bob")
          }
          ?s ?p ?o .
        }
      `;

      // This should NOT be treated as a parameterized VALUES clause
      // because not all values in the row are UNDEF
      const result = parser.detectInputs(queryString);
      expect(result.valuesInputs).toHaveLength(0);
      
      // Applying empty arguments should not modify anything
      const modifiedQuery = parser.applyArguments(queryString, []);
      expect(modifiedQuery).toContain('UNDEF');
      expect(modifiedQuery).toContain('ex:alice');
      expect(modifiedQuery).toContain('ex:bob');
    });

    it('should handle multiple non-parameterized VALUES clauses', () => {
      const queryString = `
        PREFIX ex: <http://example.org/>
        SELECT * WHERE {
          VALUES ?type1 { ex:Person ex:Organization }
          VALUES ?type2 { ex:Individual ex:Group }
          VALUES (?s ?p) { 
            (ex:subject1 ex:predicate1)
            (ex:subject2 ex:predicate2)
          }
          ?s a ?type1 .
          ?s ex:relatedTo ?type2 .
          ?s ?p ?o .
        }
      `;

      const result = parser.detectInputs(queryString);
      expect(result.valuesInputs).toHaveLength(0);

      const modifiedQuery = parser.applyArguments(queryString, []);
      // Should contain all the original VALUES clauses unchanged
      expect(modifiedQuery).toContain('VALUES ?type1');
      expect(modifiedQuery).toContain('ex:Person');
      expect(modifiedQuery).toContain('ex:Organization');
      expect(modifiedQuery).toContain('VALUES ?type2');
      expect(modifiedQuery).toContain('ex:Individual');
      expect(modifiedQuery).toContain('ex:Group');
      expect(modifiedQuery).toContain('ex:subject1 ex:predicate1');
      expect(modifiedQuery).toContain('ex:subject2 ex:predicate2');
    });

    it('should handle empty VALUES clause (edge case)', () => {
      const queryString = `
        PREFIX ex: <http://example.org/>
        SELECT * WHERE {
          VALUES ?s { }
          ?s ex:hasProperty ?p .
        }
      `;

      const result = parser.detectInputs(queryString);
      expect(result.valuesInputs).toHaveLength(0);

      const modifiedQuery = parser.applyArguments(queryString, []);
      expect(modifiedQuery).toContain('VALUES ?s {'); // Empty VALUES clause is preserved (no rows)
    });

    it('should handle VALUES with only concrete values (no variables)', () => {
      const queryString = `
        PREFIX ex: <http://example.org/>
        SELECT * WHERE {
          VALUES (?s ?p ?o) {
            (<http://example.org/s1> <http://example.org/p1> "value1")
            (<http://example.org/s2> <http://example.org/p2> "value2"@en)
            (<http://example.org/s3> <http://example.org/p3> 42)
          }
          ?s ?p ?o .
        }
      `;

      const result = parser.detectInputs(queryString);
      expect(result.valuesInputs).toHaveLength(0);

      const modifiedQuery = parser.applyArguments(queryString, []);
      // Traqula preserves the original IRI notation (existing full IRIs are not re-abbreviated).
      expect(modifiedQuery).toContain('<http://example.org/s1>');
      expect(modifiedQuery).toContain('"value1"');
      expect(modifiedQuery).toContain('"value2"@en');
      expect(modifiedQuery).toContain('42');
    });
  });

  describe('Complex mixed scenarios', () => {
    it('should handle query with both parameterized and non-parameterized VALUES', () => {
      const queryString = `
        PREFIX ex: <http://example.org/>
        SELECT * WHERE {
          # Non-parameterized VALUES
          VALUES ?allowedType { ex:Person ex:Organization }
          
          # Parameterized VALUES  
          VALUES (?s ?role) { (UNDEF UNDEF) }
          
          ?s a ?allowedType .
          ?s ex:hasRole ?role .
          
          OPTIONAL {
            # Another non-parameterized VALUES
            VALUES ?status { ex:Active ex:Inactive }
            ?s ex:hasStatus ?status .
          }
        }
      `;

      const argumentSets: ArgumentSet[] = [
        {
          head: { vars: ['s', 'role'] },
          arguments: {
            bindings: [
              {
                s: { type: 'uri', value: 'http://example.org/user1' },
                role: { type: 'uri', value: 'http://example.org/admin' }
              },
              {
                s: { type: 'uri', value: 'http://example.org/user2' },
                role: { type: 'uri', value: 'http://example.org/viewer' }
              }
            ]
          }
        }
      ];

      const result = parser.applyArguments(queryString, argumentSets);

      // Non-parameterized VALUES should remain
      expect(result).toContain('ex:Person');
      expect(result).toContain('ex:Organization');
      expect(result).toContain('ex:Active');
      expect(result).toContain('ex:Inactive');
      
      // Parameterized VALUES should be modified
      expect(result).toContain('ex:user1');
      expect(result).toContain('ex:admin');
      expect(result).toContain('ex:user2');
      expect(result).toContain('ex:viewer');
      expect(result).not.toContain('UNDEF');
    });

    it('should handle nested query with mixed VALUES scenarios', () => {
      const queryString = `
        PREFIX ex: <http://example.org/>
        SELECT * WHERE {
          {
            SELECT ?person WHERE {
              VALUES ?type { ex:Person }
              VALUES (?person) { (UNDEF) }
              ?person a ?type .
            }
            LIMIT 10
          }
          
          OPTIONAL {
            VALUES ?relationship { ex:knows ex:worksFor }
            ?person ?relationship ?other .
            
            {
              VALUES (?other ?otherType) { (UNDEF UNDEF) }
              ?other a ?otherType .
            }
          }
        }
      `;

      const argumentSets: ArgumentSet[] = [
        {
          head: { vars: ['person'] },
          arguments: {
            bindings: [
              { person: { type: 'uri', value: 'http://example.org/alice' } }
            ]
          }
        },
        {
          head: { vars: ['other', 'otherType'] },
          arguments: {
            bindings: [
              {
                other: { type: 'uri', value: 'http://example.org/bob' },
                otherType: { type: 'uri', value: 'http://example.org/Person' }
              }
            ]
          }
        }
      ];

      const result = parser.applyArguments(queryString, argumentSets);

      // Non-parameterized VALUES should remain
      expect(result).toContain('ex:Person');
      expect(result).toContain('ex:knows');
      expect(result).toContain('ex:worksFor');
      
      // Parameterized VALUES should be modified
      expect(result).toContain('ex:alice');
      expect(result).toContain('ex:bob');
      expect(result).not.toContain('UNDEF');
    });
  });

  // SPARQL 1.1 does not define how inline data inside EXISTS is evaluated, and SEP-0007
  // proposes forbidding VALUES in EXISTS from using current-row variables. Substitution
  // still works; detectInputs flags the query as engine-dependent.
  describe('Correlated VALUES inside EXISTS (SEP-0007 advisory)', () => {
    it('flags a parameter group in EXISTS that reuses an enclosing variable', () => {
      const queryString = `
        PREFIX ex: <http://example.org/>
        SELECT * WHERE {
          ?s ex:hasRelated ?r .
          FILTER EXISTS {
            VALUES (?r ?type) { (UNDEF UNDEF) }
            ?r a ?type .
          }
        }
      `;

      const detected = parser.detectInputs(queryString);

      expect(detected.valuesInputs).toEqual([['r', 'type']]);
      expect(detected.correlatedExistsInputs).toEqual([
        { parameters: ['r', 'type'], correlatedVariables: ['r'] },
      ]);
    });

    it('flags correlation with the body of an outer EXISTS, not just the top level', () => {
      const queryString = `
        PREFIX ex: <http://example.org/>
        SELECT * WHERE {
          ?s ?p ?o .
          FILTER EXISTS {
            ?s ex:hasRelated ?r .
            FILTER EXISTS {
              VALUES (?r ?type) { (UNDEF UNDEF) }
              ?r a ?type .
            }
          }
        }
      `;

      const detected = parser.detectInputs(queryString);

      expect(detected.correlatedExistsInputs).toEqual([
        { parameters: ['r', 'type'], correlatedVariables: ['r'] },
      ]);
    });

    it('does not flag a parameter group in EXISTS whose variables are all local to it', () => {
      const queryString = `
        PREFIX ex: <http://example.org/>
        SELECT * WHERE {
          ?s ex:hasRelated ?r .
          FILTER EXISTS {
            VALUES (?other ?type) { (UNDEF UNDEF) }
            ?other a ?type .
          }
        }
      `;

      const detected = parser.detectInputs(queryString);

      expect(detected.valuesInputs).toEqual([['other', 'type']]);
      expect(detected.correlatedExistsInputs).toEqual([]);
    });

    it('does not flag ordinary parameter groups outside EXISTS', () => {
      const queryString = `
        PREFIX ex: <http://example.org/>
        SELECT * WHERE {
          VALUES (?s) { (UNDEF) }
          ?s ex:hasRelated ?r .
          OPTIONAL { VALUES (?r) { (UNDEF) } }
        }
      `;

      const detected = parser.detectInputs(queryString);

      expect(detected.valuesInputs).toEqual([['s'], ['r']]);
      expect(detected.correlatedExistsInputs).toEqual([]);
    });

    it('still substitutes normally into a flagged group', () => {
      const queryString = `
        PREFIX ex: <http://example.org/>
        SELECT * WHERE {
          ?s ex:hasRelated ?r .
          FILTER EXISTS {
            VALUES (?r ?type) { (UNDEF UNDEF) }
            ?r a ?type .
          }
        }
      `;

      const argumentSets: ArgumentSet[] = [
        {
          head: { vars: ['r', 'type'] },
          arguments: {
            bindings: [
              {
                r: { type: 'uri', value: 'http://example.org/related1' },
                type: { type: 'uri', value: 'http://example.org/RelatedType' }
              }
            ]
          }
        }
      ];

      const result = parser.applyArguments(queryString, argumentSets);

      expect(result).toContain('ex:related1');
      expect(result).toContain('ex:RelatedType');
      expect(result).not.toContain('UNDEF');
    });
  });
});
