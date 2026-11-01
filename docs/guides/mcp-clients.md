# Connecting an MCP client

`packages/mcp-server` exposes the library to an MCP client as 96 tools that
mirror the HTTP routes: libraries, backends, queries and versions, argument
sets, detection, execution, rules and rule sets, query groups, data blocks, data
graphs and the SPARQL proxy.

A client that supports [MCP Apps](https://github.com/modelcontextprotocol/ext-apps)
also gets two rendered Views — a query bench and a result table — and one more
tool to open the bench with. See [mcp-app.md](mcp-app.md); a client that does
not advertise the extension sees exactly the catalogue described here.

**`/mcp` carries no authentication of its own.** The MCP layer enforces nothing;
it forwards whatever the caller sent to the API, which applies `SQLIB_AUTH_MODE`
(and, under an enforcing mode, answers a tokenless `/mcp` request with the
401 challenge that tells the client where to sign in).
That mode defaults to `disabled`, which gives every request full access. A
`/mcp` reachable from a network you do not control is therefore an
unauthenticated door to every library on the server, and to every backend those
libraries can reach. Bind it to localhost, put it behind something that
authenticates, or run the API with `SQLIB_AUTH_MODE=required` before exposing
it.

## The three transports

`MCP_TRANSPORT` selects one. Without it, the mode is `stdio` outside production
and `streamable-http` when `NODE_ENV=production`.

| `MCP_TRANSPORT` | Serves | Listens on |
| --- | --- | --- |
| `stdio` | MCP over stdin/stdout, one client per process | nothing |
| `streamable-http` (or `http`) | MCP at `POST`/`GET`/`DELETE /mcp` | `MCP_HTTP_HOST` (default `0.0.0.0`), `MCP_HTTP_PORT` (default 3333) |
| `dual-http` (or `http+api`) | the REST API and MCP at `/mcp`, one process, one port | `HTTP_HOST` then `MCP_HTTP_HOST` (default `0.0.0.0`), `HTTP_PORT` (default 3000) |

In the Docker image these are selected with `APP_MODE` (`dual-http`, `api` or
`mcp-http`) rather than `MCP_TRANSPORT`; see
[running and configuring](running-and-configuring.md).

Streamable HTTP is session-based: the server mints a session id on
`initialize`, returns it in the `mcp-session-id` header, and a client sends it
back on subsequent requests. `DELETE /mcp` ends a session. Only an
`initialize` request without a session id creates one; any other request
without an id gets 400. A request naming an id the server does not know (it
expired, the server restarted, or it was deleted) gets 404, which tells the
client to initialise again.

A session belongs to the caller that created it: the server keeps a SHA-256
digest of the `Authorization` header (or, when the API's auth mode verified the
token, of its issuer and subject) and answers 403 to a `POST`, `GET` or `DELETE`
on that session from anyone else, including a request with no bearer at all.

Browser clients need their origin in `SQLIB_CORS_ORIGINS` (comma-separated; see
[configuration](../reference/configuration.md#server-and-transport)). A listed
origin can read the `mcp-session-id` header, which is in the exposed-headers
list. With the variable unset, only the SPA dev server's origin is allowed, and
only under `NODE_ENV=development`.

## Running one locally

From a checkout:

```bash
# stdio, against the API configured from the current environment
pnpm --filter @sparql-query-lib/mcp-server dev

# streamable HTTP on :3333/mcp
pnpm --filter @sparql-query-lib/mcp-server dev:http

# API and MCP together — what `just run-local-memory` runs, on :3005
pnpm --filter @sparql-query-lib/mcp-server dev:dual-http
```

The MCP process boots the API itself, so every variable in
[configuration](../reference/configuration.md) applies to it: the transport
choice does not change where the library is stored or which features are on.

Some clients require an HTTPS origin. `just setup-local-https` then
`just run-local-https` puts the dual-mode process behind Traefik with a trusted
`localhost` certificate, serving the API at `https://localhost:3443/` and MCP at
`https://localhost:3443/mcp`.

## Client configuration

For a client that launches the server itself, over stdio:

```json
{
  "mcpServers": {
    "sqlib": {
      "command": "node",
      "args": ["/path/to/sqlib/packages/mcp-server/dist/cli.js"],
      "env": {
        "MCP_TRANSPORT": "stdio",
        "INTERNAL_BACKEND_TYPE": "oxigraph-persistent",
        "LIBRARY_STORAGE_DIR": "/path/to/library-store"
      }
    }
  }
}
```

`dist/cli.js` requires `pnpm build` first; during development,
`pnpm --filter @sparql-query-lib/mcp-server dev` runs the same entry point from
source. In stdio mode the server redirects its own `console.log` to stderr, so
stdout carries nothing but JSON-RPC.

For a client that connects to a running server, point it at
`http://localhost:3005/mcp` (or the HTTPS URL above). With auth disabled, no
credentials are configured because none are checked — see the warning at the
top of this page.

### Connecting to an authenticated server

With `SQLIB_AUTH_MODE=required`, a client needs no credentials in its own
configuration either. Give it the URL and nothing else. Claude, for example:

1. Open **Settings → Connectors → Add custom connector**.
2. Enter `https://sqlib.example.org/mcp` as the URL. Leave the OAuth client
   fields empty.
3. Select **Connect**. A browser window opens at the broker's sign-in page.
4. Sign in. The connector is then connected as you.

Behind that, the client follows the
[MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization):

1. Its first request to `/mcp` has no token. sqlib answers 401 with
   `WWW-Authenticate: Bearer resource_metadata="https://sqlib.example.org/.well-known/oauth-protected-resource/mcp"`.
2. The client reads that document. Its `authorization_servers` names the
   broker, and its `resource` names the value to ask a token for.
3. The client identifies itself to the broker with a Client ID Metadata
   Document, or registers itself dynamically, and runs the authorization code
   flow with PKCE in your browser. It sends `resource` on each request, so the
   token names sqlib in `aud`.
4. Every later call to `/mcp` carries that token, and the API applies your
   grants.

Three settings make this work. Set `SQLIB_AUTH_RESOURCE` to the canonical URL
of `/mcp`, and configure the broker to put the same value in `aud`. The broker
must also accept self-registering clients (CIMD or dynamic client
registration). A broker without either needs each client registered by hand,
and the client then needs that client id. See
[deploying](deploying.md#choosing-a-broker) for which brokers do which.

No packaged desktop extension is distributed. An MCPB bundle built naively from
the workspace pulls in test fixtures and duplicated dependencies, and the
staging work to produce a usable one has not been done.

## How it reaches the API

`createMcpServer` configures the Fastify application **in the same process** and
calls `app.inject()` for each tool call. There is no HTTP hop, no second port
and no loopback request: a tool is a route handler invoked directly with a
synthetic request. Two consequences worth knowing:

- The MCP process needs everything the API needs — its store, its feature
  flags, its backends. Running `mcp-http` alone does not mean a lighter
  process.
- A caller's `Authorization` header, when it sends one, rides every injected
  request, so the API applies that caller's grants rather than an ambient
  service identity. That is the mechanism an authenticated deployment uses; it
  does nothing when `SQLIB_AUTH_MODE=disabled`.

`createMcpServer({ fastifyInstance, enableCacheMonitoring })` returns
`{ server, apiApp, shutdown }` for wiring a transport of your own or reusing an
existing Fastify instance.

## What the server tells an agent

MCP's `initialize` result carries a server-level `instructions` string, which
clients place in the model's system prompt before it sees any tool. sqlib
publishes `catalogueGuide()` from `@sparql-query-lib/tools`
(`packages/tools/src/guide.ts`) — about 630 tokens covering:

- the entity model: a `Query` is metadata and rejects a `queryString`; the
  SPARQL text lives on a `QueryVersion` created with body
  `{"queryVersion": {"queryString": …}}`;
- how a query declares parameters: a `VALUES` clause whose only row is all
  `UNDEF`, and `LIMIT 000n` / `OFFSET 000n` for named limits and offsets;
- the exact shape of `execute_run`'s `arguments`: SPARQL Results JSON
  documents, at most one per parameter slot, matched by `head.vars`, with an
  omitted slot running unconstrained.

Pass `createMcpServer({ instructions })` to replace the text, or `''` to publish
none. Tool names are rewritten to the door's public spelling
(`queries_createVersion`, because MCP clients enforce `^[a-zA-Z0-9_-]+$`), so
the model reads names it can actually call.

The tools agents most often misused — `queries_create`,
`queries_createVersion`, `execute_run`, `detection_detectInputs`,
`sparql_proxyQuery` — repeat the relevant rule in their own descriptions, since
a description is read on its own when a tool is picked.

The listing costs about 5.7k tokens compact, roughly 11k if a client
pretty-prints the schemas, paid once per session in a client that caches it.

The same model, written for a REST client rather than an agent, is in
[the REST walkthrough](rest-api-walkthrough.md).

## An application's own tools

A library can publish its queries and query groups as tools of their own, by
name, with plain arguments (see [publishing-tools.md](publishing-tools.md)).
Connect an application's agents to `/mcp/{slug}`: they see that library's
tools and nothing else. `/mcp` lists every library's published tools as well,
as `{slug}__{name}`, beside the catalogue. `MCP_CATALOGUE` can take either
surface away.
