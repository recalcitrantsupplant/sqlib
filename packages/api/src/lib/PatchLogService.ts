/**
 * The DuckDB half of the patch-log sink: a log, materialised and folded.
 *
 * The delta-storage design sizes this as "DuckDB log sink + AS-OF view", gated
 * on POC-2. POC-2 ran and did not kill option B, with the boundary it drew
 * being the one this service sits on: reconstruction is 2.9–9.6× slower than
 * reading a snapshot when the state is the deliverable, and that ratio *is* the
 * whole latency where the question is answered inside DuckDB and never
 * materialised. So this answers questions in DuckDB — AS-OF, churn, hot
 * quads — rather than pretending to be a store.
 *
 * ## Its own database, and why
 *
 * The delta-storage design left open whether the ETL DuckDB instance hosts the
 * patch log "or does the log get its own instance with its own capability
 * profile". Its own, with the **strictest** profile, and the argument is short:
 * the log runs sqlib's own SQL and never a caller's. ETL's profile exists to be
 * widened — `ETL_DUCKDB_ALLOW_HTTP`, `ETL_DUCKDB_UNRESTRICTED` and the rest are
 * there because an ETL job legitimately reads a file or a URL — and #132 is the
 * record of how carefully that grant has to be contained. A log that shared the
 * instance would inherit every widening for no benefit, since none of the SQL
 * here names anything outside the process. A fixed closed profile also means
 * this service behaves identically in every deployment, which is what makes a
 * reconstruction reproducible.
 *
 * The database is per call and dies with it. Nothing here is cached: the log
 * lives in the triplestore, and a stale copy of history is worse than no copy.
 */

import {
  asOfSql,
  churnByPatchSql,
  createPatchLogTableSql,
  hotQuadsSql,
  latestArgMaxSql,
  nquadsSql,
  type PatchLogRow,
} from '@sparql-query-lib/rdf-delta';

/** The slice of `@duckdb/node-api` this service uses. Structural, for the same reason `DuckDbService` states it structurally: the import is dynamic so DuckDB stays optional. */
type ConnectionLike = {
  run(sql: string): Promise<unknown>;
  runAndReadAll(sql: string): Promise<{ getRowObjectsJson(): Record<string, unknown>[] }>;
  closeSync(): void;
};
type InstanceLike = {
  connect(): Promise<ConnectionLike>;
  closeSync(): void;
};
type InstanceFactoryLike = {
  create(path: string, config: Record<string, string>): Promise<InstanceLike>;
};

/**
 * The profile the patch log runs under, in full.
 *
 * Written as a literal rather than derived from `duckDbInstanceConfig`, because
 * the point of decision 4 is that this is *not* the ETL profile and must not
 * start tracking it. `enable_external_access=false` is the whole boundary: with
 * it off, no `read_csv`, no `httpfs`, no attach of a file on disk.
 */
export const PATCH_LOG_DUCKDB_CONFIG: Record<string, string> = {
  enable_external_access: 'false',
  autoinstall_known_extensions: 'false',
  autoload_known_extensions: 'false',
};

const TABLE = 'patch_log';
/** Rows per `INSERT`. Large enough that a 10⁶-row log is a thousand statements, small enough that a statement stays a readable size. */
const INSERT_BATCH = 1000;

export class PatchLogUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PatchLogUnavailableError';
  }
}

export interface ChurnRow {
  patch: number;
  additions: number;
  deletions: number;
  quadsTouched: number;
  rewrites: number;
}

export interface HotQuadRow {
  graph: string;
  subject: string;
  predicate: string;
  object: string;
  writes: number;
  lastPatch: number;
}

export interface PatchLogAnalysis {
  /** The reconstructed state, as N-Quads lines. Absent unless asked for. */
  nquads?: string[];
  /** How many quads the state holds, always reported when a state was folded. */
  quadCount?: number;
  churn?: ChurnRow[];
  hotQuads?: HotQuadRow[];
}

export interface PatchLogRequest {
  /** Fold the log and return the state. `asOf` is a 1-based patch ordinal; omitted means the head. */
  state?: { asOf?: number; nquads: boolean };
  churn?: boolean;
  hotQuads?: { limit: number };
}

/** A DuckDB single-quoted string literal. Doubling the quote is the whole rule: DuckDB follows the SQL standard, so a backslash inside `'…'` is a backslash. */
function literal(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function insertStatements(rows: readonly PatchLogRow[]): string[] {
  const statements: string[] = [];
  for (let start = 0; start < rows.length; start += INSERT_BATCH) {
    const values = rows
      .slice(start, start + INSERT_BATCH)
      .map((row) =>
        `(${row.seq}, ${row.patch}, ${row.op}, ${literal(row.g)}, ${literal(row.s)}, ${literal(row.p)}, ${literal(row.o)})`,
      )
      .join(',\n  ');
    statements.push(`INSERT INTO ${TABLE} VALUES\n  ${values};`);
  }
  return statements;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value);
  return NaN;
}

export class PatchLogService {
  private factory: InstanceFactoryLike | null = null;
  private readonly initPromise: Promise<void>;
  private available = false;
  private unavailableReason = 'DuckDB has not finished loading.';

  constructor() {
    this.initPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      const duckdb = await import('@duckdb/node-api');
      this.factory = duckdb.DuckDBInstance as unknown as InstanceFactoryLike;
      this.available = true;
    } catch (error__u: unknown) {
      const error = error__u instanceof Error ? error__u : new Error(String(error__u));
      this.factory = null;
      this.available = false;
      this.unavailableReason =
        `DuckDB is not installed, so the patch log cannot be queried (${error.message}). `
        + 'Install @duckdb/node-api to enable it.';
    }
  }

  async waitForInit(): Promise<void> {
    await this.initPromise;
  }

  async isAvailable(): Promise<boolean> {
    await this.initPromise;
    return this.available;
  }

  /**
   * Materialise the rows into a private database and answer what was asked.
   *
   * One database, one connection, one call: every question in a `PatchLogRequest`
   * is answered against the same materialisation, because loading the log is the
   * expensive half and asking it two things should not pay for it twice.
   */
  async analyse(rows: readonly PatchLogRow[], request: PatchLogRequest): Promise<PatchLogAnalysis> {
    await this.initPromise;
    if (!this.available || !this.factory) {
      throw new PatchLogUnavailableError(this.unavailableReason);
    }

    const instance = await this.factory.create(':memory:', PATCH_LOG_DUCKDB_CONFIG);
    let connection: ConnectionLike | null = null;
    try {
      connection = await instance.connect();
      // Lock the configuration for the same reason `DuckDbService` does at boot:
      // it costs nothing and it means a future statement cannot widen the profile.
      await connection.run('SET lock_configuration=true');
      await connection.run(createPatchLogTableSql(TABLE));
      for (const statement of insertStatements(rows)) {
        await connection.run(statement);
      }

      const analysis: PatchLogAnalysis = {};

      if (request.state) {
        const fold = request.state.asOf === undefined
          ? latestArgMaxSql(TABLE)
          : asOfSql(request.state.asOf, TABLE);
        const counted = await connection.runAndReadAll(
          `SELECT count(*) AS quad_count FROM (${fold})`,
        );
        analysis.quadCount = toNumber(counted.getRowObjectsJson()[0]?.quad_count);
        if (request.state.nquads) {
          const lines = await connection.runAndReadAll(nquadsSql(fold));
          analysis.nquads = lines
            .getRowObjectsJson()
            .map((row) => String(row.line ?? ''));
        }
      }

      if (request.churn) {
        const result = await connection.runAndReadAll(churnByPatchSql(TABLE));
        analysis.churn = result.getRowObjectsJson().map((row) => ({
          patch: toNumber(row.patch),
          additions: toNumber(row.additions),
          deletions: toNumber(row.deletions),
          quadsTouched: toNumber(row.quads_touched),
          rewrites: toNumber(row.rewrites),
        }));
      }

      if (request.hotQuads) {
        const result = await connection.runAndReadAll(hotQuadsSql(TABLE, request.hotQuads.limit));
        analysis.hotQuads = result.getRowObjectsJson().map((row) => ({
          graph: String(row.g ?? ''),
          subject: String(row.s ?? ''),
          predicate: String(row.p ?? ''),
          object: String(row.o ?? ''),
          writes: toNumber(row.writes),
          lastPatch: toNumber(row.last_patch),
        }));
      }

      return analysis;
    } finally {
      connection?.closeSync();
      instance.closeSync();
    }
  }
}
