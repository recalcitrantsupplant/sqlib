# Running sqlib locally and pointing it at a store

This guide covers starting the API, the MCP endpoint and the web UI from a
checkout, and choosing where the library's own data lives and what queries run
against.

The full list of environment variables, with defaults, is in
[configuration reference](../reference/configuration.md). This page explains the
choices; that page is the lookup table.

## Prerequisites

- Node 26. `.nvmrc` pins it, CI installs it, and both Docker images are built
  on `node:26-bookworm-slim`.
- pnpm 11.1.2 (the `packageManager` field in the root `package.json`).
- [just](https://github.com/casey/just). The `Justfile` is the only task
  runner in the repository.
- Docker, for building and running the image and for the HTTPS recipes.
- [mkcert](https://github.com/FiloSottile/mkcert), for the local HTTPS recipes
  only.

To start the API, MCP and web UI with the defaults (SQLite store, every
feature flag on, auth disabled), run `just` from the repository root. It
installs the dependencies and builds what it needs first.

To run the other recipes, or the packages' own scripts, install dependencies
and build the workspace packages once:

```bash
pnpm install
pnpm build
```

`pnpm build` builds `types`, `contracts`, `runtime`, `compiler`, `runtime-duckdb`, `runtime-etl`, `tools`, `srl`, `runtime-srl`,
`rdf-delta` and `api`, in that order. The recipes below rebuild individual
packages where they depend on a fresh build of one, but they do not substitute
for this first pass.

## The Justfile recipes

`just --list` shows every recipe by group, and
[scripts reference](../reference/scripts.md) describes each one. These start
sqlib:

| Recipe | What it starts |
| --- | --- |
| `dev` (bare `just`) | API + MCP on `http://localhost:3005` and the web UI on `http://localhost:3001`. SQLite store under `packages/api/tmp/library-store`, every feature flag on, auth disabled |
| `run-local-memory` | API + MCP on `http://localhost:3005`, library in a local Oxigraph store under `packages/api/tmp/library-store`, in-app assistant enabled |
| `clean-local-memory` | Deletes that store |
| `setup-local-https` | Generates trusted `localhost` certificates into `certs/` with mkcert (one-time) |
| `run-local-https` | The same dual API+MCP process on port 3300, behind a Traefik container terminating TLS on `https://localhost:3443` |
| `run-docker-https` | The built image plus Fuseki behind Traefik on `https://localhost:3443`, with no host pnpm process |
| `run-local-rules-tests` | API on `http://localhost:3005` seeded with the W3C SHACL 1.2 Rules suite as runnable Tests, in its own store |
| `run-frontend-rules` | The web UI with the feature flags that recipe's API serves |
| `clean-local-rules-tests` | Deletes the rules-test store |
| `run-local-patch-demo` | API on `http://localhost:3005` seeded with a demo library of update queries, for reading RDF Patch previews |
| `run-frontend-patch-demo` | The web UI with the matching flags |
| `uat-patch-demo` | Drives that demo end to end in a browser against a running API and UI; it starts neither |
| `clean-local-patch-demo` | Deletes the patch-demo store |
| `build-docker TAG` | `docker build -t sparql-query-lib:TAG .` |
| `run-docker TAG PORT` | Runs that image with its defaults on `127.0.0.1:PORT` (default 3005), with the `sqlib-data` volume |
| `clean-docker` | Deletes the `sqlib-data` volume |
| `run-frontend API_URL` | The web UI against any API base URL, default `http://localhost:3005` |

The recipes that take an argument default it, so `just build-docker` tags
`latest` and `just run-frontend` targets `http://localhost:3005`.

`dev`, `run-local-memory`, `run-local-rules-tests` and `run-local-patch-demo`
all run `tsx watch` over `packages/mcp-server/src/cli.ts` with
`MCP_TRANSPORT=dual-http`, so each serves the REST API and the MCP endpoint from
one process and one port.

The three feature-flag-heavy recipes come in pairs. The API and the web UI are
separate processes that each read their own environment, so
`run-frontend-rules` and `run-frontend-patch-demo` set `NUXT_PUBLIC_FEATURE_*`
variables matching the `FEATURE_*` variables their API half sets. Starting the
plain `run-frontend` against one of those APIs leaves the navigation rail
offering sections the server no longer serves.

## The two storage axes

Storage means two independent things in sqlib, configured in different places.

**Where the library's own metadata lives** — libraries, queries, query
versions, rule sets, tests, backends, everything the application owns — is a
process-level setting, `INTERNAL_BACKEND_TYPE`, read at boot from the
environment (`packages/api/src/server/config.ts`). One server has exactly one
of these.

**What a query executes against** is a `Backend` entity, registered through
`POST /backends` and stored in the library like any other entity. A backend is
either an HTTP SPARQL endpoint or an in-process Oxigraph store hydrated from
data graphs. A server can have any number of them, and every execution names
one.

The two are unrelated: a server can keep its library in an in-process store and
run queries against a remote endpoint, or the reverse.

A third store holds grants and principals when auth is on. It is also SQLite by
default (`auth.sqlite` in `SQLIB_AUTH_STORE_DIR`, default `./storage/auth`); see
[the auth store](../explanation/storage-and-caching.md#where-grants-live-the-auth-store).
With the defaults, a server's durable state is `library.sqlite` and
`auth.sqlite`, and nothing else needs to run beside it.

### Where the library lives: `INTERNAL_BACKEND_TYPE`

`sqlite` (the default), `http`, `oxigraph-persistent`, or `oxigraph-memory`.

**`sqlite`** keeps the library in one file, `library.sqlite`, and writes each
change to disk before it returns:

| Variable | Default |
| --- | --- |
| `LIBRARY_STORAGE_DIR` | `./storage/library-store`, resolved from the working directory |

Keep the directory on local disk or a block volume, not a network file share.
[Storage and caching](../explanation/storage-and-caching.md#sqlite-the-default)
gives the detail and compares the four options.

**`http`** persists the library to an external SPARQL endpoint that accepts
query and update:

| Variable | Default |
| --- | --- |
| `LIBRARY_STORAGE_SPARQL_ENDPOINT` | `http://localhost:3030/sqlib/` |
| `LIBRARY_STORAGE_SPARQL_QUERY_ENDPOINT` | the endpoint above |
| `LIBRARY_STORAGE_SPARQL_UPDATE_ENDPOINT` | the endpoint above |
| `LIBRARY_STORAGE_SPARQL_USERNAME` | unset |
| `LIBRARY_STORAGE_SPARQL_PASSWORD` | unset |

The default points at a local Fuseki on its conventional port, so an
unconfigured server fails against localhost rather than reaching a host a
default once named.

**`oxigraph-persistent`** keeps the library in an in-process Oxigraph store and
writes it to disk as N-Quads:

| Variable | Default |
| --- | --- |
| `LIBRARY_STORAGE_DIR` | `./storage/library-store`, resolved from the working directory |
| `INTERNAL_OXIGRAPH_STORE_ID` | `library-store` |
| `INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS` | `60000` |
| `INTERNAL_OXIGRAPH_LOAD_METHOD` | `none`; also `file`, `remote-sparql`, `remote-file` |
| `INTERNAL_OXIGRAPH_BOOTSTRAP_SOURCE` | unset; JSON describing the source for a load method other than `none` |

The snapshot is a single `.nq` file in `LIBRARY_STORAGE_DIR`, named after the
store id with every non-alphanumeric character replaced by an underscore. It is
restored at boot when it exists, rewritten on the checkpoint interval, and
written again on a clean shutdown. An initial load method applies only on a
first boot with no snapshot to restore.

This is not RocksDB, and not disk-backed in the sense the Oxigraph Rust and
Python bindings mean. The JavaScript/WebAssembly bindings support in-memory
stores only, so `oxigraph-persistent` is an in-memory store serialised to
N-Quads (`INTERNAL_OXIGRAPH_DB_PATH` is not read). Two consequences worth knowing before choosing it:

- A process killed between checkpoints loses the writes since the last one.
- The whole library is in the process's address space. The npm `oxigraph`
  build is wasm32, so 4 GB is a hard ceiling and the practical ceiling is
  lower, because the store keeps several index permutations. For a library
  larger than that, run a SPARQL server and use `INTERNAL_BACKEND_TYPE=http`.

**`oxigraph-memory`** is for tests and short-lived development. The library
store is created empty on first use and never touches disk: nothing is
restored at boot and nothing is written at shutdown, so every start is a
fresh, empty library.

### What queries execute against: backends

A `Backend` is an entity, so it is created at runtime rather than configured in
the environment. Two kinds are in use, and a third is kept for older libraries:

- `http` — a SPARQL endpoint, with an optional separate update URL and
  optional basic-auth credentials.
- `oxigraphMemory` — an in-process store hydrated from data graph versions in
  the same library, with a `mode` of `readOnly` (the default), `ephemeral`
  (writable, never serialised) or `durable` (writable, serialised under
  `OXIGRAPH_STORAGE_DIR`). Its `oxigraphConfig` is a JSON **string**, not a
  nested object.

A source entry naming a `dataGraphId` tracks that graph's current version and
the store is reloaded when a new version is saved; one naming a
`dataGraphVersionId` pins immutable content. Writes to a `readOnly` backend are
refused with 403 at the executor, because Oxigraph's store has no read-only
flag of its own.

An `oxigraphMemory` backend can also be seeded from an RDF file, a file URL or
a SPARQL endpoint (`loadMethod` and `sourceConfig` in its `oxigraphConfig`).
`oxigraphEphemeral`, the older type, is an empty writable store that lasts until
the process stops. [Storage and caching](../explanation/storage-and-caching.md#where-queries-run-backends)
compares the three, and shows how to serve read-only data with no SPARQL server.

[The REST walkthrough](rest-api-walkthrough.md) registers one of these and runs
a query against it.

### ETL output

An ETL job execution writes its RDF to a file rather than returning it in the
response. `ETL_OUTPUT_DIR` (default `./storage/etl-output`) says where. The
directory has to be writable by the user the process runs as; the image runs as
`node` (uid 1000). With `FEATURE_ETL=true` the server checks this at boot and
logs either that the directory is ready or an error naming the fix, and
`pnpm --filter @sparql-query-lib/api smoke:storage` asks the same question
without booting the server.

ETL is off by default. See [feature flags](../reference/feature-flags.md) for
why.

## Running the Docker image

Build it, then run it:

```bash
docker build -t sqlib .
docker run --rm -p 127.0.0.1:3000:3000 sqlib
```

The image runs with the defaults of `just`: the SQLite library store, every
feature flag on, and auth disabled. The REST API and MCP are on port 3000. It
needs no environment variables and no volume. Every setting is an `ENV` in the
`Dockerfile`, so `-e NAME=value` overrides it.

With auth disabled and ETL on, any caller can run arbitrary DuckDB SQL in the
container. `-p 127.0.0.1:3000:3000` publishes the port on the loopback
interface only. Publish it more widely only on a network you control, or turn
auth on as [deploying](deploying.md) describes.

The image keeps all of its state under `/app/packages/api/storage`: the
library (`library-store/`), grants (`auth/`), Oxigraph backends (`oxigraph/`)
and ETL output (`etl-output/`). Without a volume, that state is lost when the
container is removed. Mount a named volume to keep it:

```bash
docker run --rm -p 127.0.0.1:3000:3000 -v sqlib-data:/app/packages/api/storage sqlib
```

`just build-docker` and `just run-docker` do the same, with the tag
`sparql-query-lib:latest` and the API on host port 3005.

`APP_MODE` selects what the container runs:

| `APP_MODE` | Runs | Port |
| --- | --- | --- |
| `dual-http` (the image default) | REST API and MCP on one port | `HTTP_PORT`, default 3000 |
| `api` | the REST API alone | `PORT`, default 3000 |
| `mcp-http` | MCP alone | `MCP_HTTP_PORT`, default 3333 |

The image declares `/app/packages/api/storage` as a volume and creates it owned
by `node`, so a fresh Docker volume is writable. A host bind mount, or a named
volume seeded by an older image, keeps the ownership it already has and must be
chowned to `1000:1000`.

In `api` mode the server binds `FASTIFY_ADDRESS` (default `0.0.0.0`) and reads
`PORT`; in the two MCP modes it reads `HTTP_HOST`/`HTTP_PORT` or
`MCP_HTTP_HOST`/`MCP_HTTP_PORT`. The image sets all four, so publishing the port
is the only thing a plain `docker run` needs.

## Running the web UI

The web package is a Nuxt 4 application with `ssr: false`. In development it
serves on port 3001 and reads the API base URL from the environment:

```bash
just run-frontend                        # against http://localhost:3005
just run-frontend http://localhost:3000  # against an API started another way
```

That recipe sets `NUXT_PUBLIC_API_BASE_URL`, whose build-time default is
`http://localhost:3000`. Feature flags come from `NUXT_PUBLIC_FEATURE_*`
variables, falling back to the unprefixed `FEATURE_*` names; a UI whose flags
disagree with its API's will draw sections that return 404. For a built
deployment the same settings can be supplied at runtime instead — see
[deploying](deploying.md).

## Local HTTPS

Some MCP clients require an HTTPS origin. Two recipes cover that without a
public certificate:

```bash
just setup-local-https   # once: mkcert -install, then certificates into certs/
just run-local-https     # app on :3300, Traefik terminating TLS on :3443
```

`run-local-https` starts the dual-mode app from source and a Traefik container
that proxies `https://localhost:3443` to `http://127.0.0.1:3300`, so the API is
at `https://localhost:3443/` and MCP at `https://localhost:3443/mcp`.
`run-docker-https` does the same for the built image, adding a Fuseki container
that the app uses as its library store, and needs an image tagged
`sparql-query-lib:aca-local`.

See [connecting an MCP client](mcp-clients.md) for what to point at those URLs,
including the fact that `/mcp` requires no credentials.

## Checking that it came up

- `GET /health` returns status, uptime, the auth mode and cache statistics.
- `GET /docs` serves the OpenAPI UI, and `GET /` redirects to it.

Both are served in every mode that runs the API.
