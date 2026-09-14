# sqlib

sqlib (`sparql-query-lib`) is a self-hostable server, web UI and MCP server for
authoring, versioning, parameterising, composing, testing, benchmarking and
exporting SPARQL queries and SPARQL-RL inference rules. It runs them against any
SPARQL endpoint you configure as a backend, or against an in-process Oxigraph
store.

## Prerequisites

- Node 24 (the version in [`.nvmrc`](.nvmrc)).
- pnpm 11.1.2 (pinned by `packageManager` in [`package.json`](package.json);
  `corepack enable` will select it).
- [`just`](https://github.com/casey/just) — the Justfile is the only task
  runner in this repo.
- Docker, only if you want to build or run the container image. The route below
  does not need it.

## First run

From the repository root:

```bash
pnpm install
pnpm build
just run-local-memory
```

`pnpm build` is required before the first run: the API imports the workspace's
`types`, `contracts`, `srl`, `tools`, `rdf-delta` and `runtime` packages through
their built entry points, so an unbuilt tree fails to start.

`just run-local-memory` starts the API and the MCP server on one Fastify
instance on port 3005, backed by an Oxigraph library store under
`packages/api/tmp/library-store`.

### What you should see

The terminal reports a dual HTTP server listening on port 3005. Open
<http://localhost:3005/> — it redirects to <http://localhost:3005/docs/>, the
OpenAPI (Swagger UI) browser for every route the server registered under the
feature flags currently in effect. `GET /health` returns the server's status,
uptime and auth mode.

The MCP endpoint is <http://localhost:3005/mcp>, streamable HTTP, the same
transport used in a container deployment.

The store survives a restart: the library's contents are written to disk on a
60-second checkpoint interval and on shutdown. To discard it, run
`just clean-local-memory`.

### The web UI is a separate process

The Nuxt SPA is not served by the API. Start it in a second terminal:

```bash
just run-frontend
```

It listens on <http://localhost:3001> and talks to `http://localhost:3005` by
default. Pass another base URL as an argument to point it elsewhere:
`just run-frontend https://example.org/`.

## Limitations to know before you rely on it

- `/mcp` and the in-app assistant perform no caller authorization. Do not expose
  either to a network you do not control. See [SECURITY.md](SECURITY.md).
- ETL and the assistant are off by default (`FEATURE_ETL`, `FEATURE_PLAYGROUND_ETL`,
  `FEATURE_ASSISTANT`), because ETL runs arbitrary DuckDB SQL. The recipe above
  sets `FEATURE_ASSISTANT=true`; the assistant still does nothing until a caller
  supplies a model provider, model and API key with the request.
- The `oxigraph-persistent` backend type is an in-memory store serialised to
  N-Quads on a checkpoint interval and on shutdown, not a disk-resident
  database. Its working set must fit in memory.
- The static-export runtime covers SELECT-chained query groups only.
- The repository is pre-1.0. Nothing has been released, and no compatibility
  guarantee applies to the REST API, the entity model or the SRL syntax.

## Documentation

- [docs/README.md](docs/README.md) — guides, reference and explanation, indexed
  by what you are trying to do.
- [docs/concepts.md](docs/concepts.md) — the vocabulary (Library, Query,
  QueryGroup, DataGraph, TupleSet, ArgumentSet, RuleSet) the rest of the
  documentation assumes.
- [CONTRIBUTING.md](CONTRIBUTING.md) — local setup, the checks CI runs, commit
  conventions.
- [SECURITY.md](SECURITY.md) — reporting a vulnerability, and the security
  posture of a deployment.

## Licence

sqlib is pre-1.0 and source-available for review only. See [LICENSE](LICENSE)
for the terms; it does not grant production use or redistribution. An open
source licence is planned for the public release. For an integrated deployment
before then, get in touch.
