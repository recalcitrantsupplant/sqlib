import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SparqlQueryParser } from '../../src/lib/parser.js';

// Define a type for the argument set structure for clarity in tests
type ArgumentSet = {
  head: { vars: string[] };
  arguments: {
    bindings: Array<Record<string, { type: 'uri' | 'literal'; value: string; datatype?: string; 'xml:lang'?: string }>>;
  }
};

describe('SparqlQueryParser - applyArguments', () => {
  let parser: SparqlQueryParser;

  beforeEach(() => {
    parser = new SparqlQueryParser();
  });

  it('rewrites an explicit empty set to a zero-row VALUES clause', () => {
    const result = parser.applyArguments(
      'SELECT ?s WHERE { ?s ?p ?o . VALUES (?s) { (UNDEF) } }',
      [{ head: { vars: ['s'] }, arguments: { bindings: [] } }]
    );

    const parsed = parser.parseQuery(result) as any;
    const values = parsed.where.patterns.find((pattern: any) => pattern.subType === 'values');
    expect(values.values).toEqual([]);
    expect(result).not.toContain('UNDEF');
  });

  it('removes an unconstrained or explicit wildcard parameter slot', () => {
    const query = 'SELECT ?s WHERE { ?s ?p ?o . VALUES (?s) { (UNDEF) } }';
    const absent = parser.applyArguments(query, [{
      head: { vars: ['s'] }, arguments: { bindings: [] }, whenEmpty: 'unconstrained'
    }]);
    const wildcard = parser.applyArguments(query, [{
      head: { vars: ['s'] }, arguments: { bindings: [{}] }
    }]);

    for (const result of [absent, wildcard]) {
      expect(result).not.toContain('VALUES');
      expect(result).not.toContain('UNDEF');
    }
  });

  it('rejects an all-UNDEF row mixed with bound rows', () => {
    expect(() => parser.applyArguments(
      'SELECT ?s WHERE { VALUES (?s) { (UNDEF) } ?s ?p ?o }',
      [{
        head: { vars: ['s'] },
        arguments: { bindings: [
          {},
          { s: { type: 'uri', value: 'urn:example:bound' } },
        ] },
      }],
    )).toThrow('an all-UNDEF row cannot be mixed with bound rows');
  });

  it('fails a required input with a named error', () => {
    expect(() => parser.applyArguments(
      'SELECT ?s WHERE { VALUES (?s) { (UNDEF) } ?s ?p ?o }',
      [{ head: { vars: ['s'] }, arguments: { bindings: [] }, whenEmpty: 'require' }],
    )).toThrow('Required input for VALUES clause 1 received no bindings');

    // A required input that *was* satisfied is not an error.
    expect(parser.applyArguments(
      'SELECT ?s WHERE { VALUES (?s) { (UNDEF) } ?s ?p ?o }',
      [{
        head: { vars: ['s'] },
        arguments: { bindings: [{ s: { type: 'uri', value: 'urn:example:bound' } }] },
        whenEmpty: 'require',
      }],
    )).toContain('urn:example:bound');
  });

  it('never lets whenEmpty discard rows the caller actually supplied', () => {
    // whenEmpty governs an input with no bound rows. Honouring it unconditionally
    // would drop the filter and silently run the query unconstrained.
    for (const whenEmpty of ['unconstrained', 'propagateEmpty', 'require'] as const) {
      const result = parser.applyArguments(
        'SELECT ?s WHERE { ?s ?p ?o . VALUES (?s) { (UNDEF) } }',
        [{
          head: { vars: ['s'] },
          arguments: { bindings: [{ s: { type: 'uri', value: 'urn:example:kept' } }] },
          whenEmpty,
        }],
      );
      expect(result).toContain('VALUES');
      expect(result).toContain('urn:example:kept');
      expect(result).not.toContain('UNDEF');
    }
  });

  it('should apply arguments to a SPARQL query with UNDEF values', () => { // Renamed test description
    // Arrange
    const queryString = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      
      SELECT ?subject ?predicate ?object
      WHERE {
        ?subject ?predicate ?object .
        VALUES (?subject ?predicate) {
          (UNDEF UNDEF)
        }
      }
    `;

    // New argument structure: Array of argument sets
    const argumentSets: ArgumentSet[] = [
      {
        head: {
          vars: ['subject', 'predicate']
        },
        arguments: { // Note: 'arguments' key here matches the structure expected by the parser method
          bindings: [
          {
            subject: {
              type: 'uri',
              value: 'http://example.org/subject1'
            },
            predicate: {
              type: 'uri',
              value: 'http://example.org/predicate1'
            }
          },
          {
            subject: {
              type: 'uri',
              value: 'http://example.org/subject2'
            },
            predicate: {
              type: 'uri',
              value: 'http://example.org/predicate2'
            }
          }
        ]
        }
      }
    ];

    // Act
    const result = parser.applyArguments(queryString, argumentSets); // Use applyArguments

    // Assert
    expect(result).toContain('<http://example.org/subject1>'); // Check for URI format
    expect(result).toContain('<http://example.org/predicate1>');
    expect(result).toContain('<http://example.org/subject2>');
    expect(result).toContain('<http://example.org/predicate2>');
    expect(result).not.toContain('UNDEF');
  });

  it('leaves a VALUES block that mixes author rows with an UNDEF row alone', () => {
    // A parameter slot is exactly one all-UNDEF row. A block carrying author rows is
    // data, not a slot, so it is neither counted as an input nor rewritten - passing
    // arguments for it is a caller error rather than a silent overwrite of the rows.
    const queryString = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

      SELECT ?subject ?predicate ?object
      WHERE {
        ?subject ?predicate ?object .
        VALUES (?subject ?predicate) {
          (<http://example.org/existing1> <http://example.org/existing-pred1>)
          (<http://example.org/existing2> <http://example.org/existing-pred2>)
          (UNDEF UNDEF)
        }
      }
    `;

    const argumentSets: ArgumentSet[] = [
      {
        head: { vars: ['subject', 'predicate'] },
        arguments: {
          bindings: [
            {
              subject: { type: 'uri', value: 'http://example.org/subject1' },
              predicate: { type: 'uri', value: 'http://example.org/predicate1' },
            },
          ],
        },
      },
    ];

    expect(() => parser.applyArguments(queryString, argumentSets))
      .toThrow('Mismatch: Found 0 UNDEF VALUES clauses, but received 1 argument sets.');

    // With no argument sets the author's block survives untouched.
    const untouched = parser.applyArguments(queryString, []);
    const parsedResult = parser.parseQuery(untouched) as any;
    const valuesPattern = parsedResult.where.patterns.find((pattern: any) => pattern.subType === 'values');
    expect(valuesPattern.values).toHaveLength(3);
    expect(untouched).toContain('<http://example.org/existing1>');
    expect(untouched).toContain('UNDEF');
  });

  it('should handle different types of argument values (uri, literal with datatype, literal with lang)', () => { // Adjusted description
    // Arrange
    const queryString = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      
      SELECT ?subject ?predicate ?object ?value ?flag
      WHERE {
        ?subject ?predicate ?object .
        VALUES (?subject ?predicate ?object ?value ?flag) {
          (UNDEF UNDEF UNDEF UNDEF UNDEF)
        }
      }
    `;

    // New argument structure
    const argumentSets: ArgumentSet[] = [
      {
        head: { // Updated vars to match test data
          vars: ['subject', 'predicate', 'object', 'value', 'flag']
        },
        arguments: { // Note: 'arguments' key here
          bindings: [
          {
            // URI
            subject: {
              type: 'uri',
              value: 'http://example.org/subject1'
            },
            predicate: {
              type: 'uri',
              value: 'http://example.org/predicate1'
            },
            // Literal with datatype (string)
            object: {
              type: 'literal',
              value: 'Test literal',
              datatype: 'http://www.w3.org/2001/XMLSchema#string'
            },
            // Literal with datatype (integer)
            value: {
              type: 'literal',
              value: '42',
              datatype: 'http://www.w3.org/2001/XMLSchema#integer'
            },
            // Literal with datatype (boolean)
            flag: {
              type: 'literal',
              value: 'true',
              datatype: 'http://www.w3.org/2001/XMLSchema#boolean'
            }
          },
          {
            subject: {
              type: 'uri',
              value: 'http://example.org/subject2'
            },
            predicate: {
              type: 'uri',
              value: 'http://example.org/predicate2'
            },
            // Literal with language tag
            object: {
              type: 'literal',
              value: 'Test with language',
              'xml:lang': 'en'
            },
            // Literal with datatype (decimal)
            value: {
              type: 'literal',
              value: '3.14',
              datatype: 'http://www.w3.org/2001/XMLSchema#decimal'
            },
            // Literal with datatype (boolean)
            flag: {
              type: 'literal',
              value: 'false',
              datatype: 'http://www.w3.org/2001/XMLSchema#boolean'
            }
          }
        ]
        }
      }
    ];

    // Act
    const result = parser.applyArguments(queryString, argumentSets); // Use applyArguments

    // Assert
    // URI values
    expect(result).toContain('<http://example.org/subject1>');
    expect(result).toContain('<http://example.org/predicate1>');
    expect(result).toContain('<http://example.org/subject2>');
    expect(result).toContain('<http://example.org/predicate2>');
    
    // Literal values - Check exact generated syntax
    // Adjust assertion: sparqljs might omit the default string datatype
    expect(result).toContain('"Test literal"'); 
    expect(result).toContain('"Test with language"@en');
    
    // Numeric literals — Traqula preserves the explicit typed form (unlike sparqljs which shortened xsd:integer to a bare number).
    expect(result).toContain('"42"^^<http://www.w3.org/2001/XMLSchema#integer>');
    expect(result).toContain('"3.14"^^<http://www.w3.org/2001/XMLSchema#decimal>');

    // Boolean literals
    expect(result).toContain('"true"^^<http://www.w3.org/2001/XMLSchema#boolean>'); // sparqljs typically quotes booleans
    expect(result).toContain('"false"^^<http://www.w3.org/2001/XMLSchema#boolean>');
    
    // Should not contain UNDEF
    expect(result).not.toContain('UNDEF');
  });

  it('should handle complex queries with nested patterns and multiple argument sets', () => {
    // Arrange
    const queryString = `
      PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      
      SELECT ?subject ?predicate ?object
      WHERE {
        ?subject ?predicate ?object .
        {
          ?subject rdf:type ?type .
          OPTIONAL {
            ?object rdfs:label ?label .
            VALUES (?label) { # First UNDEF clause
              (UNDEF)
            }
          }
        }
        UNION
        {
          ?subject rdfs:label ?name .
          FILTER EXISTS {
            ?subject ?predicate ?value .
            VALUES (?value) { # Second UNDEF clause
              (UNDEF)
            }
          }
        }
      }
    `;

    // New argument structure - targeting both UNDEF clauses
    const argumentSets: ArgumentSet[] = [
      { // For VALUES (?label)
        head: {
          vars: ['label']
        },
        arguments: {
          bindings: [
          {
            label: {
              type: 'literal',
              value: 'Test Label 1'
            }
          },
          {
            label: {
              type: 'literal',
              value: 'Test Label 2',
              'xml:lang': 'fr'
            }
          }
        ]
        }
      },
      { // For VALUES (?value)
        head: {
          vars: ['value']
        },
        arguments: {
          bindings: [
          {
            value: {
              type: 'literal',
              value: '123',
              datatype: 'http://www.w3.org/2001/XMLSchema#integer'
            }
          }
        ]
        }
      }
    ];

    // Act - Apply arguments
    const result = parser.applyArguments(queryString, argumentSets); // Use applyArguments

    // Assert
    expect(result).toContain('"Test Label 1"');
    expect(result).toContain('"Test Label 2"@fr');
    // Traqula preserves the explicit typed form for xsd:integer.
    expect(result).toContain('"123"^^<http://www.w3.org/2001/XMLSchema#integer>');
    expect(result).not.toContain('UNDEF');
    
    // Parse the result to verify structure
    const parsedResult = parser.parseQuery(result) as any;
    
    // Find the VALUES patterns
    let foundLabelValues = false;
    let foundValueValues = false;
    const processPatterns = (patterns: any[]) => {
      if (!patterns) return;

      for (const pattern of patterns) {
        if (pattern.subType === 'values') {
           // Check based on variable name (Traqula rows are keyed by bare variable name)
           if (pattern.values[0] && pattern.values[0]['label']) {
               foundLabelValues = true;
               expect(pattern.values).toHaveLength(2); // Check rows applied
           } else if (pattern.values[0] && pattern.values[0]['value']) {
               foundValueValues = true;
               expect(pattern.values).toHaveLength(1); // Check rows applied
           }
        }

        // Recurse (Traqula groups/optionals/unions/minus/graph all expose `patterns`)
        if (Array.isArray(pattern.patterns)) processPatterns(pattern.patterns);
        // FILTER EXISTS / NOT EXISTS carries a pattern group in expression.args
        if (pattern.subType === 'filter' && pattern.expression && pattern.expression.args && Array.isArray(pattern.expression.args.patterns)) {
            processPatterns(pattern.expression.args.patterns);
        }
      }
    };

    if (parsedResult.where && Array.isArray(parsedResult.where.patterns)) {
      processPatterns(parsedResult.where.patterns);
    }
    
    expect(foundLabelValues).toBe(true);
    expect(foundValueValues).toBe(true);
  });

  it('should throw error if argument set count does not match UNDEF VALUES count', () => { // Test unchanged, but confirms error handling
     // Arrange
     const queryString = `
       SELECT * WHERE {
         VALUES ?a { UNDEF }
         VALUES ?b { UNDEF }
       }
     `; // Query has 2 UNDEF clauses
     const argumentSets: ArgumentSet[] = [ // Only one set provided
       { head: { vars: ['a'] }, arguments: { bindings: [{ a: { type: 'uri', value: 'http://example.org/a1' } }] } }
     ];

     // Act & Assert
     expect(() => parser.applyArguments(queryString, argumentSets)).toThrow(
       'Mismatch: Found 2 UNDEF VALUES clauses, but received 1 argument sets.'
     );
   });

  it('should throw error if argument header misses variables', () => { // Test unchanged, but confirms error handling
    const queryString = 'SELECT * WHERE { VALUES (?a ?b) { (UNDEF UNDEF) } }';
    const argumentSets: ArgumentSet[] = [
      {
        head: { vars: ['a'] }, // Missing 'b'
        arguments: { bindings: [ { a: { type: 'uri', value: 'http://example.org/a1' } } ] }
      } // Argument set header doesn't match VALUES clause variables
    ];
    expect(() => parser.applyArguments(queryString, argumentSets)).toThrow(
      'Variable mismatch for VALUES clause 1. Query expects [a, b], arguments provide [a].'
    );
  });

   it('should handle missing variable values in arguments as UNDEF', () => {
    const queryString = 'SELECT * WHERE { VALUES (?a ?b) { (UNDEF UNDEF) } }';
    const argumentSets: ArgumentSet[] = [
      {
        head: { vars: ['a', 'b'] },
        arguments: {
          bindings: [
          { a: { type: 'uri', value: 'http://example.org/a1' } }, // Missing 'b' here
          { a: { type: 'uri', value: 'http://example.org/a2' }, b: { type: 'uri', value: 'http://example.org/b2' } }
        ]
        }
      }
    ];
    const result = parser.applyArguments(queryString, argumentSets); // Use applyArguments
    const parsedResult = parser.parseQuery(result) as any;
    const valuesPattern = parsedResult.where.patterns.find((p: any) => p.subType === 'values');

    expect(valuesPattern.values).toHaveLength(2);
    // First row should have ?a bound, ?b UNDEF (Traqula rows keyed by bare name)
    expect(valuesPattern.values[0]['a'].value).toBe('http://example.org/a1');
    expect(valuesPattern.values[0]['b']).toBeUndefined();
    // Second row should have both bound
    expect(valuesPattern.values[1]['a'].value).toBe('http://example.org/a2');
    expect(valuesPattern.values[1]['b'].value).toBe('http://example.org/b2');
  });

  it('should handle literal arguments without datatype', () => {
    const queryString = 'SELECT * WHERE { VALUES (?lit) { (UNDEF) } }'; // Corrected syntax
    const argumentSets: ArgumentSet[] = [
      {
        head: { vars: ['lit'] },
        arguments: { bindings: [ { lit: { type: 'literal', value: 'Simple Literal' } } ] } // No datatype
      }
    ];
    const result = parser.applyArguments(queryString, argumentSets); // Use applyArguments
    expect(result).toContain('"Simple Literal"'); // Should be quoted, datatype might be omitted by generator
    expect(result).not.toContain('^^<http://www.w3.org/2001/XMLSchema#string>'); // Generator might omit default string datatype
    const parsedResult = parser.parseQuery(result) as any;
    const valuesPattern = parsedResult.where.patterns.find((p: any) => p.subType === 'values');
    // Check the parsed structure for the literal node (Traqula term shape)
    expect(valuesPattern.values[0]['lit'].subType).toBe('literal');
    expect(valuesPattern.values[0]['lit'].value).toBe('Simple Literal');
    // Traqula does not synthesise a default xsd:string datatype: a plain literal has no langOrIri.
    expect(valuesPattern.values[0]['lit'].langOrIri).toBeUndefined();
  });

  it('should throw error for unsupported argument types', () => { // Test unchanged, but confirms error handling
    const queryString = 'SELECT * WHERE { VALUES (?unknown) { (UNDEF) } }'; // Corrected syntax
    const argumentSets: ArgumentSet[] = [
      {
        head: { vars: ['unknown'] },
        arguments: { bindings: [ { unknown: { type: 'weird', value: 'data' } as any } ] } // Cast to any to bypass type check
      }
    ];
    expect(() => parser.applyArguments(queryString, argumentSets)).toThrow(
      "Invalid argument type 'weird' for variable 'unknown' in argument set 1. Only 'uri' and 'literal' are supported."
    );
  });

  it('should throw an error for illegal bnode arguments in VALUES', () => { // Test unchanged, but confirms error handling
    const queryString = 'SELECT * WHERE { VALUES (?bnode) { (UNDEF) } }';
    const argumentSets: ArgumentSet[] = [
      {
        head: { vars: ['bnode'] },
        arguments: { bindings: [ { bnode: { type: 'bnode', value: 'b1' } as any } ] } // Cast to allow bnode type for test
      }
    ];
    expect(() => parser.applyArguments(queryString, argumentSets)).toThrow(
      "Invalid argument type 'bnode' for variable 'bnode' in argument set 1. Only 'uri' and 'literal' are supported."
    );
  });

  it('should throw error for empty arguments array when UNDEF exists', () => { // Changed expectation
     const queryString = `
       SELECT * WHERE {
         VALUES (?a) { (UNDEF) }
       }
     `;
     const argumentSets: ArgumentSet[] = []; // Empty array
     // Expect applyArguments to throw an error because 1 UNDEF clause exists but 0 sets provided
     expect(() => parser.applyArguments(queryString, argumentSets)).toThrow(
       'Mismatch: Found 1 UNDEF VALUES clauses, but received 0 argument sets.'
     );
   });

   it('should rewrite an empty argument set to a zero-row VALUES clause', async () => {
     const queryString = `
       SELECT * WHERE {
         VALUES (?a) { (UNDEF) }
       }
     `;
     const argumentSets: ArgumentSet[] = [
       { head: { vars: ['a'] }, arguments: { bindings: [] } } // Empty arguments list
     ];
     
     const result = parser.applyArguments(queryString, argumentSets);
     
     expect(result).not.toContain('UNDEF');
     expect(result).toMatch(/VALUES\s+\?a\s*\{\s*\}/);
   });

  it('should apply arguments to a VALUES clause within a nested SELECT inside a DESCRIBE query', () => {
    // Arrange
    const describeQueryFull = `
      PREFIX sh: <http://www.w3.org/ns/shacl#>
      PREFIX asmt: <https://koenigsnet/assessment-ontology/>
      DESCRIBE ?bn ?next_criteria ?opt {
        {
          SELECT ?bn ?next_criteria WHERE {
            VALUES ?assessment { UNDEF }
            ?assessment <https://koenigsnet/assessment-ontology/hasEvaluation> ?bn .
            ?bn <https://koenigsnet/assessment-ontology/evaluatesCriterion> ?next_criteria .
            {
              VALUES ?pref_1_status { <https://koenigsnet/workflow-status/InProgress> }
              ?bn <https://koenigsnet/assessment-ontology/evaluationStatus> ?pref_1_status .
            }
            UNION
            {
              VALUES ?pref_2_status { <https://koenigsnet/workflow-status/NotEvaluated> }
              ?bn <https://koenigsnet/assessment-ontology/evaluationStatus> ?pref_2_status .
            }
            ?next_criteria sh:order ?order .
            BIND(COALESCE(?pref_1_status, ?pref_2_status) AS ?status)
          } 
          ORDER BY DESC(?pref_1_status) ?order
          LIMIT 1
        }
        ?opt asmt:isOptionFor ?next_criteria .
      }
    `;

    const argumentSets: ArgumentSet[] = [
      {
        head: { vars: ['assessment'] },
        arguments: {
          bindings: [
          { assessment: { type: 'uri', value: 'http://example.org/assessment/123' } },
          { assessment: { type: 'uri', value: 'http://example.org/assessment/456' } }
        ]
        }
      }
    ];

    // Act
    const result = parser.applyArguments(describeQueryFull, argumentSets);

    // Assert
    expect(result).toContain('<http://example.org/assessment/123>');
    expect(result).toContain('<http://example.org/assessment/456>');
    expect(result).not.toContain('UNDEF');

    // Optional: Parse and check structure more deeply if needed
    const parsedResult = parser.parseQuery(result) as any;
    let foundValues = false;
    const checkPatterns = (patterns: any[]) => {
      if (!patterns) return;
      for (const pattern of patterns) {
        if (pattern.subType === 'values' && pattern.values[0] && pattern.values[0]['assessment']) {
          foundValues = true;
          expect(pattern.values).toHaveLength(2); // 2 arguments applied
          expect(pattern.values[0]['assessment'].value).toBe('http://example.org/assessment/123');
          expect(pattern.values[1]['assessment'].value).toBe('http://example.org/assessment/456');
        }
        // Recurse into nested structures (Traqula shapes)
        if (Array.isArray(pattern.patterns)) checkPatterns(pattern.patterns);
        if (pattern.type === 'query' && (pattern as any).where?.patterns) checkPatterns((pattern as any).where.patterns);
        if (pattern.subType === 'filter' && pattern.expression?.args?.patterns) checkPatterns(pattern.expression.args.patterns);
      }
    };
    if (parsedResult.where?.patterns) {
      checkPatterns(parsedResult.where.patterns);
    }
    expect(foundValues).toBe(true); // Ensure the specific VALUES clause was found and modified
  });


  /*
   * A stored argument set keeps the order its rows were written in, which need
   * not be the order the query declares its slots. Read positionally, a payload
   * that names the query's variables exactly was rejected as a variable
   * mismatch — and because the server and the exported runtime share this
   * alignment, a page that previews such a payload can now also run it.
   */
  describe('argument sets that arrive in another order', () => {
    const QUERY =
      'SELECT ?f WHERE { VALUES (?term) { (UNDEF) } VALUES (?facetField) { (UNDEF) } ?s ?p ?f }';

    const named = (name: string, value: string): ArgumentSet => ({
      head: { vars: [name] },
      arguments: { bindings: [{ [name]: { type: 'literal', value } }] },
    });

    it('fills each VALUES clause from the set that names it', () => {
      const result = parser.applyArguments(QUERY, [
        named('facetField', 'type'),
        named('term', 'wool'),
      ]);
      expect(result).toContain('"wool"');
      expect(result).toContain('"type"');
      // Each value lands in its own clause, not merely somewhere in the text.
      expect(result.indexOf('"wool"')).toBeLessThan(result.indexOf('"type"'));
    });

    it('is byte-identical to the same payload given in slot order', () => {
      expect(parser.applyArguments(QUERY, [named('facetField', 'type'), named('term', 'wool')]))
        .toBe(parser.applyArguments(QUERY, [named('term', 'wool'), named('facetField', 'type')]));
    });

    it('still rejects a set that names no clause at all', () => {
      expect(() =>
        parser.applyArguments(QUERY, [named('term', 'wool'), named('nope', 'x')]),
      ).toThrow(/Variable mismatch/);
    });
  });

});
