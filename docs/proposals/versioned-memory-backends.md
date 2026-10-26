# Versioned in-memory backends: Oxigraph with a SQLite patch log

Status: proposed. Not implemented.

## Decision

An in-memory Oxigraph backend can be marked versioned. Callers read and write it
with ordinary SPARQL queries and updates, and do nothing in their queries to
record history. SQLIB records the net effect of every update as a patch in a
SQLite database, and from that log it can:

- rebuild any past state of the backend as a separate, read-only backend;
- answer what one node looked like at a past point without rebuilding anything;
- list every change that touched a node, as `git log` does for a file;
- restore the live backend to a past point, as a new change on top of the log;
- rebuild the in-memory store after a restart.

The pattern applies when SQLIB is the only writer to the store. That holds for
an in-memory Oxigraph backend, because the store lives in SQLIB's process. It
does not hold for an HTTP backend that other clients write to; see
[Other backends](#other-backends).

## Why

Without this, an application that wants history has to write it into its own
updates. The rdfproject repository does that: each of its 23 write templates
states its change three times, once into the current graph and once each into
an add graph and a delete graph per transaction, and computes by hand which
values actually changed. The record is what the template intended, not what the
update did. On its GLAM project this produced two kinds of wrong record:

- three transactions that deleted and re-added the same triple, so the triple
  sat in both halves of one transaction;
- 23 transactions, from a `decide` command, whose add graph claimed a
  `confirmedBy` triple that an earlier transaction had already written. A
  `FILTER` inside a `GRAPH` block compared against a variable bound outside it,
  so the guard never matched.

Replaying that log still reproduced the current graph, so neither showed up as
corruption. Both are impossible when the store, not the query, says what
changed.

## Write path

For each update to a versioned backend, under a lock held per backend:

1. Derive the patch: the update's net effect against the store as it stands.
2. If the patch is empty, release the lock and answer that nothing changed.
   Nothing is recorded.
3. Commit the patch to SQLite with status `pending`.
4. Apply the patch's quads to the Oxigraph store directly, with `delete` and
   `add`, not as SPARQL.
5. Mark the patch `applied`, release the lock, and answer with the patch's
   sequence number.

Applying the derived quads in step 4 instead of running the update a second
time is correct only because of the lock. The derivation in step 1 evaluated
the update's `WHERE` clause, including any refusal conditions, against the same
state the quads then land on.

Updates waiting for the lock wait in memory, with their requests open. If the
process stops, those callers get an error and retry. A retry is safe when the
caller sends an idempotency token: SQLIB refuses a token it has already
recorded for that backend, so a write that landed before the failure does not
land twice.

### Net effect

With `S` the store and `D*` and `I*` the delete and insert templates
instantiated against it, a patch holds

```
deletions = (S ∩ D*) \ I*
additions = I* \ S
```

so a patch never deletes a quad that is absent or adds one that is present, and
a quad an update deletes and re-inserts is in neither half. `derivePatch` in
`packages/rdf-delta` computes this already. Everything else in this proposal is
new.

A consequence used throughout the read side: for any one quad, its operations in
the log strictly alternate between add and delete.

### Patch metadata

A patch records:

| Field | Source |
| --- | --- |
| `seq` | SQLIB, one more than the backend's previous patch |
| `token` | The caller, optional; unique per backend |
| `actor` | The caller, or the authenticated client |
| `command`, `message` | The caller, optional; what the change was, in the caller's words |
| `recorded_at` | SQLIB, when the patch was committed |
| `state_hash` | SQLIB; see [State hash](#state-hash) |
| `status` | `pending`, `applied` or `failed` |

`command` and `message` are what make a history readable. An application that
records "Decide, by david" reads as a log of decisions; one that records only
quads reads as a dump.

## Storage

A SQLite database per backend, beside the backend's checkpoints.

| Option | Assessment |
| --- | --- |
| SQLite | Transactional appends, a `UNIQUE` constraint for tokens, indexes for the lookups below, one file, and online backup. Synchronous Node bindings (`better-sqlite3`, or `node:sqlite`) let a commit happen inside the lock without yielding to other requests. |
| Append-only files of RDF Patch | A good export format. As the record, time travel needs an index over them, which is what SQLite provides. |
| DuckDB | Suited to analytical reads over the log, such as churn per patch. It handles many small transactional writes less well than SQLite, so it reads the log; it does not write it. |
| Postgres | The same schema, if SQLIB runs as more than one process. A per-backend lock held in one process does not cover another. |

Schema:

```sql
CREATE TABLE patch (
  seq         INTEGER PRIMARY KEY,
  token       TEXT UNIQUE,
  actor       TEXT,
  command     TEXT,
  message     TEXT,
  recorded_at TEXT NOT NULL,
  state_hash  BLOB NOT NULL,
  status      TEXT NOT NULL            -- pending | applied | failed
);

CREATE TABLE quad (
  hash         BLOB PRIMARY KEY,       -- 128-bit hash of the canonical N-Quads line
  nquad        TEXT NOT NULL,
  subject_hash BLOB NOT NULL
);
CREATE INDEX quad_subject ON quad (subject_hash);

CREATE TABLE op (
  quad_hash BLOB NOT NULL,
  seq       INTEGER NOT NULL,
  op        INTEGER NOT NULL,          -- 1 add, -1 delete
  PRIMARY KEY (quad_hash, seq)
);
CREATE INDEX op_seq ON op (seq);

CREATE TABLE patch_node (
  node_hash BLOB NOT NULL,
  seq       INTEGER NOT NULL,
  PRIMARY KEY (node_hash, seq)
);
```

Each distinct quad is stored once in `quad`. A quad's identity is a 128-bit hash
of its canonical N-Quads line; at 64 bits, collisions become likely somewhere
around four billion distinct quads.

### Blank nodes

A blank node label identifies a node only within one patch, so its hash means
nothing across patches and time travel cannot follow it. A versioned backend
replaces blank nodes with generated IRIs when they are written (skolemisation),
or refuses updates that would store them. Which of the two is an open question.

### State hash

Each patch stores a hash of the whole state it produced:

```
state_hash(n) = state_hash(n-1) + Σ hash(added) − Σ hash(deleted)   (mod 2^128)
```

It is maintained per patch at no cost beyond the quad hashes, and it answers
three questions:

- whether the store matches the log: hash every quad in the store and compare
  with the latest patch, in one full pass, run occasionally;
- whether a rebuilt past state is right: a store rebuilt for `seq` T must hash to
  patch T's `state_hash`;
- whether two points in history hold the same state.

It detects accidental divergence. It is not a defence against deliberately
crafted collisions.

## Durability and recovery

The SQLite commit in step 3 of the write path is the point at which a write is
durable. The Oxigraph store is a materialised view of the log, so after a restart
SQLIB rebuilds it from the newest checkpoint plus every applied patch after it.
The store needs no persistence of its own.

A patch left `pending` by a crash is resolved before the backend accepts writes:
if its deletions are absent from the rebuilt store and its additions are
present, it landed and is marked `applied`; otherwise it is marked `failed`.
Because patches are net effects, that check is exact. No new patch is derived
for a backend until every pending patch on it is resolved, because a patch is
only correct relative to the state before it.

## Checkpoints

A checkpoint is an N-Triples dump of one named graph at a known `seq`, written
to a file or blob. Checkpoints bound the work of a restart and of rebuilding an
old state, and they set how much history can be discarded: operations before a
checkpoint can be deleted, after which that checkpoint is the earliest reachable
state.

A dump blocks the process for its duration (see [Limits](#limits)). To keep
that off the live store:

- checkpoint per graph, and only the graphs whose quads changed since the last
  checkpoint;
- take checkpoints from a second store in a worker thread, which replays the log
  from its own cursor and dumps without stalling the main process. This doubles
  memory use.

A bulk load is written as a checkpoint, not as one large patch: a patch of
millions of additions makes the log larger without making any past state more
reachable.

## Reading the past

### Rolling back is a set operation

Because each quad's operations alternate, a quad's state changed between `seq`
T and now exactly when it has an odd number of operations after T. Its last
operation says how, and undoing it means applying the inverse. Order does not
matter, because each quad is handled independently:

```sql
-- What to apply to the current state to reach seq :t.
-- In SQLite, a bare column beside MAX() takes its value from the row holding
-- the maximum, so `op` is each quad's last operation.
SELECT quad_hash, -op AS apply, MAX(seq)
FROM op
WHERE seq > :t
GROUP BY quad_hash
HAVING COUNT(*) % 2 = 1;
```

Rolling forward from a checkpoint at `seq` C to T is the same query over
`C < seq <= :t`, applying `op` instead of `-op`.

### Whole-state reads: a snapshot backend

Arbitrary SPARQL cannot be evaluated over a log; the state has to exist as a
store. SQLIB builds one on request:

1. Choose the cheaper start: the current state and the operations after T, or
   the nearest checkpoint at or before T and the operations from it to T.
2. Load that start into a new Oxigraph store and apply the set from the query
   above.
3. Check the store's state hash against patch T's.
4. Register the store as a read-only backend with its own id, a time to live,
   and a place under a memory budget.

Building from a checkpoint file costs a load and never dumps the live store.
Applying the set costs milliseconds for thousands of operations. The load
dominates, and at a few million quads it is seconds to tens of seconds; that
figure is an estimate to be measured.

`?asAt=<time>` on any query to a versioned backend is a convenience over the
same mechanism. SQLIB resolves the time to the last patch at or before it,
reuses a snapshot backend for that `seq` or builds one, and returns the resolved
`seq` in a response header so the result can be reproduced. Snapshots are cached
by `seq`, not by time, so two times with no patch between them share one.

### One node at a point in time

What one node looked like at T needs no snapshot. It is that node's quads whose
last operation at or before T was an add, a group-by over that node's
operations only:

```sql
SELECT q.nquad
FROM (
  SELECT o.quad_hash, o.op, MAX(o.seq)
  FROM op o JOIN quad q ON q.hash = o.quad_hash
  WHERE q.subject_hash = :node AND o.seq <= :t
  GROUP BY o.quad_hash
) last
JOIN quad q ON q.hash = last.quad_hash
WHERE last.op = 1;
```

### What changed between two points

The quads with an odd number of operations in `T1 < seq <= T2`, read from the
log. No snapshot is needed.

### Restoring the live backend

A restore to T is a new patch at the next `seq`, holding the set from the
rollback query, written through the same write path. The log is never truncated,
so a restore can itself be undone.

## History of a node

### Index nodes, not entities

When a patch is committed, `patch_node` gets one row for every IRI that appears
in the patch as a subject or as an object. This needs no knowledge of the data's
model. "Every change that touched x" is a range scan over `patch_node`, joined to
`patch` for the metadata.

The unit shown is the patch. If one update added and removed several properties
of x, the history lists that patch once and shows all of it, with x's lines
marked.

Some IRIs appear in a large share of patches, such as a class that is the object
of every `rdf:type`. Their entries make large ranges. Skipping `rdf:type`
objects keeps them out; querying such a node otherwise returns a long list.

### Closure at read time

Entities are not defined in advance. A history request names how far to reach
from x:

| Closure | Patches included |
| --- | --- |
| Depth 0 (default) | Patches that mention x |
| Depth 1 | Also patches that mention any IRI x has ever linked to, found from the log: every IRI object of every operation with x as subject |
| Generated IRIs | Also patches touching the IRIs that replaced x's blank nodes, to any depth |
| Named predicates | Also patches touching nodes reached from x through predicates the caller lists |

The closure for a history is computed over the log, not the current state,
because a node x linked to in the past is part of x's past even if x no longer
links to it. A SPARQL query over a state, current or as of T, remains the way to
define what x is at one point in time.

### Views

| View | Answers | Source |
| --- | --- | --- |
| Log | Which patches touched x | `patch_node`, `patch` |
| Show | What patch n did | `op` for `seq` n |
| Blame | Which patch added each of x's current quads | For each current quad of x, the `seq` of its last add |
| Node at T | What x looked like at T | The query above |

A patch shown for one node reads best grouped by subject, then by predicate:

```
412 · decide · david · 3 Oct 2026 10:41
  wp-87
    lifecycle    ready → accepted
    confirmedBy  + david
```

Within one predicate, one value removed and one added shows as a change; values
only added or only removed show as `+` and `−`; several of each show as two
lists, since a predicate's values are a set and have no pairing.

## Secondary sinks

Exports, blob backups and analytical copies read the log from their own cursor:
the `seq` they last processed. They may lag. The store SQLIB derives patches
against may not, because every patch is derived from the state the previous one
left; so that store is applied inside the lock and is never a secondary sink.

## Limits

Oxigraph in Node runs as WebAssembly, and its limits set the size this pattern
fits:

| Limit | Effect | Basis |
| --- | --- | --- |
| A 4 GiB heap | The live store, plus any snapshot built in the same process, must fit | The 32-bit WebAssembly memory model |
| A full dump fails above about 6M quads | Checkpoints of a larger graph cannot be taken | Measured; recorded in `packages/rdf-delta/src/blobSnapshot.ts` |
| A dump blocks the process | About 16 ms per MB at 0.7 MB, 42–48 ms per MB above 100 MB | Measured; same file |

The practical ceiling is about 3 to 5 million quads per backend, leaving room for
checkpoints and snapshots. That is an estimate. Building snapshots in a worker,
with its own heap, raises how many can exist at once.

Native Oxigraph, in its own process, removes the WebAssembly limits. The store
is then outside SQLIB's process, and the arrangement is the single-writer case
below.

The SQLite log does not constrain this range: an operation row is tens of bytes,
and tens of millions of rows are within what SQLite handles.

## Other backends

| Backend | What applies |
| --- | --- |
| Remote store with SQLIB as its only writer, such as Fuseki with an endpoint that applies RDF Patch | The same write path, with step 4 sending the patch to the store. It needs the store to apply one patch in one transaction, and nothing else writing to it; a state-hash check against the store detects a write that went around SQLIB. |
| Remote store with other writers | Patches can be derived and logged for backup, but a write landing between derivation and execution makes a patch wrong, so the log must be paired with periodic full snapshots and checked against them by state hash. No rollback. |
| Large stores | The store keeps its own change log. SQLIB can read and present it, which is a separate design. |

## Before implementing

Measure, on data shaped like a real project at 1M, 3M and 5M quads:

- memory per quad in the WebAssembly store;
- load time from N-Triples;
- dump time;
- time to rebuild from a checkpoint plus a log of 10,000 and 100,000 patches.

These replace the estimates under [Limits](#limits) and
[Whole-state reads](#whole-state-reads-a-snapshot-backend).

## Open questions

- Skolemise blank nodes on write, or refuse them.
- How this log relates to the `Patch` entities SQLIB already stores in its
  library store: replace them, feed them, or stay separate.
- Whether an empty patch with a token should record the token, so that a retry
  after the state changes cannot apply a write the first attempt did not.
- Retention: how long to keep operations behind the oldest checkpoint.
- Memory budget and eviction policy for snapshot backends.
