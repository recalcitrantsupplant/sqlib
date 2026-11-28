// The part of @duckdb/node-api that runtime-duckdb uses, on duckdb-wasm.
//
// DuckDB runs in its own Worker, started on the first ETL call. The page
// says where the duckdb-wasm files are (`duckdb` in the init message); by
// default they come from jsDelivr, because duckdb-eh.wasm (34 MB) is larger
// than some static hosts accept for one file.
//
// Values: node-api's JSON converter gives numbers for the small integer and
// float types, booleans for BOOLEAN, and DuckDB's own text for everything
// else (BIGINT, DECIMAL, DATE, TIME, TIMESTAMP...). Each query is wrapped so
// that DuckDB casts those columns to VARCHAR, which gives the same text.
import * as duckdb from '@duckdb/duckdb-wasm';

const KEEP_AS_IS = new Set([
  'BOOLEAN', 'TINYINT', 'SMALLINT', 'INTEGER', 'UTINYINT', 'USMALLINT', 'UINTEGER', 'FLOAT', 'DOUBLE', 'VARCHAR', '"NULL"', 'NULL',
]);
const AS_JSON = /^(STRUCT|MAP|UNION|INTERVAL)|\[\]$|\[\d+\]$/;

function bundle() {
  const config = globalThis.__SQLIB_DUCKDB__ ?? {};
  const version = '1.32.0';
  const base = config.baseUrl ?? `https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@${version}/dist/`;
  return { mainModule: new URL('duckdb-eh.wasm', base).href, mainWorker: new URL('duckdb-browser-eh.worker.js', base).href };
}

/** One DuckDB database in its own Worker, loaded on first use. */
class LazyDatabase {
  constructor() {
    this.promise = null;
  }
  get() {
    this.promise ??= (async () => {
      const { mainModule, mainWorker } = bundle();
      const script = URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(mainWorker)});`], { type: 'text/javascript' }));
      const worker = new Worker(script);
      const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
      await db.instantiate(mainModule);
      URL.revokeObjectURL(script);
      await db.open({ path: ':memory:' });
      this.worker = worker;
      return db;
    })().catch(error => {
      this.promise = null;
      throw error;
    });
    return this.promise;
  }
  close() {
    if (!this.promise) return;
    this.promise.then(db => db.terminate()).catch(() => {});
    this.promise = null;
  }
}

const shared = new LazyDatabase();

function quoteIdent(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

function toPlain(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (ArrayBuffer.isView(value)) return Array.from(value, toPlain);
  if (Array.isArray(value)) return value.map(toPlain);
  if (typeof value === 'object' && typeof value.toJSON === 'function') return toPlain(value.toJSON());
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, toPlain(v)]));
  return value;
}

/** Rows of an Arrow table, with column values as node-api's JSON converter gives them. */
function tableRows(table, jsonColumns) {
  const names = table.schema.fields.map(f => f.name);
  const rows = [];
  for (let i = 0; i < table.numRows; i++) {
    const row = table.get(i);
    const values = names.map(n => {
      const v = row?.[n];
      if (jsonColumns.has(n) && typeof v === 'string') return JSON.parse(v);
      return toPlain(v);
    });
    rows.push(values);
  }
  return { names, rows };
}

class Connection {
  constructor(database) {
    this.database = database;
    this.pending = null;
  }

  /** The duckdb-wasm connection, made on first use so that start-up loads nothing. */
  connection() {
    this.pending ??= this.database.get().then(db => db.connect());
    return this.pending;
  }

  /** The query, with columns cast so their values come back as node-api's JSON converter gives them. */
  async shaped(sql) {
    const trimmed = sql.trim().replace(/;\s*$/, '');
    if (!/^(SELECT|WITH|FROM|VALUES|TABLE|\()/i.test(trimmed)) return { sql: trimmed, json: new Set(), names: null };
    let described;
    try {
      described = await (await this.connection()).query(`DESCRIBE ${trimmed}`);
    } catch {
      return { sql: trimmed, json: new Set(), names: null };
    }
    const json = new Set();
    const columns = [];
    const names = [];
    for (let i = 0; i < described.numRows; i++) {
      const row = described.get(i);
      const name = row.column_name;
      const type = String(row.column_type).toUpperCase();
      names.push(name);
      if (KEEP_AS_IS.has(type)) columns.push(quoteIdent(name));
      else if (AS_JSON.test(type)) { json.add(name); columns.push(`CAST(to_json(${quoteIdent(name)}) AS VARCHAR) AS ${quoteIdent(name)}`); }
      else columns.push(`CAST(${quoteIdent(name)} AS VARCHAR) AS ${quoteIdent(name)}`);
    }
    return { sql: `SELECT ${columns.join(', ')} FROM (${trimmed}) AS sqlib_source`, json, names };
  }

  async run(sql) {
    // The sandbox lock at start-up. Nothing outside this Worker can reach DuckDB, so it can wait.
    if (!this.pending && /^\s*SET\s+lock_configuration\s*=\s*true\s*;?\s*$/i.test(sql)) return null;
    return (await this.connection()).query(sql);
  }

  interrupt() {
    this.pending?.then(c => c.cancelSent()).catch(() => {});
  }

  async runAndReadAll(sql) {
    const { sql: shaped, json } = await this.shaped(sql);
    const { names, rows } = tableRows(await (await this.connection()).query(shaped), json);
    const objects = rows.map(values => Object.fromEntries(names.map((n, i) => [n, values[i]])));
    return { getRowObjects: () => objects, getRowObjectsJson: () => objects, columnNames: () => names };
  }

  async stream(sql) {
    const { sql: shaped, json, names: described } = await this.shaped(sql);
    const reader = await (await this.connection()).send(shaped);
    // The Arrow schema is known once the first batch is read.
    let first = described ? null : await reader.next();
    const names = described ?? first?.value?.schema.fields.map(f => f.name) ?? [];
    return {
      deduplicatedColumnNames: () => names,
      columnNames: () => names,
      fetchChunk: async () => {
        const next = first ?? await reader.next();
        first = null;
        if (next.done || !next.value) return null;
        const batch = next.value;
        const { rows } = tableRows({ schema: batch.schema, numRows: batch.numRows, get: i => batch.get(i) }, json);
        return { rowCount: batch.numRows, convertRows: () => rows };
      },
    };
  }

  closeSync() {
    this.pending?.then(c => c.close()).catch(() => {});
    this.pending = null;
  }
}

export const DuckDBConnection = {
  async create() {
    return new Connection(shared);
  },
};

export const DuckDBInstance = {
  /** The service's own instance shares one database. A fixture run gets a database of its own. */
  async create(path, config) {
    const database = config && Object.keys(config).length && createdMain ? new LazyDatabase() : shared;
    createdMain = true;
    return {
      async connect() {
        return new Connection(database);
      },
      closeSync() {
        if (database !== shared) database.close();
      },
    };
  },
};
let createdMain = false;

/** Passed through by runtime-duckdb and ignored here: `convertRows` already gives JSON values. */
export const JsonDuckDBValueConverter = {};

export default { DuckDBConnection, DuckDBInstance, JsonDuckDBValueConverter };
