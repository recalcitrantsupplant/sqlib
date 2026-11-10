# sqlib

sqlib (`sparql-query-lib`) is a self-hostable server, web UI and MCP server for
authoring, versioning, parameterising, composing, testing, benchmarking and
exporting SPARQL queries and SHACL 1.2 inference rules. It runs them against any
SPARQL endpoint you configure as a backend, or against an in-process Oxigraph
store. By default it keeps its own state in SQLite files on local disk: the
library in `library.sqlite`, and grants in `auth.sqlite` when auth is on. No
database server is needed.

## Prerequisites

- Node 26 (the version in [`.nvmrc`](.nvmrc), which CI and both Docker images
  use).
- pnpm 11.1.2 (pinned by `packageManager` in [`package.json`](package.json)).
  Install it with `npm install --global pnpm@11.1.2`, because Node 25 and later
  ship without corepack.
- [`just`](https://github.com/casey/just). The Justfile is the only task runner
  in this repository.
- Docker, only to build or run the container image. The steps below do not need
  it.

## First run

From the repository root:

```bash
pnpm install
pnpm build
just run-local-memory
```

Run `pnpm build` before the first run. The API imports the `types`,
`contracts`, `srl`, `tools`, `rdf-delta`, `runtime`, `compiler`,
`runtime-duckdb`, `runtime-etl` and `runtime-srl` packages of the workspace
through their built entry points. Without a build, the server does not start.

`just run-local-memory` starts the API and the MCP server on one Fastify
instance on port 3005. The library store is Oxigraph, under
`packages/api/tmp/library-store`. `just dev` runs the same server with the web
UI and each feature flag on, on the default SQLite store
(`packages/api/tmp/library-store/library.sqlite`).

### What you should see

The terminal reports a dual HTTP server on port 3005. Open
<http://localhost:3005/>. It redirects to <http://localhost:3005/docs/>, the
OpenAPI (Swagger UI) browser for each route that the current feature flags
register. `GET /health` returns the status, uptime and auth mode of the server.

The MCP endpoint is <http://localhost:3005/mcp>. It uses streamable HTTP, the
same transport as a container deployment.

The store survives a restart. The server writes the library to disk every 60
seconds, and on shutdown. To delete it, run `just clean-local-memory`.

### The web UI is a separate process

The API does not serve the Nuxt SPA. Start the SPA in a second terminal:

```bash
just run-frontend
```

It listens on <http://localhost:3001>, and uses the API at
`http://localhost:3005` by default. To use a different API, pass its base URL:
`just run-frontend https://example.org/`.

## Limitations to know before you rely on it

- In the default auth mode, `/mcp` and the in-app assistant do no caller
  authorization. Do not expose either to a network that you do not control. See
  [SECURITY.md](SECURITY.md).
- ETL and the assistant are off by default (`FEATURE_ETL`,
  `FEATURE_PLAYGROUND_ETL`, `FEATURE_ASSISTANT`), because ETL runs arbitrary
  DuckDB SQL. The recipe above sets `FEATURE_ASSISTANT=true`. The assistant
  still does nothing until a caller supplies a model provider, a model and an
  API key with the request.
- The `oxigraph-persistent` backend type is an in-memory store. sqlib writes it
  to N-Quads at each checkpoint and on shutdown. Its working set must fit in
  memory.
- The static-export runtime supports only query groups that chain SELECT rows.
- The repository is pre-1.0. Releases are tagged: `v0.1.0` is the first, with
  its server image on GHCR. See [CHANGELOG.md](CHANGELOG.md). No compatibility
  guarantee applies to the REST API, the entity model or the SRL syntax. No
  package is published to npm.

## Documentation

- [docs/README.md](docs/README.md): guides, reference and explanation, indexed
  by task.
- [docs/concepts.md](docs/concepts.md): the terms (Library, Query, QueryGroup,
  DataGraph, TupleSet, ArgumentSet, RuleSet) that the other pages use.
- [CONTRIBUTING.md](CONTRIBUTING.md): local setup, the checks that CI runs, and
  commit conventions.
- [SECURITY.md](SECURITY.md): how to report a vulnerability, and the security
  of a deployment.

## Licence

sqlib is pre-1.0, and its source is available for review only. See
[LICENSE](LICENSE) for the terms. The licence does not grant production use or
redistribution. An open source licence is planned for the public release. For
an integrated deployment before then, contact the maintainer.
