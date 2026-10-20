# @sparql-query-lib/runtime-duckdb

A sandboxed DuckDB for reading ETL sources.

`DuckDbService` opens one in-memory DuckDB, configures it from a capability
profile, and locks the configuration before any caller SQL runs. It then
offers schema detection, preview, a buffered read, and `streamChunks`, a
chunked read that every ETL run uses. Every read runs under a deadline.

## The host supplies the profile

The package reads no environment. Pass the profile and limits:

```ts
import {
  DUCKDB_CLOSED_PROFILE,
  DUCKDB_LIMIT_DEFAULTS,
  DuckDbService,
} from '@sparql-query-lib/runtime-duckdb';

const duckdb = new DuckDbService(
  { ...DUCKDB_CLOSED_PROFILE, filesystem: true },
  DUCKDB_LIMIT_DEFAULTS,
  { logger: console },
);

for await (const { rows } of duckdb.streamChunks("SELECT * FROM 'customers.parquet'", 5000)) {
  // one chunk of rows at a time
}
```

- The API reads the profile from `ETL_DUCKDB_*` environment variables, with
  every capability off by default. See
  [`docs/guides/etl.md`](../../docs/guides/etl.md).
- The command-line tool will take it from flags, with filesystem access on by
  default, because reading local files is its job.

What each capability grants, and what DuckDB actually enforces, is documented
on the `DuckDbCapabilities` type.

## Logging

The logger takes pino's call shape: a message, or a context object then a
message. The API passes its pino logger. Omit the option to stay silent.

## Status

Private to the workspace. It becomes publishable with the command-line tool.
