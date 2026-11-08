import { describe, expect, it } from 'vitest';
import { SparqlQueryParser } from '../src/parser.js';
import { compileQueryTemplate } from '../src/compileTemplate.js';
import { detectSparqlOperation } from '../src/operation.js';
import { Generator, Parser, isPatternLateral } from '../src/sparql12.js';

/**
 * `A LATERAL { B }` (SEP-0006): B runs once per solution of A, with A's
 * bindings substituted in. Jena runs it; Traqula 1.4.0 has no rule for it, so
 * sqlib adds one (`src/sparql12.ts`).
 *
 * The query below is the shape that needs it: a VALUES parameter, defaulted
 * through BIND(COALESCE(…)), feeds a property function's argument list.
 */
const TEXT_QUERY = `PREFIX text: <http://jena.apache.org/text#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT ?s ?label WHERE {
  VALUES ?q { UNDEF }
  BIND(COALESCE(?q, "granite") AS ?q1)
  LATERAL {
    VALUES ?field { UNDEF }
    BIND(COALESCE(?field, rdfs:label) AS ?f)
    ?s text:query (?f ?q1) .
  }
  ?s rdfs:label ?label .
}`;

describe('LATERAL', () => {
  describe('parse and generate', () => {
    const parser = new Parser();
    const generator = new Generator();

    it('parses a LATERAL group into a lateral pattern', () => {
      const ast = parser.parse(TEXT_QUERY) as { where: { patterns: unknown[] } };
      const lateral = ast.where.patterns.filter(isPatternLateral);
      expect(lateral).toHaveLength(1);
      expect(lateral[0].patterns.map((p) => (p as { subType: string }).subType)).toEqual(['values', 'bind', 'bgp']);
    });

    it('generates LATERAL back, and the output is a fixed point', () => {
      const text = generator.generate(parser.parse(TEXT_QUERY));
      expect(text).toMatch(/\bLATERAL \{/);
      expect(generator.generate(parser.parse(text))).toBe(text);
    });

    it('reads the keyword in any case', () => {
      const text = generator.generate(parser.parse('SELECT * WHERE { ?s ?p ?o lateral { ?o ?q ?r } }'));
      expect(text).toContain('LATERAL {');
    });

    it('keeps a sub-SELECT inside LATERAL', () => {
      const query = 'SELECT * WHERE { ?s a ?t LATERAL { SELECT ?x WHERE { ?s ?p ?x } ORDER BY ?x LIMIT 1 } }';
      const text = generator.generate(parser.parse(query));
      expect(text).toMatch(/LATERAL \{\s*SELECT \?x WHERE/);
      expect(text).toContain('LIMIT 1');
    });

    it('keeps LATERAL nested in other groups and in an update', () => {
      const query = 'DELETE { ?s ?p ?o } WHERE { ?s ?p ?o OPTIONAL { ?s ?q ?r LATERAL { ?r ?x ?y } } }';
      const text = generator.generate(parser.parse(query));
      expect(text).toMatch(/OPTIONAL \{[\s\S]*LATERAL \{/);
    });

    it('still reads `lateral:` as a prefix and `?lateral` as a variable', () => {
      const query = 'PREFIX lateral: <urn:l#> SELECT ?lateral WHERE { ?lateral lateral:p ?o }';
      const text = generator.generate(parser.parse(query));
      expect(text).toContain('?lateral lateral:p ?o');
      expect(text).not.toContain('LATERAL');
    });

    it('rejects LATERAL with no group after it', () => {
      expect(() => parser.parse('SELECT * WHERE { ?s ?p ?o LATERAL ?x }')).toThrow();
    });
  });

  describe('SparqlQueryParser', () => {
    it('formats a query without losing LATERAL', () => {
      const parser = new SparqlQueryParser();
      expect(parser.formatQueryString(TEXT_QUERY)).toMatch(/\bLATERAL \{/);
    });

    it('finds a VALUES parameter outside LATERAL and one inside it', () => {
      const parser = new SparqlQueryParser();
      expect(parser.detectInputs(TEXT_QUERY).valuesInputs).toEqual([['q'], ['field']]);
    });

    it('substitutes arguments on both sides of LATERAL and keeps the keyword', () => {
      const parser = new SparqlQueryParser();
      const text = parser.applyArguments(TEXT_QUERY, [
        { head: { vars: ['q'] }, results: { bindings: [{ q: { type: 'literal', value: 'basalt' } }] } },
        {
          head: { vars: ['field'] },
          results: { bindings: [{ field: { type: 'uri', value: 'http://example.org/name' } }] },
        },
      ]);
      expect(text).toMatch(/\bLATERAL \{/);
      expect(text).toContain('"basalt"');
      expect(text).toContain('<http://example.org/name>');
      expect(text).not.toContain('UNDEF');
    });

    it('runs unconstrained when the caller sends no arguments', () => {
      const parser = new SparqlQueryParser();
      const text = parser.applyArguments(TEXT_QUERY, [
        { head: { vars: ['q'] }, results: { bindings: [] }, whenEmpty: 'unconstrained' },
        { head: { vars: ['field'] }, results: { bindings: [] }, whenEmpty: 'unconstrained' },
      ] as never);
      expect(text).toMatch(/\bLATERAL \{/);
      expect(text).toContain('COALESCE');
      expect(text).not.toMatch(/VALUES/);
    });

    it('detects outputs from inside LATERAL for SELECT *', () => {
      const parser = new SparqlQueryParser();
      const outputs = parser.detectQueryOutputs('SELECT * WHERE { ?s ?p ?o LATERAL { ?o ?q ?r } }');
      expect(outputs).toEqual(expect.arrayContaining(['s', 'p', 'o', 'q', 'r']));
    });
  });

  it('detects the operation of a LATERAL query', () => {
    expect(detectSparqlOperation(TEXT_QUERY)).toBe('SELECT');
  });

  it('compiles to a template whose stored text keeps LATERAL', () => {
    const compiled = compileQueryTemplate(TEXT_QUERY, { name: 'text search' });
    expect(compiled.inferredInputs).toEqual([['q'], ['field']]);
    expect(compiled.template.text).toMatch(/\bLATERAL \{/);
  });
});
