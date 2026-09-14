/**
 * The POC-2 harness, checked.
 *
 * `poc/run.ts` reports timings, and a timing is believable whatever the query
 * returned — a reconstruction that drops half the graph is fast and wrong, and
 * nothing about the number says so. So every query the harness measures is
 * compared here against `replay()`, which evaluates the same rule by walking
 * the log in JavaScript with no planner to be clever on its behalf.
 *
 * Small and deterministic on purpose: a few thousand rows is enough for every
 * branch of the churn model to fire, and the suite is a unit test rather than
 * the measurement run.
 */

import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import oxigraph from 'oxigraph';
import { openDuck, scalar, type Duck } from '../poc/duckdb.js';
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
} from '../poc/patchLogSql.js';
import { firstMalformed, quadKey, replay, type LogRow } from '../poc/replayOracle.js';

const PATCHES = 40;

function shapeFor(profile: ChurnProfile): LogShape {
  return { ...DEFAULT_SHAPE, profile, ops: 3000, patches: PATCHES, hotPercent: 45, hotKeys: 120, graphs: 3 };
}

async function readLog(duck: Duck): Promise<LogRow[]> {
  const rows = await duck.run('SELECT seq, patch, op, g, s, p, o FROM patch_log');
  return rows.map((r) => ({
    seq: Number(r.seq),
    patch: Number(r.patch),
    op: Number(r.op),
    g: String(r.g),
    s: String(r.s),
    p: String(r.p),
    o: String(r.o),
  }));
}

async function keysOf(duck: Duck, sql: string): Promise<Set<string>> {
  const rows = await duck.run(sql);
  return new Set(rows.map((r) => quadKey({ g: String(r.g), s: String(r.s), p: String(r.p), o: String(r.o) })));
}

describe.each<ChurnProfile>(['reassert', 'revise'])('patch log — %s profile', (profile) => {
  let duck: Duck;
  let rows: LogRow[];

  beforeAll(async () => {
    duck = await openDuck();
    await duck.run(generateLogSql(shapeFor(profile)));
    rows = await readLog(duck);
  });

  afterAll(() => duck.close());

  it('generates a log with churn in it', () => {
    expect(rows.length).toBeGreaterThan(1000);
    // Deletes are what makes this a log rather than a load: without them every
    // reconstruction below would be a distinct-quads count and would pass on a
    // query that ignored `op` entirely.
    const deletes = rows.filter((r) => r.op === 0).length;
    expect(deletes).toBeGreaterThan(rows.length / 10);
    // And the churn has to reach the same quads twice, or the two profiles
    // would differ in name only.
    const distinct = new Set(rows.map(quadKey));
    expect(distinct.size).toBeLessThan(rows.length);
  });

  it('emits a well-formed log — nothing added twice, nothing deleted while absent', () => {
    expect(firstMalformed(rows)).toBeNull();
  });

  it('reconstructs the latest graph, both formulations, exactly as a replay does', async () => {
    const expected = replay(rows);
    expect(expected.size).toBeGreaterThan(100);
    await expect(keysOf(duck, latestArgMaxSql())).resolves.toEqual(expected);
    await expect(keysOf(duck, latestQualifySql())).resolves.toEqual(expected);
  });

  it('answers AS-OF at every depth the harness measures', async () => {
    for (const fraction of [0.1, 0.5, 0.9, 1]) {
      const patch = Math.max(1, Math.round(PATCHES * fraction));
      await expect(keysOf(duck, asOfSql(patch))).resolves.toEqual(replay(rows, patch));
    }
  });

  it('reconstructs from a checkpoint plus the tail, at every cadence', async () => {
    for (const fraction of [0.5, 0.9, 0.99]) {
      const at = Math.max(1, Math.floor(PATCHES * fraction));
      await duck.run(checkpointSql(at));
      await expect(keysOf(duck, fromCheckpointSql(at, PATCHES))).resolves.toEqual(replay(rows));
      // A checkpoint is only a shortcut if it also answers for the patches
      // between itself and the head, which is what an AS-OF reader asks for.
      const mid = Math.min(PATCHES, at + 1);
      await expect(keysOf(duck, fromCheckpointSql(at, mid))).resolves.toEqual(replay(rows, mid));
    }
  });

  it('renders the reconstructed graph as N-Quads Oxigraph reads back quad for quad', async () => {
    const expected = replay(rows);
    const lines = await duck.run(nquadsSql(latestArgMaxSql()));
    const text = lines.map((r) => String(r.line)).join('\n');

    const store = new oxigraph.Store();
    store.load(text, { format: 'application/n-quads' });
    expect(store.size).toBe(expected.size);
  });

  it('counts the same graph through the parquet round trip the harness measures', async () => {
    const file = `/tmp/poc2-${profile}-${process.pid}.parquet`;
    await duck.run(`COPY (${latestArgMaxSql()}) TO '${file}' (FORMAT parquet, COMPRESSION zstd);`);
    const back = await duck.run(`SELECT count(*) AS n FROM read_parquet('${file}')`);
    expect(scalar(back, 'n')).toBe(replay(rows).size);
  });
});

describe('the two profiles differ in the way the POC turns on', () => {
  it('revise grows distinct quads with the log; reassert does not', async () => {
    const counts: Record<ChurnProfile, { rows: number; distinct: number }> = {
      reassert: { rows: 0, distinct: 0 },
      revise: { rows: 0, distinct: 0 },
    };

    for (const profile of ['reassert', 'revise'] as const) {
      const duck = await openDuck();
      await duck.run(generateLogSql(shapeFor(profile)));
      const summary = await duck.run(
        `SELECT count(*) AS rows, count(DISTINCT (g, s, p, o)) AS distinct_quads FROM patch_log`,
      );
      counts[profile] = { rows: scalar(summary, 'rows'), distinct: scalar(summary, 'distinct_quads') };
      duck.close();
    }

    // The claim the design note rests on: under re-assertion the group-by that
    // reconstructs the graph has far fewer groups than the log has rows, and
    // under revision it has nearly one per row.
    expect(counts.reassert.distinct).toBeLessThan(counts.reassert.rows * 0.8);
    expect(counts.revise.distinct).toBeGreaterThan(counts.revise.rows * 0.45);
  });
});
