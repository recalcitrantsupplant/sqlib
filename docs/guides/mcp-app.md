# The query bench in a chat client (MCP App)

The MCP server publishes three **Views** — sandboxed HTML documents an
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

## The three Views

| Resource | Rendered for | What it does |
| --- | --- | --- |
| `ui://sqlib/bench` | `app.bench.open` | Edits SPARQL, detects its parameters as you type, fills arguments, runs against a backend, saves a version, creates toy data |
| `ui://sqlib/result` | `execute.run`, `sparql.proxyQuery` | A table of the result, with RDF terms rendered by kind |
| `ui://sqlib/tutorial` | `app.tutorial.open` | A library read as a course: lessons, examples and exercises in a CodeMirror editor that analyses, runs and checks SRL and SPARQL. See [The rules tutorial](#the-rules-tutorial) |

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

**A rendering tool has to say so in words.** Hosts strip `_meta` before the
model sees a result, so the binding is invisible to it — in one session the
model reported that sqlib "exposes only one rendered UI" and missed both result
tables, because only `app_bench_open` *looked* like a UI tool by name. The
answer is not to rename `execute.run`, which is the execution tool for every
caller: it is to state the rendering in the description and once in the session
guide, which is the only channel that always reaches the model. A test asserts
every UI-bound tool does both.

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

## The rules tutorial

`app.tutorial.open` opens a library as a course in SPARQL rules (SRL). Each
lesson shows its objectives, its worked examples and its exercises; the learner
edits in a CodeMirror editor with the SRL, SPARQL and Turtle grammars the web
app uses, and gets the same three answers the W3C suite asks of a document —
does it parse, is it well-formed, does it stratify — under the editor as they
type, with each rule's stratum beside it.

```json
{ "name": "app_tutorial_open", "arguments": { "libraryId": "urn:sqlib:library:srl-tutorial", "lesson": "3" } }
```

### The course is the library

There is no tutorial entity. A library becomes a course by convention, out of
things sqlib already stores and a visitor can already browse:

| In the course | In the library |
| --- | --- |
| A lesson | A tag whose name starts with a number: `3. DATA blocks`. Its description is the lesson's objectives |
| A worked example | A rule set or query carrying the lesson's tag |
| An exercise | A test carrying the lesson's tag. Its subject's **first version** is where the learner starts, its **current version** is the solution, and its cases hold the input data and the expected answer |
| The prefixes | `PREFIX` lines in the library description, the course's prologue — a rule set is stored with its IRIs expanded and one rule to a line, so the View exports it against these prefixes and pretty-prints it with `detection.format` |

Descriptions are rendered as a little Markdown: paragraphs, `-` lists, fenced
code, `inline code`, bold and emphasis. The demo repository's
`instances/main/tutorial/` is a ten-lesson course written this way, from a
first rule to stratification, the ground graph and how rules compile to SPARQL.

### Checking an answer

A test runs its *saved* subject, and what needs judging is the text in the
editor, so the View checks it itself, in two steps:

1. `srl.analyze`: a rule set that does not parse, is not well-formed or does not
   stratify is rejected before it runs. Some wrong answers run *correctly* — a
   `FILTER` written before the pattern that binds its variable compiles to
   SPARQL, where a filter scopes over its whole group — and SRL still rejects
   them.
2. `srl.run` over each case's data graph version, and a comparison with the
   case's expectation: the inference graph as a set of N-Triples lines (blank
   nodes by count), or a query's rows as a set (in order when the case says
   `ordered`). Differences are listed as triples missing and triples not
   expected.

The course's own tests stay the authority: they are what CI runs to prove every
solution still passes.

### No state, and the model as tutor

The tutorial keeps nothing. Which exercises passed lives in the frame and goes
with it; every call the View makes reads or computes, so it works unchanged on
a read-only deployment and under `MCP_READ_ONLY`. What it does instead is tell
the model, in one line each, which lesson is open and what each run and check
produced, and **Ask for a hint** puts the learner's attempt in the chat. The
model is the tutor; the View is the blackboard.

### The tools it reads through

`srl.analyze`, `srl.compile` and `srl.run` answer questions about SRL *text*,
stored nowhere, and are published to the model too: an agent helping with
rules needs them whether or not a tutorial is open. `tags.list`, `tests.list`,
`tests.listVersions` and `ruleSets.exportSrl` are app-only (`visibility:
['app']`): the View reads the course through them, and they would cost every
session a listing entry to offer the model nothing it lacks.

The editor is CodeMirror 6, bundled by `packages/mcp-app/scripts/bundle-editor.mjs`
into `src/kit/editor.bundle.js` (a build output, gitignored) and inlined where a
View writes `<!--@kit:editor-->`. It cannot come from a CDN: the Views declare an
empty `resourceDomains`. It makes the tutorial about 490 KB, which the size test
allows for a View carrying the editor and no other.

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

**`_meta.ui.permissions` is a map, not a list.** The specification keys it by
permission name with an empty object as the value (`{ camera: {} }`), mirroring
the iframe `allow` attribute it becomes. This server sent `[]` from the first
commit until 2026-09-26. Claude ignores the field, so every check here passed
and the bench rendered; ChatGPT validates it and refused to register the
connector at all, with `_meta.ui.permissions must be a dict`. An empty map means
what the empty array was meant to mean: no browser permission is granted. The
smoke test now checks the type, because it is the one field whose wrongness only
shows up inside somebody else's product.

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

## Telling people how to connect

The app's **MCP** screen (`/mcp-server`, and the rail entry that replaced Build)
is the user-facing half of all this: the server URL with a copy button, an *Add
to Claude* button, per-client steps for ChatGPT, Claude web, Claude Code, Claude
Desktop and Cursor, three cards saying what a chat client gets, and a **Read the
catalogue** button that performs a real handshake (`initialize`, the initialized
notification, `tools/list`) and reports the server's name, its tool count and
whether any tool writes.

**Both vendors move these menus, so the steps carry a date.** Checked 2026-09-24:

| Client | Where a custom MCP server is added |
| --- | --- |
| Claude web | `claude.ai/customize/connectors`, then **+** → **Add custom connector**. Team and Enterprise need an owner to add it first at `claude.ai/admin-settings/connectors`. |
| ChatGPT | **Settings → Apps → Advanced settings**, switch on developer mode, then create a connector on that page. The section has been called Connectors, then Apps, then Plugins. |

*Add to Claude* links `claude.ai/customize/connectors`. It used to link
`claude.ai/settings/connectors?modal=add-custom-connector`, which opened the
modal with the name and URL prefilled from the query string; that route now
renders a stub reading "Connectors have moved to Customize", so the button led
to a dead end that still looked official. Anthropic documents no prefill
parameters on the new page, so the interface no longer promises a filled-in
form. The parameters are still appended, cost nothing and are ignored by a page
that does not read them. `claudeConnectorLink` has a test asserting the
documented path, so the next move fails a test rather than waiting for someone
to notice a screenshot.

That button was a *Test connection* button first, and it was worse than useless.
A browser already talking to this app reaching a URL on the same host proves a
tautology, while a green tick on it reads as "MCP works" to everyone who sees
one. Whether a chat client can reach the server is decided on Anthropic's or
OpenAI's network and nothing in this page can speak for it. What the request
does know is the catalogue, which is invisible everywhere else in the app and is
the thing worth confirming before handing the URL out: 53 tools and no writes is
a read-only deployment, 96 is not. So the section reports that and says plainly
that it says nothing about reachability.

The route is `/mcp-server` rather than `/mcp` because `/mcp` is the API's own
path. Nothing here serves the app and the API from one origin, but a reverse
proxy in front of both is an ordinary thing to build.

The URL is derived as `/mcp` beside the API, which is where every mode in this
repository serves it. `NUXT_PUBLIC_MCP_URL` overrides it, for a public MCP on a
different host from the app that administers it.

## Testing against a real web client, with a tunnel

Claude and ChatGPT connectors take a URL, and their servers have to reach it.
`just run-local-https` gives a locally trusted certificate, which satisfies a
desktop app on the same machine and does nothing for claude.ai. A tunnel is the
only way to test the web clients without deploying:

```bash
MCP_READ_ONLY=1 just run-local-memory     # one terminal
just tunnel-mcp                            # another
```

`tunnel-mcp` uses ngrok or cloudflared, whichever is installed, and takes
`tool=ngrok` or `tool=cloudflared` to choose; neither needs an account for a
random per-run hostname. It refuses to start when nothing answers on the port,
because a tunnel to a dead port returns 502 and Claude reports that as "unable
to reach the connector", which sends you looking at the tunnel instead of at the
server you forgot to start. The endpoint is the printed https URL with `/mcp` on
the end.

There is no authentication to add here, and no point looking for one: a custom
connector authenticates with OAuth or not at all, and neither Claude nor ChatGPT
sends an HTTP basic-auth header, so a tunnel's basic-auth option would lock out
a browser and not the client you are testing. What protects a quick tunnel is
that the hostname is random, it dies with the process, and the server behind it
publishes only what you started it with. Start it read-only. Do not tunnel a
server holding data you would mind a stranger reading.

## Publishing it read-only

A public deployment should set `MCP_READ_ONLY=1`. The registry is then built
from the definitions marked `readOnly`, so the writes are not refused at call
time — they are never declared and never listed. `tools/list` returns 57 tools
instead of 100 (a further four in either mode are app-only: a View calls them,
and they are never listed), `initialize` says so in the instructions, and the
bench drops Save version and Toy data.

Read-only means "does not mutate the library", not "does not run anything".
Execution survives, deliberately: `execute.run`, `sparql.proxyQuery`,
`rules.execute` and `ruleSets.execute` all mutate nothing, and
`patches.previewUpdate` shows the triples an update *would* write without
writing them. So a session can still explore, parameterise and run — a scratch
query with supplied arguments works through `sparql.proxyQuery`, which takes the
same `arguments`/`limits`/`offsets` payload as `execute.run` — it just leaves
nothing behind.

One hole read-only does **not** close: `sparql.proxyQuery` accepts a bare
`endpoint` URL, so an unauthenticated read-only server is an open SPARQL proxy,
fetching whatever a caller names. `MCP_SPARQL_ENDPOINTS=backends-only` refuses
those calls, leaving the registered backends as the only reachable targets.
That is a separate decision from read-only and is spelled separately.

**The browser side does not carry over.** Backends and queries the SPA keeps in
`localStorage` live in that browser; an MCP client talks to the server over
HTTPS and has no access to them. Over MCP the server-side library is the only
store there is, which is worth saying out loud to anyone who used the web app
first.

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
