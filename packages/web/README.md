# @sparql-query-lib/web

The sqlib web UI. It is a Nuxt 4 application with `ssr: false`, served as a
single-page app. It calls `@sparql-query-lib/api` over HTTP. You deploy it
separately from the server image.

The package is `private: true`, and is not published.

## Running it

The SPA needs an API. Start one first: `just run-local-memory` serves on port
3005. Then run one of these:

```bash
just run-frontend                 # dev server on :3001, against :3005
# or
NUXT_PUBLIC_API_BASE_URL=http://localhost:3000 pnpm --filter @sparql-query-lib/web dev
```

The build commands:

- `pnpm build` makes a Nitro server build that renders the SPA shell for each
  request.
- `pnpm preview` serves that build on `WEB_PORT` (default 3001).
- `pnpm generate` makes a static build.

## Runtime configuration

`nuxt.config.ts` reads each setting, and exposes it through
`runtimeConfig.public`:

- `NUXT_PUBLIC_API_BASE_URL`: the API to call. The default is
  `http://localhost:3000`.
- `NUXT_PUBLIC_FEATURE_*`, or the unprefixed `FEATURE_*` if that is not set:
  the feature flags. `buildFeatureFlags` from `@sparql-query-lib/types` parses
  them. The SPA and the API each read their own environment. A flag set only on
  the server therefore leaves the section visible in the SPA. Set both.
- `NUXT_PUBLIC_AUTH_ISSUER`, `_CLIENT_ID`, `_AUDIENCE`, `_SCOPE`: the OIDC
  settings. They are empty by default. At boot, the app asks the API for its
  auth mode. It uses these settings only when the mode enforces
  authentication.

The app reads these values when it is built or when the dev server starts. A
change to a flag therefore needs a restart.

## Before you edit

- `src/` is the Nuxt source directory (`app.vue`, `pages/`, `components/`,
  `composables/`, `lib/`). `components/ui/` is the directory of shadcn-nuxt.
- `@sparql-query-lib/contracts`, `/types` and `/runtime` are aliased to their
  TypeScript sources. The app does not resolve them through their exports
  maps, so `dev` does not need a build of those packages.
- Add a new bare import that only a page uses to `vite.optimizeDeps.include`
  in `nuxt.config.ts`. The comment there gives the reason.
- `pnpm build:srl-parser` generates `src/lib/srlLanguage/*.generated.ts` from
  `srl.grammar`. The generated files are committed.
  `test/lib/srlLanguage.test.ts` fails if they do not match the grammar.
- `pwa` in `nuxt.config.ts` configures a service worker. It is off in dev. The
  comments there describe its caching rules and the kill switch.

## Checks

```bash
pnpm --filter @sparql-query-lib/web test        # vitest
pnpm --filter @sparql-query-lib/web typecheck   # vue-tsc
pnpm --filter @sparql-query-lib/web lint        # stylelint
pnpm --filter @sparql-query-lib/web test:e2e    # playwright, against the preview build
```
