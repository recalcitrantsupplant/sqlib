# @sparql-query-lib/web

The sqlib web UI: a Nuxt 4 application with `ssr: false`, served as a
single-page app that talks to `@sparql-query-lib/api` over HTTP. It is a
separate deployable from the server image.

`private: true`; not published.

## Running it

The SPA needs an API to talk to. Start one first (`just run-local-memory`
serves on port 3005), then:

```bash
just run-frontend                 # dev server on :3001, against :3005
# or
NUXT_PUBLIC_API_BASE_URL=http://localhost:3000 pnpm --filter @sparql-query-lib/web dev
```

`pnpm build` produces a Nitro server build that renders the SPA shell per
request; `pnpm preview` serves it on `WEB_PORT` (default 3001). `pnpm generate`
produces a static build.

## Runtime configuration

Everything configurable is read in `nuxt.config.ts` and exposed through
`runtimeConfig.public`:

- `NUXT_PUBLIC_API_BASE_URL` — the API to call. Default
  `http://localhost:3000`.
- `NUXT_PUBLIC_FEATURE_*` (falling back to the unprefixed `FEATURE_*`) — the
  feature flags, parsed by `buildFeatureFlags` from
  `@sparql-query-lib/types`. The SPA and the API each read their own
  environment, so a flag set only on the server still leaves the section
  visible here; set both.
- `NUXT_PUBLIC_AUTH_ISSUER`, `_CLIENT_ID`, `_AUDIENCE`, `_SCOPE` — OIDC
  settings. Empty by default: the app asks the API for its auth mode at boot
  and only reaches for these when it reports an enforcing one.

These are evaluated when the app is built or the dev server starts, not per
request, so changing a flag means restarting.

## Before you edit

- `src/` is the Nuxt source directory (`app.vue`, `pages/`, `components/`,
  `composables/`, `lib/`). `components/ui/` is shadcn-nuxt's directory.
- `@sparql-query-lib/contracts`, `/types` and `/runtime` are aliased to their
  TypeScript sources rather than resolved through their exports maps, so `dev`
  does not depend on those packages having been built.
- New bare imports that only a page pulls in must be added to
  `vite.optimizeDeps.include` in `nuxt.config.ts`; the reason is documented
  there.
- `src/lib/srlLanguage/*.generated.ts` is generated from `srl.grammar` by
  `pnpm build:srl-parser` and committed. `test/lib/srlLanguage.test.ts` fails
  if what is on disk has drifted from the grammar.
- A service worker is configured under `pwa` in `nuxt.config.ts` and is
  disabled in dev. Its caching rules and the kill switch are documented inline.

## Checks

```bash
pnpm --filter @sparql-query-lib/web test        # vitest
pnpm --filter @sparql-query-lib/web typecheck   # vue-tsc
pnpm --filter @sparql-query-lib/web lint        # stylelint
pnpm --filter @sparql-query-lib/web test:e2e    # playwright, against the preview build
```
