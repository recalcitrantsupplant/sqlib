# The query bench in a chat client (MCP App)

The MCP server publishes three **Views**. A View is a sandboxed HTML document
that a chat client with MCP Apps support renders in the conversation. With the
bench View, a session can edit, run and save a query, and does not have to read
JSON about it. [design/mcp-app.md](../design/mcp-app.md) gives the design and
its reasons. This page tells you how to run the Views and what they do.

Status:

- Done: the bench works from start to end.
- To do, as the design describes: a draft store on the server, a library View,
  and support for query groups.

An edit stays in the rendered frame until you save it as a version.

## What it is built on

The Views use [MCP Apps (SEP-1865)](https://github.com/modelcontextprotocol/ext-apps),
the first official MCP extension:

1. A server declares UI resources under the `ui://` scheme, with the MIME type
   `text/html;profile=mcp-app`.
2. A tool names one resource in `_meta.ui.resourceUri`.
3. The host renders the resource in a sandboxed iframe, and sends JSON-RPC to it
   over `postMessage`.

A View is an MCP client. It sends `tools/call` back through the host. This is
the only way that a View reads or writes data.

## The three Views

| Resource | Rendered for | What it does |
| --- | --- | --- |
| `ui://sqlib/bench` | `app.bench.open` | Edits SPARQL, finds its parameters as you type, fills arguments, runs against a backend, saves a version, makes toy data |
| `ui://sqlib/result` | `execute.run`, `sparql.proxyQuery` | Shows the result as a table, with each RDF term rendered by kind |
| `ui://sqlib/tutorial` | `app.tutorial.open` | Shows a library as a course: lessons, examples and exercises, in a CodeMirror editor that analyses, runs and checks SRL and SPARQL. See [The rules tutorial](#the-rules-tutorial) |

The model opens the bench with a tool call:

```json
{
  "name": "app_bench_open",
  "arguments": {
    "libraryId": "urn:sqlib:library:…",
    "queryString": "SELECT ?city ?pop WHERE {\n  VALUES (?city) { (UNDEF) }\n  ?city :population ?pop .\n} LIMIT 00010"
  }
}
```

With `queryId`, the bench opens on a saved query. `backendId` selects a backend
in advance.

**The description of a rendering tool must say that it renders.** Hosts remove
`_meta` before the model sees a result, so the model cannot see the binding. In
one session, the model reported that sqlib "exposes only one rendered UI". It
missed both result tables, because only the name `app_bench_open` suggested a
UI. `execute.run` is the execution tool for each caller, so a new name is not
the fix. The description of each such tool states that it renders, and the
session guide states it once. The session guide is the only channel that always
reaches the model. A test checks that each UI-bound tool does both.

After it opens, the bench uses the ordinary catalogue tools:
`detection.validateQuery`, `detection.detectInputs`, `sparql.proxyQuery`,
`execute.run`, `queries.create`, `queries.createVersion`, `dataGraphs.*` and
`backends.create`. No function has a second implementation, and the host can
see each call.

After a run or a save, the bench sends the model **one line** through
`ui/update-model-context`. The line gives the row count, the column names, three
sample rows and the duration, or the version that was saved. The rows stay in
the frame. If the bench put all results into the conversation, it would fill
the context of the model.

### Toy data

Open **Toy data** in the bench, paste some triples, and press *Create toy
backend*. Three entities appear in the library:

- a `DataGraph`;
- an immutable `DataGraphVersion` that holds the Turtle;
- an `oxigraphMemory` backend loaded from that graph.

This backend is read-only. The API refuses writes to a loaded store, because a
reload would lose them. The toy data therefore always matches the graph that
defines it. To change the data, make a new data graph version.

### What gets persisted

The library keeps the result of a session, and the chat does not. The first save
writes a `Query`. Each save writes a `QueryVersion`. Both are ordinary library
entities, with the usual history, export and immutability. The bench makes no
new kind of entity. A library exported after a session holds all of its output.

## The rules tutorial

`app.tutorial.open` opens a library as a course in SPARQL rules (SRL). Each
lesson shows its objectives, its worked examples and its exercises. The learner
edits in a CodeMirror editor, with the SRL, SPARQL and Turtle grammars of the web
app. As the learner types, the View shows the three answers that the W3C suite
asks of a document: does it parse, is it well-formed, and does it stratify. It
also shows the stratum of each rule.

```json
{ "name": "app_tutorial_open", "arguments": { "libraryId": "urn:sqlib:library:srl-tutorial", "lesson": "3" } }
```

### The course is the library

sqlib has no tutorial entity. A library becomes a course by a convention. The
course uses entities that sqlib already stores, and that a visitor can already
browse:

| In the course | In the library |
| --- | --- |
| A lesson | A tag whose name starts with a number: `3. DATA blocks`. Its description gives the objectives of the lesson |
| A worked example | A rule set or query with the tag of the lesson |
| An exercise | A test with the tag of the lesson. The **first version** of its subject is the start point for the learner. The **current version** is the solution. Its cases hold the input data and the expected answer |
| The prefixes | `PREFIX` lines in the library description, the prologue of the course. sqlib stores a rule set with its IRIs expanded and one rule on each line. The View exports it with these prefixes, and formats it with `detection.format` |

The View renders descriptions as a small set of Markdown: paragraphs, `-`
lists, fenced code, `inline code`, bold and emphasis. In the demo repository,
`instances/srl/tutorial/` is a course of ten lessons in this form. It starts
with a first rule, continues to stratification and the ground graph, and ends
with the differences for a reader who knows SPARQL.

### Checking an answer

A test runs its *saved* subject. The answer to check is the text in the editor,
so the View checks it itself, in two steps:

1. `srl.analyze`. The View rejects a rule set that does not parse, is not
   well-formed, or does not stratify, before it runs. Some wrong answers give
   the right triples, for example a `FILTER` before the pattern that binds its
   variable. They are still not valid SRL.
2. `srl.run` over the data graph version of each case, and a comparison with
   the expectation of the case. For a rule set, the comparison is of the
   inference graph as a set of N-Triples lines, with blank nodes compared by
   count. For a query, it is of the rows as a set, or in order when the case
   says `ordered`. The View lists the differences as missing triples and
   unexpected triples.

The tests of the course stay the authority. CI runs them to show that each
solution still passes.

### No state, and the model as tutor

The tutorial keeps nothing. The record of passed exercises is in the frame, and
is lost with it. Each call that the View makes reads or calculates, so the View
works without change on a read-only deployment and with `MCP_READ_ONLY`.

The View tells the model, in one line each time, which lesson is open and the
result of each run and check. **Ask for a hint** puts the attempt of the learner
in the chat. The model is the tutor, and the View shows the work.

### The tools it reads through

`srl.analyze`, `srl.compile` and `srl.run` answer questions about SRL *text*
that is not stored. sqlib also publishes them to the model, because an agent
that helps with rules needs them when no tutorial is open.

`tags.list`, `tests.list`, `tests.listVersions` and `ruleSets.exportSrl` are
for the app only (`visibility: ['app']`). The View reads the course through
them. If sqlib listed them for the model, each session would pay for the list
entries, and the model would get nothing new.

**Offer to convert SPARQL**, under an SRL editor, turns on the
`sparqlConversions` option of the grammar. The rule editors of sqlib use the same
option. The editor always underlines SRL conformance errors. With the option on,
the underline on a SPARQL `BIND` or `FILTER NOT EXISTS` also offers a rewrite to
the related SRL construct (`SET`, `NOT { … }`) in one click. The specification
defines each SRL construct differently from its SPARQL form. The lessons of the
course state this, and link to the
[section of the specification on SPARQL](https://w3c.github.io/data-shapes/sparql12-rl/#srl-sparql-relationship).
The option is off by default. The browser remembers it when the frame can use
storage.

The editor is CodeMirror 6:

- `packages/mcp-app/scripts/bundle-editor.mjs` bundles it into
  `src/kit/editor.bundle.js`, a build output that git ignores.
- A View includes the bundle where it writes `<!--@kit:editor-->`.
- The bundle cannot come from a CDN, because the Views declare an empty
  `resourceDomains`.
- The editor makes the tutorial about 490 KB. The size test allows this for one
  View with the editor.

## Testing it locally

### 1. The harness: no client with MCP Apps support needed

```bash
just run-local-memory        # API + MCP on :3005
just run-mcp-app-harness     # the harness on :3006
```

You can edit the endpoint box of the harness. Set it to the address of your
server.

You need a library to open the bench on. Make one first:

```bash
curl -s -X POST localhost:3005/libraries \
  -H 'content-type: application/json' -d '{"name":"Bench demo"}'
```

Then:

1. Open <http://localhost:3006/>, and press **Connect**.
2. Select `app_bench_open`.
3. Put a library IRI in the arguments, and press **Call tool & render**.

The harness is a minimal MCP Apps host. It:

- initialises with the UI extension capability;
- calls the tool and reads the `ui://` resource;
- renders the resource in a sandboxed iframe
  (`sandbox="allow-scripts allow-modals"`, without `allow-same-origin`, so the
  View has an opaque origin);
- passes each message between the View and the server.

Its bridge log shows each `tools/call` from the View and each line that the View
sends to the model. This is the fastest way to see what a View does.

### 2. The smoke test: no browser needed

```bash
just smoke-mcp-app                       # against localhost:3005/mcp
just smoke-mcp-app https://host/mcp      # or anywhere else
```

The smoke test checks the protocol, and does not render. It checks that:

- a client with UI support gets `_meta.ui`;
- a plain client gets no `_meta.ui`;
- both clients see the same tools;
- each `ui://` resource reads back as a self-contained document.

When a View does not render, run this test first. It tells a server problem from
a View problem.

### 3. A real client

**sqlib publishes the bindings to each client, whatever the client
advertises.** The specification says that a server SHOULD check
`capabilities.extensions["io.modelcontextprotocol/ui"]`, and this server did
check it before. Claude declares `roots` and `elicitation` and no `extensions`
key, but renders apps. The check therefore kept `_meta.ui` from the host that
was most likely to use it. The bench came back as plain text, and the server
appeared correct from its own side. ChatGPT does advertise the extension, so
the check appeared correct there. A client that cannot render loses nothing
when it gets the binding, because it can ignore `_meta`, and the text `content`
is always present. Set `MCP_APPS=off` to keep all bindings back, to test the
fallback.

When a client gets the binding, the host decides whether to show the View. Hosts
differ in their support. The harness is for this reason.

**A host needs seven things from the server, and each one fails without an
error.** The list comes from
[ext-apps#671](https://github.com/modelcontextprotocol/ext-apps/issues/671),
where a developer recorded what it took to render a custom connector. This
server does all seven. Each item hides the next one, so they are in order:

1. **Declare `capabilities.extensions["io.modelcontextprotocol/ui"]` at
   `initialize`.** Do it when the server is constructed. A stateless transport
   that makes a server for each request calls `oninitialized` too late for a
   reaction to the client.
2. **Put `_meta.ui.resourceUri` on the `tools/call` result**, as well as on the
   `tools/list` entry. Also send the flat form `_meta["ui/resourceUri"]`. Hosts
   differ in which form they read.
3. **Return `_meta.ui` with its `csp` on the `resources/read` content item.**
   Use empty arrays for a self-contained View. A wrong value stops the View from
   mounting. An omitted value does not.
4. **Put all code into the HTML.** An import from a CDN throws during module
   evaluation, and stops the script before the handshake.
5. **Always send `ui/notifications/initialized`**, with a timeout as a backup.
   Do not wait to recognise the `ui/initialize` reply. The host keeps the iframe
   hidden until the notification arrives. A View that waits for a reply that it
   does not understand stops: nothing renders, and no error shows.
6. **Put a content hash in the `ui://` URI.** Hosts cache by URI, so a fixed URI
   can serve a copy that is days old. This looks the same as an edit that has no
   effect.
7. **Keep the URI without the hash available.** Hosts ask for URIs from tool
   declarations that they cached earlier. A 404 on such a URI shows as *Unable
   to reach &lt;connector&gt;*. If you do item 6 without item 7, the View is
   unavailable, where before it was out of date.

**`_meta.ui.permissions` is a map.** The specification keys it by permission
name, with an empty object as the value (`{ camera: {} }`), as in the iframe
`allow` attribute that it becomes. This server sent a list, `[]`, from the first
commit until 2026-09-26. Claude ignores the field, so each check passed and the
bench rendered. ChatGPT validates the field, and refused to register the
connector, with `_meta.ui.permissions must be a dict`. An empty map grants no
browser permission, which is what the empty list was meant to do. The smoke test
now checks the type. An error in this field shows only inside the product of a
different vendor.

Two causes give *Unable to reach*. To tell them apart, read the request log:

- A dead cached URI shows two `resources/read` calls: one succeeds and one
  fails.
- A wrong `_meta.ui.domain` does not show this pair.

The most important debugging rule: **work from a request log between host and
server**, with the method, the URI, and the `result` or `error`. Do not work from
what the model says it received. Hosts remove `_meta` before the model sees a
result, so a statement from the model that "there was no `_meta` on the result"
tells you nothing about what the server sent. This mistake cost the project a
full afternoon.

**To test a metadata change against Claude, make the connector again.** Claude
caches `tools/list` for each connector session, and uses it again in new chats.
A new chat can therefore still test the old server, and a correct fix appears to
have no effect. A change to a `tools/call` *result* shows immediately. The
connector settings page also counts interactive and app-only tools. If those
counts are correct, the host has parsed your binding, and the problem is later
in the sequence.

Both transports publish the same bindings. Over stdio, `resources/list` returns
`ui://sqlib/bench` and `ui://sqlib/result` with the MCP Apps MIME type, and
`tools/list` marks the three UI-bound tools, as over HTTP.

**Desktop clients that start a local command (stdio).** Use
[the stdio block in mcp-clients.md](mcp-clients.md#client-configuration). You
need no certificates and no ports.

**Run `pnpm build` first, and again after each `git pull`.** A client of this
kind runs `node dist/cli.js`, so it reads built JavaScript. `just
run-local-memory` runs from source under `tsx`, and works with an old or missing
`dist`. An old `dist` causes two errors:

- The Views are in `packages/mcp-app/dist`. After a partial build, the server
  does not start (`ERR_MODULE_NOT_FOUND` on `mcp-app/dist`).
- A `dist` built before a dependency change still imports the old package, which
  `pnpm install` has removed. The error names the *package*
  (`Cannot find package '@modelcontextprotocol/sdk'`), and does not say that the
  build is old.

Both errors look like configuration problems. They are build problems.

The root `build` script once listed seven packages by name, without `mcp-app`
and `mcp-server`, so it did not rebuild either. If a `dist` does not change when
you rebuild, check that the script names that package.

**Desktop clients that take a URL.** Some require HTTPS, and refuse a plain
`http://localhost` endpoint. Use the HTTPS recipes:

```bash
just setup-local-https     # once: mkcert installs a local CA and issues a cert
just run-local-https       # API + MCP behind Traefik on :3443
```

Then give the client `https://localhost:3443/mcp`. `mkcert -install` puts the CA
in the system trust store. A desktop app that uses the trust store of the
operating system then trusts it with no flag.

Some clients refuse `localhost` and require a public hostname. A tunnel
(`cloudflared tunnel --url https://localhost:3443`) gives you one. **`/mcp` has
no authentication**, so a public tunnel lets any person with the URL use each
library on the server and each backend that it can reach. Keep the tunnel open
for a short time only, or run the server with `SQLIB_AUTH_MODE=required` first.

### Editing a View

`renderView` keeps the assembled HTML in memory for the life of the process.
When you work on a View, run the server with `MCP_APP_NO_CACHE=1`, so that a new
render reads the file. If the server runs from `dist`, rebuild
`@sparql-query-lib/mcp-app`.

## Telling people how to connect

The **MCP** screen of the app (`/mcp-server`, and the rail entry that replaced
Build) is the part for users. It shows:

- the server URL, with a copy button;
- an *Add to Claude* button;
- steps for each client: ChatGPT, Claude web, Claude Code, Claude Desktop and
  Cursor;
- three cards that say what a chat client gets;
- a **Read the catalogue** button.

**Read the catalogue** does a real handshake (`initialize`, the initialized
notification, `tools/list`). It reports the name of the server, its tool count,
and whether any tool writes.

**Both vendors move these menus, so the steps carry a date.** Checked 2026-09-24:

| Client | Where to add a custom MCP server |
| --- | --- |
| Claude web | `claude.ai/customize/connectors`, then **+** → **Add custom connector**. On Team and Enterprise, an owner must first add it at `claude.ai/admin-settings/connectors`. |
| ChatGPT | **Settings → Apps → Advanced settings**. Turn on developer mode, then make a connector on that page. The section was named Connectors, then Apps, then Plugins. |

*Add to Claude* opens the **Add custom connector** dialog of Claude with this
server filled in. It uses the deep link in the Claude documentation:

```
https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=sqlib&connectorUrl=<URL-encoded endpoint>
```

The parameter names are the interface, and they have changed once. The button
linked to `claude.ai/settings/connectors?modal=add-custom-connector`, with
`mcpName` and `mcpServerUrl`. That route now shows a page that says
"Connectors have moved to Customize". A change of the path alone, with the old
names, showed the same page. A test on `claudeConnectorLink` pins the documented
path and names. The next change will therefore fail a test.

The first version of that button was *Test connection*, and it gave a false
result. A browser that already uses this app can always reach a URL on the same
host. A green tick tells each person who sees it that MCP works. A chat client
reaches the server from the network of Anthropic or OpenAI, and this page cannot
test that network. The request can read the catalogue, which no other screen
shows, and which you should check before you give out the URL. 53 tools with no
writes is a read-only deployment. 96 tools is not. The section reports this, and
states that it does not test reachability.

The route is `/mcp-server`, because `/mcp` is the path of the API. No mode in
this repository serves the app and the API from one origin. A reverse proxy in
front of both is a usual configuration, so the paths must not collide.

The app makes the URL as `/mcp` next to the API. Each mode in this repository
serves MCP there, so a production deployment sets nothing for it. The
`apiBaseUrl` of the SPA already names the public host. It comes from
`config.json` at run time, or `NUXT_PUBLIC_API_BASE_URL` at build time. Set a
value only for an MCP endpoint on a *different* host: `mcpUrl` in `config.json`,
or `NUXT_PUBLIC_MCP_URL` at build time.

The server also needs no public URL. The MCP server makes no absolute links.
Views are `ui://` resources, read over the same connection. A tool result
carries data, and no URLs.

## Testing against a real web client, with a tunnel

Claude and ChatGPT connectors take a URL, and their servers must reach it. `just
run-local-https` gives a certificate that only your computer trusts. This is
enough for a desktop app on the same computer, and has no effect for claude.ai.
To test the web clients without a deployment, use a tunnel:

```bash
MCP_READ_ONLY=1 just run-local-memory     # one terminal
just tunnel-mcp                            # another
```

`tunnel-mcp` uses ngrok or cloudflared, whichever is installed. To select one,
pass `tool=ngrok` or `tool=cloudflared`. Neither needs an account for a random
hostname for each run. The endpoint is the printed https URL with `/mcp` at the
end.

`tunnel-mcp` does not start when nothing answers on the port. A tunnel to a dead
port returns 502, and Claude reports it as "unable to reach the connector". You
would then look for a fault in the tunnel, when the server is not running.

You cannot add authentication to the tunnel. A custom connector authenticates
with OAuth or not at all. Neither Claude nor ChatGPT sends an HTTP basic-auth
header, so the basic-auth option of a tunnel blocks a browser, and also blocks
the client that you test. Three things protect a quick tunnel:

- the hostname is random;
- the tunnel stops with the process;
- the server publishes only the tools that you started it with.

Start the server read-only. Do not tunnel a server that holds private data.

## Publishing it read-only

Set `MCP_READ_ONLY=1` on a public deployment. sqlib then builds the registry
from the definitions marked `readOnly`. The server does not refuse writes at
call time, because it never declares or lists them:

- `tools/list` returns 57 tools in place of 100. In each mode, four more tools
  are app-only: a View calls them, and they are never listed.
- `initialize` says that the server is read-only, in the instructions.
- The bench removes Save version and Toy data.

Read-only means that a call does not change the library. Calls can still run
queries:

- `execute.run`, `sparql.proxyQuery`, `rules.execute` and `ruleSets.execute`
  change nothing.
- `patches.previewUpdate` shows the triples that an update *would* write, and
  writes nothing.

A session can therefore explore, add parameters and run. A scratch query with
arguments works through `sparql.proxyQuery`, which takes the same
`arguments`/`limits`/`offsets` payload as `execute.run`. The session leaves
nothing in the library.

Read-only does **not** close one gap. `sparql.proxyQuery` accepts a bare
`endpoint` URL. An unauthenticated read-only server is therefore an open SPARQL
proxy, and fetches any URL that a caller names. `MCP_SPARQL_ENDPOINTS=backends-only`
refuses those calls, so the registered backends are the only targets. This
setting is separate from read-only, and you must set it separately.

**The browser data does not reach MCP.** The backends and queries that the SPA
keeps in `localStorage` stay in that browser. An MCP client talks to the server
over HTTPS, and cannot read them. Over MCP, the only store is the library on the
server. Tell this to people who used the web app first.

## Security

The [security model](../explanation/security-model.md) applies with no change. A
rendered UI makes an exposed `/mcp` more attractive to use, and `/mcp` still has
no authentication of its own.

Each View declares an empty CSP allowlist: no `connectDomains`, no
`resourceDomains`, no `frameDomains`, and no browser `permissions`. A host that
enforces the declaration gives the View no network access. Each read and write
of the View is therefore a JSON-RPC message that the host can see, refuse or
log.

Views build result tables as DOM nodes, and never as HTML strings. A hostile
literal in a result therefore shows as text. A View can only make queries,
versions, data graphs and a loaded backend. To delete an entity, the user goes
through the model, where the host asks for confirmation.
