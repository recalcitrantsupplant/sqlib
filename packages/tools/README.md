# @sparql-query-lib/tools

The tool catalogue: 89 tools covering backends, libraries, queries, query
groups, execution, raw SPARQL, patches, input/output detection, argument sets,
data blocks, rules and rule sets. 48 of them are marked read-only. Each tool is
a name, a description, a JSON Schema for its arguments, and the REST request it
maps onto.

`private: true`; not published.

## How it is used

`packages/mcp-server` wraps this catalogue as MCP tools, and the API's in-app
assistant drives the same registry directly. Nothing here is MCP-specific: the
package defines the tools and the registry that validates arguments, calls the
API and hands back the result, and each consumer supplies the two pieces the
registry does not own.

- `callApi` — how to reach the routes. In practice `app.inject`, in the same
  process, for both consumers.
- `compile` — the ajv instance to validate arguments with. The API's own, so
  that `coerceTypes` and `useDefaults` behave exactly as they do in production.

Injecting both is what keeps this package free of a dependency on
`packages/api`. Its only workspace dependency is
`@sparql-query-lib/contracts`, whose generated schemas the tool definitions
reuse.

## Files

- `src/tools.ts` — the catalogue, one `defineTool` call per tool.
- `src/tool-schemas.ts` — argument schemas.
- `src/registry.ts` — validation, dispatch, name rewriting, error formatting.
- `src/guide.ts` — the server-level instructions string an MCP client puts in
  the model's prompt before it sees any tool.

## Build and test

```bash
pnpm --filter @sparql-query-lib/tools build
pnpm --filter @sparql-query-lib/tools test
```

Adding or renaming a tool changes what every MCP client sees, so run the MCP
server's tests as well.
