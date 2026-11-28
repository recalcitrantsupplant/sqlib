# OGC services: OGC API Features services as their own items

Status: proposal, for review. Written 2026-11-28 against `main` at `201d79d`.
The mock is in the project files, at `ogc-services/mock.html`.

## Summary

An OGC service becomes an item of its own, on a new **OGC** entry in the
rail. It is account level, as a backend is. It does not belong to a library.
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

David stated these in the project thread on 2026-11-28:

1. Configure a service in the web app. Say which query answers which
   collection, and see the queryables of each collection.
2. Do not tie a service to a library. "Seems like an arbitrary restriction."
3. Do not make a service a backend type. The data source of a collection can
   be any backend.
4. Allow more than one service.

The coordinator added these from the same discussion:

5. Keep the `/ogc/` prefix. Leave the rest of the path free.
6. Pin the query versions in each service version, as published tools pin.
7. Apply a saved service without a restart.
8. Design query groups as collection sources. David decides whether to build
   them.

## What is there now

- A service is `/ogc/{library slug}`. One library is one service.
- A collection is a query version that carries an `ogc` object
  (`packages/tools/src/ogc.ts`, `OgcObject`). The object holds the mapping:
  the feature column, the geometry, the parameters that `limit`, `offset`,
  `bbox`, `datetime` and `skipGeometry` fill, and the queryables.
- The server collects the collections at startup
  (`collectOgcCollections` in `packages/api/src/lib/publishedTools.ts`). Each
  collection pins the version that is current at that time. A change takes
  effect at the next start.
- The routes are parametric (`/ogc/:slug/...` in
  `packages/api/src/server/ogcRoutes.ts`). A slug cannot hold `/`.
- The web app has no screen for the `ogc` object. The API is the only way to
  set it.
- PR #278 adds a map page to the browser demo. Its thread also plans CQL2
  `=` and `in` facets and a facet-values query, as new keys of the `ogc`
  object.

## Design

### Entities

Two new entity types, in the same store as backends:

| Entity | Holds |
| --- | --- |
| `OgcService` | `name`, `path`, `description`, `currentVersion`, the versions |
| `OgcServiceVersion` | `version`, `comment`, `collections` (a list), authorship. Immutable |

A collection is a JSON object in the version, in list order:

```json
{
  "collectionId": "stations",
  "source": "urn:sqlib:query-version:…",
  "backend": "urn:sqlib:backend:rail-features",
  "mapping": { "…the OgcObject of today, without collectionId…" }
}
```

- `source` is a query version IRI. With query groups, it can also be a query
  group version IRI.
- `backend` is required. The form fills it from the query's default backend.
- `mapping` is the `OgcObject` of today, with the facet keys from #278 when
  they merge. `collectionId` moves up one level, because the service owns the
  id.

I chose a JSON object over an entity for each collection. A collection has
no identity outside its version, and the mapping is already JSON on the
query version. Tell me if you want collections as entities, for the change
feed or for export.

### Paths

- A path is one to three segments, each `[a-z0-9][a-z0-9-]{0,62}`.
- No segment can be `collections`, `conformance`, `api`, `queryables` or
  `items`. A request then always splits into one service path and one OGC
  resource.
- Paths are unique. `/ogc/rail` and `/ogc/rail/2026` can both exist. The
  server matches the longest service path.
- The server registers one wildcard route, `/ogc/*`, in place of the
  `/ogc/:slug/...` routes.
- `SQLIB_OGC_BASE_URL` still sets the link base behind a proxy.

### Pinning and the live version

- A service version pins each collection's query version. A new query
  version does not change a service.
- The service screen marks a collection whose query has a newer version. A
  **Use v5** button on the row puts the new version in the draft. The save
  checks the mapping against v5, as today's version save does.
- The live version is the service's `currentVersion`. A save makes a new
  version and moves `currentVersion` to it. **Make live** on an older version
  moves it back.
- Services have no environments. Environments belong to one library, and a
  service can use many.

### Checks on save

The save refuses a version, with the collection id and the key, when:

- the source version is gone, or is not a SELECT;
- `checkOgcObject` finds a problem in the mapping;
- a slot that the mapping fills has `whenEmpty` set to `require` or
  `propagateEmpty`;
- the backend is gone;
- two collections have one id;
- a `cql2` collection's `configQuery` is not a query with a version.

These are the startup checks of today, moved to save time. Startup runs them
again, because a query or backend can be deleted after the save. A
collection that fails at startup is left out of its service, and the service
screen shows it with an error pill.

### Without a restart

The server keeps the services in one map. On a change event for an
`OgcService`, or a delete of a query, query version or backend, it rebuilds
that map (`subscribeChanges` in `packages/api/src/lib/changeEvents.ts`). The
routes read the map at each request.

I have not checked that the change feed reaches every instance when the API
runs as more than one process. The AWS demo runs one Fargate task, so it is
not affected now.

### Who can do what

- Administrators create, edit and delete services. This is the rule for
  backends (`requireAdmin` in `packages/api/src/routes/backends.ts`).
- Any caller who can reach the server reads the metadata routes, as today.
- An `items` call runs the pinned version through `POST /execute` with the
  caller's `Authorization`, as today. The caller needs `execute` on the
  query's library and `query:saved` on the backend. A service that draws on
  two libraries needs grants on both.

### Rail and screens

- **OGC** is a rail entry below the divider, after Backends. It is account
  level, so it does not change with the library switcher. The icon is
  `Map` from lucide.
- The sidebar lists services by name, with the path under each name.
- The service screen shows the URL with a copy button, the collections, the
  versions and an **Open map** link.
- Each collection row shows its title, id, query and version, library,
  backend, queryables and a map link.
- **Add collection** opens a picker of queries from every library, grouped
  by library. Picking a query opens the collection editor.
- The collection editor fills each mapping field from the query version's
  detected outputs and `VALUES` parameters. Each field is a menu of the
  variables that fit it. A form field never takes a free-typed variable
  name.
- The queryables table lists each `VALUES` parameter that no other field
  uses. A checkbox turns it into a queryable, with a type and a title.
- The OGC rail entry needs `FEATURE_OGC`. With the flag off, the entry is
  hidden.

The mock shows each of these screens.

### The `ogc` object on query versions

Today's library services keep working. I propose this path:

1. The OGC screen lists each library that serves collections today, with a
   **Convert** button. Convert makes a service with the library slug as its
   path, and copies each `ogc` object into a collection. It pins the version
   that is current now.
2. A service with the same path as a library takes over that path. The
   library service is then not served.
3. A later release removes the `ogc` key from query versions, and removes
   the library services.

The Rail demo seed (`demo/libraries/rail/seed.json`) changes to seed a
service at `/ogc/rail` with Stations and Lines. The browser demo map page
from #278 keeps its URL.

### Facets from #278

The facet keys are part of the mapping, so they move into the collection
with no change. The collection editor gets a **Facets** section when they
merge. The facet-values query is a query version that the service pins,
like `configQuery`.

## Query groups as sources

This needs a server change, and I have not built it. You decide whether to
build it in this work.

What changes:

1. **Outputs.** The server must know the columns of a group's result. I
   would read them from the end node's query version.
2. **Inputs.** `groupVersionInputs` already gives the start node's ports as
   tables, and the `LIMIT` and `OFFSET` parameters of all nodes.
3. **Backend.** A group run takes no `backendId`, because each node names
   its own. The collection has no backend field for a group.
4. **Paging.** A `LIMIT` on an early node does not page the group's result.
   A later node can join more rows or fewer. The check must require that
   the `limit` and `offset` parameters are on the end node's query.
5. **One feature.** The feature column must be a start node port, so that
   the one-feature route can bind it.
6. **Closed slots.** The `whenEmpty` check reads the start node's ports.

I estimate one to two days with tests. I think the paging rule in item 4 is
the risk, because a group with a join after the paged node returns pages of
the wrong size, with no error.

## Questions for David

1. Account level, as a backend is, with administrators only for writes. Or
   do you want a grant on each service, so that a non-administrator can
   edit one?
2. Pin each query version, with a **Use v5** button. Or do you also want a
   collection to follow an environment of its library, such as prod?
3. Convert today's library services with a button, and remove the `ogc` key
   in a later release. Or remove it now, and convert the stored objects in a
   migration at startup?
4. Build query groups as sources now, or later?
5. Paths of up to three segments. Is three enough?

## Work, in order

1. `OgcService` and `OgcServiceVersion` schemas, routes and tests.
2. The service map, the wildcard route and the rebuild on change.
3. The Convert action, and the Rail seed as a service.
4. The rail entry, the service screen and the collection editor.
5. Guide: update `docs/guides/publishing-ogc-collections.md`.
6. If you say yes: query groups as sources.
