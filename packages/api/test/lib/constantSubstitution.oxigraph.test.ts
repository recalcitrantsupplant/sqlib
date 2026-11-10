/**
 * Constant parameters give the answers of a plain VALUES run.
 *
 * For each query, the constant run (`?000w`: VALUES row kept, term written into
 * the triple patterns in reach) is compared with a plain run of the same text,
 * where the variable is renamed so it is an ordinary VALUES parameter. Both run
 * on Oxigraph and the sorted rows must be equal. That is the correctness
 * property in docs/proposals/constant-substitution.md. The one case the
 * proposal says can differ, a FILTER in a nested group, is pinned too.
 */
import { describe, expect, it } from 'vitest';
import * as oxigraph from 'oxigraph';
import { SparqlQueryParser, type ApplyArgumentSet } from '../../src/lib/parser.js';

const DATA = `
@prefix : <http://e/> .
:a :label "copper" ; :p 1 ; a :T .
:b :label "tin" ; :p 2 .
:c :label "copper" ; :p 3 ; a :T .
:d :label "zinc" .
:g1 { :a :tag "copper" . :b :tag "tin" . }
`;

const store = new oxigraph.Store();
store.load(DATA, { format: 'application/trig' });
const parser = new SparqlQueryParser();

const literal = (name: string, value: string): ApplyArgumentSet => ({
  head: { vars: [name] },
  results: { bindings: [{ [name]: { type: 'literal', value } }] },
});

/** Run a query on Oxigraph, as sorted rows (SELECT) or sorted N-Triples (CONSTRUCT). */
function rows(text: string, rename: [string, string] = ['', '']): string[] {
  const result = store.query(text) as unknown;
  if (Array.isArray(result)) {
    return result
      .map((item: any) => {
        if (item instanceof Map) {
          return JSON.stringify(
            [...item.entries()]
              .map(([key, term]: [string, any]) => [key === rename[0] ? rename[1] : key, term.toString()])
              .sort(),
          );
        }
        return item.toString();
      })
      .sort();
  }
  return [String(result)];
}

/** Rows of the constant run and of the plain VALUES run of the same text. */
function both(query: string, value = 'copper') {
  const constant = parser.applyArguments(query, [literal('000w', value)]);
  const plainText = query.replace(/\?000w/g, '?plainw');
  const plain = parser.applyArguments(plainText, [literal('plainw', value)]);
  return { constant: rows(constant), plain: rows(plain, ['plainw', '000w']), constantText: constant };
}

const P = 'PREFIX : <http://e/>\n';

describe('constant parameters on Oxigraph: same rows as a plain VALUES run', () => {
  it.each([
    ['a triple pattern', `${P}SELECT ?s ?000w WHERE { VALUES ?000w { UNDEF } ?s :label ?000w }`],
    ['a nested group', `${P}SELECT ?s WHERE { VALUES ?000w { UNDEF } { ?s :label ?000w } }`],
    ['a UNION', `${P}SELECT ?s WHERE { VALUES ?000w { UNDEF } { ?s :label ?000w } UNION { ?s :tag ?000w } }`],
    ['a GRAPH body', `${P}SELECT ?s WHERE { VALUES ?000w { UNDEF } GRAPH :g1 { ?s :tag ?000w } }`],
    ['a FILTER beside the clause', `${P}SELECT ?s WHERE { VALUES ?000w { UNDEF } ?s :label ?000w FILTER(STRLEN(?000w) > 3) }`],
    ['a property path', `${P}SELECT ?s WHERE { VALUES ?000w { UNDEF } ?s :label|:tag ?000w }`],
    ['a blank node property list', `${P}SELECT ?s WHERE { VALUES ?000w { UNDEF } ?s a :T ; :label ?000w . [] :x* [ :y* ?000w ] }`],
    ['SELECT * and ORDER BY', `${P}SELECT * WHERE { VALUES ?000w { UNDEF } ?s :label ?000w ; :p ?n } ORDER BY ?000w ?n`],
    ['OPTIONAL (warns)', `${P}SELECT ?s ?l WHERE { VALUES ?000w { UNDEF } ?s :p ?n OPTIONAL { ?s :label ?l FILTER(?l = ?000w) } }`],
    ['MINUS (warns)', `${P}SELECT ?s WHERE { VALUES ?000w { UNDEF } ?s :p ?n MINUS { ?s :label ?000w } }`],
    ['a sub-SELECT holding the clause', `${P}SELECT ?s WHERE { ?s a :T { SELECT ?s WHERE { VALUES ?000w { UNDEF } ?s :label ?000w } } }`],
    ['BIND (warns)', `${P}SELECT ?s ?copy WHERE { VALUES ?000w { UNDEF } ?s :label ?000w BIND(?000w AS ?copy) }`],
    ['a CONSTRUCT', `${P}CONSTRUCT { ?s :hit ?000w } WHERE { VALUES ?000w { UNDEF } ?s :label ?000w }`],
    ['ASK', `${P}ASK { VALUES ?000w { UNDEF } ?s :label ?000w }`],
  ])('%s', (_name, query) => {
    const { constant, plain } = both(query);
    expect(constant).toEqual(plain);
  });

  it('writes the constant where it should, so the comparison is not vacuous', () => {
    const { constantText } = both(`${P}SELECT ?s WHERE { VALUES ?000w { UNDEF } ?s :label ?000w }`);
    expect(constantText).toMatch(/:label "copper"/);
  });

  it('a FILTER in a nested group loses its binding and drops every row, as the proposal predicts', () => {
    const query = `${P}SELECT ?s WHERE { VALUES ?000w { UNDEF } { ?s :label ?000w FILTER(STRLEN(?000w) > 3) } }`;
    expect(parser.detectInputs(query).constantWarnings).toEqual([{ parameter: '000w', position: 'nested FILTER' }]);
    const { constant, plain } = both(query);
    expect(plain.length).toBe(2);
    expect(constant).toEqual([]);
  });

  it('an UPDATE writes the constant in WHERE only, and inserts the same triples', () => {
    const update = `${P}INSERT { GRAPH :out { ?s :tagged ?000w } } WHERE { VALUES ?000w { UNDEF } ?s :label ?000w }`;
    const constantText = parser.applyArguments(update, [literal('000w', 'copper')]);
    expect(constantText).toMatch(/:tagged \?000w/);
    store.update(constantText);
    const constantRows = rows(`${P}SELECT ?s ?o WHERE { GRAPH :out { ?s :tagged ?o } }`);
    store.update(`${P}DROP GRAPH :out`);
    store.update(parser.applyArguments(update.replace(/\?000w/g, '?plainw'), [literal('plainw', 'copper')]));
    const plainRows = rows(`${P}SELECT ?s ?o WHERE { GRAPH :out { ?s :tagged ?o } }`);
    store.update(`${P}DROP GRAPH :out`);
    expect(constantRows).toEqual(plainRows);
    expect(constantRows).toHaveLength(2);
  });
});
