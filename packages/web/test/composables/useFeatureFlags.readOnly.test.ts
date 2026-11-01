/**
 * A read-only deployment switches off the sections whose Run the API refuses.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useFeatureFlags, READ_ONLY_HIDDEN_FEATURES } from '../../src/composables/useFeatureFlags';
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

beforeEach(() => {
  resetDeploymentMode();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('useFeatureFlags on a read-only deployment', () => {
  it('hides Bench and ETL', async () => {
    await deploymentIs(true);
    const { isEnabled } = useFeatureFlags();
    for (const key of READ_ONLY_HIDDEN_FEATURES) expect(isEnabled(key)).toBe(false);
  });

  it('leaves the other sections alone', async () => {
    await deploymentIs(true);
    const { isEnabled } = useFeatureFlags();
    expect(isEnabled('queries')).toBe(true);
    expect(isEnabled('tests')).toBe(true);
  });

  it('keeps Bench on a deployment that writes', async () => {
    await deploymentIs(false);
    const { isEnabled } = useFeatureFlags();
    expect(isEnabled('benchmarks')).toBe(true);
  });
});
