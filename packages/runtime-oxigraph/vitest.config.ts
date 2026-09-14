import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
    alias: [
      { find: /^(\.{1,2}\/.*)\.js$/, replacement: '$1' },
      {
        find: '@sparql-query-lib/runtime',
        replacement: path.resolve(import.meta.dirname, '../runtime/src/index.ts'),
      },
    ],
  },
});
