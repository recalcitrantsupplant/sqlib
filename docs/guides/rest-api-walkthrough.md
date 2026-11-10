# A worked REST example: pinned query versions and ETL output

Each request body below is a request body that an executable test sends. The test
(`packages/api/test/integration/rest-example-walkthrough.test.ts`) reads **this file**, takes the
JSON blocks by the `<!-- example: name -->` marker above each one, and posts them to an API
instance built by `configureApp`. This is the same server that `packages/api/src/index.ts` starts,
with its routes, its validation and an in-process store. If an example here stops matching what
the API accepts, the test fails.

Two conventions in the JSON blocks:

- `{{likeThis}}` is an id from an earlier response. The API makes entity ids. A client stores the
  id it receives and uses it in the next call. The test puts in the real value.
- Blocks marked **rejected** show a request to avoid, with the status and message that the API
  returns.

Related pages:

- [Connecting an MCP client](mcp-clients.md) describes the query and version model for an agent.
- The [configuration reference](../reference/configuration.md) lists the environment variables.
- [ETL](etl.md) describes what ETL gives a caller when you turn it on.
- [Deploying](deploying.md) lists what to decide before you expose a deployment.

---

## Settings for this walkthrough

The walkthrough uses queries, backends, data graphs and ETL, so their flags are on. The library is
stored on local disk, and ETL output goes to a directory that the process can write to:

```bash
FEATURE_QUERIES=true
FEATURE_BACKENDS=true
FEATURE_DATA_GRAPHS=true
FEATURE_ETL=true

INTERNAL_BACKEND_TYPE=oxigraph-persistent   # the library's own persistence
LIBRARY_STORAGE_DIR=/app/packages/api/storage/library-store
ETL_OUTPUT_DIR=/app/packages/api/storage/etl-output   # must be writable by the user the process runs as
```

`SQLIB_AUTH_MODE=disabled` (the default) gives each request full access. Use it for development
only. Under `SQLIB_AUTH_MODE=required`, the two ETL routes that take SQL (`POST /etl-jobs/preview`
and `POST /playground/etl/execute`) need administrator access. A valid token is not sufficient.
This walkthrough needs no wider permission than that.

---

## 1. Create a library

Each entity belongs to a library.

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

`201`, with `id`: a `urn:sqlib:library:…`. Keep it. Each step below uses it.

## 2. Add data to query

A data graph holds RDF that the library owns. A *version* of the data graph holds the content, and
the content cannot change.

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

Send `POST /data-graphs`, then `POST /data-graphs/{{dataGraphId}}/versions`. The version response
has `version: 1` and a `tripleCount`.

## 3. Create a backend to execute against

An `oxigraphMemory` backend is an in-process store, loaded from data graphs. `oxigraphConfig` is a
**JSON string**. The store keeps it as a literal, so a nested object does not work.

<!-- example: createBackend -->
```json
{
  "name": "Example store",
  "backendType": "oxigraphMemory",
  "oxigraphConfig": "{\"storeType\":\"ephemeral\",\"mode\":\"ephemeral\",\"sources\":[{\"dataGraphId\":\"{{dataGraphId}}\"}]}"
}
```

`sources[].dataGraphId` **follows** the current version of the graph. `dataGraphVersionId` pins one
version. See `OxigraphDataGraphSource` in `packages/api/src/persistence/schemas/BackendSchema.ts`.

## 4. Create a query, then a version of it

A `Query` is the named entity that a person searches for, and it can change. A `QueryVersion` is
one immutable SPARQL string under it. **The query string is on the version, never on the query.**

<!-- example: createQuery -->
```json
{
  "name": "People in a city",
  "isPartOf": ["{{libraryId}}"]
}
```

> **Tags are entity references.** `tags` on a query must name `Tag` entities that already exist
> *and belong to the same library*. The API refuses free text. It also refuses an IRI that names no
> entity (`Referenced tag … does not exist`), because an IRI alone does not create an entity. Create
> tags first with `POST /tags`, or leave the field out, as this walkthrough does.

<!-- example: createQueryVersion -->
```json
{
  "queryVersion": {
    "queryString": "PREFIX ex: <http://example.org/> SELECT ?name WHERE { VALUES ?city { UNDEF } ?person ex:city ?city ; ex:name ?name . } ORDER BY ?name LIMIT 0001",
    "comment": "Version 1 — people in a city, with a dynamic LIMIT slot"
  }
}
```

Three facts about this call. Client authors have lost time on each one:

1. **The route is `POST /queries/{{queryId}}/versions`**, and the body is a **wrapper**. The fields
   of the version go inside `queryVersion`. Other keys (`limitParameters`, `inputs`, `outputs`, …)
   go next to `queryVersion`, at the top level.
2. **The response is expanded, and the version id is at `response.queryVersion.id`.**
   `response.id` is a different value. Store the version id for step 5.
3. **`VALUES ?city { UNDEF }` is the parameter slot.** The API derives the inputs and outputs of the
   version from the query string. A declared `UNDEF` row makes a variable bindable.

### How a query declares a LIMIT slot

`LIMIT 0001` declares a parameter. It is not a limit of one. Write a parameterised LIMIT as
`LIMIT 000<name>`, where `<name>` is digits. `LIMIT 0001` declares a limit parameter **named
`"1"`**, and `limits` binds it by name at execution. A query with a plain `LIMIT 10` has no slot
and takes no `limits`. Use a plain LIMIT when the query author sets the maximum, and a slot when
the caller sets it.

## 5. Execute a *pinned* version

`targetId` names what to execute. With the **query** id, execution uses the current version of the
query. Use this to run the latest saved query. With the **version** id, the version is pinned. Use
this for a client that must get the same result each time.

<!-- example: executePinnedVersion -->
```json
{
  "targetId": "{{queryVersionId}}",
  "backendId": "{{backendId}}",
  "arguments": [
    {
      "head": { "vars": ["city"] },
      "results": {
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

**`limits` is an array of `{name, value}`.** The request schema refuses an object keyed by
parameter name:

<!-- example: executeBadLimits -->
```json
{
  "targetId": "{{queryVersionId}}",
  "backendId": "{{backendId}}",
  "limits": { "1": 10 }
}
```

`400`, `"limits" must be of type array`. `offsets` has the same form.

With a lower limit, the result has fewer rows:

<!-- example: executePinnedVersionLimitOne -->
```json
{
  "targetId": "{{queryVersionId}}",
  "backendId": "{{backendId}}",
  "arguments": [
    {
      "head": { "vars": ["city"] },
      "results": {
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

## 6. A pin keeps the old version after a new one is saved

Save a second version, here a different query. The `currentVersion` of the query moves to it.

<!-- example: createSecondQueryVersion -->
```json
{
  "queryVersion": {
    "queryString": "SELECT ?s WHERE { ?s ?p ?o } LIMIT 1",
    "comment": "Version 2 — everything, briefly"
  }
}
```

The two `targetId` values now give different results:

<!-- example: executeQueryFollowsCurrent -->
```json
{
  "targetId": "{{queryId}}",
  "backendId": "{{backendId}}"
}
```

`200`, one row from version 2. If you send `executePinnedVersion` again with no change, it still
returns Alice and Cara from version 1. The version is immutable, so its result changes only when
the data changes.

## 7. Create an ETL job, and get the file it writes

An ETL job version holds the extraction SQL, a CONSTRUCT template, and the backend that the
template runs against. The column mapping sets how the columns of a row become terms.

The SQL here reads a literal `VALUES` table and nothing outside the process. It therefore runs
under the default capability profile, with no file or network access. A real extraction reads
Parquet or CSV, which needs `ETL_DUCKDB_ALLOW_FILESYSTEM=true`. With file access, DuckDB SQL can
read any file on the host. Turn it on only after a decision, and limit what the process can reach.
XML needs the `webbed` community extension. The published image can install it, because the image
is built on Debian. The extension is not published for Alpine (musl).

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

The `VALUES (?person ?name ?city) { (UNDEF UNDEF UNDEF) }` of the template is the slot that the rows
of each chunk are bound into. sqlib runs one CONSTRUCT for each chunk.

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

`iriTemplate` replaces the literal token `{value}` with the value of the column, URI-encoded. It
replaces nothing else. `POST /etl-jobs/versions/{{etlJobVersionId}}/column-mappings` returns the
mapping and makes it the current mapping of the version.

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

Eight rows in three chunks. Chunks are by row count, so the last chunk has the remaining rows.
**The response does not contain the RDF.** sqlib writes it to `outputLocation`, one chunk at a time,
because a large source makes more RDF than a response can carry. Download it separately:

```bash
curl -sS http://localhost:3000/etl-jobs/executions/{{executionId}}/output
```

`200 application/n-quads`, 24 triples: three for each person, as the CONSTRUCT declares.

```
<http://example.org/person/alice> <http://www.w3.org/1999/02/22-rdf-syntax-ns#type> <http://example.org/Person> .
<http://example.org/person/alice> <http://example.org/name> "Alice" .
<http://example.org/person/alice> <http://example.org/city> "Perth" .
…
```

A run that fails leaves no file, and `GET …/output` returns 404 for it.
`GET /etl-jobs/executions/{{executionId}}` returns the execution record: the status, the counts, and
the location of the output.

---

## Related

- [Connecting an MCP client](mcp-clients.md): the query and version model, for an agent.
- [Configuration reference](../reference/configuration.md): each environment variable that this
  page sets, with its default.
- [ETL](etl.md): what ETL gives a caller, who can submit SQL, and where output goes.
- `packages/api/test/integration/rest-example-walkthrough.test.ts`: the test that runs this page.
