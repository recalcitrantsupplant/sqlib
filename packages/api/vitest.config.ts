import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
    alias: [
      { find: /^(\.{1,2}\/.*)\.js$/, replacement: '$1' },
      // Must precede the bare `contracts` entry: vite matches string `find`s by
      // prefix, so the shorter one would rewrite `contracts/schema` into
      // `<contracts/src/index.ts>/schema`.
      {
        find: '@sparql-query-lib/contracts/iri',
        replacement: path.resolve(__dirname, '../contracts/src/iri.ts'),
      },
      {
        find: '@sparql-query-lib/contracts/schema/routes',
        replacement: path.resolve(__dirname, '../contracts/src/schema/routes.ts'),
      },
      {
        find: '@sparql-query-lib/contracts/schema',
        replacement: path.resolve(__dirname, '../contracts/src/schema/index.ts'),
      },
      {
        find: '@sparql-query-lib/contracts',
        replacement: path.resolve(__dirname, '../contracts/src/index.ts'),
      },
      {
        find: '@sparql-query-lib/types',
        replacement: path.resolve(__dirname, '../types/src/index.ts'),
      },
      {
        find: '@sparql-query-lib/srl',
        replacement: path.resolve(__dirname, '../srl/src/index.ts'),
      },
      {
        find: '@sparql-query-lib/tools',
        replacement: path.resolve(__dirname, '../tools/src/index.ts'),
      },
      {
        find: '@sparql-query-lib/runtime',
        replacement: path.resolve(__dirname, '../runtime/src/index.ts'),
      },
      {
        find: '@sparql-query-lib/rdf-delta',
        replacement: path.resolve(__dirname, '../rdf-delta/src/index.ts'),
      },
    ],
    setupFiles: ['./test/setup-vitest.ts'],
    // Ensures packages/runtime is built: a few tests inline its CommonJS bundle,
    // and CI's test job installs without building. See test/global-setup.ts.
    globalSetup: ['./test/global-setup.ts'],
    // On the in-process oxigraph backends every test file gets its own store, so
    // files are independent and run concurrently. An `http` backend is a single
    // shared dataset, so concurrent files see each other's writes — which silently
    // invalidates any assertion about store *state* rather than just failing
    // honestly. See test/persistence/README-http-backend.md.
    fileParallelism: process.env.INTERNAL_BACKEND_TYPE !== 'http',
    coverage: {
      enabled: process.env.VITEST_COVERAGE === 'true',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/__tests__/**'],
    },
  },
});
