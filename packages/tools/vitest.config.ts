import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    alias: [
      { find: /^(\.{1,2}\/.*)\.js$/, replacement: '$1' },
      // Resolve the workspace dependency to its source, the way packages/api
      // and packages/mcp-server do. The `test` CI lane never builds, so a
      // package that reaches for `contracts/dist` cannot run there at all.
      //
      // Longest subpath first: vite matches string `find`s by prefix, so
      // `.../schema` would otherwise swallow `.../schema/routes`.
      {
        find: '@sparql-query-lib/contracts/schema/routes',
        replacement: path.resolve(__dirname, '../contracts/src/schema/routes.ts'),
      },
      {
        find: '@sparql-query-lib/contracts/schema',
        replacement: path.resolve(__dirname, '../contracts/src/schema/index.ts'),
      },
    ],
  },
});
