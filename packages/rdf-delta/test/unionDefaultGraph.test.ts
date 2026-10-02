/**
 * Default-graph membership on a store whose default graph is the union of all
 * its graphs.
 *
 * Fuseki with `unionDefaultGraph`, Stardog with `query.all.graphs` and GraphDB
 * out of the box all answer `?s ?p ?o` with triples that only a named graph
 * holds. The existence query asks exactly that to decide whether the default
 * graph holds a quad, so on such a store it says yes to a triple that lives in
 * `<g1>` — and an `INSERT DATA` of that triple into the default graph was
 * derived as a no-op, losing the write.
 *
 * Every case here is a DATA form, because those are the ones whose effect does
 * not depend on how the WHERE clause sees the default graph — so plain Oxigraph
 * executing the update is still the right oracle for the store's contents.
 */

import { describe, expect, it } from 'vitest';
import { derivePatch, oxigraphDeltaStore, probeUnionDefaultGraph, type DeltaStore } from '../src/index.js';
import { assertEquivalent, httpDeltaStoreFor, storeFrom } from './support/harness.js';

const DATA = `
<http://ex/c> <http://ex/p> <http://ex/d> .
<http://ex/x> <http://ex/p> <http://ex/y> <http://ex/g1> .
`;

const ONLY_IN_G1 = '<http://ex/x> <http://ex/p> <http://ex/y>';
const ONLY_IN_DEFAULT = '<http://ex/c> <http://ex/p> <http://ex/d>';

const UNION = { data: DATA, membership: 'http' as const, unionDefaultGraph: true };

/** Counts the SELECTs a store is asked, to see whether a probe ran. */
function counting(store: DeltaStore): DeltaStore & { selects: string[] } {
  const selects: string[] = [];
  return {
    ...store,
    selects,
    construct: (sparql) => store.construct(sparql),
    select: (sparql) => {
      selects.push(sparql);
      return store.select(sparql);
    },
  };
}

describe('probeUnionDefaultGraph', () => {
  it('recognises a union default graph', async () => {
    const store = httpDeltaStoreFor(storeFrom(DATA), { unionDefaultGraph: true });
    await expect(probeUnionDefaultGraph(store)).resolves.toBe(true);
  });

  it('recognises a default graph of its own', async () => {
    await expect(probeUnionDefaultGraph(httpDeltaStoreFor(storeFrom(DATA)))).resolves.toBe(false);
  });

  it('answers false when there is no named-graph data to confuse it with', async () => {
    const store = httpDeltaStoreFor(storeFrom(`${ONLY_IN_DEFAULT} .`), { unionDefaultGraph: true });
    await expect(probeUnionDefaultGraph(store)).resolves.toBe(false);
  });

  it('is not run when the store declares the answer', async () => {
    const store = counting(oxigraphDeltaStore(storeFrom(DATA)));
    await derivePatch(`INSERT DATA { ${ONLY_IN_G1} }`, store);
    expect(store.selects.some((sparql) => sparql.includes('?visible'))).toBe(false);
  });

  it('runs at most once per store', async () => {
    const store = counting(httpDeltaStoreFor(storeFrom(DATA), { unionDefaultGraph: true }));
    await derivePatch(`INSERT DATA { ${ONLY_IN_G1} }`, store);
    await derivePatch(`INSERT DATA { ${ONLY_IN_DEFAULT} }`, store);
    expect(store.selects.filter((sparql) => sparql.includes('?visible'))).toHaveLength(1);
  });
});

describe('default-graph membership on a union-default-graph store', () => {
  it('keeps an insertion of a triple only a named graph holds', async () => {
    const patch = await assertEquivalent({
      ...UNION,
      name: 'INSERT DATA of a named-graph triple into the default graph',
      update: `INSERT DATA { ${ONLY_IN_G1} }`,
    });
    expect(patch.additionCount).toBe(1);
    // Whether the stored default graph also held a copy is not something such
    // a store can be asked, and the patch says it guessed.
    expect(patch.netEffectExact).toBe(false);
  });

  it('still trims an insertion the default graph alone holds, exactly', async () => {
    const patch = await assertEquivalent({
      ...UNION,
      name: 'INSERT DATA of a default-graph triple',
      update: `INSERT DATA { ${ONLY_IN_DEFAULT} }`,
    });
    expect(patch.additionCount).toBe(0);
    expect(patch.netEffectExact).toBe(true);
  });

  it('flags a deletion of a triple only a named graph holds', async () => {
    const patch = await assertEquivalent({
      ...UNION,
      name: 'DELETE DATA of a named-graph triple from the default graph',
      update: `DELETE DATA { ${ONLY_IN_G1} }`,
    });
    expect(patch.netEffectExact).toBe(false);
  });

  it('still deletes a triple the default graph alone holds, exactly', async () => {
    const patch = await assertEquivalent({
      ...UNION,
      name: 'DELETE DATA of a default-graph triple',
      update: `DELETE DATA { ${ONLY_IN_DEFAULT} }`,
    });
    expect(patch.deletionCount).toBe(1);
    expect(patch.netEffectExact).toBe(true);
  });

  it('leaves named-graph membership alone', async () => {
    const patch = await assertEquivalent({
      ...UNION,
      name: 'INSERT DATA into the named graph that already holds it',
      update: `INSERT DATA { GRAPH <http://ex/g1> { ${ONLY_IN_G1} } }`,
    });
    expect(patch.additionCount).toBe(0);
    expect(patch.netEffectExact).toBe(true);
  });

  it('loses the write when the store misreports itself, which is what the probe is for', async () => {
    const store = storeFrom(DATA);
    const misreported = {
      ...httpDeltaStoreFor(store, { unionDefaultGraph: true }),
      unionDefaultGraph: false,
    };
    const patch = await derivePatch(`INSERT DATA { ${ONLY_IN_G1} }`, misreported);
    expect(patch.additionCount).toBe(0);
  });
});
