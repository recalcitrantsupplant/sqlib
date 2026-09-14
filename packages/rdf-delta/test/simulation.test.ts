/**
 * Multi-operation programs, where operation N reads what N−1 wrote.
 *
 * The set arithmetic in `derive.ts` composes a program on its own, but only for
 * operations that do not *see* each other: `INSERT DATA` and `DELETE DATA`
 * sequences compose because neither one's result depends on the store. The
 * moment a `WHERE` reads a graph an earlier operation touched, deriving it
 * against the store as it stands is simply the wrong evaluation — so the
 * program is replayed on a fork, one operation at a time, and each derivation
 * happens against the state its predecessors left.
 *
 * The oracle is the same as everywhere else, and it is what makes this testable
 * at all: execute the program directly, apply the derived patch to an identical
 * store, compare canonical forms. A simulation that drifted from SPARQL's own
 * ordering would show up here as a mismatch rather than as a subtly wrong patch
 * somebody applied.
 */

import { describe, expect, it } from 'vitest';
import { assertEquivalent, patchFor, storeFrom, type EquivalenceCase } from './support/harness.js';

const DATA = `
<http://ex/a> <http://ex/p> <http://ex/b> .
<http://ex/c> <http://ex/p> <http://ex/d> .
<http://ex/a> <http://ex/name> "Alice" .
<http://ex/x> <http://ex/p> <http://ex/y> <http://ex/g1> .
<http://ex/m> <http://ex/p> <http://ex/n> <http://ex/g2> .
`;

const PROGRAMS: EquivalenceCase[] = [
  {
    name: 'a WHERE that reads what the previous operation inserted',
    data: DATA,
    update:
      'INSERT DATA { <http://ex/new> <http://ex/p> <http://ex/o> } ; DELETE WHERE { ?s <http://ex/p> ?o }',
  },
  {
    name: 'a WHERE that reads what the previous operation deleted',
    data: DATA,
    update:
      'DELETE DATA { <http://ex/a> <http://ex/p> <http://ex/b> } ; INSERT { ?s <http://ex/seen> ?o } WHERE { ?s <http://ex/p> ?o }',
  },
  {
    name: 'a copy-then-remove pair over the same pattern',
    data: DATA,
    update:
      'INSERT { ?s <http://ex/q> ?o } WHERE { ?s <http://ex/p> ?o } ; DELETE { ?s <http://ex/p> ?o } WHERE { ?s <http://ex/p> ?o }',
  },
  {
    name: 'an operation that undoes the previous one entirely',
    data: DATA,
    update:
      'INSERT DATA { <http://ex/tmp> <http://ex/p> <http://ex/o> } ; DELETE WHERE { <http://ex/tmp> <http://ex/p> ?o }',
  },
  {
    name: 'three operations, each reading the last',
    data: DATA,
    update:
      'INSERT { ?s <http://ex/step1> ?o } WHERE { ?s <http://ex/p> ?o } ; ' +
      'INSERT { ?s <http://ex/step2> ?o } WHERE { ?s <http://ex/step1> ?o } ; ' +
      'DELETE WHERE { ?s <http://ex/step1> ?o }',
  },
  {
    name: 'a named graph filled and then read back',
    data: DATA,
    update:
      'INSERT { GRAPH <http://ex/g3> { ?s <http://ex/p> ?o } } WHERE { ?s <http://ex/p> ?o } ; ' +
      'DELETE { GRAPH <http://ex/g3> { ?s ?p ?o } } WHERE { GRAPH <http://ex/g3> { ?s ?p <http://ex/d> } }',
  },
  {
    name: 'WITH followed by an operation over the same graph',
    data: DATA,
    update:
      'WITH <http://ex/g1> INSERT { ?s <http://ex/q> ?o } WHERE { ?s <http://ex/p> ?o } ; ' +
      'WITH <http://ex/g1> DELETE { ?s <http://ex/p> ?o } WHERE { ?s <http://ex/q> ?o }',
  },
  {
    name: 'a graph operation whose effect the next operation reads',
    data: DATA,
    update:
      'CLEAR GRAPH <http://ex/g1> ; INSERT { GRAPH <http://ex/g1> { ?s ?p ?o } } WHERE { GRAPH <http://ex/g2> { ?s ?p ?o } }',
    enumerateGraphOps: true,
  },
  {
    name: 'a MOVE that a later operation reads the destination of',
    data: DATA,
    update:
      'MOVE <http://ex/g2> TO <http://ex/g1> ; DELETE WHERE { GRAPH <http://ex/g1> { ?s <http://ex/p> ?o } }',
    enumerateGraphOps: true,
  },
  /*
   * A prologue written once, at the top, and relied on by every operation after
   * it — which is what anybody actually types, and what every case above
   * happens to avoid by spelling out full IRIs. `Update` is recursive in the
   * grammar, so those declarations stay in scope; the AST hangs them off the
   * first unit only, and planning each unit from its own context left operation
   * two deriving and replaying prefixed names with nothing to resolve them
   * against.
   */
  {
    name: 'one prologue at the top of a two-operation program',
    data: DATA,
    update:
      'PREFIX ex: <http://ex/> ' +
      'INSERT DATA { ex:new ex:p ex:o } ; ' +
      'DELETE { ?s ex:p ?o } INSERT { ?s ex:q ?o } WHERE { ?s ex:p ?o }',
  },
  {
    name: 'a prologue inherited through a GRAPH block and a WITH',
    data: DATA,
    update:
      'PREFIX ex: <http://ex/> ' +
      'INSERT { GRAPH ex:g3 { ?s ex:p ?o } } WHERE { ?s ex:p ?o } ; ' +
      'WITH ex:g3 DELETE { ?s ex:p ?o } WHERE { ?s ex:p ex:d }',
  },
  {
    name: 'a BASE at the top that a later operation resolves against',
    data: DATA,
    update:
      'BASE <http://ex/> ' +
      'INSERT DATA { <based> <p> <o> } ; ' +
      'DELETE WHERE { <based> <p> ?o }',
  },
];

describe('simulating a program reaches the same store as running it', () => {
  it.each(PROGRAMS.map((testCase) => [testCase.name, testCase] as const))('%s', async (_name, testCase) => {
    await expect(assertEquivalent(testCase)).resolves.toBeDefined();
  });
});

describe('over a store that can only be asked SPARQL', () => {
  it.each(PROGRAMS.map((testCase) => [testCase.name, testCase] as const))('%s', async (_name, testCase) => {
    await expect(assertEquivalent({ ...testCase, membership: 'sparql-only' })).resolves.toBeDefined();
  });
});

describe('over an empty store', () => {
  it.each(PROGRAMS.map((testCase) => [testCase.name, testCase] as const))('%s', async (_name, testCase) => {
    // Every graph these programs name is either created by the program or
    // reached through `CLEAR`/`MOVE`, which Oxigraph raises on when absent —
    // so the graph-operation programs sit this one out for the same reason the
    // graph-op suite's do.
    if (testCase.enumerateGraphOps) return;
    await expect(assertEquivalent({ ...testCase, data: '' })).resolves.toBeDefined();
  });
});

describe('what the composed patch reports', () => {
  it('nets an operation away entirely when a later one undoes it', async () => {
    const patch = await patchFor(
      storeFrom(DATA),
      'INSERT DATA { <http://ex/tmp> <http://ex/p> <http://ex/o> } ; DELETE WHERE { <http://ex/tmp> <http://ex/p> ?o }',
    );
    expect(patch.additionCount).toBe(0);
    expect(patch.deletionCount).toBe(0);
    // The raw counts keep the fact that work was proposed, which is the half a
    // preview shows a human.
    expect(patch.rawInsertCount).toBe(1);
    expect(patch.rawDeleteCount).toBe(1);
  });

  it('leaves a counted graph operation counted while still deriving the rest', async () => {
    const patch = await patchFor(
      storeFrom(DATA),
      'CLEAR GRAPH <http://ex/g1> ; INSERT { GRAPH <http://ex/g3> { ?s ?p ?o } } WHERE { GRAPH <http://ex/g2> { ?s ?p ?o } }',
    );
    // The replay advances the fork with the operation as written, so the INSERT
    // is derived against a cleared `g1` even though the CLEAR itself was only
    // counted.
    expect(patch.graphOps[0]).toMatchObject({ form: 'clear', enumerated: false, affectedCount: 1 });
    expect(patch.additionCount).toBe(1);
    expect(patch.applyMode).toBe('graph-ops');
  });
});

describe('what simulation refuses', () => {
  it('refuses on a store it cannot fork, naming the operation', async () => {
    await expect(
      patchFor(
        storeFrom(DATA),
        'INSERT DATA { <http://ex/a> <http://ex/z> <http://ex/b> } ; DELETE WHERE { ?s <http://ex/z> ?o }',
        { simulation: 'none' },
      ),
    ).rejects.toThrow(/Operation 2 of 2 reads the store \(deletewhere\)/);
  });

  it('still composes a ground program on a store it cannot fork', async () => {
    // No operation reads anything, so there is nothing to simulate and the
    // refusal must not fire.
    await expect(
      assertEquivalent({
        name: 'ground program, no fork',
        data: DATA,
        update:
          'INSERT DATA { <http://ex/n> <http://ex/p> <http://ex/o> } ; DELETE DATA { <http://ex/a> <http://ex/p> <http://ex/b> }',
        simulation: 'none',
      }),
    ).resolves.toBeDefined();
  });

  it('refuses a simulated program whose patch would carry blank nodes', async () => {
    await expect(
      patchFor(
        storeFrom(DATA),
        'INSERT { ?s <http://ex/q> [] } WHERE { ?s <http://ex/p> ?o } ; DELETE WHERE { ?s <http://ex/never> ?o }',
      ),
    ).rejects.toThrow(/labels belong to the copy/);
  });

  it('leaves the original store untouched while simulating', async () => {
    const store = storeFrom(DATA);
    const before = store.dump({ format: 'application/n-quads' });
    await patchFor(
      store,
      'INSERT DATA { <http://ex/n> <http://ex/p> <http://ex/o> } ; DELETE WHERE { ?s <http://ex/p> ?o }',
    );
    expect(store.dump({ format: 'application/n-quads' })).toBe(before);
  });
});
