@sparql-query-lib/mcp-server
================================

Thin MCP server wrapper over the existing SPARQL Query Library Fastify app. It configures the API in-process (no HTTP hop) and exposes MCP tools that mirror the HTTP routes.

Usage
-----

```ts
import { startStdioMcpServer } from '@sparql-query-lib/mcp-server';

// Launch an MCP server over stdio (for local LLM tools/agents)
startStdioMcpServer();
```

Transport modes
---------------
- Local dev defaults to stdio: `pnpm --filter @sparql-query-lib/mcp-server dev`.
- Production defaults to streamable HTTP when `NODE_ENV=production` (or `MCP_TRANSPORT=streamable-http`), listening on `MCP_HTTP_HOST`/`MCP_HTTP_PORT`.
- Force a mode manually with `MCP_TRANSPORT=stdio` or `MCP_TRANSPORT=streamable-http`.
- Dual HTTP mode (single process, shared app): `MCP_TRANSPORT=dual-http` to expose API + MCP (`/mcp`) on one port.

Local HTTPS (Traefik)
---------------------
- Generate trusted localhost certificates: `just setup-local-https`
- Run dual-mode app + Traefik HTTPS proxy: `just run-local-https`
- Endpoints:
  - API: `https://localhost:3443/...`
  - MCP: `https://localhost:3443/mcp`

Docker runtime modes
--------------------
- The root `Dockerfile` now packages API + MCP server.
- Runtime mode is selected with `APP_MODE`:
  - `APP_MODE=dual-http` (default): API and MCP on one port (`HTTP_PORT`, default `3000`)
  - `APP_MODE=api`: API only
  - `APP_MODE=mcp-http`: MCP HTTP only (`MCP_HTTP_PORT`, default `3333`)

What the agent is told
----------------------
- The server publishes MCP `instructions` on `initialize`, which clients such as Claude Code and Claude Desktop put in the model's system prompt before it sees a tool. The text is `catalogueGuide()` in `@sparql-query-lib/tools` (`packages/tools/src/guide.ts`): the entity model (a `Query` is metadata, the SPARQL lives on a `QueryVersion`), how a query declares parameters (a VALUES clause whose only row is all `UNDEF`, `LIMIT 000n`), and the exact shape of `execute_run`'s `arguments`. About 630 tokens.
- Pass `createMcpServer({ instructions })` to replace it, or `''` to publish none.
- The tools an agent most often misused (`queries_create`, `queries_createVersion`, `execute_run`, `detection_detectInputs`, `sparql_proxyQuery`) carry descriptions that restate the relevant rule, since a description is read on its own when a tool is picked.
- Cost of the listing itself: 89 tools, about 5.7k tokens compact (roughly 11k if a client pretty-prints the schemas). To measure it, build `tools` and run `createToolRegistry(...).listTools()` through a tokenizer.

Advanced
--------
- `createMcpServer({ fastifyInstance, enableCacheMonitoring })` returns `{ server, apiApp, shutdown }` if you want to wire your own transport (e.g., Streamable HTTP) or reuse an existing Fastify instance.
- Tools map to the same routes as the HTTP API (backends, libraries, queries, execution, detection, argument sets, data blocks, rules, rule sets, query groups, SPARQL proxy).
- RDF exports are exposed as on-demand tools (no MCP resource caching).
- Rule-set streaming is returned as a single consolidated result for now; add notifications later if the client/transport supports it.
