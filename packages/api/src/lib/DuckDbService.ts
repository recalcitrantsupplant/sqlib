/**
 * DuckDB Service for ETL operations
 *
 * Provides schema detection, preview, and query execution using DuckDB Neo client.
 * This is an optional service - if DuckDB is not available, ETL features will be disabled.
 */

import {
  describeDuckDbCapabilities,
  describeDuckDbLimits,
  duckDbInstanceConfig,
  resolveDuckDbCapabilities,
  resolveDuckDbLimits,
  type DuckDbCapabilities,
  type DuckDbLimits,
} from './duckdbCapabilities.js';
import { toError } from './toError.js';

export interface DuckDbColumn {
  columnName: string;
  duckdbType: string;
  nullable: boolean;
}

export interface PreviewResult {
  schema: DuckDbColumn[];
  rows: Record<string, unknown>[];
}

export interface QueryResult {
  rows: Record<string, unknown>[];
}

/**
 * What `DuckDbService.checkExtension` found for one extension on this runtime.
 *
 * `installed` and `loaded` are separate because they fail for different
 * reasons: no published build for this platform fails the install (a 404 from
 * the extension repository), while an ABI or capability problem fails the load
 * of something already fetched.
 */
export interface DuckDbExtensionCheck {
  extension: string;
  /** DuckDB's platform string, which is what an extension is published against. */
  platform: string;
  installed: boolean;
  loaded: boolean;
  /** The first failure, when either step failed. */
  error?: string;
}

/**
 * The slice of `@duckdb/node-api` this service uses, described structurally so
 * the sandbox wiring is typed without the package's types being imported at the
 * top level — the import is deliberately dynamic, so ETL stays optional.
 */
type DuckDbResultLike = {
  getRowObjects(): Record<string, unknown>[];
  getRowObjectsJson(): Record<string, unknown>[];
};

/**
 * One DuckDB data chunk — the unit `fetchChunk` hands back, typically 2048 rows.
 * `convertRows` takes the binding's own value converter, which this service only
 * ever passes through, so it is `unknown` here rather than a type imported from
 * the package the service refuses to depend on statically.
 */
type DuckDbDataChunkLike = {
  readonly rowCount: number;
  convertRows(converter: unknown): unknown[][];
};

type DuckDbStreamResultLike = {
  deduplicatedColumnNames(): string[];
  fetchChunk(): Promise<DuckDbDataChunkLike | null>;
};

type DuckDbConnectionLike = {
  run(sql: string): Promise<unknown>;
  interrupt(): void;
  runAndReadAll(sql: string): Promise<DuckDbResultLike>;
  stream(sql: string): Promise<DuckDbStreamResultLike>;
  closeSync(): void;
};

type DuckDbInstanceLike = {
  connect(): Promise<DuckDbConnectionLike>;
  /** Releases the database. Only a fixture run creates an instance to release. */
  closeSync(): void;
};

/**
 * The binding's `DuckDBInstance` static, as far as this service uses it.
 *
 * Described structurally like everything else here, rather than typed `any` as
 * `DuckDBConnection` still is: the one call made through it takes the same
 * config `duckDbInstanceConfig` produces, so there is a real signature to state.
 */
type DuckDbInstanceFactoryLike = {
  create(path: string, config: Record<string, string>): Promise<DuckDbInstanceLike>;
};

/**
 * Per-chunk cost. `initMs` and `connectionMs` are once-per-stream costs and are
 * reported on the first chunk only, zero thereafter — before #201 a chunk was a
 * whole execution on its own connection, so both were paid again every chunk.
 */
export interface DuckDbChunkTiming {
  initMs: number;
  connectionMs: number;
  queryMs: number;
  serializeMs: number;
  totalMs: number;
}

export interface DuckDbChunk {
  rows: Record<string, unknown>[];
  timing: DuckDbChunkTiming;
}

export interface StreamChunksOptions {
  /**
   * Statements to run before the source query, on the same connection.
   *
   * The rows a test supplies in place of whatever the query would otherwise
   * read. A fixture run gets a **private database**, not the shared one: temp
   * tables would be connection-scoped and therefore safe, but a fixture written
   * with a plain `CREATE TABLE` would land in the instance every other ETL job
   * connects to and outlive the run. Requiring the `TEMP` keyword would put a
   * cross-library leak behind a spelling, so the boundary is the database
   * instead.
   */
  fixtureSql?: string | null;
}

/**
 * A connection plus how to release what it was opened on.
 *
 * The shared instance outlives its connections and must not be closed with one;
 * a private instance exists only for the run and must be. One shape for both, so
 * the streaming loop's `finally` does not have to know which it got.
 */
interface DuckDbSession {
  connection: DuckDbConnectionLike;
  dispose(): void;
}

/**
 * Maps DuckDB types to default SPARQL/XSD datatypes
 */
export function mapDuckDbTypeToXsd(duckdbType: string): string {
  const typeUpper = duckdbType.toUpperCase();

  if (typeUpper.includes('VARCHAR') || typeUpper.includes('TEXT')) {
    return 'http://www.w3.org/2001/XMLSchema#string';
  }
  if (typeUpper.includes('INTEGER') || typeUpper.includes('BIGINT') || typeUpper.includes('SMALLINT')) {
    return 'http://www.w3.org/2001/XMLSchema#integer';
  }
  if (typeUpper.includes('DOUBLE') || typeUpper.includes('FLOAT') || typeUpper.includes('REAL')) {
    return 'http://www.w3.org/2001/XMLSchema#double';
  }
  if (typeUpper.includes('DECIMAL') || typeUpper.includes('NUMERIC')) {
    return 'http://www.w3.org/2001/XMLSchema#decimal';
  }
  if (typeUpper.includes('BOOLEAN') || typeUpper.includes('BOOL')) {
    return 'http://www.w3.org/2001/XMLSchema#boolean';
  }
  if (typeUpper.includes('TIMESTAMP') || typeUpper.includes('DATETIME')) {
    return 'http://www.w3.org/2001/XMLSchema#dateTime';
  }
  if (typeUpper.includes('DATE')) {
    return 'http://www.w3.org/2001/XMLSchema#date';
  }

  // Default fallback
  return 'http://www.w3.org/2001/XMLSchema#string';
}

/**
 * Rows as values an RDF literal can be built from.
 *
 * `getRowObjects()` returns the binding's own value objects for the types that
 * have no JS primitive — DECIMAL is `{width, scale, value}`, DATE is `{days}`,
 * TIMESTAMP is `{micros}`, INTERVAL is `{months, days, micros}` — and BIGINT as
 * a `bigint`. The walker this replaced looked only for `bigint`, recursed into
 * everything else and rebuilt it as a plain object, so `String(value)` in
 * `EtlService.convertRowsToBindings` produced `"[object Object]"^^xsd:decimal`
 * for every date and decimal column, and `Number(9007199254740993n)` silently
 * rounded every BIGINT past 2^53 (issue #200).
 *
 * `getRowObjectsJson()` is the binding's own lossless conversion: strings for
 * DECIMAL, DATE, TIMESTAMP and BIGINT, JSON arrays for LIST/ARRAY, and JS
 * primitives for everything that has one; `textualiseComposites` below deals
 * with what it leaves as an object.
 */
function toJsonRows(result: DuckDbResultLike): Record<string, unknown>[] {
  return result.getRowObjectsJson().map(textualiseComposites);
}

/**
 * The same rows, one DuckDB data chunk at a time.
 *
 * `getRowObjectsJson()` above is a method on the reader, which keeps every chunk
 * it has read; a streamed job must not accumulate. The binding's own
 * `JsonDuckDBValueConverter` is what that method applies internally, so running
 * it over a single chunk's rows produces values identical to the buffered path —
 * asserted directly in DuckDbService.test.ts rather than assumed.
 */
function toJsonRowsFromChunk(
  chunk: DuckDbDataChunkLike,
  columnNames: string[],
  converter: unknown,
): Record<string, unknown>[] {
  return chunk.convertRows(converter).map(values => {
    const row: Record<string, unknown> = {};
    for (let i = 0; i < columnNames.length; i++) {
      row[columnNames[i]] = values[i];
    }
    return textualiseComposites(row);
  });
}

/**
 * INTERVAL, STRUCT and MAP have no lexical form of their own, so the JSON
 * conversion leaves them as objects. Serialising those as JSON text is what
 * keeps a value from reaching a literal as `[object Object]` (issue #200).
 */
function textualiseComposites(row: Record<string, unknown>): Record<string, unknown> {
  let rewritten: Record<string, unknown> | null = null;
  for (const [key, value] of Object.entries(row)) {
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      rewritten ??= { ...row };
      rewritten[key] = JSON.stringify(value);
    }
  }
  return rewritten ?? row;
}

/**
 * The error a caller gets when a fixture failed, distinguishable from a failure
 * of the query it was setting up.
 *
 * They are different mistakes in different documents — a fixture that does not
 * compile is the test's, a source query that does not is the job's — and one
 * message covering both sends the reader to the wrong file. Carried as a class
 * so the streaming loop's own catch passes it through instead of wrapping it in
 * "Failed to stream chunks", which would say the opposite of what happened.
 */
export class DuckDbFixtureError extends Error {
  constructor(readonly cause: Error) {
    super(`Failed to run SQL fixture: ${cause.message}`);
    this.name = 'DuckDbFixtureError';
  }
}

/**
 * The error a caller gets when its query outlived the deadline, distinguishable
 * from anything DuckDB itself raises.
 */
export class DuckDbTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`DuckDB query exceeded the ${timeoutMs}ms limit and was cancelled`);
    this.name = 'DuckDbTimeoutError';
  }
}

/**
 * Run one awaited DuckDB call under a deadline, cancelling it on expiry
 * (issue #202).
 *
 * ETL takes arbitrary SQL, and nothing bounded what that SQL could *consume*:
 * `SELECT count(*) FROM range(100000000000)` held a DuckDB worker and the
 * request that started it for as long as it took, with no way to get either
 * back. `connection.interrupt()` cancels the in-flight query — whatever is
 * pending on that connection rejects with "INTERRUPT Error: Interrupted!" — so
 * the timer is what turns the deadline into an actual release rather than a
 * caller that has stopped waiting while the work grinds on.
 *
 * The interrupt's own rejection is discarded in favour of `DuckDbTimeoutError`:
 * the caller asked for a deadline, and "Interrupted!" does not say that one was
 * reached. A timeout of 0 is the configured way to run without one.
 */
async function withDeadline<T>(
  connection: DuckDbConnectionLike,
  timeoutMs: number,
  operation: () => Promise<T>,
): Promise<T> {
  if (timeoutMs <= 0) {
    return operation();
  }

  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    connection.interrupt();
  }, timeoutMs);

  try {
    return await operation();
  } catch (error) {
    if (expired) {
      throw new DuckDbTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function readAllWithDeadline(
  connection: DuckDbConnectionLike,
  timeoutMs: number,
  sql: string,
): Promise<DuckDbResultLike> {
  return withDeadline(connection, timeoutMs, () => connection.runAndReadAll(sql));
}

export class DuckDbService {
  private DuckDBConnection: any;
  /**
   * The binding's `DuckDBInstance`, kept for the one caller that needs a
   * *second* database: a fixture run (`streamChunks` with `fixtureSql`) creates
   * its own so that whatever the fixture creates cannot be seen by anything
   * else.
   */
  private DuckDBInstance: DuckDbInstanceFactoryLike | null;
  private instance: DuckDbInstanceLike | null;
  /**
   * The binding's `JsonDuckDBValueConverter`, taken from the same dynamic import
   * as everything else here: `streamChunks` converts a chunk itself, and the
   * conversion has to be the binding's own or a streamed row would differ from a
   * buffered one.
   */
  private jsonConverter: unknown;
  private available: boolean;
  private initPromise: Promise<void>;
  private readonly capabilities: DuckDbCapabilities;
  private readonly limits: DuckDbLimits;

  constructor(
    capabilities: DuckDbCapabilities = resolveDuckDbCapabilities(),
    limits: DuckDbLimits = resolveDuckDbLimits(),
  ) {
    console.log('[DuckDbService] Constructor called');
    this.available = false;
    this.DuckDBConnection = null;
    this.DuckDBInstance = null;
    this.instance = null;
    this.jsonConverter = null;
    this.capabilities = capabilities;
    this.limits = limits;

    // Initialize asynchronously
    this.initPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      // Try to load @duckdb/node-api - this will fail gracefully if not installed
      console.log('[DuckDbService] Attempting to import @duckdb/node-api');
      const duckdb = await import('@duckdb/node-api');
      this.DuckDBConnection = duckdb.DuckDBConnection;
      this.DuckDBInstance = duckdb.DuckDBInstance;
      this.jsonConverter = duckdb.JsonDuckDBValueConverter;

      if (this.capabilities.unrestricted) {
        // Explicitly opted out of the sandbox: connections are created ad hoc,
        // exactly as they were before #132. Loud, because nothing else will say so.
        console.warn(
          '[DuckDbService] ETL DuckDB sandbox DISABLED by ETL_DUCKDB_UNRESTRICTED=true — submitted SQL can read the host filesystem, make outbound requests, and install extensions.',
        );
        this.instance = null;
      } else {
        const instance: DuckDbInstanceLike = await duckdb.DuckDBInstance.create(
          ':memory:',
          duckDbInstanceConfig(this.capabilities, this.limits),
        );
        await this.applyBootConfiguration(instance);
        this.instance = instance;
      }

      this.available = true;
      console.log(
        `[DuckDbService] DuckDB loaded successfully — capabilities: ${describeDuckDbCapabilities(this.capabilities)} limits: ${describeDuckDbLimits(this.limits)}`,
      );
    } catch (error__u: unknown) {
      const error = toError(error__u);
      // DuckDB not available
      this.DuckDBConnection = null;
      this.DuckDBInstance = null;
      this.instance = null;
      this.jsonConverter = null;
      this.available = false;
      console.warn('[DuckDbService] DuckDB not available:', error.message);
      console.warn('[DuckDbService] ETL features will be disabled. Install @duckdb/node-api to enable.');
      if (error.code === 'ERR_MODULE_NOT_FOUND' || error.message?.includes('Cannot find package')) {
        console.warn('[DuckDbService] Run: cd packages/api && npm install @duckdb/node-api');
      }
    }
  }

  /**
   * Runs once, on a connection no caller SQL has touched: load whatever the
   * profile grants, then lock the configuration so submitted SQL cannot widen
   * it. The lock is database-wide, not per connection — verified against
   * v1.5.5, where a second connection's `SET allowed_directories=['/']` fails
   * with "Cannot change configuration option ... the configuration has been
   * locked".
   */
  private async applyBootConfiguration(instance: DuckDbInstanceLike): Promise<void> {
    const boot = await instance.connect();
    try {
      if (this.capabilities.http) {
        // Only reachable when extensions are already present; with
        // autoinstall off this is a load of a bundled extension, not a download.
        try {
          await boot.run('LOAD httpfs');
        } catch (error__u: unknown) {
          const error = toError(error__u);
          console.warn(
            `[DuckDbService] ETL_DUCKDB_ALLOW_HTTP=true but httpfs could not be loaded (${error.message}). Remote reads will fail; install the extension or set ETL_DUCKDB_ALLOW_EXTENSION_INSTALL=true.`,
          );
        }
      }
      await boot.run('SET lock_configuration=true');
    } finally {
      boot.closeSync();
    }
  }

  /**
   * The single place connections come from. Off the configured instance when
   * sandboxed; ad hoc when explicitly unrestricted.
   */
  private async connect(): Promise<DuckDbConnectionLike> {
    if (this.instance) {
      return this.instance.connect();
    }
    return this.DuckDBConnection.create();
  }

  /** A connection on the process-wide instance, which the caller must not close. */
  private async connectShared(): Promise<DuckDbSession> {
    const connection = await this.connect();
    return { connection, dispose: () => connection.closeSync() };
  }

  /**
   * A connection on a database created for this run and closed with it.
   *
   * Same capability profile and same boot lock as the shared instance — a
   * private database is an isolation boundary, not a laxer one. Measured at
   * 13–30ms to create, which is why a fixture asks for one and an ordinary job
   * does not.
   *
   * When the sandbox is off (`ETL_DUCKDB_UNRESTRICTED=true`) there is no shared
   * instance to leak into: `DuckDBConnection.create()` already gives each
   * connection its own database, so the ordinary path is private too.
   */
  private async connectPrivate(): Promise<DuckDbSession> {
    if (!this.instance) return this.connectShared();

    if (!this.DuckDBInstance) {
      // Unreachable: `this.instance` is non-null only when the import succeeded,
      // and the two are set together. Stated so the narrowing is a fact rather
      // than an assertion.
      throw new Error('DuckDB is not available. Install @duckdb/node-api package to enable ETL features.');
    }
    const instance = await this.DuckDBInstance.create(
      ':memory:',
      duckDbInstanceConfig(this.capabilities, this.limits),
    );
    await this.applyBootConfiguration(instance);
    const connection = await instance.connect();
    return {
      connection,
      dispose: () => {
        connection.closeSync();
        instance.closeSync();
      },
    };
  }

  /**
   * Whether submitted SQL is confined to the process.
   *
   * Read by callers that report reproducibility: a test run over an ETL job is
   * hermetic only while nothing its SQL can name reaches a file or a URL, and
   * that is a property of the deployment's capability profile rather than of the
   * test.
   */
  isSandboxed(): boolean {
    return !this.capabilities.unrestricted
      && !this.capabilities.filesystem
      && !this.capabilities.http;
  }

  /**
   * Wait for initialization to complete
   */
  async waitForInit(): Promise<void> {
    await this.initPromise;
  }

  /**
   * Check if DuckDB is available
   */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Execute SQL and get schema info.
   *
   * Uses a single `DESCRIBE` over the caller's SQL in expression position. The
   * previous implementation interpolated into a two-statement string
   * (`CREATE TEMP VIEW __etl_preview AS (${sql}); PRAGMA table_info(...)`), and
   * `runAndReadAll` runs every statement in it — so a closing paren escaped the
   * expression position and the rest of the string executed as the caller's own
   * statements. `SELECT 1 AS x); CREATE TABLE injected_marker AS SELECT 42; ...`
   * created the table. `DESCRIBE` cannot be escaped that way: the same payload
   * is a parser error. Covered by DuckDbService.sandbox.test.ts.
   */
  async getSchema(sql: string): Promise<DuckDbColumn[]> {
    await this.waitForInit();
    if (!this.isAvailable()) {
      throw new Error('DuckDB is not available. Install @duckdb/node-api package to enable ETL features.');
    }

    let connection: any;
    try {
      connection = await this.connect();

      // LIMIT 0 so describing a pipeline does not run it.
      const schemaSql = `DESCRIBE (SELECT * FROM (${sql}) t LIMIT 0)`;

      const result = await readAllWithDeadline(connection, this.limits.interactiveTimeoutMs, schemaSql);
      const rows = result.getRowObjects();

      const schema: DuckDbColumn[] = rows.map((row: any) => ({
        columnName: row.column_name,
        duckdbType: row.column_type,
        nullable: row.null === 'YES',
      }));

      return schema;
    } catch (error__u: unknown) {
      // A deadline is not a query failure, and the caller has to be able to
      // tell them apart — so it passes through rather than being restated.
      if (error__u instanceof DuckDbTimeoutError) {
        throw error__u;
      }
      const error = toError(error__u);
      throw new Error(`Failed to get schema: ${error.message}`);
    } finally {
      if (connection) {
        connection.closeSync();
      }
    }
  }

  /**
   * Preview SQL results with schema and sample rows
   */
  async preview(sql: string, limit = 10, offset = 0): Promise<PreviewResult> {
    await this.waitForInit();
    if (!this.isAvailable()) {
      throw new Error('DuckDB is not available. Install @duckdb/node-api package to enable ETL features.');
    }

    const schema = await this.getSchema(sql);

    let connection: any;
    try {
      connection = await this.connect();

      const previewSql = `SELECT * FROM (${sql}) t LIMIT ${limit} OFFSET ${offset}`;
      const result = await readAllWithDeadline(connection, this.limits.interactiveTimeoutMs, previewSql);
      const rows = toJsonRows(result);

      return {
        schema,
        rows,
      };
    } catch (error__u: unknown) {
      // A deadline is not a query failure, and the caller has to be able to
      // tell them apart — so it passes through rather than being restated.
      if (error__u instanceof DuckDbTimeoutError) {
        throw error__u;
      }
      const error = toError(error__u);
      throw new Error(`Failed to preview: ${error.message}`);
    } finally {
      if (connection) {
        connection.closeSync();
      }
    }
  }

  /**
   * The caller's SQL, executed once, delivered in chunks of `chunkSize` rows.
   *
   * What this replaces (issue #201): `executeChunk(sql, size, index)` opened a
   * connection, ran `SELECT * FROM (sql) t LIMIT size OFFSET index * size` and
   * closed it again, once per chunk. The source query therefore ran in full once
   * per chunk and each OFFSET re-scanned and discarded everything already
   * emitted, so a 100k-row job at the default chunk size ran the query 100 times
   * and scanned ~5M rows to yield 100k — quadratic, and paid on exactly the jobs
   * big enough to need chunking. LIMIT/OFFSET over a query with no ORDER BY also
   * has no guaranteed ordering between executions, so chunk boundaries could in
   * principle drop or duplicate rows.
   *
   * `connection.stream()` returns before the scan completes and `fetchChunk()`
   * pulls DuckDB's own chunks (2048 rows) as they are produced: one execution,
   * one connection, linear, and stable by construction because there is only one
   * result to walk. Rows are re-batched to `chunkSize` because that size is the
   * caller's knob — it decides how many rows go into one SPARQL VALUES block —
   * not DuckDB's.
   *
   * Nothing accumulates: each DuckDB chunk is converted and handed on, so memory
   * is bounded by `chunkSize` rather than by the size of the result.
   *
   * The connection is closed when the generator finishes, which includes a
   * caller that stops early — `break` out of a `for await` runs the `finally`.
   *
   * The deadline is per fetch, as it was per chunk before. It covers `stream()`
   * too: for an aggregate, `stream()` is where the whole query runs, so a
   * deadline armed only around `fetchChunk` would never fire.
   */
  async *streamChunks(
    sql: string,
    chunkSize: number,
    options: StreamChunksOptions = {},
  ): AsyncGenerator<DuckDbChunk, void, void> {
    // A non-positive size would fill no chunk and end the stream at once, which
    // reads as an empty source query rather than as the caller error it is.
    if (!Number.isInteger(chunkSize) || chunkSize < 1) {
      throw new Error(`chunkSize must be a positive integer, got ${chunkSize}`);
    }

    const initStart = performance.now();
    await this.waitForInit();
    const initMs = performance.now() - initStart;
    if (!this.isAvailable()) {
      throw new Error('DuckDB is not available. Install @duckdb/node-api package to enable ETL features.');
    }

    const fixtureSql = options.fixtureSql?.trim() ?? '';
    const connectionStart = performance.now();
    const session = fixtureSql ? await this.connectPrivate() : await this.connectShared();
    const connection = session.connection;
    const connectionMs = performance.now() - connectionStart;

    try {
      const timeoutMs = this.limits.queryTimeoutMs;

      if (fixtureSql) {
        // Under the same deadline as the query it sets up: a fixture is caller
        // SQL, so `CREATE TABLE t AS SELECT * FROM range(1e12)` is exactly as
        // able to run forever as the source query is.
        try {
          await withDeadline(connection, timeoutMs, () => connection.run(fixtureSql));
        } catch (error__u: unknown) {
          if (error__u instanceof DuckDbTimeoutError) throw error__u;
          throw new DuckDbFixtureError(toError(error__u));
        }
      }
      let queryMs = 0;
      let serializeMs = 0;

      const queryStart = performance.now();
      const result = await withDeadline(connection, timeoutMs, () => connection.stream(sql));
      queryMs += performance.now() - queryStart;

      const columnNames = result.deduplicatedColumnNames();
      const pending: Record<string, unknown>[] = [];
      let exhausted = false;
      let first = true;
      let chunkStart = performance.now();

      while (true) {
        while (pending.length < chunkSize && !exhausted) {
          const fetchStart = performance.now();
          const chunk = await withDeadline(connection, timeoutMs, () => result.fetchChunk());
          queryMs += performance.now() - fetchStart;

          if (!chunk || chunk.rowCount === 0) {
            exhausted = true;
            break;
          }

          const serializeStart = performance.now();
          pending.push(...toJsonRowsFromChunk(chunk, columnNames, this.jsonConverter));
          serializeMs += performance.now() - serializeStart;
        }

        if (pending.length === 0) {
          return;
        }

        const rows = pending.splice(0, chunkSize);
        yield {
          rows,
          timing: {
            initMs: first ? initMs : 0,
            connectionMs: first ? connectionMs : 0,
            queryMs,
            serializeMs,
            totalMs: performance.now() - chunkStart,
          },
        };

        first = false;
        queryMs = 0;
        serializeMs = 0;
        chunkStart = performance.now();
      }
    } catch (error__u: unknown) {
      // A deadline is not a query failure, and neither is a fixture that did
      // not compile; the caller has to be able to tell all three apart, so both
      // pass through rather than being restated as the query's failure.
      if (error__u instanceof DuckDbTimeoutError || error__u instanceof DuckDbFixtureError) {
        throw error__u;
      }
      const error = toError(error__u);
      throw new Error(`Failed to stream chunks: ${error.message}`);
    } finally {
      session.dispose();
    }
  }

  /**
   * Execute full query (for small datasets or testing)
   */
  async execute(sql: string, maxRows?: number): Promise<QueryResult> {
    await this.waitForInit();
    if (!this.isAvailable()) {
      throw new Error('DuckDB is not available. Install @duckdb/node-api package to enable ETL features.');
    }

    let connection: any;
    try {
      connection = await this.connect();

      const executeSql = maxRows ? `SELECT * FROM (${sql}) t LIMIT ${maxRows}` : sql;
      const result = await readAllWithDeadline(connection, this.limits.queryTimeoutMs, executeSql);

      return { rows: toJsonRows(result) };
    } catch (error__u: unknown) {
      // A deadline is not a query failure, and the caller has to be able to
      // tell them apart — so it passes through rather than being restated.
      if (error__u instanceof DuckDbTimeoutError) {
        throw error__u;
      }
      const error = toError(error__u);
      throw new Error(`Failed to execute SQL: ${error.message}`);
    } finally {
      if (connection) {
        connection.closeSync();
      }
    }
  }

  /**
   * DuckDB's own platform string, e.g. `linux_amd64` or `linux_amd64_musl`.
   *
   * This is the half of an extension's identity that a deployment cannot see
   * from the version number: extensions are published per platform, and the
   * community build for one platform says nothing about the other. The image
   * this project publishes is glibc-based and reports `linux_amd64`; a musl
   * image reports `linux_amd64_musl`, for which the community registry has
   * published nothing since DuckDB v1.5.0 — so `LOAD webbed` there fails on a
   * 404 from the extension repository (issue #468).
   */
  async getPlatform(): Promise<string> {
    await this.waitForInit();
    if (!this.isAvailable()) {
      throw new Error('DuckDB is not available. Install @duckdb/node-api package to enable ETL features.');
    }

    const session = await this.connectShared();
    try {
      const result = await readAllWithDeadline(
        session.connection,
        this.limits.interactiveTimeoutMs,
        'SELECT * FROM pragma_platform()',
      );
      const row = result.getRowObjects()[0];
      const value = row ? Object.values(row)[0] : null;
      return value === null || value === undefined ? 'unknown' : String(value);
    } finally {
      session.dispose();
    }
  }

  /**
   * Is `name` actually installable and loadable on this runtime?
   *
   * Asked so that a container smoke test can answer it before an ingestion
   * does. It runs the real `INSTALL`/`LOAD` on a database created for the check
   * and closed with it, under the same capability profile every other ETL
   * connection gets: with the default profile both fail, which is itself the honest
   * answer — a deployment that has not granted extension installation cannot
   * load an extension.
   *
   * It reports rather than throws, because "not available here" is a result.
   */
  async checkExtension(
    name: string,
    options: { repository?: string } = {},
  ): Promise<DuckDbExtensionCheck> {
    await this.waitForInit();
    if (!this.isAvailable()) {
      throw new Error('DuckDB is not available. Install @duckdb/node-api package to enable ETL features.');
    }

    // Interpolated into SQL, so nothing but an identifier gets through. The
    // caller here is an operator's smoke test rather than a request, but this
    // is the same rule the rest of the service follows.
    const identifier = /^[A-Za-z0-9_]+$/;
    if (!identifier.test(name)) {
      throw new Error(`Not an extension name: ${name}`);
    }
    if (options.repository !== undefined && !identifier.test(options.repository)) {
      throw new Error(`Not an extension repository: ${options.repository}`);
    }

    const platform = await this.getPlatform();
    const session = await this.connectPrivate();
    const check: DuckDbExtensionCheck = { extension: name, platform, installed: false, loaded: false };
    try {
      const install = options.repository ? `INSTALL ${name} FROM ${options.repository}` : `INSTALL ${name}`;
      await readAllWithDeadline(session.connection, this.limits.interactiveTimeoutMs, install);
      check.installed = true;
      await readAllWithDeadline(session.connection, this.limits.interactiveTimeoutMs, `LOAD ${name}`);
      check.loaded = true;
      return check;
    } catch (error__u: unknown) {
      check.error = toError(error__u).message;
      return check;
    } finally {
      session.dispose();
    }
  }
}

/*
 * Singleton instance, constructed on first use.
 *
 * The constructor starts `initialize()`, which dynamically imports
 * `@duckdb/node-api` (~80ms for the native binding) and opens an in-memory
 * DuckDB. Building it at module load meant every boot paid for it, including
 * the great majority that run with ETL off and never touch DuckDB at all.
 *
 * It stays a `duckDbService` object rather than becoming a `getDuckDbService()`
 * call so that the dozen call sites — and the `vi.mock` in four test files that
 * replaces this export with a stub — keep working untouched. The proxy
 * constructs on the first property read and forwards from there.
 *
 * A deployment that *does* serve ETL should not discover DuckDB on its first
 * request: `configureApp` warms this when the ETL or ETL-playground feature is
 * on, which starts initialization at boot exactly as before, without blocking.
 */
let instance: DuckDbService | null = null;

export function getDuckDbService(): DuckDbService {
  if (!instance) {
    instance = new DuckDbService();
  }
  return instance;
}

export const duckDbService: DuckDbService = new Proxy({} as DuckDbService, {
  get(_target, property) {
    const service = getDuckDbService();
    // Deliberately not forwarding the proxy as the receiver: any accessor must
    // run with `this` bound to the real service, not to the proxy.
    const value = (service as unknown as Record<string | symbol, unknown>)[property];
    return typeof value === 'function' ? value.bind(service) : value;
  },
  has(_target, property) {
    return property in getDuckDbService();
  },
});
