/**
 * The oracle: last-write-wins, evaluated by walking the log.
 *
 * `patchLogSql.ts` states the rule three times — as a window, as an aggregate,
 * and as a checkpoint plus an anti-joined tail — and all three are optimised
 * shapes of one sentence. This file is that sentence written the slow, obvious
 * way, in a language with no query planner: sort the rows, apply them in
 * order, see what is left.
 *
 * It exists so the measurement harness can be *checked* rather than believed.
 * A reconstruction query that is subtly wrong still returns rows and still
 * produces a timing, and a timing is what the POC reports — so the thing that
 * decides whether the topology survives has to be compared against something
 * that could not have made the same mistake.
 */

export interface LogRow {
  seq: number;
  patch: number;
  op: number;
  g: string;
  s: string;
  p: string;
  o: string;
}

/** The quad's identity, as one string. Tab-joined: no term may contain one. */
export function quadKey(row: { g: string; s: string; p: string; o: string }): string {
  return [row.g, row.s, row.p, row.o].join('\t');
}

/**
 * The graph after applying every row up to and including `upToPatch`.
 *
 * Returns the surviving quads' keys. A caller that wants terms back can split
 * them; nothing in the tests does, because set equality is the whole question.
 */
export function replay(rows: LogRow[], upToPatch = Number.POSITIVE_INFINITY): Set<string> {
  const ordered = [...rows].filter((r) => r.patch <= upToPatch).sort((a, b) => a.seq - b.seq);
  const state = new Set<string>();
  for (const row of ordered) {
    const key = quadKey(row);
    if (row.op === 1) state.add(key);
    else state.delete(key);
  }
  return state;
}

/**
 * Whether the log is well-formed: nothing added while present, nothing deleted
 * while absent.
 *
 * Last-write-wins does not need this — it is defined for any sequence — so the
 * property is not load-bearing for reconstruction. It is load-bearing for the
 * generator: an accidental change to the churn model that made every hot touch
 * a redundant re-assertion would leave every reconstruction test passing and
 * quietly stop measuring churn at all.
 */
export function firstMalformed(rows: LogRow[]): { row: LogRow; why: string } | null {
  const ordered = [...rows].sort((a, b) => a.seq - b.seq);
  const state = new Set<string>();
  for (const row of ordered) {
    const key = quadKey(row);
    if (row.op === 1) {
      if (state.has(key)) return { row, why: 'added a quad that was already present' };
      state.add(key);
    } else {
      if (!state.has(key)) return { row, why: 'deleted a quad that was absent' };
      state.delete(key);
    }
  }
  return null;
}
