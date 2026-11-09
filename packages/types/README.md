# @sparql-query-lib/types

Small TypeScript definitions and constants that the monorepo shares, with no
dependencies. This is the lowest layer. It depends on no other workspace
package. The API, the web SPA and the MCP server all use it.

The package is `private: true`, and is not published.

## Contents

- `featureFlags.ts`: the feature flag keys, their environment variable names,
  their defaults, and the parser that makes a `FeatureFlags` record from
  environment values. The server and `packages/web/nuxt.config.ts` both make
  their flags from this one definition. They therefore always have the same
  set of flags.
- `queryTypes.ts`, `ioTypes.ts`, `parameterKeys.ts`: query kinds, input and
  output shapes, and the key names for declared parameters.
- `mediaTypes.ts`: the SPARQL and RDF media types that the server negotiates.
- `subjectKinds.ts`: the entity kinds and their IRI conventions.
- `authEnvKey.ts`: the names of the environment variables for authentication.
- `index.ts`: SPARQL Results JSON types, the well-known backend IRIs, and
  re-exports of all of the above.

A definition that needs a schema goes in `@sparql-query-lib/contracts`.

## Build

```bash
pnpm --filter @sparql-query-lib/types build
```

tsup writes ESM and CJS, and `tsc` writes the declarations. `packages/web`
aliases the package to `src/index.ts`. The dev server of the SPA therefore
does not need a build first.
