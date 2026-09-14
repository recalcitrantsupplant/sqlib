# Versioning and immutability

Almost everything you author in sqlib exists twice over: as a stable, named
pointer whose IRI never changes, and as a series of numbered versions that hold
the content and are never edited after they are written. This page explains why
the model is shaped that way, what it buys, and what it costs.

## The stable entity and its versions

A `Query` carries a name, a description, tags, an optional default backend, and
a `currentVersion` link. It carries no SPARQL. A `QueryVersion` carries the
SPARQL text, the query type, the parameters detected in it and the inputs and
outputs inferred from it, plus a numeric `version` and an `isPartOf` link back
to the query. The same split applies to `QueryGroup`, `RuleSet`, `Rule`,
`DataBlock`, `DataGraph`, `TupleSet`, `Test`, `ArgumentSet`, `EtlJob` and
`BenchmarkExperiment`.

The reason the split exists is that two different questions are being asked of
the same object, and they want opposite answers. "Which query is this?" wants an
identifier that survives every edit, so a tag, a search result, a link in a
document and a member of a query group all keep working. "What exactly ran?"
wants an identifier that cannot survive an edit, because an answer that can
change is not an answer.

Execution always names a version. If you ask sqlib to execute a `Query`, the
first thing it does is resolve `currentVersion` and execute that. So a run is
always attributable to one immutable body of content.

## Freezing, and what a version accepts afterwards

A version is frozen at the moment it is created. Every version writer sets
`immutable: true` in the payload it inserts, and each of them carries the same
comment:

> Frozen on create. A version is a snapshot: what it holds is what the reference
> to it means, so it is never created in a state where it could still change.
> `immutable` on the request body is ignored rather than honoured — there is no
> such thing as a mutable version.

`immutable` in a create request is therefore not a choice a client makes. The
field exists in the schemas because versions predate freeze-on-create and older
stored versions may lack it; the transition from absent-or-false to true is
still accepted, and it is the only direction that is.

Two guards enforce this, at different depths.

`packages/api/src/lib/versionPatch.ts` guards the route edge.
`classifyVersionPatch` splits a PATCH body into three parts:

- **Annotations**, which are applied: `comment`, and `immutable: true`.
- **System fields**, which are refused with `400`: `id`, `$id`, `@type`,
  `version`, `isPartOf`. Patching one of these is not an attempt to edit the
  snapshot but to renumber or re-parent it, which is a different mistake and
  gets a different status code.
- **Everything else**, which is content, and is refused with `409` and the
  message "Version is immutable; create a new version instead." The refused
  field names come back in the response so a caller can see which part of the
  body was rejected.

`immutable: false` is refused outright with `409`: a version cannot be unfrozen,
because unfreezing would undo the guarantee every reference to it relies on.

`packages/api/src/lib/immutability.ts` guards the cache layer.
`assertMutableEntity` runs inside `CacheCoordinator.update` and refuses any
write to a frozen version that is not annotation-only. It covers eight types
(`QueryVersion`, `QueryGroupVersion`, `RuleVersion`, `DataBlockVersion`,
`RuleSetVersion`, `BenchmarkExperimentVersion`, `DataGraphVersion`,
`TestVersion`), so a write path that bypasses the routes still cannot edit one
of those. Types outside that set — `TupleSetVersion` and `ArgumentSetVersion`
among them — are frozen on create and guarded by `classifyVersionPatch` at their
routes, but not by the cache-layer guard.

### The line between content and annotation

The allowlist is short and the argument for it is specific: changing
`queryString` invalidates every compatibility check that named the version,
while correcting a comment — "this is the one that fixed the timeout bug" —
invalidates nothing. Whether a query group works with the query versions it
composes can only be established for a *given* version, and a version that
changes under a reference makes every such check provisional.

Two fields are deliberately excluded even though they look like annotations.
Tags are excluded because no version schema carries them: tagging targets the
stable entity, not the snapshot. `canvasData` is excluded because it rides in
the query group version payload, so allowing it would mean that dragging a node
while viewing an old version silently rewrites that version.

## Pinning and floating

Two ways of referring to content follow from the split.

A **pin** is a version IRI. It always means the same content, on every call, for
as long as that version exists.

A **float** is a stable entity IRI. It means whatever that entity's current
version is at the time of the call.

The distinction matters most for a caller you do not control. A deployed
application, a scheduled job or an agent calling the MCP tools is executing
something whose behaviour it did not choose and cannot review before each run. A
float means that whoever next presses Save in the web UI changes what that
caller does — the shape of results, the parameters it must supply, the backend
it reaches — with no signal at the call site. A pin means the caller keeps
running exactly what was reviewed, and moving it forward is a deliberate edit to
the caller.

The trade is the usual one: a pin does not pick up a fix. sqlib does not resolve
this for you; it makes both available and makes the difference visible. Argument
sets and test subjects can pin a version so that a test's verdict is
reproducible, and the MCP catalogue exposes both version-level and
entity-level reads so a caller can choose.

Composition is pinned rather than floating throughout. A `QueryNode` in a query
group holds a query *version* IRI, not a query IRI. A `RuleSetVersion`'s
`hasRule` and `hasDataBlock` arrays hold `RuleVersion` and `DataBlockVersion`
IRIs, and `createRuleSetVersion` checks the `@type` of each and refuses a parent
IRI with an explicit message. A group or rule set is therefore itself a
reproducible artifact, not a list of pointers to moving targets. The one node
type that floats does so by name: `DynamicQueryNode` chooses its query at
execution time.

## Version numbers

`nextVersionNumber` reads the highest `version` among the versions that name a
parent and adds one. It does not count them. Deleting v2 of three versions still
yields v4 rather than reissuing v3, because a reused version number would make
an identifier that used to mean one thing quietly mean another.

Version numbers are for people. The API's version routes take the number —
`GET /queries/:id/v/2`, `GET /rule-sets/:id/versions/2` — while execution,
composition and argument sets all use the version IRI. A client that holds a
`currentVersion` IRI and wants the numbered route has to look the number up from
the version list.

The path segment is not uniform: `queries`, `query-groups` and `argument-sets`
use `/v`, while `rules`, `rule-sets`, `data-blocks`, `data-graphs`,
`tuple-sets` and `tests` use `/versions`. This is an inconsistency in the route
surface rather than a distinction that means anything.

## Saving, not publishing

The act that creates a version is called **Save**, and the button reads `Save
v4` — the verb plus the number of the version the click will create. Edits
before that point autosave to the browser and are a **draft**; the sidebar's
amber dot means unsaved changes.

The word was deliberately changed from "Publish". Nothing becomes public when a
version is written: it is visible to exactly whoever could already read the
library, and the authorization boundary does not move. `publish` is instead
reserved for the static export bundle, which really does go somewhere. The
codebase never used the other word either — the API function has always been
`saveNewVersion`.

## Consequences

**Editing.** There is no in-place edit of saved content. Changing a query means
creating a version. The cost is version churn for small corrections; the benefit
is that no reference anywhere in the system can be invalidated by an edit.

**Cloning.** Making a variant of a version is creating a new version, of the
same entity or of a new one, with the old content as its starting point. There
is no server-side clone or duplicate route; a client reads a version and posts
its content as a new one. Because the content is copied rather than referenced,
the two then evolve independently and neither can disturb the other.

**Deleting.** `DELETE /queries/:id` removes one entity. It is not a cascade: the
query's versions outlive it. `queries.ts` records this explicitly, because it
changes how authorization has to work — the version routes match on `isPartOf`
and never look the query up, so a version whose parent no longer resolves would
otherwise be reachable with no check at all. The listing route filters by what
the caller may read rather than answering 404, so an unknown id keeps returning
an empty list instead of revealing whether it ever existed. The practical
consequence for an operator: deleting a query leaves orphaned version entities
in the store.

**Moving.** A query moves between libraries by changing `isPartOf` on the
stable entity with `PUT /queries/:id`. A query must be part of exactly one
library, and the route rejects zero or more than one. Versions do not move,
because they belong to the query rather than to the library directly. Tags are
checked against the containment the write leaves behind, so moving and
retagging in one request is judged against the destination library rather than
the source.

**Concurrency.** Because the stable entity is the mutable half, it is the half
that needs optimistic concurrency. Entity reads carry `ETag` and
`Last-Modified` derived from `dateModified`, and writes honour `If-Match` with a
`412` and the current representation on mismatch. Versions need none of this.

**Caching.** Frozen content is cacheable without a lifetime.
`TTL_MS` in `EntityRegistry.ts` gives every version type
`Number.POSITIVE_INFINITY`, so a version is read from memory once and never
revalidated, while its stable parent gets a short TTL (15 seconds for `Query`,
`Rule`, `RuleSet`, `DataGraph`, `TupleSet` and `Test`). See
[storage-and-caching.md](storage-and-caching.md).

## Related

- [concepts.md](../concepts.md) — the entity vocabulary.
- [storage-and-caching.md](storage-and-caching.md) — how immutability turns into
  a cache policy.
- [architecture.md](architecture.md) — where versions are written and read.
- [guides/rest-api-walkthrough.md](../guides/rest-api-walkthrough.md) — saving
  and pinning a version over HTTP.
- [reference/entity-model.md](../reference/entity-model.md) — every entity type
  and its fields.
