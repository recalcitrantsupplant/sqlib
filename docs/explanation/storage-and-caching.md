# Storage and caching

sqlib keeps its library — every query, version, rule set, tag, argument set and
test — as RDF in a SPARQL store, and keeps a copy of all of it in memory so that
reads are synchronous. This page explains what that store can be, what each
choice costs, and what the in-memory cache does and does not guarantee.

Backends you create in the UI are a different thing from the store the library
itself lives in. A `Backend` entity is a place your *queries* run. The library
store is where sqlib puts its *own* entities, and it is configured by
environment variable, not by an entity.

## Where the library lives

`INTERNAL_BACKEND_TYPE` chooses among three options.

### `http` (the default)

The library is stored in an external SPARQL 1.1 endpoint: Fuseki, GraphDB,
Oxigraph's own server, or anything else that answers query and update over HTTP.

```
LIBRARY_STORAGE_SPARQL_ENDPOINT=http://localhost:3030/sqlib/
LIBRARY_STORAGE_SPARQL_USERNAME=...
LIBRARY_STORAGE_SPARQL_PASSWORD=...
```

Separate query and update URLs are available
(`LIBRARY_STORAGE_SPARQL_QUERY_ENDPOINT`,
`LIBRARY_STORAGE_SPARQL_UPDATE_ENDPOINT`) for stores that split them.

With nothing configured the default is a local Fuseki on its conventional port.
The comment in `server/config.ts` gives the reason for that particular default:
an unconfigured server should fail against localhost rather than reach out to
whatever host a default once named.

This is the option to choose when the library must survive the process, hold
more data than the process can, be backed up by ordinary database means, or be
shared between more than one sqlib instance. It is the only option where the
store is a real database with its own durability, indexes and operational
tooling.

### `oxigraph-persistent`

The library is held in an in-process Oxigraph store and serialised to a single
N-Quads file.

The name overstates what this is, and the code says so at the top of
`server/config.ts`:

> The oxigraph JavaScript/WebAssembly bindings only support in-memory stores.
> There is NO RocksDB disk-backed persistence like in Rust/Python bindings.

The whole library is therefore resident in the process's memory. Durability
comes from a `.nq` snapshot in `LIBRARY_STORAGE_DIR`, written:

- on a timer, `INTERNAL_OXIGRAPH_CHECKPOINT_INTERVAL_MS`, default 60000; and
- on clean shutdown.

`INTERNAL_OXIGRAPH_DB_PATH` and the `persistPath` field it fills are marked
`@deprecated` and ignored — there is no RocksDB path to set.

Four consequences follow from "one in-memory store plus a whole-store dump",
and each is measured rather than assumed:

**A checkpoint is a stop, not a background job.** `Store.dump` is synchronous
into wasm, so the event loop is blocked for its whole duration: roughly 107ms
for 50,000 quads and 3.7s for a million, on the machine those numbers were taken
on (`OxigraphStoreManager.ts`). A checkpoint that takes longer than
`CHECKPOINT_PAUSE_WARNING_MS` (100ms) logs a warning that says the event loop
was blocked for that time. The checkpoint loop skips a store the process has not
written since its last checkpoint, counting writes as they happen rather than
comparing `store.size` — a delete-and-insert of equal counts leaves the size
unchanged.

**There is a hard ceiling, and it is the JavaScript string limit.** `dump`
returns a string, and a JavaScript string cannot exceed `0x1fffffe8` characters
(512 MiB). Past that the wasm module traps with `RuntimeError: unreachable`
rather than throwing something a caller can read. `writeStoreSnapshot` catches
that and re-reports it with the quad count and the limit, and leaves the
previous snapshot in place: the store keeps answering queries, and what has been
lost is the checkpoint. Restoring is not subject to the same ceiling — the file
is handed to the parser as bytes, and a 578 MB / 4.3M-quad snapshot has been
loaded in about 67 seconds — so a store can reach a size at which it can still
be restored but can no longer be saved.

**A snapshot that exists and cannot be read is never treated as absent.** A
missing file means a first boot and an empty store is correct; an unreadable
one means the data is still on disk, and starting empty would let the next
checkpoint write over it. So a failed restore fails loudly rather than
silently starting fresh.

**The write is atomic at the filesystem level.** The dump goes to a sibling
temporary file and is renamed over the target, so a crash or a full disk
mid-write leaves the previous snapshot intact rather than a truncated file the
next boot would refuse.

This option suits a single-instance deployment whose library fits comfortably in
memory: a workstation, a demo, a CI run, a small team's server. It is what every
recipe in the repository's `Justfile` uses. It does not suit two instances
sharing a library, a library large enough to approach the dump ceiling, or a
deployment where losing up to one checkpoint interval of work on an unclean
shutdown is unacceptable.

### `oxigraph-memory`

The third value. `server/config.ts` describes it as an ephemeral in-memory
store, and unlike `oxigraph-persistent` it starts no checkpoint loop and ignores
`LIBRARY_STORAGE_DIR`. Read the code before relying on it being ephemeral: the
executor it resolves to still builds the store through
`OxigraphStoreManager.createDurableStore`, which restores from a `.nq` under
`OXIGRAPH_STORAGE_DIR` when one is present and serialises on shutdown. No
`Justfile` recipe uses this value, and the documented intent and the code path
do not clearly agree, so prefer `oxigraph-persistent` for an in-process store
and `http` for a durable one.

### Choosing

| | `http` | `oxigraph-persistent` |
| --- | --- | --- |
| Library survives a crash | yes, to the store's own guarantees | to the last checkpoint |
| Size limit | the store's | process memory; dumps stop at 512 MiB of N-Quads |
| More than one sqlib instance | yes | no |
| Write latency | a network round trip | in-process |
| Operational tooling | the store's own | copy a `.nq` file |
| Extra process to run | yes | no |

An external HTTP endpoint is the right answer when any one of durability
guarantees, backup and restore procedures, size beyond process memory, or more
than one reader is a requirement. `oxigraph-persistent` is the right answer when
none of them is and you would rather not run a second process.

## The entity cache

Every entity is read into memory at boot and served from there. The whole point
is that a route handler can call `repos.Query.get(id)` and get an answer without
awaiting anything, so resolving a query group's nodes, checking a reference or
filtering a list costs no SPARQL.

### The pieces

**`EntityRegistry.ts`** is the registry of entity types.
`LENS_BY_TYPE` maps each of 52 entity types to its repository, and `TTL_MS`
gives each type a cache lifetime.

**`CacheCoordinator.ts`** holds the state. Storage is decomposed — a
`Map<EntityType, EntityCache>` plus one `_idToType` index across all of them —
so a list of one type does not walk every entity. It handles loading,
refreshing, ephemeral entities and system-entity immutability, and it is the
only place a write both reaches the store and updates memory.

**`EntityRepositories.ts`** wraps the coordinator in a typed repository per
entity type. This is what feature code uses, usually through the
`withReposHandler` route helper: `repos.Query.get(id)`, `repos.Backend.list()`,
`repos.RuleSet.create(...)`.

**`MemoryCacheManager.ts`** is a thin facade over the coordinator, kept for the
older call sites and tests that predate the repositories. It delegates
everything. New code should use the repositories.

### Loading

`loadAll()` runs before any route is registered. It loads the system entities
first (see below), then, unless `CACHE_PRELOAD=false`, every registered type
from the store concurrently.

A type that fails to load logs the error and yields nothing rather than aborting
the boot: losing one type is recoverable, a server that will not start is not.
This is a real trade — a partially loaded cache looks like a partially empty
library — and the visible signal is the error log, not the API.

`get()` and `list()` throw if the cache has not loaded. `/health` reports
`status: "not_ready"` and answers `503` until it has.

### Staleness and refresh

Reads are stale-while-revalidate. `get(id)` returns the cached entity
immediately and, if that entity's type has a finite TTL and the entry is older
than it, starts a background re-read of that one entity. `list(type)` does the
same for the type as a whole, replacing every non-system, non-ephemeral entity
of that type with what the store returns. An in-flight refresh is tracked per id
and per type, so concurrent reads do not stack refreshes.

The TTLs encode the versioning model directly:

| Type | TTL |
| --- | --- |
| `QueryVersion`, `QueryGroupVersion`, `RuleVersion`, `DataBlockVersion`, `RuleSetVersion`, `DataGraphVersion`, `TupleSetVersion`, `ArgumentSetVersion`, `TestVersion`, `BenchmarkExperimentVersion`, `TestCase`, `TestCaseDataGraph`, `RuleSetNode`, `PatchNode` | infinite |
| `Query`, `Rule`, `RuleSet`, `DataBlock`, `DataGraph`, `TupleSet`, `Test` | 15s |
| `QueryGroup` | 30s |
| `BenchmarkExperiment` | 60s |
| `Library`, `Tag`, `Patch` | 120s |
| `Backend` | 180s |
| Anything unlisted | 60s |

Most version types never expire because they cannot change; the two ETL version
types are not listed and fall to the 60-second default. See
[versioning-and-immutability.md](versioning-and-immutability.md). `Patch` is
long but not infinite, because a patch's status can change and a revert
performed elsewhere would otherwise never be seen.

What the cache guarantees is therefore bounded: **your own writes are visible
immediately**, because a write updates the cache synchronously after the store
accepts it; **another process's writes become visible within that type's TTL**,
on the next read that finds the entry stale. Between a write elsewhere and the
next refresh, a read returns the previous value. With `CACHE_PRELOAD=false` the
background refresh paths are disabled entirely.

For the same reason, more than one sqlib process against one library store is
not a supported configuration: each has its own cache, and neither is told when
the other writes.

Within one process there is a change feed. `GET /events` is a Server-Sent Events
stream of "something changed" notifications, emitted by a single `onSend` hook
on mutating responses. Frames carry a notification, never the entity, so a
subscriber goes back through its normal fetch path — which is the path that also
refreshes concurrency tokens. Because the emitter is module-level, it reaches
subscribers in the same process only.

### Writes

`CACHE_WRITE_THROUGH` defaults to true, and with it on a write goes to the store
first and to memory second. `update()` then re-reads the entity from the store
and merges the caller's updates over what came back, so the cached copy reflects
whatever the store actually stored. Set it to `false` and the cache becomes the
only home for writes; this exists for tests, not for deployment.

`resolveExisting` is the exception to "reads are cache-only". A referential
check — does this IRI name an entity of an allowed type? — cannot be answered
from the cache alone under `CACHE_PRELOAD=false`, where a perfectly valid IRI
may be absent. It falls back to the store, trying each candidate type until one
answers.

### System entities

A small set of entities is shipped with the server rather than authored: the
system library and the system queries the persistence layer itself runs. They
are loaded from `packages/api/system-store/assets` at boot, their IRIs are known
up front, and the coordinator refuses to create, update or delete any of them —
`System entity <id> is immutable.` They are also skipped by every refresh path,
because there is no store copy to refresh from.

The system store exists to break a bootstrapping cycle: `SystemQueryRunner`
resolves its query text from the entity cache, and `loadAll()` is what fills the
cache. So the queries that load entities cannot themselves be entities loaded
that way. For the same reason, `EntityStore` generates its read and write SPARQL
from the compiled-in schemas and executes it directly rather than going through
`SystemQueryRunner`.

### Ephemeral entities

`addEphemeral` puts an entity in the cache and nowhere else. It is what the
playground uses: a rule version, data block version or ETL job that the user has
not saved is registered as an ephemeral entity, and the normal executor then
runs it exactly as it would run a stored one. No separate "unsaved" execution
path exists to drift from the saved one.

Ephemeral entities are excluded from refreshes, since there is nothing to
refresh from, and `delete` removes one from memory without touching the store.

### What the cache costs

The library is resident in memory twice over when the store is in-process — once
as quads in Oxigraph, once as JavaScript objects in the cache. `GET /metrics`
reports both: per-type entity counts and an estimated byte size for the cache,
and triple counts and memory use per Oxigraph store. That route requires
administrator access, because it exposes store contents and process internals.

## Patches and history

Writes to a *backend* — as opposed to writes to the library — can be derived
before they are applied and recorded after. `packages/rdf-delta` turns a SPARQL
update into the ground set of quads it would add and remove; see
[rdf-patch.md](rdf-patch.md). The resulting `Patch` is stored as an ordinary
entity alongside everything else, which reuses the authorization, cache and
route machinery and inherits the size limits above: a very large patch
serialised into an entity field is stored the same way a large data graph is.

Analytical questions over the log — as-of reconstruction, churn, hot subjects —
are answered by loading the log into a private DuckDB instance per call rather
than by keeping a materialised copy. `PatchLogService` gives the reason for that
instance being separate from ETL's: the log runs sqlib's own SQL and never a
caller's, so it takes the strictest capability profile and never inherits a
widening that ETL legitimately needs.

## Related

- [architecture.md](architecture.md) — where the persistence layer sits.
- [versioning-and-immutability.md](versioning-and-immutability.md) — why version
  entities never expire.
- [rdf-patch.md](rdf-patch.md) — deriving an update's effect.
- [reference/configuration.md](../reference/configuration.md) — every variable
  named here, with its default.
- [guides/running-and-configuring.md](../guides/running-and-configuring.md) —
  pointing a running server at a store.
- [guides/deploying.md](../guides/deploying.md) — volumes and shutdown for the
  container image.
