# Security

## Reporting a vulnerability

Email **dcchabgood@gmail.com** with a description of the issue, the version or
commit you tested, and the steps to reproduce it.

Do not open a public issue for a suspected vulnerability. Use the email address
above first, and give us a chance to respond before disclosing.

sqlib is a pre-1.0 project maintained by a very small team. We will acknowledge
your report and tell you what we intend to do about it, but we do not offer a
response-time commitment, a fix deadline, or a bounty.

## Scope

In scope: the server (`packages/api`, `packages/mcp-server`) and its REST and
MCP surfaces; the Nuxt web application (`packages/web`); the SRL parser and
compiler (`packages/srl`); the static-export runtime (`packages/runtime`,
`packages/runtime-oxigraph`); the container image built from the repository-root
`Dockerfile`; and the build and release scripts under `scripts/`.

Out of scope: the known posture described below, which is documented rather than
accidental; findings that depend on a feature the operator has deliberately
enabled (ETL and the assistant, both off by default); SPARQL endpoints you
configure as backends, which are third-party systems; and vulnerabilities in
third-party dependencies, which should go to the upstream project, though we
want to hear if sqlib's use of one makes it exploitable where it otherwise
would not be.

## Posture you need to know before deploying

**`/mcp` and the in-app assistant perform no caller authorization.** Both are
documented in the code as blocked on a caller-authorization model that has been
designed but not shipped. Anyone who can reach `/mcp` can call the MCP tools,
which read and write the library and execute queries against its backends.
Anyone who can reach the assistant endpoint can do the same through it. Treat
network reachability as the only access control these two doors have, and place
the server behind something that enforces your own.

The REST API has an auth layer (`SQLIB_AUTH_MODE`, with modes `disabled`,
`dry-run` and `required`, plus JWT issuers and per-library and per-backend
grants), but it defaults to `disabled`, in which every request is given a
full-access context. `/health` and the root path are always public, and the
OpenAPI browser at `/docs` is public unless `protectDocs` is turned on.

**ETL and the assistant are off by default, for stated reasons.** ETL
(`FEATURE_ETL`, `FEATURE_PLAYGROUND_ETL`) executes arbitrary DuckDB SQL, which
is a read primitive against the host filesystem and, with the httpfs extension,
an outbound request primitive. The assistant (`FEATURE_ASSISTANT`) is
unauthenticated, calls a third-party model provider, and can reach any
configured backend. None of the three should be turned on because an upgrade
made them available; turn one on when you have decided your deployment can carry
it.

**Backend credentials come from the environment, not from the library.** A
`Backend` entity stores an `authEnvKey` — a name, not a secret. At execution the
server reads `SQLIB_BACKEND_<KEY>_USERNAME` and `SQLIB_BACKEND_<KEY>_PASSWORD`,
or `SQLIB_BACKEND_<KEY>_AUTH_HEADER`, from its own environment and builds the
`Authorization` header from them (`packages/api/src/lib/backendAuth.ts`). No
username, password or header value is written to the library store, so exporting
a library or copying its store does not carry credentials with it. Anyone who
can execute a query against a backend is, however, using those credentials —
which is the reason the unauthenticated doors above matter.

**Query parameters are spliced, not concatenated.** Values supplied at execution
are inserted as `VALUES` blocks into the parsed query, rather than being
substituted into query text.

**Nothing has been released.** No published artifact exists to patch, and there
is no supported-versions table. Fixes land on `main`.
