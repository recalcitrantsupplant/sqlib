# Publishing queries as tools

A library's stored queries and query groups can be published as tools. An
application then calls them by name, with one plain argument per parameter,
over MCP or over HTTP. It does not need the query's IRI or SPARQL Results JSON,
and it needs no server of its own in front of sqlib.

The design and the reasons for it are in
[proposals/queries-as-tools.md](../proposals/queries-as-tools.md).

## Two surfaces

| | Building a library | Using an application |
| --- | --- | --- |
| Who calls | the person who designs queries, or an agent that helps them | the application's agents, pages and scripts |
| Tools | the catalogue: `libraries_*`, `queries_*`, `execute_run` … | the library's published queries and groups |
| Arguments | ids and SPARQL Results JSON | plain values, one per parameter |
| Where | `/mcp` and the API's routes | `/mcp/{slug}` and `/tools/{slug}/{name}` |
| Changes | at every call | at a restart |

Both surfaces run through `POST /execute`. A published tool keeps every rule
of an execution: the caller's grants, the argument checks and the backend
rules.

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
- **Per library.** Set `"publishAll": true` on the library. Every query and
  group in it is then published. An entry whose current version has a `tool`
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

A query group version takes the same object under `queryGroupVersion`.

### The `tool` object

| Field | Rule |
| --- | --- |
| `name` | `[A-Za-z0-9_-]`, 1 to 64 characters, unique among the library's tools. |
| `description` | What MCP and the OpenAPI document show. Say when to call the tool. |
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
| `GET /tools/{slug}/{name}` | a tool that only reads (a `SELECT`, `ASK`, `CONSTRUCT` or `DESCRIBE`, or a group of only those). The arguments are in the query string. Repeat a key for a list: `?city=Perth&city=Darwin`. Write a `term` or `langString` object as URL-encoded JSON. |
| `POST /tools/{slug}/{name}` | a tool backed by an update, or a group that can write. The arguments are a JSON object. |
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

In `published` mode the server keeps `/execute`, `/mcp`, `/mcp/{slug}`,
`/tools/…`, `/auth/…`, `/.well-known/…`, `/health` and `/metrics`. Every other
route answers `404`. Use it for a production deployment of an application.

## When a tool is invalid at startup

The save-time check leaves few problems for startup:

- a publishing library with no slug,
- two tools with one name in a library,
- a default backend that no longer exists.

In `both` and `catalogue` mode the server logs each problem, skips that tool
and starts. In `published` mode it refuses to start, and names each invalid
tool.
