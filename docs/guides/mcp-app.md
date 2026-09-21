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
just run-local-memory        # API + MCP on :3010
just run-mcp-app-harness     # the harness on :3006
```

`run-local-memory` sets `HTTP_PORT=3010`, so that is where `/mcp` is — the
README's 3005 is the default port, not this recipe's. The harness's endpoint
box is editable, so point it wherever your server actually is.

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
curl -s -X POST localhost:3010/libraries \
  -H 'content-type: application/json' -d '{"name":"Bench demo"}'
```

### 2. The smoke test — no browser needed

```bash
just smoke-mcp-app                       # against localhost:3010/mcp
just smoke-mcp-app https://host/mcp      # or anywhere else
```

It checks the protocol rather than the pixels: that a UI-capable client is
offered `_meta.ui`, that a plain client is offered none, that both see the same
tools, and that each `ui://` resource reads back as a self-contained document.
Run it first when something does not render — it separates a server problem from
a View problem.

### 3. A real client

**The bindings are published to every client, whatever it advertised.** The
specification says a server SHOULD check
`capabilities.extensions["io.modelcontextprotocol/ui"]`, and this server used
to. Claude declares `roots` and `elicitation`, no `extensions` key at all, and
renders apps anyway — so the check withheld `_meta.ui` from the host most
likely to use it, and the bench came back as plain text while the server looked
correct from its own side. ChatGPT does advertise, which is what made the gate
look sound. Publishing unconditionally costs a client that cannot render
nothing, because `_meta` is ignorable and the text `content` is always there.
`MCP_APPS=off` withholds it all, for testing that fallback on purpose.

Whether a client that *receives* the binding then paints the View is still that
host's business, and support differs between them — which is why the harness
exists.

**Seven server-side things a host needs, each of which fails silently.** From
[ext-apps#671](https://github.com/modelcontextprotocol/ext-apps/issues/671),
where someone got a custom connector rendering and wrote down what it took.
This server does all of them; the list is here because each one hides the next,
and in this order:

1. **Declare `capabilities.extensions["io.modelcontextprotocol/ui"]` at
   `initialize`** — at construction, not in reaction to the client. A stateless
   transport that builds a server per request fires `oninitialized` too late to
   act on.
2. **Put `_meta.ui.resourceUri` on the `tools/call` result**, not only the
   `tools/list` entry, and send the flat `_meta["ui/resourceUri"]` spelling
   too. Hosts differ on which they read.
3. **Return `_meta.ui` with its `csp` on the `resources/read` content item.**
   Empty arrays for a self-contained View. Getting it wrong blocks mounting;
   omitting it does not.
4. **Inline everything into the HTML.** A CDN import throws during module
   evaluation and kills the script before the handshake runs.
5. **Send `ui/notifications/initialized` unconditionally**, with a timeout as
   backup — never gated on recognising the `ui/initialize` reply. The host
   holds the iframe hidden until that notification lands, so a View waiting for
   a response it does not understand deadlocks: nothing renders, nothing errors.
6. **Put a content hash in the `ui://` URI.** Hosts cache against the URI, so a
   fixed one can serve a copy from days ago — indistinguishable from your edit
   doing nothing.
7. **Keep the un-hashed URI resolving.** Hosts ask for URIs from tool
   declarations they cached earlier; a 404 there reports as *Unable to reach
   &lt;connector&gt;*. Do 6 without 7 and you swap a stale View for a dead one.

Telling the two *Unable to reach* causes apart: a dead cached URI shows two
`resources/read` calls in the request log, one fine and one failing; a wrong
`_meta.ui.domain` shows no such split.

And the debugging rule that matters most: **work from a request log between
host and server** — method, URI, `result` or `error`. Not from what the model
says it received. Hosts strip `_meta` before the model sees it, so "there was
no `_meta` on the result" tells you nothing about what you sent. That mistake
cost this repo a full afternoon.

**When testing a metadata change against Claude, recreate the connector.**
Claude caches `tools/list` per connector session and reuses it across chats, so
a new chat can still be testing the old server and a working fix looks like no
fix at all. A change to a `tools/call` *result* shows up immediately. The
connector settings page also counts interactive and app-only tools — if those
counts look right, the host has parsed your binding and the problem is further
down.

Both transports publish the same thing. Over stdio, `resources/list` returns
`ui://sqlib/bench` and `ui://sqlib/result` with the MCP Apps MIME type, and
`tools/list` marks the three UI-bound tools, exactly as the HTTP door does.

**Desktop clients that take a local command (stdio).** Nothing to configure
beyond [the stdio block in mcp-clients.md](mcp-clients.md#client-configuration)
— no certificates, no ports.

**Run `pnpm build` first, and again after every `git pull`.** (Before this
guide existed, the root `build` script listed seven packages by name and
omitted `mcp-app` and `mcp-server`, so it silently never rebuilt either — if a
`dist` looks impervious to rebuilding, check that the script still names the
package you are waiting on.) A client of this
kind runs `node dist/cli.js`, so it reads built JavaScript, not source — unlike
`just run-local-memory`, which runs from source under `tsx` and is happy with a
stale or absent `dist`. Two ways that bites:

- The Views live in `packages/mcp-app/dist`, so a partial build leaves the
  server unable to start at all (`ERR_MODULE_NOT_FOUND` on `mcp-app/dist`).
- A `dist` built before a dependency change keeps importing the old package,
  which `pnpm install` has since removed — the error names the *package*
  (`Cannot find package '@modelcontextprotocol/sdk'`) and says nothing about
  the build being stale.

Both look like configuration problems and are not.

**Desktop clients that take a URL.** Several require HTTPS and refuse a plain
`http://localhost` endpoint. The repository already has the answer:

```bash
just setup-local-https     # once: mkcert installs a local CA and issues a cert
just run-local-https       # API + MCP behind Traefik on :3443
```

Then give the client `https://localhost:3443/mcp`. `mkcert -install` puts the
CA in the system trust store, so a desktop app that uses the OS store trusts it
without a flag. If the client rejects `localhost` itself — some insist on a
public hostname — a tunnel (`cloudflared tunnel --url https://localhost:3443`)
gives you one, but read the warning below first: **`/mcp` has no
authentication**, so a public tunnel exposes every library on the server and
every backend it can reach, to anyone with the URL. Keep it short-lived, or run
the server with `SQLIB_AUTH_MODE=required` before opening it.

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
