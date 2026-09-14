import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Run unit tests against workspace source (no prior build required), mirroring
// the api package's vitest setup.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
    alias: [
      // Allow TS source to resolve NodeNext-style `./foo.js` relative imports.
      { find: /^(\.{1,2}\/.*)\.js$/, replacement: '$1' },
      // src/index.ts dynamically imports the api package; point it at source so
      // vite can resolve the id without a prior build (the import stays lazy).
      {
        find: '@sparql-query-lib/api',
        replacement: path.resolve(__dirname, '../api/src/index.ts'),
      },
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
        find: '@sparql-query-lib/tools',
        replacement: path.resolve(__dirname, '../tools/src/index.ts'),
      },
    ],
  },
});
