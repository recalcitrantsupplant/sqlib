# @sparql-query-lib/mcp-server

An MCP server over the sqlib Fastify app. It runs the API in the same process,
with no HTTP hop, and publishes MCP tools that map to the HTTP routes.

## Usage

```ts
import { startStdioMcpServer } from '@sparql-query-lib/mcp-server';

// Launch an MCP server over stdio (for local LLM tools/agents)
startStdioMcpServer();
```

## Transport modes

- Local dev uses stdio by default: `pnpm --filter @sparql-query-lib/mcp-server dev`.
- Production uses streamable HTTP by default, when `NODE_ENV=production` or
  `MCP_TRANSPORT=streamable-http`. It listens on `MCP_HTTP_HOST` and
  `MCP_HTTP_PORT`.
- To set a mode, use `MCP_TRANSPORT=stdio` or `MCP_TRANSPORT=streamable-http`.
- `MCP_TRANSPORT=dual-http` serves the API and MCP (`/mcp`) on one port, from one
  process and one app.
- `SQLIB_CORS_ORIGINS` sets the browser origins that can reach `/mcp`. It takes
  a comma-separated list, or `*` for any origin without credentials. When it is
  not set, it allows the SPA dev server (`http://localhost:3001`) under
  `NODE_ENV=development`, and no origin otherwise.
- Only `initialize` creates an HTTP session. An unknown session gets 404, and
  the client must initialise again. A session is bound to the `Authorization`
  header of the caller that created it. Another caller gets 403.

## Local HTTPS (Traefik)

1. Make trusted localhost certificates: `just setup-local-https`.
2. Run the app in dual mode behind a Traefik HTTPS proxy: `just run-local-https`.

The endpoints are:

- API: `https://localhost:3443/...`
- MCP: `https://localhost:3443/mcp`

## Docker runtime modes

The root `Dockerfile` packages the API and the MCP server. `APP_MODE` sets the
runtime mode:

- `APP_MODE=dual-http` (the default): the API and MCP on one port (`HTTP_PORT`,
  default `3000`).
- `APP_MODE=api`: the API only.
- `APP_MODE=mcp-http`: MCP over HTTP only (`MCP_HTTP_PORT`, default `3333`).

## What the agent is told

The server publishes MCP `instructions` on `initialize`. Clients such as Claude
Code and Claude Desktop put them in the system prompt of the model, before it
sees a tool. The text is `catalogueGuide()` in `@sparql-query-lib/tools`
(`packages/tools/src/guide.ts`), about 630 tokens. It covers:

- the entity model: a `Query` is metadata, and the SPARQL is on a
  `QueryVersion`;
- how a query declares parameters: a VALUES clause whose only row is all
  `UNDEF`, and `LIMIT 000n`;
- the exact shape of the `arguments` of `execute_run`.

Pass `createMcpServer({ instructions })` to replace the text, or `''` to
publish none.

Agents often used five tools incorrectly: `queries_create`,
`queries_createVersion`, `execute_run`, `detection_detectInputs` and
`sparql_proxyQuery`. Their descriptions repeat the applicable rule, because a
model reads a description alone when it selects a tool.

The listing has a cost. With 89 tools, it was about 5.7k tokens in compact
form, and about 11k if a client pretty-prints the schemas. The catalogue is now
larger. To measure it, build `tools`, and put the output of
`createToolRegistry(...).listTools()` through a tokenizer.

## Advanced

- `createMcpServer({ fastifyInstance, enableCacheMonitoring })` returns
  `{ server, apiApp, shutdown }`. Use it to connect your own transport, or to
  use a Fastify instance that you already have.
- The tools map to the same routes as the HTTP API: backends, libraries,
  queries, execution, detection, argument sets, data blocks, rules, rule sets,
  query groups and the SPARQL proxy.
- RDF exports are tools that run on demand. There is no MCP resource cache.
- Rule-set streaming returns one consolidated result.
  To do: send notifications, where the client and transport support them.
