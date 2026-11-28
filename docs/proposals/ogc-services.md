# OGC services: OGC API Features services as their own items

Status: proposal, for review. Written 2026-11-28 against `main` at `201d79d`,
with PR #278 (the map page and facets) in view. It changes how
[ogc-api-features.md](ogc-api-features.md) configures a service. The GeoJSON
serializer, the route plugin, the `values` and `cql2` modes and the auth rules
of that design stay as they are.

This text merges two drafts of 2026-11-28. The first draft made a service a
library item. This one makes it account level, after David asked to decouple
services from libraries. Where the drafts differ, the open questions name both
choices.

The mock is in the project files, at `ogc-services/mock.html`, with
screenshots beside it.

## Summary

An OGC service becomes an item of its own, on a new **OGC** entry in the
rail. It is account level, as a backend is, and does not belong to a library.
A service has a path under `/ogc/`, such as `/ogc/rail` or `/ogc/rail/2026`.
It lists collections. Each collection names a query version from any library,
a backend, and the mapping that turns the query's rows into features.

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
  <text x="320" y="173" text-anchor="middle" font-size="11">mapping</text>
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
8. Design query groups as collection sources. David decides whether to build
   them.

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

PR #278 adds to the `values` mode. This design keeps each of these as it is:

- A collection can name a `valuesQuery`, a SELECT that returns `?property`,
  `?value` and an optional `?count`.
- The queryables document carries an `enum` and `x-counts` for each
  queryable, from that query.
- Every `values` queryable takes several values: OR within one queryable,
  AND across queryables. There is no `multiple` flag.
- The CQL2 subset is an `and` of `=` and `in` clauses. The service declares
  no CQL2 conformance class for it.
- The `bbox` filter uses `geof:sfIntersects` on a polygon made with `BIND`.

## Design

### Entities

Two new entity types, made with `registerVersionedEntityRoutes`
(`packages/api/src/routes/versionedEntity.ts`), as the other versioned
types are:

| Entity | Holds |
| --- | --- |
| `OgcService` | `name`, `description`, `path`, `currentVersion`. No `isPartOf` |
| `OgcServiceVersion` | `version`, `comment`, `collections` (JSON), `isPartOf` (its service), authorship. Immutable |

The path is on `OgcService`, so it is the same in every version.

`collections` is a JSON array, stored as the version's `tool` object is
(`rdf:JSON` with a `@jsonShape`). Each entry is today's `ogc` object with
three keys added:

```jsonc
{
  "collectionId": "stations",
  "queryVersion": "urn:sqlib:queryversion:…",   // the pinned version
  "backend": "urn:sqlib:backend:rail-features",
  "title": "Stations",
  "mode": "values",
  "feature": { "var": "feature", "base": "https://example.org/rail/" },
  "geometry": "geom",
  "params": { "limit": "1", "offset": "2", "bbox": ["minx", "miny", "maxx", "maxy"], "skipGeometry": "skip" },
  "queryables": { "name": { "var": "name", "type": "string", "title": "Name" } },
  "valuesQuery": "urn:sqlib:queryversion:…",    // optional, from #278, pinned
  "pageSize": { "default": 10, "max": 100 }
}
```

- `queryVersion` is a query version IRI. With query groups, it can also be a
  query group version IRI.
- `backend` is required. The form fills it from the query's default backend.
- `valuesQuery` and `cql.configQuery` name query versions, pinned in the
  same way.
- `collectionId` is unique in the service. Two services may both have a
  `stations` collection.

The service version holds a pin on each version it names, so those versions
cannot be deleted while the service version exists
(`packages/api/src/lib/versionPins.ts`).

I chose a JSON array over an entity for each collection. A collection has no
identity outside its version, and the mapping is JSON on the query version
today.

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
- The service screen marks a collection whose query has a newer version. A
  **Use v5** button on the row puts the new version in the draft. The save
  checks the mapping against v5.
- The live version is the service's `currentVersion`. A save makes a new
  version and moves `currentVersion` to it. **Make live** on an older version
  moves it back.
- Services have no environments, because an environment belongs to one
  library and a service can use many. A deployment that sets
  `SQLIB_DEFAULT_ENVIRONMENT` serves each service's `currentVersion`.

### Checks on save

The save refuses a version with `400` and the key path, such as
`collections[1].queryables.zone.var`, when:

- a pinned version is gone, or `queryVersion` is not a SELECT;
- `checkOgcObject` finds a problem in the mapping;
- a slot that the mapping fills has `whenEmpty` set to `require` or
  `propagateEmpty`;
- the backend is gone;
- two collections have one id;
- `valuesQuery` does not return `?property` and `?value`;
- a `cql2` collection's `configQuery` is not a query version.

These are the startup checks of today, moved to save time. The pins stop a
pinned version from going away. A backend can still be deleted. A reload then
leaves that collection out and records a problem line.
`GET /ogc-services/{id}/problems` lists the lines for one service, and the
service screen shows them.

### Serving without a restart

The server keeps the services in one map, held by `registerOgcRoutes`.
`reload()` runs `collectOgcServices()`, which replaces
`collectOgcCollections()`, and swaps the map. A request in flight keeps the
map it started with.

`reload()` runs on a change event for an `OgcService`, an
`OgcServiceVersion` or a `Backend` (`subscribeChanges` in
`packages/api/src/lib/changeEvents.ts`). Query edits do not need a reload,
because the collections run pinned versions. `indexFields`, the cached
`luc:config` result of a `cql2` collection, is cleared for each collection
that a reload changes.

Two things I have not checked:

- The change feed comes from a hook on HTTP routes
  (`registerChangeFeedHook`). I have not checked that imports and the
  migration publish events. If they do not, they call `reload()` directly.
- I have not checked that the feed reaches every process when the API runs
  as more than one. The AWS demo runs one Fargate task.

### Who can do what

- Administrators create, edit and delete services. This is the rule for
  backends (`requireAdmin` in `packages/api/src/routes/backends.ts`).
- Any caller who can reach the server reads the metadata routes, as today.
- An `items` call runs the pinned version through `POST /execute` with the
  caller's `Authorization`, as today. The caller needs `execute` on the
  query's library and `query:saved` on the backend. A service that draws on
  two libraries needs grants on both.
- The `queryables` route runs `valuesQuery` as the caller, as #278 does. A
  caller who may not run it gets the queryables without `enum`.

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
- The collection editor fills each mapping field from the version's detected
  outputs and `VALUES` parameters. Each field is a menu of the variables that
  fit it. No field takes a typed variable name.
- The queryables table lists each `VALUES` parameter that no other field
  uses. A checkbox makes it a queryable, with a type and a title. With a
  `valuesQuery`, each row shows the number of values.
- A **Preview** runs the first page and draws it.
- A query that a service uses shows the service and collection on the query
  screen, with a link.

The mock shows each of these screens except the last.

### Migration from the `ogc` object

At startup, when no `OgcService` exists and a query version carries an `ogc`
object, the server makes one service for each library with a slug:

- The path is the library slug, so `/ogc/{library slug}` keeps working. The
  name and description are the library's.
- Each query whose current version has an `ogc` object becomes a collection.
  The collection pins that version, and its backend is the query's default
  backend.

After that, a query version save that sends `ogc` gets `400`. The message
names the service routes. The Rail seed (`demo/libraries/rail/seed.json`)
replaces `ogcFile` on its two queries with one `ogcServices` entry, and
`demo/scripts/seed-library.mjs` writes it when `DEMO_OGC=true`. The map page
from #278 keeps its URL.

## Query groups as sources

This needs a server change. You decide whether to build it in this work.

1. **Outputs.** The server must know the columns of a group's result. It
   reads them from the end node's query version.
2. **Inputs.** `groupVersionInputs` already gives the start node's ports as
   tables, and the `LIMIT` and `OFFSET` parameters of all nodes.
3. **Backend.** A group run takes no `backendId`, because each node names its
   own. A group collection has no backend field.
4. **Paging.** A `LIMIT` on an early node does not page the group's result,
   because a later node can join more rows or fewer. The check requires the
   `limit` and `offset` parameters on the end node's query.
5. **One feature.** The feature column must be a start node port, so that
   the one-feature route can bind it.
6. **Closed slots.** The `whenEmpty` check reads the start node's ports.

I estimate one to two days with tests. I think item 4 is the risk. A group
with a join after the paged node returns pages of the wrong size, with no
error.

## Open questions

Each question gives the choice of this text first.

1. **Scope.** Account level, with collections from any library and
   administrators only for writes. The first draft made a service a library
   item, with the library's grants, export and environments, and queries from
   that library only.
2. **Pinning.** Pin each query version, with a **Use v5** button. The first
   draft let a collection follow its query's version in the environment, with
   a pin as an option.
3. **Paths.** One to three segments, with reserved words and a wildcard
   route. The first draft allowed one segment, such as `rail-2026`.
4. **IRI values.** A `uri` queryable binds an IRI from the string the client
   sends, as today. The other choice binds a string, and the query converts
   it with `BIND(IRI(…))`, which most stores run more slowly.
5. **Values for anonymous callers.** The `valuesQuery` runs as the caller,
   so an anonymous caller sees `enum` only when the anonymous principal may
   run it. The other choice makes the values public, with the rest of the
   metadata.
6. **The old `ogc` object.** Migrate at startup, then refuse `ogc` on query
   version saves. The other choice keeps reading it for one release.
7. **Query groups.** Build them as sources now, or later.

## Build steps

Each step is one pull request.

1. **The entities and the routes.** `OgcService` and `OgcServiceVersion`,
   `/ogc-services`, the save check, pins, export and import.
   `collectOgcServices()`, the path matching and the wildcard route. The
   migration and the Rail seed. Tests: the save check, pins, path clashes and
   reserved words, and the CITE Part 1 run on the migrated Rail service.
2. **Serving without a restart.** `reload()`, the change subscription and the
   problems route. Test: create, edit and delete a service, and read its
   routes after each write with no restart.
3. **The web app.** The rail entry, the service screen, the collection
   editor and the link on the query screen.
4. **Guide.** Update `docs/guides/publishing-ogc-collections.md`.
5. **Query groups as sources**, if David says yes.

Step 1 waits for #278 to merge, because both change `ogcRoutes.ts` and the
`ogc` object.

## Later work

- Range facets for numbers and dates.
- The same item model for published tools, so that `/tools/` can have more
  than one service per library.
