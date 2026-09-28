# Design: the sqlib MCP App — a query bench in the chat

**Status: the MVP is built.** The `ui://` resource plumbing with capability
gating, the bench and result Views, the data-graph tools and the toy-data flow
all exist; [guides/mcp-app.md](../guides/mcp-app.md) is how to run and test
them. Phases 4 (the draft store) and 5 (the library View) of §10 do not. The
rest of this page is kept as it was written, so the reasoning survives the code
— including the counts and the "today" it was written against.

It designs an [MCP Apps (SEP-1865)](https://github.com/modelcontextprotocol/ext-apps)
surface on top of the existing `packages/mcp-server`, so that a chat session
with Claude, ChatGPT, VS Code or any other Apps-capable host becomes a place to
*author* a library of SPARQL queries, not merely to call one.

Read [concepts.md](../concepts.md) first: Library, Query, QueryVersion,
ArgumentSet, DataGraph and TupleSet are used here with their exact sqlib
meanings.

## 1. The thing being designed

Today an MCP client gets 89 text tools that mirror the REST API. A model can
create a query and run it, and the user reads JSON in the transcript. Authoring
a query that way is poor: the user cannot see the SPARQL while it is being
argued about, cannot nudge a variable name without a paragraph of instruction,
and cannot tell a bad result from an empty backend.

The proposal is a small set of **Views** — sandboxed HTML documents the host
renders inline in the conversation, declared as `ui://` resources by the MCP
server and attached to tool results — that give the session a visible bench:

- the SPARQL text of the query under discussion, editable;
- its detected parameters, with an argument grid to fill;
- a **Run** button that executes against toy data and shows the result table;
- a **Save version** button that writes it into a sqlib library.

The chat is the notebook's prose and the notebook's author; **sqlib is the
notebook's storage**. Cells are not a new entity: a cell is a `Query` and its
`QueryVersion` history, in a `Library`, and the notebook's "outputs" are
`ArgumentSet`s and (optionally) saved result `TupleSet`s. That is the whole
point of doing this in sqlib rather than in an artifact — when the session ends,
what survives is a versioned, executable, exportable library, not a transcript.

### It is a notebook, but not one

Worth stating where the analogy stops, because it drives several decisions
below.

| Notebook | This |
| --- | --- |
| Cells ordered in a document | Queries in a library; order is the chat's, not the store's |
| Cell edits overwrite | Every save is a new immutable `QueryVersion` |
| Kernel state carries across cells | No shared state; a chain of queries is a `QueryGroup`, explicitly |
| Output pinned under the cell | A run is ephemeral unless promoted to a `TupleSet` or a test |
| The file is the artifact | The library is the artifact; the chat is disposable |

## 2. Background: what MCP Apps actually gives us

From the 2026-01-26 specification, the parts this design depends on:

- **UI resources.** A server publishes resources whose URI begins with `ui://`
  and whose `mimeType` is `text/html;profile=mcp-app`. The resource carries
  `_meta.ui` with its CSP allowlists (`connectDomains`, `resourceDomains`,
  `frameDomains`, `baseUriDomains`), browser `permissions`, an optional
  dedicated sandbox `domain`, and `prefersBorder`.
- **Tool → View linkage.** A tool declares `_meta.ui.resourceUri` naming the
  View that renders its result, and `_meta.ui.visibility`, an array of `"model"`
  and/or `"app"`. `visibility: ["app"]` hides a tool from the agent while
  leaving it callable by a View through `tools/call`.
- **The bridge.** A View is an MCP client speaking JSON-RPC 2.0 over
  `postMessage`. Handshake is `ui/initialize` → `ui/notifications/initialized`.
  The host pushes `ui/notifications/tool-input`, `tool-input-partial`,
  `tool-result`, `tool-cancelled`, and `ui/resource-teardown`. The View may call
  `tools/call`, `resources/read`, `ui/open-link`, `ui/message`,
  `ui/request-display-mode`, `ui/update-model-context`.
- **Capability negotiation.** The client advertises
  `capabilities.extensions["io.modelcontextprotocol/ui"]` with its accepted
  `mimeTypes`. Servers must check it and must still work text-only without it.
- **Host context.** `McpUiInitializeResult.hostContext` carries `theme`,
  `styles` (CSS variables and fonts), `displayMode`, `containerDimensions`,
  `locale`, `timeZone`, `platform`, `deviceCapabilities`, `safeAreaInsets`.
- **Sizing and display modes.** `inline` (default), `fullscreen`, `pip`,
  declared in `appCapabilities.availableDisplayModes`; flexible height with
  `ui/notifications/size-changed`.
- **Default CSP** when `ui.csp` is omitted is `default-src 'none'; script-src
  'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self'
  data:; connect-src 'none'`.

Two consequences shape everything below. First, **the View cannot reach the
sqlib API directly** — it has no network, and under this design it never asks
for one: every byte it reads or writes goes through `tools/call` on the host
bridge, which the host can log and gate. Second, **the View is not trusted
input to the model**: what it hands back to the conversation goes through
`ui/update-model-context` or `ui/message` deliberately, not implicitly.

## 3. Where it sits in the existing tree

```
packages/
  api/          Fastify routes, storage, execution        (unchanged)
  tools/        the 89-tool catalogue + registry          (extended: _meta.ui, app-only tools)
  mcp-server/   Server, stdio + streamable-http doors     (extended: resources capability)
  mcp-app/      NEW — the Views, built to single-file HTML
  web/          the Nuxt SPA                              (source of design tokens, unchanged)
```

`packages/mcp-app` builds each View to **one self-contained HTML file** with CSS
and JS inlined, no external fetches, no CDN. The build (esbuild, `--bundle
--format=iife`, an inliner step) emits into `dist/views/*.html`; `mcp-server`
imports them as strings at module load and serves them from `resources/read`.
Single-file is not a preference, it is what the default CSP makes cheapest: with
`connectDomains` and `resourceDomains` empty, nothing can be pulled at runtime.

Views are framework-free TypeScript. Vue/Nuxt is the SPA's choice and would cost
~100 KB per View for a form, a table and a CodeMirror-ish editor; a shared
`packages/mcp-app/src/kit/` (bridge client, table renderer, token bridge,
SPARQL highlighter) is the reuse mechanism instead.

### Styling

`hostContext.styles` gives the host's CSS variables and fonts. The View maps
them onto a **subset of the sqlib semantic tokens** it needs — `--surface`,
`--ink`, `--ink-muted`, `--border-default`, `--action`, `--danger`,
`--state-running`, `--rdf-*`, `--font-mono` — with sqlib's own values from
[`reference/ui-design-tokens.md`](../reference/ui-design-tokens.md) as the
fallback. The result reads as part of the host in either theme, and as sqlib
where the host has nothing to say (RDF term colours, in particular). The kit
exposes `applyHostStyles(hostContext)`; no View writes a literal colour, so the
existing stylelint rules extend to this package unchanged.

## 4. The Views

Three, deliberately few. Each is one `ui://` resource.

### 4.1 `ui://sqlib/bench` — the query bench

The centrepiece, and the only View with write buttons.

```
┌───────────────────────────────────────────────── Cities by population ──┐
│  library: Demo ▾          query: urn:… (v3, edited)      backend: toy ▾ │
├──────────────────────────────────────────────────────────────────────────┤
│  PREFIX : <http://example.org/>                                          │
│  SELECT ?city ?pop WHERE {                                               │
│    VALUES (?city) { (UNDEF) }            ← parameter 1                   │
│    ?city :population ?pop .                                              │
│  } ORDER BY DESC(?pop) LIMIT 00010       ← named limit "10"              │
├──────────────────────────────────────────────────────────────────────────┤
│  Arguments   ▸ slot 1 (?city)  [ :Perth ] [ :Hobart ] [＋]               │
│              ▸ limit "10"      [ 20 ]              ⟲ load argument set ▾ │
├──────────────────────────────────────────────────────────────────────────┤
│  [ Run ]   [ Save version ]   [ Explain in chat ]        ● 2 rows, 14 ms │
├──────────────────────────────────────────────────────────────────────────┤
│  ?city            ?pop                                                   │
│  :Perth           2 100 000                                              │
│  :Hobart            250 000                                              │
└──────────────────────────────────────────────────────────────────────────┘
```

Behaviours:

- **Edit** the SPARQL. On a 400 ms idle the View calls
  `detection.validateQuery` and `detection.detectInputs` through the bridge and
  re-renders the parameter list and the gutter markers. Parameters are found in
  the text (all-`UNDEF` `VALUES` rows, `LIMIT 000n`), never in metadata, so the
  argument grid follows the text automatically — which is exactly the sqlib
  convention that is hardest to explain in prose and easiest to show.
- **Fill arguments** in a grid, one block per slot, with a term-type selector
  (URI / literal / lang / typed) per cell. Emits the SPARQL-results-JSON shape
  `execute.run` wants, so the user never types `{"head": {"vars": …}}`.
- **Run** calls `execute.run` (saved version) or `sparql.proxyQuery` (dirty
  buffer) against the selected backend, renders the result, and — this matters —
  **reports a compact summary back to the model** via `ui/update-model-context`:
  row count, column names, the first three rows, the duration, and any error
  string. The model then knows what happened without the full result entering
  the transcript.
- **Save version** calls `queries.createVersion` (or `queries.create` first, for
  a bench that has no query yet), with a `comment` the View pre-fills from the
  chat's last user turn and the user can edit. The header's `v3, edited` marker
  becomes `v4`.
- **Explain in chat** sends `ui/message` with the current text — the escape
  hatch back into conversation when the user wants the model to take over.

The dirty buffer is the one piece of state with nowhere to live. See §6.

### 4.2 `ui://sqlib/library` — the library view

The "what have we built so far" View: queries in the library with name, tags,
current version number, parameter signature and a one-line description; filter
box; click a row to open it on the bench (`tools/call` →
`app.bench.open`, whose result carries the bench View). Also the place where a
query group's member queries are listed, because that is the first question
after three or four cells exist.

Read-only except for delete, which is routed back through the model (`ui/message`
"delete the Perth query") rather than done silently — an irreversible write
started by a click in a sandboxed frame is exactly what the host's confirmation
flow exists for.

### 4.3 `ui://sqlib/result` — the result table

A standalone table for `execute.run` results when there is no bench open — the
model ran a saved query on the user's behalf and the answer is 200 rows. Sortable
columns, RDF term rendering (prefixed URIs, typed literals, language tags),
CSV/JSON download through `ui/open-link` on a data URL, and "open the query that
produced this" back to the bench.

Split from the bench so a plain run does not drag an editor into the transcript.

## 5. The tool surface

### 5.1 UI metadata on existing tools

Three existing tools gain `_meta.ui.resourceUri` so their results render:

| Tool | View |
| --- | --- |
| `execute.run` | `ui://sqlib/result` |
| `sparql.proxyQuery` | `ui://sqlib/result` |
| `queries.list` | `ui://sqlib/library` |

`ToolDefinition` in `packages/tools/src/tools.ts` grows an optional `ui` field
(`{ resourceUri: string; visibility?: ('model'|'app')[] }`), `defineTool`
passes it through, and `registry.listTools()` emits it as `_meta.ui` — a
protocol detail, so the mapping to `_meta` belongs in `mcp-server`, not in the
catalogue. The catalogue stays door-neutral: the in-app assistant ignores `ui`.

### 5.2 New app-facing tools

A handful of tools exist for the Views, most `visibility: ["app"]` so they never
clutter the model's tool list.

| Tool | Visibility | Purpose |
| --- | --- | --- |
| `app.bench.open` | `model`, `app` | Open the bench. Args: `queryId?`, `versionNumber?`, `queryString?`, `libraryId?`, `backendId?`. Returns bench state + `_meta.ui.resourceUri = ui://sqlib/bench`. This is the tool the model calls when the user says "let's work on a query". |
| `app.bench.state` | `app` | Re-read bench state after an external change (a save the model made in the same turn). |
| `app.toy.ensure` | `model`, `app` | Idempotently create/refresh the session's toy data graph and its hydrated backend. Args: `libraryId`, `turtle` or `dataGraphId`. Returns `backendId`. |
| `app.draft.put` / `app.draft.get` | `app` | Persist the dirty buffer. See §6. |
| `dataGraphs.*`, `tupleSets.*` | `model`, `app` | **Gap to fill:** the catalogue today exposes no data-graph or tuple-set tools, so there is no MCP path to toy data at all. The routes exist (`packages/api/src/routes/data-graphs.ts`); the tools do not. |

Everything else the Views need — `detection.detectInputs`,
`detection.validateQuery`, `detection.format`, `queries.create`,
`queries.createVersion`, `queries.listArgumentSets`, `argumentSets.get`,
`execute.run` — already exists and is called unchanged. That is the payoff of
the registry being protocol-neutral: the View is one more caller, not a second
implementation.

### 5.3 Capability gating and fallback

> **Superseded by what shipped.** The gate described below was built, and it
> was wrong. Claude advertises no `extensions` key and renders apps regardless,
> so gating `_meta.ui` on the advertisement withheld the binding from the host
> it mattered most to. The server now publishes the bindings to every client and
> relies on `_meta` being ignorable and the text `content` always being present;
> `MCP_APPS=off` is the deliberate way to get the text-only behaviour. The
> reasoning below is kept because the *fallback* half of it still holds.

`createMcpServer` inspects the `initialize` result's
`capabilities.extensions["io.modelcontextprotocol/ui"]`. When absent, or when
its `mimeTypes` does not include `text/html;profile=mcp-app`:

- the `resources` capability is still advertised (harmless);
- `_meta.ui` is **omitted** from every tool;
- `app.bench.*` and the other app-only tools are not listed;
- `execute.run` returns exactly what it returns today.

So a plain stdio Claude Code session is unaffected, which is the compatibility
bar: the app is additive, and a host that knows nothing of SEP-1865 sees the
server it sees now.

## 6. Persistence: what is a "draft"?

The hard question. sqlib has no mutable content — a `QueryVersion` is immutable
once written — but a bench is mutable by nature, and the user will type for ten
minutes before anything deserves a version number. Three options were weighed:

1. **Keep the buffer in the View.** Simplest, and wrong: the host may tear the
   View down (`ui/resource-teardown`) on scroll-away or a new turn, and the work
   is gone. Also invisible to the model, so "make that query use OPTIONAL" cannot
   see what the user just typed.
2. **A version per edit.** Cheap to build (versions are the natural unit) and
   ruinous to read: forty versions per query, `currentVersion` thrashing, and a
   version history that records keystrokes instead of intent.
3. **A server-side draft store, keyed by MCP session.** *Recommended.*

The draft store is a small addition in `packages/api`: a `Draft` record holding
`{ sessionId, benchId, libraryId, queryId?, baseVersion?, queryString,
argumentDraft, backendId, updatedAt }`, in the library store alongside
everything else but excluded from export. `app.draft.put` is called on a debounce
from the View; `app.draft.get` restores the bench after a teardown; a draft is
deleted when its content is saved as a version, and swept after 7 days.

This gives the three properties the other two options cannot:

- **Survives teardown and reconnection** — reopening the bench in the next turn
  shows what was typed.
- **Readable by the model.** `app.bench.open` with no arguments returns the
  session's live drafts, so "why is that returning nothing?" has something to
  look at.
- **Never pollutes history.** Version 4 appears when the user says it should,
  with a comment that means something, and the version log stays a record of
  intent — the property [versioning-and-immutability.md](../explanation/versioning-and-immutability.md)
  exists to protect.

The `sessionId` is the streamable-HTTP MCP session id the server already mints.
Over stdio there is one client per process and the process id serves. A draft is
scoped to a library and is not a security boundary — it is subject to
`SQLIB_AUTH_MODE` like everything else.

### What a saved cell is

When the user hits **Save version**, the notebook gains:

- a `Query` (created on first save; name pre-filled from the chat, editable);
- a `QueryVersion` with the text and a comment;
- optionally an `ArgumentSet` from the grid, when the user ticks "save these
  arguments" — which is what makes the cell re-runnable later, and is the
  argument set a test would pin;
- optionally a `TupleSet` from the result, when the user ticks "keep this
  result" — the notebook's output cell, and a fixture for a future test.

Nothing else. No notebook entity, no cell entity, no new export format: the
library already exports, and a library exported after a session *is* the
notebook.

## 7. Toy data

"Run it against toy data" is the flow that makes the bench worth building, and
sqlib already has the pieces:

1. `app.toy.ensure` creates a `DataGraph` named `bench-toy` in the library from
   Turtle the model wrote (or the user pasted) and takes a version.
2. It creates — or reuses — an `oxigraph` backend hydrated from that data graph.
   Such a backend is already read-only in the API (`backends.ts` refuses writes
   and data clears on a hydrated backend, because a reload would discard them),
   which is exactly the property wanted: the toy backend cannot drift from the
   graph that defines it. Editing the toy data means a new data-graph version and
   a reload, which is reproducible.
3. The bench's backend selector lists it alongside the library's
   `allowedBackends`, marked `toy`.

The model is good at inventing ten triples that exercise a query, and terrible at
knowing whether the real endpoint has them. Running against a graph it just wrote
tells the user whether the *query* is wrong; running against the real backend
tells them whether the *data* is. Keeping both a click apart in the same bench is
most of the value here.

## 8. Message flows

Opening the bench:

```
model → host      tools/call app.bench.open { libraryId, queryString }
host  → server    (registry → API: validate, detect inputs, load library)
server → host     result + _meta.ui.resourceUri = ui://sqlib/bench
host  → server    resources/read ui://sqlib/bench
host               renders sandboxed iframe with declared CSP
View  → host      ui/initialize
host  → View      hostContext { theme, styles, displayMode, containerDimensions }
host  → View      ui/notifications/tool-input   (the open args)
host  → View      ui/notifications/tool-result  (bench state)
View               paints; ui/notifications/size-changed as the editor grows
```

Editing and running, entirely inside the View:

```
View  → host      tools/call detection.detectInputs { queryString }   (debounced)
View  → host      tools/call app.draft.put { benchId, queryString, … } (debounced)
View  → host      tools/call sparql.proxyQuery { queryString, backendId, arguments }
View  → host      ui/update-model-context { summary: "12 rows, ?city ?pop, 14 ms" }
```

Saving:

```
View  → host      tools/call queries.createVersion { id, queryVersion: { queryString, comment } }
View  → host      tools/call app.draft.put { benchId, clear: true }
View  → host      ui/update-model-context { saved: "urn:…#v4" }
```

The model is told what happened, in one line, at the two moments that matter —
a run and a save. It is not told every keystroke, and it never receives a full
result set it did not ask for. That budget discipline is the difference between
a bench that helps a long session and one that exhausts its context.

## 9. Security

The [security model](../explanation/security-model.md) applies unchanged, and
this adds surface, so:

- **`/mcp` still has no authentication of its own.** A View makes that door more
  attractive, not less, because a rendered UI invites exposure. The deployment
  advice does not soften: localhost, or something authenticating in front, or
  `SQLIB_AUTH_MODE=required`.
- **Declared CSP is the minimum.** Every View ships
  `connectDomains: []`, `resourceDomains: []`, `frameDomains: []`,
  `permissions: []`. A View that cannot make a network request cannot exfiltrate
  a library, and every read and write it performs is an auditable JSON-RPC call
  the host sees. Should a View ever need a font or a map tile, it earns a
  specific domain in review — the `ui://` declaration exists so that review has
  somewhere to happen.
- **Writes stay few and visible.** Only the bench writes, only through
  `queries.create`, `queries.createVersion`, `argumentSets.create`,
  `tupleSets.create` and `app.draft.put`. Delete and backend mutation are not in
  a View; they go back through the model, where the host's confirmation lives.
- **Toy data is not a sandbox for the real one.** A hydrated toy backend is
  read-only, but the backend selector can also point at a production endpoint.
  The selector shows the backend's kind and marks anything that is not the toy
  graph, and `execute.run` is `readOnly` — an update travels through
  `patches.previewUpdate`/`patches.apply`, which are not exposed to the Views.
- **View output is untrusted.** `ui/update-model-context` content is bounded
  (length-capped, plain text, no tool names echoed) so a pasted result cannot
  read as an instruction to the model.

## 10. Build, test, ship

- `packages/mcp-app` builds with esbuild to `dist/views/*.html`; a size budget
  (say 150 KB per View, uncompressed) fails the build, since the HTML rides in
  every `resources/read`.
- Views are unit-tested against a fake bridge (`AppBridge` from
  `@modelcontextprotocol/ext-apps/app-bridge` driven by vitest + happy-dom):
  send `ui/notifications/tool-result`, assert the rendered table; type, assert
  the debounced `detection.detectInputs` call.
- `mcp-server` gains tests that the resources are listed with the right
  `mimeType` and `_meta.ui`, that `_meta.ui` is omitted without the client
  capability, and that app-only tools are hidden from `tools/list` in that case.
  The existing `toolSchemaParity` test extends to the new tools.
- Docs: a `guides/mcp-app.md` (how to point an Apps-capable host at it and what
  the bench does) and a paragraph in `guides/mcp-clients.md`.

Phasing, each step useful on its own:

1. ~~**Resources plumbing.** `resources` capability, capability gating,
   `ui://sqlib/result` on `execute.run`.~~ Built.
2. ~~**Data-graph tools** in the catalogue.~~ Built — six of them; tuple sets
   are still missing, and `app.toy.ensure` turned out to be unnecessary: the
   bench makes the graph, its version and the hydrated backend with three
   ordinary tool calls, which needs no new orchestration on the server.
3. ~~**The bench**, read-and-run: text, parameters, arguments, Run.~~ Built,
   including saving a version — the write was a handful of lines once the read
   path worked, and a bench that cannot save is not a notebook.
4. **Drafts** — the server-side draft store, so an edit survives
   `ui/resource-teardown` and the model can see what the user typed. Not built:
   the MVP's edits live in the frame until saved.
5. **`ui://sqlib/library`**, and query-group awareness in the bench. Not built.

## 10a. The SDK: v2, without `registerTool`

`packages/mcp-server` runs on the split `@modelcontextprotocol/{server,node}`
v2 packages. The move was worth making for this feature: v2's
`setRequestHandler` takes a **method string** (`'tools/list'`) rather than a
zod request schema, so registering the four handlers this door needs — tools,
resources and their reads — no longer drags a zod dependency in for schemas
the catalogue does not express in zod. The low-level `Server`,
`getClientCapabilities`, stdio and a node-flavoured streamable HTTP transport
(`NodeStreamableHTTPServerTransport`) all survive the split, so the Fastify
wiring in `http-server.ts` is unchanged in shape.

What we deliberately do **not** adopt is the `registerAppTool` /
`registerAppResource` pattern the SDK's own `add-app-to-server` skill
prescribes. Those helpers take a **zod** `inputSchema`, and this catalogue was
moved off zod on purpose: a tool's schema is the same JSON Schema document the
API registers for that route, imported from `@sparql-query-lib/contracts`, so
MCP and HTTP cannot disagree about what a valid payload is. Taking the helpers
would re-introduce a second schema source for 96 tools in order to save
registering four request handlers by hand. The trade is the wrong way round,
and `fromJsonSchema` exists if that judgement ever changes.

One consequence to know: the caller's bearer token moved from
`extra.requestInfo.headers` (node headers, values possibly arrays) to
`ctx.http.req` (a web-standard `Request`). That is the hinge the security model
turns on — a misread returns `undefined` and silently downgrades every tool call
to anonymous — so it is lifted into `authorizationFromContext` and tested
directly.

## 11. Open questions

- **Chained cells.** Two queries where the second consumes the first's bindings
  is a `QueryGroup`, and the bench does not do canvases. Is a minimal "chain
  these two" affordance in the library View worth it, or does the group canvas
  stay the SPA's job with the chat handing over a link?
- **Multiple benches at once.** The spec's MVP is one UI resource per tool
  result. Two queries under discussion means two tool results, each with its own
  bench, each with its own draft — probably fine, possibly confusing in a
  scrollback.
- **Host reach.** Claude, ChatGPT, VS Code and Goose render MCP Apps; ChatGPT
  additionally reads `_meta["openai/outputTemplate"]` from its own Apps SDK. Do
  we emit the compatibility key as well, or stay strictly on SEP-1865 and accept
  a narrower reach at first? Emitting both is a few lines and no protocol risk.
- **Draft store placement.** Drafts in the library store are simple but put
  mutable session state next to immutable content. A separate keyed store is
  cleaner and is one more thing to configure and back up.
- **Result size.** Where does a 50 000-row result get truncated, and does the
  View page it through repeated `execute.run` calls with a named `LIMIT`/`OFFSET`
  (elegant — it uses the library's own parameter mechanism) or ask for a
  server-side cursor (a new API concept)?
