# Queries as tools: publish stored queries as an application's MCP tools and HTTP routes

Status: proposal, not implemented. Written 2026-10-26 against `main` at
`6f65c10`.

## Summary

A query or a query group in a library can opt in to being published as a
tool, one by one or for the whole library at once. The opt-in gives the tool
a name, a description, and a kind for each parameter. sqlib then lists the
tool in its MCP server under that name, with one plain argument per
parameter, and answers the same call on an HTTP route. A call runs the
entry's version through `POST /execute`, as `execute_run` does now, so the
tool keeps every rule an execution has: the caller's grants, the backend
fallback and argument checking.

Published tools are a second surface beside sqlib's existing catalogue. The
catalogue is for building a library; the published tools are the
application that library makes. A server can offer either or both.

The aim is an application whose MCP tools and HTTP API are its stored
queries, with no server of its own in front of sqlib. An agent calls
`record-decision { title, rationale, affects }`. It does not call
`execute_run` with a version IRI and a SPARQL Results JSON document.

## The problem

`execute_run` can already run any stored query with arguments, so an agent
can reach every query in a library. It is a poor interface for an agent, for
three reasons:

- **The agent must know the query's IRI.** Ids are server-minted
  (`urn:...`), so the agent lists queries and reads their descriptions before
  each call, or a prompt carries the ids.
- **Arguments are SPARQL Results JSON.** A title is
  `{"head":{"vars":["title"]},"results":{"bindings":[{"title":{"type":"literal","value":"…"}}]}}`.
  Agents get this wrong often, and every client repeats the same wrapping.
- **The description cannot say when to call it.** The tool's description is
  `execute_run`'s, whatever the query does. An application's guidance, such as
  "call record-decision with its rationale before you implement it", has no
  place to go, and that guidance is what makes an agent use the tool at all.

The project-management application `pm`
(`recalcitrantsupplant/rdfproj2`) shows the cost. Its commands are stored
SPARQL updates, but it runs its own MCP server, about 700 lines in its `lib/mcp.ts`, to publish
them as typed tools. Most of that server maps plain arguments to `VALUES`
rows and sets the backend, which sqlib could do for any library.

## Two surfaces

sqlib's MCP server and API today serve **building a library**: list
libraries and backends, create a query and cut versions, validate, detect
inputs, preview a patch, run anything with `execute_run`. That catalogue is
what a person or an agent needs while designing queries, and it stays as it
is.

An **application** built on a library needs something else. Its agents and
its pages call a handful of operations, by name, with plain arguments, and
should see nothing else. They have no use for `queries_createVersion`, and an
agent that sees `sparql_proxyQuery` can run any SPARQL it likes.

| | Building a library | Using an application |
|---|---|---|
| Who calls | the person designing queries, or an agent helping them | the application's agents, pages and scripts |
| Tools | the catalogue: `libraries_*`, `queries_*`, `detection_*`, `execute_run`… | the library's published queries and groups |
| Arguments | ids and SPARQL Results JSON | plain values, one per parameter |
| Where | `/mcp`, the API's routes | `/mcp/{library-slug}`, `/tools/{library-slug}/{name}` |
| Changes | at every call | at a restart |

Both surfaces run through `POST /execute`, so they differ in what they show
and how they take arguments, not in what an execution does.

## Design

### What can be published

A **query** or a **query group** can be published. A group is published with
the parameters of its start node: one per table input, and its `LIMIT` and
`OFFSET` parameters. It takes no backend, because each of its nodes names its
own. A query that only feeds a group does not need publishing; the group is
the tool.

Publishing is opt-in, in one of two ways:

- **Per entry:** the query or group carries a `tool` object, described below.
- **Per library:** the library sets `publishAll: true`. Every query and group
  in it is then published. An entry with a `tool` object uses it; any other
  entry gets a default one, and an entry with `"tool": false` is left out,
  such as the queries that compose a group.

A default `tool` object takes the entry's name, made safe for MCP, as the
tool's name, its description as the tool's description, and every detected
input as a parameter of kind `term` (below), optional, not a list.

### The `tool` object

A query or query group entity takes an optional `tool` object:

```json
{
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
```

- **`name`** is unique among the published tools of its library, uses the
  characters MCP allows in a tool name, and is not the name of a built-in
  tool.
- **`description`** is the tool's description as MCP and the HTTP route's
  documentation give it.
- **`params`** names the inputs the tool takes. Each key is a variable of one
  of the query's table parameters (`VALUES ... { UNDEF }`) or the name of a
  `LIMIT` or `OFFSET` parameter, as input detection finds them. A key that is
  not one is an error when the tool is published. A detected input with no
  key is not offered, and is `UNDEF` in every call.

Each parameter takes:

| Field | Values | Default |
|---|---|---|
| `kind` | `iri`, `string`, `langString`, `integer`, `decimal`, `boolean`, `date`, `dateTime`, `term` | required |
| `required` | `true` or `false` | `false` |
| `list` | `true` or `false` | `false` |
| `description` | text | none |

`LIMIT` and `OFFSET` parameters take `integer` only.

### Arguments: plain values to `VALUES` rows

sqlib builds the arguments `POST /execute` takes from the call's plain
values, one table parameter at a time:

- **A single value** becomes a term of the parameter's kind. An `iri` must be
  an absolute IRI. A `langString` is `{ "value": "…", "lang": "en" }`. Every
  other kind is a literal with its XSD datatype, except `string`, which is a
  plain literal. A `term` takes any of these spellings: a string is a plain
  literal, `{ "iri": "…" }` an IRI, `{ "value": "…", "lang": "en" }` a
  language-tagged literal, and `{ "value": "…", "datatype": "…" }` a typed
  one. It is the default kind for a library published with `publishAll`,
  where nobody declared the kinds.
- **A value left out** is `UNDEF` in every row.
- **A list** spreads over rows. The table has as many rows as its longest
  list, and at least one. Row *i* takes item *i* of each list, or `UNDEF` past
  a list's end, and every single value is repeated in each row.

  Two lists in one table are therefore zipped by position, not crossed. A
  query that wants every combination declares them in separate `VALUES`
  tables.
- **A missing required parameter**, a value of the wrong kind, or an unknown
  argument is a 400 that names the parameter, before anything runs.

`pm` builds its rows by this rule today (`buildArguments` in its
`lib/commands.ts`), so its commands would run unchanged.

### The backend

Every published tool takes an optional `backendId` argument, as `execute_run`
does. The backend is the one the call names, else the query's
`defaultBackend`, else its library's. With none of the three, the call is a
400, `backendId is required: neither the query nor its library has a default
backend`.

This is the fallback `POST /execute` already applies
(`resolveQueryDefaultBackend` in `routes/execute.ts`). The published tool
passes `backendId` through, or leaves it out, and adds no rule of its own. A
published query group takes no `backendId`, as `POST /execute` refuses one
for a group.

### Which version runs

A server publishes the tools it finds when it starts. Each runs the query
version that was current at that moment. A new version, a changed `tool`
object, or a new published query takes effect at the next start.

Tools change when someone designs a query or releases an application, not
mid-session, so a restart is an acceptable cost. It also means a tool never
changes under an agent during a session. MCP clients read the tool list when
they connect, so a client that connects after the restart sees the new list.

### The two doors: MCP and HTTP

A published tool joins the catalogue in `packages/tools`, beside the built-in
tools. Its `buildRequest` returns `POST /execute` with the pinned version as
`targetId`, the arguments built above, and `backendId` when the call gave
one. Both doors use that one request, as the built-in tools do:

- **MCP:** `tools/list` returns the tool with its description and an
  `inputSchema` made from `params`: one property per parameter, with its JSON
  type, `format` (`date`, `date-time`, `iri`), `description`, and
  `"type": "array"` for a list. The required parameters are listed in
  `required`. `additionalProperties` is `false`. A tool backed by a SELECT,
  ASK, CONSTRUCT or DESCRIBE query carries `readOnlyHint: true`; one backed by
  an update carries `readOnlyHint: false`.
- **HTTP:** each tool is its own route, `/tools/{library-slug}/{name}`,
  generated when the server starts:
  - A tool backed by a SELECT, ASK, CONSTRUCT or DESCRIBE query, or by a
    group of them, answers `GET`, with its arguments in the query string. A
    list is the key repeated, `?affects=a&affects=b`. A `term` or
    `langString` value is its JSON spelling, URL-encoded. A `GET` can be
    cached and bookmarked, and may answer `304 Not Modified` once results
    carry a validator.
  - A tool backed by an update answers `POST`, with its arguments as a JSON
    object.
  - Both return what `POST /execute` returns.
  - `GET /tools/{library-slug}/openapi.json` is an OpenAPI 3.1 document with
    one operation per tool, its parameters typed from `params`. A page's
    client can be generated from it, and a generic client can read it at run
    time, as an agent reads `tools/list`.

  A route per tool, not one route with the tool as a parameter, is what lets
  each operation carry its own schema in the OpenAPI document. This is the
  shape a server takes when it generates endpoints from configuration at
  startup; here the configuration is the library.

A call carries the caller's token to the API, as the built-in tools do, so a
published tool grants nothing that `execute_run` on the same query would not.

### How the two doors differ

MCP and HTTP publish the same tools for different callers. An agent learns
what it can call at run time, from `tools/list`, every session, and chooses
what to call. A page or a script is written against known routes; its
contract is the OpenAPI document, read once by a developer or a code
generator. MCP adds a few milliseconds per call and a connect step per
session; HTTP adds caching on `GET` and needs no client library. A production
page uses HTTP; agents, analysis and exploration use MCP.

### Where the tools are served

- **`/mcp/{library-slug}`** lists only that library's published tools,
  without the catalogue. An application's agents connect there and see its
  tools and nothing else.
- **`/mcp`** keeps the catalogue, as now, and lists the published tools beside
  it, for a person building and trying a library.
- **A published-only server.** With `MCP_CATALOGUE=published`, `/mcp` lists
  the published tools and no catalogue tools, and the API's authoring routes
  answer 404. A production deployment of an application sets it, as
  `MCP_READ_ONLY` sets read-only mode today. `/tools/{library-slug}/…` and
  `POST /execute` stay.

An agent given only an application's endpoint cannot run arbitrary SPARQL
through `sparql_proxyQuery`, or create queries. That is a matter of what it
can see, not of permission. Grants still decide what each token may do.

## Part B, optional: why an update wrote nothing

An update whose preconditions fail writes nothing, and `POST /execute`
reports success. For a person or an agent, an unexplained "done" is the worst
answer. `pm` solves this with a convention, which sqlib could adopt for
published update tools:

- The update binds each precondition as a flag, `?ok_<name>`, true when it
  holds. Its last line is `FILTER(?ok)`, where `?ok` is the conjunction of the
  flags.
- When the update changes nothing, sqlib runs the update's `WHERE` clause as
  a `SELECT`, without the final `FILTER(?ok)`, with the same arguments. Each
  flag that is not true in some row failed.
- The `tool` object maps each flag to a message, which may name parameters
  as `{title}`:

  ```json
  "refusals": { "openQuestion": "{answers} is not an open question; answer an open one, or leave answers out." }
  ```

- The call then fails with status 409 and
  `{ "refused": [{ "flag": "openQuestion", "message": "…" }] }`. In MCP this is
  a tool error with the messages as text.

A tool without `refusals` behaves as `POST /execute` does now. Part B can ship
after part A.

## Out of scope

- **Setting the actor from the sign-in.** `pm` passes who is writing as a
  parameter, so a caller can name anyone. Filling a parameter from the
  caller's identity belongs with sqlib's authentication and grants work.
- **Writes of several queries in one call.** A tool is one query. A write that
  needs a value read first does the read in its update's `WHERE` clause.
- **Shaping results.** A published SELECT returns SPARQL Results JSON, as
  `POST /execute` does. Agents read it well, and a page shapes it itself.

## Open questions

1. Where the `tool` object is stored: on the entity, as here, or on the
   version, so that publishing a tool is part of cutting a version.
2. Whether `MCP_CATALOGUE=published` should also hide `POST /execute`, so
   that a production server runs only its published tools.
3. Whether the server should refuse to start when a published tool is
   invalid, or start and log it. Refusing is safer for an application in
   production. Logging is kinder while designing queries.
