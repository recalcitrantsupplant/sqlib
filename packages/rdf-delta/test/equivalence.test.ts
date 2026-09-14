/**
 * The property that matters: for every supported update form, executing the
 * update and applying the derived patch reach the same store.
 *
 * Everything else in this package is an optimisation or a serialisation of
 * something this file has already proved correct.
 */

import { describe, expect, it } from 'vitest';
import { assertEquivalent, type EquivalenceCase } from './support/harness.js';

const DATA = `
<http://ex/a> <http://ex/p> <http://ex/b> .
<http://ex/a> <http://ex/q> "1"^^<http://www.w3.org/2001/XMLSchema#integer> .
<http://ex/c> <http://ex/p> <http://ex/d> .
<http://ex/a> <http://ex/name> "Alice" .
<http://ex/e> <http://ex/p> _:shared .
_:shared <http://ex/q> "nested" .
<http://ex/a> <http://ex/p> <http://ex/b> <http://ex/g1> .
<http://ex/x> <http://ex/p> <http://ex/y> <http://ex/g1> .
<http://ex/x> <http://ex/p> <http://ex/z> <http://ex/g2> .
`;

const CASES: EquivalenceCase[] = [
  {
    name: 'INSERT DATA, default graph',
    data: DATA,
    update: 'INSERT DATA { <http://ex/new> <http://ex/p> <http://ex/o> }',
  },
  {
    name: 'INSERT DATA with a prefix and a named graph',
    data: DATA,
    update: 'PREFIX : <http://ex/> INSERT DATA { :n :p :o . GRAPH :g1 { :n :p :o } }',
  },
  {
    name: 'INSERT DATA that is already present',
    data: DATA,
    update: 'INSERT DATA { <http://ex/a> <http://ex/p> <http://ex/b> }',
  },
  {
    name: 'DELETE DATA, present triple',
    data: DATA,
    update: 'DELETE DATA { <http://ex/a> <http://ex/p> <http://ex/b> }',
  },
  {
    name: 'DELETE DATA, absent triple',
    data: DATA,
    update: 'DELETE DATA { <http://ex/nope> <http://ex/p> <http://ex/o> }',
  },
  {
    name: 'DELETE DATA in a named graph',
    data: DATA,
    update: 'DELETE DATA { GRAPH <http://ex/g1> { <http://ex/x> <http://ex/p> <http://ex/y> } }',
  },
  {
    name: 'DELETE WHERE',
    data: DATA,
    update: 'DELETE WHERE { <http://ex/a> <http://ex/p> ?o }',
  },
  {
    name: 'DELETE WHERE matching blank nodes in the store',
    data: DATA,
    update: 'DELETE WHERE { ?s <http://ex/q> "nested" }',
  },
  {
    name: 'DELETE WHERE across a named graph',
    data: DATA,
    update: 'DELETE WHERE { GRAPH <http://ex/g1> { ?s <http://ex/p> ?o } }',
  },
  {
    name: 'INSERT WHERE',
    data: DATA,
    update: 'INSERT { ?s <http://ex/derived> ?o } WHERE { ?s <http://ex/p> ?o }',
  },
  {
    name: 'INSERT WHERE with a blank node in the template',
    data: DATA,
    update: 'INSERT { ?s <http://ex/about> [ <http://ex/of> ?o ] } WHERE { ?s <http://ex/p> ?o }',
  },
  {
    name: 'INSERT WHERE with no solutions',
    data: DATA,
    update: 'INSERT { ?s <http://ex/derived> ?o } WHERE { ?s <http://ex/absent> ?o }',
  },
  {
    name: 'DELETE/INSERT WHERE',
    data: DATA,
    update:
      'DELETE { ?s <http://ex/p> ?o } INSERT { ?s <http://ex/was> ?o } WHERE { ?s <http://ex/p> ?o }',
  },
  {
    name: 'DELETE/INSERT WHERE with overlapping templates',
    data: DATA,
    update:
      'DELETE { ?s <http://ex/p> ?o } INSERT { ?s <http://ex/p> ?o . ?s <http://ex/seen> "yes" } WHERE { ?s <http://ex/p> ?o }',
  },
  {
    name: 'DELETE/INSERT WHERE with a FILTER',
    data: DATA,
    update:
      'DELETE { ?s <http://ex/q> ?o } INSERT { ?s <http://ex/q> "2"^^<http://www.w3.org/2001/XMLSchema#integer> } WHERE { ?s <http://ex/q> ?o FILTER(?o < 5) }',
  },
  {
    name: 'WITH scopes the templates and the WHERE',
    data: DATA,
    update: 'WITH <http://ex/g1> DELETE { ?s <http://ex/p> ?o } INSERT { ?s <http://ex/moved> ?o } WHERE { ?s <http://ex/p> ?o }',
  },
  {
    name: 'WITH leaves explicit GRAPH blocks reachable',
    data: DATA,
    update:
      'WITH <http://ex/g1> INSERT { ?s <http://ex/alsoIn> ?g } WHERE { GRAPH ?g { ?s <http://ex/p> <http://ex/z> } }',
  },
  {
    name: 'USING overrides WITH for the WHERE clause',
    data: DATA,
    update:
      'WITH <http://ex/g1> INSERT { ?s <http://ex/copied> ?o } USING <http://ex/g2> WHERE { ?s <http://ex/p> ?o }',
  },
  {
    name: 'GRAPH block in the INSERT template',
    data: DATA,
    update:
      'INSERT { GRAPH <http://ex/g3> { ?s <http://ex/p> ?o } } WHERE { ?s <http://ex/p> ?o }',
  },
  {
    name: 'GRAPH block in the DELETE template',
    data: DATA,
    update:
      'DELETE { GRAPH <http://ex/g1> { ?s <http://ex/p> ?o } } WHERE { GRAPH <http://ex/g1> { ?s <http://ex/p> ?o } }',
  },
  {
    name: 'GRAPH ?var in the INSERT template',
    data: DATA,
    update:
      'INSERT { GRAPH ?g { ?s <http://ex/mirrored> ?o } } WHERE { GRAPH ?g { ?s <http://ex/p> ?o } }',
  },
  {
    name: 'GRAPH ?var in the DELETE template',
    data: DATA,
    update:
      'DELETE { GRAPH ?g { ?s <http://ex/p> ?o } } WHERE { GRAPH ?g { ?s <http://ex/p> ?o } }',
  },
  {
    name: 'a ground multi-operation program',
    data: DATA,
    update:
      'INSERT DATA { <http://ex/m> <http://ex/p> <http://ex/n> } ; DELETE DATA { <http://ex/a> <http://ex/p> <http://ex/b> } ; INSERT DATA { <http://ex/a> <http://ex/p> <http://ex/b> }',
  },
  {
    name: 'INSERT DATA minting a blank node',
    data: DATA,
    update: 'INSERT DATA { _:fresh <http://ex/p> <http://ex/o> . <http://ex/a> <http://ex/about> _:fresh }',
  },
  {
    name: 'a literal with a language tag',
    data: DATA,
    update: 'INSERT DATA { <http://ex/a> <http://ex/label> "bonjour"@fr }',
  },
  {
    name: 'a BASE-relative data block',
    data: DATA,
    update: 'BASE <http://ex/> INSERT DATA { <based> <p> <o> }',
  },
];

describe('extract-then-apply is indistinguishable from executing the update', () => {
  it.each(CASES.map((testCase) => [testCase.name, testCase] as const))('%s', async (_name, testCase) => {
    await expect(assertEquivalent(testCase)).resolves.toBeDefined();
  });
});

describe('through a store that can only be asked SPARQL', () => {
  // No exact membership test, so the net effect may overstate a blank-node
  // deletion — but the end state must still be identical, which is what the
  // HTTP-backend path depends on.
  it.each(CASES.map((testCase) => [testCase.name, testCase] as const))('%s', async (_name, testCase) => {
    await expect(assertEquivalent({ ...testCase, membership: 'sparql-only' })).resolves.toBeDefined();
  });
});

describe('over an empty store', () => {
  it.each(CASES.map((testCase) => [testCase.name, testCase] as const))('%s', async (_name, testCase) => {
    await expect(assertEquivalent({ ...testCase, data: '' })).resolves.toBeDefined();
  });
});
