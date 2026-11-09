# Running sqlib locally and pointing it at a store

This guide tells you how to start the API, the MCP endpoint and the web UI from
a checkout. It also tells you how to choose where the library is stored and what
queries run against.

The [configuration reference](../reference/configuration.md) lists each
environment variable with its default. This page explains the choices.

## Prerequisites

- Node 26. `.nvmrc` pins it, CI installs it, and both Docker images are built
  on `node:26-bookworm-slim`.
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

`pnpm build` builds `types`, `contracts`, `runtime`, `compiler`, `runtime-duckdb`, `runtime-etl`, `tools`, `srl`, `runtime-srl`,
`rdf-delta` and `api`, in that order. Some recipes below build one package again
when they need a fresh build of it. They do not build the whole workspace, so
run `pnpm build` first.

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
| `uat-patch-demo` | Runs that demo from start to end in a browser, against an API and a UI that are already running. It starts neither. |
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

The recipes that set many feature flags come in pairs. The API and the web UI
are separate processes, and each reads its own environment. `run-frontend-rules`
and `run-frontend-patch-demo` therefore set the `NUXT_PUBLIC_FEATURE_*`
variables to match the `FEATURE_*` variables of their API recipe. If you start
the plain `run-frontend` against one of those APIs, the navigation rail shows
sections that the server does not serve.

## The two storage axes

In sqlib, storage means two separate things, configured in different places.

**Where the library is stored.** This is the metadata that sqlib owns:
libraries, queries, query versions, rule sets, tests, backends and the other
entities. It is a process-level setting, `INTERNAL_BACKEND_TYPE`, read from the
environment at start (`packages/api/src/server/config.ts`). One server has
exactly one library store.

**What a query executes against.** This is a `Backend` entity, registered
through `POST /backends` and stored in the library like any other entity. A
backend is an HTTP SPARQL endpoint, or an Oxigraph store in the server process,
loaded from data graphs. A server can have any number of backends, and each
execution names one.

The two settings are independent. A server can keep its library in an
in-process store and run queries against a remote endpoint, or the reverse.

A third store holds grants and principals when auth is on. It is also SQLite by
default (`auth.sqlite` in `SQLIB_AUTH_STORE_DIR`, default `./storage/auth`). See
[the auth store](../explanation/storage-and-caching.md#where-grants-live-the-auth-store).
With the defaults, the durable state of a server is `library.sqlite` and
`auth.sqlite`, and no other process needs to run next to it.

### Where the library lives: `INTERNAL_BACKEND_TYPE`

`sqlite` (the default), `http`, `oxigraph-persistent`, or `oxigraph-memory`.

**`sqlite`** keeps the library in one file, `library.sqlite`, and writes each
change to disk before it returns:

| Variable | Default |
| --- | --- |
| `LIBRARY_STORAGE_DIR` | `./storage/library-store`, resolved from the working directory |

Keep the directory on a local disk or a block volume. Do not use a network file
share.
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

The default is a local Fuseki on its usual port. A server with no configuration
therefore fails against localhost, and does not connect to a host that an old
default named.

**`oxigraph-persistent`** keeps the library in an in-process Oxigraph store and
writes it to disk as N-Quads:

| Variable | Default |
| --- | --- |
| `LIBRARY_STORAGE_DIR` | `./storage/library-store`, resolved from the working directory |
| `INTERNAL_OXIGRAPH_STORE_ID` | `library-store` |
| `INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS` | `60000` |
| `INTERNAL_OXIGRAPH_LOAD_METHOD` | `none`; also `file`, `remote-sparql`, `remote-file` |
| `INTERNAL_OXIGRAPH_BOOTSTRAP_SOURCE` | unset; JSON describing the source for a load method other than `none` |

The snapshot is one `.nq` file in `LIBRARY_STORAGE_DIR`. Its name is the store
id, with each non-alphanumeric character changed to an underscore. sqlib
restores it at start if it exists, writes it again at each checkpoint interval,
and writes it at a clean shutdown. An initial load method applies only at a
first start with no snapshot to restore.

The JavaScript/WebAssembly bindings of Oxigraph support in-memory stores only.
The RocksDB disk store of the Rust and Python bindings is not available.
`oxigraph-persistent` is therefore an in-memory store that sqlib writes to
N-Quads. sqlib does not read `INTERNAL_OXIGRAPH_DB_PATH`. Before you choose this
option, note two effects:

- A process killed between checkpoints loses the writes since the last one.
- The whole library is in the address space of the process. The npm `oxigraph`
  build is wasm32, so 4 GB is a hard limit. The practical limit is lower,
  because the store keeps several index permutations. For a library
  larger than that, run a SPARQL server and use `INTERNAL_BACKEND_TYPE=http`.

**`oxigraph-memory`** is for tests and short development sessions. sqlib
creates the store empty at first use, and never writes it to disk. Nothing is
restored at start and nothing is written at shutdown, so each start has an
empty library.

### What queries execute against: backends

A `Backend` is an entity, so you create it at runtime. The environment does not
configure it. Two types are in use, and a third is kept for older libraries:

- `http`: a SPARQL endpoint, with an optional separate update URL and optional
  basic-auth credentials.
- `oxigraphMemory`: an in-process store loaded from data graph versions in the
  same library. Its `mode` is `readOnly` (the default), `ephemeral` (writable,
  never written to disk) or `durable` (writable, written under
  `OXIGRAPH_STORAGE_DIR`). Its `oxigraphConfig` is a JSON **string**. A nested
  object is refused.

A source entry that names a `dataGraphId` follows the current version of that
graph, and sqlib loads the store again when a new version is saved. A source
entry that names a `dataGraphVersionId` pins immutable content. The executor
refuses writes to a `readOnly` backend with 403, because the Oxigraph store has
no read-only setting of its own.

An `oxigraphMemory` backend can also be seeded from an RDF file, a file URL or
a SPARQL endpoint (`loadMethod` and `sourceConfig` in its `oxigraphConfig`).
`oxigraphEphemeral`, the older type, is an empty writable store that lasts until
the process stops. [Storage and caching](../explanation/storage-and-caching.md#where-queries-run-backends)
compares the three, and shows how to serve read-only data with no SPARQL server.

[The REST walkthrough](rest-api-walkthrough.md) registers one of these and runs
a query against it.

### ETL output

An ETL job execution writes its RDF to a file. The response does not contain
the RDF. `ETL_OUTPUT_DIR` (default `./storage/etl-output`) sets the directory.
The user that the process runs as must be able to write to it. The image runs as
`node` (uid 1000). With `FEATURE_ETL=true`, the server checks the directory at
start. It logs that the directory is ready, or it logs an error that names the
fix. `pnpm --filter @sparql-query-lib/api smoke:storage` does the same check
without a server start.

ETL is off by default. [Feature flags](../reference/feature-flags.md) gives the
reason.

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
by `node`, so a new Docker volume is writable. A host bind mount, or a named
volume made by an older image, keeps its existing owner. Change its owner to
`1000:1000` with `chown`.

In `api` mode, the server binds `FASTIFY_ADDRESS` (default `0.0.0.0`) and reads
`PORT`. In the two MCP modes, it reads `HTTP_HOST`/`HTTP_PORT` or
`MCP_HTTP_HOST`/`MCP_HTTP_PORT`. The image sets all four, so a plain
`docker run` needs only the published port.

## Running the web UI

The web package is a Nuxt 4 application with `ssr: false`. In development it
serves on port 3001 and reads the API base URL from the environment:

```bash
just run-frontend                        # against http://localhost:3005
just run-frontend http://localhost:3000  # against an API started another way
```

That recipe sets `NUXT_PUBLIC_API_BASE_URL`, whose build-time default is
`http://localhost:3000`. Feature flags come from the `NUXT_PUBLIC_FEATURE_*`
variables. If one is not set, the UI reads the `FEATURE_*` name without the
prefix. If the flags of the UI differ from those of its API, the UI shows
sections that return 404. A built deployment can supply the same settings at
runtime. See [deploying](deploying.md).

## Local HTTPS

Some MCP clients require an HTTPS origin. Two recipes give one without a public
certificate:

```bash
just setup-local-https   # once: mkcert -install, then certificates into certs/
just run-local-https     # app on :3300, Traefik terminating TLS on :3443
```

`run-local-https` starts the dual-mode app from source and a Traefik container
that proxies `https://localhost:3443` to `http://127.0.0.1:3300`, so the API is
at `https://localhost:3443/` and MCP at `https://localhost:3443/mcp`.
`run-docker-https` does the same for the built image. It adds a Fuseki container
that the app uses as its library store. It needs an image tagged
`sparql-query-lib:aca-local`.

[Connecting an MCP client](mcp-clients.md) tells you how to connect a client to
those URLs. `/mcp` requires no credentials.

## Check that the server started

- `GET /health` returns status, uptime, the auth mode and cache statistics.
- `GET /docs` serves the OpenAPI UI, and `GET /` redirects to it.

Each mode that runs the API serves both.
