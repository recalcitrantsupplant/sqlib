import { describe, expect, it } from 'vitest';
import { SparqlQueryParser } from '../src/parser.js';

/**
 * The caller's identity slots, `?authUser` and `?authGroup`: filled from the
 * `caller` option and never from an argument. Run on both substitution paths,
 * because `completeArgumentSets` is the one place both fill them.
 */

function astOnlyParser(): SparqlQueryParser {
  const parser = new SparqlQueryParser();
  (parser as unknown as { getVerifiedTemplate: () => null }).getVerifiedTemplate = () => null;
  return parser;
}

const QUERY =
  'SELECT ?record WHERE { VALUES ?authUser { UNDEF } VALUES ?authGroup { UNDEF } VALUES ?record { UNDEF } ?record <urn:ex:owner> ?authUser }';
const ALICE = { user: 'urn:sqlib:principal:user:alice', groups: ['urn:sqlib:principal:group:a', 'urn:sqlib:principal:group:b'] };
const RECORD = { head: { vars: ['record'] }, results: { bindings: [{ record: { type: 'uri' as const, value: 'urn:ex:r1' } }] } };

const normalise = (text: string) => text.replace(/\s+/g, ' ');

describe.each([
  ['template', new SparqlQueryParser()],
  ['AST', astOnlyParser()],
])('identity slots on the %s path', (_path, parser) => {
  it('fills ?authUser with one row and ?authGroup with one row per group', () => {
    const text = normalise(parser.applyArguments(QUERY, [RECORD], [], { caller: ALICE }));
    expect(text).toContain('<urn:sqlib:principal:user:alice>');
    expect(text).toContain('<urn:sqlib:principal:group:a>');
    expect(text).toContain('<urn:sqlib:principal:group:b>');
    expect(text).toContain('<urn:ex:r1>');
    expect(text).not.toContain('UNDEF');
  });

  it('gives zero rows for no one, never an open slot', () => {
    const text = normalise(parser.applyArguments(QUERY, [], [], { caller: null }));
    expect(text).not.toContain('UNDEF');
    // Both identity slots stay, empty, so the query matches nothing.
    expect(text.match(/VALUES \?auth(User|Group) \{\s*\}/g)).toHaveLength(2);
  });

  it('gives zero group rows for a caller with no groups', () => {
    const text = normalise(parser.applyArguments(QUERY, [], [], { caller: { user: ALICE.user, groups: [] } }));
    expect(text).toMatch(/VALUES \?authGroup \{\s*\}/);
  });

  it('refuses a run that passes no caller option', () => {
    expect(() => parser.applyArguments(QUERY, [RECORD])).toThrow(/reads the caller \(\?authUser\) and was run without one/);
  });

  it('refuses an argument that names a slot, even with a caller', () => {
    const forged = { head: { vars: ['authUser'] }, results: { bindings: [{ authUser: { type: 'uri' as const, value: 'urn:x' } }] } };
    expect(() => parser.applyArguments(QUERY, [forged], [], { caller: ALICE })).toThrow(/filled from the caller's sign-in/);
    const wildcard = { head: { vars: ['authUser'] }, results: { bindings: [{}] } };
    expect(() => parser.applyArguments(QUERY, [wildcard], [], { caller: ALICE })).toThrow(/filled from the caller's sign-in/);
  });

  it('keeps a slot empty when the author marks it unconstrained', () => {
    const text = normalise(parser.applyArguments(QUERY, [], [{ vars: ['authUser'], whenEmpty: 'unconstrained' }], { caller: null }));
    expect(text).toMatch(/VALUES \?authUser \{\s*\}/);
  });

  it('refuses a slot inside a multi-variable VALUES', () => {
    const zipped = 'SELECT * WHERE { VALUES (?authUser ?x) { (UNDEF UNDEF) } }';
    expect(() => parser.applyArguments(zipped, [], [], { caller: ALICE })).toThrow(/must be declared on its own/);
  });

  it('leaves a query without slots as it was', () => {
    const plain = 'SELECT * WHERE { VALUES ?record { UNDEF } ?record ?p ?o }';
    expect(parser.applyArguments(plain, [RECORD])).toBe(parser.applyArguments(plain, [RECORD], [], { caller: ALICE }));
  });
});

describe('identity slots on both paths', () => {
  it('substitutes the same text', () => {
    const template = new SparqlQueryParser().applyArguments(QUERY, [RECORD], [], { caller: ALICE });
    const ast = astOnlyParser().applyArguments(QUERY, [RECORD], [], { caller: ALICE });
    expect(normalise(template)).toBe(normalise(ast));
  });

  it('builds a verified template for a query that declares the slots', () => {
    const parser = new SparqlQueryParser();
    expect(parser.compileVerifiedTemplate(QUERY)).not.toBeNull();
  });
});
