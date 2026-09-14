import { describe, it, expect, beforeEach } from 'vitest';
import { SparqlQueryParser } from '../../src/lib/parser.js';

describe('Parser BIND Pattern Support', () => {
  let parser: SparqlQueryParser;

  beforeEach(() => {
    parser = new SparqlQueryParser();
  });

  describe('parser.detectInputs with BIND patterns', () => {
    it('detects inputs from CONSTRUCT query with BIND patterns', () => {
      const constructQueryWithBind = `
        PREFIX ex: <http://example.org/>

        CONSTRUCT {
            ?result ex:derivedFrom ?a ;
                    ex:processedValue ?b ;
                    ex:timestamp ?now .
        }
        WHERE {
            VALUES (?a ?b) { (UNDEF UNDEF) }

            BIND(IRI(CONCAT("http://example.org/result/", ENCODE_FOR_URI(STR(?a)))) AS ?result)
            BIND(NOW() AS ?now)
        }
      `;

      const result = parser.detectInputs(constructQueryWithBind);

      expect(result.valuesInputs).toHaveLength(1);
      expect(result.valuesInputs[0]).toEqual(['a', 'b']);
    });

    it('handles CONSTRUCT with multiple BIND patterns', () => {
      const complexQuery = `
        PREFIX ex: <http://example.org/>

        CONSTRUCT {
            ?result ex:value1 ?computed1 ;
                    ex:value2 ?computed2 ;
                    ex:input ?x .
        }
        WHERE {
            VALUES ?x { UNDEF }

            BIND(CONCAT(?x, "_suffix") AS ?computed1)
            BIND(UCASE(?x) AS ?computed2)
            BIND(IRI(CONCAT("http://example.org/result/", ?x)) AS ?result)
        }
      `;

      const result = parser.detectInputs(complexQuery);

      expect(result.valuesInputs).toHaveLength(1);
      expect(result.valuesInputs[0]).toEqual(['x']);
    });

    it('handles nested BIND patterns in subqueries', () => {
      const nestedQuery = `
        PREFIX ex: <http://example.org/>

        CONSTRUCT {
            ?result ex:nested ?computed .
        }
        WHERE {
            VALUES ?input { UNDEF }

            {
                SELECT ?computed WHERE {
                    BIND(CONCAT(?input, "_processed") AS ?computed)
                }
            }

            BIND(IRI(CONCAT("http://example.org/result/", ?input)) AS ?result)
        }
      `;

      const result = parser.detectInputs(nestedQuery);

      expect(result.valuesInputs).toHaveLength(1);
      expect(result.valuesInputs[0]).toEqual(['input']);
    });

    it('handles DESCRIBE query with BIND patterns', () => {
      const describeQuery = `
        PREFIX ex: <http://example.org/>

        DESCRIBE ?computed
        WHERE {
            VALUES ?resource { UNDEF }

            BIND(IRI(CONCAT("http://example.org/described/", STR(?resource))) AS ?computed)
        }
      `;

      const result = parser.detectInputs(describeQuery);

      expect(result.valuesInputs).toHaveLength(1);
      expect(result.valuesInputs[0]).toEqual(['resource']);
    });

    it('ignores BIND patterns without corresponding VALUES', () => {
      const queryWithoutValues = `
        PREFIX ex: <http://example.org/>

        CONSTRUCT {
            ?result ex:timestamp ?now .
        }
        WHERE {
            ?item ex:property ?value .

            BIND(NOW() AS ?now)
            BIND(IRI(CONCAT("http://example.org/result/", STR(?item))) AS ?result)
        }
      `;

      const result = parser.detectInputs(queryWithoutValues);

      expect(result.valuesInputs).toHaveLength(0);
    });

    it('handles BIND with complex expressions', () => {
      const complexBindQuery = `
        PREFIX ex: <http://example.org/>
        PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>

        CONSTRUCT {
            ?result ex:computed ?finalValue .
        }
        WHERE {
            VALUES (?input1 ?input2) { (UNDEF UNDEF) }

            BIND(IF(BOUND(?input1),
                    CONCAT(STR(?input1), "-", STR(?input2)),
                    "default") AS ?intermediate)
            BIND(STRDT(?intermediate, xsd:string) AS ?finalValue)
            BIND(IRI(CONCAT("http://example.org/result/",
                            ENCODE_FOR_URI(?intermediate))) AS ?result)
        }
      `;

      const result = parser.detectInputs(complexBindQuery);

      expect(result.valuesInputs).toHaveLength(1);
      expect(result.valuesInputs[0]).toEqual(['input1', 'input2']);
    });

    it('handles empty VALUES with BIND patterns', () => {
      const emptyValuesQuery = `
        PREFIX ex: <http://example.org/>

        CONSTRUCT {
            ?result ex:timestamp ?now .
        }
        WHERE {
            VALUES () { () }

            BIND(NOW() AS ?now)
            BIND(IRI("http://example.org/result/empty") AS ?result)
        }
      `;

      const result = parser.detectInputs(emptyValuesQuery);

      expect(result.valuesInputs).toHaveLength(0);
    });
  });

  describe('parser robustness with BIND patterns', () => {
    it('throws error for BIND patterns with unknown functions', () => {
      const malformedQuery = `
        PREFIX ex: <http://example.org/>

        CONSTRUCT {
            ?result ex:value ?computed .
        }
        WHERE {
            VALUES ?input { UNDEF }

            BIND(INVALID_FUNCTION(?input) AS ?computed)
            BIND(?input AS ?result)
        }
      `;

      // Should throw an error because INVALID_FUNCTION is not a recognized SPARQL function
      expect(() => parser.detectInputs(malformedQuery)).toThrow(/Failed to parse SPARQL query/);
    });

    it('throws error for BIND patterns with syntax errors', () => {
      const syntaxErrorQuery = `
        PREFIX ex: <http://example.org/>

        CONSTRUCT {
            ?result ex:value ?computed .
        }
        WHERE {
            VALUES ?input { UNDEF }

            BIND(CONCAT(?input, ) AS ?computed)  # Missing second argument
            BIND(?input AS ?result)
        }
      `;

      // Should throw an error because of invalid syntax
      expect(() => parser.detectInputs(syntaxErrorQuery)).toThrow(/Failed to parse SPARQL query/);
    });
  });
});