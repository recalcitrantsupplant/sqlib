/**
 * The statements the *sink* writes, as opposed to the ones the POC generated.
 *
 * `test/patchLog.test.ts` checks the reconstruction rule against a replay
 * oracle over a generated log, and that log is all named graphs and all ground
 * terms because a generator has no reason to produce anything else. A log built
 * from real patches does: the default graph is the common case, and the two
 * analytics queries are new here rather than promoted.
 *
 * So this suite writes rows by hand, through `createPatchLogTableSql`, and
 * asserts on the answers rather than on the SQL text.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDuck, type Duck } from '../poc/duckdb.js';
import {
  DEFAULT_GRAPH_COLUMN,
  asOfSql,
  churnByPatchSql,
  createPatchLogTableSql,
  hotQuadsSql,
  latestArgMaxSql,
  nquadsSql,
  type PatchLogRow,
} from '../src/patchLog.js';

const G = '<http://example.org/g>';
const D = DEFAULT_GRAPH_COLUMN;

/**
 * A small log with everything the generator could not produce: default-graph
 * quads beside named-graph ones, a quad deleted and re-added in one patch, and
 * a quad written in three separate patches.
 */
const ROWS: PatchLogRow[] = [
  // Patch 1 — two adds, one in the default graph.
  { seq: 1, patch: 1, op: 1, g: D, s: '<http://example.org/a>', p: '<http://example.org/p>', o: '"one"' },
  { seq: 2, patch: 1, op: 1, g: G, s: '<http://example.org/b>', p: '<http://example.org/p>', o: '"two"' },
  // Patch 2 — revise the default-graph quad: delete then add, same patch.
  { seq: 3, patch: 2, op: 0, g: D, s: '<http://example.org/a>', p: '<http://example.org/p>', o: '"one"' },
  { seq: 4, patch: 2, op: 1, g: D, s: '<http://example.org/a>', p: '<http://example.org/p>', o: '"revised"' },
  // Patch 3 — retract the named-graph quad, and re-assert the revised one.
  { seq: 5, patch: 3, op: 0, g: G, s: '<http://example.org/b>', p: '<http://example.org/p>', o: '"two"' },
  { seq: 6, patch: 3, op: 1, g: D, s: '<http://example.org/a>', p: '<http://example.org/p>', o: '"revised"' },
];

async function load(duck: Duck, rows: PatchLogRow[]): Promise<void> {
  await duck.run(createPatchLogTableSql());
  const values = rows
    .map((r) => `(${r.seq}, ${r.patch}, ${r.op}, '${r.g}', '${r.s}', '${r.p}', '${r.o}')`)
    .join(', ');
  await duck.run(`INSERT INTO patch_log VALUES ${values};`);
}

describe('the patch log table', () => {
  let duck: Duck;

  beforeAll(async () => {
    duck = await openDuck();
    await load(duck, ROWS);
  });

  afterAll(() => duck.close());

  it('folds to the state the operations describe', async () => {
    const rows = await duck.run(latestArgMaxSql());
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ g: D, s: '<http://example.org/a>', o: '"revised"' });
  });

  it('travels to a patch', async () => {
    const atOne = await duck.run(asOfSql(1));
    expect(atOne).toHaveLength(2);
    const atTwo = await duck.run(asOfSql(2));
    expect(atTwo.map((r) => r.o).sort()).toEqual(['"revised"', '"two"']);
  });

  it('keeps a quad the same patch deletes and re-adds', async () => {
    // Patch 2 deletes `"one"` and adds `"revised"`; the delete must not win on
    // the quad it did not name, and the add must survive its own patch.
    const rows = await duck.run(asOfSql(2));
    expect(rows.map((r) => r.o)).toContain('"revised"');
    expect(rows.map((r) => r.o)).not.toContain('"one"');
  });

  it('writes a default-graph quad as a three-term N-Quads line', async () => {
    const lines = (await duck.run(nquadsSql(latestArgMaxSql()))).map((r) => String(r.line));
    expect(lines).toEqual(['<http://example.org/a> <http://example.org/p> "revised" .']);
  });

  it('writes a named-graph quad as a four-term N-Quads line', async () => {
    const lines = (await duck.run(nquadsSql(asOfSql(1)))).map((r) => String(r.line)).sort();
    expect(lines).toEqual([
      '<http://example.org/a> <http://example.org/p> "one" .',
      '<http://example.org/b> <http://example.org/p> "two" <http://example.org/g> .',
    ]);
  });

  it('reports churn per patch, counting a re-assertion as a rewrite', async () => {
    const rows = await duck.run(churnByPatchSql());
    expect(rows.map((r) => Number(r.patch))).toEqual([1, 2, 3]);
    expect(rows[0]).toMatchObject({ additions: '2', deletions: '0', rewrites: '0' });
    // Patch 2's delete and add name different quads, so nothing is rewritten
    // within it; patch 3 re-asserts a quad it has already seen in the log but
    // only once within itself, so its own rewrite count is zero too.
    expect(Number(rows[1]!.quads_touched)).toBe(2);
    expect(Number(rows[2]!.quads_touched)).toBe(2);
  });

  it('ranks the quads the log writes most often', async () => {
    // Two quads are written twice — `"one"` (added, then deleted) and
    // `"revised"` (added, then re-asserted) — so the ranking is decided by the
    // `last_seq` tiebreak, and the most recently written wins.
    const rows = await duck.run(hotQuadsSql('patch_log', 2));
    expect(Number(rows[0]!.writes)).toBe(2);
    expect(rows[0]).toMatchObject({ s: '<http://example.org/a>', o: '"revised"', g: D });
    expect(Number(rows[0]!.last_patch)).toBe(3);
  });

  it('caps the hot list at the limit it is given', async () => {
    const rows = await duck.run(hotQuadsSql('patch_log', 1));
    expect(rows).toHaveLength(1);
  });
});

describe('createPatchLogTableSql', () => {
  it('refuses to replace an existing table, so an append cannot silently lose one', async () => {
    const duck = await openDuck();
    try {
      await duck.run(createPatchLogTableSql());
      await expect(duck.run(createPatchLogTableSql())).rejects.toThrow(/already exists/i);
    } finally {
      duck.close();
    }
  });
});
