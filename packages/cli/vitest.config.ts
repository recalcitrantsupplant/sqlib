import path from 'node:path';
import { defineConfig } from 'vitest/config';

const source = (name: string) => path.resolve(import.meta.dirname, `../${name}/src/index.ts`);

export default defineConfig({
  resolve: {
    // Test against source, so the suite needs no build. Longer names first:
    // vite matches whole names, but the order keeps that obvious.
    alias: [
      { find: '@sparql-query-lib/runtime-oxigraph', replacement: source('runtime-oxigraph') },
      { find: '@sparql-query-lib/runtime-duckdb', replacement: source('runtime-duckdb') },
      { find: '@sparql-query-lib/runtime-etl', replacement: source('runtime-etl') },
      { find: '@sparql-query-lib/runtime-srl', replacement: source('runtime-srl') },
      { find: '@sparql-query-lib/runtime', replacement: source('runtime') },
      { find: '@sparql-query-lib/compiler', replacement: source('compiler') },
      { find: '@sparql-query-lib/srl', replacement: source('srl') },
    ],
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
