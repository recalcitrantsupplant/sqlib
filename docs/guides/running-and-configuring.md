# Running sqlib locally and pointing it at a store

This guide covers starting the API, the MCP endpoint and the web UI from a
checkout, and choosing where the library's own data lives and what queries run
against.

The full list of environment variables, with defaults, is in
[configuration reference](../reference/configuration.md). This page explains the
choices; that page is the lookup table.

## Prerequisites

- Node. `.nvmrc` pins 24, which is the version CI installs. The published
  Docker image is built on `node:26-bookworm-slim`.
- pnpm 11.1.2 (the `packageManager` field in the root `package.json`).
- [just](https://github.com/casey/just). The `Justfile` is the only task
  runner in the repository.
- Docker, for building and running the image and for the HTTPS recipes.
- [mkcert](https://github.com/FiloSottile/mkcert), for the local HTTPS recipes
  only.

Install dependencies and build the workspace packages once:

```bash
pnpm install
pnpm build
```

`pnpm build` builds `types`, `contracts`, `runtime`, `tools`, `srl`,
`rdf-delta` and `api`, in that order. The recipes below rebuild individual
packages where they depend on a fresh build of one, but they do not substitute
for this first pass.

## The Justfile recipes

| Recipe | What it starts |
| --- | --- |
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
| `run-local-like-docker` | The API alone (no MCP) on port 3000, with the same persistence settings `run-docker-local` uses |
| `build-docker TAG` | `docker build -t sparql-query-lib:TAG .` |
| `run-docker-local TAG` | Runs that image with a host volume, publishing container port 3000 on host port 3005 |
| `run-docker-persistent TAG` | Runs that image in `APP_MODE=api` on port 3000 with a host volume |
| `run-frontend API_URL` | The web UI against any API base URL, default `http://localhost:3005` |

The recipes that take an argument default it, so `just build-docker` tags
`latest` and `just run-frontend` targets `http://localhost:3005`.

`run-local-memory`, `run-local-rules-tests` and `run-local-patch-demo` all run
`tsx watch` over `packages/mcp-server/src/cli.ts` with `MCP_TRANSPORT=dual-http`,
so each serves the REST API and the MCP endpoint from one process and one port.
`run-local-like-docker` runs the API's own entry point instead, so it has no
`/mcp`.

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

### Where the library lives: `INTERNAL_BACKEND_TYPE`

`http` (the default), `oxigraph-memory`, or `oxigraph-persistent`.

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
N-Quads. `INTERNAL_OXIGRAPH_DB_PATH` and the `persistPath` it sets are
deprecated and ignored. Two consequences worth knowing before choosing it:

- A process killed between checkpoints loses the writes since the last one.
- The whole library is in the process's address space. The npm `oxigraph`
  build is wasm32, so 4 GB is a hard ceiling and the practical ceiling is
  lower, because the store keeps several index permutations. For a library
  larger than that, run a SPARQL server and use `INTERNAL_BACKEND_TYPE=http`.

**`oxigraph-memory`** is for tests and short-lived development. The library
store is created on first use with no initial load, and its snapshot path is
under `OXIGRAPH_STORAGE_DIR` (default `./storage/oxigraph`) rather than
`LIBRARY_STORAGE_DIR`. No checkpoint timer runs in this mode, so the only write
to disk is the one a clean shutdown performs. `INTERNAL_OXIGRAPH_DB_PATH` is
accepted and ignored here too.

### What queries execute against: backends

A `Backend` is an entity, so it is created at runtime rather than configured in
the environment. Two kinds:

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
just build-docker 0.1.0
just run-docker-local 0.1.0
```

`run-docker-local` publishes container port 3000 on host port 3005, mounts
`./tmp/library-store-docker` at `/app/packages/api/tmp/library-store`, and sets
`INTERNAL_BACKEND_TYPE=oxigraph-persistent` with a 60-second checkpoint
interval.

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
