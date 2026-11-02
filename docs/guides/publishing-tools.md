# Publishing queries as tools

A library's stored queries, query groups and rule sets can be published as tools. An
application then calls them by name, with one plain argument per parameter,
over MCP or over HTTP. It does not need the query's IRI or SPARQL Results JSON,
and it needs no server of its own in front of sqlib.

The design and the reasons for it are in
[proposals/queries-as-tools.md](../proposals/queries-as-tools.md).

## Two surfaces

| | Building a library | Using an application |
| --- | --- | --- |
| Who calls | the person who designs queries, or an agent that helps them | the application's agents, pages and scripts |
| Tools | the catalogue: `libraries_*`, `queries_*`, `execute_run` … | the library's published queries, groups and rule sets |
| Arguments | ids and SPARQL Results JSON | plain values, one per parameter |
| Where | `/mcp` and the API's routes | `/mcp/{slug}` and `/tools/{slug}/{name}` |
| Changes | at every call | at a restart |

Both surfaces run through `POST /execute`, or `POST /rule-sets/{id}/execute`
for a rule set. A published tool keeps every rule of an execution: the
caller's grants, the argument checks and the backend rules.

## 1. Give the library a slug

The slug is the library's name in URLs. Set it yourself; the server never
derives it from `name`, because a rename would then break every client URL.

```json
PUT /libraries/{id}
{ "slug": "pm" }
```

A slug matches `[a-z0-9-]+` and is unique among libraries. A second library
with the same slug gets `409`.

## 2. Publish a query or a group

Do one of these:

- **Per entry.** Save a version whose body carries a `tool` object.
- **Per library.** Set `"publishAll": true` on the library. Every query,
  group and rule set in it is then published. An entry whose current version has a `tool`
  object uses it. An entry whose current version has `"tool": false` is left
  out. Every other entry gets a default tool: its name made safe, its
  description, and every input as an optional `term`.

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

A query group version takes the same object under `queryGroupVersion`. A
rule set takes it on its own; see [Publishing a rule set](#publishing-a-rule-set).

### The `tool` object

| Field | Rule |
| --- | --- |
| `name` | `[A-Za-z0-9_-]`, 1 to 64 characters, unique among the library's tools. |
| `description` | What MCP and the OpenAPI document show. Say when to call the tool. |
| `dataGraphId` | Optional, rule sets only. The data graph the rules run on when a call sends no `data`. |
| `refusals` | Optional, published updates only. One message per precondition flag; see [Refusals](#refusals-why-an-update-wrote-nothing). |
| `params` | One key per input the tool offers. A key is a variable of a table parameter (`VALUES … { UNDEF }`) or the name of a `LIMIT` or `OFFSET` parameter (`LIMIT 0001` is `"1"`). An input with no key is not offered, and is `UNDEF` in every call. |

Each parameter takes:

| Field | Values | Default |
| --- | --- | --- |
| `kind` | `iri`, `string`, `langString`, `integer`, `decimal`, `boolean`, `date`, `dateTime`, `term` | required |
| `required` | `true` or `false` | `false` |
| `list` | `true` or `false` | `false` |
| `description` | text | none |

A `LIMIT` or `OFFSET` parameter takes `integer` only, and is never a list. A
published query cannot have a parameter named `backendId`, because that is the
argument that picks the backend.

### The check when you save

The server checks the `tool` object against the version's inputs when it saves
the version. A key that names no input is a `400` that names the key and lists
the inputs there are:

```json
{ "error": "tool.params.town names no input of this version. Its inputs are: ?city, LIMIT 1" }
```

A save that sends no `tool` field copies the previous version's `tool` object
(or its `false`). Edit the text, and the tool stays published. If the new text
drops an input the copied object names, the save is a `400` too. Send a
corrected `tool` object, or `"tool": false`, with the text. Send `"tool": null`
to remove the tool.

A `tool` object is content. To change the name, the description or a kind,
save a new version. `PATCH` on a version does not change it.

### Refusals: why an update wrote nothing

SPARQL Update cannot fail on purpose. An update whose `WHERE` clause has no
solution writes nothing, and `/execute` would still answer `204`. To tell the
caller why, write each precondition as a flag and add `refusals`:

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

Before the update runs, the server runs its `WHERE` clause as `SELECT *`,
without `FILTER(?ok)`, with the same arguments. A flag that is not true in
some row failed; an unbound flag failed too. Then:

- **A flag failed**, or the clause has no solution: the update does not run,
  and the call answers `409`. Over MCP the result has `isError` and the
  messages as text.

  ```json
  { "error": "Refused: the verdict is maybe; use agree or decline.",
    "refused": [{ "flag": "verdictKnown", "message": "Refused: the verdict is maybe; use agree or decline." }] }
  ```

- **Every flag holds:** the update runs and answers as before.

`{param}` in a message is the call's value of that parameter; a list is
joined with `, `. With list arguments one failing row refuses the whole call,
and nothing is written.

The save checks `refusals`: each key must name a flag the text binds, and the
text must be one `DELETE`/`INSERT … WHERE` ending in `FILTER(?ok)`. Otherwise
the save is a `400`:

```json
{ "error": "tool.refusals.byOwner names no flag of this version: it binds no ?ok_byOwner. Its flags are: ?ok_verdictKnown, ?ok_proposed" }
```

A tool without `refusals` answers as before. A query group cannot have
`refusals`. The check belongs to the version: `POST /execute` on the version
checks it too, whoever calls.

### The caller: who is calling

A tool often has to know who calls it: "only the owner may approve", "record
who made this change", "show me my items". Do not take the caller as a
parameter. A caller can send any value, so `?actor` is only who the caller
*says* they are.

Declare one or both of these slots instead. sqlib fills them from the
caller's sign-in, and no caller can set them:

| Slot | Rows |
|---|---|
| `VALUES ?authUser { UNDEF }` | one row: the caller's user or client principal IRI |
| `VALUES ?authGroup { UNDEF }` | one row per group principal IRI; zero rows for no groups |

The values are the principal IRIs that grants use, as `GET /auth/me` returns
them in `subject` and `principals`. Graph policies read the same two slots.

The rules:

- **No one can set them.** An argument, an argument set or a tool call that
  names `authUser` or `authGroup` is a `400`. So is a `tool.params` key with
  either name. A tool does not list the slots in its input schema.
- **Each slot is on its own.** `VALUES (?authUser ?x) { (UNDEF UNDEF) }` is a
  `400` at save. An input policy cannot name a slot.
- **No one signed in is refused.** A run of a query that declares a slot,
  with no one signed in, answers `401` (`required` mode) or `403` (`disabled`
  and `anonymous` modes, which have no sign-in). In `dry-run` it runs with
  both slots empty and logs that it would have refused.
- **Every door.** `/execute`, `/sparql`, the tool routes, both MCP doors,
  query groups, saved tests and benchmarks fill the slots from the same
  caller. The refusal query of an update with `refusals` gets them too.
- **Nothing stored.** A data graph from a query, and an ETL job, cannot use
  a query that declares a slot: their result is stored and shared, so it
  must not depend on who ran it.
- **Server only.** An exported bundle and the CLI run without a sign-in, so
  there both slots are empty.

A principal IRI is a hash of the issuer and the subject. Link it to your own
people in data, for example `ex:alice ex:signsInAs <urn:sqlib:principal:user:…>`.
An administrator finds the IRI with `GET /auth/me` (as that caller) or
`GET /auth/principals`. A new issuer URL gives every caller a new IRI, so
update the links when you change it.

Join to the caller directly, not inside `OPTIONAL`. Then a caller with no link
gives no solutions, and the update writes nothing. If you want a refusal
message for "not linked", use `OPTIONAL` and test `BOUND`, as below. Inside
`EXISTS`, an unbound variable is free: `EXISTS { ?record ex:owner ?actor }`
with no `?actor` is true for any record that has an owner.

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

A response to a query that declares a slot carries
`Cache-Control: private, no-store`, because it depends on the caller.

### Publishing a rule set

A rule set takes the `tool` object at the top level of a version body, on
`POST /rule-sets/{id}/srl` or `POST /rule-sets/{id}/versions`. A save that
sends no `tool` copies the previous version's, as for a query.

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
| `data` | RDF to run the rules on, in place of the data graph. Optional. |
| `format` | The format of `data`: `text/turtle` (the default), `application/n-triples` or `application/n-quads`. Only with `data`. |

A call with `data` runs the rules on that RDF. A call without it runs them on
the tool's `dataGraphId`, at the version that was current at startup. A tool
with no `dataGraphId` runs its rules on their own data blocks only. Either way
the answer is what `POST /rule-sets/{id}/execute` returns, the inferred triples
as Turtle. A rule set tool only reads: nothing is written to a store.

The save checks that `dataGraphId` names a data graph. `publishAll` gives a
rule set with no `tool` a default one, with no data graph.

### Running on RDF the caller sends

A published query that only reads, and a published group whose start node
takes RDF, also take `data` and `format`, as a rule set does:

- **A query** given `data` runs over that RDF alone, in an ephemeral store,
  in place of a backend. A call that sends both `data` and `backendId` is a
  `400`. Without `data`, the query runs on its backend, as before.
- **A group** given `data` fills its start node's first RDF input. Its nodes
  still run on their own backends.
- **An update** takes no `data`: it would write into a store that is then
  dropped.

Keep `data` small. It is loaded for the one call, and the request body limit
applies. A tool whose own parameters are named `data` or `format` does not get
these arguments.

## 3. Restart the server

The server collects the published tools when it starts. Each tool runs the
version that was current at that moment. A new version, a changed `tool`
object or a new published query takes effect at the next start. A tool
therefore never changes under an agent during a session.

## How a call becomes a run

The server builds the arguments of `POST /execute` from the plain values, one
table parameter at a time:

- **A single value** becomes a term of the parameter's kind. An `iri` must be
  an absolute IRI. A `langString` is `{ "value": "…", "lang": "en" }`. The
  number, boolean and date kinds become typed literals. A `string` is a plain
  literal.
- **A `term`** takes any of these spellings: a string (a plain literal),
  `{ "iri": "…" }`, `{ "value": "…", "lang": "en" }`, or
  `{ "value": "…", "datatype": "…" }`.
- **A value left out** is `UNDEF`. A table that gets no value at all runs
  unconstrained.
- **A list** spreads over rows. The table has as many rows as its longest
  list. Row *i* takes item *i* of each list, or `UNDEF` past the end of a list.
  Every single value repeats in each row. Two lists in one table are zipped by
  position, not crossed. For every combination, declare them in separate
  `VALUES` tables.
- **A missing required parameter**, a value of the wrong kind, or an unknown
  argument is a `400` that names the parameter. Nothing runs.
- **A failed call** is an MCP result with `isError`.

A published **query** also takes an optional `backendId`. Without it, the
query runs on its own `defaultBackend`, else its library's. The tool sends that
backend to `/execute` by name, so the caller still needs a grant on it. With no
default, a call without `backendId` is a `400`. A published **group** takes no
`backendId`: each of its nodes names its own.

A group is published with the parameters of its start node, one table per
variable port, and the `LIMIT` and `OFFSET` parameters of the queries its nodes
run.

## The MCP door

| Endpoint | Lists |
| --- | --- |
| `/mcp/{slug}` | that library's published tools, under their own names, and nothing else. An application's agents connect here. |
| `/mcp` | the catalogue, and every library's published tools as `{slug}__{name}`, such as `pm__record-decision`. |

The `__` separator keeps names inside `^[A-Za-z0-9_-]+$`, which some MCP
clients enforce. A slug has no `_` and no built-in tool has `__`, so a prefixed
name collides with nothing.

Each tool's `inputSchema` has one property per parameter, with its JSON type,
its `format` (`iri`, `date`, `date-time`) and its description. A list is an
`array`. `additionalProperties` is `false`. A tool that only reads carries
`readOnlyHint: true`; a tool backed by an update carries `readOnlyHint: false`.
Under `MCP_READ_ONLY=1`, published updates are left out, as catalogue writes
are.

A session belongs to the endpoint that opened it. A session opened on
`/mcp/pm` is not found on `/mcp`.

## The HTTP door

| Route | For |
| --- | --- |
| `GET /tools/{slug}/{name}` | a query or group that only reads (a `SELECT`, `ASK`, `CONSTRUCT` or `DESCRIBE`, or a group of only those). The arguments are in the query string. Repeat a key for a list: `?city=Perth&city=Darwin`. Write a `term` or `langString` object as URL-encoded JSON. |
| `POST /tools/{slug}/{name}` | a tool backed by an update, a group that can write, or a rule set. The arguments are a JSON object. A rule set is `POST` because its `data` can be longer than a URL. |
| `POST /tools/{slug}/{name}` on a reading tool | the same tool, its arguments as a JSON object, for a query or group that takes `data`. RDF can be longer than a URL. |
| `GET /tools/{slug}/openapi.json` | an OpenAPI 3.1 document with one operation per tool, typed from its parameters. Generate a page's client from it. |

Each route returns what `POST /execute` returns, and forwards the caller's
`Authorization` header, so a published tool grants nothing that `/execute` on
the same version would not.

Use HTTP for a production page or a script: a `GET` can be cached and needs no
client library. Use MCP for agents, analysis and exploration.

## `MCP_CATALOGUE`

| Value | `/mcp` lists | `/mcp/{slug}` and `/tools/…` | Authoring routes | `POST /execute` |
| --- | --- | --- | --- | --- |
| `both` (default) | the catalogue and every library's published tools | served | served | any target the caller's grants allow |
| `catalogue` | the catalogue only | `404` | served | any target the caller's grants allow |
| `published` | every library's published tools only | served | `404` | only the pinned versions of published tools (`403` otherwise) |

In `published` mode `POST /rule-sets/{id}/execute` also runs only the pinned
version of a published rule set. The call may send its own RDF or name the
tool's pinned data graph version, and nothing else: another stored graph, or
tuple seeds, is a `403`. In the same way, `POST /execute` takes `dataGraphs`
only as RDF in the request, never a stored graph by id.

In `published` mode the server keeps `/execute`, `/rule-sets/{id}/execute`, `/mcp`, `/mcp/{slug}`,
`/tools/…`, `/auth/…`, `/.well-known/…`, `/health` and `/metrics`. Every other
route answers `404`. Use it for a production deployment of an application.

## When a tool is invalid at startup

The save-time check leaves few problems for startup:

- a publishing library with no slug,
- two tools with one name in a library,
- a default backend that no longer exists,
- a rule set's data graph that no longer exists or has no version.

In `both` and `catalogue` mode the server logs each problem, skips that tool
and starts. In `published` mode it refuses to start, and names each invalid
tool.
