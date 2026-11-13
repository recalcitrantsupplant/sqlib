/**
 * An update's run-time dataset (`using-graph-uri`), applied to the reads
 * derived from its `WHERE` clause. The derived patch must hold only what the
 * update would write when its `WHERE` reads the given graphs.
 */

import * as oxigraph from 'oxigraph';
import { describe, expect, it } from 'vitest';
import { derivePatch, oxigraphDeltaStore, UnsupportedUpdateError } from '../src/index.js';
import { storeFrom } from './support/harness.js';

const DATA = `
<http://ex/a> <http://ex/p> <http://ex/b> <http://ex/g1> .
<http://ex/c> <http://ex/p> <http://ex/d> <http://ex/g2> .
`;

const COPY = 'INSERT { ?s <http://ex/q> ?o } WHERE { ?s <http://ex/p> ?o }';

const subjects = (quads: Array<{ subject: { value: string } }>) => quads.map((quad) => quad.subject.value).sort();

describe('derivePatch with a dataset', () => {
  it('reads only the default graphs it is given', async () => {
    const store = oxigraphDeltaStore(storeFrom(DATA));
    const patch = await derivePatch(COPY, store, { dataset: { defaultGraphs: ['http://ex/g1'] } });

    expect(subjects(patch.additions)).toEqual(['http://ex/a']);
    expect(patch.deletions).toEqual([]);
  });

  it('reads an empty default graph when only named graphs are given', async () => {
    const store = oxigraphDeltaStore(storeFrom(DATA));
    const patch = await derivePatch(COPY, store, { dataset: { namedGraphs: ['http://ex/g2'] } });

    expect(patch.additions).toEqual([]);
  });

  it('reads the default graph of the store when no dataset is given', async () => {
    const store = oxigraphDeltaStore(storeFrom(DATA));
    const patch = await derivePatch(COPY, store);

    expect(patch.additions).toEqual([]);
  });

  it('refuses a dataset on a program that needs a fork that cannot apply it', async () => {
    const store = oxigraphDeltaStore(storeFrom(DATA), { createStore: () => new oxigraph.Store() });
    const program = `${COPY} ; DELETE { ?s <http://ex/q> ?o } WHERE { ?s <http://ex/q> ?o }`;

    await expect(derivePatch(program, store, { dataset: { defaultGraphs: ['http://ex/g1'] } }))
      .rejects.toBeInstanceOf(UnsupportedUpdateError);
  });
});
