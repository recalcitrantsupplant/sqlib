# OGC services as library items

Status: proposal. Written 2026-11-28 against `main` at `201d79de`, with
PR #278 (the map page) at `0c55ccd` in view. It changes how
[ogc-api-features.md](ogc-api-features.md) configures a service. The
serializer, the route plugin, the `values` and `cql2` modes, and the auth
rules of that design stay as they are.

## Summary

An OGC API Features service becomes an item of its own, listed in the rail
beside queries and query groups. Each item has its own slug, a title, a
description and a list of collections. A collection names one query and
holds the mapping that the query version's `ogc` object holds today. The
service is served at `/ogc/{service slug}`, and a library can have any number
of services.

The design also adds basic facets to `values` mode: OR within one queryable,
AND across queryables. A client sends them as a CQL2 filter or as query
parameters, and a collection can name a second query that lists the values
of each queryable.

## Why

Three problems in the current design (`main` and PR #278):

- **The mapping cannot be seen.** A query becomes a collection when its
  version carries an `ogc` object. No screen shows or edits that object. It
  is set through `POST /queries/{id}/versions` or, in the Rail demo, through
  `demo/libraries/rail/ogc/*.json` and the seed's `ogcFile` key.
- **One service per library.** The service URL is `/ogc/{library slug}`, as
  the published tools use `/tools/{library slug}`. Nothing in OGC API
  Features or in the store needs this. It came from reusing the library slug,
  so that the first version needed no new entity.
- **No faceted filtering in `values` mode.** A queryable fills one `VALUES`
  variable with one value. A `filter` parameter gets `400`. A client cannot
  ask for "zone 1 or 2, and step-free".

## Goals and non-goals

Goals:

- A service is an item that people can list, open, edit and version in the
  web app, with the same grants as the other items of its library.
- Any number of services per library, each at `/ogc/{slug}`.
- Saving a service changes what the server serves, without a restart.
- Basic facets in `values` mode: OR within a queryable, AND across
  queryables, from a CQL2 filter or from query parameters.
- A queryables list that can carry each queryable's values, from a query.
- The current Rail demo URLs keep working after migration.

Non-goals:

- Nested CQL2 expressions in `values` mode (`or` across queryables, `not`,
  `like`, spatial and temporal operators other than `bbox` and `datetime`).
  A fixed query with `VALUES` parameters cannot express them. `cql2` mode
  keeps full CQL2 through the Lucene index.
- Range or bucketed facets for numbers and dates. See
  [Later work](#later-work).
- Changes to the published tools (`/tools/{slug}`). They keep their
  per-version `tool` object and their startup catalogue.

## The item

Two new entity types, made with `registerVersionedEntityRoutes`
(`packages/api/src/routes/versionedEntity.ts`), as the other versioned
nouns are:

| Entity | Holds |
| --- | --- |
| `OgcService` | `name` (the service title), `description`, `slug`, `currentVersion`, `isPartOf` (its library) |
| `OgcServiceVersion` | `version`, `comment`, `collections` (JSON), `isPartOf` (its service) |

The slug is on the stable entity, so it does not change between versions.
It matches `^[a-z0-9][a-z0-9-]{0,63}$` and is unique in the deployment.
A save with a slug that another service has gets `409`.

`collections` is a JSON array, stored as the version's `tool` object is
(`rdf:JSON` with a `@jsonShape`). Each entry is today's `ogc` object with
two keys added:

```jsonc
{
  "query": "urn:sqlib:query:rail-stations-features",   // the Query
  "queryVersion": "urn:sqlib:queryversion:…",          // optional pin
  "collectionId": "stations",
  "title": "Stations",
  "mode": "values",
  "feature": { "var": "feature", "base": "https://example.org/rail/" },
  "geometry": "geom",
  "params": { "limit": "1", "offset": "2", "bbox": ["minx", "miny", "maxx", "maxy"], "skipGeometry": "skip" },
  "queryables": {
    "name": { "var": "nameLike", "type": "string", "title": "Name" },
    "zone": { "var": "zone", "type": "integer", "title": "Zone", "multiple": true }
  },
  "valuesQuery": "urn:sqlib:query:rail-stations-facets",  // optional, see Facets
  "pageSize": { "default": 10, "max": 100 }
}
```

`collectionId` is unique within the service. Two services may both have a
`stations` collection.

### Which query version a collection runs

- With `queryVersion`, the collection runs that version. The service version
  holds a pin on it, so the query version cannot be deleted while the
  service version exists (`packages/api/src/lib/versionPins.ts`).
- Without it, the collection runs the query's version in the deployment's
  environment, as `collectOgcCollections` resolves it today
  (`resolveVersionIn` in `packages/api/src/lib/environments.ts`). A new
  query version then changes the collection without a service edit.

The service itself is promoted like a query: `OgcServiceVersion` is added to
`ENVIRONMENT_VERSION_TYPES` (`packages/api/src/persistence/schemas/EnvironmentSchema.ts`),
and the server serves each service's version in the deployment's
environment.

### Where the queries may be

A collection's query must be in the service's library. Grants, export and
environments all work per library: a service in library A that runs a query
in library B could not be exported, promoted or granted as one unit. See
[Open questions](#open-questions), question 3.

## URLs

Every route of [ogc-api-features.md § Routes](ogc-api-features.md#routes)
moves from `/ogc/{library slug}` to `/ogc/{service slug}`, unchanged
otherwise. The `/ogc/` prefix stays, so a service path cannot collide with
an API route such as `/queries` or `/execute`, or with a route that a later
release adds. A proxy can still serve a service at any public address, and
`SQLIB_OGC_BASE_URL` sets the base of its links.

The slug is one path segment. Nested slugs, such as `rail/2026`, make the
routes ambiguous: `/ogc/rail/collections` could be the collections of `rail`
or a service named `rail/collections`. See question 2.

## Serving without a restart

Today `loadPublishedCatalogue` (`packages/api/src/lib/publishedTools.ts`)
collects the collections once at startup, and `registerOgcRoutes` builds its
`services` map from them. The routes are fixed patterns (`/ogc/:slug/…`) that
look the slug up in that map, so no route needs to be registered again.

The change:

1. `collectOgcServices()` replaces `collectOgcCollections()`. It reads the
   `OgcService` entities and resolves each one's version in the deployment's
   environment, then each collection's query version.
2. `registerOgcRoutes` holds the `services` map in a variable and exposes
   `reload()`, which runs `collectOgcServices()` and swaps the map.
3. A write hook calls `reload()` after a write to an `OgcService`, an
   `OgcServiceVersion`, a `QueryVersion` or `Query` that a service names, or
   an `Environment`. The cache coordinator
   (`packages/api/src/lib/CacheCoordinator.ts`) has no change listeners
   today, so the hook is new: one callback list that the entity write paths
   call after a successful write. A request in flight keeps the map it
   started with.

`indexFields` (the cached `luc:config` result of a `cql2` collection) is
cleared for the collections that a reload changes.

## The check when a service version is saved

The save runs `checkOgcObject` (`packages/tools/src/ogc.ts`) on each
collection against its query version, as a query version save does today,
plus:

- `query` is a `Query` in the service's library, and `queryVersion`, if set,
  is one of its versions.
- `collectionId` is unique in the service.
- A queryable with `multiple: true` is in `values` mode.
- `valuesQuery`, if set, is a SELECT in the same library with the outputs
  that [Facets](#facets) names.

A problem gets `400` with the key path, such as
`collections[1].queryables.zone.var`.

A collection that follows the environment can break later, when a new query
version drops a variable that the mapping names. The reload then leaves that
collection out and records a problem line, as `collectOgcCollections` does
today. `GET /ogc-services/{id}/problems` lists those lines for one service,
and the web app shows them on the service screen.

## Facets

### What a client can send

A queryable with `multiple: true` takes several values. Its `VALUES`
variable gets one row per value, so the query matches any of them: OR within
the queryable. Each queryable has its own `VALUES` clause, so several
queryables combine with AND.

A query written for this needs no `FILTER IN`. The join with the `VALUES`
rows does the OR:

```sparql
VALUES ?zone { UNDEF }
VALUES ?nameLike { UNDEF }
?feature :zone ?zone ; :name ?name .
FILTER(!BOUND(?nameLike) || REGEX(?name, ?nameLike, "i"))
```

A `values` collection accepts two forms of request:

| Form | Example | Meaning |
| --- | --- | --- |
| Query parameters | `?zone=1&zone=2&stepFree=true` | Repeat a parameter for OR. Different parameters are ANDed |
| CQL2-JSON filter | `filter-lang=cql2-json&filter={"op":"and","args":[{"op":"in","args":[{"property":"zone"},[1,2]]},{"op":"=","args":[{"property":"stepFree"},true]}]}` | The same request |

The CQL2 subset that `values` mode accepts:

- `=` with a queryable and a literal.
- `in` with a queryable and a list of literals, on a `multiple` queryable.
- `or` whose arguments are all `=` on one `multiple` queryable. This is the
  same as `in`.
- `and` of the above, with each queryable at most once.
- `s_intersects` with an envelope is the same as `bbox`, and `t_intersects`
  with an interval is the same as `datetime`, when the collection has those
  parameters.

Anything else gets `400` naming the unsupported operator. The service
declares the `cql2-json` and `basic-cql2` conformance classes only when a
collection is in `cql2` mode, or when a `values` collection has at least one
queryable. The exact class list is a check to make against the OGC test
suite.

### How a value becomes a term

The server parses each value by its queryable's `type` and binds the matching
term, as `queryableValue` in `packages/api/src/server/ogcRoutes.ts` does
today: `uri` binds an IRI, `integer` an `xsd:integer`, `string` a plain
literal. A client sends an IRI as a string, because CQL2 has no IRI literal.
The server makes it an IRI.

A query can still take the string and convert it with
`BIND(IRI(?zoneText) AS ?zone)`. That works, but most stores then evaluate
the pattern for every candidate and filter afterwards, where an IRI bound in
`VALUES` is joined directly. See question 1.

### The values of each queryable

A collection may name a `valuesQuery`. It is a SELECT with two outputs:

| Output | Holds |
| --- | --- |
| `?property` | The queryable's name, as a plain literal, such as `"zone"` |
| `?value` | One value of that queryable |

An optional `?count` output gives the number of features with that value.

```sparql
PREFIX : <https://example.org/rail/>
SELECT ?property ?value (COUNT(?feature) AS ?count) WHERE {
  ?feature a :Station .
  { ?feature :zone ?value . BIND("zone" AS ?property) }
  UNION
  { ?feature :stepFree ?value . BIND("stepFree" AS ?property) }
}
GROUP BY ?property ?value
ORDER BY ?property ?value
```

The `queryables` route runs it through `/execute` as the caller and adds an
`enum` of the values to each queryable's JSON Schema. A caller who may not
run the query gets the queryables without `enum`. The route keeps the
result for the caller for 60 seconds. Labels for IRI values come from the
label cache (`@rdf-label-cache/client`) in the client. The query returns no
labels.

### On the map page

The map page (`demo/ogc-map`, PR #278) shows a queryable that has an `enum`
as a list of checkboxes, with the count beside each value. A queryable
without one stays a text field. Checked values become an `in` clause, and
the page sends a CQL2-JSON filter. The Query and Result tabs show the SPARQL
and the GeoJSON of the request, as they do in #278.

## The web app

- **Rail entry.** `OGC`, after `Groups`, shown when the `ogc` feature flag
  is on (`packages/web/src/lib/railEntries.ts`). The sidebar lists the
  library's services.
- **Service screen.** The title, the slug, the service URL with a copy
  button, and a link to the map page. Below that, a table of collections:
  id, title, query (a link), and the version it runs. Problem lines from
  `GET /ogc-services/{id}/problems` appear above the table.
- **Collection editor.** Picking a query fills the choices from its version's
  detected outputs and inputs (`POST /queries/detect-outputs` and
  `detect-inputs`): the feature column, the geometry column or the point
  columns, the `LIMIT` and `OFFSET` parameters, the `bbox`, `datetime` and
  `skipGeometry` variables, and one row per queryable (name, variable, type,
  title, multiple). The values query is picked from the library's queries.
  The save check's messages appear beside the field they name.
- **Query screen.** A query that a service uses shows "OGC: {service} /
  {collection}" with a link to the service screen.

The screens use short labels, with detail in tooltips and no explanatory
sentences.

## Export, import and MCP

- A library export carries its services and their versions, as it carries
  query groups. An import checks each service slug against the target
  deployment and refuses a clash with `409`.
- The MCP server lists and reads services with the same generated tools as
  the other versioned nouns (`ogcServices_list`, `ogcServices_get`, and the
  version tools).

## Migration

A migration script, run once per deployment, makes one service per library
that has versions with an `ogc` object:

- The service's slug is the library's slug, so `/ogc/{library slug}` keeps
  working. Its title and description are the library's.
- Each query whose current version has an `ogc` object becomes a collection
  with that object and no `queryVersion`, so it follows the environment as
  it does today.

After the migration, a query version save that sends `ogc` gets `400`, with
a message that names the service routes. The Rail seed
(`demo/libraries/rail/seed.json`) replaces `ogcFile` on its two queries with
one `ogcServices` entry, and `demo/scripts/seed-library.mjs` writes it when
`DEMO_OGC=true`.

## Build steps

Each step is one pull request.

1. **The entity and the routes.** `OgcService` and `OgcServiceVersion`,
   `/ogc-services` through `registerVersionedEntityRoutes`, the save check,
   version pins, environments, export and import. `collectOgcServices()`
   replaces `collectOgcCollections()`, still at startup. The migration
   script and the Rail seed change. Tests: the save check, pins, slug
   clashes, and the CITE Part 1 run on the migrated Rail service.
2. **Serving without a restart.** `reload()`, the write hook, and the
   problems route. Test: create, edit and delete a service,
   and read its routes after each write without a restart.
3. **The web app.** The rail entry, the service screen, the collection
   editor and the link on the query screen.
4. **Facets.** `multiple` queryables, the CQL2 subset in `values` mode,
   `valuesQuery` with `enum` in the queryables route, the map page's
   checkbox facets, and a Rail values query for zone and step-free access.

Step 4 depends on step 1 only, so it can run beside steps 2 and 3.

## Open questions

1. **IRI values.** Should the server bind an IRI from a string when the
   queryable's type is `uri` (this design, and today's behaviour)? The
   alternative is to bind every value as a string and convert it in the
   query with `BIND(IRI(…))`, which is slower on most stores.
2. **Slug shape.** One path segment, such as `rail-2026` (this design), or
   nested paths such as `rail/2026`? Nested paths need a reserved word list
   (`collections`, `conformance`, `api`, `queryables`) and a wildcard route.
3. **Queries from other libraries.** Same library only (this design), or any
   library the author can read? Cross-library collections would need export
   and promotion rules that span libraries.
4. **Following the environment.** Should a collection follow its query's
   version in the environment by default, with `queryVersion` as an opt-in
   pin (this design)? A pin by default is safer, but every query edit then
   needs a service edit.
5. **The values query and public metadata.** The metadata routes are
   readable without sign-in (decision 1 of
   [ogc-api-features.md § Open questions](ogc-api-features.md#open-questions)).
   This design runs the values query as the caller, so an anonymous caller
   sees `enum` only when the anonymous principal may run it. Is that right,
   or should the values be public with the rest of the metadata?
6. **The old `ogc` object.** Refuse it on query version saves after the
   migration (this design), or keep reading it for one release?

## Later work

- Range facets: a queryable with `min` and `max` variables, filled from CQL2
  `>=` and `<=`, and a values query that returns buckets for dates.
- Query groups as collection targets
  ([ogc-api-features.md § Later work](ogc-api-features.md#later-work)).
- The same item model for the published tools, so that `/tools/{slug}` can
  also have more than one service per library.
