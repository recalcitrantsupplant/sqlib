/**
 * POC-3 — blob snapshot round-trip. The measurements.
 *
 * The brief this answers:
 *
 * > **POC-3 — blob snapshot round-trip.** Serialize/PUT/GET/parse one named
 * > graph at several sizes with conditional PUT; two concurrent writers, one
 * > loses, rebase. *Question:* what is the largest per-graph blob with an
 * > acceptable checkpoint pause? That number decides the partitioning scheme.
 * > *Kill:* dump/load dominates at realistic sizes — then the log is mandatory,
 * > not optional.
 *
 * Five phases, each answering one thing:
 *
 * 1. **isolation** — does a per-graph dump cost the graph or the store? If the
 *    store, partitioning buys nothing and the rest of the POC is moot.
 * 2. **round-trip** — dump, gzip, PUT, GET, parse, at several sizes, with the
 *    event-loop pause measured separately from the wall clock.
 * 3. **ceiling** — where the per-graph blob stops being possible at all.
 * 4. **conditional** — the two dialects' status codes, and the create case
 *    where they disagree.
 * 5. **contention** — two writers, one loses, rebases, lands.
 *
 * Run: `pnpm --filter @sparql-query-lib/rdf-delta poc:blob-snapshot`
 * Flags: `--sizes=1e4,1e5` `--repeats=5` `--ceiling-sizes=…` `--skip-ceiling`
 * `--out=<path>`. `--ceiling-probe=<n>` is the child half of phase 3 and is not
 * meant to be run by hand.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as oxigraph from 'oxigraph';

import { derivePatch, oxigraphDeltaStore } from '../src/index.js';
import type { OxigraphStoreLike } from '../src/index.js';
import { startBlobEmulator, type BlobDialect } from './blobEmulator.js';
import {
  contentDigest,
  getSnapshot,
  putSnapshot,
  rebaseAndRetry,
  restoreGraph,
  snapshotGraph,
} from './blobSnapshot.js';

const GRAPH_PREFIX = 'http://example.org/g/';
const SUBJECT_PREFIX = 'http://example.org/s/';
const PREDICATE = 'http://example.org/p';

/**
 * N-Quads for one graph.
 *
 * Term lengths land near 70 bytes per quad of N-Triples, which is towards the
 * short end of real data — #436's 578 MB over 4.3M quads works out at about
 * 134. So the quad counts here are optimistic by roughly a factor of two, and
 * the *byte* figures are the ones to carry across to another dataset: the blob
 * layer cares about bytes, and quads are only how we count them.
 */
function nquadsFor(graphIri: string, count: number, offset: number): string {
  const parts: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const id = offset + i;
    parts.push(`<${SUBJECT_PREFIX}${id}> <${PREDICATE}> "value-${id}" <${graphIri}> .\n`);
  }
  return parts.join('');
}

function loadGraph(store: oxigraph.Store, graphIri: string, count: number, offset = 0): void {
  store.load(nquadsFor(graphIri, count, offset), { format: 'application/n-quads' });
}

function graphNode(index: number): oxigraph.NamedNode {
  return oxigraph.namedNode(`${GRAPH_PREFIX}${index}`);
}

function rssMb(): number {
  return Math.round(process.memoryUsage().rss / 1024 / 1024);
}

// --- phase 1: is a per-graph dump O(graph) or O(store)? ---------------------

interface IsolationRow {
  quadsPerGraph: number;
  graphsInStore: number;
  storeQuads: number;
  dumpMs: number;
  dumpMsRange: [number, number];
  bytes: number;
}

async function phaseIsolation(
  quadsPerGraph: number,
  graphCounts: number[],
  repeats: number,
): Promise<IsolationRow[]> {
  const rows: IsolationRow[] = [];
  for (const graphsInStore of graphCounts) {
    const store = new oxigraph.Store();
    for (let g = 0; g < graphsInStore; g += 1) {
      loadGraph(store, `${GRAPH_PREFIX}${g}`, quadsPerGraph, g * quadsPerGraph);
    }
    // Always dump the same ordinal position, so the only variable is how much
    // else the store is holding. Repeated, because the claim this phase carries
    // — that the cost does not move — is a claim about a difference small
    // enough for one sample to invent or hide.
    const target = graphNode(Math.floor(graphsInStore / 2));
    const timings: number[] = [];
    let bytes = 0;
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      const snapshot = await snapshotGraph(store, target);
      timings.push(snapshot.dumpMs);
      bytes = snapshot.bytes;
    }
    const row: IsolationRow = {
      quadsPerGraph,
      graphsInStore,
      storeQuads: store.size,
      dumpMs: Math.round(median(timings) * 10) / 10,
      dumpMsRange: [Math.round(Math.min(...timings)), Math.round(Math.max(...timings))],
      bytes,
    };
    rows.push(row);
    console.log(
      `  ${String(graphsInStore).padStart(2)} graph(s) of ${quadsPerGraph} ` +
        `(${row.storeQuads} quads in store): dump ${row.dumpMs}ms ` +
        `[${row.dumpMsRange[0]}-${row.dumpMsRange[1]}], ${row.bytes} bytes`,
    );
  }
  return rows;
}

// --- phase 2: the round trip ------------------------------------------------

interface RoundTripRow {
  quads: number;
  bytes: number;
  bytesPerQuad: number;
  gzipBytes: number;
  gzipRatio: number;
  gzipMs: number;
  /** Median across repeats; the range is beside it so a median cannot hide one. */
  dumpMs: number;
  dumpMsRange: [number, number];
  dumpLoopBlockedMs: number;
  putMs: number;
  getMs: number;
  parseMs: number;
  parseLoopBlockedMs: number;
  timerControlMs: number;
  restoredQuads: number;
  /** The restored graph holds the same quads. */
  faithful: boolean;
  /** ...and does *not* dump the same bytes. See `contentDigest`. */
  byteIdentical: boolean;
  rssMbAfter: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

async function phaseRoundTrip(sizes: number[], baseUrl: string, repeats: number): Promise<RoundTripRow[]> {
  const rows: RoundTripRow[] = [];

  // Undici opens its pool and compiles its hot paths on the first request, and
  // that cost lands on whichever size happens to be measured first. Spend it
  // here instead, where it is not a number anybody reads.
  await putSnapshot(baseUrl, 'warmup', Buffer.from('<a> <b> "c" .\n'), { ifNoneMatch: '*' });
  await getSnapshot(baseUrl, 'warmup');

  for (const quads of sizes) {
    const graph = graphNode(0);
    const samples: Array<Omit<RoundTripRow, 'quads' | 'dumpMsRange'>> = [];

    for (let repeat = 0; repeat < repeats; repeat += 1) {
      const source = new oxigraph.Store();
      loadGraph(source, graph.value, quads);

      const snapshot = await snapshotGraph(source, graph, { compress: true });

      const key = `graph-${quads}-${repeat}`;
      const putStarted = performance.now();
      const put = await putSnapshot(baseUrl, key, snapshot.body, { ifNoneMatch: '*' });
      const putMs = performance.now() - putStarted;
      if (put.status >= 400) throw new Error(`round-trip: first PUT refused (${put.status} ${put.code})`);

      const getStarted = performance.now();
      const got = await getSnapshot(baseUrl, key);
      const getMs = performance.now() - getStarted;
      if (!got.body) throw new Error('round-trip: GET returned no body');

      const target = new oxigraph.Store();
      const restore = await restoreGraph(target, graph, got.body);

      // Fidelity, not just a count: re-dump the restored graph and compare it to
      // what was written. Both ways round, because they answer differently — the
      // content matches and the bytes do not, which is the ordering finding.
      const reDump = await snapshotGraph(target, graph);

      samples.push({
        bytes: snapshot.bytes,
        bytesPerQuad: Math.round((snapshot.bytes / quads) * 10) / 10,
        gzipBytes: snapshot.gzipBytes,
        gzipRatio: Math.round((snapshot.bytes / snapshot.gzipBytes) * 10) / 10,
        gzipMs: snapshot.gzipMs,
        dumpMs: snapshot.dumpMs,
        dumpLoopBlockedMs: snapshot.dumpLoopBlockedMs,
        putMs,
        getMs,
        parseMs: restore.loadMs,
        parseLoopBlockedMs: restore.loadLoopBlockedMs,
        timerControlMs: Math.max(snapshot.timerControlMs, restore.timerControlMs),
        restoredQuads: restore.quads,
        faithful: contentDigest(reDump.body) === contentDigest(snapshot.body),
        byteIdentical: reDump.body.equals(snapshot.body),
        rssMbAfter: rssMb(),
      });
    }

    const of = (pick: (sample: (typeof samples)[number]) => number): number => median(samples.map(pick));
    const dumps = samples.map((sample) => sample.dumpMs);

    const row: RoundTripRow = {
      quads,
      bytes: samples[0]!.bytes,
      bytesPerQuad: samples[0]!.bytesPerQuad,
      gzipBytes: samples[0]!.gzipBytes,
      gzipRatio: samples[0]!.gzipRatio,
      gzipMs: Math.round(of((s) => s.gzipMs)),
      dumpMs: Math.round(of((s) => s.dumpMs)),
      dumpMsRange: [Math.round(Math.min(...dumps)), Math.round(Math.max(...dumps))],
      dumpLoopBlockedMs: Math.round(of((s) => s.dumpLoopBlockedMs)),
      putMs: Math.round(of((s) => s.putMs)),
      getMs: Math.round(of((s) => s.getMs)),
      parseMs: Math.round(of((s) => s.parseMs)),
      parseLoopBlockedMs: Math.round(of((s) => s.parseLoopBlockedMs)),
      timerControlMs: Math.round(of((s) => s.timerControlMs) * 10) / 10,
      restoredQuads: samples[0]!.restoredQuads,
      faithful: samples.every((sample) => sample.faithful),
      byteIdentical: samples.some((sample) => sample.byteIdentical),
      rssMbAfter: Math.max(...samples.map((sample) => sample.rssMbAfter)),
    };
    rows.push(row);
    console.log(
      `  ${quads} quads: ${(row.bytes / 1e6).toFixed(1)} MB, dump ${row.dumpMs}ms ` +
        `[${row.dumpMsRange[0]}-${row.dumpMsRange[1]}] (loop blocked ${row.dumpLoopBlockedMs}ms), ` +
        `gzip ${row.gzipMs}ms ->${row.gzipRatio}x, PUT ${row.putMs}ms, GET ${row.getMs}ms, ` +
        `parse ${row.parseMs}ms (loop blocked ${row.parseLoopBlockedMs}ms), ` +
        `content=${row.faithful ? 'same' : 'DIFFERENT'}, bytes=${row.byteIdentical ? 'same' : 'different'}`,
    );
  }

  return rows;
}

// --- phase 3: the ceiling ---------------------------------------------------

interface CeilingRow {
  quads: number;
  approxBytes: number;
  loadedOk: boolean;
  dumpedOk: boolean;
  failure?: string;
  loadMs?: number;
  dumpMs?: number;
  rssMbAfter: number;
}

/**
 * Load and dump one graph of `quads`, reporting which half hit a wall.
 *
 * Runs as its own process — see `phaseCeiling` for why that is not optional.
 */
function ceilingProbe(quads: number): CeilingRow {
  const graph = graphNode(0);
  const row: CeilingRow = { quads, approxBytes: 0, loadedOk: false, dumpedOk: false, rssMbAfter: 0 };
  const store = new oxigraph.Store();

  try {
    const t0 = performance.now();
    // Loaded in slices so that *building* the fixture cannot be what fails: the
    // string holding a 10⁷-quad N-Quads document would itself be over the cap,
    // and a probe that died making its own input would say nothing about the
    // store.
    const sliceSize = 250_000;
    for (let done = 0; done < quads; done += sliceSize) {
      loadGraph(store, graph.value, Math.min(sliceSize, quads - done), done);
    }
    row.loadMs = Math.round(performance.now() - t0);
    row.loadedOk = true;
  } catch (error) {
    row.failure = `load: ${(error as Error).name}: ${(error as Error).message}`;
  }

  if (row.loadedOk) {
    try {
      const t0 = performance.now();
      const text = store.dump({ format: 'application/n-triples', from_graph_name: graph });
      row.dumpMs = Math.round(performance.now() - t0);
      row.approxBytes = text.length;
      row.dumpedOk = true;
    } catch (error) {
      row.failure = `dump: ${(error as Error).name}: ${(error as Error).message}`;
    }
  }

  row.rssMbAfter = rssMb();
  return row;
}

/**
 * Find where a per-graph blob stops being producible.
 *
 * Two walls are in play and they are different walls. `Store.dump` returns a
 * `string`, and V8 caps a string at `String::kMaxLength` — `0x1fffffe8`, 512
 * MiB — which is the one #436 hit from the read side. Underneath it sits
 * wasm32's 4 GiB address space, which the *store* has to fit in long before its
 * serialization reaches half a gigabyte. Whichever arrives first is the ceiling,
 * and the probe reports which one it was rather than assuming.
 *
 * **Each size runs in its own process, and that is load-bearing.** A
 * `WebAssembly.Memory` grows and never shrinks, so a store dropped and
 * collected leaves the heap it grew behind. Probing 2M and then 4M in one
 * process measures 4M against a heap 2M already expanded — which is how the
 * first run of this harness found a ceiling between 2M and 4M that was partly
 * its own previous size. A fresh process per size is the only way the number
 * means anything.
 */
async function phaseCeiling(sizes: number[]): Promise<CeilingRow[]> {
  const rows: CeilingRow[] = [];
  const self = fileURLToPath(import.meta.url);

  for (const quads of sizes) {
    const child = spawnSync(process.execPath, [...process.execArgv, self, `--ceiling-probe=${quads}`], {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });

    let row: CeilingRow;
    const emitted = /^CEILING (.*)$/m.exec(child.stdout ?? '');
    if (emitted) {
      row = JSON.parse(emitted[1]!) as CeilingRow;
    } else {
      // The probe did not survive to report. An out-of-memory kill is a result,
      // not an error — it is the ceiling arriving as a signal instead of an
      // exception, and a run that threw the evidence away would report nothing.
      row = {
        quads,
        approxBytes: 0,
        loadedOk: false,
        dumpedOk: false,
        rssMbAfter: 0,
        failure: `process died: signal ${child.signal ?? 'none'}, status ${child.status ?? 'none'}` +
          `${child.stderr ? ` — ${child.stderr.trim().split('\n').slice(-1)[0]}` : ''}`,
      };
    }

    rows.push(row);
    console.log(
      `  ${quads} quads: load ${row.loadedOk ? `${row.loadMs}ms` : 'FAILED'}, ` +
        `dump ${row.dumpedOk ? `${row.dumpMs}ms / ${(row.approxBytes / 1e6).toFixed(0)} MB` : 'FAILED'}` +
        `${row.failure ? ` — ${row.failure}` : ''} (rss ${row.rssMbAfter} MB)`,
    );

    // A size that could not be dumped is the ceiling; larger ones only cost
    // time to confirm the same wall.
    if (!row.dumpedOk) break;
  }

  return rows;
}

// --- phase 4: the conditional-write protocol --------------------------------

interface ConditionalRow {
  dialect: BlobDialect;
  case: string;
  status: number;
  code?: string;
}

async function phaseConditional(): Promise<ConditionalRow[]> {
  const rows: ConditionalRow[] = [];
  const body = Buffer.from('<http://example.org/s> <http://example.org/p> "v" .\n');
  const other = Buffer.from('<http://example.org/s> <http://example.org/p> "w" .\n');

  for (const dialect of ['azure', 's3'] as const) {
    const blob = await startBlobEmulator(dialect);
    try {
      const create = await putSnapshot(blob.url, 'g', body, { ifNoneMatch: '*' });
      rows.push({ dialect, case: 'create-if-absent, absent', status: create.status });

      const recreate = await putSnapshot(blob.url, 'g', other, { ifNoneMatch: '*' });
      rows.push({ dialect, case: 'create-if-absent, present', status: recreate.status, code: recreate.code });

      const stale = await putSnapshot(blob.url, 'g', other, { ifMatch: '"stale"' });
      rows.push({ dialect, case: 'overwrite-if-unchanged, stale etag', status: stale.status, code: stale.code });

      const fresh = await putSnapshot(blob.url, 'g', other, { ifMatch: create.etag! });
      rows.push({ dialect, case: 'overwrite-if-unchanged, current etag', status: fresh.status });

      const missing = await putSnapshot(blob.url, 'absent', other, { ifMatch: '"whatever"' });
      rows.push({ dialect, case: 'overwrite-if-unchanged, blob deleted', status: missing.status, code: missing.code });
    } finally {
      await blob.close();
    }
  }

  for (const row of rows) {
    console.log(`  ${row.dialect.padEnd(5)} ${row.case.padEnd(38)} -> ${row.status}${row.code ? ` ${row.code}` : ''}`);
  }
  return rows;
}

// --- phase 5: two writers, one loses ----------------------------------------

interface ContentionRow {
  graphQuads: number;
  loserAttempts: number;
  loserRebaseMs: number;
  uncontendedCheckpointMs: number;
  rebaseMultiple: number;
  additionsOnFirstDerive: number;
  additionsOnRebase: number;
  converged: boolean;
}

/**
 * Both writers read the same snapshot; both derive and apply; both PUT.
 *
 * The updates are deliberately *not* disjoint: the loser's `DELETE WHERE`
 * matches quads the winner added, so a writer that reapplied the patch it
 * derived the first time would land a different graph than a writer that
 * re-derives. The oracle at the end is the sequential apply — winner then
 * loser, against one store — and the rebased blob has to hold what it holds.
 *
 * Both updates name the graph explicitly, and that is not a detail. A blob is
 * one named graph, so an update is only checkpointable through this topology if
 * its whole effect lands inside the graph the blob holds. An update touching
 * two graphs touches two blobs, and a conditional PUT is atomic per blob and
 * offers nothing across them — which is the boundary option C buys its
 * concurrency with, and the first thing to check a workload against.
 */
async function phaseContention(graphQuads: number, baseUrl: string): Promise<ContentionRow> {
  const graph = graphNode(0);
  const key = 'contended';

  const seed = new oxigraph.Store();
  loadGraph(seed, graph.value, graphQuads);
  const seeded = await snapshotGraph(seed, graph);
  const created = await putSnapshot(baseUrl, key, seeded.body, { ifNoneMatch: '*' });
  if (!created.etag) throw new Error('contention: could not seed the blob');

  const winnerUpdate =
    `INSERT DATA { GRAPH <${graph.value}> { ` +
    `<${SUBJECT_PREFIX}new-1> <${PREDICATE}> "extra" . ` +
    `<${SUBJECT_PREFIX}new-2> <${PREDICATE}> "extra" . } }`;
  // Matches the two quads the winner adds, and nothing the seed holds — so its
  // ground effect against the state it read is empty, and against the state it
  // lost to is two deletions. That difference is the reason to re-derive.
  const loserUpdate = `DELETE WHERE { GRAPH <${graph.value}> { ?s <${PREDICATE}> "extra" } }`;

  const bothRead = created.etag;

  // --- the loser derives first, against the state both writers read.
  const loserStore = new oxigraph.Store();
  await restoreGraph(loserStore, graph, seeded.body);
  const firstDerive = await derivePatch(
    loserUpdate,
    oxigraphDeltaStore(loserStore as unknown as OxigraphStoreLike),
  );

  // --- the winner lands.
  const winnerStore = new oxigraph.Store();
  await restoreGraph(winnerStore, graph, seeded.body);
  winnerStore.update(winnerUpdate);
  const winnerSnapshot = await snapshotGraph(winnerStore, graph);
  const winnerPut = await putSnapshot(baseUrl, key, winnerSnapshot.body, { ifMatch: bothRead });
  if (winnerPut.status >= 400) throw new Error('contention: the winner lost');

  // --- the loser's conditional PUT is refused, and it rebases.
  const loserSnapshot = await snapshotGraph(loserStore, graph);
  const loserPut = await putSnapshot(baseUrl, key, loserSnapshot.body, { ifMatch: bothRead });
  if (loserPut.status < 400) throw new Error('contention: the loser was not refused');

  const rebase = await rebaseAndRetry({
    baseUrl,
    key,
    graph,
    update: loserUpdate,
    createStore: () => new oxigraph.Store(),
  });

  // --- the oracle: the same two updates applied in order to one store.
  const oracle = new oxigraph.Store();
  await restoreGraph(oracle, graph, seeded.body);
  oracle.update(winnerUpdate);
  oracle.update(loserUpdate);
  const oracleSnapshot = await snapshotGraph(oracle, graph);

  const landed = await getSnapshot(baseUrl, key);
  const converged = Boolean(landed.body && contentDigest(landed.body) === contentDigest(oracleSnapshot.body));

  const row: ContentionRow = {
    graphQuads,
    loserAttempts: rebase.attempts,
    loserRebaseMs: Math.round(rebase.rebaseMs),
    uncontendedCheckpointMs: Math.round(winnerSnapshot.dumpMs),
    rebaseMultiple: Math.round((rebase.rebaseMs / winnerSnapshot.dumpMs) * 10) / 10,
    additionsOnFirstDerive: firstDerive.deletionCount,
    additionsOnRebase: rebase.deletions,
    converged,
  };

  console.log(
    `  ${graphQuads} quads: loser took ${row.loserAttempts} attempts, rebase ${row.loserRebaseMs}ms ` +
      `(${row.rebaseMultiple}x the uncontended ${row.uncontendedCheckpointMs}ms dump); ` +
      `deletions derived ${row.additionsOnFirstDerive} before the race, ${row.additionsOnRebase} after; ` +
      `converged=${row.converged}`,
  );
  return row;
}

// --- main -------------------------------------------------------------------

function parseSizes(raw: string | undefined, fallback: number[]): number[] {
  if (!raw) return fallback;
  return raw.split(',').map((part) => {
    const value = Number(part);
    if (!Number.isFinite(value) || value <= 0) throw new Error(`bad size: ${part}`);
    return Math.round(value);
  });
}

function flag(name: string): string | undefined {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main(): Promise<void> {
  // The child half of phase 3: one size, one process, one line of JSON out.
  const probeSize = flag('ceiling-probe');
  if (probeSize) {
    console.log(`CEILING ${JSON.stringify(ceilingProbe(Number(probeSize)))}`);
    return;
  }

  const sizes = parseSizes(flag('sizes'), [10_000, 100_000, 1_000_000]);
  const repeats = Number(flag('repeats') ?? 3);
  const ceilingSizes = parseSizes(
    flag('ceiling-sizes'),
    [1_500_000, 2_000_000, 2_500_000, 3_000_000, 3_500_000, 4_000_000, 5_000_000],
  );
  const skipCeiling = process.argv.includes('--skip-ceiling');
  const out = resolve(flag('out') ?? new URL('./results/latest.json', import.meta.url).pathname);

  const startedAt = new Date().toISOString();
  console.log(`POC-3 — blob snapshot round-trip (node ${process.version}, oxigraph 0.5.11)\n`);

  console.log('phase 1 — is a per-graph dump O(graph) or O(store)?');
  const isolation = await phaseIsolation(50_000, [1, 5, 20, 50], repeats);

  console.log(`\nphase 2 — round trip: dump, gzip, PUT, GET, parse (median of ${repeats})`);
  const blob = await startBlobEmulator('azure');
  let roundTrip: RoundTripRow[];
  let contention: ContentionRow;
  try {
    roundTrip = await phaseRoundTrip(sizes, blob.url, repeats);
    console.log('\nphase 5 — two writers, one loses, rebases');
    contention = await phaseContention(Math.min(...sizes), blob.url);
  } finally {
    await blob.close();
  }

  console.log('\nphase 4 — the conditional-write protocol, both dialects');
  const conditional = await phaseConditional();

  let ceiling: CeilingRow[] = [];
  if (skipCeiling) {
    console.log('\nphase 3 — ceiling: skipped (--skip-ceiling)');
  } else {
    console.log('\nphase 3 — where the per-graph blob stops being producible');
    ceiling = await phaseCeiling(ceilingSizes);
  }

  const results = {
    poc: 'POC-3 — blob snapshot round-trip',
    issue: 290,
    startedAt,
    finishedAt: new Date().toISOString(),
    repeats,
    environment: {
      node: process.version,
      oxigraph: '0.5.11',
      platform: `${process.platform}/${process.arch}`,
      note: 'Cloud container, not the self-hosted runner. Blob timings are a local-HTTP floor, not a vendor measurement.',
    },
    isolation,
    roundTrip,
    ceiling,
    conditional,
    contention,
  };

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`\nwrote ${out}`);
}

await main();
