# Publishing queries as tools

You can publish the stored queries, query groups and rule sets of a library as
tools. An application then calls each tool by name, over MCP or HTTP, with one
plain argument for each parameter. The application needs no query IRI, no
SPARQL Results JSON, and no server of its own in front of sqlib.

[proposals/queries-as-tools.md](../proposals/queries-as-tools.md) gives the
design and its reasons.

## Two surfaces

| | Building a library | Using an application |
| --- | --- | --- |
| Who calls | the person who designs queries, or an agent that helps them | the agents, pages and scripts of the application |
| Tools | the catalogue: `libraries_*`, `queries_*`, `execute_run` … | the published queries, groups and rule sets of the library |
| Arguments | ids and SPARQL Results JSON | plain values, one for each parameter |
| Where | `/mcp` and the API routes | `/mcp/{slug}` and `/tools/{slug}/{name}` |
| Changes | at each call | at a restart |

Both surfaces run through `POST /execute`, or `POST /rule-sets/{id}/execute`
for a rule set. A published tool keeps each rule of an execution: the grants of
the caller, the argument checks and the backend rules.

## 1. Give the library a slug

The slug is the name of the library in URLs. You must set it. The server does
not make it from `name`, because a rename would then break each client URL.

```json
PUT /libraries/{id}
{ "slug": "pm" }
```

A slug matches `[a-z0-9-]+` and is unique among libraries. A second library
with the same slug gets `409`.

## 2. Publish a query or a group

Do one of these:

- **For one entry.** Save a version with a `tool` object in its body.
- **For a library.** Set `"publishAll": true` on the library. sqlib then
  publishes each query, group and rule set in it:
  - An entry whose current version has a `tool` object uses that object.
  - An entry whose current version has `"tool": false` is not published.
  - Each other entry gets a default tool: its name made safe, its description,
    and each input as an optional `term`.

```json
POST /queries/{id}/versions
{
  "queryVersion": {
    "queryString": "… VALUES (?title ?rationale) { (UNDEF UNDEF) } … VALUES ?affects { UNDEF } …",
    "tool": {
      "name": "record-decision",
      "description": "Record a decision with its rationale, before you implement it.",
      "params": {
        "title":     { "kind": "string", "required": true },
        "rationale": { "kind": "string" },
        "affects":   { "kind": "iri", "list": true, "description": "the items the decision affects" }
      }
    }
  }
}
```

A query group version takes the same object under `queryGroupVersion`. A rule
set takes it at the top level. See [Publishing a rule set](#publishing-a-rule-set).

### The `tool` object

| Field | Rule |
| --- | --- |
| `name` | `[A-Za-z0-9_-]`, 1 to 64 characters, unique among the tools of the library. |
| `description` | The text that MCP and the OpenAPI document show. Say when to call the tool. |
| `dataGraphId` | Optional, rule sets only. The data graph that the rules run on when a call sends no `data`. |
| `refusals` | Optional, published updates only. One message for each precondition flag. See [Refusals](#refusals-why-an-update-wrote-nothing). |
| `params` | One key for each input that the tool offers. A key is a variable of a table parameter (`VALUES … { UNDEF }`), or the name of a `LIMIT` or `OFFSET` parameter (`LIMIT 0001` is `"1"`). An input with no key is not offered, and is `UNDEF` in each call. |

Each parameter takes:

| Field | Values | Default |
| --- | --- | --- |
| `kind` | `iri`, `string`, `langString`, `integer`, `decimal`, `boolean`, `date`, `dateTime`, `term` | required |
| `required` | `true` or `false` | `false` |
| `list` | `true` or `false` | `false` |
| `description` | text | none |

A `LIMIT` or `OFFSET` parameter takes `integer` only, and is never a list. A
published query cannot have a parameter named `backendId`, because that
argument selects the backend.

### The check when you save

When the server saves a version, it checks the `tool` object against the inputs
of the version. A key that names no input gives a `400`. The error names the key
and lists the inputs:

```json
{ "error": "tool.params.town names no input of this version. Its inputs are: ?city, LIMIT 1" }
```

A save with no `tool` field copies the `tool` object (or the `false`) of the
previous version. If you edit the text, the tool stays published. If the new
text removes an input that the copied object names, the save also gives a
`400`. Send a corrected `tool` object, or `"tool": false`, with the text. To
remove the tool, send `"tool": null`.

A `tool` object is content. To change the name, the description or a kind, save
a new version. `PATCH` on a version does not change it.

### Refusals: why an update wrote nothing

SPARQL Update has no way to fail intentionally. An update whose `WHERE` clause
has no solution writes nothing, and `/execute` answers `204`. To tell the caller
the reason, write each precondition as a flag, and add `refusals`:

1. Bind each precondition as `?ok_<name>`, true when it holds.
2. Bind `?ok` as their conjunction.
3. End the `WHERE` clause with `FILTER(?ok)`.

```sparql
PREFIX ex: <http://example.org/>
DELETE { ?item ex:state "proposed" }
INSERT { ?item ex:state ?verdict }
WHERE {
  VALUES (?item ?verdict) { (UNDEF UNDEF) }
  BIND(COALESCE(?verdict IN ("agree", "decline"), false) AS ?ok_verdictKnown)
  BIND(EXISTS { ?item ex:state "proposed" } AS ?ok_proposed)
  BIND(?ok_verdictKnown && ?ok_proposed AS ?ok)
  FILTER(?ok)
}
```

```json
"refusals": {
  "verdictKnown": "Refused: the verdict is {verdict}; use agree or decline.",
  "proposed": "Refused: {item} is not proposed."
}
```

Before the update runs, the server runs its `WHERE` clause as `SELECT *`, with
the same arguments and without `FILTER(?ok)`. A flag fails when it is not true
in a row, or when it is unbound. Then:

- **A flag failed**, or the clause has no solution. The update does not run, and
  the call answers `409`. Over MCP, the result has `isError` and the messages as
  text.

  ```json
  { "error": "Refused: the verdict is maybe; use agree or decline.",
    "refused": [{ "flag": "verdictKnown", "message": "Refused: the verdict is maybe; use agree or decline." }] }
  ```

- **Each flag holds.** The update runs and answers as usual.

In a message, `{param}` is the value of that parameter in the call. A list is
joined with `, `. With list arguments, one failed row refuses the whole call,
and nothing is written.

The save checks `refusals`. Each key must name a flag that the text binds. The
text must be one `DELETE`/`INSERT … WHERE` that ends in `FILTER(?ok)`. If not,
the save gives a `400`:

```json
{ "error": "tool.refusals.byOwner names no flag of this version: it binds no ?ok_byOwner. Its flags are: ?ok_verdictKnown, ?ok_proposed" }
```

A tool without `refusals` answers as usual. A query group cannot have
`refusals`. The check belongs to the version, so `POST /execute` on the version
also checks it, for each caller.

### The caller: who is calling

A tool often must know its caller, for example to let only the owner approve,
to record who made a change, or to show the items of the caller. A parameter
such as `?actor` cannot do this, because a caller can send any value. It gives
only the identity that the caller states.

Declare one or both of these slots. sqlib fills them from the sign-in of the
caller, and no caller can set them:

| Slot | Rows |
|---|---|
| `VALUES ?authUser { UNDEF }` | one row: the user or client principal IRI of the caller |
| `VALUES ?authGroup { UNDEF }` | one row for each group principal IRI; zero rows when the caller is in no group |

The values are the principal IRIs that grants use. `GET /auth/me` returns them
in `subject` and `principals`. Graph policies read the same two slots.

The rules:

- **No one can set them.** An argument, an argument set or a tool call that
  names `authUser` or `authGroup` gives a `400`. So does a `tool.params` key
  with either name. The input schema of a tool does not list the slots.
- **Each slot is alone in its table.** `VALUES (?authUser ?x) { (UNDEF UNDEF) }`
  gives a `400` at save. An input policy cannot name a slot.
- **A caller who is not signed in is refused.** A run of a query that declares a
  slot, with no sign-in, answers `401` in `required` mode. It answers `403` in
  `disabled` and `anonymous` modes, which have no sign-in. In `dry-run` mode,
  the query runs with both slots empty, and the server logs that it would have
  refused.
- **All routes fill them.** `/execute`, `/sparql`, the tool routes, both MCP
  endpoints, query groups, saved tests and benchmarks fill the slots from the
  same caller. The refusal query of an update with `refusals` also gets them.
- **Stored results cannot use them.** A data graph from a query, and an ETL job,
  cannot use a query that declares a slot. Their result is stored and shared, so
  it must not depend on the person who ran it.
- **Only the server fills them.** An exported bundle and the CLI run without a
  sign-in, so both slots are empty there.

A principal IRI is a hash of the issuer and the subject. Link it to your own
people in data, for example `ex:alice ex:signsInAs <urn:sqlib:principal:user:…>`.
An administrator finds the IRI with `GET /auth/me` (as that caller) or
`GET /auth/principals`. A new issuer URL gives each caller a new IRI, so update
the links when you change the issuer.

Join to the caller directly, outside `OPTIONAL`. A caller with no link then
gives no solutions, and the update writes nothing. For a refusal message when the caller has no link, use `OPTIONAL` and
test `BOUND`, as in the example below. Inside `EXISTS`, an unbound variable is
free. `EXISTS { ?record ex:owner ?actor }` with no `?actor` is true for each
record that has an owner.

```sparql
PREFIX ex: <http://example.org/>
DELETE { ?record ex:state ex:proposed }
INSERT { ?record ex:state ex:approved ; ex:approvedBy ?actor }
WHERE {
  VALUES ?record { UNDEF }
  VALUES ?authUser { UNDEF }
  OPTIONAL { ?actor ex:signsInAs ?authUser }
  BIND(BOUND(?actor) AS ?ok_linked)
  BIND(EXISTS { ?record ex:state ex:proposed } AS ?ok_proposed)
  BIND(?ok_linked && EXISTS { ?record ex:owner ?actor } AS ?ok_byOwner)
  BIND(?ok_linked && ?ok_proposed && ?ok_byOwner AS ?ok)
  FILTER(?ok)
}
```

```json
{
  "name": "approve",
  "description": "Approve a proposed record. Only its owner may.",
  "params": { "record": { "kind": "iri", "required": true } },
  "refusals": {
    "linked": "Refused: your sign-in is not linked to a person.",
    "proposed": "Refused: {record} is not proposed.",
    "byOwner": "Refused: only the owner of {record} may approve it."
  }
}
```

The response to a query that declares a slot has
`Cache-Control: private, no-store`, because it depends on the caller.

### Publishing a rule set

A rule set takes the `tool` object at the top level of a version body, on
`POST /rule-sets/{id}/srl` or `POST /rule-sets/{id}/versions`. A save with no
`tool` copies the object of the previous version, as for a query.

```json
POST /rule-sets/{id}/srl
{
  "srl": "PREFIX ex: <http://example.org/> RULE { ?a ex:neighbour ?b } WHERE { … }",
  "tool": {
    "name": "neighbours",
    "description": "Who lives in the same city as whom.",
    "dataGraphId": "urn:sqlib:data-graph:…"
  }
}
```

A rule set tool has no `params` and no `refusals`. It takes two arguments:

| Argument | Meaning |
| --- | --- |
| `data` | Optional. RDF for the rules to run on. When given, the data graph is not used. |
| `format` | The format of `data`: `text/turtle` (the default), `application/n-triples` or `application/n-quads`. Only with `data`. |

The rules run on:

- the RDF in `data`, when the call sends it;
- else the `dataGraphId` of the tool, at the version that was current at
  startup;
- else only the data blocks of the rule set, when the tool has no
  `dataGraphId`.

The answer is what `POST /rule-sets/{id}/execute` returns: the inferred triples
as Turtle. A rule set tool only reads. It writes nothing to a store.

The save checks that `dataGraphId` names a data graph. `publishAll` gives a
default tool, with no data graph, to a rule set that has no `tool`.

### Running on RDF the caller sends

Two more kinds of tool take `data` and `format`, as a rule set does: a published
query that only reads, and a published group whose start node takes RDF.

- **A query** with `data` runs only over that RDF, in a temporary store, and
  uses no backend. A call that sends both `data` and `backendId` gives a `400`.
  Without `data`, the query runs on its backend.
- **A group** with `data` fills the first RDF input of its start node. Its nodes
  still run on their own backends.
- **An update** takes no `data`. It would write into a store that sqlib then
  deletes.

Keep `data` small. sqlib loads it for one call, and the limit on the request
body applies. When a tool has its own parameters named `data` or `format`, it
does not get these arguments.

## 3. Restart the server

The server collects the published tools when it starts. Each tool runs the
version that was current at that time. A new version, a changed `tool` object
or a newly published query takes effect at the next start. A tool therefore
never changes during the session of an agent.

## How a call becomes a run

The server makes the arguments of `POST /execute` from the plain values, one
table parameter at a time:

- **A single value** becomes a term of the kind of the parameter. An `iri` must
  be an absolute IRI. A `langString` is `{ "value": "…", "lang": "en" }`. The
  number, boolean and date kinds become typed literals. A `string` is a plain
  literal.
- **A `term`** takes one of these forms: a string (a plain literal),
  `{ "iri": "…" }`, `{ "value": "…", "lang": "en" }`, or
  `{ "value": "…", "datatype": "…" }`.
- **An omitted value** is `UNDEF`. A table that gets no value runs with no
  constraint.
- **A list** spreads over rows. The table has as many rows as its longest list.
  Row *i* takes item *i* of each list, or `UNDEF` after the end of a list. Each
  single value repeats in each row. Two lists in one table are zipped by
  position. To get each combination, declare them in separate `VALUES` tables.
- **A missing required parameter**, a value of the wrong kind, or an unknown
  argument gives a `400` that names the parameter. Nothing runs.
- **A failed call** is an MCP result with `isError`.

A published **query** also takes an optional `backendId`. Without it, the query
runs on its `defaultBackend`, or on the default backend of its library. The tool
sends that backend to `/execute` by name, so the caller still needs a grant on
it. If there is no default, a call without `backendId` gives a `400`. A
published **group** takes no `backendId`, because each of its nodes names its
own.

A published group has these parameters:

- the parameters of its start node, one table for each variable port;
- the `LIMIT` and `OFFSET` parameters of the queries that its nodes run.

## The MCP endpoints

| Endpoint | Lists |
| --- | --- |
| `/mcp/{slug}` | the published tools of that library, under their own names, and nothing else. Connect the agents of an application here. |
| `/mcp` | the catalogue, and the published tools of each library as `{slug}__{name}`, for example `pm__record-decision`. |

The `__` separator keeps names inside `^[A-Za-z0-9_-]+$`, which some MCP clients
enforce. A slug has no `_`, and no built-in tool has `__`, so a prefixed name
cannot be the same as another name.

The `inputSchema` of each tool has one property for each parameter, with its
JSON type, its `format` (`iri`, `date`, `date-time`) and its description. A list
is an `array`. `additionalProperties` is `false`. A tool that only reads has
`readOnlyHint: true`. A tool that runs an update has `readOnlyHint: false`. With
`MCP_READ_ONLY=1`, sqlib does not list published updates, and does not list
catalogue writes.

A session belongs to the endpoint that opened it. A session opened on `/mcp/pm`
is not found on `/mcp`.

## The HTTP routes

| Route | For |
| --- | --- |
| `GET /tools/{slug}/{name}` | a query or group that only reads: a `SELECT`, `ASK`, `CONSTRUCT` or `DESCRIBE`, or a group of only those. The arguments are in the query string. For a list, repeat the key: `?city=Perth&city=Darwin`. Write a `term` or `langString` object as URL-encoded JSON. |
| `POST /tools/{slug}/{name}` | a tool that runs an update, a group that can write, or a rule set. The arguments are a JSON object. A rule set uses `POST`, because its `data` can be longer than a URL. |
| `POST /tools/{slug}/{name}` on a tool that reads | the same tool, with its arguments as a JSON object. Use it for a query or group that takes `data`, because RDF can be longer than a URL. |
| `GET /tools/{slug}/openapi.json` | an OpenAPI 3.1 document with one operation for each tool, typed from its parameters. Generate the client of a page from it. |

Each route returns what `POST /execute` returns. Each route sends on the
`Authorization` header of the caller. A published tool therefore grants nothing
that `/execute` on the same version would not grant.

A `GET` takes the response format from `f` in the query string. A link in a
browser, or the "add layer from URL" of a GIS client, cannot set an `Accept`
header, so `f` sets the format:

- `f=json`: SPARQL JSON, the default;
- `f=geojson`;
- `f=csv`;
- `f=tsv`;
- `f=xml`.

`f` is reserved, so no parameter can have that name.

`f=geojson` gives a GeoJSON `FeatureCollection`, with one feature for each row:

- The geometry comes from the first `geo:wktLiteral` or `geo:geoJSONLiteral`
  column. If there is none, it comes from `lat` and `lon` columns (or `long`,
  `lng`, `latitude`, `longitude`).
- The id comes from `?feature`, from `?id`, or from the first IRI column.

A result with no geometry gets `406`, with the reason. So does a result with
geometry in a CRS other than CRS84, EPSG:4326, EPSG:4283 or EPSG:7844.

Use HTTP for a production page or a script. A `GET` can be cached and needs no
client library. Use MCP for agents, analysis and exploration.

## `MCP_CATALOGUE`

| Value | `/mcp` lists | `/mcp/{slug}` and `/tools/…` | Authoring routes | `POST /execute` |
| --- | --- | --- | --- | --- |
| `both` (default) | the catalogue and the published tools of each library | served | served | any target that the grants of the caller allow |
| `catalogue` | the catalogue only | `404` | served | any target that the grants of the caller allow |
| `published` | the published tools of each library only | served | `404` | only the pinned versions of published tools (`403` for others) |

In `published` mode, `POST /rule-sets/{id}/execute` also runs only the pinned
version of a published rule set. The call can send its own RDF, or name the
pinned data graph version of the tool. Any other stored graph, or tuple seeds,
gives a `403`. In the same way, `POST /execute` takes `dataGraphs` only as RDF in
the request. It refuses a stored graph by id.

In `published` mode, the server keeps these routes: `/execute`,
`/rule-sets/{id}/execute`, `/mcp`, `/mcp/{slug}`, `/tools/…`, `/auth/…`,
`/.well-known/…`, `/health` and `/metrics`. Each other route answers `404`. Use
this mode for a production deployment of an application.

## When a tool is invalid at startup

The check at save time finds most problems. These problems remain for startup:

- a library that publishes tools and has no slug,
- two tools with the same name in one library,
- a default backend that no longer exists,
- a data graph of a rule set that no longer exists or has no version.

In `both` and `catalogue` mode, the server logs each problem, skips that tool
and starts. In `published` mode, it does not start, and it names each invalid
tool.
