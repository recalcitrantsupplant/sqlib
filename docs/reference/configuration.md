# Configuration reference

This page lists each environment variable that the server reads, with its
default and its effect. The defaults come from the code that reads each
variable.

Two different processes read this environment:

- The API (`packages/api`) reads `PORT` and `FASTIFY_ADDRESS`.
- The MCP runtime (`packages/mcp-server`) mounts the API in its process, and
  reads `HTTP_PORT`, `HTTP_HOST` and the `MCP_*` variables.

The container starts one of them, as `APP_MODE` sets. The web app is a separate
static build, with its own `NUXT_PUBLIC_*` variables, listed at the end.

For the reasons behind these settings, see
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
| `MCP_CATALOGUE` | `both` | Which surfaces the server offers: `both`, `catalogue` or `published`. `catalogue` serves no published tools (`/mcp/{slug}` and `/tools/…` are 404). `published` serves only the published tools: `/mcp` lists them alone, every authoring route is 404, `POST /execute` runs only their pinned versions, and an invalid published tool stops the server at startup instead of being skipped. Anything else throws. See [publishing tools](../guides/publishing-tools.md). |
| `SQLIB_OGC_BASE_URL` | unset | The absolute URL at the start of each OGC API Features link, such as `https://maps.example.org`. If it is not set, links use the scheme and host of the request, and `APP_PUBLIC_BASE_PATH`. See [publishing OGC collections](../guides/publishing-ogc-collections.md). |
| `SQLIB_CORS_ORIGINS` | unset: `http://localhost:3001,http://127.0.0.1:3001` (the SPA dev server) when `NODE_ENV=development`, otherwise none | Browser origins allowed to read API and `/mcp` responses, comma-separated. A listed origin is echoed in `access-control-allow-origin` with `access-control-allow-credentials: true`; `*` allows every origin and never sends credentials; an origin not on the list gets no CORS headers, and its preflight gets 404. Set to the empty string to allow none even in development. A production deployment whose SPA is served from another origin than the API must list that origin. The API (`packages/api/src/config/cors.ts`) and the MCP transport read it the same way, since in `dual-http` and `streamable-http` modes they share one instance; `/mcp` answers its own `OPTIONS /mcp` preflight, with the MCP headers, and the API's plugin leaves that path alone. |
| `PORT` | `3000` | Listening port when `packages/api` is started directly (`APP_MODE=api`). A value that does not parse as a number falls back to 3000. |
| `FASTIFY_ADDRESS` | `0.0.0.0` | Listening address when `packages/api` is started directly. |
| `APP_BASE_PATH` | empty | Mounts every API route under this prefix. A leading slash is added and trailing slashes are stripped; `/` means no prefix. |
| `APP_PUBLIC_BASE_PATH` | value of `APP_BASE_PATH` | The prefix the server advertises in generated URLs, for a deployment behind a proxy that rewrites the path. |
| `NODE_ENV` | unset | Standard Node convention. It selects the MCP transport default above, switches OTLP export on in `development` (see telemetry), and suppresses OpenTelemetry logging when it is `test`. |
| `MCP_DEBUG_PORT` | `3334` | Port for `packages/mcp-server`'s echo server (`pnpm --filter @sparql-query-lib/mcp-server dev:debug-http`), a development aid, not part of the served application. |
| `MCP_DEBUG_HOST` | `127.0.0.1` | Address for the same. |

## Library storage

The library holds each entity that you author. `INTERNAL_BACKEND_TYPE` selects
its store. This store is separate from the backends that your queries run
against. Those backends are entities that you make through the API.

| Name | Default | Effect |
| --- | --- | --- |
| `INTERNAL_BACKEND_TYPE` | `sqlite` | `sqlite`, `http`, `oxigraph-memory` or `oxigraph-persistent`. Unset or empty means `sqlite`. Any other value throws at startup. |
| `LIBRARY_STORAGE_SPARQL_ENDPOINT` | `http://localhost:3030/sqlib/` | With `INTERNAL_BACKEND_TYPE=http`, the SPARQL endpoint holding the library. The default is a local Fuseki on its usual port. An unconfigured server therefore fails against localhost, and never reaches an external host. |
| `LIBRARY_STORAGE_SPARQL_QUERY_ENDPOINT` | value of `LIBRARY_STORAGE_SPARQL_ENDPOINT` | Query URL, when the store separates query from update. |
| `LIBRARY_STORAGE_SPARQL_UPDATE_ENDPOINT` | value of `LIBRARY_STORAGE_SPARQL_ENDPOINT` | Update URL, when the store separates query from update. |
| `LIBRARY_STORAGE_SPARQL_USERNAME` | unset | Basic-auth username for the library endpoint. |
| `LIBRARY_STORAGE_SPARQL_PASSWORD` | unset | Basic-auth password for the library endpoint. |
| `LIBRARY_STORAGE_DIR` | `./storage/library-store`, resolved against the process working directory | With `INTERNAL_BACKEND_TYPE=sqlite`, the directory holding `library.sqlite` (and its `-wal` and `-shm` files); `:memory:` keeps the database in the process, for tests. With `oxigraph-persistent`, the directory holding the `.nq` serialisation of the library. |
| `INTERNAL_OXIGRAPH_STORE_ID` | `library-store` | Name of the persistent store within that directory. |
| `INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS` | `60000` | How often the in-memory store is written back to `.nq`. |
| `INTERNAL_OXIGRAPH_LOAD_METHOD` | `none` | How the store is populated at boot: `file`, `remote-sparql`, `remote-file` or `none`. An unrecognised value falls back to `none`. |
| `INTERNAL_OXIGRAPH_BOOTSTRAP_SOURCE` | unset | A JSON object describing the source for that load method. Invalid JSON is logged as a warning and ignored. |
| `OXIGRAPH_STORAGE_DIR` | `./storage/oxigraph` | Directory for the in-process Oxigraph backends that you make as entities: the stores behind `oxigraphEphemeral` and `oxigraphMemory` backends. The library is not stored here. With `INTERNAL_BACKEND_TYPE=oxigraph-persistent`, the library store is in `LIBRARY_STORAGE_DIR`. |
| `ENABLE_OXIGRAPH` | `false` | Set to `true` to initialise the Oxigraph store manager even when the library is not in Oxigraph, so that Oxigraph-backed backend entities work. It is initialised unconditionally when `INTERNAL_BACKEND_TYPE=oxigraph-persistent`. |
| `DEBUG_OXIGRAPH` | `false` | Set to `true` to log every SPARQL operation the in-process Oxigraph executor runs. |

### How `oxigraph-persistent` stores data

The Oxigraph JavaScript/WebAssembly bindings support only in-memory stores.
They have no RocksDB-backed store, which the Rust and Python bindings have.
`oxigraph-persistent` is an in-memory store. sqlib writes it to `.nq` files in
`LIBRARY_STORAGE_DIR` on shutdown and each
`INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS` milliseconds, and reads those files
at startup. A process killed between checkpoints loses the writes made since
the last checkpoint. `oxigraph-memory` keeps nothing.

For a durable store, use the default `sqlite`. Or run a SPARQL server, such as
the Oxigraph server or Fuseki, and use `INTERNAL_BACKEND_TYPE=http`.

sqlib no longer reads `INTERNAL_OXIGRAPH_DB_PATH`. It named a RocksDB directory
that these bindings cannot open. The serialisation goes to
`LIBRARY_STORAGE_DIR`.

[Storage and caching](../explanation/storage-and-caching.md) describes how the
store and the in-memory cache work together.

## Backup to blob storage

These settings control the continuous backup of the SQLite stores
(`library.sqlite`, and `auth.sqlite` when auth is on) to S3, Azure Blob Storage
or Google Cloud Storage, with [Litestream](https://litestream.io). The backup is
off until you set `SQLIB_SQLITE_REPLICA_URL` or `SQLIB_LITESTREAM_CONFIG`. The
published image contains Litestream.
[Backup to blob storage](../guides/deploying.md#backup-to-blob-storage) gives
the credentials, networks and platforms.

| Name | Default | Effect |
| --- | --- | --- |
| `SQLIB_SQLITE_REPLICA_URL` | unset | Base URL of the replica: `s3://BUCKET/PATH`, `abs://ACCOUNT@CONTAINER/PATH` or `gs://BUCKET/PATH`. Each database is replicated under it, to `PATH/library` and `PATH/auth`, with the lease at `PATH/lease`. Use one path per environment. |
| `SQLIB_SQLITE_REPLICA_ENDPOINT` | unset | Endpoint of an S3-compatible store (`https://ACCOUNT_ID.r2.cloudflarestorage.com`, MinIO), or of a non-default Azure endpoint (sovereign cloud, Azurite). |
| `SQLIB_SQLITE_REPLICA_REGION` | unset | S3 region. Some S3-compatible stores need it (R2: `auto`). |
| `SQLIB_SQLITE_REPLICA_SYNC_INTERVAL` | `1s` | How often changed pages are uploaded. The most a container killed without warning can lose. |
| `SQLIB_SQLITE_REPLICA_SNAPSHOT_INTERVAL` | `6h` | How often a full snapshot is written. Shorter makes a restore faster and costs more storage. |
| `SQLIB_SQLITE_REPLICA_RETENTION` | `72h` | How long snapshots and changes are kept: how far back a point-in-time restore can go. |
| `SQLIB_SQLITE_REPLICA_SHUTDOWN_TIMEOUT` | `10s` | How long the last sync on `SIGTERM` may take. Keep the platform's grace period longer than this plus the server's own shutdown. |
| `SQLIB_SQLITE_REPLICA_KMS_KEY_ID` | unset | `s3://` only. The AWS KMS key for SSE-KMS. Setting the key as the bucket's default encryption does the same for every writer. |
| `SQLIB_SQLITE_REPLICA_AZURE_SAS` | unset | `abs://` only. A SAS token for the container. Litestream reads it from the environment; it is never written to a file. |
| `SQLIB_SQLITE_REPLICA_METRICS_ADDR` | unset | Address for Litestream's Prometheus metrics, such as `:9090`. Keep it off the public ingress. |
| `SQLIB_SQLITE_RESTORE` | `replica` | At start: `replica` restores each file whenever a replica exists, replacing any local file (a file baked into the image, or left by an earlier run). `local` restores only when the local file is missing or empty. `never` does not restore. |
| `SQLIB_SQLITE_REPLICA_LEASE` | `on` | Take a lease at `PATH/lease` before restoring, so two instances never write one replica. `off` for platforms that stop the old instance before starting the new one (ECS with `minimumHealthyPercent: 0`, Kubernetes `Recreate`). |
| `SQLIB_SQLITE_REPLICA_LEASE_TTL` | `30s` | How long a lease lasts without renewal. A holder that cannot renew for this long stops. |
| `SQLIB_SQLITE_REPLICA_LEASE_RENEW` | `10s` | How often the holder renews. At most half the TTL. |
| `SQLIB_SQLITE_REPLICA_LEASE_WAIT` | `120s` | How long a starting instance waits for a held lease before it exits. The platform then restarts it. |
| `SQLIB_LITESTREAM_CONFIG` | unset | Path to a complete `litestream.yml`, which replaces the generated one. Use it for Litestream options that this table does not list. It must name the same database paths the server opens. The lease is off unless `SQLIB_SQLITE_REPLICA_URL` is also set. |
| `SQLIB_LITESTREAM_BIN` | `litestream` | The Litestream binary. The image has it on `PATH`. |

sqlib has no credential settings for the backup. Litestream and the lease read
the credentials of each cloud:

- AWS: the AWS SDK chain (`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`, a
  task, instance or pod role, or a web identity);
- Azure: `AZURE_CLIENT_ID` for a user-assigned managed identity;
  `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET` for a service
  principal; `LITESTREAM_AZURE_ACCOUNT_KEY`; or the SAS above;
- Google: `GOOGLE_APPLICATION_CREDENTIALS`, or the service account of the
  workload.

Do not set `AWS_CA_BUNDLE`. The S3 client of Litestream does not load while it
is set.

## Execution backend credentials

A `Backend` entity does not store credentials. It stores an `authEnvKey`, and
the server reads the credentials from the environment under that key. Secrets
therefore stay out of the library store, which is exported, imported and
copied.

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

No environment variable sets the time-to-live of entities in the cache.
`packages/api/src/lib/EntityRegistry.ts` sets it for each entity type, and keeps
immutable versions with no time limit. See
[storage and caching](../explanation/storage-and-caching.md).

## ETL

ETL is off by default. See [feature flags](feature-flags.md) and the
[ETL guide](../guides/etl.md).

| Name | Default | Effect |
| --- | --- | --- |
| `ETL_OUTPUT_DIR` | `./storage/etl-output`, resolved against the process working directory | Where an ETL execution writes its RDF output files. The container creates this path with the right ownership, so it is writable on a fresh volume. Not written on a read-only deployment. |
| `ETL_RESPONSE_OUTPUT_MAX_BYTES` | `1048576` | The most RDF a run returns in its response on a read-only deployment, where it writes no file. A run whose output goes over the limit fails, and names the limit. It does not return part of its output. |
| `SQLIB_ETL_NODE_MAX_ROWS` | `1000000` | The most rows an ETL node inside a query group may read from its source. A source with more rows fails the node, and the error names the limit. The rest of the group never gets a truncated result. A direct run of a job has no such limit. |

## Kept results (pass-by-reference)

When a run sets `keepResult`, the server keeps its response in memory, and the
response has a `Sqlib-Result-Ref` handle. A later request can name the handle,
and need not send the content again. The fields are `argumentRefs` or
`dataGraphs[].resultRef` on `/execute`, and `dataGraphResultRef` on a rule set
run.

The server keeps only responses that it produced. Only the subject that made the
run can read a handle. A missing, expired or foreign handle returns `410`.

| Name | Default | Effect |
| --- | --- | --- |
| `RESULT_CACHE_MAX_BYTES` | `268435456` (256 MiB) | All kept results together. The oldest are dropped first when a new one would pass it. `0` turns the feature off: nothing is kept, and every handle returns `410`. |
| `RESULT_CACHE_MAX_BYTES_PER_USER` | `10485760` (10 MiB) | One subject's kept results together. A larger single result is not kept; otherwise the subject's oldest are dropped first. |
| `RESULT_CACHE_TTL_MS` | `900000` (15 minutes) | Time after its last use at which a kept result is dropped. |

A restart empties the cache.

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
| `RULE_EXECUTION_TIMEOUT_MS` | `30000` | Per-rule timeout during a rule set run. A rule is judged against it after it finishes; to stop a run, use `SQLIB_EXECUTION_TIMEOUT_MS`. |
| `SQLIB_EXECUTION_TIMEOUT_MS` | `300000` (5 minutes) | The most one query group run or rule set run may take. Checked before every group node and every rule and DATA block, and aborts HTTP requests to backends in flight; a run past it fails at the node it was on, with status 504 from `/execute`. It cannot interrupt a single query against an in-process Oxigraph store, which runs synchronously, so such a run stops at the next boundary after the deadline. `0` turns it off. A client that disconnects from `/execute` or a rule set's execute route cancels its run the same way. |
| `SQLIB_MAX_RULE_ITERATIONS` | `1000` | The most fixpoint iterations a rule set run may take per stratum. A request asking for more `maxIterations` is refused by the route schema (read at startup); the executor clamps to the value in force whatever it is asked. |
| `RULE_EXECUTION_SAMPLE_LIMIT` | `10` | How many sample bindings a rule run reports per rule. |
| `PATCH_PREVIEW_TTL_MS` | `3600000` (1 hour) | How long a derived, unapplied RDF patch preview is retained. See [RDF patch](../explanation/rdf-patch.md). |
| `PATCH_SWEEP_INTERVAL_MS` | `600000` (10 minutes) | How often expired previews are swept. |

## Telemetry

Telemetry is off until a setting gives a destination. With telemetry off,
sqlib does not load the OpenTelemetry SDK. See
[observability](../guides/observability.md) for recipes and the local stack.

| Name | Default | Effect |
| --- | --- | --- |
| `OTEL_ENABLED` | unset | `false` turns telemetry off, whatever else is set. `true` turns it on; with no endpoint the SDK sends OTLP to `http://localhost:4318`. |
| `OTEL_SDK_DISABLED` | unset | The standard off switch. `true` turns telemetry off. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | OTLP base URL. Setting it, or a per-signal `OTEL_EXPORTER_OTLP_{TRACES,METRICS,LOGS}_ENDPOINT`, turns telemetry on. |
| `OTEL_EXPORTER_OTLP_PROTOCOL` | `http/protobuf` | `http/protobuf`, `http/json` or `grpc`. |
| `OTEL_EXPORTER_OTLP_HEADERS` | unset | Headers on every export, for an API key: `x-honeycomb-team=<key>`. |
| `OTEL_TRACES_EXPORTER`, `OTEL_METRICS_EXPORTER`, `OTEL_LOGS_EXPORTER` | `otlp` | `otlp`, `console` or `none` per signal. A value other than `none` turns telemetry on, so `OTEL_TRACES_EXPORTER=console` works for a quick look. |
| `OTEL_SERVICE_NAME` | `sqlib` | The `service.name` on everything sent. |
| `OTEL_RESOURCE_ATTRIBUTES` | unset | Extra resource attributes, such as `deployment.environment.name=prod`. |
| `OTEL_TRACES_SAMPLER`, `OTEL_TRACES_SAMPLER_ARG` | `parentbased_always_on` | Head sampling, such as `parentbased_traceidratio` and `0.2`. |
| `OTEL_METRIC_EXPORT_INTERVAL` | `60000` | Milliseconds between metric exports. |
| `SQLIB_SLOW_QUERY_MS` | `1000` | A run of `/execute` that takes at least this long writes one `sqlib.query.slow` log line. `0` logs every run; `off` turns the line off. Works with telemetry off too: the line is a normal log line. |
| `SQLIB_TELEMETRY_DETAIL` | `ids` | What the slow line carries beyond ids. `text` adds the saved query text; `text+args` also adds the arguments the caller sent, which can hold private values. |
| `SQLIB_OBSERVABILITY_URL` | unset | Where people look at the telemetry, such as a Grafana dashboard. Administrators get an "Open dashboard" link in Settings. Only `http` and `https` URLs are used. |
| `SQLIB_TRACE_URL_TEMPLATE` | unset | A URL with `{traceId}` in it, such as a Grafana Explore or App Insights transaction link. With telemetry on, each response carries `Sqlib-Trace-Url` with the request's trace id filled in, and the web app shows a trace icon on run results. |

Each other `OTEL_*` variable that the OpenTelemetry Node SDK reads works as its
documentation states, because sqlib passes no exporter of its own.

With telemetry on, log lines still go to stdout. They also go out as OTLP log
records, unless `OTEL_LOGS_EXPORTER=none`. Lines logged in a request have
`trace_id` and `span_id`.

## Startup time

These settings are for a deployment that scales to zero. There, a cold start
occurs before a user request, and can occur many times each day.

| Name | Default | Effect |
| --- | --- | --- |
| `SQLIB_EAGER_SERIALIZERS` | unset (lazy) | Set to exactly `true` to compile the response serialiser of each route when the server starts. By default, each serialiser compiles on the first response of its route. |
| `NODE_COMPILE_CACHE` | unset in a local run, `/app/.v8-compile-cache` in the container | A Node variable: a directory where Node caches compiled module bytecode, for use at the next start. The image includes a full cache, so the first container to start is already warm. |

Response-schema compilation is the largest single part of startup. Its time
increases with the number of routes, and does not depend on the amount of data.
On an instance with 135 routes, it took about 890ms of a `ready()` of about
1.4s, whether or not any caller used those routes. When each serialiser
compiles on the first response of its route, startup does not include this
time, and the first response takes about 2ms more. This is the default.
`SQLIB_EAGER_SERIALIZERS=true` restores compilation at startup, for a
long-lived instance that must do all the work before it accepts traffic.

Two ordinary settings also help:

- Turn off the [feature flags](feature-flags.md) that you do not serve. This
  removes their routes. Each route adds about 10ms to startup.
- Leave telemetry unconfigured (the default). sqlib then does not load the
  OpenTelemetry SDK.

Oxigraph itself has little effect: the WASM module starts in about 25ms. The
part of startup that depends on data is the snapshot, which loads at about
180,000 quads per second, and the cache preload. A library of a few thousand
entities adds very little time. A library of a few hundred thousand quads adds
seconds. See
[how `oxigraph-persistent` stores data](#how-oxigraph-persistent-stores-data).

## Read-only deployments

`SQLIB_READ_ONLY=true` makes sqlib a compute service. It still parses,
validates, formats and executes, and it refuses each write to its own state.
The catalogue changes only with a new deployment. The browser of a visitor keeps
what the visitor authors. A public demo site uses this mode.

| Name | Default | Effect |
| --- | --- | --- |
| `SQLIB_READ_ONLY` | `false` | Exactly `true` turns it on; any other value, including unset, leaves it off. |

Read-only is a separate setting from the auth mode, and needs no auth mode:

- An auth mode decides who the caller is, and what the caller can reach. It
  needs principals, grants and an issuer.
- Read-only decides whether the state of the deployment can change. The answer
  is the same for each caller.

You can use both together. A public site runs `SQLIB_AUTH_MODE=disabled` with
read-only. The full-access context of that auth mode still cannot write, because
the read-only gate reads no context.

The gate refuses each mutating method, and then lists its exceptions. A new
route is therefore refused until a person adds it to the list. A route that
writes on a safe method declares this with `config: { readOnlyMutating: true }`
in its route options, and is refused like an unlisted `POST`. The exceptions are
the routes that calculate an answer and store nothing: `/detect-inputs`,
`/detect-outputs`, `/validate`, `/validate-rule-data`, `/format`, `/substitute`,
`/execute`, `/sparql`, the SRL compile, analyse and preview routes, the rule and
rule-set execution routes, the tuple-set preview, the two test-run routes,
`POST /etl-jobs/:id/execute`, `POST /benchmark-experiments/:id/versions/:version/run`, and `/mcp`. The list is in `packages/api/src/config/readOnly.ts`. A test fails in these
cases:

- an entry names no registered route;
- a mutating route is not listed and not refused;
- one of these exceptions is refused.

Four exceptions need more detail:

- **A test run is computation. Its history is a write.** `POST /tests/run` and
  `POST /tests/:id/run` answer with a verdict. On a read-only deployment,
  `recordTestRuns` stores nothing, so no run history accumulates. `?record=patch`
  follows the same rule for SPARQL.
- **A run of a stored ETL job is computation. Its record and its file are
  writes.** On a read-only deployment, `POST /etl-jobs/:id/execute` makes no
  `EtlExecution` and writes no output file. It returns the RDF in the response
  as `output`, up to `ETL_RESPONSE_OUTPUT_MAX_BYTES`. The stored SQL of the job
  version runs. The request contains no SQL. The run reads at most
  `SQLIB_READ_ONLY_ETL_MAX_ROWS` source rows. When the request asked for more,
  or for no limit, the response says so in `rowLimitApplied`.
- **A run of a frozen benchmark version is computation. Its runs and
  observations are writes.** On a read-only deployment, the run route accepts
  only a version that is already frozen, and does not freeze one. It returns the
  run and its observations in the response, and stores none of them. A plan
  over the request limit gets 422, which names the limit. A second run while one
  is in progress gets 429 with `Retry-After`. The freeze route stays refused.

The limits on those runs apply only on a read-only deployment. `/health`
reports them as `readOnlyRunLimits`:

| Name | Default | Effect |
| --- | --- | --- |
| `SQLIB_READ_ONLY_BENCH_MAX_REQUESTS` | `200` | The most requests one benchmark run may send: measured tasks plus warmups. A version over the limit is refused. A reduced benchmark would report numbers for a plan that nobody saved. |
| `SQLIB_READ_ONLY_BENCH_MAX_CONCURRENCY` | `2` | The most a version's `maxConcurrency` may ask for. |
| `SQLIB_READ_ONLY_BENCH_DEADLINE_MS` | `60000` | The wall-clock limit for a whole benchmark run. When it passes, no task starts, the attempts in flight are aborted, and the run ends `Aborted` with what it finished. |
| `SQLIB_READ_ONLY_BENCH_CONCURRENT_RUNS` | `1` | Benchmark runs allowed at once on the deployment. `disabled` auth gives no client identity, so the count is deployment-wide. |
| `SQLIB_READ_ONLY_ETL_MAX_ROWS` | `100000` | The most source rows one ETL job run may read. A request for more rows is reduced to this limit, and is not refused. A visitor who runs part of a source wants a sample. |
- **`/mcp` uses only POST.** If the gate refused it, a read-only deployment
  would lose each tool, including the tools that read. Its admission opens no
  write path. A tool call reaches its route through `app.inject`, and the same
  hook applies there. The inner route therefore refuses a tool that writes.

Read-only intentionally does **not** do three things:

- **It does not refuse SPARQL against a registered backend.** `POST /sparql`
  with a `backendId` passes through, with UPDATEs.
  - A bare `endpoint` gets `405`, for the same reason as `/backends/probes`: a
    public server that fetches a URL chosen by the caller allows request
    forgery.
  - A grant sets which SPARQL a visitor can run. This flag does not.
    `SQLIB_AUTH_MODE=anonymous` with `query:saved` on a backend allows the
    seeded queries, and no typed query.
  - The store decides whether it accepts a write. The read-only backends of
    sqlib refuse through `ReadOnlySparqlExecutor`. An endpoint that a different
    party owns applies its own rules.
  - Read-only refuses `?record=patch`, on `GET` and `POST`, because a recorded
    patch writes the state of sqlib.
  - `GET /sparql` refuses an UPDATE with 405 on each deployment, read-only or
    not, because a GET must not change anything.
- **It does not turn on any feature.** `FEATURE_ETL`, `FEATURE_PLAYGROUND_ETL`
  and `FEATURE_ASSISTANT` are still off by default. The ETL routes that take SQL
  in the request, `POST /etl-jobs/preview` and `POST /playground/etl/execute`,
  are not in the exceptions above. Each route that would store a job version is
  also not in the list. A flag alone therefore cannot let the SQL of a visitor
  run on a read-only deployment.
- **It does not authenticate.** Each visitor is the same anonymous caller.

`/health` reports it as `readOnly`, next to the auth mode. The SPA then offers
authoring in the browser, and shows no button that the server would refuse.

The SPA shows no control whose only result is a refusal:

- Save and the entity ⋮ menu are removed from each work area.
- The `benchmark` and `test` chips are removed from the run bar.
- `Save to Tuples`, `Save to Data` and `Save as test` are removed from the
  Inputs tab of a rule set.
- The tag controls are removed from the Details panel.

These controls are removed, and not disabled. The rail follows the same rule
for a section that is turned off. Each control that acts on the copy in the
browser stays: scratch queries, rule sets and argument sets, their values,
Discard, and the inline data that a rule set runs against. You author and run a
parameterised query as on a writable deployment, and the values go inline to
`POST /sparql`.

A visitor can also add their own SPARQL endpoint in the browser. Paste a URL
into the backend picker of the run sentence, with `+ SPARQL endpoint…` at the
end of the menu. The SPA keeps it as a **browser backend**: stored in that
browser, named after its URL, and never sent to the server. To rename it, or to
change its query method, use **Backends**, as for any backend. The change is
written to the browser.

Queries against a browser backend go from the browser to the endpoint. The
address, any headers and the results do not pass through sqlib. Browser backends
work on each deployment. On a read-only deployment, they let a visitor query
data that was not seeded.

Before `/health` answers, and when it cannot be reached, the SPA assumes that it
can write. This is intentional. A client that wrongly assumes it can write shows
a button, and then shows the refusal from the server. A client that wrongly
assumes it cannot write hides a working feature, and appears broken.

## Authentication

Auth is off until `SQLIB_AUTH_MODE` turns it on. An invalid value for any of
these variables throws at startup. There is no fallback. See
[the security model](../explanation/security-model.md) for what the auth layer
covers.

| Name | Default | Effect |
| --- | --- | --- |
| `SQLIB_AUTH_MODE` | `disabled` | `disabled`, `dry-run` (or `dryrun`), `required` or `anonymous`. An empty value is `disabled`. Anything else throws. `dry-run` and `required` both require an issuer, and an audience for every issuer unless `SQLIB_AUTH_AUDIENCE_UNCHECKED=true`. `anonymous` reads no token: every caller is `urn:sqlib:principal:anonymous`, holds the grants on that principal, and is refused everything else. For a public deployment beside `SQLIB_READ_ONLY=true`; seed the grants with `SQLIB_AUTH_SEED_GRANTS`. |
| `SQLIB_AUTH_ISSUER` | unset | OIDC issuer URL for a single-issuer deployment. |
| `SQLIB_AUTH_AUDIENCE` | unset | Expected `aud` for that issuer. |
| `SQLIB_AUTH_AUDIENCE_UNCHECKED` | `false` | Set to exactly `true` (case-insensitive) to start `dry-run` or `required` with an issuer that has no audience. Without an audience the `aud` claim is not checked, so any token that issuer minted for any application is accepted; without this flag that configuration throws at startup. Applies to `SQLIB_AUTH_ISSUERS_JSON` entries too. |
| `SQLIB_AUTH_JWKS_URI` | from discovery | JWKS URL. Unset, the `jwks_uri` of the issuer's OIDC discovery document (`<issuer>/.well-known/openid-configuration`), fetched once on the first token; an issuer with no discovery document falls back to `<issuer>/.well-known/jwks.json`. Set it when sqlib reaches the broker at another address than the issuer URL, as the compose `auth` profile does. |
| `SQLIB_AUTH_CLAIM_GROUPS` | `groups` | Dot-path to the claim carrying group or role membership. |
| `SQLIB_AUTH_CLAIM_CLIENT_ID` | `azp` | Dot-path to the claim used to recognise a machine-to-machine caller. |
| `SQLIB_AUTH_ISSUERS_JSON` | unset | A JSON array of issuer objects (`issuer`; `audience`, required in an enforcing mode unless `SQLIB_AUTH_AUDIENCE_UNCHECKED=true`; and optionally `jwksUri`, `claimGroups`, `claimClientId`), for more than one issuer. When set it replaces the single-issuer variables above. Invalid JSON, a non-array, an empty array or an entry without a string `issuer` throws. Per-entry defaults are `groups` and `azp`. |
| `SQLIB_AUTH_CLOCK_SKEW_S` | `60` | Allowed clock skew in seconds when validating a token. A negative or non-numeric value throws. |
| `SQLIB_AUTH_ADMIN_PRINCIPALS` | empty | Comma-separated raw claim values treated as administrators at boot, in the form `iss\|sub` or `iss\|group:value`. |
| `SQLIB_AUTH_SEED_GRANTS` | unset | Path to a file of grants loaded at startup. |
| `SQLIB_AUTH_ALLOW_LIBRARY_CREATE` | `all` | `all` or `admin`. Anything else throws. |
| `SQLIB_AUTH_PROTECT_DOCS` | `false` | Set to exactly `true` (case-insensitive) to require a token for the API documentation routes (`/docs` and everything under it). `/`, `/health` and the protected-resource metadata stay public regardless. |
| `SQLIB_AUTH_RESOURCE` | the first issuer's audience | The resource identifier: the `resource` field of the protected-resource metadata, and the value an MCP client asks a token for. Use the canonical URL of the deployment's `/mcp` endpoint (for example `https://sqlib.example.org/mcp`), and configure the broker to put that value in `aud`. When it is an absolute URL, the 401 challenge names the metadata at `<its origin>/.well-known/oauth-protected-resource<its path>`; otherwise at the request's origin. A value that matches no issuer's audience logs a warning at startup. |
| `SQLIB_AUTH_STORE_TYPE` | `sqlite`, or `sparql` when `SQLIB_AUTH_SPARQL_ENDPOINT` is set | Where grants and principals are kept. Never the library store: `sqlite` is one SQLite file, `file` one N-Quads file, `sparql` the `urn:sqlib:auth` graph of a SPARQL dataset of its own. Anything else throws. Not read when `SQLIB_AUTH_MODE` is `disabled`; read in every other mode, `anonymous` included. |
| `SQLIB_AUTH_STORE_DIR` | `./storage/auth` | The directory of the `sqlite` and `file` stores. `sqlite` keeps `auth.sqlite` (with its `-wal` and `-shm` files): one row per quad, written per change in one transaction, and an `auth_events` table that records every quad each change added or removed. `file` keeps `auth.nq`, written whole and renamed into place on each change. |
| `SQLIB_AUTH_SPARQL_ENDPOINT` | unset | The SPARQL dataset of the `sparql` store. Required for that type. Use a dataset of its own, not the library store's. |
| `SQLIB_AUTH_SPARQL_UPDATE_ENDPOINT` | the endpoint | Its update endpoint, when it differs. |
| `SQLIB_AUTH_SPARQL_USERNAME` / `SQLIB_AUTH_SPARQL_PASSWORD` | unset | Basic credentials for that dataset. |
| `SQLIB_AUTH_POLICY_CACHE_SECONDS` | `60` | How long a backend graph policy's result is kept per backend and caller. `0` evaluates the policy on every read. A change to the policy, or any update to an auth backend, clears the cache. A negative or non-numeric value throws. |
| `SQLIB_AUTH_SCOPES` | empty | Space- or comma-separated scopes. Published as `scopes_supported` in the metadata and as `scope` in the 401 challenge. Empty leaves both out. |

The API serves OAuth 2.0 Protected Resource Metadata (RFC 9728) at:

- `/.well-known/oauth-protected-resource`;
- each form of it with a path suffix, such as
  `/.well-known/oauth-protected-resource/mcp`;
- `<base path>/.well-known/oauth-protected-resource`, under `APP_BASE_PATH`.

The document lists the configured issuers as `authorization_servers`. It is
public in each mode, and answers 404 when no issuer is configured. Each 401 has
`WWW-Authenticate: Bearer resource_metadata="…"`. With this header, an MCP
client finds the authorization server with no client configuration.

## Environments

| Name | Default | Effect |
| --- | --- | --- |
| `SQLIB_DEFAULT_ENVIRONMENT` | unset | The environment a run uses when the caller names none, and the one published tools serve. Unset means `latest`, the current version. A library that defines no environments ignores it. See [environments](../explanation/environments.md). |

## Feature flags

Twenty `FEATURE_*` variables turn sections of the product on and off. For
some of them, the API also removes the routes. [Feature flags](feature-flags.md)
lists each key, its variable, its default, and what is removed when it is off.

## Development and seeding

Development recipes and seeders read these variables. A normal deployment does
not.

| Name | Default | Effect |
| --- | --- | --- |
| `SEED_W3C_RULES_SUITE` | unset | Set to exactly `true` to seed the W3C SHACL 1.2 Rules suite as runnable tests at startup. Requires the `rulesSuite` and `tests` flags. Seeding is idempotent. |
| `W3C_RULES_SUITE_DIR` | the suite directory inside `packages/api` | Where that suite is read from. A relative path resolves against the API package root. |
| `SEED_PATCH_DEMO` | unset | Set to exactly `true` to seed the RDF patch demo library at startup. Requires the `queries` flag. |
| `SYSTEM_STORE_ASSET_DIR` | `system-store` inside `packages/api` | Where the preloaded system library's assets are read from. |
| `VITEST` | set by vitest | Presence suppresses OpenTelemetry log export during tests. |

## The web application

`packages/web` is a Nuxt SPA built ahead of time (`ssr: false`). The build reads
these variables at **build** time, and puts their values into the bundle.

| Name | Default | Effect |
| --- | --- | --- |
| `NUXT_PUBLIC_API_BASE_URL` | `http://localhost:3000` | The API the app calls. |
| `NUXT_PUBLIC_AUTH_ISSUER` | empty | OIDC issuer for the browser's login flow. Empty, the app takes the first `authorization_servers` entry of the API's protected-resource metadata; set, it overrides that. |
| `NUXT_PUBLIC_AUTH_CLIENT_ID` | empty | OIDC client id. |
| `NUXT_PUBLIC_AUTH_AUDIENCE` | empty | Requested audience. |
| `NUXT_PUBLIC_AUTH_SCOPE` | `openid profile email` | Requested scopes. Add `offline_access` for a broker that issues refresh tokens only on request, and `groups` for Rauthy's group claim. |
| `NUXT_PUBLIC_AUTH_TOKEN_STORAGE` | `memory` | Where the signed-in user and its tokens are kept: `memory` (no web storage; a reload signs in again through the broker, without a form while the broker's session lives), `session` (`sessionStorage`: survives a reload in that tab) or `local` (`localStorage`: every tab, the behaviour before this setting). Anything else is `memory`. `authTokenStorage` in `/config.json` sets the same thing. |
| `NUXT_PUBLIC_AUTH_REQUIRE_LOGIN` | `false` | Exactly `true` makes the app sign in even when the API reports auth `disabled`, for an API behind a gateway that does the authentication. `authRequireLogin` in `/config.json` sets the same thing at load time. |
| `NUXT_APP_BASE_URL` | `/` | The path the site is served from. Written into every page's asset links, so the bundle works only at that path. `Dockerfile.web` takes it as a build argument. See [deploying](../guides/deploying.md#the-bundle-image). |
| `NUXT_PUBLIC_FEATURE_*` | the API-side default for that flag | Per-flag override for the browser build; see [feature flags](feature-flags.md). |
| `NUXT_PUBLIC_APP_VERSION` | the version in `.release-please-manifest.json` | What the About block on the splash and the line in Settings report. |
| `NUXT_PUBLIC_APP_COMMIT` | `git rev-parse --short HEAD`, or empty | The commit reported beside the version. Shortened to seven characters. |
| `NUXT_PUBLIC_BUILD_TIME` | the moment of the build | ISO timestamp shown in the version's tooltip. |

The three build-stamp variables are for builds that cannot find the values
themselves. An image built from a source copy with no `.git` directory finds no
commit. A build outside the repository finds no manifest. Pass the values that
the build system has.

To point a deployed static build at a different API without a rebuild, serve a
`/config.json` next to it. The client plugin
`packages/web/src/plugins/runtime-config.client.ts` fetches it at startup. Its
values override `apiBaseUrl`, the four `auth*` values, and any subset of
`featureFlags`. A missing file, a response that is not JSON, or a parse failure
logs a warning, and the build-time values stay. See
[deploying](../guides/deploying.md).
