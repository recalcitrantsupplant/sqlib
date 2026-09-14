import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { SparqlQueryParser } from '../../src/lib/parser.js';

const query = 'SELECT ?x WHERE { ?x ?p ?o . VALUES (?x) { (UNDEF) } }';

describe('VALUES total-rewrite property', () => {
  it('never dispatches an all-UNDEF parameter slot', () => {
    const parser = new SparqlQueryParser();
    fc.assert(fc.property(
      fc.oneof(
        fc.constant({ bindings: [], whenEmpty: undefined }),
        fc.constant({ bindings: [], whenEmpty: 'unconstrained' }),
        fc.constant({ bindings: [{}], whenEmpty: undefined }),
        fc.string({ minLength: 1, maxLength: 32 }).map(value => ({
          bindings: [{ x: { type: 'literal', value } }], whenEmpty: undefined,
        })),
      ),
      ({ bindings, whenEmpty }) => {
        const rendered = parser.applyArguments(query, [{
          head: { vars: ['x'] },
          arguments: { bindings },
          ...(whenEmpty ? { whenEmpty } : {}),
        }]);
        expect(rendered).not.toContain('UNDEF');
        if (bindings.length === 0 && whenEmpty === 'unconstrained') {
          expect(rendered).not.toContain('VALUES');
        }
      },
    ), { numRuns: 100, seed: 20260729 });
  });

  it('treats null and omitted UNDEF cells identically and deterministically', () => {
    const parser = new SparqlQueryParser();
    fc.assert(fc.property(
      fc.string({ minLength: 1, maxLength: 32 }),
      value => {
        const bound = { type: 'literal' as const, value };
        const omitted = parser.applyArguments(query, [{
          head: { vars: ['x'] }, arguments: { bindings: [{}] },
        }]);
        const explicitNull = parser.applyArguments(query, [{
          head: { vars: ['x'] }, arguments: { bindings: [{ x: null }] },
        }]);

        expect(explicitNull).toBe(omitted);
        expect(() => parser.applyArguments(query, [{
          head: { vars: ['x'] }, arguments: { bindings: [{}, { x: bound }] },
        }])).toThrow('an all-UNDEF row cannot be mixed with bound rows');
        expect(() => parser.applyArguments(query, [{
          head: { vars: ['x'] }, arguments: { bindings: [{ x: null }, { x: bound }] },
        }])).toThrow('an all-UNDEF row cannot be mixed with bound rows');
      },
    ), { numRuns: 50, seed: 20260730 });
  });
});
