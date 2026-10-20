import { applyTemplateArguments } from '@sparql-query-lib/runtime';
import {
  SparqlQueryParser,
  TemplateCompileError,
  compileQueryTemplate,
  detectSparqlOperation,
  type ParserDiagnostic,
} from '../src/index.js';

describe('diagnostics', () => {
  it('reports detection to the callback the host supplies', () => {
    const seen: ParserDiagnostic[] = [];
    const parser = new SparqlQueryParser({ diagnostics: d => seen.push(d) });

    parser.detectInputs('SELECT * WHERE { VALUES ?city { UNDEF } ?s ?p ?city } LIMIT 0001');

    expect(seen.map(d => d.message)).toEqual([
      'Starting detectInputs for query:',
      'Detected parameterized LIMIT:',
      'Found VALUES inputs:',
    ]);
    expect(seen.every(d => d.level === 'debug')).toBe(true);
  });

  it('reports a correlated EXISTS parameter as a warning', () => {
    const seen: ParserDiagnostic[] = [];
    const parser = new SparqlQueryParser({ diagnostics: d => seen.push(d) });

    parser.detectInputs('SELECT * WHERE { ?s ?p ?o FILTER EXISTS { VALUES ?s { UNDEF } ?s ?q ?r } }');

    const warnings = seen.filter(d => d.level === 'warn');
    expect(warnings).toHaveLength(1);
    expect(warnings[0].attributes).toEqual({ parameters: 's', correlatedVariables: 's' });
  });

  it('discards diagnostics when no callback is given', () => {
    expect(() => new SparqlQueryParser().detectInputs('SELECT * WHERE { ?s ?p ?o }')).not.toThrow();
  });
});

describe('detectSparqlOperation', () => {
  it.each([
    ['SELECT * WHERE { ?s ?p ?o }', 'SELECT'],
    ['ASK { ?s ?p ?o }', 'ASK'],
    ['CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }', 'CONSTRUCT'],
    ['DESCRIBE <http://example.org/a>', 'DESCRIBE'],
    ['INSERT DATA { <http://example.org/a> <http://example.org/b> "c" }', 'UPDATE'],
  ])('names the form of %s', (text, form) => {
    expect(detectSparqlOperation(text)).toBe(form);
  });

  it('refuses empty text', () => {
    expect(() => detectSparqlOperation('  ')).toThrow('SPARQL query is empty');
  });
});

describe('compileQueryTemplate', () => {
  const query = `PREFIX ex: <http://example.org/>
SELECT ?person WHERE { VALUES ?city { UNDEF } ?person ex:livesIn ?city } LIMIT 0001`;

  it('compiles a template the runtime splices without a parser', () => {
    const compiled = compileQueryTemplate(query, { name: 'people-by-city' });

    expect(compiled.queryType).toBe('SELECT');
    expect(compiled.inferredInputs).toEqual([['city']]);
    expect(compiled.limitParameters).toEqual(['1']);
    expect(compiled.pageParameters.map(p => [p.kind, p.name])).toEqual([['limit', '1']]);

    const spliced = applyTemplateArguments(compiled.template, [
      { head: { vars: ['city'] }, results: { bindings: [{ city: { type: 'uri', value: 'http://example.org/Perth' } }] } },
    ]);
    expect(spliced).toContain('VALUES ?city { ex:Perth }');
    expect(spliced).not.toContain('UNDEF');
  });

  it('splices exactly what the AST path produces', () => {
    const parser = new SparqlQueryParser();
    const text = 'SELECT * WHERE { VALUES ?city { UNDEF } ?s ?p ?city }';
    const compiled = compileQueryTemplate(text, { name: 'q', parser });
    const row = { city: { type: 'uri', value: 'http://example.org/Perth' } };

    const argumentSet = { head: { vars: ['city'] }, results: { bindings: [row] } };
    const fromTemplate = applyTemplateArguments(compiled.template, [argumentSet]);
    const fromParser = parser.applyArguments(text, [argumentSet]);

    expect(fromTemplate).toBe(fromParser);
  });

  it('refuses an update and names the query', () => {
    expect(() => compileQueryTemplate('CLEAR ALL', { name: 'wipe' }))
      .toThrow(new TemplateCompileError(
        "Query 'wipe' is an update operation, which the static export path does not carry. Export read queries only.",
      ));
  });

  it('refuses text that does not parse and names the query', () => {
    expect(() => compileQueryTemplate('SELECT WHERE {', { name: 'broken' }))
      .toThrow(/^Query 'broken' could not be parsed/);
  });
});
