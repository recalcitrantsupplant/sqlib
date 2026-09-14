import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DuckDbService, mapDuckDbTypeToXsd } from '../../src/lib/DuckDbService.js';

/**
 * The DuckDB gate, resolved before collection.
 *
 * This used to be `!new DuckDbService().isAvailable()`, which is false at
 * collection time for *every* run: the constructor kicks off an async import
 * and `available` is still false when `describe.skipIf` reads it. So the whole
 * integration block was skipped everywhere, including where DuckDB was
 * installed. Gating on the import itself — the same way
 * `DuckDbService.sandbox.test.ts` does — is a fact known synchronously.
 */
let duckdbAvailable = true;
try {
  await import('@duckdb/node-api');
} catch {
  duckdbAvailable = false;
}


describe('DuckDbService', () => {
  let service: DuckDbService;

  beforeEach(() => {
    service = new DuckDbService();
  });

  describe('mapDuckDbTypeToXsd', () => {
    it('maps VARCHAR to xsd:string', () => {
      expect(mapDuckDbTypeToXsd('VARCHAR')).toBe('http://www.w3.org/2001/XMLSchema#string');
      expect(mapDuckDbTypeToXsd('TEXT')).toBe('http://www.w3.org/2001/XMLSchema#string');
    });

    it('maps INTEGER types to xsd:integer', () => {
      expect(mapDuckDbTypeToXsd('INTEGER')).toBe('http://www.w3.org/2001/XMLSchema#integer');
      expect(mapDuckDbTypeToXsd('BIGINT')).toBe('http://www.w3.org/2001/XMLSchema#integer');
      expect(mapDuckDbTypeToXsd('SMALLINT')).toBe('http://www.w3.org/2001/XMLSchema#integer');
    });

    it('maps DOUBLE types to xsd:double', () => {
      expect(mapDuckDbTypeToXsd('DOUBLE')).toBe('http://www.w3.org/2001/XMLSchema#double');
      expect(mapDuckDbTypeToXsd('FLOAT')).toBe('http://www.w3.org/2001/XMLSchema#double');
      expect(mapDuckDbTypeToXsd('REAL')).toBe('http://www.w3.org/2001/XMLSchema#double');
    });

    it('maps DECIMAL to xsd:decimal', () => {
      expect(mapDuckDbTypeToXsd('DECIMAL')).toBe('http://www.w3.org/2001/XMLSchema#decimal');
      expect(mapDuckDbTypeToXsd('NUMERIC')).toBe('http://www.w3.org/2001/XMLSchema#decimal');
    });

    it('maps BOOLEAN to xsd:boolean', () => {
      expect(mapDuckDbTypeToXsd('BOOLEAN')).toBe('http://www.w3.org/2001/XMLSchema#boolean');
      expect(mapDuckDbTypeToXsd('BOOL')).toBe('http://www.w3.org/2001/XMLSchema#boolean');
    });

    it('maps DATE to xsd:date', () => {
      expect(mapDuckDbTypeToXsd('DATE')).toBe('http://www.w3.org/2001/XMLSchema#date');
    });

    it('maps TIMESTAMP to xsd:dateTime', () => {
      expect(mapDuckDbTypeToXsd('TIMESTAMP')).toBe('http://www.w3.org/2001/XMLSchema#dateTime');
      expect(mapDuckDbTypeToXsd('DATETIME')).toBe('http://www.w3.org/2001/XMLSchema#dateTime');
    });

    it('falls back to xsd:string for unknown types', () => {
      expect(mapDuckDbTypeToXsd('UNKNOWN_TYPE')).toBe('http://www.w3.org/2001/XMLSchema#string');
    });
  });

  describe('isAvailable', () => {
    it('returns boolean indicating DuckDB availability', () => {
      const result = service.isAvailable();
      expect(typeof result).toBe('boolean');
    });
  });

  describe.skipIf(!duckdbAvailable)('DuckDB integration', () => {
    it('gets schema from SQL query', async () => {
      const sql = "SELECT 'Alice' as name, 25 as age, true as active";
      const schema = await service.getSchema(sql);

      expect(schema).toHaveLength(3);
      expect(schema[0]).toMatchObject({
        columnName: 'name',
        duckdbType: expect.stringContaining('VARCHAR'),
      });
      expect(schema[1]).toMatchObject({
        columnName: 'age',
        duckdbType: expect.stringContaining('INTEGER'),
      });
      expect(schema[2]).toMatchObject({
        columnName: 'active',
        duckdbType: expect.stringContaining('BOOLEAN'),
      });
    });

    it('previews SQL with limit and offset', async () => {
      const sql = "SELECT * FROM (VALUES ('Alice', 25), ('Bob', 30), ('Charlie', 35)) AS t(name, age)";
      const result = await service.preview(sql, 2, 1);

      expect(result.schema).toHaveLength(2);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0].name).toBe('Bob');
      expect(result.rows[1].name).toBe('Charlie');
    });

    it('previews inline SELECT with literals', async () => {
      const sql = "SELECT 'Alice' as name, 25 as age, true as active";
      const result = await service.preview(sql, 10);

      expect(result.schema).toHaveLength(3);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        name: 'Alice',
        age: 25,
        active: true,
      });
    });

    it('streams SQL in chunks of the requested size', async () => {
      const sql = "SELECT * FROM (VALUES (1), (2), (3), (4), (5)) AS t(num)";
      const chunks: Record<string, unknown>[][] = [];

      for await (const { rows } of service.streamChunks(sql, 2)) {
        chunks.push(rows);
      }

      // Batched to the caller's size, not DuckDB's: the last chunk is the
      // remainder, and every row appears exactly once, in order.
      expect(chunks.map(rows => rows.length)).toEqual([2, 2, 1]);
      expect(chunks.flat().map(row => row.num)).toEqual([1, 2, 3, 4, 5]);
    });

    it('re-batches DuckDB\'s own 2048-row chunks to the requested size', async () => {
      const sql = 'SELECT i FROM range(5000) t(i)';
      const sizes: number[] = [];

      for await (const { rows } of service.streamChunks(sql, 1500)) {
        sizes.push(rows.length);
      }

      expect(sizes).toEqual([1500, 1500, 1500, 500]);
    });

    it('rejects a chunk size that could never fill a chunk', async () => {
      const consume = async (size: number) => {
        for await (const _chunk of service.streamChunks('SELECT 1 AS x', size)) {
          // Never reached: the size is rejected before the query runs.
        }
      };

      await expect(consume(0)).rejects.toThrow(/positive integer/);
      await expect(consume(-1)).rejects.toThrow(/positive integer/);
    });

    it('yields nothing for an empty result', async () => {
      const chunks = [];
      for await (const chunk of service.streamChunks('SELECT 1 AS x WHERE false', 10)) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual([]);
    });

    /**
     * Issue #201: the point of the change. `executeChunk` ran the source query
     * once per chunk, so a value that advances per row — a sequence here —
     * restarted at every chunk boundary and the same rows came back again.
     * Under one streamed execution the sequence runs straight through, which is
     * also what makes chunk boundaries stable: there is only one result to walk.
     */
    it('executes the source query once for the whole stream', async () => {
      await service.execute('CREATE OR REPLACE SEQUENCE etl_stream_probe');
      const sql = "SELECT nextval('etl_stream_probe') AS n FROM range(2500)";

      const ns: unknown[] = [];
      for await (const { rows } of service.streamChunks(sql, 1000)) {
        ns.push(...rows.map(row => Number(row.n)));
      }

      expect(ns).toHaveLength(2500);
      expect(ns).toEqual(Array.from({ length: 2500 }, (_, i) => i + 1));
    });

    it('stops reading when the caller stops', async () => {
      // 10^10 rows: reading to the end is not an option, so returning promptly
      // with the first chunk is the whole demonstration that the stream is lazy
      // and that leaving the loop ends it.
      const started = Date.now();
      let seen = 0;

      for await (const { rows } of service.streamChunks('SELECT i FROM range(10000000000) t(i)', 10)) {
        seen = rows.length;
        break;
      }

      expect(seen).toBe(10);
      expect(Date.now() - started).toBeLessThan(10_000);

      // The connection the stream held is closed on the way out, and the
      // service is usable afterwards.
      const { rows } = await service.execute('SELECT 1 AS x');
      expect(rows).toEqual([{ x: 1 }]);
    });

    it('reports the once-per-stream costs on the first chunk only', async () => {
      const timings = [];
      for await (const { timing } of service.streamChunks('SELECT i FROM range(3000) t(i)', 1000)) {
        timings.push(timing);
      }

      expect(timings).toHaveLength(3);
      expect(timings[0].connectionMs).toBeGreaterThanOrEqual(0);
      for (const timing of timings.slice(1)) {
        expect(timing.initMs).toBe(0);
        expect(timing.connectionMs).toBe(0);
      }
    });

    it('executes full query with maxRows', async () => {
      const sql = "SELECT * FROM (VALUES (1), (2), (3), (4), (5)) AS t(num)";
      const result = await service.execute(sql, 3);

      expect(result.rows).toHaveLength(3);
    });

    /**
     * Issue #200: every one of these types used to reach the caller as the
     * binding's value object (`{days: 18263}` for a DATE) or, for BIGINT, as a
     * `Number` that had already lost the low bits. `String(value)` in
     * `EtlService.convertRowsToBindings` then wrote `"[object Object]"` into a
     * literal typed `xsd:date`, and nothing errored. The suite only exercised
     * VARCHAR/INTEGER/DOUBLE/BOOLEAN, which is why it went unnoticed.
     */
    const TYPED_SQL = `SELECT 1.005::DECIMAL(18,3) AS dec_col,
             '2020-01-02'::DATE AS date_col,
             '2020-01-02 03:04:05'::TIMESTAMP AS ts_col,
             INTERVAL 3 DAY AS iv_col,
             [1, 2]::INTEGER[] AS arr_col,
             9007199254740993::BIGINT AS big_col,
             NULL::VARCHAR AS null_col`;

    for (const [label, run] of [
      ['preview', async () => (await service.preview(TYPED_SQL, 1)).rows],
      ['execute', async () => (await service.execute(TYPED_SQL)).rows],
      // The streamed path converts a DuckDB chunk itself rather than going
      // through the reader, so it is asserted against the same expectations
      // rather than assumed to agree with them.
      ['streamChunks', async () => {
        for await (const { rows } of service.streamChunks(TYPED_SQL, 1)) {
          return rows;
        }
        throw new Error('streamChunks yielded nothing');
      }],
    ] as [string, () => Promise<Record<string, unknown>[]>][]) {
      it(`${label} returns values a literal can be built from, for every type`, async () => {
        const [row] = await run();

        expect(row.dec_col).toBe('1.005');
        expect(row.date_col).toBe('2020-01-02');
        expect(row.ts_col).toBe('2020-01-02 03:04:05');
        // BIGINT past 2^53: as a JS number this is 9007199254740992.
        expect(row.big_col).toBe('9007199254740993');
        expect(row.arr_col).toEqual([1, 2]);
        // INTERVAL has no lexical form of its own, so it is JSON text rather
        // than the object that used to stringify to "[object Object]".
        expect(typeof row.iv_col).toBe('string');
        expect(JSON.parse(row.iv_col as string)).toMatchObject({ days: 3 });
        expect(row.null_col).toBeNull();

        for (const [column, value] of Object.entries(row)) {
          expect(String(value), column).not.toBe('[object Object]');
        }
      });
    }

    it('handles invalid SQL gracefully', async () => {
      const invalidSql = "SELECT FROM WHERE";
      await expect(service.getSchema(invalidSql)).rejects.toThrow();
    });
  });
});
