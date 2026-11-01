/**
 * How a read-only deployment reads the feature flags: Bench and ETL stay, and
 * the ETL section is offered exactly when saved ETL jobs are.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useFeatureFlags } from '../../src/composables/useFeatureFlags';
import { resetDeploymentMode, useDeploymentMode } from '../../src/composables/useDeploymentMode';

const realFetch = globalThis.fetch;

async function deploymentIs(readOnly: boolean) {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ status: 'ok', readOnly }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ) as typeof globalThis.fetch;
  await useDeploymentMode().ensureLoaded();
}

function flagsAre(flags: Record<string, boolean>) {
  globalThis.__NUXT_TEST_CONFIG__ = { public: { apiBaseUrl: 'http://api.test', featureFlags: flags } };
}

beforeEach(() => {
  resetDeploymentMode();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  globalThis.__NUXT_TEST_CONFIG__ = undefined;
});

describe('useFeatureFlags on a read-only deployment', () => {
  it('keeps Bench', async () => {
    await deploymentIs(true);
    expect(useFeatureFlags().isEnabled('benchmarks')).toBe(true);
  });

  it('offers the ETL section when saved ETL jobs are on, whatever playgroundEtl says', async () => {
    flagsAre({ etl: true, playgroundEtl: false });
    await deploymentIs(true);
    expect(useFeatureFlags().isEnabled('playgroundEtl')).toBe(true);
  });

  it('hides the ETL section when saved ETL jobs are off', async () => {
    flagsAre({ etl: false, playgroundEtl: true });
    await deploymentIs(true);
    expect(useFeatureFlags().isEnabled('playgroundEtl')).toBe(false);
  });

  it('leaves the flags alone on a deployment that writes', async () => {
    flagsAre({ etl: true, playgroundEtl: false });
    await deploymentIs(false);
    expect(useFeatureFlags().isEnabled('playgroundEtl')).toBe(false);
  });
});
