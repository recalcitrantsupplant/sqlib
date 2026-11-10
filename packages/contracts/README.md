# @sparql-query-lib/contracts

The shared schema layer. It holds each definition that the two ends of the wire
must agree on:

- the JSON Schemas for each entity and REST route;
- the zod contracts that the clients validate against;
- the IRI helpers that both ends use.

The API, the MCP server and the web SPA all depend on it. For this reason it is
a separate package, outside `packages/api`.

The package is `private: true`, and is not published.

## Generated files: do not edit

The source of truth is the entity schemas in
`packages/api/src/persistence/schemas/`. These files are generated from them:

- `src/schema/entities.generated.ts`
- `src/schema/routes.generated.ts`
- `src/schema/index.generated.ts`
- each file in `src/generated/` (`query.ts`, `rule.ts`, `ruleset.ts`,
  `execution.ts`, `detection.ts`, `benchmark.ts`, `version-shapes.ts`, and the
  others)

After you change an entity schema, generate them again:

```bash
pnpm --filter @sparql-query-lib/api generate-schemas
```

`pnpm --filter @sparql-query-lib/api build` runs the same script first. A build
of the API therefore also updates these files. The next run overwrites a manual
edit.

The manual files are `src/index.ts`, `src/iri.ts`, `src/schema/index.ts`,
`src/schema/routes.ts`, `src/schema/contract-routes.ts` and `fixtures/`.

## Build

```bash
pnpm --filter @sparql-query-lib/contracts build
```

tsup writes ESM and CJS bundles for the four entry points (`.`, `./schema`,
`./schema/routes`, `./iri`). `tsc` writes the declarations.
