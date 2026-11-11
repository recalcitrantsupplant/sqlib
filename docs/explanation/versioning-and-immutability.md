# Versioning and immutability

Most things you write in sqlib exist in two forms. One is a stable, named
pointer with an IRI that does not change. The other is a series of numbered
versions that hold the content, and nothing edits a version after it is written.
This page explains the reasons for this model, what it gives you and what it
costs.

## The stable entity and its versions

A `Query` holds a name, a description, tags, an optional default backend and a
`currentVersion` link. It holds no SPARQL. A `QueryVersion` holds the SPARQL
text, the query type, the parameters found in it, and the inputs and outputs
inferred from it. It also holds a numeric `version` and an `isPartOf` link to
the query. `QueryGroup`, `RuleSet`, `Rule`, `DataBlock`, `DataGraph`,
`TupleSet`, `Test`, `ArgumentSet`, `EtlJob` and `BenchmarkExperiment` have the
same two parts.

The two parts answer two different questions:

- "Which query is this?" needs an identifier that stays the same after each
  edit. A tag, a search result, a link in a document and a member of a query
  group then continue to work.
- "What exactly ran?" needs an identifier that changes with each edit. If the
  content behind an identifier can change, the identifier does not say what
  ran.

An execution always names a version. When you ask sqlib to execute a `Query`, it
first resolves `currentVersion` and executes that version. Each run therefore
belongs to one immutable body of content.

## Freezing, and what a version accepts afterwards

A version is frozen when it is created. Each version writer sets
`immutable: true` in the payload it inserts, and each one has this comment:

> Frozen on create. A version is a snapshot: what it holds is what the reference
> to it means, so it is never created in a state where it could still change.
> `immutable` on the request body is ignored rather than honoured — there is no
> such thing as a mutable version.

A client therefore cannot choose `immutable` in a create request. The field is
in the schemas because older stored versions were made before freeze-on-create,
and some do not have it. A change from absent or false to true is still
accepted. A change in the other direction is not.

Two guards enforce this, at different levels.

`packages/api/src/lib/versionPatch.ts` guards the routes. `classifyVersionPatch`
divides a PATCH body into three parts:

- **Annotations**, which it applies: `comment`, and `immutable: true`.
- **System fields**, which it refuses with `400`: `id`, `$id`, `@type`,
  `version`, `isPartOf`. A change to one of these would give the version a new
  number or a new parent. That is a different error from an edit to the
  content, so it gets a different status code.
- **All other fields**, which are content. It refuses them with `409` and the
  message "Version is immutable; create a new version instead." The response
  lists the refused field names, so the caller can see which part of the body
  failed.

`immutable: false` is always refused with `409`. Each reference to a version
depends on the version staying frozen.

`packages/api/src/lib/immutability.ts` guards the cache layer.
`assertMutableEntity` runs inside `CacheCoordinator.update` and refuses each
write to a frozen version that changes more than annotations. It covers eight
types: `QueryVersion`, `QueryGroupVersion`, `RuleVersion`, `DataBlockVersion`,
`RuleSetVersion`, `BenchmarkExperimentVersion`, `DataGraphVersion` and
`TestVersion`. A write path that goes around the routes therefore still cannot
edit these types. Other types, such as `TupleSetVersion` and
`ArgumentSetVersion`, are frozen on create and guarded by `classifyVersionPatch`
at their routes. The cache-layer guard does not cover them.

### Content and annotations

The list of annotations is short. A change to `queryString` makes each
compatibility check that named the version out of date. A correction to a
comment, such as "this is the one that fixed the timeout bug", changes no check.
You can only check that a query group works with a *given* version of each of
its queries. If a version can change under a reference, each such check is
provisional.

Two fields look like annotations but are not on the list:

- Tags. No version schema has them. A tag goes on the stable entity.
- `canvasData`. It is part of the query group version payload. If it were an
  annotation, a drag of a node while you view an old version would rewrite that
  version with no warning.

## Pinning and floating

There are two ways to refer to content:

- A **pin** is a version IRI. It means the same content on each call, while
  that version exists.
- A **float** is the IRI of a stable entity. It means the current version of
  that entity at the time of the call.

The difference is most important for a caller that you do not control, such as
a deployed application, a scheduled job, or an agent that calls the MCP tools.
That caller cannot review what it runs before each run. With a float, the next
person who clicks Save in the web UI changes what the caller does: the shape of
the results, the parameters it must supply, the backend it reaches. The call
site gets no signal. With a pin, the caller runs the version that was reviewed,
and only an edit to the caller moves it to a new version.

A pin does not get fixes. sqlib does not choose for you. It supports both forms
and shows which one a reference uses. Argument sets and test subjects can pin a
version, so the result of a test can be reproduced. The MCP catalogue has reads
at version level and at entity level, so a caller can choose.

Composition always uses pins:

- A `QueryNode` in a query group holds the IRI of a query *version*.
- The `hasRule` and `hasDataBlock` arrays of a `RuleSetVersion` hold
  `RuleVersion` and `DataBlockVersion` IRIs. `createRuleSetVersion` checks the
  `@type` of each one, and refuses a parent IRI with an error message that says
  so.

A group or rule set version is therefore reproducible in itself. One node type
floats, and its name says so: `DynamicQueryNode` chooses its query at execution
time.

## Version numbers

`nextVersionNumber` reads the highest `version` among the versions of a parent,
and adds one. If you delete v2 of three versions, the next version is v4. sqlib
does not issue v3 again, because a reused number would make an identifier that
meant one thing start to mean another.

Version numbers are for people. The version routes of the API take the number
(`GET /queries/:id/versions/2`, `GET /rule-sets/:id/versions/2`). Execution,
composition and argument sets use the version IRI. A client that holds a
`currentVersion` IRI must look up its number in the version list to use a
numbered route.

Each versioned entity uses the same routes: `/<noun>/:id/versions` and
`/<noun>/:id/versions/:version`. Before the route-layer consolidation (review
decision D1), `queries`, `query-groups`, `argument-sets` and benchmarks used
`/v`. That path is removed, with no alias. One router
(`routes/versionedEntity.ts`) makes the CRUD routes, so these rules apply to
each noun:

- A missing entity gives 404 on each route, DELETE included. A version route
  checks for the parent first, and gives 404 if it is missing.
- PUT and version PATCH obey `If-Match`. A mismatch gives 412 with
  `{ error, expected, current }`.
- DELETE removes the entity and all its versions. If a saved version elsewhere
  pins one of them, DELETE gives 409, with `usedBy` listing the holders.
  Examples of a pin: a rule set version that names a rule version, a group node
  that names a query version, and an argument set or test case that names a
  data graph or tuple set version. A delete of one version follows the same
  rule, and moves the `currentVersion` of the entity to the highest remaining
  version.

## Save

The action that creates a version is **Save**. The button reads `Save v4`: the
verb and the number of the version that the click creates. Edits before Save are
a **draft**, and the browser saves them automatically. An amber dot in the
sidebar marks unsaved changes.

The button was earlier labelled "Publish". A new version is visible to the same
people who could already read the library, so the authorization boundary does
not move. sqlib keeps the word `publish` for the static export bundle, which is
sent to a place outside the server. The API function has always been
`saveNewVersion`.

## Consequences

**Editing.** You cannot edit saved content in place. To change a query, create a
version. Small corrections therefore make more versions. In return, no edit can
break a reference anywhere in the system.

**Cloning.** To make a variant of a version, create a new version, of the same
entity or of a new entity, from the old content. The server has no clone or
duplicate route. A client reads a version and posts its content as a new
version. The content is copied, so later changes to one copy do not affect the
other.

**Deleting.** `DELETE /queries/:id` removes one entity. It does not delete the
versions of the query. `queries.ts` records this, because it changes how
authorization works. The version routes match on `isPartOf` and do not look up
the query. A version whose parent is gone could otherwise be reached with no
check. The listing route filters by what the caller can read, and does not give
404. An unknown id therefore returns an empty list, and the response does not
show whether the id existed. For an operator, this means that a deleted query
leaves orphan version entities in the store.

**Moving.** To move a query to another library, change `isPartOf` on the stable
entity with `PUT /queries/:id`. A query must be part of exactly one library, and
the route refuses zero or more than one. Versions do not move, because they
belong to the query. Tags are checked against the library that the write leaves
in place. A move and a tag change in one request are therefore checked against
the destination library.

**Concurrency.** The stable entity is the part that changes, so it is the part
that needs optimistic concurrency. Entity reads carry `ETag` and
`Last-Modified` from `dateModified`. Writes obey `If-Match`, and a mismatch gives
`412` with the current representation. Versions need none of this.

**Caching.** Frozen content can be cached with no lifetime. `TTL_MS` in
`EntityRegistry.ts` gives each version type `Number.POSITIVE_INFINITY`. sqlib
reads a version into memory once and does not check it again. A stable parent
gets a short TTL: 15 seconds for `Query`, `Rule`, `RuleSet`, `DataGraph`,
`TupleSet` and `Test`. See [storage-and-caching.md](storage-and-caching.md).

## Related

- [concepts.md](../concepts.md): the entity terms.
- [storage-and-caching.md](storage-and-caching.md): how immutability sets the
  cache policy.
- [architecture.md](architecture.md): where versions are written and read.
- [guides/rest-api-walkthrough.md](../guides/rest-api-walkthrough.md): save
  and pin a version over HTTP.
- [reference/entity-model.md](../reference/entity-model.md): each entity type
  and its fields.
