import { describe, it, expect, beforeEach } from 'vitest';
import { RuleGrammarValidator } from '../../src/lib/RuleGrammarValidator.js';

/**
 * `formatRuleOrData` used to be a validating passthrough: it checked the input
 * and handed it back verbatim, so the Format button did nothing to an SRL
 * document. It now pretty-prints from the SRL AST, which is what these tests
 * pin — including the two things a formatter must never do: change what a
 * document means, or reject one that validates.
 */
describe('RuleGrammarValidator - formatRuleOrData', () => {
  let validator: RuleGrammarValidator;

  beforeEach(() => {
    validator = new RuleGrammarValidator();
  });

  it('re-indents an SRL rule from the AST', () => {
    const { formatted, grammar } = validator.formatRuleOrData(
      'PREFIX : <http://example/>   RULE { ?x :p ?y } WHERE { ?x :q ?y }'
    );
    expect(grammar).toBe('srl');
    expect(formatted).toBe(
      'PREFIX : <http://example/>\n\nRULE {\n  ?x :p ?y .\n} WHERE {\n  ?x :q ?y .\n}'
    );
  });

  it('formats a DATA block and a rule as separate blocks, data first', () => {
    const { formatted } = validator.formatRuleOrData(`PREFIX : <http://example/>
RULE { ?x :grandparent ?z } WHERE { ?x :parent ?y . ?y :parent ?z }
DATA { :a :parent :b }`);
    expect(formatted).toBe(
      `PREFIX : <http://example/>

DATA {
  :a :parent :b .
}

RULE {
  ?x :grandparent ?z .
} WHERE {
  ?x :parent ?y .
  ?y :parent ?z .
}`
    );
  });

  it('formats a tuple rule when the deployment offers the extension', () => {
    const { formatted } = validator.formatRuleOrData(
      'PREFIX : <http://example/>\nRULE { TUPLE(:rel, ?s, ?o) } WHERE { ?s :p ?o }'
    );
    expect(formatted).toContain('  TUPLE(:rel, ?s, ?o) .\n');
  });

  it('is idempotent', () => {
    const once = validator.formatRuleOrData(
      'PREFIX : <http://example/>\nRULE :r { ?x :p ?y } WHERE DATA { ?x :q ?y . NOT { ?x :no ?y } }'
    ).formatted;
    expect(validator.formatRuleOrData(once).formatted).toBe(once);
  });

  it('leaves plain SPARQL to the query formatter, trimmed but unrewritten', () => {
    const { formatted, grammar } = validator.formatRuleOrData('  INSERT DATA { <http://a> <http://b> <http://c> }  ');
    expect(grammar).toBe('sparql');
    expect(formatted).toBe('INSERT DATA { <http://a> <http://b> <http://c> }');
  });

  it('rejects input that is neither SRL nor SPARQL', () => {
    expect(() => validator.formatRuleOrData('RULE { ?x :p')).toThrow();
    expect(() => validator.formatRuleOrData('   ')).toThrow();
  });
});
