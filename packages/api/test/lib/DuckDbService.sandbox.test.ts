/**
 * Sandbox tests for the ETL DuckDB surface (issue #132).
 *
 * These run against real DuckDB deliberately. The failure mode being guarded
 * against is "the setting was applied but does not enforce anything", which a
 * mock cannot catch — and which is not hypothetical here: `allowed_directories`
 * is accepted by DuckDB and enforces nothing, which is why this service does not
 * offer it as a knob. So every assertion below is an observed permission error
 * or an observed row, never a config readback.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DuckDbService, DuckDbTimeoutError } from '../../src/lib/DuckDbService.js';
import {
  DUCKDB_LIMIT_DEFAULTS,
  duckDbInstanceConfig,
  resolveDuckDbCapabilities,
  resolveDuckDbLimits,
} from '../../src/lib/duckdbCapabilities.js';

let duckdbAvailable = true;
try {
  await import('@duckdb/node-api');
} catch {
  duckdbAvailable = false;
}

const describeWithDuckDb = duckdbAvailable ? describe : describe.skip;

/** A readable file outside any directory ETL has business reading. */
let csvPath: string;

beforeAll(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'sqlib-etl-sandbox-'));
  csvPath = path.join(dir, 'rows.csv');
  writeFileSync(csvPath, 'a,b\n1,2\n3,4\n');
});

describe('resolveDuckDbCapabilities', () => {
  it('grants nothing when nothing is set', () => {
    expect(resolveDuckDbCapabilities({})).toEqual({
      filesystem: false,
      http: false,
      extensionInstall: false,
      unrestricted: false,
    });
  });

  it('treats HTTP as implying filesystem, because DuckDB has one switch for both', () => {
    const capabilities = resolveDuckDbCapabilities({ ETL_DUCKDB_ALLOW_HTTP: 'true' });
    expect(capabilities.http).toBe(true);
    expect(capabilities.filesystem).toBe(true);
  });

  it('ignores an unparseable value rather than reading it as permission', () => {
    expect(resolveDuckDbCapabilities({ ETL_DUCKDB_ALLOW_FILESYSTEM: 'sure' }).filesystem).toBe(false);
  });

  it('turns external access off in the instance config by default', () => {
    expect(duckDbInstanceConfig(resolveDuckDbCapabilities({}), resolveDuckDbLimits({}))).toEqual({
      enable_external_access: 'false',
      autoinstall_known_extensions: 'false',
      autoload_known_extensions: 'false',
      memory_limit: DUCKDB_LIMIT_DEFAULTS.memoryLimit,
    });
  });
});

describe('resolveDuckDbLimits', () => {
  it('bounds time and memory when nothing is set', () => {
    expect(resolveDuckDbLimits({})).toEqual(DUCKDB_LIMIT_DEFAULTS);
  });

  it('reads a deadline from env', () => {
    expect(resolveDuckDbLimits({ ETL_DUCKDB_INTERACTIVE_TIMEOUT_MS: '250' }).interactiveTimeoutMs).toBe(250);
    expect(resolveDuckDbLimits({ ETL_DUCKDB_QUERY_TIMEOUT_MS: '90000' }).queryTimeoutMs).toBe(90_000);
  });

  it('takes 0 as the one way to ask for no deadline', () => {
    expect(resolveDuckDbLimits({ ETL_DUCKDB_QUERY_TIMEOUT_MS: '0' }).queryTimeoutMs).toBe(0);
  });

  it('falls back to the default rather than removing the ceiling on nonsense', () => {
    // The direction matters: an unreadable value must not read as "unlimited",
    // the same way an unparseable capability value does not read as permission.
    for (const value of ['soon', '-1', '1.5', '']) {
      expect(resolveDuckDbLimits({ ETL_DUCKDB_QUERY_TIMEOUT_MS: value }).queryTimeoutMs).toBe(
        DUCKDB_LIMIT_DEFAULTS.queryTimeoutMs,
      );
    }
  });

  it('leaves memory to the engine only when asked explicitly', () => {
    expect(resolveDuckDbLimits({ ETL_DUCKDB_MEMORY_LIMIT: '512MB' }).memoryLimit).toBe('512MB');
    expect(resolveDuckDbLimits({ ETL_DUCKDB_MEMORY_LIMIT: '' }).memoryLimit).toBeNull();
    expect(duckDbInstanceConfig(resolveDuckDbCapabilities({}), resolveDuckDbLimits({ ETL_DUCKDB_MEMORY_LIMIT: '' })))
      .not.toHaveProperty('memory_limit');
  });
});

describeWithDuckDb('DuckDbService with the default (closed) profile', () => {
  const service = new DuckDbService({
    filesystem: false,
    http: false,
    extensionInstall: false,
    unrestricted: false,
  });

  it('still runs ordinary SQL', async () => {
    const { rows } = await service.execute('SELECT 1 AS x');
    expect(rows).toEqual([{ x: 1 }]);
  });

  it('refuses to read a local file', async () => {
    await expect(
      service.execute(`SELECT * FROM read_csv('${csvPath}', header=true)`),
    ).rejects.toThrow(/file system operations are disabled|Permission Error/i);
  });

  it('refuses to read over the network', async () => {
    await expect(
      service.execute("SELECT * FROM read_csv('https://example.invalid/x.csv')"),
    ).rejects.toThrow();
  });

  it('refuses to install an extension', async () => {
    // Matched on the permission error specifically: a bare `.rejects.toThrow()`
    // would also pass on a machine that simply cannot reach the extension host,
    // which would test the network rather than the sandbox.
    await expect(service.execute('INSTALL httpfs')).rejects.toThrow(/Permission Error/i);
  });

  it('cannot re-enable external access from submitted SQL', async () => {
    await expect(service.execute('SET enable_external_access=true')).rejects.toThrow(
      /while database is running|has been locked/i,
    );
    // and the boundary still holds afterwards
    await expect(
      service.execute(`SELECT * FROM read_csv('${csvPath}', header=true)`),
    ).rejects.toThrow();
  });

  it('cannot widen the sandbox with allowed_directories, locked configuration', async () => {
    await expect(service.execute("SET allowed_directories=['/']")).rejects.toThrow(
      /has been locked/i,
    );
  });

  it('does not execute statements the caller smuggles past getSchema', async () => {
    // The exact payload from #132: a closing paren escapes expression position
    // in the old CREATE TEMP VIEW template.
    const injection =
      "SELECT 1 AS x); CREATE TABLE injected_marker AS SELECT 42 AS pwned; CREATE TEMP VIEW zz AS (SELECT 2 AS y";

    await expect(service.getSchema(injection)).rejects.toThrow();

    const { rows } = await service.execute(
      "SELECT count(*) AS c FROM duckdb_tables() WHERE table_name = 'injected_marker'",
    );
    // BIGINT — what count(*) returns — comes back as a lossless string, not a
    // JS number that has already dropped the low bits (issue #200).
    expect(rows[0]).toEqual({ c: '0' });
  });

  it('reports schema for well-formed SQL', async () => {
    const schema = await service.getSchema("SELECT 1 AS n, 'x' AS s");
    expect(schema).toEqual([
      { columnName: 'n', duckdbType: 'INTEGER', nullable: true },
      { columnName: 's', duckdbType: 'VARCHAR', nullable: true },
    ]);
  });

  it('describes without running the query it is describing', async () => {
    // If DESCRIBE executed the body, this would create the table.
    await service.getSchema('SELECT * FROM (CREATE TABLE t_should_not_exist AS SELECT 1) x').catch(() => {});
    const { rows } = await service.execute(
      "SELECT count(*) AS c FROM duckdb_tables() WHERE table_name = 't_should_not_exist'",
    );
    expect(rows[0]).toEqual({ c: '0' });
  });
});

/**
 * Issue #202: the sandbox says what ETL SQL may *reach*; these say what it may
 * *consume*. Real DuckDB again, and for the same reason — the question is
 * whether the query actually stops, which a mock cannot answer.
 */
describeWithDuckDb('DuckDbService resource limits', () => {
  const CLOSED = {
    filesystem: false,
    http: false,
    extensionInstall: false,
    unrestricted: false,
  } as const;

  /** Unbounded without the deadline: ~10^11 rows. */
  const RUNAWAY = 'SELECT count(*) FROM range(100000000000)';

  const impatient = new DuckDbService(CLOSED, {
    interactiveTimeoutMs: 300,
    queryTimeoutMs: 300,
    memoryLimit: DUCKDB_LIMIT_DEFAULTS.memoryLimit,
  });

  it('cancels a runaway query instead of holding the caller', async () => {
    const started = Date.now();
    await expect(impatient.execute(RUNAWAY)).rejects.toBeInstanceOf(DuckDbTimeoutError);
    // The point of the interrupt: the promise settles near the deadline rather
    // than when the query would have finished on its own.
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it('applies the deadline to the interactive paths the playground reaches', async () => {
    await expect(impatient.preview(RUNAWAY)).rejects.toBeInstanceOf(DuckDbTimeoutError);
  });

  it('applies it per fetch on the streamed path, not per job', async () => {
    // The deadline has to cover `stream()` as well as the fetches: for an
    // aggregate, `stream()` is where the whole query runs (issue #201).
    const consume = async () => {
      for await (const _chunk of impatient.streamChunks(RUNAWAY, 10)) {
        // The deadline fires before the first chunk arrives.
      }
    };

    await expect(consume()).rejects.toBeInstanceOf(DuckDbTimeoutError);
  });

  it('leaves the service usable afterwards', async () => {
    const { rows } = await impatient.execute('SELECT 1 AS x');
    expect(rows).toEqual([{ x: 1 }]);
  });

  it('says the deadline was reached rather than restating the interrupt', async () => {
    await expect(impatient.execute(RUNAWAY)).rejects.toThrow(/exceeded the 300ms limit/);
  });

  it('runs without a deadline when one is configured off', async () => {
    const patient = new DuckDbService(CLOSED, {
      interactiveTimeoutMs: 0,
      queryTimeoutMs: 0,
      memoryLimit: DUCKDB_LIMIT_DEFAULTS.memoryLimit,
    });
    const { rows } = await patient.execute('SELECT count(*) AS c FROM range(1000)');
    expect(rows).toEqual([{ c: '1000' }]);
  });

  it('caps memory at the configured limit, and submitted SQL cannot raise it', async () => {
    const service = new DuckDbService(CLOSED, {
      ...DUCKDB_LIMIT_DEFAULTS,
      memoryLimit: '256MB',
    });
    await expect(service.execute("SET memory_limit='10GB'")).rejects.toThrow(/has been locked/i);
  });
});

/**
 * The fixture channel a test uses to supply an ETL job's rows.
 *
 * Real DuckDB again, and for the same reason as the rest of this file: the
 * property being claimed is an isolation boundary, and a boundary that is
 * configured but does not hold is exactly what a mock would report as working.
 */
describeWithDuckDb('DuckDbService fixtures', () => {
  const service = new DuckDbService({
    filesystem: false,
    http: false,
    extensionInstall: false,
    unrestricted: false,
  });

  async function collect(sql: string, fixtureSql?: string) {
    const rows: Record<string, unknown>[] = [];
    for await (const chunk of service.streamChunks(sql, 100, { fixtureSql })) {
      rows.push(...chunk.rows);
    }
    return rows;
  }

  it('runs the fixture before the source query, on the same connection', async () => {
    const rows = await collect(
      'SELECT id, label FROM staging ORDER BY id',
      "CREATE TABLE staging AS SELECT * FROM (VALUES (1, 'a'), (2, 'b')) t(id, label);",
    );
    expect(rows).toEqual([{ id: 1, label: 'a' }, { id: 2, label: 'b' }]);
  });

  /*
   * The reason a fixture gets a private database rather than a temp table.
   * `CREATE TABLE` without `TEMP` is the natural thing to write, and on the
   * shared instance it would outlive the run and be visible to every other
   * library's SQL. Requiring the keyword would put that leak behind a spelling.
   */
  it('leaves nothing behind on the shared instance', async () => {
    await collect('SELECT * FROM leaky', 'CREATE TABLE leaky AS SELECT 1 AS x;');
    await expect(service.execute('SELECT * FROM leaky')).rejects.toThrow(/does not exist/i);
  });

  it('gives two fixture runs databases of their own', async () => {
    // Same table name, different rows: the second run must not see the first's,
    // and must be able to create the table at all.
    const first = await collect('SELECT x FROM shared', 'CREATE TABLE shared AS SELECT 1 AS x;');
    const second = await collect('SELECT x FROM shared', 'CREATE TABLE shared AS SELECT 2 AS x;');
    expect(first).toEqual([{ x: 1 }]);
    expect(second).toEqual([{ x: 2 }]);
  });

  it('holds the same boundary the shared instance does', async () => {
    // A private database is an isolation boundary, not a laxer profile: the
    // capability config and the configuration lock are applied to it too.
    await expect(
      collect('SELECT 1', `SELECT * FROM read_csv('${csvPath}', header=true);`),
    ).rejects.toThrow(/file system operations are disabled|Permission Error/i);
    await expect(collect('SELECT 1', "SET memory_limit='10GB';")).rejects.toThrow(/has been locked/i);
  });

  it('names a fixture failure as the fixture\'s, not the query\'s', async () => {
    // The two are different mistakes in different documents, and one message
    // covering both sends the reader to the wrong one.
    await expect(collect('SELECT 1', 'CREATE TABLE broken AS SELECT * FROM (')).rejects.toThrow(
      /Failed to run SQL fixture/,
    );
  });

  it('reports the sandbox as closed only while it is', () => {
    // What an ETL test run reads to decide whether it was reproducible.
    expect(service.isSandboxed()).toBe(true);
    expect(new DuckDbService({ filesystem: true, http: false, extensionInstall: false, unrestricted: false })
      .isSandboxed()).toBe(false);
    expect(new DuckDbService({ filesystem: false, http: false, extensionInstall: false, unrestricted: true })
      .isSandboxed()).toBe(false);
  });
});

describeWithDuckDb('DuckDbService with filesystem granted', () => {
  const service = new DuckDbService({
    filesystem: true,
    http: false,
    extensionInstall: false,
    unrestricted: false,
  });

  it('reads a local file', async () => {
    const { rows } = await service.execute(`SELECT count(*) AS c FROM read_csv('${csvPath}', header=true)`);
    expect(rows[0]).toEqual({ c: '2' });
  });

  /*
   * What `extensionInstall: false` actually buys once the filesystem is granted:
   * nothing loads *implicitly*. DuckDB would otherwise autoload httpfs the
   * moment a query named an https:// path.
   *
   * It does NOT block an explicit `INSTALL`. Granting filesystem access grants
   * write access to the extension directory, and that is the whole mechanism —
   * `enable_external_access=false` is what makes INSTALL fail in the default
   * profile, not the autoinstall setting. An earlier version of this test
   * asserted that INSTALL still fails here and passed only because the machine
   * that ran it had no cached extension and no route to the extension host; on
   * a runner with either, it succeeded. Asserting the autoload boundary instead
   * tests the sandbox rather than the network.
   */
  it('does not autoload an extension a query implies', async () => {
    await expect(
      service.execute("SELECT * FROM read_csv('https://example.invalid/x.csv')"),
    ).rejects.toThrow(/requires the extension httpfs to be loaded/i);
  });
});
