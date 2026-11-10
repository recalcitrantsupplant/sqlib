# Security

## Reporting a vulnerability

Email **dcchabgood@gmail.com**. Give a description of the issue, the version or
commit that you tested, and the steps to reproduce it.

Do not open a public issue for a suspected vulnerability. Send an email first,
and give us time to respond before you disclose it.

sqlib is a pre-1.0 project with a very small team. We will acknowledge your
report, and tell you what we will do about it. We do not offer a response time,
a fix deadline, or a bounty.

## Scope

In scope:

- the server (`packages/api`, `packages/mcp-server`) and its REST and MCP
  interfaces;
- the Nuxt web application (`packages/web`);
- the SRL parser and compiler (`packages/srl`);
- the static-export runtime (`packages/runtime`, `packages/runtime-oxigraph`);
- the container image built from the `Dockerfile` at the root of the
  repository;
- the build and release scripts under `scripts/`.

Out of scope:

- the known security properties described below, which are documented
  intentionally;
- findings that depend on a feature that the operator turned on intentionally
  (ETL and the assistant, both off by default);
- SPARQL endpoints that you configure as backends, which are third-party
  systems;
- vulnerabilities in third-party dependencies. Report these to the upstream
  project. Tell us if the way sqlib uses a dependency makes it exploitable
  where it otherwise would not be.

## What to know before you deploy

**Authentication is off by default.** The REST API has an auth layer:
`SQLIB_AUTH_MODE`, with the modes `disabled`, `dry-run`, `required` and
`anonymous`, JWT issuers, and grants for each library and backend. The default
is `disabled`, which gives each request a full-access context. `/health` and the
root path are always public. The OpenAPI browser at `/docs` is public unless
`SQLIB_AUTH_PROTECT_DOCS=true`.

**`/mcp` has no authentication of its own.** It is on the same Fastify instance
as the API, so the API auth mode applies to it. Under `required`, sqlib refuses
a request with no bearer token, and each tool runs with the grants of the
caller. Under the default `disabled` mode, any person who can reach `/mcp` can
call the MCP tools. These tools read and write the library, and run queries
against its backends.

**The in-app assistant has no authorization.** Any person who can reach the
assistant endpoint can use it to do the same as through `/mcp`. In a default
deployment, network access is the only access control for these two routes. Put
the server behind a layer that enforces your own access control. See
[the security model](docs/explanation/security-model.md).

**ETL and the assistant are off by default.**

- ETL (`FEATURE_ETL`, `FEATURE_PLAYGROUND_ETL`) runs arbitrary DuckDB SQL. This
  SQL can read the host filesystem, and, with the httpfs extension, make
  outbound requests.
- The assistant (`FEATURE_ASSISTANT`) has no authentication, calls a
  third-party model provider, and can reach any configured backend.

Do not turn on any of the three because an upgrade made it available. Turn one
on only when you have decided that your deployment can accept the risk.

**Backend credentials come from the environment.** A `Backend` entity stores an
`authEnvKey`, which is a name and not a secret. At execution, the server reads
`SQLIB_BACKEND_<KEY>_USERNAME` and `SQLIB_BACKEND_<KEY>_PASSWORD`, or
`SQLIB_BACKEND_<KEY>_AUTH_HEADER`, from its own environment, and builds the
`Authorization` header from them (`packages/api/src/lib/backendAuth.ts`). sqlib
writes no username, password or header value to the library store. An export of
a library, or a copy of its store, therefore has no credentials. A person who
can run a query against a backend does use those credentials. For this reason,
the routes without authorization above are important.

**Query parameters are spliced into the parsed query.** sqlib inserts the values
supplied at execution as `VALUES` blocks into the parsed query. It never joins
them into the query text as strings. sqlib also writes a constant parameter
(`VALUES ?000word { UNDEF }`) into the triple patterns in the scope of its
clause, as the same term node. It then parses the result again before it sends
it.

**Fixes go to `main`.** Releases are tagged, but there is no table of supported
versions. Fixes merge to `main`.
