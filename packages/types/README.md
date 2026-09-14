# @sparql-query-lib/types

Small, dependency-free TypeScript definitions and constants shared across the
monorepo. It is the lowest layer: it depends on no other workspace package, and
the API, the web SPA and the MCP server all read from it.

`private: true`; not published.

## What is in it

- `featureFlags.ts` — the feature flag keys, their environment variable names,
  their defaults, and the parser that turns env values into a `FeatureFlags`
  record. Both the server and `packages/web/nuxt.config.ts` build their flags
  from this one definition, so the two cannot disagree about which flags exist.
- `queryTypes.ts`, `ioTypes.ts`, `parameterKeys.ts` — query kinds, input and
  output shapes, and the key names used for declared parameters.
- `mediaTypes.ts` — the SPARQL and RDF media types the server negotiates.
- `subjectKinds.ts` — the entity kinds and their IRI conventions.
- `authEnvKey.ts` — the auth-related environment variable names.
- `index.ts` — SPARQL results JSON types, the well-known backend IRIs, and
  re-exports of everything above.

Anything that needs a schema rather than a type belongs in
`@sparql-query-lib/contracts` instead.

## Build

```bash
pnpm --filter @sparql-query-lib/types build
```

tsup emits ESM and CJS; `tsc` emits the declarations. `packages/web` aliases the
package to `src/index.ts` directly, so the SPA's dev server does not need the
build to have run.
