import { describe, expect, it } from 'vitest';
import {
  canonicalRuleText,
  expandIris,
  formatDataBlock,
  formatRule,
  formatRuleSet,
  generateRule,
  parseRuleSet,
} from '../src/index.js';

const PREFIX = 'PREFIX : <http://example/>';
const parse = (doc: string) => parseRuleSet(doc, { tuples: true });
const format = (doc: string) => formatRuleSet(parse(doc));

describe('formatRuleSet', () => {
  it('lays a rule out over lines, one pattern per line', () => {
    const formatted = format(`${PREFIX}\nRULE { ?x :grandparent ?z } WHERE { ?x :parent ?y . ?y :parent ?z }`);
    expect(formatted).toBe(
      `${PREFIX}

RULE {
  ?x :grandparent ?z .
} WHERE {
  ?x :parent ?y .
  ?y :parent ?z .
}
`,
    );
  });

  it('indents a nested NOT and keeps its DATA flag', () => {
    const formatted = format(`${PREFIX}\nRULE { ?x :p ?y } WHERE DATA { ?x :q ?y . NOT DATA { ?x :blocked ?y } }`);
    expect(formatted).toContain('} WHERE DATA {\n');
    expect(formatted).toContain('  NOT DATA {\n    ?x :blocked ?y .\n  }');
  });

  it('honours a custom indent unit', () => {
    const ruleSet = parse(`${PREFIX}\nRULE { ?x :p ?y } WHERE { ?x :q ?y }`);
    expect(formatRule(ruleSet.rules[0], { indent: '    ' })).toContain('\n    ?x :p ?y .\n');
  });

  it('puts each DATA triple on its own line, blocks before rules', () => {
    const formatted = format(`${PREFIX}
RULE { ?x :grandparent ?z } WHERE { ?x :parent ?y . ?y :parent ?z }
DATA { :a :parent :b . :b :parent :c }`);
    expect(formatted).toContain('DATA {\n  :a :parent :b .\n  :b :parent :c .\n}');
    expect(formatted.indexOf('DATA {')).toBeLessThan(formatted.indexOf('RULE {'));
  });

  it('keeps an empty block on one line', () => {
    expect(format('RULE { } WHERE { }')).toBe('RULE { } WHERE { }\n');
    expect(formatDataBlock(parse('DATA { }').dataBlocks[0])).toBe('DATA { }');
  });

  it('normalizes the prologue to one declaration per line', () => {
    const formatted = format(`BASE <http://base/>   PREFIX ex:    <http://example/>
PREFIX unused: <http://unused/>
RULE { ?x ex:p ?y } WHERE { ?x ex:q ?y }`);
    expect(formatted.split('\n\n')[0]).toBe(
      'BASE <http://base/>\nPREFIX ex: <http://example/>\nPREFIX unused: <http://unused/>',
    );
  });

  it('formats tuple heads and bodies under the rule-tuples extension', () => {
    const formatted = format(`${PREFIX}\nRULE { TUPLE(:rel, ?x, ?y) } WHERE { ?x :q ?y . TUPLE(:other, ?x) }`);
    expect(formatted).toContain('  TUPLE(:rel, ?x, ?y) .\n');
    expect(formatted).toContain('  TUPLE(:other, ?x)\n');
  });

  it('is idempotent, and what it emits parses back to the same rules', () => {
    const doc = `${PREFIX}
DATA { :a :parent :b }
RULE :r { ?x :grandparent ?z . TUPLE(:rel, ?x) } WHERE { ?x :parent ?y . ?y :parent ?z . FILTER(?x != ?z) NOT { ?x :blocked ?z } SET ( ?n := 1 + 2 ) }`;
    const once = format(doc);
    expect(format(once)).toBe(once);

    const before = parse(doc);
    const after = parse(once);
    expect(after.rules).toHaveLength(before.rules.length);
    expect(after.dataBlocks).toHaveLength(before.dataBlocks.length);
    // Same meaning, not merely the same shape: canonical (prefix-independent)
    // text of the reparsed rule matches the original's.
    expect(canonicalRuleText(expandIris(after).rules[0])).toBe(canonicalRuleText(expandIris(before).rules[0]));
  });

  it('keeps a prefixed rule name prefixed, so the name survives a round trip', () => {
    // `<:r>` would be a relative IRI reference, not the term the author wrote.
    expect(format(`${PREFIX}\nRULE :r { ?x :p ?y } WHERE { ?x :q ?y }`)).toContain('RULE :r {');
    const reparsed = parse(format(`${PREFIX}\nRULE :r { ?x :p ?y } WHERE { ?x :q ?y }`));
    expect(reparsed.rules[0].name).toBe(':r');
    // An expanded name is written back as an IRI.
    const expanded = expandIris(parse(`${PREFIX}\nRULE :r { ?x :p ?y } WHERE { ?x :q ?y }`));
    expect(formatRule(expanded.rules[0])).toContain('RULE <http://example/r> {');
    // The single-line generator renders the name the same way.
    expect(generateRule(parse(`${PREFIX}\nRULE :r { ?x :p ?y } WHERE { ?x :q ?y }`).rules[0])).toContain('RULE :r {');
    expect(generateRule(expanded.rules[0])).toContain('RULE <http://example/r> {');
  });
});

describe('generateRule vs formatRule', () => {
  it('leaves the canonical single-line generator alone', () => {
    const rule = expandIris(parse(`${PREFIX}\nRULE :r { ?x :p ?y } WHERE { ?x :q ?y }`)).rules[0];
    expect(generateRule(rule)).not.toContain('\n');
    expect(formatRule(rule)).toContain('\n');
    // Canonical text is whitespace-insensitive, so both agree on identity.
    expect(canonicalRuleText(rule)).toBe(formatRule(rule).replace(/\s+/g, ' ').trim());
  });
});
