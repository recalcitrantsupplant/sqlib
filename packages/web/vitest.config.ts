import path from 'node:path';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vitest/config';

// Unit tests only. Playwright end-to-end specs live under tests/e2e and are run
// separately (see scripts/ci/e2e.sh), so they are excluded here.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@sparql-query-lib/contracts': path.resolve(__dirname, '../contracts/src/index.ts'),
      '@sparql-query-lib/types': path.resolve(__dirname, '../types/src/index.ts'),
      '@sparql-query-lib/runtime/args-element': path.resolve(__dirname, '../runtime/src/args-element.ts'),
      '@sparql-query-lib/runtime': path.resolve(__dirname, '../runtime/src/index.ts'),
      '@': path.resolve(__dirname, 'src'),
      // Nuxt supplies `#imports` in the app build; unit tests run without Nuxt.
      '#imports': path.resolve(__dirname, 'test/stubs/nuxt-imports.ts'),
    },
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    // Every mounted component is unmounted after its test; see the file for
    // why a wrapper left mounted turns into an unhandled rejection blamed on
    // an unrelated spec.
    setupFiles: ['test/setup-unmount.ts'],
    include: ['test/**/*.{test,spec}.ts', 'src/**/*.{test,spec}.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.output/**', 'tests/e2e/**'],
    // Several specs dynamically import a component inside the test body (to
    // reset module-level singleton state per test), so the SFC transform is
    // charged to whichever test imports it first. With a cold Vite cache and
    // 40 files transforming in parallel that comfortably exceeds the 5s
    // default — QueryResultsViewer timed out in CI at 5010ms and passed in
    // 1.2s once warm. The tests themselves take milliseconds; this ceiling is
    // for the transform, not for slow assertions.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
