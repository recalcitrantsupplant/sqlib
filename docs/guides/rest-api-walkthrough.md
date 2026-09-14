# A worked REST example: pinned query versions and ETL output

Every request body below is the request body an executable test sends. The test
(`packages/api/test/integration/rest-example-walkthrough.test.ts`) reads **this file**, pulls out
the JSON blocks by the `<!-- example: name -->` marker above each one, and posts them to a real API
instance built by `configureApp` — the same server `packages/api/src/index.ts` starts, with real
routes, real validation and a real in-process store. If an example here drifts from what the API
accepts, that test fails. Nothing below is illustrative-only.

Two conventions in the JSON blocks:

- `{{likeThis}}` is an id minted by an earlier response. The API mints entity ids; a client stores
  what it is given and uses it in the next call. The test substitutes the real value.
- Blocks marked **rejected** are what *not* to send, with the status and message the API answers.

The query and version model is covered again, for an agent rather than a REST client, in
[connecting an MCP client](mcp-clients.md). Environment variables are listed in the
[configuration reference](../reference/configuration.md), what enabling ETL grants is in
[ETL](etl.md), and what to settle before exposing a deployment is in [deploying](deploying.md).

---

## What the deployment has to have on

The walkthrough touches queries, backends, data graphs and ETL, so their flags are on, the library
persists locally, and ETL output goes somewhere this process may write:

```bash
FEATURE_QUERIES=true
FEATURE_BACKENDS=true
FEATURE_DATA_GRAPHS=true
FEATURE_ETL=true

INTERNAL_BACKEND_TYPE=oxigraph-persistent   # the library's own persistence
LIBRARY_STORAGE_DIR=/app/packages/api/storage/library-store
ETL_OUTPUT_DIR=/app/packages/api/storage/etl-output   # must be writable by the user the process runs as
```

`SQLIB_AUTH_MODE=disabled` (the default) gives every request full access, which is a development
posture. Under `SQLIB_AUTH_MODE=required` the two ETL routes that take SQL — `POST
/etl-jobs/preview` and `POST /playground/etl/execute` — require administrator rather than merely a
valid token. Nothing in this walkthrough asks for a wider runtime permission than that.

---

## 1. A library to put things in

Every entity belongs to a library.

```bash
curl -sS -X POST http://localhost:3000/libraries \
  -H 'Content-Type: application/json' \
  -d @create-library.json
```

<!-- example: createLibrary -->
```json
{
  "name": "Example library",
  "description": "Entities for the worked REST example"
}
```

`201`, with `id` — a `urn:sqlib:library:…`. Keep it; everything below references it.

## 2. Data to query

A data graph holds RDF the library owns; a *version* of it holds the content, immutably.

<!-- example: createDataGraph -->
```json
{
  "name": "People",
  "isPartOf": ["{{libraryId}}"]
}
```

<!-- example: createDataGraphVersion -->
```json
{
  "contentString": "@prefix ex: <http://example.org/> . ex:alice ex:name \"Alice\" ; ex:city \"Perth\" . ex:bob ex:name \"Bob\" ; ex:city \"Darwin\" . ex:cara ex:name \"Cara\" ; ex:city \"Perth\" .",
  "contentFormat": "text/turtle"
}
```

`POST /data-graphs`, then `POST /data-graphs/{{dataGraphId}}/versions`. The version response
carries `version: 1` and a `tripleCount`.

## 3. A backend to execute against

An `oxigraphMemory` backend is an in-process store, hydrated from data graphs. `oxigraphConfig` is
a **JSON string**, not a nested object — the store round-trips it as a literal.

<!-- example: createBackend -->
```json
{
  "name": "Example store",
  "backendType": "oxigraphMemory",
  "oxigraphConfig": "{\"storeType\":\"ephemeral\",\"mode\":\"ephemeral\",\"sources\":[{\"dataGraphId\":\"{{dataGraphId}}\"}]}"
}
```

`sources[].dataGraphId` **tracks** the graph's current version; `dataGraphVersionId` pins one. See
`OxigraphDataGraphSource` in `packages/api/src/persistence/schemas/BackendSchema.ts`.

## 4. A query, then a version of it

A `Query` is the named, mutable thing a person looks for. A `QueryVersion` is one immutable
SPARQL string under it. **The query string lives on the version, never on the query.**

<!-- example: createQuery -->
```json
{
  "name": "People in a city",
  "isPartOf": ["{{libraryId}}"]
}
```

> **Tags are entity references, not free text.** `tags` on a query must name `Tag` entities that
> already exist *and belong to the same library*. Free text is rejected, and so is an arbitrary IRI
> that resolves to nothing (`Referenced tag … does not exist`) — minting an IRI does not create the
> entity it names. Create tags first with `POST /tags`, or omit the field, which is what this
> walkthrough does.

<!-- example: createQueryVersion -->
```json
{
  "queryVersion": {
    "queryString": "PREFIX ex: <http://example.org/> SELECT ?name WHERE { VALUES ?city { UNDEF } ?person ex:city ?city ; ex:name ?name . } ORDER BY ?name LIMIT 0001",
    "comment": "Version 1 — people in a city, with a dynamic LIMIT slot"
  }
}
```

Three things about this call, each of which cost a downstream client a debugging session:

1. **The route is `POST /queries/{{queryId}}/v`**, and the body is a **wrapper**: the version's own
   fields go inside `queryVersion`. Sibling keys (`limitParameters`, `inputs`, `outputs`, …) sit
   beside it, not inside it.
2. **The response is expanded, and the version's id is at `response.queryVersion.id`** — not
   `response.id`. Store that id; §5 is what it is for.
3. **`VALUES ?city { UNDEF }` is the parameter slot.** The API derives the version's inputs and
   outputs from the query string, so a declared `UNDEF` row is how a variable becomes bindable.

### How a query declares a LIMIT slot

`LIMIT 0001` is not a typo and not a literal limit of one. A parameterised LIMIT is written
`LIMIT 000<name>`, where `<name>` is digits: `LIMIT 0001` declares a limit parameter **named
`"1"`**, which is what `limits` binds by name at execution. A query with a plain `LIMIT 10` has no
slot, takes no `limits`, and is the right choice when the ceiling is the query's rather than the
caller's — an outer fixed LIMIT is not dynamic limit injection and should not be confused with it.

## 5. Executing a *pinned* version

`targetId` is the thing to execute. Give it the **query** id and execution follows that query's
current version — which is what you want for "run the saved query", and not what you want for a
client that must keep getting the same answer. Give it the **version** id and the version is
pinned.

<!-- example: executePinnedVersion -->
```json
{
  "targetId": "{{queryVersionId}}",
  "backendId": "{{backendId}}",
  "arguments": [
    {
      "head": { "vars": ["city"] },
      "arguments": {
        "bindings": [
          { "city": { "type": "literal", "value": "Perth" } }
        ]
      }
    }
  ],
  "limits": [{ "name": "1", "value": 10 }]
}
```

`200`, SPARQL JSON results: Alice and Cara.

**`limits` is an array of `{name, value}`.** An object keyed by parameter name is rejected by the
request schema:

<!-- example: executeBadLimits -->
```json
{
  "targetId": "{{queryVersionId}}",
  "backendId": "{{backendId}}",
  "limits": { "1": 10 }
}
```

`400 — "limits" must be of type array`. Same shape for `offsets`.

Lower the limit and the result set shortens, which is the point of the slot:

<!-- example: executePinnedVersionLimitOne -->
```json
{
  "targetId": "{{queryVersionId}}",
  "backendId": "{{backendId}}",
  "arguments": [
    {
      "head": { "vars": ["city"] },
      "arguments": {
        "bindings": [
          { "city": { "type": "literal", "value": "Perth" } }
        ]
      }
    }
  ],
  "limits": [{ "name": "1", "value": 1 }]
}
```

`200`, one binding: Alice.

## 6. Pinning is what survives a newer version

Save a second version — here a deliberately different query — and the query's `currentVersion`
moves to it.

<!-- example: createSecondQueryVersion -->
```json
{
  "queryVersion": {
    "queryString": "SELECT ?s WHERE { ?s ?p ?o } LIMIT 1",
    "comment": "Version 2 — everything, briefly"
  }
}
```

Now the two `targetId`s answer differently, and that is the whole distinction:

<!-- example: executeQueryFollowsCurrent -->
```json
{
  "targetId": "{{queryId}}",
  "backendId": "{{backendId}}"
}
```

`200`, one row from version 2. Re-sending `executePinnedVersion` unchanged still returns Alice and
Cara from version 1 — the version is immutable, so what it returns changes only when the data does.

## 7. An ETL job, and the file it writes

An ETL job version carries the extraction SQL, a CONSTRUCT template, and the backend the template
runs against. The column mapping says how a row's columns become terms.

The SQL here reads nothing outside the process — a literal `VALUES` table — so it runs under the
default capability profile, with no filesystem or network access granted. Real extractions read
Parquet or CSV, which needs `ETL_DUCKDB_ALLOW_FILESYSTEM=true`: DuckDB SQL with filesystem access
is a host filesystem read primitive, so grant it deliberately and confine what the process can
reach. XML needs the `webbed` community extension, which the published image can install because
it is built on Debian rather than Alpine.

<!-- example: createEtlJob -->
```json
{
  "name": "People to RDF",
  "libraryId": "{{libraryId}}"
}
```

<!-- example: createEtlJobVersion -->
```json
{
  "sql": "SELECT * FROM (VALUES ('alice','Alice','Perth'),('bob','Bob','Darwin'),('cara','Cara','Perth'),('dan','Dan','Hobart'),('eve','Eve','Darwin'),('fred','Fred','Perth'),('gus','Gus','Hobart'),('hana','Hana','Darwin')) AS t(slug, name, city)",
  "sparqlTemplate": "PREFIX ex: <http://example.org/> CONSTRUCT { ?person a ex:Person ; ex:name ?name ; ex:city ?city } WHERE { VALUES (?person ?name ?city) { (UNDEF UNDEF UNDEF) } }",
  "backendId": "{{backendId}}",
  "chunkSize": 3
}
```

The template's `VALUES (?person ?name ?city) { (UNDEF UNDEF UNDEF) }` is the slot each chunk's rows
are bound into — one CONSTRUCT per chunk, not one per row.

<!-- example: createColumnMapping -->
```json
{
  "name": "People columns",
  "columns": [
    {
      "columnName": "slug",
      "targetVariable": "person",
      "termType": "uri",
      "iriTemplate": "http://example.org/person/{value}",
      "nullPolicy": "skipRow"
    },
    {
      "columnName": "name",
      "targetVariable": "name",
      "termType": "literal",
      "datatypeIri": "http://www.w3.org/2001/XMLSchema#string",
      "nullPolicy": "skipRow"
    },
    {
      "columnName": "city",
      "targetVariable": "city",
      "termType": "literal",
      "datatypeIri": "http://www.w3.org/2001/XMLSchema#string",
      "nullPolicy": "skipRow"
    }
  ]
}
```

`iriTemplate` substitutes the literal token `{value}` — the column's value, URI-encoded — and
nothing else. `POST /etl-jobs/versions/{{etlJobVersionId}}/column-mappings` returns the mapping and
sets it as the version's current one.

Then run it:

<!-- example: executeEtlJob -->
```json
{
  "chunkSize": 3
}
```

`200`:

```json
{
  "executionId": "…",
  "status": "completed",
  "outputFormat": "application/n-quads",
  "outputLocation": "/app/packages/api/storage/etl-output/….nq",
  "totalChunks": 3,
  "completedChunks": 3,
  "totalRows": 8
}
```

Eight rows in three chunks: chunking is by row count, so the last chunk is the remainder. **The RDF
is not in the response.** It is written to `outputLocation` a chunk at a time — a large source
constructs more RDF than a response should carry — and downloaded separately:

```bash
curl -sS http://localhost:3000/etl-jobs/executions/{{executionId}}/output
```

`200 application/n-quads`, 24 triples: three per person, exactly what the CONSTRUCT declares.

```
<http://example.org/person/alice> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/Person> .
<http://example.org/person/alice> <http://example.org/name> "Alice" .
<http://example.org/person/alice> <http://example.org/city> "Perth" .
…
```

A run that fails leaves no file, and `GET …/output` answers 404 for it. `GET
/etl-jobs/executions/{{executionId}}` returns the execution record — status, counts, and where its
output went.

---

## Related

- [Connecting an MCP client](mcp-clients.md) — the query and version model, for an agent rather
  than a REST client.
- [Configuration reference](../reference/configuration.md) — every environment variable this page
  sets, with its default.
- [ETL](etl.md) — what enabling ETL grants, who may submit SQL, and where output goes.
- `packages/api/test/integration/rest-example-walkthrough.test.ts` — this page, executed.
