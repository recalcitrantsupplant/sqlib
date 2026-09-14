# @sparql-query-lib/api

Fastify backend for sqlib. This package owns the server implementation: the
persistence layer, the REST routes, schema generation, and the supporting
scripts. It is `private: true` and is not published; it is consumed in-process
by `@sparql-query-lib/mcp-server` and over HTTP by `@sparql-query-lib/web`.

## Key directories

- `src/` – Fastify server: `routes/` (one module per resource), `persistence/`
  (the entity store and its schemas), `lib/` (rules, ETL, execution,
  detection), `assistant/`, `auth/`, `server/` (configuration).
- `scripts/` – Build-time and operational tooling: schema generation, system
  library seeding, store export/import, smoke checks.
- `test/` – Vitest suites, including `test/integration/`.
- `tests/e2e/` – Playwright suites.
- `examples/` – Request and response payloads. Some are embedded into the
  generated OpenAPI schema; see `examples/README.md`.
- `data/examples/` – Sample CSV files used by ETL examples.
- `system-store/assets/` – Turtle seeds for the system library.
- `storage/` – Runtime data written by the process (library store
  serialisations, ETL output). Not tracked in git.

## Documentation

- [Architecture](../../docs/explanation/architecture.md) – how the server,
  the SPA, the MCP server and the runtime packages fit together.
- [Storage and caching](../../docs/explanation/storage-and-caching.md) – the
  entity store, the cache coordinator and the entity registry.
- [Running and configuring](../../docs/guides/running-and-configuring.md) and
  [Configuration reference](../../docs/reference/configuration.md) – storage
  backends and every environment variable.
- [Feature flags](../../docs/reference/feature-flags.md) – which features are
  off by default and why.
- [REST API walkthrough](../../docs/guides/rest-api-walkthrough.md) – what a
  client sends to register a query, pin a version, execute it with arguments
  and download an ETL run's RDF. Its request bodies are executed by
  `test/integration/rest-example-walkthrough.test.ts`.
- [ETL](../../docs/guides/etl.md) – what enabling ETL grants, where job output
  goes and who must own it.

## Scripts

Run from the repository root with `pnpm --filter @sparql-query-lib/api <script>`,
or inside this package with `npm run <script>`.

- `dev` – Start the server in watch mode.
- `dev:observability` / `dev:stop` – Start and stop the Jaeger compose stack.
- `build` – Generate the shared contracts, then compile `dist/`.
- `generate-schemas` – Regenerate the contract and schema files in
  `packages/contracts/src/` from `src/persistence/schemas/`.
- `test` / `test:watch` – Vitest.
- `test:e2e` – Playwright.
- `seed:system-library` – Seed the system library from `system-store/assets/`.
- `export:library-store` / `import:library-store` – Dump and restore the
  library store as N-Quads.
- `export:bundle` – Export a static bundle.
- `smoke:storage` – Ask whether ETL output can be written here, and say who
  owns the mount if not. Meant to be run inside a container against the storage
  volume it will actually use.
- `smoke:etl-extensions` / `smoke:provider` – Check the DuckDB extensions and
  the configured assistant provider.

## Environment variables

The full list is in [the configuration
reference](../../docs/reference/configuration.md). The variables that decide
where data goes are below.

### Library persistence

`INTERNAL_BACKEND_TYPE` selects where the library persists its entities:

- `http` (default) – an external SPARQL endpoint.
  `LIBRARY_STORAGE_SPARQL_ENDPOINT` (default `http://localhost:3030/sqlib/`),
  optionally overridden per operation by
  `LIBRARY_STORAGE_SPARQL_QUERY_ENDPOINT` and
  `LIBRARY_STORAGE_SPARQL_UPDATE_ENDPOINT`, with
  `LIBRARY_STORAGE_SPARQL_USERNAME` / `LIBRARY_STORAGE_SPARQL_PASSWORD` for
  basic auth.
- `oxigraph-memory` – an ephemeral in-process store, for tests and development.
  It touches no disk: nothing is restored at boot, no checkpoint loop runs, and
  nothing is written on shutdown, so the library lives as long as the process.
  `LIBRARY_STORAGE_DIR` and `INTERNAL_OXIGRAPH_DB_PATH` are ignored. This is not
  the same thing as an `oxigraphMemory` *backend entity*, which is where queries
  run rather than where the library lives.
- `oxigraph-persistent` – an in-process store serialised to `.nq` files.
  `LIBRARY_STORAGE_DIR` (default `./storage/library-store`) is the directory
  those files are written to; `INTERNAL_OXIGRAPH_STORE_ID` (default
  `library-store`) names the store; `INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS`
  (default `60000`) is how often the in-memory store is checkpointed to disk.
  `INTERNAL_OXIGRAPH_LOAD_METHOD` (`file`, `remote-sparql`, `remote-file` or
  `none`, default `none`) and `INTERNAL_OXIGRAPH_BOOTSTRAP_SOURCE` (JSON)
  control an optional import at startup.

`oxigraph-persistent` is not RocksDB. The Oxigraph JavaScript/WebAssembly
bindings only support in-memory stores, so the store lives in memory and is
serialised to `.nq` on shutdown and on the checkpoint interval. For a
disk-backed store, run `oxigraph-server` as a sidecar and use the `http`
backend. `INTERNAL_OXIGRAPH_DB_PATH` is accepted for compatibility but ignored.

### Caching

- `CACHE_WRITE_THROUGH` – set to `false` to disable write-through caching
  (default on).
- `CACHE_PRELOAD` – set to `false` to disable cache preloading at boot
  (default on).

### ETL output

ETL job executions write their RDF to disk, one file per execution:

- `ETL_OUTPUT_DIR` (default `./storage/etl-output`)

The directory has to be writable by the user the process runs as. The image
runs as `node` (uid 1000) and creates `/app/packages/api/storage/etl-output`
with that ownership, so a *fresh* Docker volume works; a host bind mount or a
volume seeded by an older image keeps the ownership it already has and must be
chowned to 1000:1000. With `FEATURE_ETL=true` the server checks this at boot and
logs either `ETL output directory ready: …` or an error naming the fix. The
`smoke:storage` script asks the same question without booting the server, which
is how to check a mount before a job depends on it.

Example:

```bash
docker run -p 3000:3000 \
  -e INTERNAL_BACKEND_TYPE=oxigraph-persistent \
  -e LIBRARY_STORAGE_DIR=/app/packages/api/storage/library-store \
  -v sqlib-storage:/app/packages/api/storage \
  sqlib:latest
```
