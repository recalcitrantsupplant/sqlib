# Storage and caching

sqlib keeps its library as RDF: each query, version, rule set, tag, argument set
and test. By default the library is in one SQLite file. sqlib also keeps a copy
of the whole library in memory, so reads are synchronous. When auth is on,
grants and principals are in a second SQLite file by default. This page
describes the options for these stores and the cost of each, compares the
backends that queries run against, and states what the in-memory cache
guarantees.

The library store and a backend are separate things:

- A `Backend` entity is a place where your *queries* run. You create it in the
  UI or through the API.
- The library store is where sqlib keeps its *own* entities. An environment
  variable configures it.

## Where the library lives

`INTERNAL_BACKEND_TYPE` selects one of four options.

### `sqlite` (the default)

The library is one SQLite file, `library.sqlite` in `LIBRARY_STORAGE_DIR`
(default `./storage/library-store`). Each entity is one row: its IRI, its class,
and its triples as JSON. A write changes only the rows it touches, in one
transaction, and is on disk before it returns (WAL mode, `synchronous = FULL`).
This mode has no checkpoint and restores nothing at start. The server therefore
never pauses for storage, and an unclean shutdown loses no committed write.

Reads give the same result as the SPARQL modes.
`persistence/sqliteEntityStore.ts` builds the same `?id ?p ?o` rows that the
generated SELECT returns, and the same `EntityAssembler` turns them into
entities. Required fields, typed values and `@projects` joins therefore behave
the same in each mode.

SPARQL over the library works, read-only. Admin queries on the library storage
backend, library export, and a graph policy that runs there use
`persistence/librarySparqlView.ts`. This is an in-memory Oxigraph copy, built
from the rows when it is first needed and built again after the next write. It
exists only while something uses it. A SPARQL update on the library storage
backend gets 403. To change entities, use the API.

Keep the file on a local disk or a block volume. SQLite locking is not reliable
on network file shares (NFS, SMB), and WAL mode needs each process that opens
the file to be on one host. To copy a live file, use
`sqlite3 library.sqlite ".backup copy.sqlite"`. A plain `cp` can copy a file in
the middle of a write.

To move a library from another mode, export it from that mode and import it
into this one:

```
INTERNAL_BACKEND_TYPE=oxigraph-persistent pnpm --filter @sparql-query-lib/api export:library-store --out library.nq
INTERNAL_BACKEND_TYPE=sqlite pnpm --filter @sparql-query-lib/api import:library-store --file library.nq
```

The import writes one row for each subject in the default graph that has an
`rdf:type`, and reports what it skipped. It refuses a store that already has
entities, unless you give `--replace`.

### `http`

The library is in an external SPARQL 1.1 endpoint: Fuseki, GraphDB, the
Oxigraph server, or another server that answers query and update over HTTP.

```
LIBRARY_STORAGE_SPARQL_ENDPOINT=http://localhost:3030/sqlib/
LIBRARY_STORAGE_SPARQL_USERNAME=...
LIBRARY_STORAGE_SPARQL_PASSWORD=...
```

For a store with separate query and update URLs, set
`LIBRARY_STORAGE_SPARQL_QUERY_ENDPOINT` and
`LIBRARY_STORAGE_SPARQL_UPDATE_ENDPOINT`.

With `INTERNAL_BACKEND_TYPE=http` and no endpoint, the default is a local Fuseki
on its usual port. The comment in `server/config.ts` gives the reason: a server
with no configuration must fail against localhost, and must not connect to a
host that an old default named.

Choose this option when the library must hold more data than the process
memory, or when more than one sqlib instance writes to it.

### `oxigraph-persistent`

The library is in an Oxigraph store in the server process, and sqlib writes it
to one N-Quads file.

The store itself is in memory only. The top of `server/config.ts` says so:

> The oxigraph JavaScript/WebAssembly bindings only support in-memory stores.
> There is NO RocksDB disk-backed persistence like in Rust/Python bindings.

The whole library is therefore in the memory of the process. sqlib writes a
`.nq` snapshot to `LIBRARY_STORAGE_DIR`:

- on a timer, `INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS` (default 60000), and
- at a clean shutdown.

There is no RocksDB path. sqlib does not read `INTERNAL_OXIGRAPH_DB_PATH`.

The design (one in-memory store, saved as a whole) has four effects. Each one
was measured.

**A checkpoint stops the server.** `Store.dump` is a synchronous call into wasm,
so the event loop is blocked until it ends. On the machine where the numbers in
`OxigraphStoreManager.ts` were taken, this was about 107 ms for 50,000 quads and
3.7 s for one million. A checkpoint that takes longer than
`CHECKPOINT_PAUSE_WARNING_MS` (100 ms) logs a warning with the time the event
loop was blocked. The checkpoint loop skips a store that has had no write since
its last checkpoint. It counts writes as they happen. A delete and an insert of
the same number of quads leave `store.size` the same, so size is not used.

**The JavaScript string limit is a hard size limit.** `dump` returns a string,
and a JavaScript string can have at most `0x1fffffe8` characters (512 MiB).
Above that, the wasm module traps with `RuntimeError: unreachable`, which gives
the caller no useful message. `writeStoreSnapshot` catches the trap, reports it
again with the quad count and the limit, and keeps the previous snapshot. The
store continues to answer queries. Only the checkpoint is lost. A restore does
not have this limit, because the parser reads the file as bytes. A 578 MB
snapshot with 4.3 million quads loaded in about 67 seconds. A store can
therefore grow to a size where a restore still works and a save fails.

**A snapshot that exists but cannot be read stops the start.** A missing file
means a first start, and an empty store is correct. An unreadable file means
that the data is still on disk. If the server started empty, the next
checkpoint would write over that data. A failed restore therefore stops the
server with an error.

**The write is atomic at the filesystem level.** The dump goes to a temporary
file in the same directory, and sqlib then renames it over the target. If the
process stops or the disk fills during the write, the previous snapshot stays
complete.

This option suits one instance with a library that fits easily in memory: a
workstation, a demo, a CI run, or the server of a small team. The recipes in
the `Justfile` of the repository use it. Do not use it for two instances that
share a library, for a library near the dump limit, or where the loss of up to
one checkpoint interval of work at an unclean shutdown is not acceptable.

### `oxigraph-memory`

An in-process store that exists only while the process runs. sqlib creates it
empty at first use. It has no checkpoint and no snapshot at shutdown, and the
next start is empty again. The test suite uses it, and it suits a temporary
development server. For a library that must survive a restart, use `sqlite`.

### Choosing

| | `sqlite` | `http` | `oxigraph-persistent` |
| --- | --- | --- | --- |
| Library survives a crash | yes, each committed write | yes, as the store guarantees | up to the last checkpoint |
| Pauses the server | no | no | at each checkpoint |
| Size limit | the cache: process memory | the store's own | process memory; dumps stop at 512 MiB of N-Quads |
| More than one sqlib instance writes | no | yes | no |
| SPARQL over the library | read-only, on demand | yes | yes |
| Write latency | in-process | a network round trip | in-process |
| Operational tools | `sqlite3`, Litestream | the store's own | copy a `.nq` file |
| Extra process to run | no | yes | no |

Use `sqlite` for one instance. Read-only replicas can each run on their own copy
of the file. Use an external HTTP endpoint when more than one instance must
write, or when the library is larger than memory.

## Where grants live: the auth store

Principals, grants and per-backend policies are in a separate auth store.
`SQLIB_AUTH_STORE_TYPE` selects it. sqlib reads it only when `SQLIB_AUTH_MODE`
is not `disabled`.

| `SQLIB_AUTH_STORE_TYPE` | Where | Written |
| --- | --- | --- |
| `sqlite` (the default) | `auth.sqlite` in `SQLIB_AUTH_STORE_DIR` (default `./storage/auth`) | at each change, one row per quad, in one transaction; an `auth_events` table records what each change added and removed |
| `file` | `auth.nq` in the same directory | the whole file at each change, renamed into place |
| `sparql` (the default when `SQLIB_AUTH_SPARQL_ENDPOINT` is set) | the `urn:sqlib:auth` graph of a separate SPARQL dataset | at each change, over HTTP |

A default deployment with auth on therefore keeps all its durable state in two
SQLite files: `library.sqlite` and `auth.sqlite`. They are in different
directories. Copy each one with `sqlite3 <file> ".backup copy"`. The same disk
rules apply to both: use a local disk or a block volume, and do not use a
network file share. [security-model.md](security-model.md) describes what the
auth store holds.

## Where queries run: backends

The stores above hold the entities of sqlib. A query runs against a `Backend`
entity. You create a backend at runtime (`POST /backends`), and it is stored in
the library. A server can have any number of backends, of three types:

| | `http` | `oxigraphMemory` | `oxigraphEphemeral` |
| --- | --- | --- | --- |
| What it is | any SPARQL 1.1 endpoint: Fuseki, GraphDB, an Oxigraph server | an Oxigraph store in the sqlib process | an empty Oxigraph store in the sqlib process |
| Data comes from | the endpoint | data graphs in the library, pinned or tracked; or a seed (below) | uploads and SPARQL updates |
| Modes | none | `readOnly` (the default), `ephemeral`, `durable` | none |
| Writes | as the endpoint allows | refused in `readOnly`; kept in memory in `ephemeral`; kept and saved in `durable` | kept in memory |
| Survives a restart | yes | `readOnly` and `ephemeral` are built again from their sources; `durable` restores its `.nq` snapshot | no |
| Checkpoint | the endpoint's own | `durable` only: a `.nq` file under `OXIGRAPH_STORAGE_DIR`, on the checkpoint timer and at shutdown | none |
| Size limit | the endpoint's | process memory | process memory |
| Extra process | yes | no | no |

`oxigraphEphemeral` is the older in-process type. For new work, use
`oxigraphMemory` with `mode: "ephemeral"`, which you can also seed.

A query group or a rule set can also run on a scratch Oxigraph store that exists
for one execution only. That store is not a `Backend` entity.

### A read-only dataset needs no external store

For data that nobody writes, register an `oxigraphMemory` backend in `readOnly`
mode. No SPARQL server runs next to sqlib. Oxigraph is the query engine, and it
runs inside the sqlib process, from its npm package.

sqlib fills the store from an RDF serialisation at load time, in one of two
ways:

- **Data graphs** (`sources`). The RDF is saved as data graph versions in the
  library, so it is in `library.sqlite` with everything else. A source with
  `dataGraphVersionId` is pinned. A source with `dataGraphId` follows the
  current version of the graph. When you save a new version, sqlib drops the
  store, and the next query builds it again.
- **A seed** (`loadMethod` and `sourceConfig`). `file` reads a local file
  (`filePath`, with `format` set to `turtle`, `ntriples`, `rdfxml` or
  `jsonld`). `remote-file` fetches a file from `remoteFileUrl`.
  `remote-sparql` runs `importQuery` against `remoteEndpoint`.

```json
{
  "name": "Reference data",
  "backendType": "oxigraphMemory",
  "oxigraphConfig": "{\"mode\":\"readOnly\",\"sources\":[{\"dataGraphVersionId\":\"urn:...\"}]}"
}
```

`ReadOnlySparqlExecutor` refuses a SPARQL update or an upload to a `readOnly`
backend with 403. sqlib builds the store at first use, so the first query waits
for the load. Each restart loads it again.

When the data is in data graphs, one SQLite file holds the whole deployment.
Ship `library.sqlite` and start sqlib with `SQLIB_READ_ONLY=true`. Each query
then runs against data held in that file.

No backend reads RDF directly from a SQLite file, and Oxigraph is the only
engine for in-process SPARQL. Admin SPARQL over the library itself (the library
storage backend) is the only case that reads `library.sqlite`. It runs on an
Oxigraph copy built from the rows, and that copy holds the entities of sqlib.
Your data is not in it.

Outside the server, the `sqlib` CLI needs no backend.
`sqlib query --data people.ttl` loads the files into an in-process Oxigraph
store for one run. See [cli.md](../guides/cli.md).

## The entity cache

sqlib reads each entity into memory at start, and serves reads from memory. A
route handler can then call `repos.Query.get(id)` and get a result with no
`await`. Resolving the nodes of a query group, checking a reference and
filtering a list therefore need no SPARQL.

### The parts

**`EntityRegistry.ts`** lists the entity types. `LENS_BY_TYPE` maps each of 52
entity types to its repository. `TTL_MS` gives each type a cache lifetime.

**`CacheCoordinator.ts`** holds the state. It stores a
`Map<EntityType, EntityCache>` and one `_idToType` index across all types, so a
list of one type does not read each entity. It handles loading, refresh,
ephemeral entities and the immutability of system entities. It is the only
place where a write goes to the store and also updates memory.

**`EntityRepositories.ts`** wraps the coordinator in a typed repository for each
entity type. Feature code uses these repositories, usually through the
`withReposHandler` route helper: `repos.Query.get(id)`, `repos.Backend.list()`,
`repos.RuleSet.create(...)`.

**`MemoryCacheManager.ts`** is a thin facade over the coordinator. It is kept
for older call sites and tests that were written before the repositories. It
passes each call to the coordinator. Use the repositories in new code.

### Loading

`loadAll()` runs before any route is registered. It loads the system entities
first (see below). Then, unless `CACHE_PRELOAD=false`, it loads each registered
type from the store, in parallel.

If a type fails to load, sqlib logs the error, and that type is empty. The start
continues. A server with one type missing can recover, and a server that does
not start cannot. The cost is that a partly loaded cache looks like a partly
empty library. The only signal is the error log. The API shows nothing.

`get()` and `list()` throw an error until the cache has loaded. Until then,
`/health` reports `status: "not_ready"` and returns `503`.

### Staleness and refresh

Reads use stale-while-revalidate. `get(id)` returns the cached entity at once. If
the type of that entity has a finite TTL and the entry is older than the TTL,
`get` also starts a background read of that one entity. `list(type)` does the
same for the whole type. It replaces each entity of that type with what the
store returns, except system and ephemeral entities. sqlib tracks a running
refresh by id and by type, so parallel reads do not start more than one
refresh.

The TTLs follow the versioning model:

| Type | TTL |
| --- | --- |
| `QueryVersion`, `QueryGroupVersion`, `RuleVersion`, `DataBlockVersion`, `RuleSetVersion`, `DataGraphVersion`, `TupleSetVersion`, `ArgumentSetVersion`, `TestVersion`, `BenchmarkExperimentVersion`, `TestCase`, `TestCaseDataGraph`, `RuleSetNode`, `PatchNode` | infinite |
| `Query`, `Rule`, `RuleSet`, `DataBlock`, `DataGraph`, `TupleSet`, `Test` | 15 s |
| `QueryGroup` | 30 s |
| `BenchmarkExperiment` | 60 s |
| `Library`, `Tag`, `Patch` | 120 s |
| `Backend` | 180 s |
| Types not in the list | 60 s |

Most version types never expire, because they cannot change. The two ETL version
types are not in the list, so they get the 60-second default. See
[versioning-and-immutability.md](versioning-and-immutability.md). `Patch` has a
long, finite TTL, because the status of a patch can change. With an infinite
TTL, a revert done by another process would never appear.

The cache guarantees two things:

- **Your own writes are visible at once.** A write updates the cache
  synchronously after the store accepts it.
- **Writes from another process become visible within the TTL of the type**, at
  the next read that finds the entry stale. Until then, a read returns the
  previous value.

With `CACHE_PRELOAD=false`, the background refresh is off.

For the same reason, more than one sqlib process on one library store is not a
supported configuration. Each process has its own cache, and no process is told
when another one writes.

One process has a change feed. `GET /events` is a Server-Sent Events stream of
change notifications. One `onSend` hook on responses that change data emits
them. A frame carries a notification and no entity data. A subscriber therefore
fetches the entity through its normal path, which also refreshes its
concurrency tokens. The emitter is module-level, so it reaches subscribers in
the same process only.

### Writes

`CACHE_WRITE_THROUGH` is true by default. A write then goes to the store first
and to memory second. `update()` reads the entity again from the store and
merges the changes of the caller over the result, so the cached copy matches
what the store holds. With `false`, writes go to the cache only. This setting is
for tests. Do not use it in a deployment.

`resolveExisting` can read the store. A reference check asks whether an IRI
names an entity of an allowed type. With `CACHE_PRELOAD=false`, a valid IRI can
be missing from the cache, so the cache alone cannot answer. `resolveExisting`
then reads the store, and tries each candidate type until one answers.

### System entities

The server ships with a small set of entities: the system library, and the
system queries that the persistence layer runs. sqlib loads them from
`packages/api/system-store/assets` at start, and their IRIs are known in
advance. The coordinator refuses to create, update or delete any of them, with
the message `System entity <id> is immutable.` No refresh path reads them,
because the store has no copy of them.

The system store breaks a start-up cycle. `SystemQueryRunner` gets its query
text from the entity cache, and `loadAll()` fills the cache. The queries that
load entities therefore cannot be entities that `loadAll()` loads. For the same
reason, `EntityStore` generates its read and write SPARQL from the compiled-in
schemas and executes it directly. It does not use `SystemQueryRunner`.

### Ephemeral entities

`addEphemeral` puts an entity in the cache only. The playground uses it. A rule
version, data block version or ETL job that the user has not saved becomes an
ephemeral entity, and the normal executor runs it in the same way as a stored
one. Unsaved and saved entities therefore use one execution path.

No refresh reads ephemeral entities, because the store has no copy. `delete`
removes one from memory and does not touch the store.

### What the cache costs

When the store is in-process, the library is in memory twice: as quads in
Oxigraph, and as JavaScript objects in the cache. `GET /metrics` reports both.
It gives entity counts for each type and an estimated byte size for the cache,
and triple counts and memory use for each Oxigraph store. The route needs
administrator access, because it shows store contents and process internals.

## Patches and history

sqlib can calculate a write to a *backend* before it is applied, and record it
after. (A write to the library is a different path.) `packages/rdf-delta` turns
a SPARQL update into the ground set of quads that it would add and remove. See
[rdf-patch.md](rdf-patch.md). The result is a `Patch` entity, stored with the
other entities. It therefore uses the same authorization, cache and route code,
and has the size limits above. A very large patch in an entity field is stored
in the same way as a large data graph.

`PatchLogService` answers analysis questions over the log, such as the state at
a past time, churn, and the subjects that change most often. For each call, it
loads the log into a private DuckDB instance. It keeps no materialised copy.
This instance is separate from the ETL instance. The log runs only SQL written
by sqlib, never SQL from a caller, so it uses the strictest capability profile.
The ETL instance needs a wider profile, and the log must not get it.

## Related

- [architecture.md](architecture.md): where the persistence layer is.
- [versioning-and-immutability.md](versioning-and-immutability.md): why
  version entities never expire.
- [rdf-patch.md](rdf-patch.md): how sqlib calculates the effect of an update.
- [reference/configuration.md](../reference/configuration.md): each variable
  named here, with its default.
- [guides/running-and-configuring.md](../guides/running-and-configuring.md):
  connect a running server to a store.
- [guides/deploying.md](../guides/deploying.md): volumes and shutdown for the
  container image.
