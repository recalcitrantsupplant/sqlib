# ETL: what enabling it grants

ETL accepts **arbitrary DuckDB SQL** from a caller and runs it in the API process.
That is the whole feature — a pipeline that cannot express its own extraction is not
an ETL tool — and it is also the whole risk. This page states what a deployment
grants when it turns ETL on, which setting grants what, and where the boundary
actually is as opposed to where it looks like it is.

> **A hosted multi-tenant deployment cannot enable ETL on shared infrastructure.**
> There is no setting on this page that makes arbitrary SQL safe to offer to tenants
> who do not already trust one another. ETL is an operator flow: one team, its own
> instance, its own data.

## The short version

Out of the box, nothing is on.

| | Default | To enable |
| --- | --- | --- |
| The ETL routes exist at all | **off** | `FEATURE_ETL=true` |
| The ETL playground exists at all | **off** | `FEATURE_PLAYGROUND_ETL=true` |
| Submitted SQL may read the host filesystem | **off** | `ETL_DUCKDB_ALLOW_FILESYSTEM=true` |
| Submitted SQL may make outbound HTTP requests | **off** | `ETL_DUCKDB_ALLOW_HTTP=true` |
| DuckDB may autoinstall/autoload extensions | **off** | `ETL_DUCKDB_ALLOW_EXTENSION_INSTALL=true` |
| Everything above, unconfigured and unlocked | **off** | `ETL_DUCKDB_UNRESTRICTED=true` |

Resource limits work the other way round: they are on by default, and the
environment only moves them.

| | Default | To change |
| --- | --- | --- |
| Deadline for `getSchema` and `preview`, the interactive paths | 30s | `ETL_DUCKDB_INTERACTIVE_TIMEOUT_MS` |
| Deadline for one chunk read, or a full `execute` | 300s | `ETL_DUCKDB_QUERY_TIMEOUT_MS` |
| DuckDB `memory_limit` | 1GB | `ETL_DUCKDB_MEMORY_LIMIT` |

The two routes that take SQL — `POST /etl-jobs/preview` and
`POST /playground/etl/execute` — require **administrator** access under
`SQLIB_AUTH_MODE=required`, not merely a valid token.

The resolved profile is logged once at boot, so a deployment's actual posture is
greppable:

```
[DuckDbService] DuckDB loaded successfully — capabilities: filesystem=false http=false extensionInstall=false configLocked=true limits: interactiveTimeout=30000ms queryTimeout=300000ms memoryLimit=1GB
```

## The feature flags

`etl` and `playgroundEtl` both default to **false**. With them off, `/etl-jobs` is
never registered and `/playground/etl/execute` answers 404. See
[Feature flags](../reference/feature-flags.md) for the full list and how they are
set.

They default off for the same reason `assistant` does: a feature that hands
arbitrary SQL to the host should not appear because somebody upgraded. Turning them
on is a deliberate act by whoever runs the deployment.

Local development and CI set them explicitly. Note that with the web app built
`ssr: false`, the flags are baked into the client bundle at build time, so a build
step needs them as well as the run step.

## The DuckDB capability profile

`packages/api/src/lib/duckdbCapabilities.ts` resolves a capability profile from the
environment, defaulting every capability to off, and `DuckDbService` builds one
`DuckDBInstance` from it at startup. Every connection comes off that instance;
nothing creates an unconfigured one.

### What actually enforces something

Measured against `@duckdb/node-api` 1.4.3-r.3 (DuckDB v1.4.3), rather than taken
from documentation:

- **`enable_external_access=false` at instance creation** blocks file reads, network
  reads and `INSTALL`. It is startup-only: `SET enable_external_access=true` on a
  live database fails with "Cannot change … while database is running". This is the
  one hard boundary available.
- **`autoinstall_known_extensions` and `autoload_known_extensions` set to false**
  stop httpfs and friends appearing on demand. This governs what DuckDB does
  implicitly; it is not a ban on `INSTALL`. With filesystem access granted, an
  explicit `INSTALL` succeeds regardless — what makes `INSTALL` fail in the default
  profile is `enable_external_access=false`.
- **`SET lock_configuration=true`**, applied on a boot connection before any caller
  SQL runs, blocks every later `SET`, including from a second connection on the same
  instance. Without it, submitted SQL rewrites the profile at runtime.

### What is deliberately not offered

A directory allowlist. `allowed_directories` and `allowed_paths` are rejected
outright by this binding's instance config ("Failed to set config"), and when set
over SQL they are accepted and then enforce nothing: with
`allowed_directories=['/tmp']` set and the configuration locked,
`read_csv('/etc/passwd')` still returns rows. A setting that appears to confine ETL
to a directory but does not is worse than no setting, so filesystem access is
all-or-nothing until the binding supports confinement.

The practical consequence: **`ETL_DUCKDB_ALLOW_FILESYSTEM=true` grants the whole
filesystem the API process can read.** If that is too much, the confinement has to
come from outside the process — a container with only the data volume mounted, or a
dedicated user. There is no DuckDB setting that does it.

### HTTP implies filesystem

DuckDB gates local files and the network on one `enable_external_access` switch, so
`ETL_DUCKDB_ALLOW_HTTP=true` necessarily grants filesystem access too.
`resolveDuckDbCapabilities` makes that visible in the resolved profile rather than
implying a separation the engine does not have.

### The escape hatch

`ETL_DUCKDB_UNRESTRICTED=true` creates connections ad hoc with no configuration and
nothing locked. It logs a warning at boot naming itself. It exists for an operator
who has read this page and decided; it is not a shortcut past a setup problem.

## What submitted SQL may consume

The capability profile bounds what a query can reach. It says nothing about time or
memory. Two mechanisms do, both measured against `@duckdb/node-api` 1.5.5-r.4:

- **A deadline per statement, cancelled with `connection.interrupt()`.** The pending
  read rejects with `DuckDbTimeoutError` naming the limit, and the connection is
  usable afterwards. There are two deadlines because the paths differ: `getSchema`
  and `preview` are interactive, with somebody waiting on the playground, while a
  chunk read belongs to a job that is expected to take a while. Set either to `0` to
  run without one; any other unreadable value falls back to the default rather than
  silently removing the ceiling.
- **`memory_limit` in the instance config.** Unlike `allowed_directories`, this one
  is both accepted by the binding and covered by `lock_configuration=true`:
  submitted SQL asking for `SET memory_limit='10GB'` fails with "the configuration
  has been locked". Set `ETL_DUCKDB_MEMORY_LIMIT=` (empty) to hand memory back to
  the engine's own default, which is a share of host RAM.

A deadline is a release, not a safety boundary: it stops one query holding a worker
indefinitely. It does not make arbitrary SQL safe to offer to tenants who do not
trust one another.

## Who may submit SQL

Under `SQLIB_AUTH_MODE=required`, both SQL-taking routes require administrator
access:

- `POST /etl-jobs/preview`, via `adminSuffixes` on the route plugin's entity guard
  (`packages/api/src/routes/etl-jobs.ts`).
- `POST /playground/etl/execute`, via an explicit `requireAdmin` in the handler
  (`packages/api/src/routes/playground.ts`).

Administrator rather than a library grant, because a library grant answers the wrong
question. "May do anything to my own queries" is not "may read the host filesystem":
the blast radius of submitted SQL is the process and its host, not an entity, so no
per-library mode describes it. `/etl-jobs/preview` owns no entity, so it was
previously exempt from library resolution — which left it reachable by any
authenticated principal at all.

Both bullets are executed rather than described.
`packages/api/test/auth/sqlRoutesAdminOnly.test.ts` reads that list out of this
documentation, mounts the real plugin behind each route, and requires a principal
holding every mode on a library — and not administrator — to be refused. A route
added to the list that nothing refuses fails there, and so does a guard deleted from
a route the list names.

**Under the default `SQLIB_AUTH_MODE=disabled` there is no principal and every
request carries full access, so these checks are no-ops.** That is why the feature
flags ship off: the flag, not the authorization check, is what protects a default
deployment.

A finer-grained `etl:execute` scope remains possible later. It would be a narrowing
of this rather than a break — administrators keep it either way.

## A worked profile

Reading CSVs from a mounted data directory, no network, no extension downloads, auth
on:

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

Run it in a container whose only mount is the data volume, and grant administrator to
the operators who build pipelines rather than to everyone with a token.

## Where a job execution's output goes

`POST /etl-jobs/:id/execute` does not return the RDF it constructs. Each chunk's
CONSTRUCT result is appended to one file per execution as soon as it comes back, so
the API process holds one chunk's worth of RDF at a time however large the source is
— a source of ten million rows constructs tens of gigabytes, and a response carrying
it would have been built in memory first. The execution record's `outputLocation` and
`outputFormat` name the file, and `GET /etl-jobs/executions/:executionId/output`
streams it back. A run that fails leaves no file.

The directory is `ETL_OUTPUT_DIR`, defaulting to `./storage/etl-output` relative to
the API's working directory. Mount it on the data volume alongside the Oxigraph
storage, and size it for the output rather than the input: it is the one path ETL
writes to the host.

### It has to be writable by the user the container runs as

The image runs as `USER node` — uid 1000 — and the default output directory sits
under the declared volume `/app/packages/api/storage`. That combination has one sharp
edge: a fresh container can fail its first execution with

```
EACCES: permission denied, mkdir '/app/packages/api/storage/etl-output'
```

because the directory inside the image was root-owned `0755`, and Docker seeds a
fresh volume from the image's content including its ownership.

The Dockerfile creates `/app/packages/api/storage/etl-output` owned by `node` before
declaring the volume, so a fresh anonymous or named volume is writable. An image fix
does not repair storage that already exists, and cannot:

- **A host bind mount** keeps the host directory's ownership. Create it as uid 1000 —
  `mkdir -p ./storage && sudo chown -R 1000:1000 ./storage` — or run the container
  with `--user "$(id -u):$(id -g)"` and a directory that user owns.
- **A named volume seeded by an earlier image** keeps the root ownership it was
  given. Fix it once from a throwaway root container:
  `docker run --rm -u 0 -v sparql-storage:/data alpine chown -R 1000:1000 /data`.
- **Somewhere else entirely** — point `ETL_OUTPUT_DIR` at a path the process owns.
  `/tmp` works and is a test workaround rather than a deployment: it is not
  persistent, and downloads of an execution's output stop working when the container
  is replaced.

With `FEATURE_ETL=true`, the API checks this at boot instead of leaving it to the
first execution. It creates the directory and writes a probe file, and logs either

```
ETL output directory ready: /app/packages/api/storage/etl-output
```

or an error naming the path, the failure and the fix. The check never stops the
server — a deployment that cannot write ETL output still serves everything else — so
grep the boot log for it before running a job.

### Asking the mount directly, without booting anything

`packages/api/scripts/storage-writability-smoke.ts` runs the same check on its own,
for the case the image fix cannot reach: a volume or bind mount that already exists
and carries ownership from somewhere else. It needs no API, no backend and no job.

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

It prints the uid the process runs as and the owner and mode of both the output
directory and the mount point above it — the four numbers that say whether the mount
or the image is at fault — and exits non-zero when the directory cannot be written,
so a deployment smoke test can gate on it. `--json` gives the same report for a
machine to read.

## The run log

An `EtlExecution` record is the history a version chain cannot keep. A sink run that
produced what the current version already holds cuts no version by design, so without
a run log a pipeline that ran every hour over an unchanging table and a pipeline that
never ran at all leave the same trace. The version chain is a history of content; the
question "has this thing been running" is about runs.

A record is written for **a run of the job, whichever sink asked for it**: both
`POST /etl-jobs/:id/execute` (the file sink) and
`POST /tuple-sets/:id/versions/from-etl` (the tabular sink) resolve a stored job
version, run its SQL against the real source, and keep what came back.
`POST /etl-jobs/preview` takes arbitrary SQL with no job version in the story, and a
test run substitutes the executor and the rows; neither is a run of the job and
neither is logged.

A record carries the job version and column mapping version it ran, when it started
and finished, how many chunks and rows it read, where it wrote, and the message when
it failed. A tabular run adds two fields:

- `outputTupleSetVersion` — the version the run ended at.
- `outputReused` — whether that version already existed.

`outputReused` is what makes a log of an hourly pipeline readable. Without it the log
is a column of identical rows naming one version, which says "something happened"
rather than "nothing changed". These are deliberately not `outputLocation` and
`outputFormat` reused: that pair means a file, and `getExecutionOutput` resolves
`outputLocation` as a path and checks it lies under the ETL output directory, so a
version IRI stored there would be read as a file and answered with a path-traversal
refusal rather than "this run wrote no file".

A failed run is recorded too, from the moment the stream opens. The case that matters
is the library budget: `MAX_TUPLE_SET_LIBRARY_BYTES` is checked by the writer, which
is after the whole table has been read, so the refusal lands on a run that did all of
its work and stored none of it. Caller mistakes ahead of the stream — an unknown job
version, a mapping that maps nothing — open no record, because nothing ran. The log's
own failure to write is never the failure the caller hears about: it is swallowed and
warned, because replacing "your SQL names a table that does not exist" with "the
store rejected a write" would answer a question nobody asked.

### Reading it back

```
GET /etl-jobs/:id/executions?limit=50
```

Newest first. `limit` defaults to 50 and is capped at 200.

The listing is per job, not per version. Records are stored per version, since a run
names the version whose SQL it ran and that is the only honest provenance, but a job
whose history stopped at its current version would answer "what has this pipeline
been doing" with the runs of a version nobody has used since. The route walks the
job's versions and lists the runs of all of them.

A job that does not exist is a 404 rather than an empty array: "this job has never
run" is a real answer and an empty list is how it is spelled, so it cannot also be
how "no such job" is spelled.

`GET /etl-jobs/executions/:executionId` reads one record by the id handed back in the
response that created it.

Two limits worth knowing. Records accumulate and nothing prunes them; the `limit`
bounds what is read rather than what is kept. And the web app has no execution
history view for either sink — the ETL panel's toast is the whole of what a user
sees, so the run log is an API route today.

## DuckDB extensions and the image's libc

DuckDB extensions are published per platform, and a build for one platform says
nothing about another. The platform is the libc as much as the CPU: a glibc image is
`linux_amd64`, an Alpine/musl one is `linux_amd64_musl`, and the extension registry
treats them as different targets.

**The published image is Debian-based (`node:26-bookworm-slim`, glibc), so its
platform is `linux_amd64`** and the community extension registry serves it.

That is a deliberate choice. `linux_amd64_musl` community builds existed at DuckDB
v1.4.3 and stop at v1.5.0 — across every community extension checked, so the registry
dropped the platform rather than one maintainer dropping one extension — and
`linux_arm64_musl` was absent at every version probed. On Alpine the whole community
ecosystem is therefore unreachable at the DuckDB version this project runs. Moving
the image to Debian costs about 20 MB compressed (60 to 80 MB) and buys back the
signed extension ecosystem with no per-version maintenance. The Dockerfile asserts the
result at build time: it asks DuckDB for `pragma_platform()` and fails the build if
the answer contains `musl`, so a base image quietly changed back cannot ship as a 404
in somebody's ingestion weeks later.

If you build your own Alpine variant, **do not load a glibc extension into a musl
runtime**. The ABI does not match, and what that buys is a crash later instead of an
error now. The alternatives, should you need musl: preprocess XML to Parquet or CSV
outside the image, pin DuckDB to a 1.4.x release where musl builds exist (amd64
only), or build and self-host a musl extension — which is unsigned, and therefore also
needs `allow_unsigned_extensions`.

Loading an extension does not require opening the sandbox: measured on 1.5.5, an
extension already present in the image's extension directory loads under
`enable_external_access=false` with `autoload_known_extensions=false` and the
configuration locked. Installing one from the registry does need the capabilities
above, because that is a network fetch.

### Checking before an ingestion finds out

`packages/api/scripts/etl-extension-smoke.ts` asks the runtime directly, and is meant
for a container smoke test:

```bash
# platform and resolved capability profile only
docker run --rm --entrypoint npx <image> tsx packages/api/scripts/etl-extension-smoke.ts

# and whether these extensions install and load here; non-zero exit if any does not
docker run --rm \
  -e ETL_DUCKDB_ALLOW_FILESYSTEM=true -e ETL_DUCKDB_ALLOW_HTTP=true \
  -e ETL_DUCKDB_ALLOW_EXTENSION_INSTALL=true \
  --entrypoint npx <image> tsx packages/api/scripts/etl-extension-smoke.ts webbed json@core
```

Names are checked against the `community` repository unless written `name@core`.
Extension installation needs the capabilities above; under the default profile every
install fails with a DuckDB permission error, which is the right answer for that
deployment rather than a fault in the check.
