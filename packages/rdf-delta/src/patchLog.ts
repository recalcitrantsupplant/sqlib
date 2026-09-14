/**
 * The patch log as DuckDB sees it — the storage shape, and the SQL that reads it.
 *
 * The delta-storage work put "patch → DuckDB log" on the roadmap and sized it
 * as a DuckDB log sink plus an AS-OF view. A proof of concept measured the
 * cadence question against a synthetic log, and said of its SQL that *"if the
 * topology survives, the sink writes these statements"*. It survived, so this
 * is that file: the statements, moved out of `poc/patchLogSql.ts` and into the
 * package, with the proof of concept's generator left behind and importing
 * them from here.
 *
 * Nothing here touches a database. These are string builders over a table
 * name, for the reason the POC gave and which holds better now than it did:
 * the SQL *is* the artifact. A reader should be able to see the whole
 * reconstruction rule without a DuckDB process, and a pure builder can be
 * tested against a replay oracle in JavaScript.
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
 * it is what an AS-OF reader wants back out, and POC-2 measured the redundancy
 * it costs: as Parquet+zstd the log is 11.5–14.2× smaller than the same log as
 * RDF Patch text, consistently enough that interning has nothing obvious to
 * win. It stays the obvious next lever, and it is a change to this file rather
 * than to the semantics.
 *
 * ## The default graph is `''`, not NULL
 *
 * The POC generated every quad into a named graph, so it never had to spell
 * the default one. A real patch mostly does not: `DELETE/INSERT WHERE` with no
 * `GRAPH` clause is default-graph throughout. NULL is the obvious spelling and
 * the wrong one — `ANTI JOIN … USING (g, s, p, o)` in
 * {@link fromCheckpointSql} matches on equality, and NULL is not equal to
 * NULL, so every default-graph quad would miss its own checkpoint row and be
 * resurrected. The empty string is not a legal N-Triples term, so it can mean
 * this and nothing else.
 */

/** How the four term columns are spelled everywhere below. */
const QUAD = 'g, s, p, o';

/** The graph column's value for a quad in the default graph. See the module note. */
export const DEFAULT_GRAPH_COLUMN = '';

/**
 * One quad-level operation, as the sink writes it.
 *
 * `seq` is assigned by whoever builds the log and is a property of the log
 * rather than of the patch: it is the total order the reconstruction rule
 * reads, and nothing else in the row can stand in for it.
 */
export interface PatchLogRow {
  seq: number;
  patch: number;
  /** 1 for an addition, 0 for a deletion. */
  op: 0 | 1;
  /** N-Triples graph term, or {@link DEFAULT_GRAPH_COLUMN}. */
  g: string;
  /** N-Triples subject term. */
  s: string;
  /** N-Triples predicate term. */
  p: string;
  /** N-Triples object term. */
  o: string;
}

/**
 * The table a log lives in.
 *
 * Deliberately not `CREATE OR REPLACE`: a caller that wants a fresh table says
 * so, and a caller that appends to an existing one must not silently lose it.
 */
export function createPatchLogTableSql(table = 'patch_log'): string {
  return `CREATE TABLE ${table} (
  seq BIGINT NOT NULL,
  patch BIGINT NOT NULL,
  op TINYINT NOT NULL,
  g VARCHAR NOT NULL,
  s VARCHAR NOT NULL,
  p VARCHAR NOT NULL,
  o VARCHAR NOT NULL
);`;
}

/**
 * Reconstruction, formulation 1: rank the rows naming each quad and keep the
 * latest.
 *
 * `QUALIFY` reads closest to the rule — "the highest-`seq` row naming this
 * quad is an add" is one sentence — and it is the formulation a reader would
 * write first. POC-2 measured it against {@link latestArgMaxSql} rather than
 * choosing between them by taste, and found it **2.1–2.6× slower**, with the
 * gap widening as the log grows. It is kept because the oracle tests compare
 * the two, and because a formulation that is easier to read is worth having
 * where correctness is being argued rather than where rows are being served.
 */
export function latestQualifySql(table = 'patch_log', upToPatch?: number): string {
  const where = upToPatch === undefined ? '' : `\n  WHERE patch <= ${upToPatch}`;
  return `SELECT ${QUAD}
FROM ${table}${where}
QUALIFY row_number() OVER (PARTITION BY ${QUAD} ORDER BY seq DESC) = 1
   AND op = 1`;
}

/**
 * Reconstruction, formulation 2: group by the quad and ask the aggregate which
 * operation won. **This is the one to serve rows from.**
 *
 * Same rule, no window: `arg_max(op, seq)` is the last operation by sequence,
 * and a hash aggregate does not have to sort within each group.
 */
export function latestArgMaxSql(table = 'patch_log', upToPatch?: number): string {
  const where = upToPatch === undefined ? '' : `\n  WHERE patch <= ${upToPatch}`;
  return `SELECT ${QUAD}
FROM ${table}${where}
GROUP BY ${QUAD}
HAVING arg_max(op, seq) = 1`;
}

/** The graph as it stood at the end of `patch` — AS-OF, in one query. */
export function asOfSql(patch: number, table = 'patch_log'): string {
  return latestArgMaxSql(table, patch);
}

/**
 * A checkpoint: the full graph at a patch, stored beside the log.
 *
 * This is the lever POC-2's question was about, and the answer it measured is
 * a rule rather than a number: **checkpoint when the log since the last
 * checkpoint approaches the size of the state**, and below ~10⁶ rows do not
 * bother — the whole log folds in 124–166 ms. Reconstruction from a checkpoint
 * is a checkpoint scan plus a tail fold and those cost the same per row, so no
 * cadence beats the state scan.
 */
export function checkpointSql(atPatch: number, table = 'patch_log', into = 'checkpoint'): string {
  return `CREATE OR REPLACE TABLE ${into} AS
SELECT ${atPatch} AS at_patch, ${QUAD}
FROM (${asOfSql(atPatch, table)});`;
}

/**
 * Reconstruction from a checkpoint: the checkpoint, overlaid with what the log
 * says happened since.
 *
 * The overlay is exact rather than approximate, and the anti-join is what
 * makes it so — a quad the tail mentions is decided by the tail, deleted if
 * its last operation there is a delete, present if it is an add — and a quad
 * the tail never mentions keeps whatever the checkpoint said. Both halves are
 * therefore disjoint, which is why this can be a `UNION ALL` and not the
 * deduplicating `UNION` a first draft reaches for.
 */
export function fromCheckpointSql(
  fromPatch: number,
  toPatch: number,
  table = 'patch_log',
  checkpoint = 'checkpoint',
): string {
  return `WITH tail AS (
  SELECT ${QUAD}, arg_max(op, seq) AS last_op
  FROM ${table}
  WHERE patch > ${fromPatch} AND patch <= ${toPatch}
  GROUP BY ${QUAD}
)
SELECT b.g, b.s, b.p, b.o
FROM (SELECT ${QUAD} FROM ${checkpoint} WHERE at_patch = ${fromPatch}) b
ANTI JOIN tail t USING (${QUAD})
UNION ALL
SELECT ${QUAD} FROM tail WHERE last_op = 1`;
}

/**
 * A set of quads as N-Quads text, one line per row.
 *
 * The terms are already N-Triples, so a line is a join — except for the graph,
 * which is a fourth term on a named-graph line and *absent* on a default-graph
 * one. The POC could write the join unconditionally because every quad it
 * generated sat in a named graph; a real log mostly does not, so the branch is
 * the difference between valid N-Quads and a line with a stray space before
 * the dot.
 */
export function nquadsSql(inner: string): string {
  return `SELECT s || ' ' || p || ' ' || o || CASE WHEN g = '' THEN '' ELSE ' ' || g END || ' .' AS line FROM (${inner})`;
}

/**
 * Churn analytics — use case 9 of the topologies matrix, and the one that is
 * DuckDB's real job rather than a reconstruction it does slower than a
 * snapshot.
 *
 * Per patch: how much it asserted, how much it retracted, and how much of what
 * it touched was already there. The last is the interesting column and the one
 * a log can answer that a pair of snapshots cannot — a pipeline re-asserting
 * the same graph every run reads as high `rewrites` and near-zero net, which
 * is the shape #211's unchanged-re-snapshot rule exists to catch upstream.
 */
export function churnByPatchSql(table = 'patch_log'): string {
  return `SELECT
  patch,
  count(*) FILTER (WHERE op = 1) AS additions,
  count(*) FILTER (WHERE op = 0) AS deletions,
  count(DISTINCT (g, s, p, o)) AS quads_touched,
  count(*) - count(DISTINCT (g, s, p, o)) AS rewrites
FROM ${table}
GROUP BY patch
ORDER BY patch`;
}

/**
 * The quads a log churns hardest, newest operation first.
 *
 * "Hot subjects" in the matrix's §2 row 9. Counted over operations rather than
 * patches, because a quad written twice in one patch is two writes.
 */
export function hotQuadsSql(table = 'patch_log', limit = 50): string {
  return `SELECT ${QUAD}, count(*) AS writes, max(seq) AS last_seq, max(patch) AS last_patch
FROM ${table}
GROUP BY ${QUAD}
ORDER BY writes DESC, last_seq DESC
LIMIT ${limit}`;
}
