# Configuration reference

Every environment variable the server reads, with the default that applies when
it is unset and what setting it changes. Defaults here are taken from the code
that reads each variable.

Two processes read this environment and they are not the same process. The API
(`packages/api`) reads `PORT` and `FASTIFY_ADDRESS`; the MCP runtime
(`packages/mcp-server`), which mounts the API in-process, reads `HTTP_PORT`,
`HTTP_HOST` and the `MCP_*` variables. The container starts one of them
according to `APP_MODE`. The web app is a separate static build with its own
`NUXT_PUBLIC_*` variables, listed at the end.

For the reasoning behind these choices rather than their values, see
[running and configuring](../guides/running-and-configuring.md) and
[deploying](../guides/deploying.md).

## Server and transport

| Name | Default | Effect |
| --- | --- | --- |
| `APP_MODE` | `dual-http` (set in the image) | Read only by the container's start command. `api` runs `packages/api/dist/index.js`; `mcp-http` runs the MCP runtime with `MCP_TRANSPORT=streamable-http`; `dual-http`, and any other value, runs it with `MCP_TRANSPORT=dual-http`. Outside the container nothing reads it. |
| `MCP_TRANSPORT` | unset: `streamable-http` when `NODE_ENV=production`, otherwise `stdio` | Transport for `packages/mcp-server`. Accepts `stdio`, `http` or `streamable-http`, and `dual-http` or `http+api`. `dual-http` serves the REST API and MCP at `/mcp` on one port. |
| `HTTP_PORT` | `3000` | Listening port in `dual-http` mode. |
| `HTTP_HOST` | `0.0.0.0` | Listening address in `dual-http` mode. Falls back to `MCP_HTTP_HOST` when unset. |
| `MCP_HTTP_PORT` | `3333` | Listening port in `streamable-http` mode (MCP only, at `/mcp`). |
| `MCP_HTTP_HOST` | `0.0.0.0` | Listening address in `streamable-http` mode. |
| `PORT` | `3000` | Listening port when `packages/api` is started directly (`APP_MODE=api`). A value that does not parse as a number falls back to 3000. |
| `FASTIFY_ADDRESS` | `0.0.0.0` | Listening address when `packages/api` is started directly. |
| `APP_BASE_PATH` | empty | Mounts every API route under this prefix. A leading slash is added and trailing slashes are stripped; `/` means no prefix. |
| `APP_PUBLIC_BASE_PATH` | value of `APP_BASE_PATH` | The prefix the server advertises in generated URLs, for a deployment behind a proxy that rewrites the path. |
| `NODE_ENV` | unset | Standard Node convention. It selects the MCP transport default above, switches OTLP export on in `development` (see telemetry), and suppresses OpenTelemetry logging when it is `test`. |
| `MCP_DEBUG_PORT` | `3334` | Port for `packages/mcp-server`'s echo server (`pnpm --filter @sparql-query-lib/mcp-server dev:debug-http`), a development aid, not part of the served application. |
| `MCP_DEBUG_HOST` | `127.0.0.1` | Address for the same. |

## Library storage

The library — every entity you author — lives in a store chosen by
`INTERNAL_BACKEND_TYPE`. This is separate from the backends your queries run
against, which are entities you create through the API.

| Name | Default | Effect |
| --- | --- | --- |
| `INTERNAL_BACKEND_TYPE` | `http` | `http`, `oxigraph-memory` or `oxigraph-persistent`. Any other value is treated as `http`. |
| `LIBRARY_STORAGE_SPARQL_ENDPOINT` | `http://localhost:3030/sqlib/` | With `INTERNAL_BACKEND_TYPE=http`, the SPARQL endpoint holding the library. The default is a local Fuseki on its conventional port, so an unconfigured server fails against localhost rather than reaching an external host. |
| `LIBRARY_STORAGE_SPARQL_QUERY_ENDPOINT` | value of `LIBRARY_STORAGE_SPARQL_ENDPOINT` | Query URL, when the store separates query from update. |
| `LIBRARY_STORAGE_SPARQL_UPDATE_ENDPOINT` | value of `LIBRARY_STORAGE_SPARQL_ENDPOINT` | Update URL, when the store separates query from update. |
| `LIBRARY_STORAGE_SPARQL_USERNAME` | unset | Basic-auth username for the library endpoint. |
| `LIBRARY_STORAGE_SPARQL_PASSWORD` | unset | Basic-auth password for the library endpoint. |
| `LIBRARY_STORAGE_DIR` | `./storage/library-store`, resolved against the process working directory | With `INTERNAL_BACKEND_TYPE=oxigraph-persistent`, the directory holding the `.nq` serialisation of the library. |
| `INTERNAL_OXIGRAPH_STORE_ID` | `library-store` | Name of the persistent store within that directory. |
| `INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS` | `60000` | How often the in-memory store is written back to `.nq`. |
| `INTERNAL_OXIGRAPH_LOAD_METHOD` | `none` | How the store is populated at boot: `file`, `remote-sparql`, `remote-file` or `none`. An unrecognised value falls back to `none`. |
| `INTERNAL_OXIGRAPH_BOOTSTRAP_SOURCE` | unset | A JSON object describing the source for that load method. Invalid JSON is logged as a warning and ignored. |
| `OXIGRAPH_STORAGE_DIR` | `./storage/oxigraph` | Directory for in-process Oxigraph backends you create as entities — the stores behind `oxigraphEphemeral` and `oxigraphMemory` backends. It is not where the library lives unless `INTERNAL_BACKEND_TYPE=oxigraph-persistent`, in which case `LIBRARY_STORAGE_DIR` takes over for the library store. |
| `ENABLE_OXIGRAPH` | `false` | Set to `true` to initialise the Oxigraph store manager even when the library is not in Oxigraph, so that Oxigraph-backed backend entities work. It is initialised unconditionally when `INTERNAL_BACKEND_TYPE=oxigraph-persistent`. |
| `DEBUG_OXIGRAPH` | `false` | Set to `true` to log every SPARQL operation the in-process Oxigraph executor runs. |

### What `oxigraph-persistent` actually does

The Oxigraph JavaScript/WebAssembly bindings support in-memory stores only.
There is no RocksDB-backed store as there is in the Rust and Python bindings.
`oxigraph-persistent` is an in-memory store that is serialised to `.nq` files
in `LIBRARY_STORAGE_DIR` on shutdown and every
`INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS` milliseconds, and restored from those
files at startup. A process killed between checkpoints loses the writes made
since the last one. `oxigraph-memory` keeps nothing.

For a store that is durable in the usual sense, run a SPARQL server such as
Oxigraph's own or Fuseki alongside and use `INTERNAL_BACKEND_TYPE=http`.

`INTERNAL_OXIGRAPH_DB_PATH` and the `persistPath` / `dbPath` fields in the
internal backend config are deprecated and ignored. They named a RocksDB
directory that these bindings cannot open. The variable is still read — into
`dbPath` under `oxigraph-memory`, into `persistPath` under
`oxigraph-persistent` — and nothing reads either field, so setting it changes
nothing. Serialisation goes to `LIBRARY_STORAGE_DIR` regardless.

See [storage and caching](../explanation/storage-and-caching.md) for how the
store and the in-memory cache relate.

## Execution backend credentials

A `Backend` entity does not store credentials. It stores an `authEnvKey`, and
the server looks up the credentials in the environment under that key. This
keeps secrets out of the library store, which is exported, imported and copied.

`authEnvKey` must match `^[A-Z0-9_]+$`. For a backend whose `authEnvKey` is
`<KEY>`, the server reads, in this order:

| Name | Effect |
| --- | --- |
| `SQLIB_BACKEND_<KEY>_USERNAME` and `SQLIB_BACKEND_<KEY>_PASSWORD` | Both present: HTTP Basic. The pair is base64-encoded into `Authorization: Basic …`. |
| `SQLIB_BACKEND_<KEY>_AUTH_HEADER` | Used when the username/password pair is incomplete. Sent verbatim as the `Authorization` header, so it must include its scheme (`Bearer …`). |
| neither | No `Authorization` header is sent. |

`<KEY>` is the entity's `authEnvKey` upper-cased. A backend with
`authEnvKey: "qms_fuseki_dev"` reads `SQLIB_BACKEND_QMS_FUSEKI_DEV_USERNAME`
and `SQLIB_BACKEND_QMS_FUSEKI_DEV_PASSWORD`. A backend with no `authEnvKey`
sends no credentials.

| Name | Default | Effect |
| --- | --- | --- |
| `HTTP_SPARQL_USER_AGENT` | `sparql-query-lib/adhoc` | `User-Agent` sent to HTTP SPARQL endpoints. |
| `SQLIB_BACKEND_PROBE_TIMEOUT_MS` | `10000` | Timeout for the reachability probe run when a backend is created or checked. Values that are not a positive finite number fall back to the default. |
| `SQLIB_BACKEND_SLOW_MS` | `250` | Above this round-trip time a probed backend is reported as slow. |
| `SQLIB_PREFIX_DETECT` | on | Set to `off` to skip detecting a backend's namespace prefixes during the probe. Any other value leaves detection on. |
| `SQLIB_PREFIX_TIMEOUT_MS` | `10000` | Timeout for the prefix-detection query. See [prefixes](../guides/prefixes.md). |

## Caching

| Name | Default | Effect |
| --- | --- | --- |
| `CACHE_WRITE_THROUGH` | `true` | Every entity write goes to the store as well as the in-memory cache. Set to exactly `false` to keep writes in memory only; any other value leaves it on. With it off, background refreshes from the store are skipped too. |
| `CACHE_PRELOAD` | `true` | Load every entity into the cache at startup. Set to `false` (case-insensitive) to skip the preload; with it off, background per-type refreshes are also skipped. |
| `ENABLE_TIMING_LOGS` | `true`, and not changeable | Intended to switch per-request timing logs. The expression that reads it is `process.env.ENABLE_TIMING_LOGS === 'true' \|\| true`, so `config.enableTimingLogs` is always `true` and setting the variable has no effect. |

Entity time-to-live in the cache is not configurable by environment: it is set
per entity type in `packages/api/src/lib/EntityRegistry.ts`, where immutable
versions are held indefinitely. See
[storage and caching](../explanation/storage-and-caching.md).

## ETL

ETL is off by default; see [feature flags](feature-flags.md) and the
[ETL guide](../guides/etl.md).

| Name | Default | Effect |
| --- | --- | --- |
| `ETL_OUTPUT_DIR` | `./storage/etl-output`, resolved against the process working directory | Where an ETL execution writes its RDF output files. The container creates this path with the right ownership, so it is writable on a fresh volume. |

## Entity size limits

| Name | Default | Effect |
| --- | --- | --- |
| `DATA_GRAPH_MAX_VERSION_BYTES` | `1048576` (1 MiB) | Largest single data graph version. |
| `DATA_GRAPH_MAX_LIBRARY_BYTES` | `16777216` (16 MiB) | Largest total of data graph content in one library. |
| `TUPLE_SET_MAX_VERSION_BYTES` | `1048576` (1 MiB) | Largest single tuple set version. |
| `TUPLE_SET_MAX_LIBRARY_BYTES` | `16777216` (16 MiB) | Largest total of tuple set content in one library. |

A value that does not parse as an integer falls back to the default.

## Rule execution and patches

| Name | Default | Effect |
| --- | --- | --- |
| `RULE_EXECUTION_TIMEOUT_MS` | `30000` | Per-rule timeout during a rule set run. |
| `RULE_EXECUTION_SAMPLE_LIMIT` | `10` | How many sample bindings a rule run reports per rule. |
| `PATCH_PREVIEW_TTL_MS` | `3600000` (1 hour) | How long a derived, unapplied RDF patch preview is retained. See [RDF patch](../explanation/rdf-patch.md). |
| `PATCH_SWEEP_INTERVAL_MS` | `600000` (10 minutes) | How often expired previews are swept. |

## Telemetry

| Name | Default | Effect |
| --- | --- | --- |
| `OTEL_ENABLED` | `true` | Set to exactly `false` to skip OpenTelemetry SDK startup and OpenTelemetry log export. Any other value leaves it on. The container only loads the OTel setup module in `APP_MODE=api`. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP HTTP collector base URL. Traces go to `/v1/traces` and metrics to `/v1/metrics`. |

OTLP export only happens when `NODE_ENV=development`. In any other environment
the SDK starts with console exporters, which means an endpoint set in production
is not used. Metrics are exported every 30 seconds.

## Read-only deployments

`SQLIB_READ_ONLY=true` turns sqlib into a compute service: it still parses,
validates, formats and executes, but it refuses every write to its own state.
The catalogue changes by redeployment, and anything a visitor authors is kept in
their browser instead. It is what a public demo site runs.

| Name | Default | Effect |
| --- | --- | --- |
| `SQLIB_READ_ONLY` | `false` | Exactly `true` turns it on; any other value, including unset, leaves it off. |

It is not an auth mode and does not need one. An auth mode answers "who is this,
and what may they reach", which needs principals, grants and an issuer; this
answers "may this deployment's own state change at all", which gives every
caller the same answer. The two compose — a public site runs
`SQLIB_AUTH_MODE=disabled` beside this, and the full-access context that mode
mints still cannot write, because the gate consults no context.

The gate refuses every mutating method and then names its exceptions, so a route
added later is refused until someone decides otherwise. The exceptions are the
routes that compute an answer and store nothing: `/detect-inputs`,
`/detect-outputs`, `/validate`, `/validate-rule-data`, `/format`, `/substitute`,
`/execute`, `/sparql`, the SRL compile, analyse and preview routes, the rule and
rule-set execution routes, and the tuple-set preview. The list lives in
`packages/api/src/config/readOnly.ts`, and a test fails on an entry that names
no registered route as well as on a mutating route that is neither listed nor
refused.

Three things it deliberately does **not** do:

- **It does not refuse SPARQL.** `POST /sparql` passes through untouched,
  UPDATEs included. Whether a store accepts a write is the store's answer:
  sqlib's own read-only backends refuse through `ReadOnlySparqlExecutor`, and
  an endpoint somebody else owns refuses, or does not, on its own terms. What
  it does refuse is `?record=patch`, because recording a patch writes sqlib's
  state.
- **It does not enable anything.** `FEATURE_ETL`, `FEATURE_PLAYGROUND_ETL` and
  `FEATURE_ASSISTANT` are still off by default, and the ETL routes are absent
  from the exceptions above — turning a flag on is not enough to expose them on
  a read-only deployment.
- **It does not authenticate.** Every visitor is the same anonymous caller.

`/health` reports it as `readOnly`, beside the auth mode, so the SPA can offer
browser-local authoring rather than a button the server will refuse.

## Authentication

Auth is off unless `SQLIB_AUTH_MODE` says otherwise. An invalid value for any of
these throws at startup rather than falling back. See
[the security model](../explanation/security-model.md) for what the layer does
and does not cover.

| Name | Default | Effect |
| --- | --- | --- |
| `SQLIB_AUTH_MODE` | `disabled` | `disabled`, `dry-run` (or `dryrun`), or `required`. An empty value is `disabled`. Anything else throws. `dry-run` and `required` both require an issuer. |
| `SQLIB_AUTH_ISSUER` | unset | OIDC issuer URL for a single-issuer deployment. |
| `SQLIB_AUTH_AUDIENCE` | unset | Expected `aud` for that issuer. |
| `SQLIB_AUTH_JWKS_URI` | unset | JWKS URL, when it is not the issuer's discovery default. |
| `SQLIB_AUTH_CLAIM_GROUPS` | `groups` | Dot-path to the claim carrying group or role membership. |
| `SQLIB_AUTH_CLAIM_CLIENT_ID` | `azp` | Dot-path to the claim used to recognise a machine-to-machine caller. |
| `SQLIB_AUTH_ISSUERS_JSON` | unset | A JSON array of issuer objects (`issuer`, and optionally `audience`, `jwksUri`, `claimGroups`, `claimClientId`), for more than one issuer. When set it replaces the single-issuer variables above. Invalid JSON, a non-array, an empty array or an entry without a string `issuer` throws. Per-entry defaults are `groups` and `azp`. |
| `SQLIB_AUTH_CLOCK_SKEW_S` | `60` | Allowed clock skew in seconds when validating a token. A negative or non-numeric value throws. |
| `SQLIB_AUTH_ADMIN_PRINCIPALS` | empty | Comma-separated raw claim values treated as administrators at boot, in the form `iss\|sub` or `iss\|group:value`. |
| `SQLIB_AUTH_SEED_GRANTS` | unset | Path to a file of grants loaded at startup. |
| `SQLIB_AUTH_ALLOW_LIBRARY_CREATE` | `all` | `all` or `admin`. Anything else throws. |
| `SQLIB_AUTH_PROTECT_DOCS` | `false` | Set to exactly `true` (case-insensitive) to require a token for the API documentation routes. |

## Feature flags

Seventeen `FEATURE_*` variables switch sections of the product on and off, and
the API unregisters the routes behind some of them. They have their own page:
[feature flags](feature-flags.md), which lists each key, its variable, its
default and what disappears when it is off.

## Development and seeding

These are read by development recipes and seeders, not by a normal deployment.

| Name | Default | Effect |
| --- | --- | --- |
| `SEED_W3C_RULES_SUITE` | unset | Set to exactly `true` to seed the W3C SHACL 1.2 Rules suite as runnable tests at startup. Requires the `rulesSuite` and `tests` flags. Seeding is idempotent. |
| `W3C_RULES_SUITE_DIR` | the suite directory inside `packages/api` | Where that suite is read from. A relative path resolves against the API package root. |
| `SEED_PATCH_DEMO` | unset | Set to exactly `true` to seed the RDF patch demo library at startup. Requires the `queries` flag. |
| `SYSTEM_STORE_ASSET_DIR` | `system-store` inside `packages/api` | Where the preloaded system library's assets are read from. |
| `VITEST` | set by vitest | Presence suppresses OpenTelemetry log export during tests. |

## Names that are set but not read

Some recipes in the `Justfile` and the API package's `dev` script export
variables that no code reads. They are inert, and changing them changes nothing:

- `FEATURE_QUERIES_ENABLED`, `FEATURE_RULES_ENABLED`, `FEATURE_ETL_ENABLED` in
  `run-local-like-docker`, `run-docker-local` and `run-docker-persistent`. The
  real names have no `_ENABLED` suffix; see [feature flags](feature-flags.md).
- `RULESET_CANON_DEBUG` in `run-local-memory` and in `packages/api`'s `dev`
  script.

## The web application

`packages/web` is a Nuxt SPA built ahead of time (`ssr: false`), so these are
read at **build** time and baked into the bundle.

| Name | Default | Effect |
| --- | --- | --- |
| `NUXT_PUBLIC_API_BASE_URL` | `http://localhost:3000` | The API the app calls. |
| `NUXT_PUBLIC_AUTH_ISSUER` | empty | OIDC issuer for the browser's login flow. |
| `NUXT_PUBLIC_AUTH_CLIENT_ID` | empty | OIDC client id. |
| `NUXT_PUBLIC_AUTH_AUDIENCE` | empty | Requested audience. |
| `NUXT_PUBLIC_AUTH_SCOPE` | `openid profile email` | Requested scopes. |
| `NUXT_PUBLIC_FEATURE_*` | the API-side default for that flag | Per-flag override for the browser build; see [feature flags](feature-flags.md). |

A deployed static build can be re-pointed without rebuilding by serving a
`/config.json` beside it. The client plugin
`packages/web/src/plugins/runtime-config.client.ts` fetches it at startup and
overrides `apiBaseUrl`, the four `auth*` values and any subset of
`featureFlags`. A missing file, a non-JSON response or a parse failure logs a
warning and leaves the build-time values in place. See
[deploying](../guides/deploying.md).
