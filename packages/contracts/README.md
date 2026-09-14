# @sparql-query-lib/contracts

The shared schema layer. Everything that both ends of the wire have to agree on
lives here: the JSON Schemas for each entity and REST route, the zod contracts
the clients validate against, and the IRI helpers both use. The API, the MCP
server and the web SPA all depend on it, which is why it sits in its own package
rather than inside `packages/api`.

`private: true`; not published.

## Generated files — do not hand-edit

The source of truth is the entity schemas in
`packages/api/src/persistence/schemas/`. These files are generated from them:

- `src/schema/entities.generated.ts`
- `src/schema/routes.generated.ts`
- `src/schema/index.generated.ts`
- every file in `src/generated/` (`query.ts`, `rule.ts`, `ruleset.ts`,
  `execution.ts`, `detection.ts`, `benchmark.ts`, `version-shapes.ts`, and the
  rest)

Regenerate them after changing an entity schema:

```bash
pnpm --filter @sparql-query-lib/api generate-schemas
```

`pnpm --filter @sparql-query-lib/api build` runs the same script first, so a
build of the API also refreshes these. Edits made by hand are overwritten on the
next run.

The hand-written files are `src/index.ts`, `src/iri.ts`, `src/schema/index.ts`,
`src/schema/routes.ts`, `src/schema/contract-routes.ts` and `fixtures/`.

## Build

```bash
pnpm --filter @sparql-query-lib/contracts build
```

tsup emits ESM and CJS bundles for the four entry points (`.`, `./schema`,
`./schema/routes`, `./iri`); `tsc` emits the declarations.
