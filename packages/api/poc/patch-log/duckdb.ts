/**
 * The thinnest DuckDB wrapper the POC can get away with.
 *
 * `packages/api/src/lib/DuckDbService.ts` is the production one, and it is
 * deliberately not reused: it carries a capability profile, a deadline, a
 * chunked reader and an optional-import dance, all of which exist because ETL
 * runs a library's stored SQL. The POC runs SQL it wrote itself against a
 * throwaway database, so all of that would be noise around the two things it
 * actually needs — a connection and a stopwatch.
 *
 * One inheritance from that file is not noise: results come back through
 * `getRowObjectsJson()`, the binding's lossless-string conversion, for the
 * reason issue #200 gives — `getRowObjects()` hands back value objects for
 * BIGINT and friends, and every count in this harness is a BIGINT.
 */

import { DuckDBInstance } from '@duckdb/node-api';

export interface Duck {
  run(sql: string): Promise<Record<string, unknown>[]>;
  /** Run for effect, returning how long it took in milliseconds. */
  timed(sql: string): Promise<number>;
  close(): void;
}

export async function openDuck(path = ':memory:'): Promise<Duck> {
  const instance = await DuckDBInstance.create(path);
  const connection = await instance.connect();

  return {
    async run(sql: string) {
      const result = await connection.runAndReadAll(sql);
      return result.getRowObjectsJson() as Record<string, unknown>[];
    },
    async timed(sql: string) {
      const started = performance.now();
      await connection.runAndReadAll(sql);
      return performance.now() - started;
    },
    close() {
      connection.closeSync();
    },
  };
}

/** A count that came back as a lossless string, as a number. */
export function scalar(rows: Record<string, unknown>[], column: string): number {
  const raw = rows[0]?.[column];
  if (raw === undefined || raw === null) throw new Error(`no ${column} in result`);
  return Number(raw);
}

/**
 * Run a query several times and keep the middle one.
 *
 * The first run of anything pays for pages the second run finds cached, and a
 * single sample of either is a number with no error bar at all. Three runs and
 * a median is the cheapest thing that is not misleading; the first run is
 * reported separately as `cold` where the difference is part of the finding.
 */
export async function medianMs(duck: Duck, sql: string, runs = 3): Promise<{ cold: number; median: number }> {
  const samples: number[] = [];
  for (let i = 0; i < runs; i += 1) samples.push(await duck.timed(sql));
  const sorted = [...samples].sort((a, b) => a - b);
  return { cold: samples[0]!, median: sorted[Math.floor(sorted.length / 2)]! };
}
