# @sparql-query-lib/tools

The tool catalogue. It has 107 tools for backends, libraries, queries, query
groups, execution, raw SPARQL, patches, input and output detection, argument
sets, data blocks, rules and rule sets. 65 of them are marked read-only. Each
tool has a name, a description, a JSON Schema for its arguments, and the REST
request that it maps to.

The package is `private: true`, and is not published.

## How it is used

`packages/mcp-server` publishes this catalogue as MCP tools. The in-app
assistant of the API uses the same registry directly. The package has no MCP
code. It defines the tools, and a registry that validates arguments, calls the
API and returns the result. Each consumer supplies two parts that the registry
does not own:

- `callApi`: how to reach the routes. Both consumers use `app.inject`, in the
  same process.
- `compile`: the ajv instance that validates arguments. This is the instance of
  the API, so `coerceTypes` and `useDefaults` work as they do in production.

Because the consumers supply both parts, this package does not depend on
`packages/api`. Its only workspace dependency is `@sparql-query-lib/contracts`.
The tool definitions use its generated schemas.

## Files

- `src/tools.ts`: the catalogue, with one `defineTool` call for each tool.
- `src/tool-schemas.ts`: the argument schemas.
- `src/registry.ts`: validation, dispatch, name rewriting and error formatting.
- `src/guide.ts`: the server instructions. An MCP client puts them in the
  prompt of the model, before the model sees a tool.

## Build and test

```bash
pnpm --filter @sparql-query-lib/tools build
pnpm --filter @sparql-query-lib/tools test
```

A new or renamed tool changes what each MCP client sees. Run the tests of the
MCP server also.
