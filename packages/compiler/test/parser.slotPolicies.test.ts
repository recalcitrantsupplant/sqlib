import { describe, expect, it } from 'vitest';
import { SparqlQueryParser } from '../src/parser.js';

/**
 * Slot policies: the query author's `whenEmpty`, from the version's input
 * tuples (`docs/proposals/required-arguments.md`). Run on both substitution
 * paths, because `completeArgumentSets` is the one place both get it from.
 */

function astOnlyParser(): SparqlQueryParser {
  const parser = new SparqlQueryParser();
  (parser as unknown as { getVerifiedTemplate: () => null }).getVerifiedTemplate = () => null;
  return parser;
}

const QUERY = 'SELECT ?part WHERE { VALUES ?whole { UNDEF } ?part <http://purl.org/dc/terms/isPartOf> ?whole }';
const BOUND = { whole: { type: 'uri' as const, value: 'urn:example:book1' } };

describe.each([
  ['template', new SparqlQueryParser()],
  ['AST', astOnlyParser()],
])('slot policies on the %s path', (_path, parser) => {
  const require = [{ vars: ['whole'], whenEmpty: 'require' as const }];

  it('refuses a required slot that is omitted, a wildcard, or zero rows', () => {
    const cases = [
      [],
      [{ head: { vars: ['whole'] }, results: { bindings: [{}] } }],
      [{ head: { vars: ['whole'] }, results: { bindings: [] } }],
    ];
    for (const argumentSets of cases) {
      expect(() => parser.applyArguments(QUERY, argumentSets, require))
        .toThrow('Required input for VALUES clause 1 (?whole) received no bindings');
    }
  });

  it('runs a required slot that has a bound row', () => {
    const result = parser.applyArguments(
      QUERY,
      [{ head: { vars: ['whole'] }, results: { bindings: [BOUND] } }],
      require,
    );
    expect(result).toContain('urn:example:book1');
    expect(result).not.toContain('UNDEF');
  });

  it('matches nothing for an omitted propagateEmpty slot', () => {
    const result = parser.applyArguments(QUERY, [], [{ vars: ['whole'], whenEmpty: 'propagateEmpty' }]);
    expect(result).toMatch(/VALUES\s*\?whole\s*\{\s*\}/);
  });

  it('keeps the built-in reading without a policy', () => {
    expect(parser.applyArguments(QUERY, [])).not.toContain('VALUES');
    expect(parser.applyArguments(QUERY, [{ head: { vars: ['whole'] }, results: { bindings: [] } }]))
      .toMatch(/VALUES\s*\?whole\s*\{\s*\}/);
  });

  it('lets a group edge choose another closed mode, but not reopen the slot', () => {
    const fromEdge = (whenEmpty: 'propagateEmpty' | 'unconstrained') =>
      parser.applyArguments(QUERY, [{ head: { vars: ['whole'] }, results: { bindings: [] }, whenEmpty }], require);

    expect(fromEdge('propagateEmpty')).toMatch(/VALUES\s*\?whole\s*\{\s*\}/);
    expect(() => fromEdge('unconstrained'))
      .toThrow("VALUES clause 1 (?whole) is marked 'require' by its query and cannot be run unconstrained.");
  });

  it('matches a policy to its slot by variables, not order', () => {
    const query = 'SELECT * WHERE { VALUES (?a ?b) { (UNDEF UNDEF) } VALUES ?c { UNDEF } ?a ?b ?c }';
    expect(() => parser.applyArguments(query, [], [{ vars: ['b', 'a'], whenEmpty: 'require' }]))
      .toThrow('Required input for VALUES clause 1 (?a, ?b) received no bindings');
    // A row that binds one of the slot's variables satisfies it.
    const partial = parser.applyArguments(
      query,
      [{ head: { vars: ['a', 'b'] }, results: { bindings: [{ a: BOUND.whole }] } }],
      [{ vars: ['a', 'b'], whenEmpty: 'require' }],
    );
    expect(partial).toContain('urn:example:book1');
  });
});
