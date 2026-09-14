/**
 * The `#imports` alias, for unit tests.
 *
 * Nuxt provides this module in the app build; vitest runs the composables
 * without Nuxt, so anything importing `useRuntimeConfig` fails to resolve
 * rather than fails a test. The stub returns the same shape and reads its
 * values from `globalThis.__NUXT_TEST_CONFIG__`, so a test that cares can set
 * one and every other test gets a working default.
 *
 * Nuxt also auto-imports Vue's own API through `#imports`, and the app takes it
 * up: `useAuth.ts` imports `ref` and `computed` from here rather than from
 * 'vue'. Re-exporting them is what makes that module loadable under vitest —
 * without it `ref` is undefined at its module scope, and the failure surfaces
 * as `ref is not a function` in whatever component happens to pull it in.
 */
export * from 'vue';

export interface TestRuntimeConfig {
  public: Record<string, unknown>;
}

declare global {
  // eslint-disable-next-line no-var
  var __NUXT_TEST_CONFIG__: TestRuntimeConfig | undefined;
}

export function useRuntimeConfig(): TestRuntimeConfig {
  return globalThis.__NUXT_TEST_CONFIG__ ?? { public: { apiBaseUrl: 'http://api.test' } };
}

export function createError(input: unknown): Error {
  const detail = input as { statusMessage?: string; message?: string };
  return Object.assign(new Error(detail?.statusMessage ?? detail?.message ?? 'Error'), input);
}
