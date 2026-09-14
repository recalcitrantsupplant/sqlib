import { describe, it, expect } from 'vitest';
import * as oxigraph from 'oxigraph';
import { markStoreWritten, storeWriteCount } from '../../src/lib/storeWrites.js';
import { OxigraphSparqlExecutor } from '../../src/server/OxigraphSparqlExecutor.js';

/**
 * The write counter behind the checkpoint skip (#443).
 *
 * What matters about it is not that it counts, but that it counts *per store
 * object* and never goes backwards — the checkpoint reads it before a dump and
 * records it after, so a monotonic per-object number is what makes a write
 * landing mid-dump provoke the next checkpoint rather than being skipped.
 */
describe('storeWrites', () => {
  it('starts at zero for a store nothing has written', () => {
    expect(storeWriteCount(new oxigraph.Store())).toBe(0);
  });

  it('counts writes per store, not globally', () => {
    const a = new oxigraph.Store();
    const b = new oxigraph.Store();

    markStoreWritten(a);
    markStoreWritten(a);
    markStoreWritten(b);

    expect(storeWriteCount(a)).toBe(2);
    expect(storeWriteCount(b)).toBe(1);
  });

  it('is bumped by a SPARQL update through the executor', async () => {
    const store = new oxigraph.Store();
    const executor = new OxigraphSparqlExecutor(store);
    const before = storeWriteCount(store);

    await executor.update('INSERT DATA { <http://a> <http://b> <http://c> }');

    expect(storeWriteCount(store)).toBe(before + 1);
    expect(store.size).toBe(1);
  });

  it('is not bumped by a query', async () => {
    const store = new oxigraph.Store();
    store.load('<http://a> <http://b> <http://c> .', { format: 'nq' });
    const executor = new OxigraphSparqlExecutor(store);
    // A load through the raw binding is not a recorded write — only the
    // manager's own load paths declare themselves — so this starts at zero.
    const before = storeWriteCount(store);

    await executor.askQuery('ASK { ?s ?p ?o }');

    expect(storeWriteCount(store)).toBe(before);
  });

  it('is not bumped by an update that fails', async () => {
    const store = new oxigraph.Store();
    const executor = new OxigraphSparqlExecutor(store);
    const before = storeWriteCount(store);

    await expect(executor.update('INSERT DATA { not valid sparql')).rejects.toThrow();

    // A refused update left the store as it was, so claiming a write would
    // cost a checkpoint for nothing.
    expect(storeWriteCount(store)).toBe(before);
  });

  it('counts an update that changes nothing', async () => {
    // The counter answers "was this store written", not "did the content
    // change" — a DELETE that matches nothing is indistinguishable from one
    // that matched without dumping the store, which is the cost being avoided.
    const store = new oxigraph.Store();
    const executor = new OxigraphSparqlExecutor(store);
    const before = storeWriteCount(store);

    await executor.update('DELETE WHERE { <http://nothing> ?p ?o }');

    expect(storeWriteCount(store)).toBe(before + 1);
  });
});
