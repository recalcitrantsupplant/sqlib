import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineNuxtConfig } from 'nuxt/config';
import tailwindcss from '@tailwindcss/vite';
import { buildFeatureFlags } from '../types/src/featureFlags';

const currentDir = fileURLToPath(new URL('.', import.meta.url));

const frontendFeatureFlagEnv: Record<string, string | undefined> = {
  FEATURE_QUERIES: process.env.NUXT_PUBLIC_FEATURE_QUERIES ?? process.env.FEATURE_QUERIES,
  FEATURE_QUERY_GROUPS: process.env.NUXT_PUBLIC_FEATURE_QUERY_GROUPS ?? process.env.FEATURE_QUERY_GROUPS,
  FEATURE_RULES_SUITE: process.env.NUXT_PUBLIC_FEATURE_RULES_SUITE ?? process.env.FEATURE_RULES_SUITE,
  FEATURE_BENCHMARKS: process.env.NUXT_PUBLIC_FEATURE_BENCHMARKS ?? process.env.FEATURE_BENCHMARKS,
  // Both rail sections in their own right, and both missing from this map until
  // now — so the API could turn them off and the SPA would go on showing them.
  FEATURE_TESTS: process.env.NUXT_PUBLIC_FEATURE_TESTS ?? process.env.FEATURE_TESTS,
  FEATURE_DATA_GRAPHS: process.env.NUXT_PUBLIC_FEATURE_DATA_GRAPHS ?? process.env.FEATURE_DATA_GRAPHS,
  FEATURE_ETL: process.env.NUXT_PUBLIC_FEATURE_ETL ?? process.env.FEATURE_ETL,
  FEATURE_BACKENDS: process.env.NUXT_PUBLIC_FEATURE_BACKENDS ?? process.env.FEATURE_BACKENDS,
  FEATURE_SETTINGS: process.env.NUXT_PUBLIC_FEATURE_SETTINGS ?? process.env.FEATURE_SETTINGS,
  FEATURE_RULES_ALLOW_INVALID_SAVE: process.env.NUXT_PUBLIC_FEATURE_RULES_ALLOW_INVALID_SAVE ?? process.env.FEATURE_RULES_ALLOW_INVALID_SAVE,
  // The SRL rule-tuples extension. Off by default, and gated in the browser as
  // well as at the API so the toggle that turns it on is not drawn at all.
  FEATURE_RULE_TUPLES: process.env.NUXT_PUBLIC_FEATURE_RULE_TUPLES ?? process.env.FEATURE_RULE_TUPLES,
  // Rail sections in their own right, and missing from this map until now — so
  // the API could turn them off and the SPA would go on showing them.
  FEATURE_TUPLE_SETS: process.env.NUXT_PUBLIC_FEATURE_TUPLE_SETS ?? process.env.FEATURE_TUPLE_SETS,
  FEATURE_ARGUMENT_SETS: process.env.NUXT_PUBLIC_FEATURE_ARGUMENT_SETS ?? process.env.FEATURE_ARGUMENT_SETS,
  FEATURE_ASSISTANT: process.env.NUXT_PUBLIC_FEATURE_ASSISTANT ?? process.env.FEATURE_ASSISTANT,
  FEATURE_PLAYGROUND_QUERIES: process.env.NUXT_PUBLIC_FEATURE_PLAYGROUND_QUERIES ?? process.env.FEATURE_PLAYGROUND_QUERIES,
  FEATURE_PLAYGROUND_RULES: process.env.NUXT_PUBLIC_FEATURE_PLAYGROUND_RULES ?? process.env.FEATURE_PLAYGROUND_RULES,
  FEATURE_PLAYGROUND_ETL: process.env.NUXT_PUBLIC_FEATURE_PLAYGROUND_ETL ?? process.env.FEATURE_PLAYGROUND_ETL,
  // The two screens in the rail — the library's front page and Build. Browser
  // only: neither gates a route, and what each shows is decided by the section
  // flags above.
  FEATURE_NOTEBOOK: process.env.NUXT_PUBLIC_FEATURE_NOTEBOOK ?? process.env.FEATURE_NOTEBOOK,
  FEATURE_MCP: process.env.NUXT_PUBLIC_FEATURE_MCP ?? process.env.FEATURE_MCP,
};

const frontendFeatureFlags = buildFeatureFlags(frontendFeatureFlagEnv);

/*
 * What build this is, resolved once when the bundle is built.
 *
 * The version is release-please's, read from its manifest rather than from a
 * package.json: `release-type: simple` bumps the manifest and the tag, and the
 * workspace package.jsons are not part of that — `packages/web` still says
 * 0.0.1 and always will, which is not a version anybody can report a bug
 * against.
 *
 * Both are overridable by environment, because a container build has neither
 * file nor git history to read: the image build passes what it knows.
 */
function releaseVersion(): string {
  const fromEnv = process.env.NUXT_PUBLIC_APP_VERSION?.trim();
  if (fromEnv) return fromEnv;
  try {
    const manifest = JSON.parse(
      readFileSync(resolve(currentDir, '../../.release-please-manifest.json'), 'utf8'),
    ) as Record<string, string>;
    return manifest['.'] ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/** The commit the bundle was built from, short form. Empty when unknown. */
function buildCommit(): string {
  const fromEnv = process.env.NUXT_PUBLIC_APP_COMMIT?.trim();
  if (fromEnv) return fromEnv.slice(0, 7);
  try {
    return execFileSync('git', ['rev-parse', '--short=7', 'HEAD'], {
      cwd: currentDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return '';
  }
}

export default defineNuxtConfig({
  compatibilityDate: '2026-08-06',
  srcDir: 'src',
  ssr: false,
  devtools: {
    enabled: true,

    timeline: {
      enabled: true,
    },
  },
  devServer: {
    port: 3001,
  },
  vue: {
    compilerOptions: {
      /*
       * `<sqlib-args>` is a real custom element from @sparql-query-lib/runtime,
       * shared with the exported library page so both hosts build arguments the
       * same way. Without this Vue would try to resolve it as a component and
       * warn on every render.
       */
      isCustomElement: (tag: string) => tag.startsWith('sqlib-'),
    },
  },
  typescript: {
    strict: true,
    tsConfig: {
      compilerOptions: {
        baseUrl: '.',
        paths: {
          '@sparql-query-lib/contracts': ['../contracts/src/index.ts'],
          '@sparql-query-lib/contracts/*': ['../contracts/src/*'],
          '@sparql-query-lib/types': ['../types/src/index.ts'],
          '@sparql-query-lib/types/*': ['../types/src/*'],
          '@sparql-query-lib/runtime': ['../runtime/src/index.ts'],
          '@sparql-query-lib/runtime/args-element': ['../runtime/src/args-element.ts'],
        },
      },
    },
  },
  css: [
    '~/assets/css/inter-font.css',
    '~/assets/css/tailwind.css',
    '~/assets/css/compact-buttons.css',
    '~/assets/css/codemirror-theme.css',
    '@vue-flow/core/dist/style.css',
    '@vue-flow/core/dist/theme-default.css',
    '@vue-flow/controls/dist/style.css',
  ],
  modules: ['shadcn-nuxt', '@vite-pwa/nuxt'],
  shadcn: {
    prefix: '',
    componentDir: './src/components/ui',
  },
  /*
   * Service worker for the app shell — see #131. `ssr: false` still means
   * Nitro's node-server renders the SPA shell per request rather than
   * serving a static `index.html` (there is none in `.output/public`), so
   * there is nothing for Workbox to precache the navigation onto and
   * `navigateFallback` is deliberately not set. Runtime-caching navigation
   * requests below gets the same "the shell renders without hitting the
   * network" property once a page has loaded once, which is as far as the
   * offline story goes — see the non-goals in #131. Real data (queries,
   * drafts, results) always comes from the API and is never cached here.
   *
   * Kill switch, if a bad config ever ships: deploy a trivial service worker
   * at the same `/sw.js` that self-destructs —
   *
   *   self.addEventListener('install', () => self.skipWaiting());
   *   self.addEventListener('activate', async () => {
   *     await self.registration.unregister();
   *     for (const client of await self.clients.matchAll()) client.navigate(client.url);
   *   });
   *
   * — since an existing client keeps the SW it already installed until a new
   * one replaces it; removing this config only stops *new* clients from
   * getting a service worker; it does not reach the ones that already have
   * one.
   */
  pwa: {
    registerType: 'prompt',
    // The module's own client plugin (client.registerPlugin, on by default)
    // registers the SW and exposes usePWA(); this is the vite-plugin-pwa
    // option for injecting a *second*, standalone registration script, which
    // would only be needed outside Nuxt.
    injectRegister: false,
    // public/site.webmanifest is already linked from app.head below; this
    // would inject a second <link rel="manifest">.
    manifest: false,
    includeManifestIcons: false,
    client: {
      // The manifest alone already makes Chrome offer "Install" — see #131's
      // context. A custom install button is separate work this issue does
      // not cover.
      installPrompt: false,
    },
    workbox: {
      // Just the CSS bundles. The 67 hashed `_nuxt/*.js` chunks (3.1MB,
      // CodeMirror and Vue Flow among them) are runtime-cached below instead,
      // so a first visit for one page does not pay for the whole app.
      globPatterns: ['**/*.css'],
      // The module defaults this to '/' whenever the key is absent, which
      // binds a NavigationRoute to a precache entry named '/' — and nothing
      // ever precaches one, since there is no static index.html (see above).
      // Left at that default, the generated SW's very first route would 404
      // every navigation. The key must be *present*, even as undefined, to
      // stop the module supplying that default; the NetworkFirst rule below
      // is this app's real navigate handler.
      navigateFallback: undefined,
      runtimeCaching: [
        {
          // Stand-in for the missing precached shell: once a navigation has
          // been served once, a slow or dropped connection gets the
          // last-known shell instead of the browser's own connection-error
          // page (motivation 3 in #131).
          urlPattern: ({ request }: { request: Request }) => request.mode === 'navigate',
          handler: 'NetworkFirst',
          options: {
            cacheName: 'nuxt-shell',
            networkTimeoutSeconds: 3,
          },
        },
        {
          // Hashed build chunks are immutable by construction — a URL only
          // ever names one set of bytes — so CacheFirst is exact, never
          // stale. This is the fix for motivation 1, the stale-chunk white
          // screen: a chunk this tab already fetched keeps serving from here
          // even after a deploy removes it from the server.
          urlPattern: ({ url, sameOrigin }: { url: URL; sameOrigin: boolean }) =>
            sameOrigin && /\/_nuxt\/.+\.m?js$/.test(url.pathname),
          handler: 'CacheFirst',
          options: {
            cacheName: 'nuxt-build-assets',
            expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 },
          },
        },
      ],
    },
    devOptions: {
      // A service worker is a well-known source of "my change isn't
      // showing" in dev; e2e also runs against the preview build, not dev
      // (see playwright.config.ts), so there is no test coverage relying on
      // it being enabled here.
      enabled: false,
    },
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      dedupe: [
        'vue-codemirror',
        'codemirror',
        '@codemirror/state',
        '@codemirror/view',
        '@codemirror/language',
        '@codemirror/commands',
        '@codemirror/search',
        '@codemirror/autocomplete',
        '@codemirror/lint',
        '@kurrawongai/codemirror-lang-sparql12',
        '@kurrawongai/codemirror-lang-turtle12',
        '@kurrawongai/codemirror-lang-srl',
      ],
    },
    /*
     * Every bare dependency the app imports, listed so the dev server
     * pre-bundles all of them in one pass at startup.
     *
     * Vite's dependency scanner crawls from the client entry, and the entry
     * reaches the pages through Nuxt's generated route table — a virtual
     * module the esbuild-based scanner cannot resolve. So a dependency
     * imported only from a page (or from a component only that page mounts)
     * is invisible until the browser first asks for it, which is when the
     * optimizer notices, re-bundles, and hands every optimized dependency a
     * new `?v=` hash. Modules the page already has in flight are still asking
     * for the old hash, and those requests come back
     * `504 (Outdated Optimize Dep)`; a chunk the previous run wrote is gone
     * from the deps directory, so Vite also logs "The file does not exist at
     * .../deps/<chunk>.js which is in the optimize deps directory". Opening
     * Build did this three times in a row — @vue-flow, then the CodeMirror
     * grammars, then @codemirror/merge and @tanstack/vue-table — so the
     * screen half-loaded and needed a reload.
     *
     * Listing a dependency here makes it part of the first bundling pass
     * instead, so no navigation discovers anything new. Keep it in step with
     * package.json: a new bare import that a page (not app.vue) pulls in
     * belongs here too.
     */
    optimizeDeps: {
      include: [
        'vue-codemirror',
        'codemirror',
        '@codemirror/state',
        '@codemirror/view',
        '@codemirror/language',
        '@codemirror/commands',
        '@codemirror/search',
        '@codemirror/autocomplete',
        '@codemirror/lint',
        '@codemirror/lang-json',
        '@codemirror/lang-sql',
        '@codemirror/lang-xml',
        '@codemirror/merge',
        '@kurrawongai/codemirror-lang-sparql12',
        '@kurrawongai/codemirror-lang-turtle12',
        '@kurrawongai/codemirror-lang-srl',
        '@lezer/highlight',
        '@lezer/lr',
        '@vue-flow/core',
        '@vue-flow/background',
        '@vue-flow/controls',
        'dagre',
        '@tanstack/vue-table',
        '@traqula/parser-sparql-1-2',
        'n3',
        '@lucide/vue',
        '@vueuse/core',
        'class-variance-authority',
        'clsx',
        'tailwind-merge',
        'fuzzysort',
        'oidc-client-ts',
        'reka-ui',
        'uuid',
        'vue-sonner',
        'zod',
      ],
    },
  },
  build: {
    transpile: ['vue-codemirror', 'codemirror', /@codemirror\//, /@kurrawongai\/codemirror-lang-/],
  },
  routeRules: {
    '/**': { ssr: false },
  },
  alias: {
    '@sparql-query-lib/contracts': resolve(currentDir, '../contracts/src/index.ts'),
    '@sparql-query-lib/types': resolve(currentDir, '../types/src/index.ts'),
    /*
     * Source, not `dist`. The runtime is a workspace package whose build is not
     * part of the web build, so resolving through its exports map would make
     * `pnpm dev` depend on somebody having run `pnpm --filter runtime build`
     * first. The other two workspace packages are aliased for the same reason.
     */
    '@sparql-query-lib/runtime/args-element': resolve(currentDir, '../runtime/src/args-element.ts'),
    '@sparql-query-lib/runtime': resolve(currentDir, '../runtime/src/index.ts'),
  },
  runtimeConfig: {
    public: {
      apiBaseUrl: process.env.NUXT_PUBLIC_API_BASE_URL || 'http://localhost:3000',
      /*
       * Where the Connect page tells people to point their chat client.
       *
       * `/mcp` is served beside the API on the same origin in every deployment
       * mode this repository ships, so the default is derived rather than
       * configured — one fewer variable to forget. It is overridable because a
       * public read-only MCP may well be a separate host from the app that
       * administers it, which is the deployment the Connect page exists for.
       */
      mcpUrl: process.env.NUXT_PUBLIC_MCP_URL || '',
      featureFlags: frontendFeatureFlags,
      // What is running, for the About block on the splash and the line in
      // Settings. Baked in at build time — `ssr: false` means these are in the
      // client bundle, which is the thing they describe.
      appVersion: releaseVersion(),
      appCommit: buildCommit(),
      buildTime: process.env.NUXT_PUBLIC_BUILD_TIME || new Date().toISOString(),
      // OIDC settings. Empty by default: the app reads the API's auth mode at
      // boot and only reaches for these when it reports an enforcing mode, so a
      // deployment without auth needs none of them.
      authIssuer: process.env.NUXT_PUBLIC_AUTH_ISSUER || '',
      authClientId: process.env.NUXT_PUBLIC_AUTH_CLIENT_ID || '',
      authAudience: process.env.NUXT_PUBLIC_AUTH_AUDIENCE || '',
      authScope: process.env.NUXT_PUBLIC_AUTH_SCOPE || 'openid profile email',
    },
  },
  app: {
    head: {
      title: 'SPARQL Query Library',
      link: [
        /*
         * The font is otherwise only discovered after the stylesheet has been
         * parsed and the first text laid out — measured at 279ms on /library,
         * with the `swap` reflow landing 7ms after it arrived and shifting the
         * header. Preloading puts it in flight with the CSS instead, so the
         * first paint is already in Inter.
         *
         * One file, one hint: the five weights are one variable font (see
         * assets/css/inter-font.css).
         */
        {
          rel: 'preload',
          as: 'font',
          type: 'font/woff2',
          href: '/assets/fonts/inter-variable-latin.woff2',
          crossorigin: 'anonymous',
        },
        // SVG first so modern browsers pick it; favicon.ico is the legacy fallback.
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico', sizes: '48x48' },
        { rel: 'apple-touch-icon', href: '/apple-touch-icon.png', sizes: '180x180' },
        { rel: 'manifest', href: '/site.webmanifest' },
      ],
      meta: [
        { name: 'theme-color', content: '#85272f' },
      ],
      script: [
        {
          // Applies the stored theme before first paint. Without this the app
          // renders light for a frame and then flips, because the class is set
          // from the settings composable after hydration.
          innerHTML: `(function(){try{var s=JSON.parse(localStorage.getItem('sparql-query-lib-settings')||'{}');var t=s.theme||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`,
          type: 'text/javascript',
          tagPosition: 'head',
        },
      ],
    },
  },
})
