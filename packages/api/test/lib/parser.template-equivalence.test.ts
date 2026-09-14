import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { Parser } from '@traqula/parser-sparql-1-2';
import { Generator } from '@traqula/generator-sparql-1-2';
import { SparqlQueryParser } from '../../src/lib/parser.js';

/**
 * Differential suite: the template/splice path must agree with the AST path.
 *
 * `applyArguments` now compiles a query to `{ text, slots }` and splices VALUES
 * blocks over recorded spans instead of regenerating the whole query. That is the
 * substitution half of recommendation 1a of the engine-integration and
 * transport analysis.
 *
 * The AST path is the oracle. These tests reach it through a parser instance whose
 * template compiler has been disabled, so both implementations run against
 * identical inputs and any divergence is a failure here rather than a wrong query
 * in production.
 */

const oracleParser = new Parser();
const oracleGenerator = new Generator();

/** Compare two queries up to formatting: reparse and regenerate both. */
function semanticallyEqual(a: string, b: string): boolean {
  return (
    oracleGenerator.generate(oracleParser.parse(a)) ===
    oracleGenerator.generate(oracleParser.parse(b))
  );
}

/**
 * A parser forced onto the AST path.
 *
 * `getVerifiedTemplate` is private, so it is stubbed through a cast; poisoning the
 * template cache would not work because a `null` entry is exactly what triggers the
 * fallback we want, but the cache is keyed per query and populated lazily.
 */
function astOnlyParser(): SparqlQueryParser {
  const parser = new SparqlQueryParser();
  (parser as unknown as { getVerifiedTemplate: () => null }).getVerifiedTemplate = () => null;
  return parser;
}

type ArgValue = { type: 'uri'; value: string } | {
  type: 'literal';
  value: string;
  datatype?: string;
  'xml:lang'?: string;
};

interface ArgSet {
  head: { vars: string[] };
  arguments: { bindings: Array<Record<string, ArgValue | null>> };
  whenEmpty?: 'unconstrained' | 'propagateEmpty' | 'require';
}

/** Run both implementations and assert they agree, on success and on failure alike. */
const SHARED_AST = astOnlyParser();
const SHARED_TEMPLATE = new SparqlQueryParser();

function expectAgreement(query: string, argumentSets: ArgSet[]): void {
  const viaAst = SHARED_AST;
  const viaTemplate = SHARED_TEMPLATE;

  let astResult: string | null = null;
  let astError: string | null = null;
  try {
    astResult = viaAst.applyArguments(query, argumentSets as never);
  } catch (error) {
    astError = (error as Error).message;
  }

  let templateResult: string | null = null;
  let templateError: string | null = null;
  try {
    templateResult = viaTemplate.applyArguments(query, argumentSets as never);
  } catch (error) {
    templateError = (error as Error).message;
  }

  if (astError !== null) {
    expect(templateError, `AST rejected but template accepted:\n${templateResult}`).not.toBeNull();
    // Both must reject; messages are asserted equal because callers see them.
    expect(templateError).toBe(astError);
    return;
  }

  expect(templateError, `template rejected but AST accepted:\n${astError}`).toBeNull();
  expect(semanticallyEqual(astResult!, templateResult!), `\nAST:\n${astResult}\n\nTEMPLATE:\n${templateResult}`).toBe(true);
}

const QUERIES = {
  singleVar: 'SELECT ?s WHERE { VALUES (?l) { (UNDEF) } ?s ?p ?l . }',
  multiVar: 'SELECT * WHERE { VALUES (?s ?p) { (UNDEF UNDEF) } ?s ?p ?o . }',
  twoSlots:
    'SELECT * WHERE { VALUES (?s) { (UNDEF) } ?s ?p ?o . OPTIONAL { VALUES (?o) { (UNDEF) } } }',
  nested:
    'SELECT * WHERE { ?s ?p ?o . OPTIONAL { GRAPH ?g { VALUES (?o) { (UNDEF) } } } }',
  update: 'INSERT { ?s ?p ?o } WHERE { VALUES (?s ?p ?o) { (UNDEF UNDEF UNDEF) } }',
  withPrefix:
    'PREFIX ex: <http://example.org/> SELECT * WHERE { VALUES (?s) { (UNDEF) } ?s ex:p ?o . }',
  authorData:
    'SELECT * WHERE { VALUES (?fixed) { (<http://example.org/keep>) } VALUES (?s) { (UNDEF) } ?s ?p ?fixed . }',
  noSlots: 'SELECT * WHERE { ?s ?p ?o . }',
};

const uri = (value: string): ArgValue => ({ type: 'uri', value });
const lit = (value: string, extra: Partial<ArgValue> = {}): ArgValue =>
  ({ type: 'literal', value, ...extra } as ArgValue);

describe('template/AST equivalence', () => {
  it('agrees on a single-variable slot', () => {
    expectAgreement(QUERIES.singleVar, [
      { head: { vars: ['l'] }, arguments: { bindings: [{ l: uri('http://example.org/a') }] } },
    ]);
  });

  it('agrees on a multi-variable slot, including partial UNDEF', () => {
    expectAgreement(QUERIES.multiVar, [
      {
        head: { vars: ['s', 'p'] },
        arguments: {
          bindings: [
            { s: uri('http://example.org/a'), p: null },
            { s: uri('http://example.org/b'), p: lit('x') },
          ],
        },
      },
    ]);
  });

  it('agrees on two slots in one query', () => {
    expectAgreement(QUERIES.twoSlots, [
      { head: { vars: ['s'] }, arguments: { bindings: [{ s: uri('http://example.org/a') }] } },
      { head: { vars: ['o'] }, arguments: { bindings: [{ o: lit('v') }] } },
    ]);
  });

  it('agrees on a slot nested inside OPTIONAL/GRAPH', () => {
    expectAgreement(QUERIES.nested, [
      { head: { vars: ['o'] }, arguments: { bindings: [{ o: lit('deep') }] } },
    ]);
  });

  it('agrees on an UPDATE operation', () => {
    expectAgreement(QUERIES.update, [
      {
        head: { vars: ['s', 'p', 'o'] },
        arguments: {
          bindings: [
            { s: uri('http://example.com/s'), p: uri('http://example.com/p'), o: lit('o') },
          ],
        },
      },
    ]);
  });

  it('agrees when the query declares prefixes', () => {
    expectAgreement(QUERIES.withPrefix, [
      { head: { vars: ['s'] }, arguments: { bindings: [{ s: uri('http://example.org/thing') }] } },
    ]);
  });

  it('leaves author VALUES data alone, in both paths', () => {
    expectAgreement(QUERIES.authorData, [
      { head: { vars: ['s'] }, arguments: { bindings: [{ s: uri('http://example.org/a') }] } },
    ]);
  });

  describe('whenEmpty modes', () => {
    for (const mode of ['unconstrained', 'propagateEmpty', 'require'] as const) {
      it(`agrees on '${mode}' with zero rows`, () => {
        expectAgreement(QUERIES.singleVar, [
          { head: { vars: ['l'] }, arguments: { bindings: [] }, whenEmpty: mode },
        ]);
      });
    }

    it('agrees on a bare wildcard row', () => {
      expectAgreement(QUERIES.singleVar, [
        { head: { vars: ['l'] }, arguments: { bindings: [{ l: null }] } },
      ]);
    });
  });

  describe('rejections agree', () => {
    it('agrees when the argument count is wrong', () => {
      expectAgreement(QUERIES.singleVar, []);
    });

    it('agrees when variables do not match', () => {
      expectAgreement(QUERIES.singleVar, [
        { head: { vars: ['nope'] }, arguments: { bindings: [{ nope: lit('x') }] } },
      ]);
    });

    it('agrees when a wildcard row is mixed with bound rows', () => {
      expectAgreement(QUERIES.singleVar, [
        { head: { vars: ['l'] }, arguments: { bindings: [{ l: null }, { l: lit('x') }] } },
      ]);
    });

    it('agrees when a query has no slots but arguments are supplied', () => {
      expectAgreement(QUERIES.noSlots, [
        { head: { vars: ['l'] }, arguments: { bindings: [{ l: lit('x') }] } },
      ]);
    });

    it('agrees on an unsupported argument type', () => {
      expectAgreement(QUERIES.singleVar, [
        { head: { vars: ['l'] }, arguments: { bindings: [{ l: { type: 'bnode', value: 'b0' } as never }] } },
      ]);
    });

    it('agrees on a hostile IRI', () => {
      expectAgreement(QUERIES.singleVar, [
        { head: { vars: ['l'] }, arguments: { bindings: [{ l: uri('http://e/a> <http://e/b') }] } },
      ]);
    });
  });

  describe('property: the two paths never diverge', () => {
    const argValue = fc.oneof(
      fc.constant(null),
      fc
        .stringMatching(/^[a-z][a-z0-9]{0,8}$/)
        .map((s) => uri(`http://example.org/${s}`)),
      fc.string({ maxLength: 24 }).map((s) => lit(s)),
      fc.string({ maxLength: 12 }).map((s) => lit(s, { 'xml:lang': 'en-GB' })),
      fc
        .string({ maxLength: 12 })
        .map((s) => lit(s, { datatype: 'http://www.w3.org/2001/XMLSchema#string' })),
    );

    it('holds for a single-variable slot', () => {
      fc.assert(
        fc.property(
          fc.array(fc.record({ l: argValue }), { maxLength: 4 }),
          fc.constantFrom('unconstrained', 'propagateEmpty', 'require', undefined),
          (bindings, whenEmpty) => {
            expectAgreement(QUERIES.singleVar, [
              {
                head: { vars: ['l'] },
                arguments: { bindings: bindings as Array<Record<string, ArgValue | null>> },
                ...(whenEmpty ? { whenEmpty: whenEmpty as never } : {}),
              },
            ]);
            return true;
          },
        ),
        { numRuns: 300, seed: 20260810 },
      );
    });

    it('holds for a multi-variable slot', () => {
      fc.assert(
        fc.property(
          fc.array(fc.record({ s: argValue, p: argValue }), { maxLength: 3 }),
          (bindings) => {
            expectAgreement(QUERIES.multiVar, [
              {
                head: { vars: ['s', 'p'] },
                arguments: { bindings: bindings as Array<Record<string, ArgValue | null>> },
              },
            ]);
            return true;
          },
        ),
        { numRuns: 300, seed: 20260810 },
      );
    });
  });

  describe('the compiler actually engages', () => {
    it('uses the template path for an ordinary parameterised query', () => {
      const parser = new SparqlQueryParser();
      const built = (
        parser as unknown as { getVerifiedTemplate: (q: string) => unknown }
      ).getVerifiedTemplate(QUERIES.singleVar);
      expect(built, 'expected a compiled template, got a fallback').not.toBeNull();
    });

    it('compiles every fixture query rather than silently falling back', () => {
      const parser = new SparqlQueryParser();
      const get = (parser as unknown as { getVerifiedTemplate: (q: string) => unknown })
        .getVerifiedTemplate.bind(parser);
      for (const [name, query] of Object.entries(QUERIES)) {
        expect(get(query), `${name} fell back to the AST path`).not.toBeNull();
      }
    });
  });
});
