import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
    alias: [
      { find: /^(\.{1,2}\/.*)\.js$/, replacement: '$1' },
      // Before the root entry, which would otherwise match it as a prefix.
      {
        find: '@sparql-query-lib/runtime/internal',
        replacement: path.resolve(import.meta.dirname, '../runtime/src/internal.ts'),
      },
      {
        find: '@sparql-query-lib/runtime',
        replacement: path.resolve(import.meta.dirname, '../runtime/src/index.ts'),
      },
    ],
  },
});
