# Architecture

This page explains how sqlib is put together: what the packages are, what runs
in which process, how a request to execute a query travels, and why a few of
the load-bearing decisions were made the way they were. It assumes the
vocabulary in [concepts.md](../concepts.md).

## The shape of the system

sqlib is a pnpm monorepo. One package is a Fastify server that owns all
behaviour; the rest are either things the server depends on, things that wrap
it, or things that run without it.

| Package | What it is | Depends on |
| --- | --- | --- |
| `api` | The Fastify server: routes, persistence, execution, auth, cache | `contracts`, `types`, `tools`, `srl`, `rdf-delta`, `runtime` |
| `web` | The Nuxt 4 single-page application | `types`, `runtime` (and `contracts` by path alias) |
| `mcp-server` | An MCP server that mounts the Fastify app in process | `api`, `contracts`, `tools`, `types` |
| `contracts` | Generated JSON Schema and zod schemas for every entity and route | — |
| `tools` | The MCP tool catalogue: 89 tool definitions and a registry | `contracts` |
| `types` | Shared constants and types, including the feature-flag table | — |
| `srl` | The SPARQL Rule Language (SRL) parser, compiler and stratifier | — |
| `rdf-delta` | Derives what a SPARQL update would add and remove, without running it | — |
| `runtime` | The parser-free runtime a static export bundle runs on | — |
| `runtime-oxigraph` | An Oxigraph-backed executor for that runtime | — |

`runtime` and `runtime-oxigraph` are the only two packages that are not
`private: true`. Everything else is internal to the repository.

### Why the split is where it is

The split follows three lines, and each one is a dependency direction somebody
needed rather than a tidiness exercise.

**A package exists where a second host needs the same code.** `runtime` holds
the argument-application code — `serializeTerm`, `alignArgumentSets`,
`substituteLimitOffset` — and `packages/api/src/lib/parser.ts` imports it rather
than reimplementing it. The comment at that import states the reason: importing
rather than copying is what makes "the client substitutes exactly as the server
does" true by construction. The same argument produced `rdf-delta` as a package
with no Fastify, no `fs` and no network dependency: server-side apply,
browser-side apply and worker-side apply are then the same code, and where the
patch log eventually lives becomes a choice of sink rather than a rewrite.

**A package exists where two consumers must agree about a document.**
`contracts` holds the generated schemas, and `tools` holds the MCP catalogue
that imports them. See [Generated schemas](#generated-schemas-one-source-three-consumers)
below.

**A package exists where the thing has its own grammar.** `srl` is a parser,
compiler and stratifier for a language, with no knowledge of libraries, HTTP or
storage.

The split that is deliberately *not* made is `api` itself. Persistence,
execution, orchestration, auth and the cache all live in one package, because
they are mutually recursive: the entity store executes SPARQL through the same
executor factory that runs a user's query, and the executor factory reads
backend entities out of the cache the entity store populates. Splitting them
would need an interface at every point in that cycle for no change in
behaviour.

## The two deployables

**A container image**, built from the repository-root `Dockerfile`. One image,
three modes, selected by `APP_MODE`:

- `api` — the Fastify server alone.
- `mcp-http` — the MCP server over streamable HTTP, which boots the Fastify app
  inside itself and registers `/mcp` on it.
- `dual-http` (the image default) — the same Fastify instance serving both the
  REST API and `/mcp` on one port.

**A static site**, `packages/web`, built by Nuxt with `ssr: false`. It is a
browser application that talks to the API over HTTP; there is no Nuxt server in
a deployment. It reads `/health` at boot to discover the API's auth mode and
skips its login flow when auth is disabled, so the same bundle works on both
sides of that setting.

A third artifact is not a deployable in the same sense: `GET
/libraries/:id/export-bundle` compiles a library into a self-contained bundle
that `packages/runtime` executes in a browser with no sqlib server present. See
[guides/static-export.md](../guides/static-export.md).

## The request path for executing a query

`POST /execute` with a target IRI is the path most of the system participates
in. In order:

1. **The auth plugin's `onRequest` hook** builds an `AuthContext` for the
   request. In `disabled` mode — the default — it is a synthetic full-access
   context, so every later enforcement point exists and passes. In `dry-run`
   and `required` modes it verifies the bearer token against a configured OIDC
   issuer and resolves the caller's grants.
2. **Route validation** against the generated JSON Schema for `/execute`.
3. **Target resolution from the cache.** `cacheCoordinator.get(targetId)`
   returns the `Query`, `QueryVersion`, `QueryGroup` or `QueryGroupVersion`
   synchronously from memory. A stable pointer is resolved to its
   `currentVersion`; a version IRI is used as given.
4. **Authorization on the owning library.** `requireLibraryMode(request,
   targetLibrary, 'execute')`. Execute is a mode of its own, independent of
   read.
5. **An `ExecutorFactory` scoped to this request.** Every executor used for the
   request — including each leg of a query group, which acquires its own
   through the execution engine — comes from this one factory, which calls
   `assertBackendAccess` before handing one out. The comment on its constructor
   states the reason: a query group leg cannot run against a backend the caller
   may not reach, and the property holds by construction rather than by
   remembering to check in each orchestrator.
6. **Argument application.** `applyExecutionArguments` substitutes named
   `LIMIT`/`OFFSET` parameters first, then binds the `VALUES` arguments. Both
   operate on the parsed query, never on the query text. The same function
   serves `POST /sparql`, which is what makes an unsaved query in the editor run
   the way a saved one does rather than approximately so.
7. **Execution** through an `ISparqlExecutor` — HTTP with credentials resolved
   from the environment, or an in-process Oxigraph store.
8. **Response**, with a `Server-Timing` header splitting database time from
   application time, and per-node timings for a query group.

A query group replaces steps 6–8 with the orchestration engine, which resolves
the node graph, executes nodes in dependency order and carries each node's
output along its outgoing edges as the next node's argument.

## Generated schemas: one source, three consumers

The entity schemas under `packages/api/src/persistence/schemas/` are the
intermediate representation for the whole data model. `packages/api/scripts/generate-schemas.ts`
reads them and writes:

- `packages/contracts/src/schema/entities.generated.ts` — a JSON Schema per
  entity type.
- `packages/contracts/src/schema/routes.generated.ts` — a JSON Schema per route,
  built from those entity schemas.
- `packages/contracts/src/generated/*.ts` — zod schemas and TypeScript types per
  entity.

Three consumers read the result, and none of them regenerates it:

1. **The API.** `packages/api/src/index.ts` imports `* as schemas from
   '@sparql-query-lib/contracts/schema'` and registers every document that
   carries an `$id` with Fastify. Those same documents are what `@fastify/swagger`
   renders at `/docs`, so the OpenAPI description is the validation, not a
   description of it.
2. **The MCP tool catalogue.** `packages/tools/src/tool-schemas.ts` imports
   route schemas from `@sparql-query-lib/contracts/schema/routes` and uses them
   directly as tool `inputSchema`s. Its own comment states the consequence: MCP
   and HTTP cannot disagree about what a valid payload is, because there is only
   one document. The tools that take path or query arguments rather than a body
   — `id`, `version`, `accept` — have nothing in contracts to correspond to, so
   eleven argument shapes are written out once in that file and shared across
   the catalogue.
3. **The web application.** It imports zod schemas and types from
   `@sparql-query-lib/contracts` through a Nuxt path alias that resolves to the
   package source, so `pnpm dev` does not depend on the package having been
   built.

There is a fourth reader of one narrow part: the MCP server compiles its tool
validators with `createValidatorAjv`, re-exported from the API's own entry
point. The comment there gives the reason: `coerceTypes` and `useDefaults`
change what a handler receives, so an MCP server building its own ajv would be a
second validator configuration free to drift from the server's.

The pipeline is run by `pnpm --filter @sparql-query-lib/api generate-schemas`,
and the API's `build` script runs it before compiling. Editing a generated file
by hand is undone by the next build; the entity schema is what changes.

## Why the MCP server mounts the Fastify app in process

`packages/mcp-server` does not speak HTTP to the API. It calls `configureApp` to
build a Fastify instance and then dispatches every tool call through
`app.inject`:

```ts
const response = await app.inject(withAuth as InjectOptions);
```

Three consequences follow, and each is relied on somewhere.

**One implementation of every operation.** A tool is a request the API already
serves. Nothing in `packages/tools` reimplements a route's behaviour; it builds
a request and reads a response. The catalogue's schemas are the routes' schemas,
so a payload accepted over HTTP is accepted over MCP.

**Every hook runs.** The change-feed hook (`registerChangeFeedHook`) is a single
`onSend` hook on mutating responses. Because an MCP write arrives through
`app.inject`, it passes that hook exactly as the web application's own HTTP
write does, and no MCP-specific code has to remember to announce a change. The
same holds for the auth plugin's `onRequest` hook and for the `no-store` hook
that keeps browsers from serving a saved-over entity from their own cache.

**The caller's token rides along.** `injectCaller` merges the inbound
`Authorization` header into the injected request, so a tool runs under the
caller's grants rather than an ambient service identity. Its comment states the
position plainly: the MCP server enforces nothing — it is a client.

The cost is that the change feed is a module-level emitter and therefore reaches
subscribers in the same process only. Under `dual-http` the API and `/mcp` are
one Fastify instance, which is what the feed needs. Under the `stdio` transport
the MCP server boots its own API instance in its own process, so a write there
is not heard by a browser subscribed to a different process. This is recorded in
`changeEvents.ts` rather than worked around.

## Persistence and the entity cache

sqlib stores its own entities as RDF, in a SPARQL store, through its own query
execution path.

The layer was originally built on LDKit. LDKit has been removed. What replaced
it is:

- `packages/api/src/persistence/EntityStore.ts` — the engine. It is keyed on the
  *schema* rather than on an entity-type name, generates the SELECT, INSERT,
  DELETE and UPDATE for that schema, and executes them through the executor
  resolved for `LIBRARY_STORAGE_BACKEND_ID`. That indirection is what makes both
  internal backend modes work without this file knowing which is configured.
- `packages/api/src/persistence/SelfHostedAdapter.ts` — the type-keyed facade
  the cache talks to. It maps an entity type to its schema through
  `SCHEMA_BY_TYPE` and hands off to `EntityStore`.
- `packages/api/src/lib/EntityRegistry.ts` — `LENS_BY_TYPE`, the per-entity
  repositories (52 entity types), and `TTL_MS`, the per-type cache lifetime.

Names carrying `Ldkit`/`LENS` survive in the types and the registry; the
implementation behind them does not. Any older material describing LDKit lenses,
a `persistPath` RocksDB store, or seven route modules is describing a system
that no longer exists.

Reads are served synchronously from an in-memory cache; writes go to the store
first and then update the cache. The details — why versions never expire, what
`CACHE_PRELOAD` and `CACHE_WRITE_THROUGH` do, and what the three
`INTERNAL_BACKEND_TYPE` choices cost — are in
[storage-and-caching.md](storage-and-caching.md).

## The API surface

`packages/api/src/routes/` holds twenty-three files: twenty-two route plugins
and `route-helpers.ts`, which is shared handler scaffolding rather than a route.
Grouped by what they are for:

- **Containers and classification.** `libraries`, `tags`.
- **Callables and their versions.** `queries`, `query-groups`, `rules`,
  `rule-sets`, `data-blocks`.
- **Inputs.** `argument-sets`, `argument-set-schemas`, `tuple-sets`,
  `data-graphs`.
- **Running things.** `execute` (saved callables), `sparql` (a proxy for
  arbitrary query text), `playground` (unsaved rules and ETL, executed against
  ephemeral entities), `detection` (parse a query for its parameters and
  outputs, validate, format).
- **Judging things.** `tests`, `benchmarks`.
- **Backends and writes to them.** `backends`, `patches`.
- **Operations.** `auth` (identity introspection and grant administration),
  `events` (the change feed as Server-Sent Events), `etl-jobs`, `assistant`.

Outside the route modules, `index.ts` registers `/` (a redirect to the docs UI),
`/health` and `/metrics`.

Registration is gated by feature flags. `queries` off means `/queries` and
`/execute` are never registered at all, not that they answer 403. Four route
groups are deliberately *not* gated, and `index.ts` records why in each case:
tags, tuple sets and data graphs because they are inputs to more than one
section and gating them would leave entities referencing versions nothing could
resolve; patches because a patch is a property of a backend rather than of a
library section. The flag table itself is in
[reference/feature-flags.md](../reference/feature-flags.md).

## Related

- [versioning-and-immutability.md](versioning-and-immutability.md) — why an
  entity splits into a stable pointer and frozen versions.
- [storage-and-caching.md](storage-and-caching.md) — where the library lives and
  what the cache guarantees.
- [security-model.md](security-model.md) — what is authenticated and what is not.
- [rdf-patch.md](rdf-patch.md) — how `rdf-delta` derives an update's effect
  before applying it.
- [guides/deploying.md](../guides/deploying.md) — running the image and the web
  app.
- [reference/configuration.md](../reference/configuration.md) — every
  environment variable.
