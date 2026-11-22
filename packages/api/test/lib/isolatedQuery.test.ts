/**
 * `lib/isolatedQuery.ts`: queries over an in-memory store run in worker
 * threads, and a query past the deadline is stopped while it runs.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as oxigraph from 'oxigraph';
import {
  IsolatedOxigraphSparqlExecutor,
  isolatedQueryStats,
  oxigraphExecutor,
  releaseIsolatedStore,
} from '../../src/lib/isolatedQuery.js';
import { OxigraphSparqlExecutor } from '../../src/server/OxigraphSparqlExecutor.js';

const RING = Array.from({ length: 60 }, (_, i) => `<urn:n${i}> <urn:p> <urn:n${(i + 1) % 60}> .`).join('\n');
/** A 4-way cross product over 60 triples: about 13 million rows. */
const HEAVY = 'SELECT (COUNT(*) AS ?n) WHERE { ?a <urn:p> ?x . ?b <urn:p> ?y . ?c <urn:p> ?z . ?d <urn:p> ?w }';
const SMALL = 'SELECT ?s WHERE { ?s <urn:p> <urn:n1> }';

function ring(): oxigraph.Store {
  const store = new oxigraph.Store();
  store.load(RING, { format: 'nt' });
  return store;
}

/** The longest gap between ticks of a 20 ms timer while `work` runs. */
async function longestStall(work: Promise<unknown>): Promise<number> {
  let last = Date.now();
  let longest = 0;
  const timer = setInterval(() => {
    const at = Date.now();
    longest = Math.max(longest, at - last);
    last = at;
  }, 20);
  try {
    await work.catch(() => undefined);
  } finally {
    clearInterval(timer);
  }
  return longest;
}

beforeEach(() => {
  process.env.SQLIB_QUERY_WORKERS = '2';
});

afterEach(() => {
  delete process.env.SQLIB_QUERY_WORKERS;
  delete process.env.SQLIB_EXECUTION_TIMEOUT_MS;
});

describe('oxigraphExecutor', () => {
  it('runs on this thread unless SQLIB_QUERY_WORKERS is above 0', () => {
    delete process.env.SQLIB_QUERY_WORKERS;
    expect(oxigraphExecutor(ring())).not.toBeInstanceOf(IsolatedOxigraphSparqlExecutor);
    process.env.SQLIB_QUERY_WORKERS = '1';
    expect(oxigraphExecutor(ring())).toBeInstanceOf(IsolatedOxigraphSparqlExecutor);
  });
});

describe('IsolatedOxigraphSparqlExecutor', () => {
  it('gives the same SELECT, CONSTRUCT and ASK results as the plain executor', async () => {
    const store = ring();
    const isolated = new IsolatedOxigraphSparqlExecutor(store);
    const plain = new OxigraphSparqlExecutor(store);
    const construct = 'CONSTRUCT { ?s <urn:q> ?o } WHERE { ?s <urn:p> ?o } ORDER BY ?s LIMIT 3';

    expect((await isolated.selectQueryParsed(SMALL)).result).toEqual((await plain.selectQueryParsed(SMALL)).result);
    expect((await isolated.constructQueryParsed(construct)).result).toEqual(
      (await plain.constructQueryParsed(construct)).result,
    );
    expect((await isolated.askQuery('ASK { <urn:n0> <urn:p> <urn:n1> }')).result).toBe(true);
    releaseIsolatedStore(store);
  }, 30_000);

  it('sees an update made through it', async () => {
    const store = ring();
    const executor = new IsolatedOxigraphSparqlExecutor(store);
    expect((await executor.askQuery('ASK { <urn:x> <urn:p> <urn:y> }')).result).toBe(false);
    await executor.update('INSERT DATA { <urn:x> <urn:p> <urn:y> }');
    expect((await executor.askQuery('ASK { <urn:x> <urn:p> <urn:y> }')).result).toBe(true);
    releaseIsolatedStore(store);
  }, 30_000);

  it('stops a long query at the deadline and keeps this thread free', async () => {
    process.env.SQLIB_EXECUTION_TIMEOUT_MS = '2000';
    const store = ring();
    const executor = new IsolatedOxigraphSparqlExecutor(store);
    // A small query first, so the worker is loaded and the stop below comes
    // from the query, not from a slow start.
    await executor.selectQueryParsed(SMALL);

    const started = Date.now();
    const run = executor.selectQueryParsed(HEAVY);
    const stall = await longestStall(run);
    await expect(run).rejects.toMatchObject({ name: 'ExecutionAbortedError', statusCode: 504 });
    expect(Date.now() - started).toBeLessThan(3_500);
    expect(stall).toBeLessThan(250);

    // The store still answers, from a fresh worker.
    await expect(executor.askQuery('ASK { <urn:n0> <urn:p> <urn:n1> }')).resolves.toMatchObject({ result: true });
    releaseIsolatedStore(store);
  }, 30_000);

  it('makes a query wait for a free worker, within its own deadline', async () => {
    process.env.SQLIB_QUERY_WORKERS = '1';
    process.env.SQLIB_EXECUTION_TIMEOUT_MS = '1500';
    const store = ring();
    const executor = new IsolatedOxigraphSparqlExecutor(store);
    await executor.selectQueryParsed(SMALL);

    const heavy = executor.selectQueryParsed(HEAVY);
    const queued = executor.selectQueryParsed(SMALL);
    await expect(heavy).rejects.toMatchObject({ statusCode: 504 });
    await expect(queued).rejects.toMatchObject({ statusCode: 504 });
    releaseIsolatedStore(store);
  }, 30_000);

  it('keeps no more workers alive than SQLIB_QUERY_WORKERS, across stores', async () => {
    process.env.SQLIB_QUERY_WORKERS = '1';
    const first = ring();
    const second = ring();
    await new IsolatedOxigraphSparqlExecutor(first).selectQueryParsed(SMALL);
    expect(isolatedQueryStats()).toMatchObject({ live: 1, idle: 1 });
    await new IsolatedOxigraphSparqlExecutor(second).selectQueryParsed(SMALL);
    // The copy of the first store ended to make room for the second.
    expect(isolatedQueryStats()).toMatchObject({ live: 1, idle: 1 });
    releaseIsolatedStore(first);
    releaseIsolatedStore(second);
    expect(isolatedQueryStats()).toMatchObject({ live: 0, idle: 0 });
  }, 30_000);

  it('stops when the caller aborts', async () => {
    const store = ring();
    const executor = new IsolatedOxigraphSparqlExecutor(store);
    const controller = new AbortController();
    const run = executor.selectQueryParsed(HEAVY, { signal: controller.signal });
    setTimeout(() => controller.abort(new Error('gone')), 200);
    await expect(run).rejects.toThrow('gone');
    releaseIsolatedStore(store);
  }, 30_000);
});
