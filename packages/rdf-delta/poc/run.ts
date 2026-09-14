/**
 * POC-2 — the measurement run.
 *
 * The brief this answers:
 *
 * > **POC-2 — DuckDB history.** Synthetic patch logs at 10⁵ / 10⁶ / 10⁷ quads;
 * > measure latest-graph reconstruction, AS-OF at various depths, Parquet
 * > compression ratio, and time-to-materialize-into-oxigraph. *Question:* what
 * > checkpoint cadence keeps reconstruction bounded? *Kill:* reconstruction is
 * > slower than simply keeping snapshots — then option B is analytics-only.
 *
 * This file is that paragraph, executable. Every query it times is built by
 * `patchLogSql.ts` and checked against a replay oracle in
 * `test/patchLog.test.ts`, so a number here is a number about a query that
 * returns the right graph.
 *
 * ## Running it
 *
 *   pnpm --filter @sparql-query-lib/rdf-delta exec tsx poc/run.ts
 *   pnpm --filter @sparql-query-lib/rdf-delta exec tsx poc/run.ts --scales 1e5,1e6,1e7 --out poc2.json
 *
 * `exec` rather than the `poc:patch-log` script when passing flags: pnpm 11
 * does not forward trailing arguments to run-scripts (the same trap
 * `scripts/ci/test.sh` documents for `--shard`).
 *
 * Numbers are per-machine and the JSON records which machine produced them.
 * What is not per-machine is the *shape* — how a cost grows with the log, and
 * which of two strategies wins — and that is what the design note reads off.
 */

import { closeSync, mkdtempSync, openSync, readSync, rmSync, statSync } from 'node:fs';
import { tmpdir, cpus, totalmem } from 'node:os';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import oxigraph from 'oxigraph';
import { medianMs, openDuck, scalar, type Duck } from './duckdb.js';
import {
  DEFAULT_SHAPE,
  asOfSql,
  checkpointSql,
  fromCheckpointSql,
  generateLogSql,
  latestArgMaxSql,
  latestQualifySql,
  nquadsSql,
  type ChurnProfile,
  type LogShape,
} from './patchLogSql.js';

/** Cadences to measure, as a fraction of the log's patches. */
const CADENCES = [0.25, 0.5, 0.75, 0.9, 0.99];
/** AS-OF depths, as a fraction of the log's patches. */
const DEPTHS = [0.1, 0.5, 0.9];
/** Reconstruction budgets the cadence answer is quoted against. */
const BUDGETS_MS = [250, 1000];

interface Timing {
  cold: number;
  median: number;
}

interface CadencePoint {
  atPatch: number;
  tailRows: number;
  buildMs: number;
  reconstructMs: Timing;
}

interface RunResult {
  profile: ChurnProfile;
  ops: number;
  shape: LogShape;
  logRows: number;
  distinctQuads: number;
  stateQuads: number;
  generateMs: number;
  logBytesDuckdb: number;
  logBytesParquetZstd: number;
  logBytesRdfPatchText: number;
  latestArgMax: Timing;
  latestQualify: Timing;
  asOf: Array<{ atPatch: number; ms: Timing }>;
  cadences: CadencePoint[];
  snapshotBytesParquetZstd: number;
  snapshotBuildMs: number;
  snapshotReadMs: Timing;
  oxigraph:
    | { skipped: true; why: string }
    | {
        skipped: false;
        nquadsBytes: number;
        writeMs: number;
        writeFromSnapshotMs: number;
        readFileMs: number;
        loadMs: number;
        chunks: number;
        quads: number;
      };
  /** Least-squares fit of reconstruction time against tail rows. */
  fit: { interceptMs: number; msPerMillionTailRows: number };
  cadenceForBudget: Array<{ budgetMs: number; patches: number | null }>;
}

/**
 * Every reconstruction below is timed through this, and the reason is the kill
 * criterion.
 *
 * "Reconstruction is slower than simply keeping snapshots" is only a
 * comparison if both sides are asked for the same thing, and the obvious
 * spelling — `count(*)` — is not: over a Parquet snapshot DuckDB answers it
 * from the file's footer without reading a single term, so the snapshot side
 * would win by not doing the work. Summing the length of all four term columns
 * forces every term to be read on either side, which is the floor of what a
 * consumer of the graph needs, without adding the cost of shipping the rows out
 * of the process (the Oxigraph step measures that separately, once, on the
 * artifact both paths produce).
 */
function materialiseSql(inner: string): string {
  return `SELECT sum(strlen(g) + strlen(s) + strlen(p) + strlen(o)) AS bytes, count(*) AS n FROM (${inner})`;
}

/**
 * Read an N-Quads file into a store, in chunks — because a single string will
 * not do it, and that is a finding rather than an inconvenience.
 *
 * Oxigraph's JavaScript API takes its input as a `string`, and V8 caps a string
 * at 0x1fffffe8 characters (~512 MiB). The 10⁷-operation log's state is 7.0M
 * quads, which is ~810 MB of N-Quads, so `readFileSync(path, 'utf8')` throws
 * `ERR_STRING_TOO_LONG` before Oxigraph is reached at all — no memory pressure,
 * no parse error, just a graph that cannot be handed over in one piece. Every
 * in-process materialisation in this repository loads from a string
 * (`OxigraphStoreLike.load` in `src/oxigraph.ts`, and the API's store manager
 * above it), so the ceiling is not the POC's.
 *
 * N-Quads is line-oriented, so the fix is to hand it over a chunk at a time,
 * cut at the last newline in each read. The carry is kept as a `Buffer` rather
 * than a string: a chunk boundary can fall inside a multi-byte character, and
 * decoding the halves separately would corrupt it. This harness's terms are
 * ASCII, so that cannot bite here — which is exactly why it would be a bad
 * thing to leave to chance in a routine someone might lift.
 */
const CHUNK_BYTES = 64 * 1024 * 1024;

function loadNQuads(
  store: { load(data: string, options: { format: string }): void },
  path: string,
): { readFileMs: number; loadMs: number; chunks: number } {
  const size = statSync(path).size;
  const fd = openSync(path, 'r');
  const buffer = Buffer.allocUnsafe(CHUNK_BYTES);
  let carry = Buffer.alloc(0);
  let offset = 0;
  let readFileMs = 0;
  let loadMs = 0;
  let chunks = 0;

  try {
    while (offset < size) {
      const readStarted = performance.now();
      const bytes = readSync(fd, buffer, 0, CHUNK_BYTES, offset);
      offset += bytes;
      let block = carry.length === 0 ? buffer.subarray(0, bytes) : Buffer.concat([carry, buffer.subarray(0, bytes)]);
      if (offset < size) {
        const cut = block.lastIndexOf(0x0a);
        carry = cut < 0 ? Buffer.from(block) : Buffer.from(block.subarray(cut + 1));
        block = cut < 0 ? Buffer.alloc(0) : block.subarray(0, cut + 1);
      } else {
        carry = Buffer.alloc(0);
      }
      const text = block.toString('utf8');
      readFileMs += performance.now() - readStarted;
      if (text.length === 0) continue;
      const loadStarted = performance.now();
      store.load(text, { format: 'application/n-quads' });
      loadMs += performance.now() - loadStarted;
      chunks += 1;
    }
  } finally {
    closeSync(fd);
  }

  return { readFileMs, loadMs, chunks };
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) continue;
    const [name, inline] = arg.slice(2).split('=');
    out[name!] = inline ?? argv[++i] ?? 'true';
  }
  return out;
}

/** `1e6`, `1_000_000` and `1000000` all mean the same thing on the command line. */
function count(text: string): number {
  return Math.round(Number(text.replace(/_/g, '')));
}

/**
 * Least squares over the checkpointed reconstructions.
 *
 * The model is deliberately the simplest one that could be true — a fixed cost
 * plus a cost per row of tail — because the question is only ever asked in one
 * direction: how much tail fits in a budget. A fit that tracked the data more
 * closely and answered that question no differently would be decoration.
 */
function fitLine(points: Array<{ rows: number; ms: number }>): { interceptMs: number; msPerRow: number } {
  const n = points.length;
  const sumX = points.reduce((a, p) => a + p.rows, 0);
  const sumY = points.reduce((a, p) => a + p.ms, 0);
  const sumXY = points.reduce((a, p) => a + p.rows * p.ms, 0);
  const sumXX = points.reduce((a, p) => a + p.rows * p.rows, 0);
  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return { interceptMs: sumY / n, msPerRow: 0 };
  const msPerRow = (n * sumXY - sumX * sumY) / denominator;
  return { interceptMs: (sumY - msPerRow * sumX) / n, msPerRow };
}

async function measure(shape: LogShape, options: { dbDir: string; oxigraphMaxQuads: number }): Promise<RunResult> {
  const dbPath = join(options.dbDir, `${shape.profile}-${shape.ops}.duckdb`);
  const duck = await openDuck(dbPath);
  try {
    const generateMs = await duck.timed(generateLogSql(shape));
    await duck.run('CHECKPOINT;');
    const logBytesDuckdb = statSync(dbPath).size;

    const summary = await duck.run(`SELECT
        count(*) AS rows,
        count(DISTINCT (g, s, p, o)) AS distinct_quads,
        max(patch) AS patches,
        sum(strlen(g) + strlen(s) + strlen(p) + strlen(o)) + 8 * count(*) AS text_bytes
      FROM patch_log`);
    const logRows = scalar(summary, 'rows');
    const patches = scalar(summary, 'patches');
    const rowsPerPatch = logRows / patches;

    const logParquet = join(options.dbDir, `${shape.profile}-${shape.ops}-log.parquet`);
    await duck.run(`COPY patch_log TO '${logParquet}' (FORMAT parquet, COMPRESSION zstd);`);

    const latestArgMax = await medianMs(duck, materialiseSql(latestArgMaxSql()));
    const latestQualify = await medianMs(duck, materialiseSql(latestQualifySql()));
    const stateQuads = scalar(await duck.run(materialiseSql(latestArgMaxSql())), 'n');

    const asOf: RunResult['asOf'] = [];
    for (const fraction of DEPTHS) {
      const atPatch = Math.max(1, Math.round(patches * fraction));
      asOf.push({ atPatch, ms: await medianMs(duck, materialiseSql(asOfSql(atPatch))) });
    }

    const cadences: CadencePoint[] = [];
    for (const fraction of CADENCES) {
      const atPatch = Math.max(1, Math.floor(patches * fraction));
      const buildMs = await duck.timed(checkpointSql(atPatch));
      const tailRows = scalar(
        await duck.run(`SELECT count(*) AS n FROM patch_log WHERE patch > ${atPatch}`),
        'n',
      );
      const reconstructMs = await medianMs(duck, materialiseSql(fromCheckpointSql(atPatch, patches)));
      cadences.push({ atPatch, tailRows, buildMs, reconstructMs });
    }

    // The alternative the kill criterion names: keep the state itself and read
    // it back, with no log to fold.
    const snapshotBuildMs = await duck.timed(
      `CREATE OR REPLACE TABLE snapshot AS ${latestArgMaxSql()};`,
    );
    const snapshotParquet = join(options.dbDir, `${shape.profile}-${shape.ops}-snapshot.parquet`);
    await duck.run(`COPY snapshot TO '${snapshotParquet}' (FORMAT parquet, COMPRESSION zstd);`);
    const snapshotReadMs = await medianMs(
      duck,
      materialiseSql(`SELECT g, s, p, o FROM read_parquet('${snapshotParquet}')`),
    );

    let materialisation: RunResult['oxigraph'];
    if (stateQuads > options.oxigraphMaxQuads) {
      materialisation = {
        skipped: true,
        why: `state is ${stateQuads} quads, above --oxigraph-max ${options.oxigraphMaxQuads}`,
      };
    } else {
      const nquadsPath = join(options.dbDir, `${shape.profile}-${shape.ops}.nq`);
      // QUOTE '' / ESCAPE '' is what makes the CSV writer hand back the line
      // verbatim; without it every literal's quotes are doubled and the file is
      // not N-Quads at all. The quad count below is what proves it.
      const writeMs = await duck.timed(
        `COPY (${nquadsSql(latestArgMaxSql())}) TO '${nquadsPath}' (FORMAT csv, HEADER false, QUOTE '', ESCAPE '');`,
      );
      const store = new oxigraph.Store();
      const { readFileMs, loadMs, chunks } = loadNQuads(store, nquadsPath);
      if (store.size !== stateQuads) {
        throw new Error(`Oxigraph read back ${store.size} quads, reconstruction said ${stateQuads}`);
      }
      // The same artifact, written from the snapshot instead of from the log:
      // what the two storage strategies cost to hand a store its input.
      const snapshotNquads = join(options.dbDir, `${shape.profile}-${shape.ops}-snapshot.nq`);
      const writeFromSnapshotMs = await duck.timed(
        `COPY (${nquadsSql('SELECT g, s, p, o FROM snapshot')}) TO '${snapshotNquads}' (FORMAT csv, HEADER false, QUOTE '', ESCAPE '');`,
      );
      materialisation = {
        skipped: false,
        nquadsBytes: statSync(nquadsPath).size,
        writeMs,
        writeFromSnapshotMs,
        readFileMs,
        loadMs,
        chunks,
        quads: store.size,
      };
    }

    /*
     * Fitted over the checkpointed reconstructions only, and deliberately not
     * over the whole-log one beside them. They are two different shapes of
     * work: a checkpointed reconstruction scans the checkpoint whatever the
     * tail costs, so its fixed term is a fact about the state size, while the
     * whole-log reconstruction has no checkpoint to scan and its cost is all
     * log. Fitting one line through both would put the second's cost into the
     * first's intercept and answer the cadence question with a number that
     * describes neither.
     */
    const fit = fitLine(cadences.map((c) => ({ rows: c.tailRows, ms: c.reconstructMs.median })));

    return {
      profile: shape.profile,
      ops: shape.ops,
      shape,
      logRows,
      distinctQuads: scalar(summary, 'distinct_quads'),
      stateQuads,
      generateMs,
      logBytesDuckdb,
      logBytesParquetZstd: statSync(logParquet).size,
      logBytesRdfPatchText: scalar(summary, 'text_bytes'),
      latestArgMax,
      latestQualify,
      asOf,
      cadences,
      snapshotBytesParquetZstd: statSync(snapshotParquet).size,
      snapshotBuildMs,
      snapshotReadMs,
      oxigraph: materialisation,
      fit: { interceptMs: fit.interceptMs, msPerMillionTailRows: fit.msPerRow * 1e6 },
      cadenceForBudget: BUDGETS_MS.map((budgetMs) => ({
        budgetMs,
        patches:
          fit.msPerRow <= 0
            ? null
            : Math.max(0, Math.floor((budgetMs - fit.interceptMs) / fit.msPerRow / rowsPerPatch)),
      })),
    };
  } finally {
    duck.close();
  }
}

const MB = 1024 * 1024;
const mb = (bytes: number) => (bytes / MB).toFixed(1);
const ms = (value: number) => value.toFixed(0);

function report(result: RunResult): void {
  const { profile, logRows, stateQuads } = result;
  console.log(`\n## ${profile} — ${logRows.toLocaleString()} log rows, ${result.shape.patches} patches`);
  console.log(
    `state ${stateQuads.toLocaleString()} quads · distinct quads in log ${result.distinctQuads.toLocaleString()} · generated in ${ms(result.generateMs)} ms`,
  );
  console.log(
    `storage: duckdb ${mb(result.logBytesDuckdb)} MB · log parquet+zstd ${mb(result.logBytesParquetZstd)} MB · ` +
      `same log as RDF Patch text ${mb(result.logBytesRdfPatchText)} MB ` +
      `(${(result.logBytesRdfPatchText / result.logBytesParquetZstd).toFixed(1)}x)`,
  );
  console.log(
    `latest: arg_max ${ms(result.latestArgMax.median)} ms (cold ${ms(result.latestArgMax.cold)}) · ` +
      `qualify ${ms(result.latestQualify.median)} ms (cold ${ms(result.latestQualify.cold)})`,
  );
  console.log(
    `as-of: ${result.asOf.map((a) => `p${a.atPatch} ${ms(a.ms.median)} ms`).join(' · ')}`,
  );
  for (const cadence of result.cadences) {
    console.log(
      `checkpoint at p${cadence.atPatch}: tail ${cadence.tailRows.toLocaleString()} rows · ` +
        `build ${ms(cadence.buildMs)} ms · reconstruct ${ms(cadence.reconstructMs.median)} ms`,
    );
  }
  console.log(
    `snapshot alternative: build ${ms(result.snapshotBuildMs)} ms · read ${ms(result.snapshotReadMs.median)} ms · ` +
      `parquet+zstd ${mb(result.snapshotBytesParquetZstd)} MB · ` +
      `log-vs-snapshot ${(result.latestArgMax.median / result.snapshotReadMs.median).toFixed(1)}x`,
  );
  if (result.oxigraph.skipped) {
    console.log(`oxigraph: skipped — ${result.oxigraph.why}`);
  } else {
    const o = result.oxigraph;
    console.log(
      `oxigraph: ${mb(o.nquadsBytes)} MB n-quads · write from log ${ms(o.writeMs)} ms · ` +
        `write from snapshot ${ms(o.writeFromSnapshotMs)} ms · read ${ms(o.readFileMs)} ms · ` +
        `load ${ms(o.loadMs)} ms for ${o.quads.toLocaleString()} quads`,
    );
  }
  console.log(
    `checkpointed fit: ${ms(result.fit.interceptMs)} ms floor (scanning the checkpoint) + ` +
      `${result.fit.msPerMillionTailRows.toFixed(0)} ms per million tail rows · ` +
      result.cadenceForBudget
        .map((b) => `${b.budgetMs} ms budget → checkpoint every ${b.patches ?? '∞'} patches`)
        .join(' · '),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const scales = (args.scales ?? '1e5,1e6').split(',').map(count);
  const profiles = (args.profiles ?? 'reassert,revise').split(',') as ChurnProfile[];
  const patches = count(args.patches ?? '200');
  const oxigraphMaxQuads = count(args['oxigraph-max'] ?? '2e6');

  const dbDir = mkdtempSync(join(args['db-dir'] ?? tmpdir(), 'poc2-'));
  const results: RunResult[] = [];

  console.log(
    `POC-2 · ${cpus()[0]?.model ?? 'unknown cpu'} · ${cpus().length} threads · ` +
      `${(totalmem() / (1024 * 1024 * 1024)).toFixed(1)} GiB · node ${process.version}`,
  );

  try {
    for (const profile of profiles) {
      for (const ops of scales) {
        const shape: LogShape = {
          ...DEFAULT_SHAPE,
          profile,
          ops,
          patches,
          hotPercent: count(args['hot-percent'] ?? String(DEFAULT_SHAPE.hotPercent)),
          hotKeys: count(args['hot-keys'] ?? String(DEFAULT_SHAPE.hotKeys)),
          graphs: count(args.graphs ?? String(DEFAULT_SHAPE.graphs)),
        };
        const result = await measure(shape, { dbDir, oxigraphMaxQuads });
        results.push(result);
        report(result);
      }
    }
  } finally {
    if (args.out) {
      writeFileSync(
        args.out,
        `${JSON.stringify(
          {
            machine: {
              cpu: cpus()[0]?.model ?? 'unknown',
              threads: cpus().length,
              totalmemBytes: totalmem(),
              node: process.version,
            },
            ranAt: new Date().toISOString(),
            results,
          },
          null,
          2,
        )}\n`,
      );
      console.log(`\nwrote ${args.out}`);
    }
    if (!args['keep-db']) rmSync(dbDir, { recursive: true, force: true });
  }
}

await main();
