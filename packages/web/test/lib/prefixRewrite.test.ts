import { describe, it, expect } from 'vitest';
import { sparqlLanguage } from '@kurrawongai/codemirror-lang-sparql12';
import { srlLanguage } from '@kurrawongai/codemirror-lang-srl';
import { turtleLanguage } from '@kurrawongai/codemirror-lang-turtle12';
import { toPrefixedNames, toFullIris, readDeclaredPrefixes, addDeclarations } from '@/lib/prefixRewrite';
import { prefixGrammarFor } from '@/lib/codeLanguage';
import type { PrefixPair } from '@/lib/curie';

const SPARQL = sparqlLanguage.parser;
const TURTLE = turtleLanguage.parser;
const SRL = srlLanguage.parser;

/*
 * The pairs the toolbar buttons work against, longest namespace first — the
 * order `shrink` requires, and the order the composable hands over.
 */
const PAIRS: PrefixPair[] = [
  { prefix: 'schemaPerson', namespace: 'http://schema.org/Person/' },
  { prefix: 'schema', namespace: 'http://schema.org/' },
  { prefix: 'foaf', namespace: 'http://xmlns.com/foaf/0.1/' },
];

const namespaceFor = (prefix: string) =>
  PAIRS.find((p) => p.prefix === prefix)?.namespace;

describe('toPrefixedNames', () => {
  it('rewrites a full IRI and declares the prefix it used', () => {
    const result = toPrefixedNames('SELECT * WHERE { ?s <http://schema.org/name> ?o }', PAIRS, SPARQL);

    expect(result.converted).toBe(1);
    expect(result.text).toContain('?s schema:name ?o');
    expect(result.text).toContain('PREFIX schema: <http://schema.org/>');
    expect(result.added).toEqual([{ prefix: 'schema', namespace: 'http://schema.org/' }]);
  });

  it('adds its declarations below the ones already there', () => {
    const text = [
      'PREFIX foaf: <http://xmlns.com/foaf/0.1/>',
      '',
      'SELECT * WHERE { ?s <http://schema.org/name> ?o }',
    ].join('\n');

    const lines = toPrefixedNames(text, PAIRS, SPARQL).text.split('\n');
    expect(lines[0]).toBe('PREFIX foaf: <http://xmlns.com/foaf/0.1/>');
    expect(lines[1]).toBe('PREFIX schema: <http://schema.org/>');
  });

  it('does not declare a prefix the document already declares', () => {
    const text = 'PREFIX schema: <http://schema.org/>\nSELECT * WHERE { ?s <http://schema.org/name> ?o }';
    const result = toPrefixedNames(text, PAIRS, SPARQL);

    expect(result.text.match(/PREFIX schema:/g)).toHaveLength(1);
    expect(result.text).toContain('schema:name');
  });

  it('prefers the longest matching namespace', () => {
    const result = toPrefixedNames('SELECT * WHERE { ?s a <http://schema.org/Person/height> }', PAIRS, SPARQL);
    expect(result.text).toContain('schemaPerson:height');
  });

  it('leaves the IRI alone when the document binds that prefix elsewhere', () => {
    const text = [
      'PREFIX schema: <http://example.org/private/>',
      'SELECT * WHERE { ?s <http://schema.org/name> ?o }',
    ].join('\n');
    const result = toPrefixedNames(text, PAIRS, SPARQL);

    expect(result.converted).toBe(0);
    expect(result.skippedShadowed).toBe(1);
    expect(result.text).toBe(text);
  });

  it('never rewrites the IRI of a declaration', () => {
    const text = 'PREFIX schema: <http://schema.org/>\nSELECT * WHERE { ?s ?p ?o }';
    expect(toPrefixedNames(text, PAIRS, SPARQL).text).toBe(text);
  });

  it('leaves IRIs inside string literals and comments alone', () => {
    const text = [
      '# see <http://schema.org/name> for the definition',
      'SELECT * WHERE { FILTER(STRSTARTS(?s, "<http://schema.org/name>")) }',
    ].join('\n');
    expect(toPrefixedNames(text, PAIRS, SPARQL).text).toBe(text);
  });

  it('leaves a less-than operator alone', () => {
    const text = 'SELECT * WHERE { ?s ?p ?o FILTER(?o < 5) }';
    expect(toPrefixedNames(text, PAIRS, SPARQL).text).toBe(text);
  });

  it('declines an IRI whose remainder would not parse as a local name', () => {
    const result = toPrefixedNames('SELECT * WHERE { ?s <http://schema.org/a/b> ?o }', PAIRS, SPARQL);
    expect(result.converted).toBe(0);
    expect(result.text).toContain('<http://schema.org/a/b>');
  });
});

describe('toFullIris', () => {
  it('rewrites a prefixed name', () => {
    const result = toFullIris('SELECT * WHERE { ?s schema:name ?o }', namespaceFor, SPARQL);
    expect(result.converted).toBe(1);
    expect(result.text).toContain('<http://schema.org/name>');
  });

  it('reads the document’s own declaration over the prefix manager', () => {
    const text = [
      'PREFIX schema: <http://example.org/private/>',
      'SELECT * WHERE { ?s schema:name ?o }',
    ].join('\n');

    expect(toFullIris(text, namespaceFor, SPARQL).text).toContain('<http://example.org/private/name>');
  });

  it('never rewrites the label of a declaration', () => {
    // A prefix the manager does not know, so the declaration survives the
    // sweep and its label is there to be checked.
    const text = 'PREFIX mine: <http://private.example/>\nSELECT * WHERE { ?s mine:name ?o }';
    const result = toFullIris(text, () => undefined, SPARQL);

    expect(result.text.split('\n')[0]).toBe('PREFIX mine: <http://private.example/>');
    expect(result.text).toContain('<http://private.example/name>');
  });

  it('leaves blank node labels alone', () => {
    const text = 'SELECT * WHERE { _:b0 schema:name ?o }';
    expect(toFullIris(text, namespaceFor, SPARQL).text).toContain('_:b0');
  });

  it('leaves prefixed names inside literals and comments alone', () => {
    const text = [
      '# schema:name is the one we want',
      'SELECT * WHERE { FILTER(?s = "schema:name") }',
    ].join('\n');
    expect(toFullIris(text, namespaceFor, SPARQL).text).toBe(text);
  });

  it('leaves an unknown prefix alone', () => {
    const text = 'SELECT * WHERE { ?s nope:name ?o }';
    expect(toFullIris(text, namespaceFor, SPARQL).text).toBe(text);
  });

  it('keeps a statement-terminating dot out of the local name', () => {
    const result = toFullIris('CONSTRUCT { ?s schema:name ?o. }', namespaceFor, SPARQL);
    expect(result.text).toContain('<http://schema.org/name> ?o.');
  });

  it('round-trips with toPrefixedNames', () => {
    const original = 'PREFIX schema: <http://schema.org/>\nSELECT * WHERE { ?s schema:name ?o }';
    const expanded = toFullIris(original, namespaceFor, SPARQL).text;

    expect(expanded).not.toBe(original);
    expect(toPrefixedNames(expanded, PAIRS, SPARQL).text).toBe(original);
  });

  it('reports the declarations it swept', () => {
    const text = 'PREFIX schema: <http://schema.org/>\nSELECT * WHERE { ?s schema:name ?o }';
    expect(toFullIris(text, namespaceFor, SPARQL).removed)
      .toEqual([{ prefix: 'schema', namespace: 'http://schema.org/' }]);
  });
});

describe('readDeclaredPrefixes', () => {
  it('reads SPARQL and Turtle declarations', () => {
    const declared = readDeclaredPrefixes(
      '@prefix b: <http://b.example/> .\nPREFIX a: <http://a.example/>\n',
      TURTLE,
    );

    expect(declared.get('a')).toBe('http://a.example/');
    expect(declared.get('b')).toBe('http://b.example/');
  });

  it('lets a later declaration win, the way a processor does', () => {
    const declared = readDeclaredPrefixes(
      'PREFIX a: <http://first.example/>\nPREFIX a: <http://second.example/>\n',
      SPARQL,
    );
    expect(declared.get('a')).toBe('http://second.example/');
  });
});

describe('addDeclarations', () => {
  const EX: PrefixPair = { prefix: 'ex', namespace: 'http://example.org/' };
  const SCHEMA: PrefixPair = { prefix: 'schema', namespace: 'http://schema.org/' };

  it('puts the new declarations below the ones already there', () => {
    const text = 'PREFIX a: <http://a.example/>\nSELECT * WHERE { ?s ?p ?o }';

    const result = addDeclarations(text, [EX], SPARQL);

    expect(result.text).toBe(
      'PREFIX a: <http://a.example/>\nPREFIX ex: <http://example.org/>\nSELECT * WHERE { ?s ?p ?o }',
    );
    expect(result.added).toEqual([EX]);
    expect(result.skipped).toEqual([]);
  });

  it('declares above a document that declares nothing', () => {
    const result = addDeclarations('SELECT * WHERE { ?s ?p ?o }', [EX, SCHEMA], SPARQL);

    expect(result.text).toBe(
      'PREFIX ex: <http://example.org/>\nPREFIX schema: <http://schema.org/>\nSELECT * WHERE { ?s ?p ?o }',
    );
  });

  /*
   * The one thing this must not do: a prefix the document has bound already
   * names things in it, and rebinding it would repoint every one of them.
   */
  it('leaves a prefix the document has already bound, whatever it is bound to', () => {
    const text = 'PREFIX ex: <http://mine.example/>\nSELECT * WHERE { ?s ex:p ?o }';

    const result = addDeclarations(text, [EX, SCHEMA], SPARQL);

    expect(result.text).toContain('PREFIX ex: <http://mine.example/>');
    expect(result.text).not.toContain('http://example.org/');
    expect(result.added).toEqual([SCHEMA]);
    expect(result.skipped).toEqual([EX]);
  });

  it('changes nothing below the prologue', () => {
    const body = 'CONSTRUCT { ?s ?p ?o } WHERE { ?s ?p ?o }';

    expect(addDeclarations(body, [EX], SPARQL).text.endsWith(body)).toBe(true);
  });

  it('reads an SRL document with SRL\'s own grammar', () => {
    const text = 'PREFIX a: <http://a.example/>\nRULE { ?s a:q ?o } WHERE { ?s a:p ?o }';

    const result = addDeclarations(text, [EX], SRL);

    expect(result.text).toContain('PREFIX ex: <http://example.org/>');
    expect(result.added).toEqual([EX]);
  });

  it('leaves the document alone when there is nothing to add', () => {
    const text = 'PREFIX ex: <http://example.org/>\nSELECT * WHERE { ?s ?p ?o }';

    expect(addDeclarations(text, [EX], SPARQL).text).toBe(text);
  });
});

describe('the grammar a document is converted against', () => {
  /*
   * The reason the rewrite takes a parser instead of finding one: only a
   * grammar that actually describes the document may be used, because
   * approximate colouring is free and an approximate rewrite corrupts the
   * document.
   *
   * The case that established the rule was SRL under the SPARQL grammar, which
   * had no ':=' and read the ':' of an assignment as a prefix label. That
   * particular hazard is gone now the grammars share a lexer — see the case
   * below — but the rule it bought is not, and TriG is the standing example:
   * SRL is converted against SRL's grammar, not against something close to it.
   */
  it('gives SRL its own parser, now that the corpus below covers it', () => {
    expect(prefixGrammarFor('application/srl')).toBe(SRL);
    expect(prefixGrammarFor('text/srl')).toBe(SRL);
  });

  /*
   * The hazard this rule was written for is gone, and it is worth recording
   * which one.
   *
   * SRL used to be rewritten against the *SPARQL* grammar, which has no `:=`
   * and so read the ':' of an assignment as an empty prefix label — expanding
   * it turned `SET ( ?k := 1 )` into `SET ( ?k <http://example/>= 1 )`, a
   * silently corrupted document. That is why `prefixGrammarFor` returns null
   * for SRL.
   *
   * The three published grammars share one lexer, so `:=` is a single token in
   * SPARQL's too and the corruption no longer happens. SRL is still converted
   * against its own grammar rather than this one — the rule above — and the
   * evidence for turning its buttons on is the corpus at the foot of this file.
   */
  it('no longer corrupts an SRL assignment, now that the grammars share a lexer', () => {
    const srl = 'PREFIX : <http://example/>\nRULE { ?x :b ?k } WHERE { SET ( ?k := 1 ) }';
    const result = toFullIris(srl, (p) => (p === '' ? 'http://example/' : undefined), SPARQL);

    expect(result.text).not.toContain('<http://example/>=');
    expect(result.text).toContain(':= 1');
  });

  it('is not offered for the line-based formats, which have no prefixes', () => {
    expect(prefixGrammarFor('application/n-triples')).toBeNull();
    expect(prefixGrammarFor('application/n-quads')).toBeNull();
  });

  it('is offered for SPARQL and Turtle', () => {
    expect(prefixGrammarFor('application/sparql-query')).toBe(SPARQL);
    expect(prefixGrammarFor('application/sparql-update')).toBe(SPARQL);
    expect(prefixGrammarFor('text/turtle')).toBe(TURTLE);
    expect(prefixGrammarFor('text/turtle; charset=utf-8')).toBe(TURTLE);
  });

  it('gives TriG its own parser rather than borrowing Turtle\'s', () => {
    /*
     * They were the same answer while one Lezer grammar covered both. They are
     * not any more, and a rewrite may not be approximate: the Turtle grammar
     * reads `GRAPH <g> { … }` as an error, so every term inside a named graph
     * would be invisible to the walk and silently left unconverted.
     */
    const trig = prefixGrammarFor('application/trig');

    expect(trig).not.toBeNull();
    expect(trig).not.toBe(TURTLE);
  });
});

describe('Turtle documents', () => {
  it('shortens an IRI and reads @prefix declarations', () => {
    const text = '@prefix foaf: <http://xmlns.com/foaf/0.1/> .\nfoaf:a foaf:knows <http://schema.org/b> .';
    const result = toPrefixedNames(text, PAIRS, TURTLE);

    expect(result.converted).toBe(1);
    expect(result.text).toContain('schema:b');
  });

  it('never rewrites the IRI of an @prefix line', () => {
    const text = '@prefix schema: <http://schema.org/> .\n<http://schema.org/a> a schema:Thing .';
    const result = toPrefixedNames(text, PAIRS, TURTLE);

    expect(result.text.split('\n')[0]).toBe('@prefix schema: <http://schema.org/> .');
    expect(result.text).toContain('schema:a a schema:Thing');
  });
});

describe('a document being typed', () => {
  /*
   * The editor holds invalid text most of the time. Lezer's error recovery is
   * what makes a tree walk usable here at all: terms outside the broken region
   * still convert, and terms inside it are missed rather than mangled.
   */
  it('converts what it can around a syntax error', () => {
    const halfTyped = 'SELECT * WHERE { ?s <http://schema.org/name> ?o . ?s foaf:knows';
    const result = toPrefixedNames(halfTyped, PAIRS, SPARQL);

    expect(result.converted).toBe(1);
    expect(result.text).toContain('schema:name');
    expect(result.text).toContain('?s foaf:knows');
  });
});

describe('bare prefix labels', () => {
  it('expands "foaf:" and ":", which denote IRIs too', () => {
    const text = 'PREFIX : <http://example/>\nSELECT * WHERE { ?s : ?o }';
    const result = toFullIris(text, namespaceFor, SPARQL);

    expect(result.converted).toBe(1);
    expect(result.text).toContain('?s <http://example/> ?o');
    expect(result.text.split('\n')[0]).toBe('PREFIX : <http://example/>');
  });
});

describe('expansion sweeps the declarations it emptied', () => {
  /*
   * The reported case: expanding left `PREFIX ex: <http://example.org/>` above
   * a body that no longer mentions `ex`.
   */
  it('removes a declaration nothing uses any more', () => {
    const text = [
      'PREFIX ex: <http://example.org/>',
      'CONSTRUCT { ex:a ex:b ex:c } WHERE {}',
    ].join('\n');

    const result = toFullIris(text, (p) => (p === 'ex' ? 'http://example.org/' : undefined), SPARQL);

    expect(result.text).toBe('CONSTRUCT { <http://example.org/a> <http://example.org/b> <http://example.org/c> } WHERE {}');
    expect(result.removed).toEqual([{ prefix: 'ex', namespace: 'http://example.org/' }]);
  });

  it('takes the whole Turtle directive, trailing dot and all', () => {
    const text = '@prefix ex: <http://example.org/> .\nex:a ex:b ex:c .';
    const result = toFullIris(text, (p) => (p === 'ex' ? 'http://example.org/' : undefined), TURTLE);

    expect(result.text).toBe('<http://example.org/a> <http://example.org/b> <http://example.org/c> .');
  });

  /*
   * The safety rule. A prefix the manager has never seen is only recorded in
   * this document, so removing its declaration would destroy the binding —
   * and contracting could not put it back.
   */
  it('keeps a declaration the prefix manager could not put back', () => {
    const text = 'PREFIX mine: <http://private.example/>\nSELECT * WHERE { ?s mine:p ?o }';
    const result = toFullIris(text, () => undefined, SPARQL);

    expect(result.text).toContain('PREFIX mine: <http://private.example/>');
    expect(result.text).toContain('<http://private.example/p>');
    expect(result.removed).toEqual([]);
  });

  it('keeps a declaration the manager binds differently', () => {
    const text = 'PREFIX schema: <http://example.org/private/>\nSELECT * WHERE { ?s schema:name ?o }';
    const result = toFullIris(text, namespaceFor, SPARQL);

    expect(result.text).toContain('PREFIX schema: <http://example.org/private/>');
    expect(result.text).toContain('<http://example.org/private/name>');
  });

  it('never touches BASE, which changes what relative IRIs mean', () => {
    const text = 'BASE <http://base.example/>\nPREFIX schema: <http://schema.org/>\nSELECT * WHERE { ?s schema:name ?o }';
    const result = toFullIris(text, namespaceFor, SPARQL);

    expect(result.text).toContain('BASE <http://base.example/>');
    expect(result.text).not.toContain('PREFIX schema:');
  });

  it('sweeps nothing when there was nothing to expand', () => {
    const text = 'PREFIX schema: <http://schema.org/>\nSELECT * WHERE { ?s ?p ?o }';
    expect(toFullIris(text, namespaceFor, SPARQL).text).toBe(text);
  });

  it('still round-trips: contracting re-declares what expanding swept', () => {
    const original = 'PREFIX schema: <http://schema.org/>\nSELECT * WHERE { ?s schema:name ?o }';
    const expanded = toFullIris(original, namespaceFor, SPARQL);

    expect(expanded.text).not.toContain('PREFIX');
    expect(toPrefixedNames(expanded.text, PAIRS, SPARQL).text).toBe(original);
  });
});

describe('contraction never invents a prefix', () => {
  /*
   * The ns1:/ns2: behaviour of RDF serialisers, deliberately not copied. An
   * IRI whose namespace nobody has named stays a full IRI.
   */
  it('leaves an unregistered namespace as a full IRI', () => {
    const text = 'SELECT * WHERE { ?s <http://nobody.example/registered/name> ?o }';
    const result = toPrefixedNames(text, PAIRS, SPARQL);

    expect(result.text).toBe(text);
    expect(result.converted).toBe(0);
    expect(result.added).toEqual([]);
    expect(result.text).not.toMatch(/\bns\d+:/);
  });

  it('abbreviates only what the manager names, leaving the rest long', () => {
    const text = 'SELECT * WHERE { ?s <http://schema.org/name> <http://nobody.example/x/y> }';
    const result = toPrefixedNames(text, PAIRS, SPARQL);

    expect(result.text).toContain('schema:name');
    expect(result.text).toContain('<http://nobody.example/x/y>');
    expect(result.added).toEqual([{ prefix: 'schema', namespace: 'http://schema.org/' }]);
  });
});

/**
 * SRL documents: the round-trip evidence the rules editor's buttons rest on.
 *
 * A rule set is not a query with different keywords — it has DATA blocks,
 * `NOT DATA` blocks, `TUPLE( … )` terms and an assignment operator that spells
 * itself with a colon. Each of those is a place where a rewrite could either
 * miss terms it should convert or touch text it must not, so each has a case
 * here rather than being assumed from the SPARQL corpus above.
 */
describe('SRL documents', () => {
  const SRL_PAIRS: PrefixPair[] = [
    { prefix: 'foaf', namespace: 'http://xmlns.com/foaf/0.1/' },
    { prefix: 'ex', namespace: 'http://example.org/' },
  ];
  const srlNamespaceFor = (prefix: string) =>
    SRL_PAIRS.find((p) => p.prefix === prefix)?.namespace;

  const DOCUMENT = [
    'PREFIX ex: <http://example.org/>',
    '',
    'DATA { ex:alice <http://xmlns.com/foaf/0.1/knows> ex:bob }',
    '',
    'RULE { ?x <http://example.org/ancestor> ?z }',
    'WHERE { ?x ex:parent ?y . ?y ex:parent ?z }',
  ].join('\n');

  it('shortens IRIs in a rule head and in a DATA block', () => {
    const result = toPrefixedNames(DOCUMENT, SRL_PAIRS, SRL);

    expect(result.converted).toBe(2);
    expect(result.text).toContain('DATA { ex:alice foaf:knows ex:bob }');
    expect(result.text).toContain('RULE { ?x ex:ancestor ?z }');
    expect(result.text).toContain('PREFIX foaf: <http://xmlns.com/foaf/0.1/>');
  });

  it('expands every prefixed name and sweeps the declaration it emptied', () => {
    const result = toFullIris(DOCUMENT, srlNamespaceFor, SRL);

    expect(result.text).toContain('<http://example.org/alice> <http://xmlns.com/foaf/0.1/knows>');
    expect(result.text).toContain('?x <http://example.org/parent> ?y');
    expect(result.removed).toEqual([{ prefix: 'ex', namespace: 'http://example.org/' }]);
  });

  /*
   * From a document already written in prefixed names, so the trip has a fixed
   * point to come back to. `DOCUMENT` above deliberately mixes the two forms,
   * and contracting it yields something shorter than it started as — correct,
   * but not a round trip.
   */
  it('round-trips a whole rule set', () => {
    const prefixed = [
      'PREFIX ex: <http://example.org/>',
      'PREFIX foaf: <http://xmlns.com/foaf/0.1/>',
      '',
      'DATA { ex:alice foaf:knows ex:bob }',
      '',
      'RULE { ?x ex:ancestor ?z }',
      'WHERE { ?x ex:parent ?y . ?y ex:parent ?z }',
    ].join('\n');

    const expanded = toFullIris(prefixed, srlNamespaceFor, SRL);
    const back = toPrefixedNames(expanded.text, SRL_PAIRS, SRL);

    expect(expanded.text).not.toContain('ex:');
    expect(back.text.trim()).toBe(prefixed.trim());
  });

  /*
   * The hazard the buttons were held back for. `SET ( ?k := 1 )` is an
   * assignment, not a prefixed name, and a walk that read it as one would
   * write `?k <http://example.org/>= 1` — a document that no longer parses.
   */
  it('leaves an assignment operator alone in both directions', () => {
    const text = 'PREFIX ex: <http://example.org/>\nRULE { ?x ex:b ?k } WHERE { SET ( ?k := 1 ) }';

    expect(toFullIris(text, srlNamespaceFor, SRL).text).toContain('SET ( ?k := 1 )');
    expect(toPrefixedNames(text, SRL_PAIRS, SRL).text).toContain('SET ( ?k := 1 )');
  });

  it('converts the terms of a TUPLE, in a head and in a body', () => {
    const text = [
      'PREFIX ex: <http://example.org/>',
      'RULE { TUPLE(ex:a, ?b) } WHERE { TUPLE(<http://example.org/c>, ?b) }',
    ].join('\n');

    expect(toPrefixedNames(text, SRL_PAIRS, SRL).text).toContain('TUPLE(ex:c, ?b)');
    expect(toFullIris(text, srlNamespaceFor, SRL).text)
      .toContain('TUPLE(<http://example.org/a>, ?b)');
  });

  it('reaches inside a NOT DATA block', () => {
    const text = 'PREFIX ex: <http://example.org/>\nRULE { ?x ex:f true } WHERE { NOT DATA { ?x ex:ok ?o } }';

    expect(toFullIris(text, srlNamespaceFor, SRL).text).toContain('NOT DATA { ?x <http://example.org/ok> ?o }');
  });

  it('leaves IRIs in comments and string literals alone', () => {
    const text = [
      'PREFIX ex: <http://example.org/>',
      '# see <http://example.org/spec>',
      'RULE { ?x ex:f "<http://example.org/lit>" } WHERE { ?x ex:ok ?o }',
    ].join('\n');
    const expanded = toFullIris(text, srlNamespaceFor, SRL).text;

    expect(expanded).toContain('# see <http://example.org/spec>');
    expect(expanded).toContain('"<http://example.org/lit>"');
  });
});
