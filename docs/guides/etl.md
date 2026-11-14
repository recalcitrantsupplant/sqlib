# ETL: what enabling it grants

ETL accepts **arbitrary DuckDB SQL** from a caller, and runs it in the API
process. An ETL tool must let a pipeline express its own extraction, so this is
the feature, and it is also the risk. This page states:

- what a deployment grants when it turns ETL on;
- which setting grants each capability;
- where the real boundary is, and where a boundary only appears to be.

> **Do not enable ETL on shared infrastructure for a hosted multi-tenant
> deployment.** No setting on this page makes arbitrary SQL safe for tenants who
> do not trust each other. ETL is for an operator: one team, with its own
> instance and its own data.

## Defaults

By default, all ETL capabilities are off.

| | Default | To enable |
| --- | --- | --- |
| The ETL routes exist | **off** | `FEATURE_ETL=true` |
| The ETL playground exists | **off** | `FEATURE_PLAYGROUND_ETL=true` |
| Submitted SQL can read the host filesystem | **off** | `ETL_DUCKDB_ALLOW_FILESYSTEM=true` |
| Submitted SQL can make outbound HTTP requests | **off** | `ETL_DUCKDB_ALLOW_HTTP=true` |
| DuckDB can install and load extensions automatically | **off** | `ETL_DUCKDB_ALLOW_EXTENSION_INSTALL=true` |
| All of the above, with no configuration and no lock | **off** | `ETL_DUCKDB_UNRESTRICTED=true` |

Resource limits are on by default. The environment can change their values.

| | Default | To change |
| --- | --- | --- |
| Time limit for `getSchema` and `preview`, the interactive paths | 30s | `ETL_DUCKDB_INTERACTIVE_TIMEOUT_MS` |
| Time limit for one chunk read, or a full `execute` | 300s | `ETL_DUCKDB_QUERY_TIMEOUT_MS` |
| DuckDB `memory_limit` | 1GB | `ETL_DUCKDB_MEMORY_LIMIT` |

The two routes that take SQL, `POST /etl-jobs/preview` and
`POST /playground/etl/execute`, require **administrator** access under
`SQLIB_AUTH_MODE=required`. A valid token alone is not enough.

sqlib logs the resolved profile once at startup, so you can find the actual
settings of a deployment with grep:

```
[DuckDbService] DuckDB loaded successfully — capabilities: filesystem=false http=false extensionInstall=false configLocked=true limits: interactiveTimeout=30000ms queryTimeout=300000ms memoryLimit=1GB
```

## The feature flags

`etl` and `playgroundEtl` both default to **false**. When they are off, sqlib
does not register `/etl-jobs`, and `/playground/etl/execute` answers 404. See
[Feature flags](../reference/feature-flags.md) for the full list and how to set
them.

They default to off for the same reason as `assistant`. A feature that gives
arbitrary SQL to the host must not appear after an upgrade. The operator of the
deployment must turn it on.

Local development and CI set these flags explicitly. The web app is built with
`ssr: false`, so the flags go into the client bundle at build time. The build
step therefore needs them, as well as the run step.

## The DuckDB capability profile

`packages/api/src/lib/duckdbCapabilities.ts` makes a capability profile from the
environment, with each capability off by default. At startup, `DuckDbService`
builds one `DuckDBInstance` from the profile. The service is in
`packages/runtime-duckdb`. It takes the profile as an argument, and reads no
environment variables itself. Each connection comes from that instance. No code
makes an unconfigured instance.

### Measured enforcement

These results were measured against `@duckdb/node-api` 1.4.3-r.3 (DuckDB
v1.4.3). They were measured again on 1.5.5-r.4 and 2.0.0-r.1, with no change.

- **`enable_external_access=false` at instance creation** blocks file reads,
  network reads and `INSTALL`. You can set it only at startup.
  `SET enable_external_access=true` on a running database fails with "Cannot
  change … while database is running". This is the only hard boundary.
- **`autoinstall_known_extensions` and `autoload_known_extensions` set to
  false** stop httpfs and similar extensions from loading on demand. These
  settings control what DuckDB does without a request. They do not block an
  explicit `INSTALL`. With filesystem access granted, an explicit `INSTALL`
  succeeds. In the default profile, `INSTALL` fails because of
  `enable_external_access=false`.
- **`SET lock_configuration=true`** runs on a boot connection before any caller
  SQL. It blocks each later `SET`, also from a second connection on the same
  instance. Without it, submitted SQL can change the profile at run time.

### Settings that sqlib does not offer

sqlib has no directory allowlist. This binding rejects `allowed_directories` and
`allowed_paths` in the instance config ("Failed to set config"). Over SQL, it
accepts them, and then enforces nothing. With `allowed_directories=['/tmp']` set
and the configuration locked, `read_csv('/etc/passwd')` still returns rows. A
setting that appears to limit ETL to a directory, and does not, is worse than no
setting. Filesystem access is therefore all or nothing, until the binding
supports a limit.

As a result, **`ETL_DUCKDB_ALLOW_FILESYSTEM=true` grants all of the filesystem
that the API process can read.** If that is too much, the limit must come from
outside the process: a container with only the data volume mounted, or a
dedicated user. No DuckDB setting does it.

### HTTP implies filesystem

DuckDB uses one switch, `enable_external_access`, for local files and the
network. `ETL_DUCKDB_ALLOW_HTTP=true` therefore also grants filesystem access.
`resolveDuckDbCapabilities` shows this in the resolved profile, because the
engine has no separate switches.

### Unrestricted mode

`ETL_DUCKDB_UNRESTRICTED=true` makes connections as needed, with no
configuration and no lock. At startup, sqlib logs a warning that names the
setting. Use it only after you read this page and decide that you need it. Do
not use it to get past a setup problem.

## What submitted SQL may consume

The capability profile limits what a query can reach. It sets no limit on time
or memory. Two mechanisms set those limits. Both were measured against
`@duckdb/node-api` 1.5.5-r.4, and again on 2.0.0-r.1.

- **A time limit for each statement, cancelled with `connection.interrupt()`.**
  The pending read rejects with `DuckDbTimeoutError`, which names the limit, and
  the connection stays usable. There are two time limits, because the paths are
  different. `getSchema` and `preview` are interactive: a person waits on the
  playground. A chunk read belongs to a job that can take a long time. Set a
  limit to `0` to run with no limit. Any other value that sqlib cannot read
  gives the default, so a typing error does not remove the limit.
- **`memory_limit` in the instance config.** The binding accepts this setting,
  and `lock_configuration=true` covers it. Submitted SQL that asks for
  `SET memory_limit='10GB'` fails with "the configuration has been locked". Set
  `ETL_DUCKDB_MEMORY_LIMIT=` (empty) to use the default of the engine, which is a
  share of the host RAM.

A time limit stops one query from using a worker for an unlimited time. It is
not a safety boundary. It does not make arbitrary SQL safe for tenants who do not
trust each other.

## Who may submit SQL

Under `SQLIB_AUTH_MODE=required`, each route that takes or runs DuckDB SQL
requires administrator access:

- `POST /etl-jobs/preview`, through `adminSuffixes` on the entity guard of the
  route plugin (`packages/api/src/routes/etl-jobs.ts`).
- `POST /etl-jobs/:id/versions`, which stores the SQL that each later run
  executes, through an explicit `requireAdmin` in the handler.
- `POST /etl-jobs/:id/execute`, which runs stored SQL, in the same way. On a
  read-only deployment (`SQLIB_READ_ONLY=true`) a caller with Execute on the
  job's library may run it. There the stored SQL changes only by redeployment,
  and the run keeps nothing and is capped by `SQLIB_READ_ONLY_ETL_MAX_ROWS`.
- `POST /playground/etl/execute`, through an explicit `requireAdmin` in the
  handler (`packages/api/src/routes/playground.ts`).

Two paths outside this plugin run the SQL of a stored job, and apply the same
rule: `POST /tuple-sets/:id/versions/from-etl`
(`packages/api/src/lib/tupleSetFromEtl.ts`), and a test whose subject is an ETL
job (`TestRunner`).

The rule requires administrator access, and a library grant is not enough. A
library grant gives full control of the queries of a library. It does not cover
the host filesystem. Submitted SQL can affect the process and its host, which
are not entities, so no library mode describes this access.
`/etl-jobs/preview` owns no entity, so before this rule it had no library
check, and any authenticated principal could call it.

A test runs each item of the list above.
`packages/api/test/auth/sqlRoutesAdminOnly.test.ts` reads the list from this
page, mounts the real plugin behind each route, and checks that sqlib refuses a
principal that has each mode on a library but is not an administrator. The test
fails for a route in the list that nothing refuses. It also fails when a guard
is removed from a route in the list.

**Under the default `SQLIB_AUTH_MODE=disabled`, there is no principal, and each
request has full access, so these checks do nothing.** For this reason the
feature flags are off by default. In a default deployment, the flag gives the
protection, and the authorization check does not.

A narrower `etl:execute` scope is possible later. It would narrow this rule, and
break nothing. Administrators would keep the access.

## A worked profile

To read CSVs from a mounted data directory, with no network, no extension
downloads, and auth on:

```bash
SQLIB_AUTH_MODE=required
FEATURE_ETL=true
FEATURE_PLAYGROUND_ETL=false      # the job routes, not the free-form playground
ETL_DUCKDB_ALLOW_FILESYSTEM=true  # the whole filesystem — confine with the container
ETL_DUCKDB_ALLOW_HTTP=false
ETL_DUCKDB_ALLOW_EXTENSION_INSTALL=false
ETL_DUCKDB_QUERY_TIMEOUT_MS=300000 # the default; lower it if jobs should fail faster
ETL_DUCKDB_MEMORY_LIMIT=1GB        # the default; raise it for genuinely large extractions
```

Run it in a container whose only mount is the data volume. Grant administrator
access only to the operators who build pipelines.

## Where a job execution's output goes

`POST /etl-jobs/:id/execute` does not return the RDF that it constructs. sqlib
appends the CONSTRUCT result of each chunk to one file for each execution, as
soon as the result arrives. The API process therefore holds the RDF of one chunk
at a time, for a source of any size. A source of ten million rows gives tens of
gigabytes of RDF. A response with all of it would first be built in memory.

The `outputLocation` and `outputFormat` of the execution record name the file.
`GET /etl-jobs/executions/:executionId/output` streams it back. A failed run
leaves no file.

The directory is `ETL_OUTPUT_DIR`. The default is `./storage/etl-output`,
relative to the working directory of the API. Mount it on the data volume, with
the Oxigraph storage. Make it large enough for the output, which can be larger
than the input. This is the only path where ETL writes to the host.

### On a read-only deployment

`SQLIB_READ_ONLY=true` changes where the RDF goes:

- A run makes no `EtlExecution` and writes no file.
- The response returns the RDF as `output`, with `outputFormat` and the counts.
- There is no `executionId`, because there is no record.

A run of a stored job is computation. A record of the run is a write. A test run
follows the same rule: sqlib returns its verdict, and stores no history.

sqlib holds the output in memory to return it. `ETL_RESPONSE_OUTPUT_MAX_BYTES`
limits its size, with a default of 1 MB. A run that goes over the limit fails,
and names the limit. It does not return part of its output. To run part of the
source, pass `maxRows`.

On such a deployment, a visitor can run a job version that was stored before
the deployment became read-only. The request names a job and contains no SQL.
The routes that take SQL, `POST /etl-jobs/preview` and
`POST /playground/etl/execute`, stay refused, so no SQL from a visitor runs. The
stored SQL runs with the DuckDB capabilities of the deployment. Give a read-only
deployment only the capabilities that its stored jobs need.

### Write access for the container user

The image runs as `USER node` (uid 1000). The default output directory is under
the declared volume `/app/packages/api/storage`. With this combination, the
first execution in a new container can fail with:

```
EACCES: permission denied, mkdir '/app/packages/api/storage/etl-output'
```

The cause: the directory in the image was owned by root with mode `0755`, and
Docker copies the content of the image into a new volume, with its ownership.

The Dockerfile now makes `/app/packages/api/storage/etl-output`, owned by
`node`, before it declares the volume. A new anonymous or named volume is
therefore writable. A change to the image cannot repair storage that already
exists:

- **A host bind mount** keeps the ownership of the host directory. Make it as
  uid 1000, with `mkdir -p ./storage && sudo chown -R 1000:1000 ./storage`. Or
  run the container with `--user "$(id -u):$(id -g)"` and a directory that this
  user owns.
- **A named volume that an earlier image made** keeps its root ownership. Fix it
  once from a temporary root container:
  `docker run --rm -u 0 -v sparql-storage:/data alpine chown -R 1000:1000 /data`.
- **A different location.** Set `ETL_OUTPUT_DIR` to a path that the process
  owns. `/tmp` works for a test, and is not suitable for a deployment: it is not
  persistent, and the output downloads of an execution stop working when the
  container is replaced.

With `FEATURE_ETL=true`, the API checks the directory at startup. It makes the
directory, writes a probe file, and logs one of these:

```
ETL output directory ready: /app/packages/api/storage/etl-output
```

or an error that names the path, the failure and the fix. The check never stops
the server: a deployment that cannot write ETL output still serves all other
routes. Search the startup log for the message before you run a job.

### Checking a mount with no server

`packages/api/scripts/storage-writability-smoke.ts` runs the same check alone.
Use it for a case that the image fix cannot reach: a volume or bind mount that
already exists and has ownership from a different source. It needs no API, no
backend and no job.

```bash
# the configured output directory, on whatever storage is mounted here
docker run --rm -v sparql-storage:/app/packages/api/storage \
  --entrypoint npx <image> tsx packages/api/scripts/storage-writability-smoke.ts

# or against a host directory you are about to mount, before you mount it
docker run --rm -v "$PWD/storage:/app/packages/api/storage" \
  --entrypoint npx <image> tsx packages/api/scripts/storage-writability-smoke.ts

# locally, against the same default this repo's API would use
pnpm --filter @sparql-query-lib/api smoke:storage
```

The script prints four values: the uid of the process, and the owner and mode of
the output directory and of the mount point above it. These values show whether
the mount or the image is at fault. The script exits with a non-zero status when
it cannot write the directory, so a deployment smoke test can use it as a gate.
`--json` gives the same report for a machine.

## The SPARQL template

A job version takes its CONSTRUCT template from one of two places. It has exactly one of them.

| Field | Holds | A run uses |
| --- | --- | --- |
| `sparqlTemplate` | The template text, stored on the job version. | That text. |
| `templateQuery` with a query version IRI | A pinned saved query version. | That version. |
| `templateQuery` with a query IRI | A saved query that floats. | The current version of the query at the start of the run. |

`POST /etl-jobs/:id/versions` takes `sparqlTemplate` or `templateQuery`. sqlib refuses a version with both, or with neither. A `templateQuery` must meet these conditions:

- It resolves to a query version whose type is CONSTRUCT.
- The query is in the library of the job.
- The query text reads no reserved caller slot, the same check as for inline text.

A floating reference resolves again at each run, so a new version of the query changes the next run. The query keeps one history: its versions, its tests and its environments. A new job version still pins the SQL together with the query reference it was saved with.

`GET /etl-jobs/:id/versions` reports `sparqlTemplate` as the text that the reference resolves to now, and adds `templateQueryVersion`, the query version it resolved to. If a reference no longer resolves, for example because the current version of a floating query is a SELECT, `sparqlTemplate` is empty, and a run of that job version fails with the reason.

A job version that names a query version holds it, the same way a query group version does. sqlib refuses to delete that query version, or its query. A floating reference holds the current version of the query.

These parts resolve a floating reference to the current version of the query (the implicit environment `latest`):

- `POST /etl-jobs/:id/execute`.
- A `DuckDbEtlNode` in a query group.
- A test of the job.
- The ETL jobs of a library export bundle.

None of them reads a named environment yet.

Job versions saved before `templateQuery` existed keep their copied text in `sparqlTemplate`, and run as before. sqlib does not match that text to a query version. To link such a job, open it, pick the query in the SPARQL Template panel, and save a new version.

## The run log

An `EtlExecution` record keeps the history that a version chain cannot keep. A
sink run that produces what the current version already holds makes no new
version, by design. Without a run log, a pipeline that ran each hour over a
table that did not change would leave the same trace as a pipeline that never
ran. The version chain records changes to content. The run log records runs.

sqlib writes a record for **each run of the job, from either sink**:

- `POST /etl-jobs/:id/execute` (the file sink);
- `POST /tuple-sets/:id/versions/from-etl` (the tabular sink).

Both resolve a stored job version, run its SQL against the real source, and keep
the result. Two calls are not runs of a job, and sqlib does not log them:

- `POST /etl-jobs/preview` takes arbitrary SQL, with no job version.
- A test run replaces the executor and the rows.

A record has the job version and column mapping version that it ran, the start
and end times, the number of chunks and rows that it read, where it wrote, and
the message when it failed. A tabular run adds two fields:

- `outputTupleSetVersion`: the version at the end of the run.
- `outputReused`: whether that version already existed.

A run of a job version with a `templateQuery` adds `templateQueryVersion`: the query version that the template came from. For a floating reference this is the version that the run resolved, so the run can be repeated with the same text.

With `outputReused`, the log of an hourly pipeline is easy to read. Without it,
the log is a column of identical rows that name one version. Such a log shows
that a run occurred, and does not show that the content did not change.

The tabular fields are separate from `outputLocation` and `outputFormat`. That
pair names a file. `getExecutionOutput` resolves `outputLocation` as a path, and
checks that it is under the ETL output directory. A version IRI stored there
would be read as a file path, and refused as a path traversal.

sqlib also records a failed run, from the moment that the stream opens. The
important case is the library budget. The writer checks
`MAX_TUPLE_SET_LIBRARY_BYTES` after it has read the whole table. The refusal
therefore comes on a run that did all of its work and stored nothing.

Caller errors before the stream, such as an unknown job version or a mapping
that maps nothing, make no record, because nothing ran. If the log itself cannot
write, the caller does not get that error. sqlib logs a warning and continues.
The caller gets the real error of the run, for example "your SQL names a table
that does not exist".

### Reading it back

```
GET /etl-jobs/:id/executions?limit=50
```

The newest record is first. The default `limit` is 50, and the maximum is 200.

The list is for the job, and covers all of its versions. sqlib stores each
record with the version whose SQL it ran, because that is the correct
provenance. If the list showed only the current version, a job would show only
the runs of that version, and older runs would be hidden. The route therefore
reads all versions of the job, and lists the runs of each.

A job that does not exist gives a 404. An empty array means "this job has never
run", so it cannot also mean "no such job".

`GET /etl-jobs/executions/:executionId` reads one record, by the id in the
response that made it.

Two limits:

- Records accumulate, and nothing removes them. `limit` sets how many records a
  call reads, and has no effect on how many sqlib keeps.
- The web app has no execution history view for either sink. The user sees only
  the toast of the ETL panel. The run log is available through the API only.

## Running a job outside the server

`sqlib etl run` runs a job from a job file, in one process, through the same loop
and the same sandboxed DuckDB as the server. One default is different. The CLI
runs in the process of the operator, and its purpose is to read local files, so
filesystem access is on unless `--no-allow-filesystem` turns it off. HTTP and
extension install stay off unless you ask for them, and the limits are the same
as on the server. What this page says about each capability applies to both. See
[the CLI guide](cli.md#sqlib-etl-run).

## DuckDB extensions and the image's libc

DuckDB publishes extensions for each platform, and a build for one platform does
not work on another. The platform includes the libc as well as the CPU. A glibc
image is `linux_amd64`, and an Alpine (musl) image is `linux_amd64_musl`. The
extension registry treats them as different targets.

**The published image is Debian-based (`node:26-bookworm-slim`, glibc), so its
platform is `linux_amd64`**, and the community extension registry serves it.

The reasons for this choice:

- Community builds for `linux_amd64_musl` existed at DuckDB v1.4.3, stopped at
  v1.5.0, and are still missing at v2.0.0. This is true for each community
  extension checked, so the registry dropped the platform.
- `linux_arm64_musl` was missing at each version checked.
- On Alpine, no community extension is therefore available at the DuckDB
  version that this project runs.
- Debian adds about 20 MB compressed (from 60 MB to 80 MB). In return, the image
  gets the signed extensions, with no work for each new version.

The Dockerfile checks the result at build time. It asks DuckDB for
`pragma_platform()`, and fails the build if the answer contains `musl`. If a
base image changes back to musl, the build fails, and the problem does not show
weeks later as a 404 in an ingestion.

If you build your own Alpine variant, **do not load a glibc extension into a
musl runtime**. The ABI does not match, and the result is a crash later in place
of an error now. If you need musl, use one of these:

- convert XML to Parquet or CSV outside the image;
- pin DuckDB to a 1.4.x release, where musl builds exist (amd64 only);
- build and host a musl extension yourself. It is unsigned, so it also needs
  `allow_unsigned_extensions`.

To load an extension, you need not open the sandbox. On 1.5.5, an extension that
is already in the extension directory of the image loads with
`enable_external_access=false`, `autoload_known_extensions=false`, and the
configuration locked. To install an extension from the registry, you need the
capabilities above, because this is a network fetch.

### Checking extensions before an ingestion

`packages/api/scripts/etl-extension-smoke.ts` asks the runtime directly. Use it
in a container smoke test:

```bash
# platform and resolved capability profile only
docker run --rm --entrypoint npx <image> tsx packages/api/scripts/etl-extension-smoke.ts

# and whether these extensions install and load here; non-zero exit if any does not
docker run --rm \
  -e ETL_DUCKDB_ALLOW_FILESYSTEM=true -e ETL_DUCKDB_ALLOW_HTTP=true \
  -e ETL_DUCKDB_ALLOW_EXTENSION_INSTALL=true \
  --entrypoint npx <image> tsx packages/api/scripts/etl-extension-smoke.ts webbed json@core
```

The script checks names against the `community` repository, unless you write
`name@core`. Extension installation needs the capabilities above. Under the
default profile, each install fails with a DuckDB permission error. For that
deployment this is the correct result, and not a fault in the check.
