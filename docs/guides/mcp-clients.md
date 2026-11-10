# Connecting an MCP client

`packages/mcp-server` gives an MCP client 96 tools. The tools match the HTTP
routes for:

- libraries and backends,
- queries, versions and argument sets,
- detection and execution,
- rules, rule sets, data blocks and data graphs,
- query groups,
- the SPARQL proxy.

A client that supports [MCP Apps](https://github.com/modelcontextprotocol/ext-apps)
also gets two rendered Views, a query bench and a result table, and one more
tool that opens the bench. See [mcp-app.md](mcp-app.md). A client that does not
advertise the extension sees only the catalogue on this page.

**`/mcp` has no authentication of its own.** The MCP layer enforces nothing. It
sends the request of the caller to the API, and the API applies
`SQLIB_AUTH_MODE`. In an enforcing mode, the API answers a `/mcp` request that
has no token with a 401 challenge. The challenge tells the client where to sign
in.

The default mode is `disabled`, which gives each request full access. If a
network that you do not control can reach `/mcp`, any person on it can use each
library on the server, and each backend that those libraries can reach. Before
you expose `/mcp`, do one of these:

- bind it to localhost;
- put it behind a service that authenticates;
- run the API with `SQLIB_AUTH_MODE=required`.

## The three transports

`MCP_TRANSPORT` selects the transport. If it is not set, the transport is
`stdio` outside production, and `streamable-http` when `NODE_ENV=production`.

| `MCP_TRANSPORT` | Serves | Listens on |
| --- | --- | --- |
| `stdio` | MCP over stdin/stdout, one client for each process | nothing |
| `streamable-http` (or `http`) | MCP at `POST`/`GET`/`DELETE /mcp` | `MCP_HTTP_HOST` (default `0.0.0.0`), `MCP_HTTP_PORT` (default 3333) |
| `dual-http` (or `http+api`) | the REST API and MCP at `/mcp`, one process, one port | `HTTP_HOST` then `MCP_HTTP_HOST` (default `0.0.0.0`), `HTTP_PORT` (default 3000) |

The Docker image selects the transport with `APP_MODE` (`dual-http`, `api` or
`mcp-http`). See [running and configuring](running-and-configuring.md).

Streamable HTTP uses sessions:

1. On `initialize`, the server makes a session id and returns it in the
   `mcp-session-id` header.
2. The client sends the id on each later request.
3. `DELETE /mcp` ends the session.

Only an `initialize` request without a session id makes a session. Any other
request without an id gets 400. A request with an id that the server does not
know gets 404, and the client must initialise again. An id is unknown when it
expired, when it was deleted, or after a server restart.

A session belongs to the caller that made it. The server keeps a SHA-256 digest
of the `Authorization` header. When the auth mode of the API verified the
token, the digest is of its issuer and subject. A `POST`, `GET` or `DELETE` on
the session from a different caller gets 403. This includes a request with no
bearer.

A browser client needs its origin in `SQLIB_CORS_ORIGINS`, a comma-separated
list. See [configuration](../reference/configuration.md#server-and-transport).
A listed origin can read the `mcp-session-id` header, because the header is in
the exposed-headers list. If the variable is not set, sqlib allows only the
origin of the SPA dev server, and only when `NODE_ENV=development`.

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

The MCP process starts the API itself, so each variable in
[configuration](../reference/configuration.md) applies to it. The transport has
no effect on where the library is stored or which features are on.

Some clients require an HTTPS origin. Run `just setup-local-https`, then
`just run-local-https`. This puts the dual-mode process behind Traefik, with a
trusted `localhost` certificate. The API is at `https://localhost:3443/` and MCP
is at `https://localhost:3443/mcp`.

## Client configuration

For a client that starts the server itself, over stdio:

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

Run `pnpm build` before you use `dist/cli.js`. During development,
`pnpm --filter @sparql-query-lib/mcp-server dev` runs the same entry point from
source. In stdio mode, the server sends its own `console.log` output to stderr,
so stdout carries only JSON-RPC.

For a client that connects to a running server, use the URL
`http://localhost:3005/mcp`, or the HTTPS URL above. When auth is disabled, the
client needs no credentials, because the server checks none. See the warning at
the top of this page.

### Connecting to an authenticated server

With `SQLIB_AUTH_MODE=required`, the client configuration also has no
credentials. Give the client the URL only. For example, in Claude:

1. Open **Settings → Connectors → Add custom connector**.
2. Enter `https://sqlib.example.org/mcp` as the URL. Leave the OAuth client
   fields empty.
3. Select **Connect**. A browser window opens at the sign-in page of the broker.
4. Sign in. The connector then acts as you.

The client follows the
[MCP authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization):

1. Its first request to `/mcp` has no token. sqlib answers 401 with
   `WWW-Authenticate: Bearer resource_metadata="https://sqlib.example.org/.well-known/oauth-protected-resource/mcp"`.
2. The client reads that document. `authorization_servers` names the broker.
   `resource` names the value for which the client asks for a token.
3. The client identifies itself to the broker with a Client ID Metadata
   Document, or registers itself dynamically. It then runs the authorization
   code flow with PKCE in your browser. It sends `resource` on each request, so
   the `aud` of the token names sqlib.
4. Each later call to `/mcp` carries that token, and the API applies your
   grants.

This flow needs three settings:

- `SQLIB_AUTH_RESOURCE` is the canonical URL of `/mcp`.
- The broker puts the same value in `aud`.
- The broker accepts clients that register themselves, with CIMD or dynamic
  client registration.

With a broker that has neither form of registration, you must register each
client manually, and give the client that client id. See
[deploying](deploying.md#choosing-a-broker) for the forms that each broker
supports.

sqlib has no packaged desktop extension. An MCPB bundle built directly from the
workspace contains test fixtures and duplicate dependencies. The work to make a
usable bundle is not done.

## How it reaches the API

`createMcpServer` configures the Fastify application **in the same process**,
and calls `app.inject()` for each tool call. A tool call makes no HTTP request
and uses no second port. Each tool is a route handler that sqlib calls directly
with a synthetic request. This has two results:

- The MCP process needs everything that the API needs: its store, its feature
  flags and its backends. A process in `mcp-http` mode is not smaller.
- When a caller sends an `Authorization` header, sqlib adds it to each injected
  request. The API therefore applies the grants of that caller. An
  authenticated deployment uses this mechanism. When
  `SQLIB_AUTH_MODE=disabled`, it has no effect.

`createMcpServer({ fastifyInstance, enableCacheMonitoring })` returns
`{ server, apiApp, shutdown }`. Use it to connect your own transport, or to use
an existing Fastify instance.

## What the server tells an agent

The `initialize` result of MCP has a server-level `instructions` string. Clients
put it in the system prompt of the model before the model sees any tool. sqlib
publishes `catalogueGuide()` from `@sparql-query-lib/tools`
(`packages/tools/src/guide.ts`). It is about 630 tokens, and it covers:

- The entity model. A `Query` is metadata and rejects a `queryString`. The
  SPARQL text is on a `QueryVersion`, made with the body
  `{"queryVersion": {"queryString": …}}`.
- How a query declares parameters: a `VALUES` clause whose only row is all
  `UNDEF`, and `LIMIT 000n` / `OFFSET 000n` for named limits and offsets.
- The shape of `arguments` for `execute_run`. It is a list of SPARQL Results
  JSON documents, at most one for each parameter slot, matched by `head.vars`.
  An omitted slot runs with no constraint.

To replace the text, pass `createMcpServer({ instructions })`. To publish no
text, pass `''`. sqlib gives each tool name its public spelling, for example
`queries_createVersion`, because MCP clients enforce `^[a-zA-Z0-9_-]+$`. The
model therefore reads names that it can call.

Agents used five tools incorrectly most often: `queries_create`,
`queries_createVersion`, `execute_run`, `detection_detectInputs` and
`sparql_proxyQuery`. The description of each of these repeats the related rule.
A client reads a description alone when it selects a tool.

The tool list is about 5.7k tokens in compact form, or about 11k if a client
pretty-prints the schemas. A client that caches the list reads it once for each
session.

[The REST walkthrough](rest-api-walkthrough.md) describes the same model for a
REST client.

## An application's own tools

A library can publish its queries and query groups as separate tools, each with
a name and plain arguments. See [publishing-tools.md](publishing-tools.md).

- Connect the agents of an application to `/mcp/{slug}`. They see the tools of
  that library only.
- `/mcp` lists the published tools of each library as `{slug}__{name}`, next to
  the catalogue.

`MCP_CATALOGUE` can remove either set of tools.
