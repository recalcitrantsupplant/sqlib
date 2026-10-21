import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Test against source, so a change in the language is seen without a build.
    alias: [
      { find: '@sparql-query-lib/srl', replacement: path.resolve(import.meta.dirname, '../srl/src/index.ts') },
    ],
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.{test,spec}.ts', 'src/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
