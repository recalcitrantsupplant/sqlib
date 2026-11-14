# sqlib

sqlib (`sparql-query-lib`) is a self-hostable server, web UI and MCP server for
authoring, versioning, parameterising, composing, testing, benchmarking and
exporting SPARQL queries and SHACL 1.2 inference rules. It runs them against any
SPARQL endpoint you configure as a backend, or against an in-process Oxigraph
store. By default it keeps its own state in SQLite files on local disk: the
library in `library.sqlite`, and grants in `auth.sqlite` when auth is on. No
database server is needed.

## Quick start

From a clone, with Node 26, pnpm 11.1.2 and [`just`](https://github.com/casey/just)
1.27 or later:

```bash
just
```

Open <http://localhost:3001>. The first run installs the dependencies and
builds the packages the API needs, which takes a few minutes.

With Docker only, build the image and run it:

```bash
docker build -t sqlib .
docker run --rm -p 127.0.0.1:3000:3000 sqlib
```

The API is then on <http://localhost:3000> and MCP on
<http://localhost:3000/mcp>. The image has no web UI; to use it, run
`just run-frontend http://localhost:3000` from a clone.

Both routes start sqlib with the same defaults:

| Setting | Default |
| --- | --- |
| Library store | SQLite (`library.sqlite`) |
| Feature flags | All on, including ETL, the assistant and OGC API Features |
| Auth | Disabled: every caller may read and write |

With auth disabled and ETL on, any caller can run arbitrary DuckDB SQL in the
server process. Publish the port on `127.0.0.1` or on a network you control
only. [SECURITY.md](SECURITY.md) describes the posture of a deployment.

### Prerequisites

- Node 26 (the version in [`.nvmrc`](.nvmrc), which CI and both Docker images
  use).
- pnpm 11.1.2 (pinned by `packageManager` in [`package.json`](package.json)).
  Install it with `npm install --global pnpm@11.1.2`, because Node 25 and later
  ship without corepack.
- [`just`](https://github.com/casey/just) 1.27 or later. The Justfile is the
  only task runner in this repository.
- Docker, only to build or run the container image.

### What `just` starts

`just` runs the `dev` recipe:

| Address | What |
| --- | --- |
| <http://localhost:3001> | The web UI |
| <http://localhost:3005> | The REST API. `/` redirects to the OpenAPI browser at `/docs/`, and `GET /health` reports status and auth mode |
| <http://localhost:3005/mcp> | The MCP endpoint, streamable HTTP |

The library is in `packages/api/tmp/library-store/library.sqlite`. It survives
a restart; `just clean-local-memory` deletes it. Ctrl-C stops both processes.

`just --list` shows the other recipes by group: other stores, auth behind a
local Rauthy, demos, HTTPS, Docker and observability.
[docs/reference/scripts.md](docs/reference/scripts.md) describes each one.

### Keeping data in Docker

The image keeps all of its state under `/app/packages/api/storage`. Without a
volume, the data is lost when the container is removed. Mount a named volume
there to keep it:

```bash
docker run --rm -p 127.0.0.1:3000:3000 -v sqlib-data:/app/packages/api/storage sqlib
```

`just build-docker` and `just run-docker` do the same with the image tag
`sparql-query-lib:latest`, on port 3005. A deployment sets its own
environment, which overrides these defaults: see
[deploying](docs/guides/deploying.md).

## Limitations to know before you rely on it

- In the default auth mode, `/mcp` and the in-app assistant do no caller
  authorization. Do not expose either to a network that you do not control. See
  [SECURITY.md](SECURITY.md).
- ETL, the assistant and OGC API Features are off in the code's own defaults,
  because ETL runs arbitrary DuckDB SQL. `just` and the image turn them on. A
  deployment of the image that leaves a `FEATURE_*` variable unset gets that
  feature on. The assistant does nothing until a caller supplies a model
  provider, a model and an API key with the request.
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
