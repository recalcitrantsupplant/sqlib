/**
 * Constant parameters: `VALUES ?000word { UNDEF }` (docs/proposals/constant-substitution.md).
 *
 * The filled VALUES row stays, and the same term is written into the triple
 * patterns in the reach of the clause. These tests pin where the term goes,
 * where the variable stays, which occurrences warn, and which arguments are
 * refused. The equivalence with a plain VALUES run is checked on Oxigraph in
 * `packages/api/test/lib/constantSubstitution.oxigraph.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { SparqlQueryParser, type ApplyArgumentSet } from '../src/parser.js';

const parser = new SparqlQueryParser();

const word = (value: string, name = '000w'): ApplyArgumentSet => ({
  head: { vars: [name] },
  results: { bindings: [{ [name]: { type: 'literal', value } }] },
});

/** The query as the engine gets it, normalised, so tests compare structure and not layout. */
const normalise = (text: string) => parser.formatQuery(parser.parseQuery(text)).replace(/\s+/g, ' ').trim();
const run = (query: string, args: ApplyArgumentSet[] = [word('copper*')]) => normalise(parser.applyArguments(query, args));
const count = (text: string, needle: string) => text.split(needle).length - 1;

const TS = 'PREFIX ts: <https://qlever.cs.uni-freiburg.de/textSearch/>\n';

describe('constant parameters: where the term is written', () => {
  it('writes the term into a SERVICE body and keeps the filled VALUES row', () => {
    const out = run(`${TS}SELECT ?entity ?000w WHERE {
      VALUES ?000w { UNDEF }
      SERVICE ts: {
        ?t ts:contains [ ts:word ?000w ] .
        ?t ts:contains [ ts:entity ?entity ] .
      }
    }`);
    expect(out).toContain('VALUES ?000w { "copper*" }');
    expect(out).toContain('ts:word "copper*"');
    // Projection keeps the variable; the VALUES row binds it.
    expect(out).toMatch(/SELECT \?entity \?000w/);
    expect(count(out, '?000w')).toBe(2);
  });

  it('writes into a plain group, a GRAPH body, a UNION branch and a property-path triple', () => {
    const out = run(`SELECT * WHERE {
      VALUES ?000w { UNDEF }
      { ?a <http://e/p> ?000w }
      GRAPH <http://e/g> { ?b <http://e/p> ?000w }
      { ?c <http://e/p> ?000w } UNION { ?000w <http://e/q> ?d }
      ?e <http://e/p>/<http://e/q> ?000w .
    }`);
    expect(count(out, '"copper*"')).toBe(6);
    expect(count(out, '?000w')).toBe(1);
  });

  it('writes in subject, predicate and object positions', () => {
    const out = run('SELECT * WHERE { VALUES ?000w { UNDEF } ?000w ?000w ?000w }', [
      { head: { vars: ['000w'] }, results: { bindings: [{ '000w': { type: 'uri', value: 'http://e/x' } }] } },
    ]);
    expect(count(out, '<http://e/x>')).toBe(4);
  });

  it('writes inside the sub-SELECT that holds the VALUES clause, and not outside it', () => {
    const out = run(`${TS}CONSTRUCT { ?e <http://e/hit> ?000w } WHERE {
      { SELECT ?e ?000w WHERE {
          VALUES ?000w { UNDEF }
          SERVICE ts: { ?t ts:word ?000w . ?t ts:entity ?e }
      } }
    }`);
    expect(out).toContain('ts:word "copper*"');
    // The CONSTRUCT template reads the variable the sub-SELECT projects.
    expect(out).toContain('<http://e/hit> ?000w');
  });

  it('writes only into the WHERE clause of an UPDATE, and keeps the templates', () => {
    const out = run(`INSERT { ?s <http://e/tag> ?000w } WHERE {
      VALUES ?000w { UNDEF }
      ?s <http://e/label> ?000w .
    }`);
    expect(out).toContain('<http://e/label> "copper*"');
    expect(out).toContain('<http://e/tag> ?000w');
  });

  it('keeps the variable in a FILTER beside the VALUES clause, and in ORDER BY', () => {
    const out = run(`SELECT ?s WHERE {
      VALUES ?000w { UNDEF }
      ?s <http://e/p> ?000w .
      FILTER(STRLEN(?000w) > 2)
    } ORDER BY ?000w`);
    expect(out).toContain('STRLEN( ?000w )');
    expect(out).toContain('ORDER BY ASC ( ?000w )');
    expect(out).toContain('<http://e/p> "copper*"');
  });

  it('keeps the variable in every position outside the reach', () => {
    const out = run(`SELECT * WHERE {
      VALUES ?000w { UNDEF }
      OPTIONAL { ?a <http://e/p> ?000w }
      MINUS { ?b <http://e/p> ?000w }
      FILTER EXISTS { ?c <http://e/p> ?000w }
      { SELECT ?d WHERE { ?d <http://e/p> ?000w } }
      BIND(?000w AS ?copy)
      { ?f <http://e/p> ?g FILTER(?g = ?000w) }
      GRAPH ?000w { ?h <http://e/p> ?i }
    }`);
    expect(out).not.toContain('<http://e/p> "copper*"');
    expect(count(out, '"copper*"')).toBe(1); // the VALUES row only
  });

  it('serialises a hostile literal once, as one term, in every written position', () => {
    const hostile = 'relativ*" ] . } } SELECT * WHERE { ?s ?p ?o } #';
    const out = run(`${TS}SELECT ?t WHERE {
      VALUES ?000w { UNDEF }
      SERVICE ts: { ?t ts:contains [ ts:word ?000w ] }
    }`, [word(hostile)]);
    const parsed = parser.parseQuery(out) as { where: { patterns: unknown[] } };
    expect(parsed.where.patterns).toHaveLength(2); // VALUES and SERVICE, nothing smuggled in
    expect(count(out, 'relativ*\\" ] . } } SELECT')).toBe(2);
  });

  it('leaves a query without a 000 variable exactly as before', () => {
    const query = 'SELECT ?s WHERE { VALUES ?w { UNDEF } ?s <http://e/p> ?w }';
    expect(run(query, [word('x', 'w')])).toContain('<http://e/p> ?w');
  });
});

describe('constant parameters: arguments', () => {
  const QUERY = 'SELECT ?s WHERE { VALUES ?000w { UNDEF } ?s <http://e/p> ?000w }';

  it('refuses an omitted argument, naming the parameter', () => {
    expect(() => parser.applyArguments(QUERY, [])).toThrow(/\?000w needs exactly one value, and the arguments give none/);
  });

  it('refuses zero rows', () => {
    expect(() => parser.applyArguments(QUERY, [{ head: { vars: ['000w'] }, results: { bindings: [] } }]))
      .toThrow(/\?000w needs exactly one value/);
  });

  it('refuses two rows', () => {
    const two: ApplyArgumentSet = {
      head: { vars: ['000w'] },
      results: { bindings: [{ '000w': { type: 'literal', value: 'a' } }, { '000w': { type: 'literal', value: 'b' } }] },
    };
    expect(() => parser.applyArguments(QUERY, [two])).toThrow(/\?000w needs exactly one value, and the arguments give 2 rows/);
  });

  it('refuses an UNDEF cell', () => {
    expect(() => parser.applyArguments(QUERY, [{ head: { vars: ['000w'] }, results: { bindings: [{}] } }]))
      .toThrow(/\?000w needs exactly one value, and the argument leaves it UNDEF/);
  });

  it('refuses a blank node, as for every slot', () => {
    expect(() => parser.applyArguments(QUERY, [
      { head: { vars: ['000w'] }, results: { bindings: [{ '000w': { type: 'bnode', value: 'b0' } }] } },
    ])).toThrow();
  });

  it('refuses a constant beside other variables in one VALUES clause', () => {
    const multi = 'SELECT * WHERE { VALUES (?000w ?x) { (UNDEF UNDEF) } ?x <http://e/p> ?000w }';
    expect(() => parser.detectInputs(multi)).toThrow(/must be the only variable of its VALUES clause/);
    expect(() => parser.applyArguments(multi, [])).toThrow(/must be the only variable of its VALUES clause/);
  });

  it('applies the value pattern of the slot policy', () => {
    const policy = [{ vars: ['000w'], valuePattern: '^[\\p{L}\\p{N}]{4,}\\*?$' }];
    expect(parser.applyArguments(QUERY, [word('copper*')], policy)).toContain('"copper*"');
    expect(() => parser.applyArguments(QUERY, [word('re*')], policy))
      .toThrow(/Value "re\*" for \?000w does not match the pattern/);
  });
});

describe('constant parameters: detectInputs', () => {
  it('lists the constant, still as a one-variable VALUES input', () => {
    const detected = parser.detectInputs('SELECT * WHERE { VALUES ?000w { UNDEF } VALUES ?x { UNDEF } ?x <http://e/p> ?000w }');
    expect(detected.valuesInputs).toEqual([['000w'], ['x']]);
    expect(detected.constantInputs).toEqual(['000w']);
    expect(detected.constantWarnings).toEqual([]);
  });

  it('does not warn for the positions that keep the meaning', () => {
    const detected = parser.detectInputs(`${'SELECT ?000w WHERE {'}
      VALUES ?000w { UNDEF }
      { ?a <http://e/p> ?000w } UNION { ?b <http://e/p> ?000w }
      SERVICE <http://e/s> { GRAPH <http://e/g> { ?c <http://e/p> ?000w } }
      FILTER(?000w != "")
    } ORDER BY ?000w`);
    expect(detected.constantWarnings).toEqual([]);
  });

  it.each([
    ['OPTIONAL', 'OPTIONAL { ?a <http://e/p> ?000w }'],
    ['MINUS', 'MINUS { ?a <http://e/p> ?000w }'],
    ['EXISTS', 'FILTER EXISTS { ?a <http://e/p> ?000w }'],
    ['sub-SELECT', '{ SELECT ?a WHERE { ?a <http://e/p> ?000w } }'],
    ['BIND', 'BIND(?000w AS ?copy)'],
    ['nested FILTER', '{ ?a <http://e/p> ?b FILTER(?b = ?000w) }'],
    ['GRAPH name', 'GRAPH ?000w { ?a ?b ?c }'],
    ['SERVICE name', 'SERVICE ?000w { ?a ?b ?c }'],
  ])('warns for a %s, and the query still runs', (position, body) => {
    const query = `SELECT * WHERE { VALUES ?000w { UNDEF } ?z <http://e/z> ?y . ${body} }`;
    expect(parser.detectInputs(query).constantWarnings).toEqual([{ parameter: '000w', position }]);
    expect(() => parser.applyArguments(query, [word('x')])).not.toThrow();
  });

  it('warns for an occurrence in the WHERE clause outside the group of its VALUES clause', () => {
    const query = 'SELECT * WHERE { ?a <http://e/p> ?000w { VALUES ?000w { UNDEF } ?b <http://e/p> ?000w } }';
    expect(parser.detectInputs(query).constantWarnings).toEqual([
      { parameter: '000w', position: 'outside the group of its VALUES clause' },
    ]);
  });
});

describe('constant parameters: template path', () => {
  it('compiles no template for a query with a constant, so export refuses it', () => {
    expect(parser.compileVerifiedTemplate('SELECT * WHERE { VALUES ?000w { UNDEF } ?s ?p ?000w }')).toBeNull();
  });
});

describe('constant parameters: export', () => {
  it('refuses to compile a query with a constant for export, naming it', async () => {
    const { compileQueryTemplate, TemplateCompileError } = await import('../src/compileTemplate.js');
    expect(() => compileQueryTemplate('SELECT * WHERE { VALUES ?000w { UNDEF } ?s ?p ?000w }', { name: 'q' }))
      .toThrow(TemplateCompileError);
    expect(() => compileQueryTemplate('SELECT * WHERE { VALUES ?000w { UNDEF } ?s ?p ?000w }', { name: 'q' }))
      .toThrow(/constant parameter \?000w/);
  });
});
