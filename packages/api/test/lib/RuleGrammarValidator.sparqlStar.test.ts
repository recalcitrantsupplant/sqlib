import { describe, it, expect, beforeEach } from 'vitest';
import { RuleGrammarValidator } from '../../src/lib/RuleGrammarValidator.js';

/**
 * RDF-star support in SRL rules.
 *
 * The SRL grammar is built on SPARQL 1.2, so RDF-star is the standardized 1.2
 * flavour (triple terms `<<( … )>>`, annotation blocks `{| … |}`) rather than
 * the older SPARQL-1.1-star `<< … >>`. The single SRL validator handles it.
 */
describe('RuleGrammarValidator - RDF-star (SPARQL 1.2) support', () => {
  let validator: RuleGrammarValidator;

  beforeEach(() => {
    validator = new RuleGrammarValidator();
  });

  it('accepts an annotation block in a rule head', () => {
    const rule = `
      PREFIX : <http://example/>
      RULE { :s :p :o {| :anno ?a |} } WHERE { ?s ?p ?a }
    `;
    const result = validator.validateWithAllGrammars(rule);
    expect(result.valid).toBe(true);
    expect(result.primaryGrammar).toBe('srl');
    expect(result.normalized).toBeTruthy();
  });

  it('accepts a triple term in a rule head', () => {
    const rule = `
      PREFIX : <http://example/>
      RULE { :x :saw <<( ?s ?p ?o )>> } WHERE { ?s ?p ?o }
    `;
    const result = validator.validateWithAllGrammars(rule);
    expect(result.valid).toBe(true);
    expect(result.primaryGrammar).toBe('srl');
  });

  it('accepts an annotation block in a rule body', () => {
    const rule = `
      PREFIX : <http://example/>
      RULE { ?s :hasAnno ?a } WHERE { :s :p :o {| :anno ?a |} }
    `;
    const result = validator.validateWithAllGrammars(rule);
    expect(result.valid).toBe(true);
  });
});
