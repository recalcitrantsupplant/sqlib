# Publishing queries as OGC API Features collections

A stored SELECT can be served as an OGC API Features collection. Map clients
such as QGIS, and OGC tools such as OWSLib, then read it as GeoJSON features,
with paging, `bbox`, `datetime` and attribute filters.

The design and the reasons for it are in
[proposals/ogc-api-features.md](../proposals/ogc-api-features.md). Two
starter sets are in [`docs/examples/ogc`](../examples/ogc).

## What you get

One library slug is one OGC service, at `/ogc/{slug}`:

| Route | Answers |
| --- | --- |
| `/ogc/{slug}/` | the landing page |
| `/ogc/{slug}/conformance` | the conformance classes |
| `/ogc/{slug}/api` | an OpenAPI 3.0.3 document |
| `/ogc/{slug}/collections` | every collection of the library |
| `/ogc/{slug}/collections/{id}` | one collection |
| `/ogc/{slug}/collections/{id}/queryables` | the filterable properties, as JSON Schema |
| `/ogc/{slug}/collections/{id}/items` | a page of features, as GeoJSON |
| `/ogc/{slug}/collections/{id}/items/{featureId}` | one feature |

The service declares OGC API Features Part 1 (Core, GeoJSON, OpenAPI 3.0).
A service with a `cql2` collection also declares Part 3 and CQL2-JSON.

## 1. Turn the routes on

Set `FEATURE_OGC=true`. The routes are also served only when
`MCP_CATALOGUE` is `both` (the default) or `published`.

Links in every document are absolute. They start with
`SQLIB_OGC_BASE_URL` when it is set, for example `https://maps.example.org`.
Otherwise they start with the request's scheme and host, and
`APP_PUBLIC_BASE_PATH`. Set `SQLIB_OGC_BASE_URL` behind a proxy that does not
send `X-Forwarded-*` headers.

## 2. Give the library a slug

Do this as for published tools: see
[publishing-tools.md](publishing-tools.md#1-give-the-library-a-slug).

## 3. Write the query

Choose the mode first:

- **`values`** works on every backend. Every OGC parameter fills a `VALUES`
  clause, and `LIMIT 0001` and `OFFSET 0002` page the results.
- **`cql2`** works on Jena Fuseki with the Kurrawong Lucene index. The filter
  goes to the index as one CQL2-JSON string, and the index pages with a
  cursor. See [The cql2 mode](#the-cql2-mode).

A `values` query, from [`examples/ogc/plain`](../examples/ogc/plain):

```sparql
PREFIX geo: <http://www.opengis.net/ont/geosparql#>
PREFIX ex:  <https://example.org/ns#>
SELECT ?feature ?geom ?name ?height WHERE {
  VALUES ?feature { UNDEF }
  VALUES (?minx ?miny ?maxx ?maxy) { (UNDEF UNDEF UNDEF UNDEF) }
  VALUES (?start ?end) { (UNDEF UNDEF) }
  VALUES ?name { UNDEF }
  VALUES ?skip { UNDEF }
  ?feature a ex:Building ;
           ex:name ?name ;
           ex:minLon ?x0 ; ex:minLat ?y0 ; ex:maxLon ?x1 ; ex:maxLat ?y1 .
  OPTIONAL {
    ?feature geo:hasGeometry/geo:asWKT ?geom .
    FILTER(!BOUND(?skip) || !?skip)
  }
  OPTIONAL { ?feature ex:height ?height }
  OPTIONAL { ?feature ex:surveyed ?when }
  FILTER(!BOUND(?minx) || (?x1 >= ?minx && ?x0 <= ?maxx && ?y1 >= ?miny && ?y0 <= ?maxy))
  FILTER(!BOUND(?start) || (BOUND(?when) && ?when >= ?start))
  FILTER(!BOUND(?end)   || (BOUND(?when) && ?when <= ?end))
}
ORDER BY ?feature
LIMIT 0001
OFFSET 0002
```

Follow these rules:

1. Return one row per feature. Two rows with one feature id answer `500`,
   because pages would split the feature. Use `GROUP BY ?feature` with
   `GROUP_CONCAT` for a property that has more than one value.
2. Make `?feature` a `VALUES` parameter. The one-feature route binds it.
3. Start every filter on a parameter with `!BOUND(?x) ||`. An absent
   parameter leaves its variable unbound.
4. Use `ORDER BY`, so that pages are stable.
5. Put the geometry in an `OPTIONAL` with the `?skip` filter, so that
   `skipGeometry=true` stops the store from reading it.
6. Return a `geo:wktLiteral` or a `geo:geoJSONLiteral`. A WKT literal may name
   CRS84, EPSG:4326, EPSG:4283 or EPSG:7844. Any other CRS answers `500`.

The `bbox` filter above reads a stored envelope and scans every feature. That
is fine for thousands of features. On a backend with GeoSPARQL, build a
polygon from the four numbers and use `geof:sfIntersects` instead.

## 4. Add the `ogc` object to the version

Send `ogc` with the version, beside `queryString`:

```json
POST /queries/{id}/versions
{
  "queryVersion": {
    "queryString": "…",
    "ogc": {
      "collectionId": "buildings",
      "title": "Buildings",
      "mode": "values",
      "feature": { "var": "feature", "base": "https://example.org/building/" },
      "geometry": "geom",
      "params": {
        "limit": "1",
        "offset": "2",
        "bbox": ["minx", "miny", "maxx", "maxy"],
        "datetime": ["start", "end"],
        "skipGeometry": "skip"
      },
      "queryables": { "name": { "var": "name", "type": "string", "title": "Name" } },
      "pageSize": { "default": 10, "max": 500 },
      "extent": { "spatial": [[115.8, -42.9, 151.3, -12.4]] }
    }
  }
}
```

| Key | Meaning |
| --- | --- |
| `collectionId` | The id in URLs. Letters, digits, `_` and `-`, at most 64. Unique in the library |
| `title`, `description` | Shown to clients |
| `mode` | `values` or `cql2` |
| `feature.var` | The column that holds the feature IRI |
| `feature.base` | Removed from the IRI to make the feature id. `https://example.org/building/a1` becomes `a1` |
| `geometry` | The geometry column. `null` for a collection without geometry |
| `point` | `[lon, lat]` columns, in place of `geometry` |
| `geometrySources` | Links to the same shapes as PMTiles, vector tiles or a COG |
| `params` | Which `VALUES` variables, `LIMIT` and `OFFSET` the OGC parameters fill |
| `queryables` | Properties a client can filter on, each a query parameter |
| `pageSize` | The default and the largest page. The largest allowed is 10000 |
| `extent` | The spatial extent in CRS84, and the temporal extent |
| `omit` | Result columns that are not feature properties |

The save checks the object against the version. A key that names a variable
the version does not declare answers `400`, naming the key. A save that sends
no `ogc` copies the previous version's, and checks it again. `"ogc": null`
removes it.

A query can be a collection and a published tool at the same time.

## 5. Restart the server

The collections are collected when the server starts, as published tools
are. Each one pins the version that is current then, or the version of the
environment in `SQLIB_DEFAULT_ENVIRONMENT`. A new version takes effect at the
next start.

A collection that cannot be served is skipped, and the server logs why. With
`MCP_CATALOGUE=published` the server does not start. The causes are:

- the library has no slug;
- two collections in one library have the same `collectionId`;
- the query has no default backend;
- a slot the collection uses has `whenEmpty` set to `require` or
  `propagateEmpty`. The OGC parameters are optional, so the slot must run
  open.

## The items route

`GET /ogc/{slug}/collections/{id}/items` takes these parameters:

| Parameter | Effect |
| --- | --- |
| `limit` | The page size. Above `pageSize.max`, the maximum is used |
| `offset` | `values` mode: the first row. The `next` and `prev` links carry it |
| `cursor` | `cql2` mode: the index cursor. The `next` link carries it |
| `bbox` | `minx,miny,maxx,maxy` in CRS84 |
| `datetime` | An instant, or `start/end` where either end may be `..` |
| `skipGeometry` | `true` returns every feature with `"geometry": null` |
| a queryable | One value, parsed by the queryable's `type` |
| `filter`, `filter-lang`, `filter-crs` | `cql2` mode only |
| `f` | `geojson` or `json` |

Any other parameter answers `400`, naming it.

A 3D `bbox` (six numbers) filters on its 2D footprint. A `bbox` with
`minx > maxx` crosses the antimeridian. In `values` mode it is sent as two
rows of the bbox `VALUES` clause, east part and west part, and a feature
that both parts match is returned once. The query's `LIMIT` counts such a
feature twice, so that page can hold one feature less. In `cql2` mode the
two parts are joined with `or`.

Each call runs the pinned version through `POST /execute` with the caller's
own `Authorization` header. The caller's grants, graph policies and caller
slots (`?authUser`, `?authGroup`) all apply, so a collection can show each
caller only their own features.

## Leaving geometry out

A map that draws its shapes from PMTiles, vector tiles or a COG needs only ids
and properties. There are two ways to leave the geometry out:

- **Per request:** `skipGeometry=true`. Map `params.skipGeometry` to a
  `VALUES` variable, and read the geometry in an `OPTIONAL` with the filter
  shown above.
- **Per collection:** `"geometry": null`. Add `geometrySources` so that a
  client finds the shapes.

Build the tiles with the same feature id as the OGC feature id: the IRI minus
`feature.base`.

## The cql2 mode

The query wraps `luc:query`, from
[`examples/ogc/jena`](../examples/ogc/jena):

```sparql
PREFIX luc:   <urn:jena:lucene:index#>
PREFIX field: <urn:jena:lucene:field#>
PREFIX geo:   <http://www.opengis.net/ont/geosparql#>
SELECT ?feature ?geom ?name ?height ?numberMatched ?cursor WHERE {
  VALUES ?feature { UNDEF }
  VALUES (?cql ?limit ?offset ?after) { (UNDEF UNDEF UNDEF UNDEF) }
  VALUES ?skip { UNDEF }
  (?hit ?feature ?score ?numberMatched ?rank ?cursor)
    luc:query ("default" "default" "" ?cql "" ?limit ?offset ?after) .
  (?hit field:name ?name) luc:fields () .
  OPTIONAL { (?hit field:buildingHeight ?height) luc:fields () }
  OPTIONAL {
    ?feature geo:hasGeometry/geo:asWKT ?geom .
    FILTER(!BOUND(?skip) || !?skip)
  }
}
ORDER BY ?rank
```

```json
"ogc": {
  "collectionId": "buildings", "title": "Buildings", "mode": "cql2",
  "feature": { "var": "feature", "base": "https://example.org/building/" },
  "geometry": "geom",
  "params": { "filter": "cql", "limit": "limit", "offset": "offset", "cursor": "after", "skipGeometry": "skip" },
  "outputs": { "numberMatched": "numberMatched", "nextCursor": "cursor" },
  "cql": { "configQuery": "<the id of the index-fields query>" },
  "queryables": { "name": { "title": "Name" }, "buildingHeight": { "title": "Height (m)" } },
  "pageSize": { "default": 10, "max": 1000 }
}
```

Every call binds every `luc:query` argument: the filter (`""` for none),
`limit + 1`, the offset (0 for none) and the cursor (`"*"` for the first
page). `numberMatched` is the index's total, from the first row. The `next`
link carries the cursor of the last row on the page.

**The filter.** A client sends `filter` as CQL2-JSON, with
`filter-lang=cql2-json`. CQL2 text answers `400`. sqlib does not convert the
filter to SPARQL. It changes only these things, on the parsed JSON:

1. A property name becomes its field IRI: `geometry` becomes the geometry
   field, a name in `cql.fields` becomes its IRI, and the local name of an
   index field becomes that field's IRI.
2. `bbox` becomes an `s_intersects` clause on the geometry field.
3. `datetime` becomes `>=` and `<=` clauses on `cql.datetimeField`. Without
   that field, `datetime` answers `400`.
4. A queryable given as a parameter becomes an `=` clause.

The clauses are combined with `and`.

**The index fields.** `cql.configQuery` names a stored query, in the same
library, that reads `luc:config`
([`index-fields.rq`](../examples/ogc/jena/index-fields.rq)). The index must
set `text:exposeConfig true`. sqlib runs the query once, as the first caller
who needs it, and keeps the result until the server restarts. From it:

- the queryables are the index fields. When the `ogc` object lists
  `queryables`, only those fields are shown and accepted;
- the geometry field is the one `LatLonField`, when `cql.geometryField` is
  not set;
- each filter clause is checked against the field's type before the call. A
  range on a text field, a text match on a number, or a spatial operator on
  anything but the geometry field answers `400`, naming the clause.

Without `configQuery`, set `cql.geometryField`, and the index refuses what it
does not accept.

**Properties from `luc:fields`.** `luc:fields` reads stored field values from
the index, with no join to the graph. With `skipGeometry=true`, the whole call
then stays in the index. It returns only fields stored on the shape itself,
not `LatLonField` values, and one row per value of a multi-valued field.

**Errors from the index.** A malformed cursor, or a cursor from another sort,
answers `400`. An index that needs a rebuild answers `500`. Any other error
from the index comes back as `/execute` sent it.

## Adding the service to QGIS

1. Open **Layer › Add Layer › Add WFS / OGC API Features Layer**.
2. Select **New**, and set the URL to `https://<host>/ogc/<slug>`.
3. When the server needs a sign-in, add a **Basic** or **API header**
   configuration with the `Authorization` header.
4. Select **Connect**, then the collection, then **Add**.

## Browser clients

Map libraries call the routes from another origin. Allow the map's origin in
the server's CORS configuration.

## Conformance tests

CI runs the OGC CITE suite for Part 1 (`ets-ogcapi-features10`) against the
plain starter set: see `scripts/ci/ogc-cite.sh`. There is no CITE suite for
Part 3 yet, so the `cql2` mode is tested against a stand-in index only
(`packages/api/test/server/ogcRoutes.cql2.test.ts`).
