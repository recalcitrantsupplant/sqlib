import { describe, expect, it } from 'vitest';
import {
  canonicalRuleText,
  expandIris,
  mergeRuleSet,
  parseRuleSet,
  reconcileRuleSet,
  splitDataBlocks,
  splitRuleSet,
} from '../src/index.js';

const PREFIX = 'PREFIX : <http://example/>';
const split = (doc: string) => splitRuleSet(expandIris(parseRuleSet(doc)));
const splitData = (doc: string) => splitDataBlocks(expandIris(parseRuleSet(doc)));

describe('splitRuleSet', () => {
  it('splits a multi-rule document into one document per rule', () => {
    const docs = split(`${PREFIX}
RULE { ?s :q ?o } WHERE { ?s :p ?o }
RULE { ?s :r ?o } WHERE { ?s :q ?o }`);
    expect(docs).toHaveLength(2);
    expect(docs[0].text).toContain('RULE {');
    // Rule text carries no prologue — prefixes belong to the ruleset.
    expect(docs[0].text).not.toContain('PREFIX');
  });

  it('prefers an explicit RULE <iri> name for identity and label', () => {
    const docs = split(`${PREFIX}\nRULE :myRule { ?s :q ?o } WHERE { ?s :p ?o }`);
    expect(docs[0].named).toBe(true);
    expect(docs[0].identity).toBe('http://example/myRule');
    expect(docs[0].suggestedLabel).toBe('myRule');
  });

  it('derives a deterministic label and hash identity when unnamed', () => {
    const doc = `${PREFIX}\nRULE { ?s :childOf ?o } WHERE { ?s :p ?o }`;
    const a = split(doc)[0];
    const b = split(doc)[0];
    expect(a.named).toBe(false);
    expect(a.identity).toMatch(/^hash:/);
    expect(a.suggestedLabel).toBe('rule-1-childOf');
    // Deterministic: same input always yields the same identity and label.
    expect(b.identity).toBe(a.identity);
    expect(b.suggestedLabel).toBe(a.suggestedLabel);
  });

  it('gives the same identity regardless of prefix spelling (canonical IRIs)', () => {
    const withDefault = split(`${PREFIX}\nRULE { ?s :q ?o } WHERE { ?s :p ?o }`)[0];
    const withNamed = split(`PREFIX ex: <http://example/>\nRULE { ?s ex:q ?o } WHERE { ?s ex:p ?o }`)[0];
    expect(withNamed.identity).toBe(withDefault.identity);
  });
});

describe('mergeRuleSet', () => {
  it('round-trips a document through split and merge', () => {
    const source = `${PREFIX}
RULE { ?s :q ?o } WHERE { ?s :p ?o }
RULE { ?s :r ?o } WHERE { ?s :q ?o }`;
    const merged = mergeRuleSet(split(source), PREFIX);
    const reparsed = parseRuleSet(merged);
    expect(reparsed.rules).toHaveLength(2);
    // And the merged document is itself stable through another cycle.
    expect(mergeRuleSet(split(merged), PREFIX)).toBe(merged);
  });
});

describe('splitDataBlocks', () => {
  const DOC = `${PREFIX}
DATA { :a :parent :b . :b :parent :c }
RULE { ?x :grandparent ?z } WHERE { ?x :parent ?y . ?y :parent ?z }`;

  it('decomposes DATA blocks alongside the rules', () => {
    const data = splitData(DOC);
    expect(data).toHaveLength(1);
    expect(data[0].text).toContain('DATA {');
    expect(data[0].suggestedLabel).toBe('data-1');
    // Canonical text carries no prologue — prefixes belong to the ruleset.
    expect(data[0].text).not.toContain('PREFIX');
  });

  it('identifies a data block by content hash, independent of prefix spelling', () => {
    const withDefault = splitData(DOC)[0];
    const withNamed = splitData(`PREFIX ex: <http://example/>
DATA { ex:a ex:parent ex:b . ex:b ex:parent ex:c }
RULE { ?x ex:grandparent ?z } WHERE { ?x ex:parent ?y . ?y ex:parent ?z }`)[0];
    expect(withDefault.identity).toMatch(/^hash:/);
    expect(withNamed.identity).toBe(withDefault.identity);
  });

  it('round-trips a document with DATA through split and merge — the data survives', () => {
    const rs = expandIris(parseRuleSet(DOC));
    const merged = mergeRuleSet(splitRuleSet(rs), PREFIX, splitDataBlocks(rs));
    expect(merged).toContain('DATA {');
    expect(merged).toContain(':parent');
    const reparsed = parseRuleSet(merged);
    expect(reparsed.dataBlocks).toHaveLength(1);
    expect(reparsed.rules).toHaveLength(1);
    // Stable through a second cycle.
    const again = expandIris(parseRuleSet(merged));
    expect(mergeRuleSet(splitRuleSet(again), PREFIX, splitDataBlocks(again))).toBe(merged);
  });

  it('emits data before rules, so a synthesized document has a stable order', () => {
    const rs = expandIris(parseRuleSet(`${PREFIX}
RULE { ?x :q ?o } WHERE { ?x :p ?o }
DATA { :a :p :b }`));
    const merged = mergeRuleSet(splitRuleSet(rs), PREFIX, splitDataBlocks(rs));
    expect(merged.indexOf('DATA {')).toBeLessThan(merged.indexOf('RULE'));
  });
});

describe('reconcileRuleSet', () => {
  const stored = (identity: string, text: string) => ({ identity, text });
  const identityOf = (i: { identity: string }) => i.identity;
  const textOf = (i: { text: string }) => i.text;

  it('reports no changes when re-importing an unchanged document', () => {
    const docs = split(`${PREFIX}\nRULE { ?s :q ?o } WHERE { ?s :p ?o }`);
    const existing = docs.map((d) => stored(d.identity, d.text));
    const r = reconcileRuleSet(docs, existing, identityOf, textOf);
    expect(r.created).toEqual([]);
    expect(r.detached).toEqual([]);
    expect(r.updated.every((u) => !u.changed)).toBe(true);
  });

  it('detects a prefix-only edit as no change (canonical identity)', () => {
    const before = split(`${PREFIX}\nRULE { ?s :q ?o } WHERE { ?s :p ?o }`);
    const existing = before.map((d) => stored(d.identity, d.text));
    const after = split(`PREFIX ex: <http://example/>\nRULE { ?s ex:q ?o } WHERE { ?s ex:p ?o }`);
    const r = reconcileRuleSet(after, existing, identityOf, textOf);
    expect(r.created).toEqual([]);
    expect(r.detached).toEqual([]);
    expect(r.updated.every((u) => !u.changed)).toBe(true);
  });

  it('creates new rules and detaches (never deletes) vanished ones', () => {
    const before = split(`${PREFIX}\nRULE :a { ?s :q ?o } WHERE { ?s :p ?o }`);
    const existing = before.map((d) => stored(d.identity, d.text));
    const after = split(`${PREFIX}\nRULE :b { ?s :r ?o } WHERE { ?s :p ?o }`);
    const r = reconcileRuleSet(after, existing, identityOf, textOf);
    expect(r.created).toHaveLength(1);
    expect(r.detached).toHaveLength(1);
    expect(r.detached[0].identity).toBe('http://example/a');
  });

  it('marks a matched rule whose body changed as changed', () => {
    const before = split(`${PREFIX}\nRULE :a { ?s :q ?o } WHERE { ?s :p ?o }`);
    const existing = before.map((d) => stored(d.identity, d.text));
    const after = split(`${PREFIX}\nRULE :a { ?s :q ?o } WHERE { ?s :different ?o }`);
    const r = reconcileRuleSet(after, existing, identityOf, textOf);
    expect(r.updated[0].changed).toBe(true);
  });
});

describe('canonicalRuleText', () => {
  it('normalizes whitespace so formatting-only edits are not changes', () => {
    const a = parseRuleSet(`${PREFIX}\nRULE {   ?s :q   ?o } WHERE {  ?s :p ?o  }`);
    const b = parseRuleSet(`${PREFIX}\nRULE { ?s :q ?o }\nWHERE {\n  ?s :p ?o\n}`);
    expect(canonicalRuleText(a.rules[0])).toBe(canonicalRuleText(b.rules[0]));
  });
});

describe('mergeRuleSet prefix abbreviation', () => {
  it('abbreviates expanded IRIs against the supplied prologue', () => {
    const docs = split(`${PREFIX}\nRULE { ?s :q ?o } WHERE { ?s :p ?o }`);
    // Stored canonically with full IRIs...
    expect(docs[0].text).toContain('<http://example/q>');
    // ...but rendered back through the prologue's prefixes.
    const merged = mergeRuleSet(docs, PREFIX);
    expect(merged).toContain(':q');
    expect(merged).not.toContain('<http://example/q>');
  });

  it('leaves IRIs alone when no prefix matches', () => {
    const docs = split(`${PREFIX}\nRULE { ?s <http://other.example/z> ?o } WHERE { ?s :p ?o }`);
    const merged = mergeRuleSet(docs, PREFIX);
    expect(merged).toContain('<http://other.example/z>');
  });

  it('round-trips: abbreviated output reparses to the same canonical text', () => {
    const docs = split(`${PREFIX}\nRULE { ?s :q ?o } WHERE { ?s :p ?o }`);
    const merged = mergeRuleSet(docs, PREFIX);
    const reparsed = split(merged);
    expect(reparsed[0].text).toBe(docs[0].text);
    expect(reparsed[0].identity).toBe(docs[0].identity);
  });

  it('prefers the most specific namespace when several match', () => {
    const prologue = 'PREFIX ex: <http://example.org/>\nPREFIX exns: <http://example.org/ns/>';
    const docs = split(`PREFIX p: <http://example.org/ns/>\nRULE { ?s p:deep ?o } WHERE { ?s p:x ?o }`);
    const merged = mergeRuleSet(docs, prologue);
    expect(merged).toContain('exns:deep');
    expect(merged).not.toContain('ex:ns/deep');
  });
});

/*
 * A rule that does not parse is stored as written, PREFIX and all — the W3C
 * bad-syntax cases are kept that way on purpose. Exporting it must not stack
 * the caller's prologue on top of its own declaration, or feeding the export's
 * declarations back in as the next prologue grows the document on every load.
 */
describe('mergeRuleSet with a rule stored verbatim', () => {
  const verbatim = { text: 'PREFIX :    <http://example/>\nRULE { } WHERE { a :p "abc" }' };

  it('does not declare again what the stored text already declares', () => {
    expect(mergeRuleSet([verbatim], 'PREFIX : <http://example/>')).toBe(`${verbatim.text}\n`);
  });

  it('is a fixed point when its own declarations are sent back as the prologue', () => {
    let document = mergeRuleSet([verbatim], 'PREFIX : <http://example/>');
    for (let load = 0; load < 3; load += 1) {
      const declared = document.split('\n').filter((line) => /^\s*PREFIX\b/.test(line)).join('\n');
      document = mergeRuleSet([verbatim], declared);
    }
    expect(document).toBe(`${verbatim.text}\n`);
  });

  it('writes each prologue declaration once', () => {
    const merged = mergeRuleSet(
      [{ text: 'RULE { ?s <http://example/q> ?o } WHERE { ?s <http://example/p> ?o }' }],
      'PREFIX : <http://example/>\nPREFIX :   <http://example/>',
    );
    expect(merged.match(/PREFIX/g)).toHaveLength(1);
  });

  it('keeps a declaration a canonical part beside it still needs', () => {
    const canonical = { text: 'RULE { ?s <http://example/q> ?o } WHERE { ?s <http://example/p> ?o }' };
    const merged = mergeRuleSet([verbatim, canonical], 'PREFIX : <http://example/>');
    expect(merged.startsWith('PREFIX : <http://example/>\n\n')).toBe(true);
    expect(merged).toContain('RULE { ?s :q ?o }');
  });
});
