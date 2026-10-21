import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Test against source, so a change in the runtime is seen without a build.
    alias: [
      { find: '@sparql-query-lib/compiler', replacement: path.resolve(import.meta.dirname, '../compiler/src/index.ts') },
      { find: '@sparql-query-lib/runtime-oxigraph', replacement: path.resolve(import.meta.dirname, '../runtime-oxigraph/src/index.ts') },
      { find: '@sparql-query-lib/runtime', replacement: path.resolve(import.meta.dirname, '../runtime/src/index.ts') },
    ],
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.{test,spec}.ts', 'src/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
