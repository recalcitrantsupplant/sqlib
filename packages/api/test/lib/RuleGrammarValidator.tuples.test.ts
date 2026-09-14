import { describe, it, expect, beforeEach } from 'vitest';
import { RuleGrammarValidator } from '../../src/lib/RuleGrammarValidator.js';

/**
 * The rule-tuples extension at the validation gate.
 *
 * Every write path funnels through this validator, while the stratifier,
 * executor and the SRL import/export routes all parse with `{ tuples: true }`.
 * If the validator disagreed, a tuple rule could execute but never be saved.
 */
describe('RuleGrammarValidator - rule tuples', () => {
  let validator: RuleGrammarValidator;

  beforeEach(() => {
    validator = new RuleGrammarValidator();
  });

  const bodyTuple = `
    PREFIX : <http://example/>
    RULE { ?x :ok true } WHERE { TUPLE(:rel, ?x) }
  `;
  const headTuple = `
    PREFIX : <http://example/>
    RULE { TUPLE(:rel, ?s, ?o) } WHERE { ?s :p ?o }
  `;

  it('accepts a rule whose body reads a tuple', () => {
    const result = validator.validateWithAllGrammars(bodyTuple);
    expect(result.valid).toBe(true);
    expect(result.primaryGrammar).toBe('srl');
    expect(result.usesTuples).toBe(true);
  });

  it('accepts a rule whose head writes a tuple', () => {
    const result = validator.validateWithAllGrammars(headTuple);
    expect(result.valid).toBe(true);
    expect(result.usesTuples).toBe(true);
  });

  it('withholds a normalized program for tuple rules', () => {
    // The compiled form carries reserved VALUES slots that only the
    // executor's tuple path can fill. Storing it as `normalizedInsert` would let
    // a non-tuple-aware caller run the rule with its tuple reads simply absent —
    // unconstrained, and silently wrong.
    expect(validator.validateWithAllGrammars(bodyTuple).normalized).toBeUndefined();
    expect(validator.validateWithAllGrammars(headTuple).normalized).toBeUndefined();
  });

  it('still normalizes ordinary rules, and does not flag them', () => {
    const result = validator.validateWithAllGrammars(`
      PREFIX : <http://example/>
      RULE { ?s :ok true } WHERE { ?s :p ?o }
    `);
    expect(result.valid).toBe(true);
    expect(result.usesTuples).toBeUndefined();
    expect(result.normalized).toContain('INSERT');
  });

  it('rejects a malformed tuple rather than accepting it as SPARQL', () => {
    const result = validator.validateWithAllGrammars(`
      PREFIX : <http://example/>
      RULE { ?x :ok true } WHERE { TUPLE(:rel, ?x }
    `);
    expect(result.valid).toBe(false);
  });
});
