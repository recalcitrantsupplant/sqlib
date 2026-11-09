# Architecture

This page describes how sqlib is built: the packages, the process that runs
each one, the path of a request to execute a query, and the reasons for some
main design decisions. It uses the terms in [concepts.md](../concepts.md).

## The shape of the system

sqlib is a pnpm monorepo. One package, `api`, is a Fastify server that holds all
behaviour. The other packages are dependencies of the server, wrappers around
it, or code that runs without it.

| Package | What it is | Depends on |
| --- | --- | --- |
| `api` | The Fastify server: routes, persistence, execution, auth, cache | `contracts`, `types`, `tools`, `srl`, `rdf-delta`, `runtime`, `compiler`, `runtime-duckdb`, `runtime-etl`, `runtime-srl` |
| `web` | The Nuxt 4 single-page application | `types`, `runtime` (and `contracts` by path alias) |
| `mcp-server` | An MCP server that mounts the Fastify app in its own process | `api`, `contracts`, `tools`, `types` |
| `contracts` | Generated JSON Schema and zod schemas for each entity and route | none |
| `tools` | The MCP tool catalogue: 89 tool definitions and a registry | `contracts` |
| `types` | Shared constants and types, including the feature-flag table | none |
| `srl` | The SHACL 1.2 Shape Rules Language parser, compiler and stratifier | none |
| `rdf-delta` | Calculates what a SPARQL update would add and remove, without running it | none |
| `compiler` | The SPARQL parser: parse, detect parameters, apply arguments, compile verified templates | `runtime` |
| `runtime` | The parser-free runtime that a static export bundle runs on | none |
| `runtime-oxigraph` | An Oxigraph executor for that runtime | none |
| `runtime-duckdb` | The sandboxed DuckDB that reads ETL sources, under a profile from the host | none |
| `runtime-etl` | The ETL loop: rows in chunks, mapped to bindings, put into a CONSTRUCT, RDF sent to a sink | `runtime` |
| `runtime-srl` | The rule set runner: DATA blocks, then each stratum to its fixpoint, on an Oxigraph store | `srl` |
| `cli` | The `sqlib` command line: queries, ETL jobs and rule sets in one process, with no server | `compiler`, `runtime`, `runtime-oxigraph`, `runtime-duckdb`, `runtime-etl`, `runtime-srl`, `srl` |

Eight packages are publishable (they are not `private: true`):

- `runtime` and `runtime-oxigraph`. A static export loads them in a browser or
  in Node. They ship CommonJS and ESM.
- `compiler`, `srl`, `runtime-duckdb`, `runtime-etl`, `runtime-srl` and `cli`.
  The `sqlib` command line is built from them. They run in Node only and ship
  ESM.

All other packages are internal to the repository.

### Why the packages are split this way

Three rules decide where a package boundary is. Each rule comes from a
dependency that a second consumer needed.

**A package exists where a second host needs the same code.**

- `runtime` holds the code that applies arguments: `serializeTerm`,
  `alignArgumentSets`, `substituteLimitOffset`. `compiler` holds the parser and
  imports this code. The comment at that import gives the reason: with one copy
  of the code, the client applies arguments in the same way as the server.
- `rdf-delta` has no Fastify, `fs` or network dependency. The server, the
  browser and a worker can therefore apply a patch with the same code. A later
  move of the patch log to a different place is then a change of sink only.
- `compiler` runs the parser, input detection and template compilation in the
  API and in the command-line tool, so neither host has its own copy. The API
  wraps it only to send its diagnostics to the service log.
- `runtime-duckdb` gives the API and the command-line tool one sandbox for
  reading ETL sources. The API supplies a profile read from the environment.
  The tool supplies a profile from its flags.
- `runtime-etl` holds the loop that the rows go through, so a job gives the same
  RDF in each host. `packages/api/test/lib/etlParity.test.ts` checks this.
- `runtime-srl` does the same for rule sets. The `RuleSetExecutor` of the API
  loads, validates and stratifies stored versions, and the runner evaluates
  them.

**A package exists where two consumers must agree about a document.**
`contracts` holds the generated schemas. `tools` holds the MCP catalogue that
imports them. See [Generated schemas](#generated-schemas-one-source-three-consumers)
below.

**A package exists where the code has its own grammar.** `srl` is a parser,
compiler and stratifier for a language. It knows nothing about libraries, HTTP
or storage.

`api` itself stays one package. Persistence, execution, orchestration, auth and
the cache call each other in a cycle. The entity store executes SPARQL through
the same executor factory that runs the query of a user. The executor factory
reads backend entities from the cache that the entity store fills. A split would
need an interface at each point in that cycle, and the behaviour would not
change.

## The two deployables

**A container image**, built from the `Dockerfile` at the repository root. One
image has three modes. `APP_MODE` selects the mode:

- `api`: the Fastify server only.
- `mcp-http`: the MCP server over streamable HTTP. It starts the Fastify app
  inside itself and registers `/mcp` on it.
- `dual-http` (the image default): one Fastify instance serves the REST API and
  `/mcp` on one port.

**A static site**, `packages/web`, built by Nuxt with `ssr: false`. It is a
browser application that calls the API over HTTP. A deployment has no Nuxt
server. At start, the site reads `/health` to find the auth mode of the API. When
auth is disabled, it skips its login flow. The same bundle therefore works with
auth on and with auth off.

A third output is not deployed in the same way. `GET
/libraries/:id/export-bundle` compiles a library into a self-contained bundle.
`packages/runtime` executes the bundle in a browser, with no sqlib server. See
[guides/static-export.md](../guides/static-export.md).

## The request path for executing a query

Most of the system takes part in `POST /execute` with a target IRI. The steps
are:

1. **The `onRequest` hook of the auth plugin** builds an `AuthContext` for the
   request. In `disabled` mode (the default) the context gives full access, so
   each later check runs and passes. In `dry-run` and `required` modes, the hook
   verifies the bearer token against the configured OIDC issuer and loads the
   grants of the caller.
2. **Route validation** against the generated JSON Schema for `/execute`.
3. **Target resolution from the cache.** `cacheCoordinator.get(targetId)`
   returns the `Query`, `QueryVersion`, `QueryGroup` or `QueryGroupVersion`
   from memory, synchronously. A stable pointer resolves to its
   `currentVersion`. A version IRI is used as given.
4. **Authorization on the library that owns the target.**
   `requireLibraryMode(request, targetLibrary, 'execute')`. Execute is a
   separate mode from read.
5. **An `ExecutorFactory` for this request.** Each executor that the request
   uses comes from this one factory, including the executor for each leg of a
   query group. The factory calls `assertBackendAccess` before it returns an
   executor. As the comment on its constructor says, a query group leg therefore
   cannot run against a backend that the caller has no access to. No
   orchestrator has to add its own check.
6. **Argument application.** `applyExecutionArguments` puts in the named
   `LIMIT`/`OFFSET` values first, then binds the `VALUES` arguments. `VALUES`
   binding works on the parsed query. Page parameters are found and replaced on
   the tokens of the query, because the parser does not keep the `000` lexeme
   that names a parameter. Comments, string literals and IRIs are skipped, so
   text that only looks like `LIMIT 0001` is never a parameter. `POST /sparql`
   uses the same function, so an unsaved query in the editor runs in the same
   way as a saved one.
7. **Execution** through an `ISparqlExecutor`: over HTTP with credentials from
   the environment, or on an Oxigraph store in the server process.
8. **Response**, with a `Server-Timing` header that gives database time and
   application time separately, and timings for each node of a query group.

For a query group, the orchestration engine does steps 6 to 8. It resolves the
node graph, executes the nodes in dependency order, and sends the output of each
node along its outgoing edges as an argument to the next node.

## Generated schemas: one source, three consumers

The entity schemas in `packages/api/src/persistence/schemas/` describe the
whole data model. `packages/api/scripts/generate-schemas.ts` reads them and
writes:

- `packages/contracts/src/schema/entities.generated.ts`: a JSON Schema for each
  entity type.
- `packages/contracts/src/schema/routes.generated.ts`: a JSON Schema for each
  route, built from the entity schemas.
- `packages/contracts/src/generated/*.ts`: zod schemas and TypeScript types for
  each entity.

Three consumers read the output. None of them generates it again:

1. **The API.** `packages/api/src/index.ts` imports `* as schemas from
   '@sparql-query-lib/contracts/schema'` and registers with Fastify each
   document that has an `$id`. `@fastify/swagger` renders the same documents at
   `/docs`, so the OpenAPI description and the validation are one document.
2. **The MCP tool catalogue.** `packages/tools/src/tool-schemas.ts` imports the
   route schemas from `@sparql-query-lib/contracts/schema/routes` and uses them
   as the `inputSchema` of each tool. MCP and HTTP therefore accept the same
   payloads. Some tools take path or query arguments (`id`, `version`,
   `accept`) and no body. Contracts has no schema for these, so that file
   defines eleven argument shapes once and the catalogue shares them.
3. **The web application.** It imports zod schemas and types from
   `@sparql-query-lib/contracts` through a Nuxt path alias that resolves to the
   package source. `pnpm dev` therefore works before the package is built.

A fourth consumer reads one part. The MCP server compiles its tool validators
with `createValidatorAjv`, which the API exports from its own entry point. The
comment there gives the reason. `coerceTypes` and `useDefaults` change what a
handler receives. An MCP server with its own ajv would have a second validator
configuration, which could drift from that of the server.

`pnpm --filter @sparql-query-lib/api generate-schemas` runs the pipeline. The
`build` script of the API runs it before it compiles. The next build overwrites
a hand edit to a generated file, so change the entity schema.

## Why the MCP server mounts the Fastify app in process

`packages/mcp-server` calls `configureApp` to build a Fastify instance. It then
sends each tool call to that instance through `app.inject`, with no HTTP
connection:

```ts
const response = await app.inject(withAuth as InjectOptions);
```

Three results follow, and other code depends on each one.

**One implementation of each operation.** A tool is a request that the API
already serves. `packages/tools` builds a request and reads a response. The
schemas of the catalogue are the schemas of the routes, so MCP accepts each
payload that HTTP accepts.

**Each hook runs.** The change-feed hook (`registerChangeFeedHook`) is one
`onSend` hook on responses that change data. An MCP write arrives through
`app.inject`, so it goes through that hook in the same way as an HTTP write from
the web application. No MCP code has to announce a change. The same is true for
the `onRequest` hook of the auth plugin, and for the `no-store` hook that stops
browsers from serving an old copy of an entity from their own cache.

**The token of the caller goes with the call.** `injectCaller` copies the
inbound `Authorization` header into the injected request, so a tool runs with
the grants of the caller. As its comment says, the MCP server enforces nothing
itself. It is a client.

The change feed is a module-level emitter, so it reaches subscribers in the same
process only. Under `dual-http`, the API and `/mcp` are one Fastify instance, so
the feed works. Under the `stdio` transport, the MCP server starts its own API
instance in its own process. A browser subscribed to a different process does
not get the events for a write there. `changeEvents.ts` records this limit.

## Persistence and the entity cache

sqlib stores its own entities as RDF, through its own query execution path.

The layer was first built on an RDF mapping library, which was later removed.
The current layer is:

- `packages/api/src/persistence/EntityStore.ts`: the engine. It is keyed on the
  *schema* of an entity type. It generates the SELECT, INSERT, DELETE and UPDATE
  for that schema, and executes them through the executor for
  `LIBRARY_STORAGE_BACKEND_ID`. Because of this indirection, the file does not
  need to know which RDF storage mode is configured. In the default `sqlite`
  mode, each function calls `packages/api/src/persistence/sqliteEntityStore.ts`,
  which returns the rows that the SELECT would return.
- `packages/api/src/persistence/SelfHostedAdapter.ts`: the facade that the cache
  calls, keyed by entity type. It maps an entity type to its schema through
  `SCHEMA_BY_TYPE` and calls `EntityStore`.
- `packages/api/src/lib/EntityRegistry.ts`: `LENS_BY_TYPE`, the repository for
  each entity type (52 types), and `TTL_MS`, the cache lifetime for each type.

The name `LENS` is still in the registry, but the lens implementation is gone.
The entity interfaces are named `Persisted*` (`PersistedQuery`,
`PersistedBackend`, ...). Older material about library lenses, a `persistPath`
RocksDB store, or seven route modules describes a previous system.

Reads come from an in-memory cache, synchronously. Writes go to the store first,
then update the cache. [storage-and-caching.md](storage-and-caching.md) gives
the detail: why versions never expire, what `CACHE_PRELOAD` and
`CACHE_WRITE_THROUGH` do, and the cost of each `INTERNAL_BACKEND_TYPE` choice.

## The API surface

`packages/api/src/routes/` holds twenty-five files:

- Twenty-three route plugins.
- `route-helpers.ts`: shared handler code and the single error response.
- `versionedEntity.ts`: the router that makes the ten CRUD routes that each
  versioned entity has. These are list, create, get, update and delete, and the
  same five under `/:id/versions`.

Queries, query groups, rules, rule sets, data blocks, data graphs, tuple sets
and tests register through `versionedEntity.ts`. Their own modules hold only
what is specific to them: schemas, how a version is written and shown, and
routes for that entity. [versioning-and-immutability.md](versioning-and-immutability.md)
gives the rules that the router applies (status codes, If-Match, deletes of
pinned versions).

The route plugins, by purpose:

- **Containers and classification.** `libraries`, `tags`.
- **Callables and their versions.** `queries`, `query-groups`, `rules`,
  `rule-sets`, `data-blocks`.
- **Inputs.** `argument-sets`, `argument-set-schemas`, `tuple-sets`,
  `data-graphs`.
- **Execution.** `execute` (saved callables), `sparql` (a proxy for any query
  text), `playground` (unsaved rules and ETL, run against temporary entities),
  `detection` (parse a query for its parameters and outputs, validate, format).
- **Tests and measurement.** `tests`, `benchmarks`.
- **Backends and writes to them.** `backends`, `patches`.
- **Operations.** `auth` (identity introspection and grant administration),
  `events` (the change feed as Server-Sent Events), `etl-jobs`, `assistant`.

`src/server/` holds the startup modules that `index.ts` puts together:

- `bootstrap.ts`: crash handlers, `.env`, OpenTelemetry. It is imported first.
- `swagger.ts`, `health.ts`, `metrics.ts`, `errorHandler.ts`, `seed.ts`.
- `registerRoutes.ts`: registers `/` (a redirect to the docs UI), `/health`,
  `/metrics` and each route plugin.

Feature flags control route registration. When `queries` is off, the server does
not register `/queries`, `/execute`, `/sparql` or `/detect-*` at all. Each
playground route has its own flag. Four route groups have no flag, and
`registerRoutes.ts` gives the reason for each:

- Tags, tuple sets and data graphs are inputs to more than one section. A flag on
  them would leave entities that reference versions that nothing can resolve.
- A patch belongs to a backend, and a flag is per library section.

[reference/feature-flags.md](../reference/feature-flags.md) has the flag table.

## Related

- [versioning-and-immutability.md](versioning-and-immutability.md): why an
  entity has a stable pointer and immutable versions.
- [storage-and-caching.md](storage-and-caching.md): where the library lives,
  and what the cache guarantees.
- [security-model.md](security-model.md): what needs authentication and what
  does not.
- [rdf-patch.md](rdf-patch.md): how `rdf-delta` calculates the effect of an
  update before it is applied.
- [guides/deploying.md](../guides/deploying.md): run the image and the web app.
- [reference/configuration.md](../reference/configuration.md): each environment
  variable.
