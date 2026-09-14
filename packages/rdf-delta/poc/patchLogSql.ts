/**
 * POC-2 — the DuckDB patch log, written as SQL.
 *
 * The delta-storage work asks one question of option B: *what checkpoint
 * cadence keeps reconstruction bounded?*, with the kill criterion
 * "reconstruction is slower than simply keeping snapshots".
 * Answering it needs a log to reconstruct from, and no log exists yet — MVP-2
 * is unbuilt — so the POC generates one.
 *
 * Everything here is a string builder rather than a live query, for two
 * reasons. The SQL is the artifact the POC is really about: if the topology
 * survives, the sink writes *these* statements, and a reader should be able to
 * read them without a DuckDB process. And a pure builder can be run against a
 * tiny log in `test/patchLog.test.ts` and compared to a replay oracle in
 * JavaScript, so the measurement harness is checked for correctness by the
 * unit suite rather than trusted because it produced a number.
 *
 * **Since the topology survived, the reader SQL moved to `src/patchLog.ts`**
 * and is re-exported at the foot of this file, so the generator and the sink
 * cannot disagree about what they are reading. The storage shape below is
 * documented there too, and authoritatively; it is repeated here because the
 * generator has to emit it.
 *
 * ## The storage shape
 *
 * One append-only table. A row is one quad-level operation:
 *
 * | column | meaning |
 * |---|---|
 * | `seq` | total order across the whole log; the only tiebreak that matters |
 * | `patch` | which patch the row arrived in — the unit a caller asks to travel to |
 * | `op` | 1 add, 0 delete |
 * | `g,s,p,o` | the quad, as N-Triples-encoded terms |
 *
 * The quad's identity is the four term columns together, which is what makes
 * reconstruction a last-write-wins group-by: a quad is in the graph at patch
 * *k* when the highest-`seq` row naming it at or before *k* is an add. That
 * rule is the whole semantics, and every query below is a way of evaluating it
 * over a different slice.
 *
 * Terms are stored as their N-Triples text rather than as an interned id.
 * That is the shape a patch already has on the way in (see `patchToNQuads`),
 * it is what an AS-OF reader wants back out, and the compression ratio the POC
 * measures is precisely the question of whether the redundancy that costs is
 * worth an id table. Interning is the obvious next lever if the answer is no,
 * and it is a change to this file rather than to the semantics.
 */

/** The two churn models the POC contrasts. See {@link generateLogSql}. */
export type ChurnProfile = 'reassert' | 'revise';

export interface LogShape {
  /**
   * How many operations to sample. The emitted row count equals this under
   * `reassert` and exceeds it under `revise` (a revision is a delete and an
   * add), so the harness measures the rows it got rather than assuming.
   */
  ops: number;
  /** How many patches the operations are grouped into. */
  patches: number;
  profile: ChurnProfile;
  /** Percentage of operations that land on the churned population. */
  hotPercent: number;
  /** Size of the churned population — the smaller it is, the deeper the churn. */
  hotKeys: number;
  /** How many named graphs the quads are spread over. */
  graphs: number;
  seed: number;
}

export const DEFAULT_SHAPE: Omit<LogShape, 'ops' | 'patches'> = {
  profile: 'reassert',
  hotPercent: 30,
  hotKeys: 50_000,
  graphs: 8,
  seed: 20260908,
};

/**
 * The terms of a quad, as expressions over a key id and a revision.
 *
 * Every column has to be a pure function of `key_id` (and, under `revise`, of
 * the revision), because that is what makes a key re-touchable: two rows
 * naming the same key must produce byte-identical `g,s,p,o` or they are two
 * quads and there is no churn to measure.
 *
 * `kh` is the key's own hash, so the predicate and graph a key uses are stable
 * for its whole life while still being spread across the vocabulary.
 */
function terms(keyExpr: string, revExpr: string, shape: LogShape) {
  const kh = `hash(${keyExpr} * 2654435761 + ${shape.seed})`;
  return {
    kh,
    g: `'<http://example.org/graph/' || (${kh} % ${shape.graphs}) || '>'`,
    s: `'<http://example.org/entity/' || ${keyExpr} || '>'`,
    p: `'<http://example.org/prop/' || ((${kh} >> 3) % 12) || '>'`,
    /*
     * Sixty per cent IRIs, forty per cent literals — a mix rather than one
     * shape, because the compression ratio this POC reports is a fact about
     * the strings and a log of nothing but IRIs off one prefix would flatter
     * it. The revision is part of the object, which is what makes a `revise`
     * touch a different quad rather than a re-assertion of the same one.
     */
    o:
      `CASE WHEN ((${kh} >> 11) % 5) < 3 ` +
      `THEN '<http://example.org/entity/' || ((${kh} >> 17) % 1000003 + ${revExpr}) || '>' ` +
      `ELSE '"value-' || ((${kh} >> 23) % 997) || '-' || ${revExpr} || '"' END`,
  };
}

/**
 * The generator.
 *
 * Deterministic in `seed`, and set-based: a ten-million-row log is one
 * statement rather than ten million round trips, which is the only reason the
 * largest scale is runnable at all.
 *
 * ## The two profiles, and why both
 *
 * `reassert` — a hot key is added, deleted, added again, the *same quad* each
 * time. Distinct keys stay bounded no matter how long the log runs, so the
 * group-by that reconstructs the graph has a fixed cardinality.
 *
 * `revise` — a hot key's value is replaced: the touch deletes revision *r-1*
 * and adds revision *r*, which are two different quads. Distinct keys grow
 * with the log, so the same group-by grows with it too.
 *
 * The distinction is not cosmetic and it is why the POC refuses to answer with
 * one number. `DELETE { ?s :p ?old } INSERT { ?s :p ?new } WHERE …` — the
 * commonest shape of update this repository derives patches from — is the
 * second profile, and it is the one whose reconstruction cost has no ceiling.
 *
 * Both profiles emit a **well-formed** log: no quad is added while present or
 * deleted while absent. Last-write-wins tolerates either, so well-formedness
 * buys nothing for the queries below; it is what lets a later pass replay the
 * log forward into a store and compare, without first having to decide what a
 * redundant operation means.
 */
export function generateLogSql(shape: LogShape, table = 'patch_log'): string {
  const rowsPerPatch = Math.max(1, Math.ceil(shape.ops / shape.patches));

  /*
   * Cold keys are `hotKeys + n`, so they are unique by construction and can
   * never collide with the hot population — one touch each, for the whole
   * length of the log.
   */
  const preamble = `
WITH ops AS (
  SELECT i AS n, hash(i * 2654435761 + ${shape.seed}) AS h
  FROM range(0, ${shape.ops}) t(i)
),
keyed AS (
  SELECT n, h,
    CASE WHEN (h % 100) < ${shape.hotPercent}
         THEN (h >> 7) % ${shape.hotKeys}
         ELSE ${shape.hotKeys} + n END AS key_id
  FROM ops
),
touched AS (
  SELECT n, key_id, row_number() OVER (PARTITION BY key_id ORDER BY n) AS t
  FROM keyed
)`;

  if (shape.profile === 'reassert') {
    const t = terms('key_id', '0', shape);
    return `CREATE OR REPLACE TABLE ${table} AS${preamble}
SELECT
  n AS seq,
  (n // ${rowsPerPatch}) + 1 AS patch,
  CAST(CASE WHEN t % 2 = 1 THEN 1 ELSE 0 END AS TINYINT) AS op,
  ${t.g} AS g,
  ${t.s} AS s,
  ${t.p} AS p,
  ${t.o} AS o
FROM touched;`;
  }

  /*
   * `seq` is doubled so the delete of the superseded revision sorts before the
   * add that supersedes it. They share a patch: a revision is one edit.
   */
  const t = terms('key_id', 'rev', shape);
  return `CREATE OR REPLACE TABLE ${table} AS${preamble},
emitted AS (
  SELECT n * 2 + 1 AS seq, (n // ${rowsPerPatch}) + 1 AS patch, 1 AS op, key_id, t AS rev
  FROM touched
  UNION ALL
  SELECT n * 2 AS seq, (n // ${rowsPerPatch}) + 1 AS patch, 0 AS op, key_id, t - 1 AS rev
  FROM touched WHERE t > 1
)
SELECT
  seq,
  patch,
  CAST(op AS TINYINT) AS op,
  ${t.g} AS g,
  ${t.s} AS s,
  ${t.p} AS p,
  ${t.o} AS o
FROM emitted;`;
}

/*
 * The reader SQL used to live here. It is now `src/patchLog.ts`: the POC's
 * question survived, and this file said of those statements that "if the topology survives, the sink
 * writes these statements" — so they moved to where the sink can import them,
 * and the POC imports them back rather than keeping a second copy that could
 * drift. What stays here is the half that is only ever a POC: the generator.
 */
export {
  asOfSql,
  checkpointSql,
  fromCheckpointSql,
  latestArgMaxSql,
  latestQualifySql,
  nquadsSql,
} from '../src/patchLog.js';
