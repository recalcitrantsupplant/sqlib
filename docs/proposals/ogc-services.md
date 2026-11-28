# OGC services: OGC API Features services as their own items

Status: proposal, for review. Written 2026-11-28 against `main` at `201d79d`,
with PR #278 (the map page and facets) in view. It changes how
[ogc-api-features.md](ogc-api-features.md) configures a service. The GeoJSON
serializer, the route plugin, the `values` and `cql2` modes and the auth rules
of that design stay as they are.

This text merges two drafts of 2026-11-28. David answered most of their
questions the same day. The decisions are in [Decisions](#decisions), and
the questions that remain are in [Open questions](#open-questions).

The mock is in the project files, at `ogc-services/mock.html`, with
screenshots beside it.

## Summary

An OGC service becomes an item of its own, on a new **OGC** entry in the
rail. It is account level, as a backend is, and does not belong to a library.
A service has a path under `/ogc/`, such as `/ogc/rail` or `/ogc/rail/2026`.
It lists collections. Each collection names a query version from any library,
a backend, and the type of each queryable.

The web app gets a screen to create and edit services. A save takes effect at
once, with no restart. Each service is versioned, and each version pins the
query versions that its collections run.

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="210" font-family="sans-serif" font-size="12">
  <rect x="10" y="20" width="170" height="60" rx="6" fill="#e7f1ff" stroke="#0d6efd"/>
  <text x="95" y="45" text-anchor="middle">OgcService</text>
  <text x="95" y="63" text-anchor="middle" font-size="11">path /ogc/rail</text>
  <rect x="10" y="130" width="170" height="60" rx="6" fill="#e7f1ff" stroke="#0d6efd"/>
  <text x="95" y="155" text-anchor="middle">OgcServiceVersion v3</text>
  <text x="95" y="173" text-anchor="middle" font-size="11">immutable</text>
  <line x1="95" y1="80" x2="95" y2="130" stroke="#495057" marker-end="url(#a)"/>
  <text x="100" y="108" font-size="11">currentVersion</text>
  <rect x="240" y="130" width="160" height="60" rx="6" fill="#f8f9fa" stroke="#6c757d"/>
  <text x="320" y="155" text-anchor="middle">collection "stations"</text>
  <text x="320" y="173" text-anchor="middle" font-size="11">queryables</text>
  <line x1="180" y1="160" x2="240" y2="160" stroke="#495057" marker-end="url(#a)"/>
  <text x="186" y="152" font-size="11">lists</text>
  <rect x="460" y="100" width="170" height="44" rx="6" fill="#d1e7dd" stroke="#218838"/>
  <text x="545" y="126" text-anchor="middle">QueryVersion v4 (Rail)</text>
  <rect x="460" y="160" width="170" height="44" rx="6" fill="#fff3cd" stroke="#b26b00"/>
  <text x="545" y="186" text-anchor="middle">Backend</text>
  <line x1="400" y1="150" x2="460" y2="124" stroke="#495057" marker-end="url(#a)"/>
  <text x="408" y="128" font-size="11">pins</text>
  <line x1="400" y1="172" x2="460" y2="180" stroke="#495057" marker-end="url(#a)"/>
  <text x="414" y="192" font-size="11">runs on</text>
  <defs><marker id="a" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#495057"/></marker></defs>
</svg>
```

## Needs

David stated these in the project on 2026-11-28:

1. Configure a service in the web app. Say which query answers which
   collection, and see the queryables of each collection.
2. Decouple a service from libraries. One service per library "seems like an
   arbitrary restriction".
3. Do not make a service a backend type. The data source of a collection can
   be any backend.
4. Allow any number of services.

These follow from the same discussion:

5. Keep the `/ogc/` prefix, so a service path cannot collide with `/queries`,
   `/execute` or a route that a later release adds.
6. Pin the query versions in each service version.
7. Apply a saved service without a restart.
8. Remove the `ogc` object of query versions and the library services. sqlib
   is before 1.0, so it keeps no compatibility code and no migration.

## What is there now

- A service is `/ogc/{library slug}`. One library is one service.
- A collection is a query version that carries an `ogc` object
  (`OgcObject` in `packages/tools/src/ogc.ts`). The object holds the
  mapping: the feature column, the geometry, the parameters that `limit`,
  `offset`, `bbox`, `datetime` and `skipGeometry` fill, and the queryables.
- No screen shows or edits the `ogc` object. It is set through
  `POST /queries/{id}/versions`, or in the Rail demo through
  `demo/libraries/rail/ogc/*.json` and the seed's `ogcFile` key.
- The server collects the collections at startup (`collectOgcCollections` in
  `packages/api/src/lib/publishedTools.ts`). Each collection runs the version
  that is current in the deployment's environment at that time. A change
  takes effect at the next start.
- The routes are fixed patterns (`/ogc/:slug/...` in
  `packages/api/src/server/ogcRoutes.ts`). They look the slug up in a map
  built at startup. A slug cannot hold `/`.

PR #278 adds to the `values` mode. The design keeps these, and moves them
from the query version to the collection:

- A collection can name a `valuesQuery`, a SELECT that returns `?property`
  and `?value`. David does not want counts (2026-11-28), so `?count` and
  `x-counts` are removed.
- The queryables document carries an `enum` for each queryable that the
  values query lists.
- Every `values` queryable takes several values: OR within one queryable,
  AND across queryables. There is no `multiple` flag.
- The CQL2 subset is an `and` of `=` and `in` clauses. The service declares
  no CQL2 conformance class for it.
- The `bbox` filter uses `geof:sfIntersects` on a polygon made with `BIND`.

## Decisions

David decided these in the project on 2026-11-28:

| Question | Decision |
| --- | --- |
| Scope | Account level, as proposed, to start with |
| Pinning | Pin each query version. Show the newer-version icon when a newer version exists |
| The old `ogc` object | Remove it, the library services and all compatibility code. No migration |
| Query groups as sources | Later |
| Serving without a restart | Do it when there is a clean way. A restart is acceptable when there is none |
| `uri` queryables | Advertise `format: uri`, and bind the value as an IRI |
| Counts | None. The values query gives an optional `enum` only |
| Variable roles | Reserved variable names, no stored mapping |
| Paths | One to three segments |
| `datetime` names | `?datetimeStart` and `?datetimeEnd` |
| `enum` values | Public, for every caller |

## Design

### Entities

Five new entity types, in the same store as the other entities. In the
default `sqlite` mode, that is the library SQLite file, one row for each
entity (`docs/explanation/storage-and-caching.md`).

| Entity | Holds |
| --- | --- |
| `OgcService` | `name`, `description`, `path`, `currentVersion`. No `isPartOf` |
| `OgcServiceVersion` | `version`, `comment`, `collections` (a list of `OgcCollection`), `isPartOf` (its service), authorship. Immutable |
| `OgcCollection` | `collectionId`, `title`, `description`, `queryVersion`, `backend`, `featureBase`, `valuesQuery`, `configQuery`, `pageSize`, `pageSizeMax`, `extent`, `queryables`, `isPartOf` (its service version), `position` |
| `OgcCollectionSet` | `collectionsQuery`, `queryVersion` (the items query), `collectionBase`, `featureBase`, `backend`, `valuesQuery`, `pageSize`, `pageSizeMax`, `queryables`, `isPartOf` (its service version), `position`. See [Collection sets](#collections-from-a-query) |
| `OgcQueryable` | `name`, `type`, `title`, `isPartOf` (its collection or set) |

`OgcService` and `OgcServiceVersion` use `registerVersionedEntityRoutes`
(`packages/api/src/routes/versionedEntity.ts`), as the other versioned types
do. An `OgcCollection` is written with its version, as a query group's nodes
are written with their version.

The links to other entities are IRI triples with `@references`:

- `queryVersion`: a `QueryVersion`, pinned.
- `backend`: a `Backend`. The form fills it from the query's default backend.
- `valuesQuery`: a `QueryVersion`, pinned (#278).
- `configQuery`: a `QueryVersion`, pinned (`cql2` mode).

Every field is a plain RDF value or link. Nothing is stored as JSON,
because the variable roles come from reserved names (see
[Reserved variable names](#reserved-variable-names)). `extent` is four
numbers and an optional time interval.

### Reserved variable names

A query's variable names say what each variable does. David proposed this
on 2026-11-28. It replaces today's `feature`, `geometry`, `params`,
`outputs` and `omit` keys.

| Name | Where | Role |
| --- | --- | --- |
| `?feature` | output, and alone in a `VALUES` clause | The feature IRI. The one-feature route binds it |
| `?geometry` | output | A `geo:wktLiteral` or `geo:geoJSONLiteral`. Without it, features have `"geometry": null` |
| `?minx ?miny ?maxx ?maxy` | one `VALUES` clause | `bbox`, in CRS84 |
| `?datetimeStart ?datetimeEnd` | one `VALUES` clause | `datetime`. Either can be unbound |
| `?skipGeometry` | `VALUES` | `true` when the client sends `skipGeometry=true` |
| `LIMIT 0001`, `OFFSET 0002` | the query's only `LIMIT` and `OFFSET` parameters | The page |
| `?filter`, `?cursor` | `VALUES` | `cql2` mode. A query that declares `?filter` is in `cql2` mode |
| `?numberMatched`, `?nextCursor` | output | `cql2` mode: the total and the next cursor |
| `?collection` | `VALUES` | Collections from a query: the collection IRI |

Every other `VALUES` variable that is alone in its clause is a queryable,
with the variable name as its name. Every other output column is a feature
property. A queryable must also be an output, so a client can see the value
it filtered on.

Three things are not in the query text, so the collection stores them:

1. **The type of each queryable.** The type decides how a value is parsed
   and bound: `uri` binds an IRI, `integer` an `xsd:integer`, `string` a
   plain literal. The editor proposes the type from the values query's
   result when it lists the property, and else proposes `string`.
2. **The feature base.** The IRI prefix removed from `?feature` to make the
   feature id in URLs.
3. **Optional display and paging values.** The title of each queryable, the
   page size and largest page, and the extent.

`checkOgcObject` becomes a check of the query against the reserved names.
The geometry sources key (`geometrySources`) and the `point` form are
removed. A query with longitude and latitude columns builds a WKT point
with `BIND`.

With `@references`, the backend's **Used by** list
(`GET /backends/:id/references`) and the delete checks cover services with
no special code. I have not checked whether `versionPins.ts` reads
`@references` or keeps its own list of pinning fields.

`collectionId` is unique in the service. Two services may both have a
`stations` collection.

### Collections from a query

A service entry can also be a **query that lists collections**, called a
collection set in the schema (`OgcCollectionSet`). A query lists the
collections, so a new `geo:FeatureCollection` in the store appears with no
edit to the service. David asked for this on 2026-11-28.

A collection set holds:

- a **collections query**: a SELECT that returns `?collection`, `?title`, and
  optionally `?description` and the extent columns `?minx ?miny ?maxx ?maxy`;
- an **items query**: a SELECT that declares `VALUES ?collection { UNDEF }`;
- a `collectionBase` IRI. The collection id is the collection IRI without
  it, as the feature id is;
- the queryable types, the feature base, a `backend` and an optional values
  query. These apply to every collection of the set.

```sparql
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX dcterms: <http://purl.org/dc/terms/>
SELECT ?collection ?title ?description WHERE {
  ?collection a geo:FeatureCollection ; dcterms:title ?title .
  OPTIONAL { ?collection dcterms:description ?description }
}
ORDER BY ?collection
```

The items query reads members with `?collection rdfs:member ?feature`, or
whatever pattern the data uses.

How the routes use it:

- `/collections` runs each collections query as the caller, and lists the
  rows after the stored collections. A caller sees only the collections that
  their grants let them read.
- `/collections/{id}` and its `items` and `queryables` bind `?collection` to
  `collectionBase` + `{id}`, and run the items query.
- A data change needs no service save and no reload.
- An id that a stored collection already has is left out of the set's rows,
  and the service screen shows a problem line.
- The values query can declare `VALUES ?collection { UNDEF }` too. It then
  gives the values of each collection. Without it, the values are the same
  for every collection of the set.

The queryable types are stored once for the set, because they describe the
items query, not the data.

The service screen shows a collection set as one row, with the number of
collections it returned for the viewer. The collection editor gets a
**One collection | Collections from a query** switch at the top.

### Paths

- A path is one to three segments. Each segment matches
  `[a-z0-9][a-z0-9-]{0,62}`.
- No segment can be `collections`, `conformance`, `api`, `queryables` or
  `items`. A request URL then splits in one way only, into a service path
  and an OGC resource.
- Paths are unique in the deployment. A save with a path that another
  service has gets `409`. `/ogc/rail` and `/ogc/rail/2026` can both exist,
  and the server matches the longest service path.
- One wildcard route, `/ogc/*`, replaces the `/ogc/:slug/...` routes.
- `SQLIB_OGC_BASE_URL` still sets the base of the links behind a proxy.

### Pinning and the live version

- A service version pins each collection's query version. A new query
  version does not change a service.
- When the query has a newer version, the collection row and the version
  menu in the collection editor show the newer-version icon. This is the
  `Info` icon with the tooltip "Newer version available", from
  `VersionedEntitySelector.vue`.
- In edit mode, a **Use v5** button on the row puts the new version in the
  draft. The save checks v5 against the reserved names and the stored
  queryables.
- The live version is the service's `currentVersion`. A save makes a new
  version and moves `currentVersion` to it. **Make live** on an older version
  moves it back.
- Services have no environments, because an environment belongs to one
  library and a service can use many.

### Checks on save

The save refuses a version with `400` and the key path, such as
`collections[1].queryables.zone`, when:

- a pinned version is gone, or `queryVersion` is not a SELECT;
- the query breaks a reserved-name rule, such as `?feature` missing from the
  outputs or `?minx` outside the bbox clause;
- a stored queryable is not a `VALUES` variable of the query;
- a slot that the service fills has `whenEmpty` set to `require` or
  `propagateEmpty`;
- the backend is gone;
- two collections have one id;
- `valuesQuery` does not return `?property` and `?value`;
- `configQuery` is set on a collection that is not in `cql2` mode.

These are the startup checks of today, moved to save time. The pins stop a
pinned version from going away. A backend can still be deleted. The server
then leaves that collection out and records a problem line.
`GET /ogc-services/{id}/problems` lists the lines for one service, and the
service screen shows them.

### Serving without a restart

This works in the full server too, because a saved service adds no route.
One wildcard route, `/ogc/*`, serves every service. It looks the path up in
a map at each request. A save changes the map, and the route stays the same.
The published tools need a restart for a different reason: the MCP server
lists its tools when a client connects, and a tool list is fixed for a
session.

- `registerOgcRoutes` holds the map. `reload()` runs `collectOgcServices()`,
  which replaces `collectOgcCollections()`, and swaps the map. A request in
  flight keeps the map it started with.
- `reload()` runs on a change event for an `OgcService`, an
  `OgcServiceVersion` or a `Backend` (`subscribeChanges` in
  `packages/api/src/lib/changeEvents.ts`). A query edit needs no reload,
  because the collections run pinned versions.
- `indexFields`, the cached `luc:config` result of a `cql2` collection, is
  cleared for each collection that a reload changes.
- The browser-only demo runs the same server code in a Worker, so the same
  reload applies there.

Two things I have not checked:

- The change feed comes from a hook on the HTTP routes
  (`registerChangeFeedHook`). An import does not use those routes, so it
  calls `reload()` directly.
- I have not checked that the feed reaches every process when the API runs
  as more than one. The AWS demo runs one Fargate task. If it does not, the
  fallback is a restart, which David accepted.

### Who can do what

- Administrators create, edit and delete services. This is the rule for
  backends (`requireAdmin` in `packages/api/src/routes/backends.ts`).
- Any caller who can reach the server reads the metadata routes, as today.
- An `items` call runs the pinned version through `POST /execute` with the
  caller's `Authorization`, as today. The caller needs `execute` on the
  query's library and `query:saved` on the backend. A service that draws on
  two libraries needs grants on both.
- The `queryables` route runs `valuesQuery` as the service, with no caller
  grants, so every caller sees the same `enum` values, as they see the rest
  of the metadata.

### Queryable types and values

The `queryables` route advertises each queryable as JSON Schema
(`QUERYABLE_SCHEMA` in `packages/tools/src/ogc.ts`). A `uri` queryable is
`{ "type": "string", "format": "uri" }`.

OGC API Features Part 3 (OGC 19-079r2, version 1.0, approved 2024-07-26)
covers this in clause 6:

- Recommendation 1 C (`/rec/queryables/queryables-schema`): "Properties that
  represent a URI SHOULD be represented as a string with format `uri` or
  `uri-reference`." This is a recommendation (SHOULD), not a requirement.
- Requirement 3 C: each property other than a spatial one "SHALL include a
  `type` member". Requirement 3 F gives `date-time` or `date` for temporal
  properties.
- Recommendation 1 F and H: `enum` SHOULD be given where it applies, for
  strings and for integers that are enumerated values.

The client sends a string in each case. The server reads the stored type
and binds the term. A `uri` value becomes an IRI in the `VALUES` row. JSON
Schema's `uri` is an absolute URI, and sqlib binds it as an IRI. The two are
close, and an IRI with non-ASCII characters is the case where they differ.

The values query is a sqlib addition, and is not in the OGC specs. It is a
SELECT that returns `?property` and `?value`. The author writes it, as a
`UNION` of one `SELECT DISTINCT` for each queryable with a discrete set of
values. A queryable that the query does not list, such as a date or a free
number, gets no `enum`, and a client can filter on any value. The
`queryables` route adds `enum` for each listed queryable. `enum` is standard
JSON Schema, and Part 3 recommends it.

```sparql
PREFIX : <https://example.org/rail/>
SELECT DISTINCT ?property ?value WHERE {
  { ?s a :Station ; :zone ?value . BIND("zone" AS ?property) }
  UNION
  { ?s a :Station ; :stepFree ?value . BIND("stepFree" AS ?property) }
}
```

### Export and MCP

- A library export does not carry services, because a service is outside
  every library. `GET /ogc-services/{id}/export` exports one service, with
  the IRIs of the versions and backends it names. An import refuses a path
  clash with `409`, and refuses a reference to a version that the target
  does not hold.
- The MCP server lists and reads services with the generated tools of the
  versioned types (`ogcServices_list`, `ogcServices_get` and the version
  tools).

### Rail and screens

- **OGC** is a rail entry below the divider, after Backends. It is account
  level, so it does not change with the library switcher. The icon is `Map`
  from lucide. The entry needs `FEATURE_OGC`, and shows to administrators
  only, as Access does.
- The sidebar lists services by name, with the path under each name.
- The service screen shows the URL with a copy button, the collections, the
  versions, the conformance classes and an **Open map** link.
- Each collection row shows its title, id, query and version, library,
  backend, geometry type, queryables and a map link.
- **Add collection** opens a picker of SELECT queries from every library,
  grouped by library.
- The collection editor shows the roles it found in the query from the
  reserved names: feature, geometry, bbox, datetime, page. A missing role
  shows as a dash.
- The queryables table lists each queryable that the query declares, with
  a type menu and a title. With a values query, each row shows the number
  of values in its `enum`.
- A **Preview** runs the first page and draws it.
- A query that a service uses shows the service and collection on the query
  screen, with a link.

The mock shows each of these screens except the last.

### What is removed

sqlib is before 1.0 and no deployment depends on the old form, so this work
removes it with no compatibility code:

- The `ogc` key of `QueryVersionSchema`, its JSON shape, and its handling in
  `QueryVersionWriter.ts`, `toolObject.ts` and the queries routes.
- `collectOgcCollections` and the library services at `/ogc/{library slug}`.
- The `ogcFile` key of the Rail seed and `demo/libraries/rail/ogc/*.json`.
  The seed gets one `ogcServices` entry, a service at `/ogc/rail` with
  Stations and Lines, and `demo/scripts/seed-library.mjs` writes it when
  `DEMO_OGC=true`. The map page from #278 keeps its URL.
- The parts of `docs/guides/publishing-ogc-collections.md` and
  `docs/proposals/ogc-api-features.md` that describe the `ogc` object on a
  query version.

## Open questions

1. **Collections from a query in step 1, or later.** They add one entity
   kind, the collections query and the `?collection` binding. I think they
   fit in step 1, because the routes change there anyway.

## Build steps

Each step is one pull request.

1. **The entities and the routes.** `OgcService`, `OgcServiceVersion` and
   `OgcCollection`, `/ogc-services`, the save check, pins, export and import.
   `collectOgcServices()`, the path matching and the wildcard route. The
   removals in [What is removed](#what-is-removed), and the Rail seed.
   Tests: the save check, pins, path clashes and reserved words, and the
   CITE Part 1 run on the Rail service.
2. **Serving without a restart.** `reload()`, the change subscription and the
   problems route. Test: create, edit and delete a service, and read its
   routes after each write with no restart.
3. **The web app.** The rail entry, the service screen, the collection
   editor and the link on the query screen.
4. **Guide.** Rewrite `docs/guides/publishing-ogc-collections.md`.

Step 1 waits for #278 to merge, because both change `ogcRoutes.ts` and the
`ogc` object.

## Later work

- Query groups as collection sources. This needs a server change:
  1. The server reads a group's result columns from the end node's query
     version.
  2. `groupVersionInputs` already gives the start node's ports as tables,
     and the `LIMIT` and `OFFSET` parameters of all nodes.
  3. A group run takes no `backendId`, because each node names its own.
  4. A `LIMIT` on an early node does not page the group's result, because a
     later node can join more rows or fewer. The check must require the
     `limit` and `offset` parameters on the end node's query.
  5. The feature column must be a start node port, for the one-feature
     route.
- Range facets for numbers and dates.
- The same item model for published tools, so that `/tools/` can have more
  than one service per library.
