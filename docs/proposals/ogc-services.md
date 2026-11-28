# OGC services: an OGC API Features service made of queries

Status: proposal, for review. Written 2026-11-28 against `main` at `201d79d`,
with PR #278 (the map page) in view. It replaces the way
[ogc-api-features.md](ogc-api-features.md) configures a service. The GeoJSON
serializer, the `/execute` call for each request and the auth rules of that
design stay.

The design took its shape from David's answers in the project on
2026-11-28. They are in [Decisions](#decisions). The mock is in the project
files, at `ogc-services/mock.html`.

## Summary

An OGC service is an item of its own, on a new **OGC** entry in the rail. It
is account level, as a backend is. It has a path under `/ogc/`, such as
`/ogc/rail` or `/ogc/rail/2026`.

A service is five queries and a backend. Each OGC resource is answered by
one query:

| Route | Query |
| --- | --- |
| `/collections` | **Collections**: one row for each collection |
| `/collections/{collectionId}` | **Collection**: the row of one collection |
| `/collections/{collectionId}/items` | **Items**: one row for each feature, one page |
| `/collections/{collectionId}/items/{featureId}` | **Item**: the row of one feature |
| `/collections/{collectionId}/queryables` | **Queryables**: one row for each queryable, or for each value of one |

The author writes any SPARQL in these queries. Reserved variable names tell
the server what each variable does. The service stores no other mapping.

The landing page, `/conformance` and `/api` are built by the server from the
service and its queries.

A new collection in the data, such as a new `geo:FeatureCollection`, appears
in the service with no edit and no restart.

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200" font-family="sans-serif" font-size="12">
  <rect x="10" y="70" width="150" height="56" rx="6" fill="#e7f1ff" stroke="#0d6efd"/>
  <text x="85" y="94" text-anchor="middle">OgcServiceVersion</text>
  <text x="85" y="112" text-anchor="middle" font-size="11">/ogc/rail, v3</text>
  <rect x="250" y="10" width="170" height="26" rx="5" fill="#d1e7dd" stroke="#218838"/>
  <text x="335" y="28" text-anchor="middle">Collections query v2</text>
  <rect x="250" y="44" width="170" height="26" rx="5" fill="#d1e7dd" stroke="#218838"/>
  <text x="335" y="62" text-anchor="middle">Collection query v2</text>
  <rect x="250" y="78" width="170" height="26" rx="5" fill="#d1e7dd" stroke="#218838"/>
  <text x="335" y="96" text-anchor="middle">Items query v5</text>
  <rect x="250" y="112" width="170" height="26" rx="5" fill="#d1e7dd" stroke="#218838"/>
  <text x="335" y="130" text-anchor="middle">Item query v5</text>
  <rect x="250" y="146" width="170" height="26" rx="5" fill="#d1e7dd" stroke="#218838"/>
  <text x="335" y="164" text-anchor="middle">Queryables query v1</text>
  <rect x="490" y="78" width="140" height="44" rx="6" fill="#fff3cd" stroke="#b26b00"/>
  <text x="560" y="104" text-anchor="middle">Backend</text>
  <line x1="160" y1="98" x2="250" y2="23" stroke="#495057"/>
  <line x1="160" y1="98" x2="250" y2="57" stroke="#495057"/>
  <line x1="160" y1="98" x2="250" y2="91" stroke="#495057"/>
  <line x1="160" y1="98" x2="250" y2="125" stroke="#495057"/>
  <line x1="160" y1="98" x2="250" y2="159" stroke="#495057"/>
  <text x="180" y="190" font-size="11">pins each version</text>
  <line x1="420" y1="91" x2="490" y2="100" stroke="#495057"/>
  <text x="430" y="78" font-size="11">runs on</text>
</svg>
```

## Needs

David stated these in the project on 2026-11-28:

1. Configure a service in the web app, and see its queryables.
2. Do not tie a service to a library.
3. Do not make a service a backend type.
4. Allow any number of services.
5. Make the collections queries too: collections, collection, items and
   item. People write any SPARQL, with reserved names.
6. Serve the queryables endpoint, with `enum` for queryables that have a
   discrete set of values, and no counts.
7. Remove the `ogc` object of query versions and the library services. sqlib
   is before 1.0, so it keeps no compatibility code and no migration.

## Decisions

David decided these on 2026-11-28:

| Question | Decision |
| --- | --- |
| Scope | Account level, to start with |
| Collections | From queries: collections, collection, items, item |
| Pinning | Pin each query version. Show the newer-version icon when a newer version exists |
| Variable roles | Reserved variable names. No stored mapping |
| `uri` queryables | Advertise `format: uri`, and bind the value as an IRI |
| `enum` | Optional, from a query the author writes. No counts |
| `enum` values | Public, for every caller |
| Paths | One to three segments |
| `datetime` names | `?datetimeStart` and `?datetimeEnd` |
| The old `ogc` object | Remove it and the library services. No migration |
| Query groups | Later |
| Restart | Serve a saved service with no restart where there is a clean way |
| JSON-LD | An opt-in context, served in a `Link` header |

## What is there now

- A service is `/ogc/{library slug}`. One library is one service.
- A collection is a query version that carries an `ogc` object
  (`OgcObject` in `packages/tools/src/ogc.ts`). The object names the
  variables for the feature, the geometry, `bbox`, `datetime`, paging and
  the queryables.
- No screen shows or edits the `ogc` object.
- The server collects the collections at startup (`collectOgcCollections` in
  `packages/api/src/lib/publishedTools.ts`). A change takes effect at the
  next start.
- PR #278 adds a values query to a collection. It returns `?property` and
  `?value`, and gives each listed queryable an `enum`. A `values`
  queryable takes several values: OR within one queryable, AND across
  queryables. The CQL2 subset is an `and` of `=` and `in` clauses.

## Design

### Entities

Two new entity types, in the same store as the other entities. In the
default `sqlite` mode, that is the library SQLite file
(`docs/explanation/storage-and-caching.md`). Both use
`registerVersionedEntityRoutes` (`packages/api/src/routes/versionedEntity.ts`).

| Entity | Holds |
| --- | --- |
| `OgcService` | `name`, `description`, `path`, `currentVersion`. No `isPartOf` |
| `OgcServiceVersion` | `collectionsQuery`, `collectionQuery`, `itemsQuery`, `itemQuery`, `queryablesQuery`, `backend`, `pageSize`, `pageSizeMax`, `comment`, `isPartOf` (its service), authorship. Immutable |

- Each `...Query` field is a link to a `QueryVersion`, with `@references`.
  The service version pins it.
- `queryablesQuery` is optional. The other four are required.
- One query can fill two fields. A collections query that also declares
  `VALUES ?collectionId { UNDEF }` can be the collection query too. The same
  holds for items and item.
- `backend` is a link to a `Backend`. Every query of the service runs on it.
- `pageSize` and `pageSizeMax` are numbers, 10 and 1000 by default. The
  largest allowed is 10000.

Every field is a plain RDF value or link, except the optional JSON-LD
context (see [JSON-LD context](#json-ld-context-opt-in)).

### Reserved variable names

A variable name says what the variable does. A name that a query does not
use is a feature the service does not offer. For example, an items query
without `?minx` has no `bbox` filter.

**Collections and collection queries**

| Name | Where | Role |
| --- | --- | --- |
| `?collectionId` | output. In the collection query, also alone in a `VALUES` clause | The id in URLs |
| `?title`, `?description` | output | Shown to clients |
| `?minx ?miny ?maxx ?maxy` | output | The spatial extent, in CRS84 |
| `?datetimeStart ?datetimeEnd` | output | The temporal extent |

**Items and item queries**

| Name | Where | Role |
| --- | --- | --- |
| `?collectionId` | alone in a `VALUES` clause | The collection of the request |
| `?featureId` | output. In the item query, also alone in a `VALUES` clause | The feature id in URLs, as a string |
| `?geometry` | output | A `geo:wktLiteral` or `geo:geoJSONLiteral`. Without it, features have `"geometry": null` |
| `?minx ?miny ?maxx ?maxy` | one `VALUES` clause | `bbox`, in CRS84 |
| `?datetimeStart ?datetimeEnd` | one `VALUES` clause | `datetime`. Either can be unbound |
| `?skipGeometry` | alone in a `VALUES` clause | `true` when the client sends `skipGeometry=true` |
| `LIMIT 0001`, `OFFSET 0002` | the query's only `LIMIT` and `OFFSET` parameters | The page. The server asks for one more row, to know whether there is a next page |
| `?numberMatched` | output | The total, from the first row. Optional |
| `?filter`, `?cursor` | alone in a `VALUES` clause | `cql2` mode. An items query that declares `?filter` is in `cql2` mode |
| `?nextCursor` | output | `cql2` mode: the cursor of the next page |

Every other `VALUES` variable of the items query that is alone in its clause
is a queryable, named by the variable. Every other output column is a
feature property.

The item query has no queryables, no `bbox` and no paging.

**Queryables query**

| Name | Where | Role |
| --- | --- | --- |
| `?collectionId` | alone in a `VALUES` clause, optional | The collection of the request |
| `?property` | output | The queryable's name, the same as its variable in the items query |
| `?type` | output, optional | `string`, `number`, `integer`, `boolean`, `date`, `date-time` or `uri`. `string` when unbound |
| `?title` | output, optional | Shown to clients |
| `?value` | output, optional | One value. The values of a property make its `enum` |

```sparql
PREFIX : <https://example.org/rail/>
SELECT DISTINCT ?property ?type ?title ?value WHERE {
  { BIND("name" AS ?property) BIND("string" AS ?type) BIND("Name" AS ?title) }
  UNION
  { ?s a :Station ; :zone ?value .
    BIND("zone" AS ?property) BIND("integer" AS ?type) BIND("Zone" AS ?title) }
  UNION
  { ?s a :Station ; :stepFree ?value .
    BIND("stepFree" AS ?property) BIND("boolean" AS ?type) BIND("Step-free" AS ?title) }
}
```

A property with no `?value` rows gets no `enum`, so a client can filter on
any value. Use that for dates and free numbers. A queryable of the items
query that the queryables query does not list is a `string` with no `enum`.

The server reads the queryables query when it loads the service, as the
service and with no caller grants, and keeps the result until the next
reload. The types decide how each value from a client is parsed and bound.
In `cql2` mode, the queryables query takes the place of today's
`cql.configQuery`: it can read `luc:config` and give the index fields.

### Queryable types

The `queryables` route advertises each queryable as JSON Schema. A `uri`
queryable is `{ "type": "string", "format": "uri" }`.

OGC API Features Part 3 (OGC 19-079r2, version 1.0, approved 2024-07-26)
covers this in clause 6:

- Recommendation 1 C (`/rec/queryables/queryables-schema`): "Properties that
  represent a URI SHOULD be represented as a string with format `uri` or
  `uri-reference`."
- Requirement 3 C: each property other than a spatial one "SHALL include a
  `type` member". Requirement 3 F gives `date-time` or `date` for temporal
  properties.
- Recommendation 1 F and H: `enum` SHOULD be given where it applies.

The client sends a string in each case. The server binds the term that the
type gives. A `uri` value becomes an IRI in the `VALUES` row. JSON Schema's
`uri` is an absolute URI. sqlib binds it as an IRI. The two differ only for
an IRI with characters outside ASCII.

### Checks on save

The save refuses a version with `400` and the field and the rule, when:

- a pinned version is gone, or is not a SELECT;
- a query breaks a reserved-name rule, such as an items query without
  `?featureId` in its outputs, or `?minx` outside the `bbox` clause;
- the collection query or the item query does not declare its id in a
  `VALUES` clause;
- a slot that the server fills has `whenEmpty` set to `require` or
  `propagateEmpty`;
- the backend is gone;
- the queryables query names a property that is not a queryable of the
  items query.

The pins stop a pinned version from going away. A backend can still be
deleted. The service then answers `503` on each route, and the service
screen shows the problem.

Some rules can only be checked at run time, with data:

- Two collections with one `?collectionId` get `500` on `/collections`.
- Two rows with one `?featureId` on one page get `500`, as today.

### JSON-LD context (opt-in)

David asked on 2026-11-28 for GeoJSON responses that a client can read back
as RDF. The map thread proposed this form, and it fits the query model:

- `OgcServiceVersion` gets an optional `jsonLdContext`: a JSON-LD 1.1
  context object, stored as written. Each term maps an output variable name
  to a full predicate IRI. A term can set `"@type": "@id"` for an IRI value,
  or a datatype.
- The server adds `"id": "@id"`, `"properties": "@nest"` and
  `"geometry": { "@type": "@json" }`.
- The server serves the result at `/context.jsonld` under the service path.
  Items and item responses then carry a `Link` header with rel
  `http://www.w3.org/ns/json-ld#context`. A service with no context sends no
  header.
- `?featureId` is a string, so `"id": "@id"` needs a base. The item query
  can also return `?feature`, the feature IRI. When it does, the server
  writes that IRI as `id` in place of `?featureId`.

The JSON-LD context is the one place where the service stores JSON. It is
served as written, so storing it as RDF would add a conversion and no use.

Known gap: a term sets IRI or literal for a property, not for each value.
A property that holds IRIs for some features and literals for others reads
back with one form. I have not tested the context with a JSON-LD processor.

### Paths

- A path is one to three segments. Each segment matches
  `[a-z0-9][a-z0-9-]{0,62}`.
- No segment can be `collections`, `conformance`, `api`, `queryables` or
  `items`. A request URL then splits in one way only, into a service path
  and an OGC resource.
- Paths are unique in the deployment. A save with a path that another
  service has gets `409`. `/ogc/rail` and `/ogc/rail/2026` can both exist,
  and the server matches the longest service path.
- `SQLIB_OGC_BASE_URL` still sets the base of the links behind a proxy.

### Pinning and the live version

- A service version pins the version of each query. A new query version
  does not change a service.
- When a query has a newer version, its row on the service screen shows the
  newer-version icon: the `Info` icon with the tooltip "Newer version
  available", from `VersionedEntitySelector.vue`.
- In edit mode, a **Use v5** button on the row puts the new version in the
  draft. The save checks v5.
- The live version is the service's `currentVersion`. A save makes a new
  version and makes it live. **Make live** on an older version moves it
  back.
- Services have no environments, because an environment belongs to one
  library and a service can use queries from many.

### Serving without a restart

A saved service adds no route, so this works in the full server and in the
browser demo. One wildcard route, `/ogc/*`, serves every service. It looks
the path up in a map at each request. A save changes the map.

- `registerOgcRoutes` holds the map. `reload()` reads the `OgcService`
  entities, resolves each one's `currentVersion`, runs each queryables
  query, and swaps the map. A request in flight keeps the map it started
  with.
- `reload()` runs on a change event for an `OgcService`, an
  `OgcServiceVersion` or a `Backend` (`subscribeChanges` in
  `packages/api/src/lib/changeEvents.ts`). An import calls it directly.
- Data changes need no reload, because each request runs the queries.
- Queryables values are read at reload. **Refresh** on the service screen
  reads them again after a data change.

I have not checked that the change feed reaches every process when the API
runs as more than one. The AWS demo runs one Fargate task. If it does not,
a restart is the fallback, which David accepted.

### Who can do what

- Administrators create, edit and delete services. This is the rule for
  backends (`requireAdmin` in `packages/api/src/routes/backends.ts`).
- The landing page, `/conformance`, `/api` and `/queryables` are public, as
  the metadata routes are today. The queryables query runs as the service.
- `/collections`, `/collections/{id}`, `items` and one item run their query
  through `POST /execute` with the caller's `Authorization`. The caller
  needs `execute` on the query's library and `query:saved` on the backend.
  A caller then sees only the collections and features that their grants
  and graph policies allow.

### Export and MCP

- A library export does not carry services, because a service is outside
  every library. `GET /ogc-services/{id}/export` exports one service. An
  import refuses a path clash with `409`, and refuses a reference to a
  version or backend that the target does not hold.
- The MCP server lists and reads services with the generated tools of the
  versioned types (`ogcServices_list`, `ogcServices_get` and the version
  tools).

### Rail and screens

- **OGC** is a rail entry below the divider, after Backends. It is account
  level, so it does not change with the library switcher. The icon is `Map`
  from lucide. The entry needs `FEATURE_OGC`, and shows to administrators
  only, as Access does.
- The sidebar lists services by name, with the path under each name.
- The service screen shows the URL with a copy button, the backend, the
  five query rows, the versions and an **Open map** link.
- Each query row shows the query, its library, its version, and the roles
  that its reserved names give, as chips: `bbox`, `datetime`, `paging`,
  `geometry` and the queryable names. A role that the route needs and the
  query lacks shows as a red chip.
- **Collections** below the queries lists the rows that the collections
  query returns for the viewer, with a map link for each.
- **Queryables** lists each queryable with its type, title and the number
  of values in its `enum`.
- A query picker lists SELECT queries from every library, grouped by
  library.
- A query that a service uses shows the service on the query screen, with
  a link.

### What is removed

sqlib is before 1.0 and no deployment depends on the old form, so this work
removes it with no compatibility code:

- The `ogc` key of `QueryVersionSchema`, its JSON shape, `checkOgcObject`,
  and its handling in `QueryVersionWriter.ts`, `toolObject.ts` and the
  queries routes.
- `collectOgcCollections`, `OgcCollectionSpec` and the library services at
  `/ogc/{library slug}`.
- `geometrySources`, the `point` form and `omit`. A query with longitude and
  latitude columns builds a WKT point with `BIND`. A column that is not a
  property is left out of the `SELECT`.
- The `ogcFile` key of the Rail seed and `demo/libraries/rail/ogc/*.json`.
  The seed gets one `ogcServices` entry: a service at `/ogc/rail`, with
  collections, collection, items, item and queryables queries over the
  Stations and Lines data. `demo/scripts/seed-library.mjs` writes it when
  `DEMO_OGC=true`. The map page from #278 keeps its URL.
- The parts of `docs/guides/publishing-ogc-collections.md` and
  `docs/proposals/ogc-api-features.md` that describe the `ogc` object.

## Open questions

None at the time of writing.

## Build steps

Each step is one pull request.

1. **The service and its routes.** `OgcService` and `OgcServiceVersion`,
   `/ogc-services`, the save check, pins, export and import. The reserved
   name rules, the wildcard route, `reload()`, and the removals. The Rail
   seed. Tests: each reserved-name rule, pins, path clashes and reserved
   segments, a save and a read with no restart, and the CITE Part 1 run on
   the Rail service.
2. **The web app.** The rail entry, the service screen, the query picker
   and the link on the query screen.
3. **Guide.** Rewrite `docs/guides/publishing-ogc-collections.md`.

Step 1 waits for #278 to merge, because both change `ogcRoutes.ts` and the
`ogc` object.

## Later work

- Query groups as service queries. The server reads a group's result columns
  from its end node, and the paging parameters must be on the end node's
  query, because a later node can change the number of rows.
- Range facets for numbers and dates.
- The same model for published tools, so that `/tools/` can have more than
  one service per library.
