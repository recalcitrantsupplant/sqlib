# OGC API Features: a GeoJSON serializer and an OGC route plugin

Status: proposal. Written 2026-11-03 against `main` at `91effb2`. This is
the detailed design for **option D** of the options paper
"OGC API Features on sqlib" (2026-11-03): a GeoJSON serializer in a shared
package, and a thin OGC API Features plugin in the API that sits on top of it.

## Summary

sqlib gets two new pieces. They are independent, and the second uses the first.

1. **`@sparql-query-lib/geojson`**: a new package with no dependencies. It has
   one pure function that turns a SPARQL JSON SELECT result into a GeoJSON
   `FeatureCollection`. `POST /execute` and the published tool routes use it
   when a caller asks for `application/geo+json`. The browser runtime and the
   web app can use the same function later.
2. **An OGC API Features route plugin** under `/ogc/{slug}`. A query version
   opts in with an `ogc` object, next to its `tool` object. The plugin
   generates the landing page, conformance, OpenAPI document and collection
   metadata at startup. Only `items` and `items/{featureId}` run a query. They
   run it through `POST /execute` with `app.inject`, as the published tools do,
   so the caller's grants, the pinned version and the environment rules all
   apply unchanged.

Two kinds of collection are supported. Each kind has a starter query set:

- **`values` mode**, for any backend. `bbox`, `datetime`, property filters,
  `limit`, `offset` and `featureId` become ordinary `VALUES` rows and
  `LIMIT`/`OFFSET` parameters. There is no `filter` parameter.
- **`cql2` mode**, for Fuseki with the Kurrawong `jena-text` Lucene index.
  The plugin passes a CQL2-JSON `filter` through to `luc:query` in one
  `VALUES` variable. The index does the filtering, the paging and the count.
  sqlib never converts CQL2 to SPARQL.

The plugin adds no new parameter kind and no new way to run a query. It
translates OGC request syntax into a published-tool call, and translates the
SELECT result into an OGC response.

```
GET /ogc/{slug}/collections/{id}/items?bbox=…&limit=…
        │
        ▼
 OGC plugin ── parse OGC params ──► plain values ──► buildPublishedExecuteBody()
        │                                                   │
        │                              app.inject POST /execute (caller's Authorization)
        │                                                   │
        ◄────────── SPARQL JSON SELECT result ◄─────────────┘
        │
        ├─ toFeatureCollection()   (@sparql-query-lib/geojson)
        └─ add id, links, numberReturned, numberMatched, timeStamp
        ▼
 application/geo+json
```

## Goals and non-goals

Goals:

- QGIS, OpenLayers, Leaflet (with an OGC client) and pygeoapi harvesters can
  read a sqlib collection with no server in front of sqlib.
- The server passes the OGC CITE test suite for Features Part 1 Core and the
  GeoJSON class (`ets-ogcapi-features10`).
- Any SELECT can return GeoJSON, with or without OGC, through `Accept`.
- The Jena set offers Part 3 filtering by pushdown only.

Non-goals for v1:

- Part 2 (CRS other than CRS84, `crs`, `bbox-crs`). Output is always CRS84.
- Part 3 on the `values` mode collections. A `filter` there is a `400`.
- `cql2-text`. The index takes CQL2-JSON only, and a text parser is out of
  scope by decision.
- Part 4 (create, replace, update and delete of features).
- HTML pages. The conformance document does not declare `html`.
- GeoJSON for ASK, CONSTRUCT and DESCRIBE results. A graph-to-features
  mapping (GeoJSON-LD framing) is a separate design.
- Reprojection. sqlib swaps axes for known lat/lon CRSs and does nothing else.
- Query groups as collection targets. See [Later work](#later-work).

## Part 1: the GeoJSON serializer

### Package

Add `packages/geojson`, published in the workspace as
`@sparql-query-lib/geojson`. It has no runtime dependencies, so the browser
runtime (`packages/runtime`) and the web app can import it without a bundle
cost. It must not import the API, the parser or Node built-ins.

Files:

| File | Content |
| --- | --- |
| `src/index.ts` | Exports |
| `src/types.ts` | `SelectResults`, `ResultTerm`, the GeoJSON types, `GeoJsonOptions` |
| `src/wkt.ts` | WKT parser |
| `src/crs.ts` | CRS IRI table and axis order |
| `src/columns.ts` | Choice of the id, geometry and point columns |
| `src/properties.ts` | RDF term to JSON value |
| `src/featureCollection.ts` | `toFeatureCollection` |
| `test/*.test.ts` | Unit tests, one file for each source file |

`SelectResults` and `ResultTerm` are copied from
`packages/api/src/lib/sparqlResultsFormats.ts`, which then imports them from
the new package. That keeps one definition of the SPARQL JSON shape.

### API

```ts
export type GeoJsonOptions = {
  /** The column that gives each feature its id. Default: see "Columns". */
  idVar?: string;
  /** The column that holds a WKT or GeoJSON literal. */
  geometryVar?: string;
  /** Two numeric columns that make a Point, longitude first. */
  pointVars?: [lonVar: string, latVar: string];
  /** Every feature gets `"geometry": null`, and no geometry column is looked for. */
  noGeometry?: boolean;
  /** Columns left out of `properties` (control columns such as a cursor). */
  omitVars?: string[];
  /** Turn a feature IRI into the id the caller sees. Default: the IRI itself. */
  idFromIri?: (iri: string) => string | number;
};

export type GeoJsonResult =
  | { ok: true; collection: FeatureCollection }
  | { ok: false; reason: GeoJsonFailure; detail: string };

export type GeoJsonFailure = 'no-geometry-column' | 'unsupported-crs' | 'invalid-geometry';

export function toFeatureCollection(results: SelectResults, options?: GeoJsonOptions): GeoJsonResult;

/** The geometry column `toFeatureCollection` would pick, or null. For negotiation. */
export function findGeometryColumn(results: SelectResults, options?: GeoJsonOptions): string | null;

export function parseWkt(literal: string): Geometry | null;   // throws WktError
export const GEOJSON_MEDIA_TYPE = 'application/geo+json';
```

The function returns a result object and does not throw for bad data. The
caller decides the HTTP status, because `/execute` and the OGC plugin answer a
failure differently.

### Columns

The serializer picks its columns in this order:

1. **Geometry.** `geometryVar` if given. Else the first column whose first
   bound value has the datatype `geo:wktLiteral` or `geo:geoJSONLiteral`.
   Else `pointVars` if given. Else a pair of columns named (`lon` or `long`
   or `lng` or `longitude`) and (`lat` or `latitude`), both numeric.
   If no geometry column is found, the result is `no-geometry-column`.
2. **Id.** `idVar` if given. Else a column named `feature`, then `id`, then
   the first column whose first bound value is an IRI. A feature with no id
   value has no `id` member, which RFC 7946 allows.
3. **Properties.** Every other column, minus `omitVars`.

The "first bound value" rule checks a column's datatype once, on the first
row where it is bound. A later row of a different datatype in the same column
is converted by its own datatype, not the first one.

### Geometry

- **`geo:geoJSONLiteral`.** Parse it as JSON and use it as is. GeoSPARQL 1.1
  defines this literal as CRS84, so there is no axis swap. Invalid JSON gives
  `invalid-geometry`.
- **`geo:wktLiteral`.** An optional CRS IRI in angle brackets comes first,
  then the WKT text. Parse the WKT, then apply the CRS rule below.
- **Point columns.** Two numeric literals make a `Point`. The order in
  `pointVars` is longitude, then latitude.
- **Unbound or empty.** An unbound geometry, or a WKT `EMPTY` geometry,
  gives `"geometry": null`. RFC 7946 allows this.

The WKT parser supports `POINT`, `LINESTRING`, `POLYGON`, `MULTIPOINT`
(with and without the inner parentheses), `MULTILINESTRING`, `MULTIPOLYGON`
and `GEOMETRYCOLLECTION`. It accepts `Z`, `M` and `ZM`. It keeps Z as the third
coordinate and drops M. Keywords are case-insensitive. The parser is a small
hand-written tokenizer and recursive descent, about 150 lines. We do not take
a dependency: the maintained WKT libraries are larger than the need, and the
runtime package must stay free of dependencies. Kurrawong's
`demo/app-static/wkt.js` is a usable reference for the grammar.

### CRS

GeoJSON coordinates are longitude, latitude in CRS84. The serializer knows a
short, fixed table of CRS IRIs:

| CRS IRI | Axis order | Action |
| --- | --- | --- |
| none | lon, lat | none (GeoSPARQL default is CRS84) |
| `http://www.opengis.net/def/crs/OGC/1.3/CRS84` | lon, lat | none |
| `http://www.opengis.net/def/crs/OGC/1.3/CRS84h` | lon, lat, h | none |
| `http://www.opengis.net/def/crs/EPSG/0/4326` | lat, lon | swap |
| `http://www.opengis.net/def/crs/EPSG/0/4283` (GDA94) | lat, lon | swap |
| `http://www.opengis.net/def/crs/EPSG/0/7844` (GDA2020) | lat, lon | swap |

The `https` spelling of each IRI is accepted too. Any other CRS gives
`unsupported-crs`, and the detail names the IRI.

The GDA94 and GDA2020 rows treat the datum as equal to WGS84. GDA2020 is
within a few centimetres of it, and GDA94 is within about 1.8 m today. This
is the same rule the Kurrawong index uses, so the map and the index agree.
The rule is stated in the guide. It is not a transform.

### Properties

Each property is one JSON value, from the RDF term:

| Term | JSON |
| --- | --- |
| IRI | the IRI as a string |
| `xsd:integer` and its derived types, `xsd:decimal`, `xsd:double`, `xsd:float` | a number. An integer outside the safe range (2^53) stays a string, so no digits are lost |
| `NaN`, `INF`, `-INF` | a string |
| `xsd:boolean` | `true` or `false` |
| any other literal, a language-tagged literal | its lexical form as a string |
| blank node | `_:label` |
| unbound | the key is left out |

A column of geometry literals that is not the chosen geometry column stays a
string property.

### `POST /execute` and the published tool routes

`packages/api/src/lib/sparqlResultsFormats.ts` gets one more media type,
`application/geo+json`, in the same negotiation as CSV, TSV and XML.
`renderRequestedSelectFormat` in `routes/execute.ts` calls
`toFeatureCollection` for it. Two rules differ from the other formats:

- **A refusal is possible.** Today an `Accept` that names no format sqlib
  knows is ignored, on purpose. A caller that names `application/geo+json`
  asked for this format by name, so a failure answers `406` with the reason:
  `{ "error": "The result has no geometry column: no column holds a geo:wktLiteral or geo:geoJSONLiteral, and no lat/long pair was found." }`.
  `unsupported-crs` and `invalid-geometry` also answer `406`, with the CRS
  IRI or the row number.
- **Only SELECT.** For an ASK, CONSTRUCT or DESCRIBE target with this
  `Accept`, `/execute` answers `406`.

The serializer has no options on `/execute`: it uses the column rules above.
A query whose columns do not follow them names its columns with
`?feature` and a WKT column, or uses the OGC plugin, which takes its columns
from the `ogc` object.

Published tool routes (`GET /tools/{slug}/{name}`) already forward `Accept`.
They also accept `?f=geojson`, because a link in a browser or a QGIS "add
layer from URL" cannot set a header. The route turns `f=geojson` into
`Accept: application/geo+json` before `app.inject`. `f` becomes a reserved
argument name, like `backendId`: `checkToolObject` refuses a parameter named
`f`. The OpenAPI document for the library lists `f` on every GET operation,
and `application/geo+json` as a response type on every SELECT tool.

`POST /execute` does not read `f`. It keeps `Accept` only.

## Part 2: the OGC route plugin

### Where it runs

| Setting | Effect |
| --- | --- |
| `FEATURE_OGC` (new feature flag, default off) | Off: no `/ogc` routes are registered, and the `ogc` object is still stored and checked |
| `MCP_CATALOGUE=catalogue` | No `/ogc` routes, as for `/tools` |
| `MCP_CATALOGUE=both` or `published` | `/ogc` routes are registered |
| `SQLIB_OGC_BASE_URL` (new, optional) | The absolute URL that OGC links start with. Unset: built from the request (`request.protocol`, `request.host`, which honour `trustProxy`) and `APP_PUBLIC_BASE_PATH` |

The flag is added to `FEATURE_FLAG_KEYS` in `packages/types/src/featureFlags.ts`
as `ogc` / `FEATURE_OGC`.

The plugin lives in `packages/api/src/server/ogcRoutes.ts`, beside
`publishedToolRoutes.ts`, and for the same reason: its routes come from the
store at startup, so they are not in `src/routes/` and the auth
route-coverage test does not list them one by one. Each `items` route reaches
`POST /execute` through `app.inject`, so `/execute`'s own check applies.

The metadata routes (landing page, conformance, API, collections, queryables)
return documents built at startup. They read nothing from the store at request
time. They are open to every caller who can reach the server, as
`/tools/{slug}/openapi.json` is today. See [Open questions](#open-questions)
for whether that is right for the metadata of a private library.

In `published` mode, `config/catalogueMode.ts` narrows `/execute` to pinned
targets. Its check `getPublishedCatalogue().specs.some(spec => spec.targetId === targetId)`
must also accept the pinned versions of OGC collections. The catalogue gets a
second list, `collections`, and the check reads both.

### The `ogc` object

A query version carries an optional `ogc` object, stored the same way as
`tool`: a JSON literal on the version (`sqlib:ogc`, `rdf:JSON`, shape
`OgcCollection`), in `QueryVersionSchema.ts`. A save that sends no `ogc`
copies the previous version's, and the copy is checked again against the new
text. `null` clears it. This follows `resolveVersionTool` in
`lib/toolObject.ts` line for line, so a new function `resolveVersionOgc` sits
beside it.

The `ogc` object does not need a `tool` object. A query can be a collection,
a tool, or both. Both need the library's `slug`.

```jsonc
"ogc": {
  "collectionId": "buildings",            // ^[A-Za-z0-9_-]{1,64}$, unique in the library
  "title": "Buildings",
  "description": "Building footprints from the 2026 survey.",
  "mode": "values",                       // "values" | "cql2"

  "feature": {
    "var": "feature",                     // the id column, and the VALUES variable for featureId
    "base": "https://example.org/building/"  // featureId = IRI minus base
  },
  "geometry": "geom",                     // a WKT or geoJSON literal column
  // or: "point": ["lon", "lat"]
  // or: "geometry": null                 // no geometry: every feature has "geometry": null

  "geometrySources": [                    // optional: where a map gets the shapes instead
    { "href": "https://tiles.example.org/buildings.pmtiles", "type": "application/vnd.pmtiles", "title": "Building footprints" }
  ],

  "params": {
    "limit": "1",                         // values mode: a LIMIT parameter name
    "offset": "2",                        // values mode: an OFFSET parameter name
    "bbox": ["minx", "miny", "maxx", "maxy"],  // values mode: four variables of one VALUES tuple
    "datetime": ["start", "end"],         // values mode: two variables of one VALUES tuple
    "skipGeometry": "skip"                // optional: a VALUES variable, kind boolean
  },

  "queryables": {
    "name":   { "var": "name",   "type": "string",  "title": "Name" },
    "height": { "var": "height", "type": "number" }
  },

  "pageSize": { "default": 10, "max": 1000 },
  "extent": {
    "spatial":  [[112.9, -43.7, 153.7, -10.6]],
    "temporal": [["2026-01-01T00:00:00Z", null]]
  },
  "omit": ["score"]                       // result columns kept out of properties
}
```

For `cql2` mode, `params` names `VALUES` variables, because `luc:query` takes
its paging as arguments, and adds the pushdown settings:

```jsonc
"mode": "cql2",
"params": {
  "filter": "cql",                        // CQL2-JSON text, one literal
  "limit": "limit",                       // a VALUES variable, kind integer
  "offset": "offset",                     // a VALUES variable, kind integer
  "cursor": "after"                       // a VALUES variable, kind string
},
"outputs": {
  "numberMatched": "numberMatched",       // a column; the first row's value is the total
  "nextCursor": "cursor"                  // a column; the last kept row's value goes in the next link
},
"cql": {
  "configQuery": "urn:…:query/ogc-index-fields",  // optional: a stored query over luc:config, see below
  "geometryField": "urn:jena:lucene:field#location",  // optional with configQuery: the one LatLonField
  "datetimeField": "urn:jena:lucene:field#observed",  // optional; without it, datetime is a 400
  "fields": { "height": "urn:jena:lucene:field#buildingHeight" }  // queryable name → field IRI, when they differ
}
```

Field references are field IRIs, as the Kurrawong API prefers. The index
also accepts an `idx:fieldName`, but that is its internal Lucene name.

#### Fields from `luc:config`

The Kurrawong index has a `luc:config` property function. With
`text:exposeConfig true` on the index, it returns the index configuration as
triples: every field IRI, its `idx:fieldType`, and whether it is facetable.
So a `cql2` collection does not need to repeat the index's fields in its
`ogc` object.

`cql.configQuery` names a stored SELECT in the same library that reads it.
The starter set ships this one:

```sparql
PREFIX luc: <urn:jena:lucene:index#>
PREFIX idx: <urn:jena:lucene:index#>
SELECT ?field ?type ?facetable WHERE {
  (?field idx:fieldType ?type) luc:config ("default") .
  OPTIONAL { (?field idx:facetable ?facetable) luc:config ("default") }
}
```

The plugin runs it on the first request that needs it, through `/execute`
with that caller's `Authorization`, and keeps the result for the life of the
process. A failed run is not kept, so the next request tries again. The
plugin uses the result for three things:

1. **Queryables.** One property per field. The type follows `idx:fieldType`:
   `KeywordField` and `TextField` are `string`, `IntField` and `LongField`
   are `integer`, `DoubleField` is `number`, `TemporalField` is `string`
   with `format: date-time`, and `LatLonField` is `geometry`, with
   `format: geometry-any`. The property name is the field IRI's local name.
   When the `ogc` object also has `queryables`, that list is an allowlist
   and gives titles: only those fields are shown and accepted.
2. **Geometry field.** When `cql.geometryField` is absent and the index has
   exactly one `LatLonField`, that field is used. Zero or two answers `500`
   on a `bbox` call, with a message that says to set `cql.geometryField`.
3. **A check before the call.** The plugin walks the filter and checks each
   `property` against the field list, and each operator against the field
   type, using the index's own rules (no range on a `KeywordField`, no
   `like` or `text_query` on a numeric, temporal or spatial field). A
   mismatch answers `400` naming the clause, before Fuseki runs anything.
   See [Errors from the index](#errors-from-the-index) for why.

Without `configQuery`, queryables come from `queryables` alone and the
check before the call is skipped.

### The check when a version is saved

`checkOgcObject(ogc, inputs, queryType)` lives in
`packages/tools/src/ogc.ts`, so the API and any later client share it. It
returns the first problem as a message that names the key, or null. The save
answers `400` with that message, as it does for `tool`.

It checks:

- The query is a SELECT.
- `collectionId`, `title` and `mode` are present and well formed.
- `feature.var` is a result variable, and a `VALUES` variable of the version.
  `feature.base` is an absolute IRI.
- Exactly one of `geometry` and `point` is given, and each names a result
  variable, or `geometry` is `null`. With `geometry: null`,
  `params.skipGeometry` is refused, since there is nothing to skip.
- `params.skipGeometry`, when given, is a `VALUES` variable on its own
  in its tuple. Result variables come from the parsed projection. A `SELECT *`
  is accepted, and only the `VALUES` checks apply to it.
- Every name in `params` exists in the version's inputs, in the right place:
  - `values` mode: `limit` in `inputs.limits`, `offset` in `inputs.offsets`.
    The four `bbox` variables are the whole of one `VALUES` tuple, in any
    order. The two `datetime` variables are the whole of one tuple.
    A query without a `limit` parameter is refused: an unbounded `items`
    call could return the whole store.
  - `cql2` mode: `filter`, `limit`, `offset` and `cursor` are `VALUES`
    variables. `limit` is required. `outputs` name result variables.
    `cql.geometryField` is present.
- Each `queryables` entry's `var` is a `VALUES` variable not used by
  `params` or `feature`, and its `type` is one of `string`, `number`,
  `integer`, `boolean`, `date-time`, `uri`. In `cql2` mode `var` is not used:
  queryables only describe the index fields.
- No `queryables` key is a reserved OGC parameter name: `f`, `bbox`,
  `datetime`, `limit`, `offset`, `cursor`, `filter`, `filter-lang`,
  `filter-crs`, `crs`, `bbox-crs`, `properties`, `sortby`, `skipGeometry`.
- `pageSize.default` ≤ `pageSize.max` ≤ 10000.
- A version slot that `params` uses is not marked `whenEmpty: require`
  (`docs/proposals/required-arguments.md`). The OGC parameters are all
  optional, so a required slot would turn every plain `items` call into a
  `400`.

At startup, `collectOgcCollections()` in `lib/publishedTools.ts` collects
every collection with the same rules `collectPublishedTools` uses: the
version the deployment's environment points to, else the current one; a
library with no slug is a problem line; two collections with one id in one
library is a problem line; a missing default backend is a problem line.
What a problem costs follows `MCP_CATALOGUE`, as for tools: log and skip in
`both`, refuse to start in `published`.

Each collection becomes an `OgcCollectionSpec`. It holds a synthesized
`PublishedToolSpec` (target, backend, inputs, and one param per `VALUES`
variable the `ogc` object names, with its kind), so `items` calls
`buildPublishedExecuteBody` and nothing new builds `/execute` bodies.

| `ogc` name | Synthesized param kind |
| --- | --- |
| `feature.var` | `iri` |
| `bbox` variables | `decimal` |
| `datetime` variables | `dateTime` |
| `limit`, `offset` (values mode) | `integer` (page parameter) |
| `limit`, `offset` (cql2 mode) | `integer` |
| `filter`, `cursor` | `string` |
| queryable `string`, `uri` | `string`, `iri` |
| queryable `number`, `integer`, `boolean`, `date-time` | `decimal`, `integer`, `boolean`, `dateTime` |

### Routes

All paths are under `{APP_PUBLIC_BASE_PATH}/ogc/{slug}`. One library slug is
one OGC service. Every route answers `GET` and `HEAD`.

| Route | Built | Content-Type |
| --- | --- | --- |
| `/` | startup | `application/json` |
| `/conformance` | startup | `application/json` |
| `/api` | startup | `application/vnd.oai.openapi+json;version=3.0` |
| `/collections` | startup | `application/json` |
| `/collections/{collectionId}` | startup | `application/json` |
| `/collections/{collectionId}/queryables` | startup | `application/schema+json` |
| `/collections/{collectionId}/items` | per request | `application/geo+json` |
| `/collections/{collectionId}/items/{featureId}` | per request | `application/geo+json` |

The routes are registered under fixed patterns, with `slug` and
`collectionId` as path parameters looked up in a map. Not one route per
collection: the OGC OpenAPI document is written by hand from the spec, not
from Fastify's route schemas, so a fixed set of seven routes is simpler.

#### Landing page

```json
{
  "title": "Survey library",
  "description": "…",
  "links": [
    { "rel": "self", "type": "application/json", "href": "https://host/ogc/survey/" },
    { "rel": "service-desc", "type": "application/vnd.oai.openapi+json;version=3.0", "href": "https://host/ogc/survey/api" },
    { "rel": "conformance", "type": "application/json", "href": "https://host/ogc/survey/conformance" },
    { "rel": "data", "type": "application/json", "href": "https://host/ogc/survey/collections" }
  ]
}
```

Title and description come from the library.

#### Conformance

Every service declares Part 1:

- `http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/core`
- `http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/geojson`
- `http://www.opengis.net/spec/ogcapi-features-1/1.0/conf/oas30`

A service with at least one `cql2` collection also declares Part 3 and CQL2
classes:

- `http://www.opengis.net/spec/ogcapi-features-3/1.0/conf/queryables`
- `http://www.opengis.net/spec/ogcapi-features-3/1.0/conf/filter`
- `http://www.opengis.net/spec/ogcapi-features-3/1.0/conf/features-filter`
- `http://www.opengis.net/spec/cql2/1.0/conf/cql2-json`
- `http://www.opengis.net/spec/cql2/1.0/conf/basic-cql2`
- `http://www.opengis.net/spec/cql2/1.0/conf/basic-spatial-functions`

Conformance is declared per service, not per collection, but a `values`
collection refuses `filter`. Part 3 lets a server support filtering on some
collections only, and a collection without filtering lists no `filter` link
and no `filter` parameter in the API document. Check the final CQL2 class
URIs against the published standard when building; the class names changed
between drafts. Declare only the CQL2 classes the Kurrawong index passes.

#### API document

`ogcOpenApiDocument(service)` in `packages/tools/src/ogc.ts` writes an
**OpenAPI 3.0.3** document. The `oas30` class requires 3.0, and the existing
`publishedOpenApiDocument` writes 3.1, so this is a separate function. The
schemas are simple enough to write in the subset common to both (no type
arrays, `nullable` where needed).

It has one path per route. For `items`, each collection gets its own path
(`/collections/buildings/items`), so each lists its own parameters: the
OGC parameters it supports and its queryables. That per-collection list is
what the unknown-parameter rule below checks against.

#### Collections and one collection

```json
{
  "id": "buildings",
  "title": "Buildings",
  "description": "…",
  "itemType": "feature",
  "crs": ["http://www.opengis.net/def/crs/OGC/1.3/CRS84"],
  "extent": {
    "spatial": { "bbox": [[112.9, -43.7, 153.7, -10.6]], "crs": "http://www.opengis.net/def/crs/OGC/1.3/CRS84" },
    "temporal": { "interval": [["2026-01-01T00:00:00Z", null]], "trs": "http://www.opengis.net/def/uom/ISO-8601/0/Gregorian" }
  },
  "links": [
    { "rel": "self", "type": "application/json", "href": "…/collections/buildings" },
    { "rel": "items", "type": "application/geo+json", "href": "…/collections/buildings/items" },
    { "rel": "http://www.opengis.net/def/rel/ogc/1.0/queryables", "type": "application/schema+json", "href": "…/collections/buildings/queryables" }
  ]
}
```

`extent` is left out when the `ogc` object has none. The extent is static in
v1. A computed extent is in [Later work](#later-work).

#### Queryables

A JSON Schema (2020-12) document built from `queryables`, with
`"$id"` set to the route's URL, `"type": "object"` and one property per
queryable. In `cql2` mode the list comes from `luc:config` (see
[Fields from `luc:config`](#fields-from-lucconfig)) and includes the geometry
field. Every collection serves it, but only `cql2` collections accept
`filter`.

#### Items

The request handling, in order:

1. **Unknown parameters.** Any query parameter that is not in this
   collection's list answers `400`, naming it. Core requires this. The list
   is: `f`, `limit`, `bbox`, `datetime`, `skipGeometry` (when the collection
   maps it), the queryable names, and per mode
   `offset` (values) or `filter`, `filter-lang`, `filter-crs`, `cursor`
   (cql2). `offset` and `cursor` are what the `next` links carry. They are in
   the API document, so clients may send them.
2. **`f`.** `geojson` or `json`, or absent. Anything else answers `400`.
3. **`limit`.** An integer ≥ 1. Absent: `pageSize.default`. Above
   `pageSize.max`: use the maximum. Core says this is not an error.
4. **`bbox`.** Four comma-separated numbers, or six (3D), which filter on
   their 2D footprint. `minx > maxx` crosses the antimeridian: the box is
   split at 180 into two, sent as two `VALUES` rows (or a CQL2 `or`).
   Latitudes outside −90..90 answer `400`.
5. **`datetime`.** An RFC 3339 instant, or an interval `a/b` where either
   end may be `..` or empty. An instant fills both variables. An open end is
   left unbound. `a > b` answers `400`. A collection with no `datetime`
   mapping answers `400` for it.
6. **Queryables as parameters.** Each one is a single value, parsed by its
   type. A comma-separated value is not split: a value can hold a comma.
7. **Build the call.**
   - `values` mode: `bbox` and `datetime` fill their tuples, queryables fill
     their variables, `limit` gets **limit + 1**, `offset` gets the request's
     offset or 0.
   - `cql2` mode: see [The `cql2` mode](#the-cql2-mode).
   Then `buildPublishedExecuteBody(spec.tool, values)`.
8. **Run.** `app.inject` `POST /execute` with the caller's `Authorization`,
   and `Accept: application/sparql-results+json`. The plugin serializes, not
   `/execute`, because it needs the raw rows to find the next page and the
   control columns.
   A non-200 from `/execute` is passed through with its status and body:
   `401`, `403`, a `400` from argument checks, a `504` on a timeout.
9. **Serialize.** `toFeatureCollection(results, { idVar, geometryVar or pointVars, omitVars, idFromIri })`.
   `omitVars` is `omit` plus the `outputs` columns. `idFromIri` strips
   `feature.base`; an IRI that does not start with the base keeps its full
   IRI as its id.
   A serializer failure answers `500` with the reason. It is a collection
   that is set up wrong, not a bad request.
10. **Page.** If there are more than `limit` features, drop the extra one
    and add a `next` link. Duplicate feature ids in one page answer `500`:
    the query returns more than one row per feature, and pages would split
    features. The guide tells authors to `GROUP BY ?feature` or to page the
    feature IRIs in a subquery.
11. **Envelope.** Add `links` (`self`, `alternate` for `f=json`, `next`,
    `prev` when offset > 0 in values mode, `collection`), `numberReturned`,
    `numberMatched` when the collection has one, and `timeStamp`. Each
    feature gets `links` with `self` and `collection`.

`self` and `next` links keep every parameter of the request and change only
`offset` or `cursor`. They are absolute URLs.

The response passes through `Server-Timing` and `Cache-Control` from
`/execute`. It sets no `ETag` in v1.

#### One item

`/items/{featureId}` decodes the path segment and prefixes `feature.base`.
It binds `feature.var` to that IRI and runs the same query with `limit`
set to 2 and no other parameters. Zero rows answers `404`. Two features with
the same id answers `500`, as above. One feature answers that `Feature`,
with `self` and `collection` links.

In `cql2` mode the item is found with the filter
`{"op":"=","args":[{"property":"entityIri"},"<IRI>"]}`, unless the starter query
binds `?feature` before `luc:query`, in which case the `VALUES` row is
enough. The starter set chooses one; see the open check below.

### The `cql2` mode

In `cql2` mode the stored query is a thin wrapper around `luc:query`. The
plugin passes the whole filter to the index as one string. sqlib only does
the edits that need no parser: field renames and two added clauses, all on
the parsed JSON tree.

1. **`filter-lang`.** `cql2-json`, or absent. `cql2-text` answers `400`:
   "This collection accepts filter-lang=cql2-json only." Absent means
   `cql2-text` by Core default for GET, so a `filter` without
   `filter-lang=cql2-json` answers `400` too.
2. **`filter-crs`.** CRS84, or absent. Anything else answers `400`.
3. **`filter`.** Parse it as JSON. A parse error answers `400`.
4. **Rename fields.** Walk the tree. For each `{"property": name}`:
   `geometry` becomes the geometry field, a name in `cql.fields` or a
   queryable from `luc:config` becomes its field IRI, and a name that is
   already a field IRI is kept. Any other name answers `400`, naming it.
   Without `configQuery`, an unknown name is kept and the index refuses it.
5. **Add `bbox`.** `{"op":"s_intersects","args":[{"property":"<geometryField>"},{"bbox":[minx,miny,maxx,maxy]}]}`.
6. **Add `datetime`.** The index documents `=` and ranges on a
   `TemporalField`, not the CQL2 `t_` operators. So an interval becomes
   `{"op":">=","args":[{"property":"<datetimeField>"},{"timestamp":"a"}]}`
   and the matching `<=` clause, with no clause for an open end. An instant
   becomes one `=` clause. The literal form the index takes for a time value
   is one of the checks below.
7. **Add queryables given as parameters.** `{"op":"=","args":[{"property":"<field>"},value]}`.
8. **Combine.** One clause stays as it is. More than one becomes
   `{"op":"and","args":[…]}`. No clause leaves the `filter` variable unbound.
9. **Bind.** Every `luc:query` argument is bound, because its parsing is
   fixed-arity and an unused filter is `""`, not unbound. `filter` gets the
   serialized JSON or `""`, `limit` gets **limit + 1**, `offset` gets the
   request's offset or 0, and `cursor` gets the request's `cursor`, or `"*"`
   for the first page.

#### Errors from the index

The index applies a filter in full or refuses the query, naming the clause.
Through Fuseki, every `luc:query` error is an HTTP `500` with a `text/plain`
body. Only three errors carry a fixed marker:
`[LUC_CURSOR_MALFORMED]`, `[LUC_CURSOR_OTHER_SORT]` and
`[LUC_ENTITY_SORT_NEEDS_REBUILD]`. A refused filter clause has no marker.

So the plugin maps errors like this:

| Index error | Plugin answer |
| --- | --- |
| `[LUC_CURSOR_MALFORMED]`, `[LUC_CURSOR_OTHER_SORT]` | `400`: the `cursor` parameter is not valid |
| `[LUC_ENTITY_SORT_NEEDS_REBUILD]` | `500`: the index needs a rebuild |
| A field or operator problem the check before the call finds | `400`, before the call |
| Any other error | passed through from `/execute`, with the index's message |

The check before the call catches the refusals the Kurrawong docs list. A
marker on filter refusals, such as `[LUC_FILTER_REFUSED]`, would let the
plugin drop its own copy of those rules. That is a small request to make of
the index.

`numberMatched` is the value of `outputs.numberMatched` in the first row
(the index's `?totalHits`). `next` carries `cursor=<last kept row's outputs.nextCursor>`
and drops `offset`. There is no `prev` link in cursor mode.

### Features without geometry

Geometry is often most of a response's size and most of the backend's work:
a WKT polygon is read, sent and parsed for every feature. A map that draws
its shapes from PMTiles, vector tiles or a COG needs only ids and
properties from sqlib. GeoJSON allows `"geometry": null`, so a feature
without its geometry is still a valid feature, and the OGC Core and GeoJSON
classes still pass.

There are two ways to leave geometry out.

**Per request: `skipGeometry=true`.** This name is not in OGC Features
Part 1, but pygeoapi and other servers use it, so clients know it. It is in
the collection's API document, so the unknown-parameter rule does not refuse
it. The value is `true` or `false`, and anything else answers `400`.

Leaving the geometry out of the JSON is not enough, because the backend has
already read it. So the collection maps `params.skipGeometry` to a `VALUES`
variable, and the query reads the geometry only when the flag is not true:

```sparql
VALUES ?skip { UNDEF }
OPTIONAL {
  ?feature geo:hasGeometry/geo:asWKT ?geom .
  FILTER(!BOUND(?skip) || !?skip)
}
```

A `FILTER` at the top level of an `OPTIONAL` is the condition of the left
join, so it can see `?skip` from outside, and the store does not read the
WKT for a skipped call. The plugin binds `?skip` only when the request says
`skipGeometry=true`. The serializer is then called with `noGeometry`, so a
query that reads the geometry anyway still answers without it.

The `OPTIONAL` changes one thing: a feature with no geometry at all is now
returned, with `"geometry": null`, where a required pattern dropped it. The
guide states this.

**Per collection: `"geometry": null`.** The query has no geometry column, and
every feature has `"geometry": null`. This suits a collection that exists
only to serve attributes for a tile layer.

**Where the shapes are.** `geometrySources` adds one link per source to the
collection document, with `rel: "alternate"` and the given `type`, so a
client can find the PMTiles or COG for the collection. sqlib does not read
or check these URLs.

**Joining tiles to features.** A map joins a tile feature to an OGC feature
by id. The tile's feature id, or the property the map joins on, must hold
the same value as the OGC `featureId`, which is the IRI minus `feature.base`.
The guide says to build the tiles with that id. `bbox` filtering does not
need the geometry: in `values` mode it reads the stored envelope, and in
`cql2` mode the index.

### Auth

The plugin adds no auth rule of its own. Every `items` call is a `/execute`
call with the caller's `Authorization`, so:

- the caller's grants decide whether the query runs, and on which backend;
- graph policies apply to the backend read;
- `?authUser` and `?authGroup` slots are filled from the sign-in, so a
  collection can show each caller only their own features;
- in `anonymous` mode, a visitor can read a collection when the anonymous
  principal may run the query. That is the way to make collections public.

GIS clients send fixed headers or Basic auth easily. QGIS also supports
OAuth2 through its authentication manager, but the setup is harder for
users. A long-lived token in a fixed `Authorization` header is the
documented path for QGIS.

### CORS

Browser map clients call the routes from another origin. The routes use the
server's existing CORS configuration (`config/cors.ts`). The guide says to
allow the map's origin there.

## Part 3: starter query sets

Both sets ship as a library in `sqlib-demo` (`instances/main/library`), each
with one demo collection, and as copies in `docs/examples/ogc/`. Both return
the same columns, `?feature ?geom ?name ?height`, so a client sees the same
feature shape from either.

### Plain SPARQL (`values` mode)

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

```json
"ogc": {
  "collectionId": "buildings", "title": "Buildings", "mode": "values",
  "feature": { "var": "feature", "base": "https://example.org/building/" },
  "geometry": "geom",
  "params": { "limit": "1", "offset": "2", "bbox": ["minx","miny","maxx","maxy"], "datetime": ["start","end"], "skipGeometry": "skip" },
  "queryables": { "name": { "var": "name", "type": "string" } },
  "pageSize": { "default": 10, "max": 500 }
}
```

Notes for the guide:

- Every filter on a parameter starts with `!BOUND(?x) ||`. An absent
  parameter leaves its variable unbound, and a comparison with an unbound
  variable is an error that drops the row.
- The bbox test uses a stored envelope (four numbers per feature). It scans
  every feature, which is fine for thousands of features. A backend with
  GeoSPARQL can use `geof:sfIntersects` with a polygon built by `BIND(STRDT(CONCAT("POLYGON((", …)), geo:wktLiteral))`
  from the four numbers instead. The guide shows both.
- `ORDER BY` makes pages stable. `OFFSET` rescans earlier rows, so deep pages
  are slow.

### Jena with the Kurrawong Lucene index (`cql2` mode)

```sparql
PREFIX luc:   <urn:jena:lucene:index#>
PREFIX field: <urn:jena:lucene:field#>
PREFIX geo:   <http://www.opengis.net/ont/geosparql#>
SELECT ?feature ?geom ?name ?height ?numberMatched ?cursor WHERE {
  VALUES (?cql ?limit ?offset ?after) { (UNDEF UNDEF UNDEF UNDEF) }
  VALUES ?skip { UNDEF }
  # indexSelector fieldSpec queryString cqlFilter sortSpec limit offset after
  (?hit ?feature ?score ?numberMatched ?rank ?cursor)
    luc:query ("default" "default" "" ?cql "" ?limit ?offset ?after) .
  # Properties from stored index fields: no join to the graph.
  (?hit field:name ?name) luc:fields () .
  OPTIONAL { (?hit field:buildingHeight ?height) luc:fields () }
  # The geometry from the graph, unless the call skips it.
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
  "cql": { "configQuery": "urn:…:query/ogc-index-fields" },
  "queryables": { "name": { "title": "Name" }, "height": { "title": "Height (m)" } },
  "pageSize": { "default": 10, "max": 1000 }
}
```

The argument positions and the subject list follow the Kurrawong
`docs/02-sparql-api.md`, as read on 2026-11-03: eight arguments, with
`after` last, and six subject slots, `(?hit ?entity ?score ?totalHits ?rank ?cursor)`.
The query reads `?totalHits` into `?numberMatched`. A sort is left as `""`,
so the order is relevance order, and the cursor stays valid across pages.

**Properties from `luc:fields`.** `luc:fields` returns stored field values
for each hit from the index, joined on `?hit`, with no join to the graph. It
reads a field for every hit in one pass and caches it. For a page of many
features this replaces one graph lookup per feature and property. With
`skipGeometry=true`, the whole call then stays in the index. Its limits
shape the starter set:

- Only fields with `idx:stored true` on the shape itself are returned, not
  fields inside an `idx:nested` block.
- `LatLonField` values are not returned. The geometry still comes from the
  graph. An index that also stores the WKT in a stored field can read it
  with `luc:fields` too, and skip the graph entirely.
- A multi-valued field gives one row per value, which splits a feature across
  rows. The starter set reads only single-valued fields. For a multi-valued
  one, wrap the query in `GROUP BY ?feature` with `GROUP_CONCAT`.
- An unknown or unstored field is a query error on the first call. The
  `luc:config` check before the call does not cover `luc:fields`: the field
  names are in the stored query, not in the request.

The starter set also ships the `luc:config` query from
[Fields from `luc:config`](#fields-from-lucconfig). The demo index sets
`text:exposeConfig true`.

`luc:facet` is not used in v1. See [Later work](#later-work).

### The two sets compared

| | Plain SPARQL | Jena + `luc:query` |
| --- | --- | --- |
| Runs on | any backend, Oxigraph included | Fuseki with the Kurrawong `jena-text` index |
| `bbox` | envelope `FILTER`, full scan | `s_intersects` clause, spatial index |
| `datetime` | `FILTER` on a date property | range clauses on a `TemporalField` |
| `filter` (Part 3) | not offered, `400` | CQL2-JSON, pushdown only |
| Paging | `LIMIT`/`OFFSET`, `prev` and `next` | `after` cursor, `next` only |
| `numberMatched` | left out | from the index, no extra query |
| Queryables | from the `ogc` object | from `luc:config`, filtered by the `ogc` object |
| `skipGeometry=true` | the store skips the WKT read | the same |
| Conformance | core, geojson, oas30 | the same, plus Part 3 and CQL2 classes |

## Changes by package

| Package | Change |
| --- | --- |
| `packages/geojson` (new) | Serializer, WKT parser, CRS table, tests |
| `packages/types` | `ogc` / `FEATURE_OGC` feature flag |
| `packages/tools` | `src/ogc.ts`: `OgcObject` type, `checkOgcObject`, `OGC_RESERVED_PARAMS`, `ogcOpenApiDocument`, the parameter parsers for `bbox`, `datetime` and `limit`, the CQL2-JSON rename and combine. `published.ts`: reserve `f`; add `f` and `application/geo+json` to the library OpenAPI document |
| `packages/api` | `sparqlResultsFormats.ts`: GeoJSON media type and `406` rules. `routes/execute.ts`: call the serializer. `publishedToolRoutes.ts`: `f=geojson`. `persistence/schemas/QueryVersionSchema.ts`: `ogc` property. `lib/toolObject.ts`: `resolveVersionOgc`. The query version create route: call it. `lib/publishedTools.ts`: `collectOgcCollections`, `collections` in the catalogue. `config/catalogueMode.ts`: accept pinned collection targets. `server/ogcRoutes.ts` (new): the routes. `index.ts`: register them behind the flag |
| `packages/runtime` | Re-export `toFeatureCollection`, so a static bundle's caller can map a result. No bundle format change |
| `packages/web` | None in v1. An `ogc` editor section and a map view of GeoJSON results are separate designs, each with a mock |
| `docs` | `guides/publishing-ogc-collections.md` (new), and a GeoJSON section in `guides/rest-api-walkthrough.md` |
| `sqlib-demo` | The two starter collections in `instances/main/library`, and `FEATURE_OGC=true` in `server.env` |

## Build steps

Each step is one pull request. Each leaves `main` working.

1. **Serializer.** `packages/geojson` with tests: every WKT type, Z and M,
   `EMPTY`, each CRS row, an unknown CRS, `geoJSONLiteral`, lat/long pairs,
   property typing (big integers, `NaN`, language tags), column choice, an
   unbound geometry.
2. **GeoJSON on `/execute` and tools.** Media type, `406` rules, `f=geojson`
   on tool GET routes, `f` reserved, OpenAPI changes. Route tests next to the
   CSV tests in `routes/execute.ts`'s suite.
3. **The `ogc` object.** Schema property, `checkOgcObject`, `resolveVersionOgc`,
   copy-forward on save, startup collection and problem lines. No routes yet.
4. **OGC routes, `values` mode.** Flag, the seven routes, links, paging,
   unknown-parameter `400`s, `published` mode check. Test against an
   Oxigraph fixture with the plain starter query.
5. **Plain starter set** in `sqlib-demo`, then a QGIS check and a CITE run
   (`ets-ogcapi-features10`) against the demo. Fix what CITE finds.
6. **`cql2` mode.** The filter rewrite, the `luc:config` fields and the
   check before the call, cursor paging, `numberMatched`, the error mapping,
   Part 3 conformance. Test the rewrite as pure
   functions; test the route against a recorded Fuseki response.
7. **Jena starter set** in `sqlib-demo`, checked against a Fuseki with the
   Kurrawong index.

Steps 1 and 2 are useful alone, for maps and for QGIS "add vector layer from
URL", before any OGC work lands.

### Build status (2026-11-03)

All seven steps are on one pull request (sqlib #144), with the demo change in
sqlib-demo. Steps 6 and 7 are built and tested without a Fuseki. These
points differ from the text above:

- **Shared `VALUES` clause in `cql2` mode.** `filter`, `limit`, `offset` and
  `cursor` may share one `VALUES` clause, as the Jena starter query has them.
  Every call binds all of them, so they never need to be bound alone.
- **One item in `cql2` mode** binds `?feature` and also sends an
  `entityIri` `=` clause. The check against a real index is still open.
- **Empty pages.** A page with no rows is an empty collection, even when the
  store leaves unbound columns out of `head.vars`.
- **Conformance** also declares Part 3 `queryables-query-parameters`, since
  every collection takes its queryables as parameters.
- **CITE.** `scripts/ci/ogc-cite.sh` runs `ets-ogcapi-features10` (image tag
  `1.8-teamengine-5.7`) in CI against the plain starter set. There is no
  CITE suite for Part 3: the OGC publishes suites for Features Part 1 and
  Part 2 only. The `cql2` mode is tested against a stand-in `/execute`.
- **Starter sets** are in `docs/examples/ogc/plain` and
  `docs/examples/ogc/jena`. The demo serves the plain set at `/ogc/demo`.
  The Jena set is not in the demo, because the demo has no Fuseki.

## Risks

- **Deep paging in `values` mode is slow.** `OFFSET` rescans. Keyset paging
  needs a new parameter kind and is in later work.
- **The portable bbox scans every feature.** Large sets need GeoSPARQL or the
  Jena mode.
- **One row per feature is the author's job.** A multi-valued property
  splits features across rows. The plugin refuses such a page with a `500`
  rather than merging rows, so the error shows during setup, not as wrong
  maps. The guide shows the `GROUP BY` and subquery patterns.
- **Collections change only at restart**, like published tools.
- **CITE may find gaps** in link relations or the API document that this
  design does not foresee. Step 5 is there to find them before the Jena work.
- **The plugin copies the index's filter rules.** Its check before the call
  follows the refusal table in the Kurrawong docs. If the index adds a rule,
  that refusal reaches the caller as an error passed through from the
  backend, not as a clean `400`, until the plugin is updated. A marker on
  filter refusals removes this risk.

## Open questions

Answered by David on 2026-11-03:

1. The metadata routes (landing, conformance, collections, queryables, API)
   of a library are readable without sign-in, even when its `items` are not.
   The `items` call is the one that checks grants. The `luc:config` read
   behind queryables runs with the first caller's grants and is then served
   to everyone, so an operator who sets `configQuery` publishes the index's
   field list.
2. QGIS is the first target client. Step 5 tests in QGIS before CITE.

These are checks to make while building, not decisions:

- `luc:query` takes variables bound by `VALUES` for its filter, limit,
  offset and `after` arguments. David expects it does. Run one query in the
  demo before step 7.
- The literal form for a time value in a range clause on a `TemporalField`.
- How the Jena starter query finds one item: by binding `?feature` in the
  `?entity` slot of `luc:query`, which the index treats as an IRI filter, or
  by an `entityIri` `=` clause.
- The final CQL2 conformance class URIs.

## Later work

- Query groups as collection targets. `/execute` already accepts a group, so
  the work is the input check for a group's start node.
- A computed extent: a second stored query that returns min/max, run on the
  first request and cached.
- Keyset paging in `values` mode (`?feature > ?last`).
- Part 2: `crs` and `bbox-crs`, with real reprojection.
- `luc:facet` behind the `enum` of queryables, for keyword fields.
- A facets route, `GET /ogc/{slug}/collections/{id}/facets?field=…`, that
  takes the same `bbox`, `datetime` and `filter` as `items` and returns value
  counts from `luc:facet`, for example "house: 120, shed: 40". A map UI uses
  it to show filter options with counts that match the current view. OGC
  API Features has no standard route for this, so it is an extension outside
  the conformance classes. `luc:stats` could add field-level counts beside it.
- An `ogc` section in the query editor, and a map view of GeoJSON results in
  the web app. Each needs its own mock.
- GeoJSON-LD output for CONSTRUCT.
- A reload hook, so a new collection does not need a restart.

## Decisions taken in this design

| Decision | Why |
| --- | --- |
| Media type `application/geo+json`, `f=geojson` on GET routes, no `?mediatype=` | The registered type (RFC 7946) and the OGC parameter convention |
| A new zero-dependency package for the serializer | The API, the runtime and the web app all need it, and the runtime must stay free of dependencies |
| A hand-written WKT parser | Small grammar, no dependency, and the same code runs in the browser |
| No reprojection, axis swap for 4326, 4283 and 7844 only | Matches the Kurrawong index, and keeps maps and the index in agreement |
| `406` on `/execute` when GeoJSON cannot be made | The caller asked for the format by name; a silent fallback to JSON would break a map without a message |
| `ogc` object on the version, separate from `tool` | The same storage, copy-forward and save-time check as `tool`; a query can be a collection without being a tool |
| The plugin asks `/execute` for JSON and serializes itself | It needs the raw rows for `limit + 1`, the cursor and the count columns |
| `limit + 1` instead of a count query | One run per page; a `next` link only when there is a next page |
| `500` for duplicate ids and serializer failures in OGC | The cause is the collection's setup, not the request |
| CQL2-JSON only, edited as a JSON tree, never translated | David's decision: pushdown only, no CQL2 parser and no CQL2-to-SPARQL converter |
| One OGC service per library slug | Reuses the slug that published tools already require |
| `skipGeometry` as a `VALUES` flag the query reads, not only a JSON edit | The backend skips the WKT read, which is where the time goes |
| Queryables and the geometry field from `luc:config` | The index already knows its fields and their types, so the `ogc` object does not repeat them |
