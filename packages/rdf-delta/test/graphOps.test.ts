/**
 * Graph-management operations: counted by default, exact on request.
 *
 * Two properties, and they are different properties. The counted path is about
 * *honesty*: a patch that does not carry the quads a `DROP` removed must not
 * claim to be a diff anyone can apply or revert. The enumerated path is about
 * *exactness*, and gets the same oracle every other form does — execute the
 * update, apply the derived patch, compare canonical stores.
 *
 * One thing the oracle cannot see, and it is worth naming rather than
 * discovering: an *empty* named graph. N-Quads has no way to write one, so
 * `CREATE GRAPH <g>` and a `DROP` of an already-empty graph are invisible to a
 * dump-and-canonicalise comparison. That is exactly why the operations are
 * recorded in `graphOps` as well as reduced to quads — the record is the only
 * place that fact survives.
 */

import { describe, expect, it } from 'vitest';
import { EnumerationCapExceededError, UnsupportedUpdateError } from '../src/index.js';
import { assertEquivalent, patchFor, storeFrom, type EquivalenceCase } from './support/harness.js';

const DATA = `
<http://ex/a> <http://ex/p> <http://ex/b> .
<http://ex/c> <http://ex/p> <http://ex/d> .
<http://ex/x> <http://ex/p> <http://ex/y> <http://ex/g1> .
<http://ex/x> <http://ex/p> <http://ex/z> <http://ex/g1> .
<http://ex/m> <http://ex/p> <http://ex/n> <http://ex/g2> .
<http://ex/x> <http://ex/p> <http://ex/y> <http://ex/g2> .
`;

/**
 * `emptyStoreSafe` marks the cases whose operands still exist when the data is
 * gone — `DEFAULT`, `NAMED`, `ALL`, or a `SILENT` operand. The rest name a
 * graph, and SPARQL itself raises on a missing one, so running the oracle there
 * would be testing Oxigraph's error message rather than the rewrite.
 */
type GraphCase = EquivalenceCase & { emptyStoreSafe?: true };

const ENUMERATED: GraphCase[] = [
  { name: 'CLEAR a named graph', data: DATA, update: 'CLEAR GRAPH <http://ex/g1>' },
  { name: 'CLEAR DEFAULT', data: DATA, update: 'CLEAR DEFAULT', emptyStoreSafe: true },
  { name: 'CLEAR NAMED', data: DATA, update: 'CLEAR NAMED', emptyStoreSafe: true },
  { name: 'CLEAR ALL', data: DATA, update: 'CLEAR ALL', emptyStoreSafe: true },
  { name: 'DROP a named graph', data: DATA, update: 'DROP GRAPH <http://ex/g2>' },
  {
    name: 'DROP SILENT a graph that is not there',
    data: DATA,
    update: 'DROP SILENT GRAPH <http://ex/nope>',
    emptyStoreSafe: true,
  },
  {
    name: 'CREATE a graph',
    data: DATA,
    update: 'CREATE SILENT GRAPH <http://ex/fresh>',
    emptyStoreSafe: true,
  },
  { name: 'COPY between named graphs', data: DATA, update: 'COPY <http://ex/g1> TO <http://ex/g2>' },
  {
    name: 'COPY DEFAULT into a named graph',
    data: DATA,
    update: 'COPY DEFAULT TO GRAPH <http://ex/g1>',
    emptyStoreSafe: true,
  },
  { name: 'COPY a graph onto itself', data: DATA, update: 'COPY <http://ex/g1> TO <http://ex/g1>' },
  { name: 'MOVE between named graphs', data: DATA, update: 'MOVE <http://ex/g1> TO <http://ex/g2>' },
  { name: 'MOVE a named graph to DEFAULT', data: DATA, update: 'MOVE GRAPH <http://ex/g1> TO DEFAULT' },
  { name: 'ADD merges rather than replaces', data: DATA, update: 'ADD <http://ex/g1> TO <http://ex/g2>' },
  { name: 'ADD DEFAULT into a named graph', data: DATA, update: 'ADD DEFAULT TO GRAPH <http://ex/g2>' },
  {
    name: 'ADD from an empty graph',
    data: DATA,
    update: 'ADD SILENT <http://ex/empty> TO <http://ex/g1>',
    emptyStoreSafe: true,
  },
  {
    name: 'a graph operation followed by a data change',
    data: DATA,
    update: 'CLEAR GRAPH <http://ex/g1> ; INSERT DATA { GRAPH <http://ex/g1> { <http://ex/n> <http://ex/p> <http://ex/o> } }',
  },
  {
    name: 'a data change whose graph an earlier operation cleared',
    data: DATA,
    update:
      'INSERT DATA { GRAPH <http://ex/g3> { <http://ex/n> <http://ex/p> <http://ex/o> } } ; MOVE <http://ex/g3> TO <http://ex/g1>',
  },
];

describe('with enumeration, a graph operation is an ordinary quad diff', () => {
  it.each(ENUMERATED.map((testCase) => [testCase.name, testCase] as const))('%s', async (_name, testCase) => {
    const patch = await assertEquivalent({ ...testCase, enumerateGraphOps: true });
    expect(patch.graphOps.every((record) => record.enumerated)).toBe(true);
    expect(patch.applyMode).not.toBe('graph-ops');
  });
});

describe('with enumeration, over a store that can only be asked SPARQL', () => {
  it.each(ENUMERATED.map((testCase) => [testCase.name, testCase] as const))('%s', async (_name, testCase) => {
    await expect(
      assertEquivalent({ ...testCase, enumerateGraphOps: true, membership: 'sparql-only' }),
    ).resolves.toBeDefined();
  });
});

describe('with enumeration, over an empty store', () => {
  const cases = ENUMERATED.filter((testCase) => testCase.emptyStoreSafe);
  it.each(cases.map((testCase) => [testCase.name, testCase] as const))('%s', async (_name, testCase) => {
    await expect(
      assertEquivalent({ ...testCase, data: '', enumerateGraphOps: true }),
    ).resolves.toBeDefined();
  });
});

describe('without enumeration, a graph operation is counted and said so', () => {
  it('counts a DROP rather than reading the graph', async () => {
    const patch = await patchFor(storeFrom(DATA), 'DROP GRAPH <http://ex/g1>');
    expect(patch.graphOps).toEqual([
      {
        form: 'drop',
        silent: false,
        destination: { kind: 'iri', value: 'http://ex/g1' },
        affectedCount: 2,
        enumerated: false,
      },
    ]);
    expect(patch.deletionCount).toBe(0);
  });

  it('counts CLEAR ALL across the default graph and every named graph', async () => {
    const patch = await patchFor(storeFrom(DATA), 'CLEAR ALL');
    expect(patch.graphOps[0]?.affectedCount).toBe(6);
  });

  it('counts what COPY would move, which is the source graph', async () => {
    const patch = await patchFor(storeFrom(DATA), 'COPY <http://ex/g1> TO <http://ex/g2>');
    expect(patch.graphOps[0]).toMatchObject({
      form: 'copy',
      source: { kind: 'iri', value: 'http://ex/g1' },
      destination: { kind: 'iri', value: 'http://ex/g2' },
      affectedCount: 2,
      enumerated: false,
    });
  });

  it('refuses to call a counted patch applicable or revertible', async () => {
    const patch = await patchFor(storeFrom(DATA), 'CLEAR GRAPH <http://ex/g1>');
    expect(patch.applyMode).toBe('graph-ops');
    expect(patch.revertible).toBe(false);
    expect(patch.netEffectExact).toBe(false);
  });

  it('still expresses the data changes a program makes alongside a graph operation', async () => {
    const patch = await patchFor(
      storeFrom(DATA),
      'CREATE SILENT GRAPH <http://ex/g9> ; INSERT DATA { <http://ex/n> <http://ex/p> <http://ex/o> }',
    );
    expect(patch.additionCount).toBe(1);
    // CREATE moves no triples, so nothing about it is left unexpressed and the
    // patch stays a diff someone can apply.
    expect(patch.applyMode).toBe('ground-sparql');
    expect(patch.graphOps[0]).toMatchObject({ form: 'create', enumerated: true });
  });

  it('records a prefixed graph name as its absolute IRI', async () => {
    const patch = await patchFor(storeFrom(DATA), 'PREFIX ex: <http://ex/> DROP GRAPH ex:g1');
    expect(patch.graphOps[0]?.destination).toEqual({ kind: 'iri', value: 'http://ex/g1' });
  });
});

describe('what enumeration cannot do', () => {
  it('records LOAD but never derives it', async () => {
    const patch = await patchFor(storeFrom(DATA), 'LOAD <http://ex/doc> INTO GRAPH <http://ex/g1>');
    expect(patch.graphOps[0]).toMatchObject({
      form: 'load',
      document: 'http://ex/doc',
      affectedCount: null,
      enumerated: false,
    });
    expect(patch.applyMode).toBe('graph-ops');
  });

  it('refuses to enumerate a LOAD, saying why', async () => {
    await expect(
      patchFor(storeFrom(DATA), 'LOAD <http://ex/doc>', { enumerateGraphOps: true }),
    ).rejects.toThrow(/outside the dataset/);
  });

  it('refuses to enumerate past the cap, reporting what it would have cost', async () => {
    const error = await patchFor(storeFrom(DATA), 'CLEAR ALL', {
      enumerateGraphOps: true,
      enumerationCap: 2,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(EnumerationCapExceededError);
    expect(error).toBeInstanceOf(UnsupportedUpdateError);
    expect(error).toMatchObject({ count: 6, cap: 2 });
  });

  it('enumerates happily right up to the cap', async () => {
    const patch = await patchFor(storeFrom(DATA), 'CLEAR GRAPH <http://ex/g1>', {
      enumerateGraphOps: true,
      enumerationCap: 2,
    });
    expect(patch.deletionCount).toBe(2);
  });
});
