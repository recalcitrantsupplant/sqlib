import { describe, expect, it } from 'vitest';
import { readDocumentManifest, readEvalManifest } from './w3cManifest.js';

const PROLOGUE = `PREFIX :     <manifest#>
PREFIX rdf:  <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
@prefix mf:  <http://www.w3.org/2001/sw/DataAccess/tests/test-manifest#> .
PREFIX srlt: <http://www.w3.org/ns/sparql-rl-tests#>
`;

describe('W3C manifest reader', () => {
  it('reads an entry whatever order its properties come in', () => {
    // The regular expression this replaced required type, name, action, in
    // that order; these two entries were invisible to it.
    const entries = readDocumentManifest(`${PROLOGUE}
<> a mf:Manifest ; mf:entries ( :t1 :t2 ) .
:t1 mf:action <ok-01.srl> ; mf:name "ok-01.srl" ; rdf:type srlt:RulesPositiveSyntaxTest .
:t2 mf:name "bad-01.srl" ;   # a comment, with a # in <#> it
    a srlt:RulesNegativeSyntaxTest ;
    mf:action <bad-01.srl> ; .
`);
    expect(entries).toEqual([
      { name: 'ok-01.srl', positive: true, file: 'ok-01.srl' },
      { name: 'bad-01.srl', positive: false, file: 'bad-01.srl' },
    ]);
  });

  it('runs only what mf:entries lists, in its order', () => {
    const entries = readEvalManifest(`${PROLOGUE}
<#> rdf:type mf:Manifest ; mf:entries ( :b :a ) .
:a mf:result <a-results.ttl> ; rdf:type srlt:RulesEvalTest ; mf:name "A" ;
   mf:action [ srlt:data <a-data.ttl> ; srlt:ruleset <a.srl> ] .
:b rdf:type srlt:RulesEvalTest ; mf:name "B" ;
   mf:action [ srlt:ruleset <b.srl> ; srlt:data <b-data.ttl> ; ] ; mf:result <b-results.ttl> .
:unlisted rdf:type srlt:RulesEvalTest ; mf:name "C" ;
   mf:action [ srlt:ruleset <missing.srl> ; srlt:data <missing.ttl> ] ; mf:result <missing.ttl> .
`);
    expect(entries.map((e) => [e.name, e.ruleset, e.data, e.result])).toEqual([
      ['B', 'b.srl', 'b-data.ttl', 'b-results.ttl'],
      ['A', 'a.srl', 'a-data.ttl', 'a-results.ttl'],
    ]);
  });

  it('fails on an entry it cannot read rather than dropping it', () => {
    expect(() => readDocumentManifest(`${PROLOGUE}
<> a mf:Manifest ; mf:entries ( :t1 ) .
:t1 rdf:type srlt:RulesPositiveSyntaxTest ; mf:action <x.srl> .
`)).toThrow(/0 values for .*name/);
  });
});
