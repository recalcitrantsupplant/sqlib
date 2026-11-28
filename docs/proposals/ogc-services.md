# OGC services as library items

Status: built on the branch `claude/ogc-services`, on top of PR #278 (the map
page and its facets). Written 2026-11-28 against `main` at `201d79de`. The
open questions were decided on 2026-11-28; see [Decisions](#decisions). It changes how
[ogc-api-features.md](ogc-api-features.md) configures a service. The
serializer, the route plugin, the `values` and `cql2` modes, and the auth
rules of that design stay as they are.

## Summary

An OGC API Features service becomes an item of its own, listed in the rail
beside queries and query groups. Each item has its own slug, a title, a
description and a list of collections. A collection names one query and
holds the mapping that the query version's `ogc` object held before. The
service is served at `/ogc/{service slug}`, and a library can have any number
of services. A saved service is served at the next request, without a
restart.

A collection can also carry JSON-LD terms for its properties. The service then
serves a JSON-LD context and names it in a `Link` header on `items`, so a
JSON-LD processor reads the GeoJSON as RDF.

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
- Opt-in JSON-LD terms, so a JSON-LD client gets the property and feature
  IRIs back from the GeoJSON.

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
    "zone": { "var": "zoneIn", "type": "integer", "title": "Zone" }
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

`loadPublishedCatalogue` (`packages/api/src/lib/publishedTools.ts`) collects
the collections at startup, and `registerOgcRoutes` builds its `services` map
from them. The routes are fixed patterns (`/ogc/:slug/…`) that look the slug
up in that map, so no route is registered again.

1. `collectOgcCollections()` reads the `OgcService` entities, resolves each
   one's version in the deployment's environment, then each collection's
   query version (`resolveOgcCollection`).
2. The cache coordinator (`packages/api/src/lib/CacheCoordinator.ts`) calls
   each `onWrite` listener with the id of every entity it creates, updates or
   deletes. The OGC routes' listener marks the map stale.
3. The next OGC request collects the collections again and swaps the map. A
   request in flight keeps the map it started with. The cached `luc:config`
   results of `cql2` collections are cleared at the same time.

## The check when a service version is saved

The save runs `checkOgcObject` (`packages/tools/src/ogc.ts`) on each
collection against its query version, as a query version save does today,
plus:

- `query` is a `Query` in the service's library, and `queryVersion`, if set,
  is one of its versions.
- `collectionId` is unique in the service.
- `valuesQuery`, if set, is a SELECT in the same library with the outputs
  that [Facets](#facets) names.

A problem gets `400` with the key path, such as
`collections[1].queryables.zone.var`.

A collection that follows the environment can break later, when a new query
version drops a variable that the mapping names. The next collection leaves
that collection out and records a problem line. The service entity carries its
lines in `problems` (`GET /ogc-services/{id}`), and the web app shows them on
the service screen.

## Facets

PR #278 built the facets, and this change keeps them as they are:

- A `values` queryable fills a `VALUES` variable that takes a list. Several
  values of one queryable go as rows of its clause, which matches any of them:
  OR within the queryable. Each queryable has its own clause, so several
  queryables combine with AND.
- A client sends them as repeated query parameters or as a CQL2-JSON filter
  that is an `and` of `=` and `in`. Anything else gets `400`.
- A collection's `valuesQuery` returns `?property ?value`. The queryables
  document lists the values as `enum`, and the map page shows each such
  queryable as tick boxes.

A query can take a string and convert it with `BIND(IRI(?text) AS ?x)`, but a
queryable of type `uri` makes the server bind an IRI, which the store joins
directly. See decision 1.

## The web app

- **Rail entry.** `OGC`, after `Groups`, shown when the `ogc` feature flag
  is on (`packages/web/src/lib/railEntries.ts`). The sidebar lists the
  library's services.
- **Service screen.** The title, the slug, the service URL with a copy
  button, and a link to the map page. Below that, a table of collections:
  id, title, query (a link), and the version it runs. Problem lines from
  the service's `problems` appear above the table.
- **Collection editor.** Picking a query fills the choices from its version's
  detected outputs and inputs (`POST /queries/detect-outputs` and
  `detect-inputs`): the feature column, the geometry column or the point
  columns, the `LIMIT` and `OFFSET` parameters, the `bbox`, `datetime` and
  `skipGeometry` variables, and one row per queryable (name, variable, type,
  title). The values query is picked from the library's queries.
  The save check's messages appear beside the field they name.
- **Query screen.** A query that a service uses shows "OGC: {service} /
  {collection}" with a link to the service screen.

The screens use short labels, with detail in tooltips and no explanatory
sentences.

## JSON-LD

A collection may carry `context`: one JSON-LD term per property, with the
predicate IRI in `@id`, and `@type` (`@id` or a datatype IRI) or `@language`.
The save allows no other keyword, and only properties the collection returns.
With terms:

- `/ogc/{slug}/collections/{id}/context.jsonld` serves GeoJSON-LD's context
  (https://geojson.org/geojson-ld/) with `@base` set to `feature.base`,
  `properties` as `@nest`, the geometry as an `rdf:JSON` literal, OGC's paging
  keys left out, and the terms.
- The collection document links it with
  `rel=http://www.w3.org/ns/json-ld#context`, and `items` and
  `items/{featureId}` send it in a `Link` header (JSON-LD 1.1, section 6.1).
- A property typed `xsd:decimal` or `xsd:float` is written as its lexical form,
  because JSON-LD writes a JSON number with such a type in double form
  (`1.5E0`), which is not a valid decimal.

Known gaps, accepted on 2026-11-28: a property whose values mix IRIs and
literals is read with its term's type; a term has one language; a
`GROUP_CONCAT` value is one string.

## Export, import and MCP

Not in this change. A library export carries queries, query groups, rule sets
and ETL jobs today, and MCP tools are written by hand
(`packages/tools/src/tools.ts`); neither covers OGC services yet.

## Migration

At startup, a server with `FEATURE_OGC=true` runs `migrateOgcObjects`
(`packages/api/src/lib/ogcMigration.ts`). For each library whose queries'
current versions carry `ogc` objects, and that has no service with its slug
yet, it makes one service:

- Its slug is the library's slug, so `/ogc/{library slug}` keeps working. Its
  title and description are the library's.
- Each such query becomes a collection with that object and no
  `queryVersion`, so it follows the environment as before. A collection that
  no longer fits its query is left out and logged.

A query version save that sends `ogc` gets `400`, with a message that names
`/ogc-services`. The Rail seed (`demo/libraries/rail/seed.json`) has one
`ogcServices` entry, whose collection files carry `query` and `context`, and
`demo/scripts/seed-library.mjs` writes it when `DEMO_OGC=true`.

## What was built

One pull request, on top of #278:

- the `OgcService` and `OgcServiceVersion` entities and `/ogc-services`, with
  the save check, version pins, environments and the startup migration;
- serving without a restart;
- JSON-LD contexts;
- the web app's OGC section, service screen and collection editor;
- the map page's GeoJSON / GeoJSON-LD switch in the Result tab.

## Decisions

Decided on 2026-11-28, as this design proposed:

1. **IRI values.** The server binds an IRI from the string when a queryable's
   type is `uri`.
2. **Slug shape.** One path segment, such as `rail-2026`.
3. **Queries from other libraries.** A collection's query is in the service's
   library.
4. **Following the environment.** A collection follows its query's version in
   the environment by default, and `queryVersion` pins one.
5. **The values query.** It runs as the caller, so an anonymous caller sees
   `enum` only when the anonymous principal may run it.
6. **The old `ogc` object.** A query version save that sends one gets `400`.

## Later work

- Range facets: a queryable with `min` and `max` variables, filled from CQL2
  `>=` and `<=`, and a values query that returns buckets for dates.
- Query groups as collection targets
  ([ogc-api-features.md § Later work](ogc-api-features.md#later-work)).
- The same item model for the published tools, so that `/tools/{slug}` can
  also have more than one service per library.
