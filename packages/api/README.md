# @sparql-query-lib/api

The Fastify server of sqlib. This package holds the persistence layer, the
REST routes, schema generation, and the scripts that support them. It is
`private: true`, and is not published. `@sparql-query-lib/mcp-server` uses it
in the same process, and `@sparql-query-lib/web` uses it over HTTP.

## Key directories

- `src/`: Fastify server: `routes/` (one module per resource), `persistence/`
  (the entity store and its schemas), `lib/` (rules, ETL, execution,
  detection), `assistant/`, `auth/`, `server/` (configuration).
- `scripts/`: Build-time and operational tooling: schema generation, system
  library seeding, store export/import, smoke checks.
- `test/`: Vitest suites, including `test/integration/`.
- `tests/e2e/`: Playwright suites.
- `examples/`: Request and response payloads. Some are embedded into the
  generated OpenAPI schema; see `examples/README.md`.
- `data/examples/`: Sample CSV files used by ETL examples.
- `system-store/assets/`: Turtle seeds for the system library.
- `storage/`: Runtime data written by the process (library store
  serialisations, ETL output). Not tracked in git.

## Documentation

- [Architecture](../../docs/explanation/architecture.md): how the server,
  the SPA, the MCP server and the runtime packages fit together.
- [Storage and caching](../../docs/explanation/storage-and-caching.md): the
  entity store, the cache coordinator and the entity registry.
- [Running and configuring](../../docs/guides/running-and-configuring.md) and
  [Configuration reference](../../docs/reference/configuration.md): storage
  backends and every environment variable.
- [Feature flags](../../docs/reference/feature-flags.md): which features are
  off by default and why.
- [REST API walkthrough](../../docs/guides/rest-api-walkthrough.md): what a
  client sends to register a query, pin a version, execute it with arguments
  and download an ETL run's RDF. Its request bodies are executed by
  `test/integration/rest-example-walkthrough.test.ts`.
- [ETL](../../docs/guides/etl.md): what enabling ETL grants, where job output
  goes and who must own it.

## Scripts

Run from the repository root with `pnpm --filter @sparql-query-lib/api <script>`,
or inside this package with `npm run <script>`.

- `dev`: Start the server in watch mode.
- `dev:observability` / `dev:stop`: Start and stop the Jaeger compose stack.
- `build`: Generate the shared contracts, then compile `dist/`.
- `generate-schemas`: Regenerate the contract and schema files in
  `packages/contracts/src/` from `src/persistence/schemas/`.
- `test` / `test:watch`: Vitest.
- `test:e2e`: Playwright.
- `seed:system-library`: Seed the system library from `system-store/assets/`.
- `export:library-store` / `import:library-store`: Dump and restore the
  library store as N-Quads.
- `export:bundle`: Export a static bundle.
- `smoke:storage`: Ask whether ETL output can be written here, and say who
  owns the mount if not. Run it in a container, against
  the storage volume that the container will use.
- `smoke:etl-extensions` / `smoke:provider`: Check the DuckDB extensions and
  the configured assistant provider.

## Environment variables

The full list is in [the configuration
reference](../../docs/reference/configuration.md). The variables that decide
where data goes are below.

### Library persistence

`INTERNAL_BACKEND_TYPE` selects where the library persists its entities:

- `http` (default): an external SPARQL endpoint.
  `LIBRARY_STORAGE_SPARQL_ENDPOINT` (default `http://localhost:3030/sqlib/`),
  optionally overridden per operation by
  `LIBRARY_STORAGE_SPARQL_QUERY_ENDPOINT` and
  `LIBRARY_STORAGE_SPARQL_UPDATE_ENDPOINT`, with
  `LIBRARY_STORAGE_SPARQL_USERNAME` / `LIBRARY_STORAGE_SPARQL_PASSWORD` for
  basic auth.
- `oxigraph-memory`: an ephemeral in-process store, for tests and development.
- `oxigraph-persistent`: an in-process store serialised to `.nq` files.
  `LIBRARY_STORAGE_DIR` (default `./storage/library-store`) is the directory
  those files are written to; `INTERNAL_OXIGRAPH_STORE_ID` (default
  `library-store`) names the store; `INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS`
  (default `60000`) is how often the in-memory store is checkpointed to disk.
  `INTERNAL_OXIGRAPH_LOAD_METHOD` (`file`, `remote-sparql`, `remote-file` or
  `none`, default `none`) and `INTERNAL_OXIGRAPH_BOOTSTRAP_SOURCE` (JSON)
  control an optional import at startup.

`oxigraph-persistent` keeps the store in memory. The Oxigraph
JavaScript/WebAssembly bindings support only in-memory stores. The server
writes the store to `.nq` at shutdown and at each checkpoint interval. For a
store on disk, run `oxigraph-server` as a sidecar, and use the `http` backend.
The server does not read `INTERNAL_OXIGRAPH_DB_PATH`.

### Caching

- `CACHE_WRITE_THROUGH`: set to `false` to turn off write-through caching.
  It is on by default.
- `CACHE_PRELOAD`: set to `false` to turn off cache preloading at boot. It
  is on by default.

### ETL output

ETL job executions write their RDF to disk, one file per execution:

- `ETL_OUTPUT_DIR` (default `./storage/etl-output`)

The user that runs the process must be able to write to the directory. The
image runs as `node` (uid 1000), and creates
`/app/packages/api/storage/etl-output` with that owner. A *new* Docker volume
therefore works. A host bind mount, or a volume from an older image, keeps its
owner. Change its owner to 1000:1000 with `chown`.

With `FEATURE_ETL=true`, the server checks the directory at boot. It logs
`ETL output directory ready: …`, or an error that names the fix. The
`smoke:storage` script does the same check with no server. Use it to check a
mount before a job uses it.

Example:

```bash
docker run -p 3000:3000 \
  -e INTERNAL_BACKEND_TYPE=oxigraph-persistent \
  -e LIBRARY_STORAGE_DIR=/app/packages/api/storage/library-store \
  -v sqlib-storage:/app/packages/api/storage \
  sqlib:latest
```
