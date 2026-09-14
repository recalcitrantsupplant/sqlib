/**
 * The set arithmetic of §4.2, and the diagnostics that hang off it.
 *
 * The equivalence suite proves the patch reaches the right *state*; it cannot
 * tell an exact patch from one that says "delete this triple" about a triple
 * that was never there. That distinction is the whole value of a preview, so it
 * gets its own tests.
 */

import { describe, expect, it } from 'vitest';
import { patchFor, storeFrom } from './support/harness.js';

const DATA = `
<http://ex/a> <http://ex/p> <http://ex/b> .
<http://ex/c> <http://ex/p> <http://ex/d> .
`;

describe('net effect', () => {
  it('drops a deletion of a triple that is not there', async () => {
    const patch = await patchFor(
      storeFrom(DATA),
      'DELETE DATA { <http://ex/a> <http://ex/p> <http://ex/b> . <http://ex/nope> <http://ex/p> <http://ex/o> }',
    );

    expect(patch.deletionCount).toBe(1);
    // The raw count is what makes "you asked to delete 2, 1 existed" sayable.
    expect(patch.rawDeleteCount).toBe(2);
  });

  it('drops an insertion of a triple that is already there', async () => {
    const patch = await patchFor(
      storeFrom(DATA),
      'INSERT DATA { <http://ex/a> <http://ex/p> <http://ex/b> . <http://ex/new> <http://ex/p> <http://ex/o> }',
    );

    expect(patch.additionCount).toBe(1);
    expect(patch.rawInsertCount).toBe(2);
  });

  it('leaves a triple that is deleted and re-inserted by the same operation alone', async () => {
    const patch = await patchFor(
      storeFrom(DATA),
      'DELETE { ?s <http://ex/p> ?o } INSERT { ?s <http://ex/p> ?o } WHERE { ?s <http://ex/p> ?o }',
    );

    expect(patch.deletionCount).toBe(0);
    expect(patch.additionCount).toBe(0);
    expect(patch.rawDeleteCount).toBe(2);
    expect(patch.rawInsertCount).toBe(2);
  });

  it('cancels an insert and a later delete of the same triple across a program', async () => {
    const patch = await patchFor(
      storeFrom(DATA),
      'INSERT DATA { <http://ex/new> <http://ex/p> <http://ex/o> } ; DELETE DATA { <http://ex/new> <http://ex/p> <http://ex/o> }',
    );

    expect(patch.additionCount).toBe(0);
    expect(patch.deletionCount).toBe(0);
  });

  it('cancels a delete and a later re-insert of the same triple across a program', async () => {
    const patch = await patchFor(
      storeFrom(DATA),
      'DELETE DATA { <http://ex/a> <http://ex/p> <http://ex/b> } ; INSERT DATA { <http://ex/a> <http://ex/p> <http://ex/b> }',
    );

    expect(patch.additionCount).toBe(0);
    expect(patch.deletionCount).toBe(0);
  });

  it('does not confuse a triple in a named graph with the same triple in the default graph', async () => {
    const store = storeFrom('<http://ex/a> <http://ex/p> <http://ex/b> <http://ex/g> .');

    const patch = await patchFor(store, 'DELETE DATA { <http://ex/a> <http://ex/p> <http://ex/b> }');

    expect(patch.deletionCount).toBe(0);
  });

  it('compares terms, not the text they were written as', async () => {
    // `:b` and `<http://ex/b>` are the same IRI; a set keyed on rendered source
    // text would see two — the class of bug issue #165 documents.
    const patch = await patchFor(
      storeFrom(DATA),
      'PREFIX : <http://ex/> DELETE DATA { :a :p :b }',
    );

    expect(patch.deletionCount).toBe(1);
  });

  it('treats an integer literal and its lexical form as the same term', async () => {
    const store = storeFrom('<http://ex/a> <http://ex/q> "1"^^<http://www.w3.org/2001/XMLSchema#integer> .');

    const patch = await patchFor(store, 'DELETE DATA { <http://ex/a> <http://ex/q> 1 }');

    expect(patch.deletionCount).toBe(1);
  });

  it('reports a patch carrying blank nodes as store-apply only', async () => {
    const patch = await patchFor(
      storeFrom(DATA),
      'INSERT { ?s <http://ex/about> [ <http://ex/of> ?o ] } WHERE { ?s <http://ex/p> ?o }',
    );

    expect(patch.containsBlankNodes).toBe(true);
    expect(patch.applyMode).toBe('store');
    expect(patch.revertible).toBe(false);
  });

  it('is exact against a store that can answer membership for blank nodes', async () => {
    const patch = await patchFor(
      storeFrom('<http://ex/e> <http://ex/p> _:shared .\n_:shared <http://ex/q> "nested" .'),
      'DELETE WHERE { ?s <http://ex/q> "nested" }',
    );

    expect(patch.netEffectExact).toBe(true);
    expect(patch.deletionCount).toBe(1);
  });
});

describe('honesty about what could not be checked', () => {
  it('flags a blank-node deletion it could not test for membership', async () => {
    const patch = await patchFor(
      storeFrom('<http://ex/e> <http://ex/p> _:shared .\n_:shared <http://ex/q> "nested" .'),
      'DELETE WHERE { ?s <http://ex/q> "nested" }',
      { membership: 'sparql-only' },
    );

    // The quad is kept — it came out of the store, so the end state is right —
    // but nothing verified that, and the patch says so rather than implying an
    // exactness it does not have.
    expect(patch.deletionCount).toBe(1);
    expect(patch.netEffectExact).toBe(false);
  });

  it('stays exact when nothing blank-node-shaped is in the way', async () => {
    const patch = await patchFor(storeFrom(DATA), 'DELETE WHERE { ?s <http://ex/p> ?o }', { membership: 'sparql-only' });

    expect(patch.netEffectExact).toBe(true);
    expect(patch.deletionCount).toBe(2);
  });
});
