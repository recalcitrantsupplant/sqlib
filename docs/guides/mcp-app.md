# The query bench in a chat client (MCP App)

The MCP server publishes two **Views** — sandboxed HTML documents an
Apps-capable chat client renders inline in the conversation — so a session can
edit, run and save a query instead of reading JSON about one. The design and
the reasoning behind it are in [design/mcp-app.md](../design/mcp-app.md); this
page is how to run it and what it does.

This is an MVP: the bench works end to end, and the parts the design marks for
later (a server-side draft store, a library View, query-group awareness) are not
here. An edit lives in the rendered frame until you save it as a version.

## What it is built on

[MCP Apps (SEP-1865)](https://github.com/modelcontextprotocol/ext-apps), the
first official MCP extension. A server declares UI resources under the `ui://`
scheme with the MIME type `text/html;profile=mcp-app`; a tool names one in
`_meta.ui.resourceUri`; the host renders it in a sandboxed iframe and speaks
JSON-RPC to it over `postMessage`. A View is an MCP client: it calls `tools/call`
back through the host, which is the only way it reads or writes anything.

## The two Views

| Resource | Rendered for | What it does |
| --- | --- | --- |
| `ui://sqlib/bench` | `app.bench.open` | Edits SPARQL, detects its parameters as you type, fills arguments, runs against a backend, saves a version, creates toy data |
| `ui://sqlib/result` | `execute.run`, `sparql.proxyQuery` | A table of the result, with RDF terms rendered by kind |

The bench is opened by a tool the model calls:

```json
{
  "name": "app_bench_open",
  "arguments": {
    "libraryId": "urn:sqlib:library:…",
    "queryString": "SELECT ?city ?pop WHERE {\n  VALUES (?city) { (UNDEF) }\n  ?city :population ?pop .\n} LIMIT 00010"
  }
}
```

`queryId` opens it on a saved query instead; `backendId` preselects a backend.

What the bench does from there it does with the ordinary catalogue tools —
`detection.validateQuery`, `detection.detectInputs`, `sparql.proxyQuery`,
`execute.run`, `queries.create`, `queries.createVersion`, `dataGraphs.*`,
`backends.create` — so there is no second implementation of anything, and every
call is visible to the host.

After a run or a save, the bench tells the model **one line** through
`ui/update-model-context`: the row count, the column names, three sample rows,
the duration, or the version that was saved. The rows themselves stay in the
frame. That is deliberate — a bench that dumped results into the conversation
would exhaust the context it exists to help.

### Toy data

Open **Toy data** in the bench, paste a few triples and press *Create toy
backend*. Three entities appear in the library: a `DataGraph`, an immutable
`DataGraphVersion` holding the Turtle, and an `oxigraphMemory` backend hydrated
from that graph. Such a backend is read-only — the API refuses writes to a
hydrated store, because a reload would discard them — so the toy data cannot
drift from the graph that defines it. Editing it means a new data graph version.

### What gets persisted

The chat is disposable; the library is not. Saving a version writes a `Query`
(on the first save) and a `QueryVersion`, both ordinary library entities with the
usual history, export and immutability. Nothing in the bench is a new kind of
thing, and a library exported after a session is the session's real output.

## Testing it locally

### 1. The harness — no Apps-capable client needed

```bash
just run-local-memory        # API + MCP on :3005
just run-mcp-app-harness     # the harness on :3006
```

Open <http://localhost:3006/>, press **Connect**, pick `app_bench_open`, put a
library IRI in the arguments and press **Call tool & render**. The harness is a
minimal MCP Apps host: it initializes with the UI extension capability, calls
the tool, reads the `ui://` resource, renders it in a sandboxed iframe
(`sandbox="allow-scripts allow-modals"`, no `allow-same-origin`, so the View has
an opaque origin) and bridges every message. Its bridge log shows each
`tools/call` the View makes and every line it sends to the model, which is the
fastest way to see what a View is actually doing.

You need a library to open it on; create one first:

```bash
curl -s -X POST localhost:3005/libraries \
  -H 'content-type: application/json' -d '{"name":"Bench demo"}'
```

### 2. The smoke test — no browser needed

```bash
just smoke-mcp-app                       # against localhost:3005/mcp
just smoke-mcp-app https://host/mcp      # or anywhere else
```

It checks the protocol rather than the pixels: that a UI-capable client is
offered `_meta.ui`, that a plain client is offered none, that both see the same
tools, and that each `ui://` resource reads back as a self-contained document.
Run it first when something does not render — it separates a server problem from
a View problem.

### 3. A real client

Point any Apps-capable MCP client (Claude, ChatGPT, VS Code, Goose) at the
server as described in [mcp-clients.md](mcp-clients.md). The server checks
`capabilities.extensions["io.modelcontextprotocol/ui"]` on `initialize`: a
client that does not advertise it gets the catalogue with no `_meta.ui` at all
and behaves exactly as it did before this existed. Rendering is up to each
host, and support differs between them — which is why the harness exists.

### Editing a View

`renderView` memoises the assembled HTML per process. While working on a View,
run the server with `MCP_APP_NO_CACHE=1` so a re-render picks up the file, and
rebuild `@sparql-query-lib/mcp-app` if the server is running from `dist`.

## Security

The [security model](../explanation/security-model.md) applies unchanged, and a
rendered UI makes an exposed `/mcp` more tempting, not less — it still carries
no authentication of its own.

Each View declares an empty CSP allowlist: no `connectDomains`, no
`resourceDomains`, no `frameDomains`, no browser `permissions`. A host that
enforces the declaration gives the View no network at all, so everything it
reads or writes is a JSON-RPC message the host can see, refuse or log. Views
build result tables as DOM nodes, never as HTML strings, so a hostile literal in
a result is text rather than markup. Writes are limited to creating queries,
versions, data graphs and a hydrated backend; deleting anything goes back
through the model, where the host's confirmation lives.
