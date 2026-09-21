/**
 * Reading the deployment's mode off `/health`.
 *
 * The default matters more than the happy path: a SPA that cannot reach the
 * server must assume it may write, so a working feature is never hidden by a
 * failed fetch.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { useDeploymentMode, resetDeploymentMode } from '../../src/composables/useDeploymentMode';

const realFetch = globalThis.fetch;

beforeEach(() => {
  resetDeploymentMode();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

function healthReturning(payload: unknown, status = 200) {
  return vi.fn(async () =>
    new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
  );
}

describe('useDeploymentMode', () => {
  it('is not read-only before anything has answered', () => {
    expect(useDeploymentMode().isReadOnly.value).toBe(false);
  });

  it('reads readOnly:true from /health', async () => {
    globalThis.fetch = healthReturning({ readOnly: true }) as typeof globalThis.fetch;
    const mode = useDeploymentMode();
    await mode.ensureLoaded();
    expect(mode.isReadOnly.value).toBe(true);
    expect(mode.isResolved.value).toBe(true);
  });

  it('treats a missing field as not read-only, for an older API', async () => {
    globalThis.fetch = healthReturning({ status: 'ok' }) as typeof globalThis.fetch;
    const mode = useDeploymentMode();
    await mode.ensureLoaded();
    expect(mode.isReadOnly.value).toBe(false);
  });

  it('accepts only a real boolean, not a truthy string', async () => {
    globalThis.fetch = healthReturning({ readOnly: 'true' }) as typeof globalThis.fetch;
    const mode = useDeploymentMode();
    await mode.ensureLoaded();
    expect(mode.isReadOnly.value).toBe(false);
  });

  it('still reads the mode from a 503, which carries it', async () => {
    globalThis.fetch = healthReturning({ readOnly: true }, 503) as typeof globalThis.fetch;
    const mode = useDeploymentMode();
    await mode.ensureLoaded();
    expect(mode.isReadOnly.value).toBe(true);
  });

  it('leaves the default in place when /health cannot be reached', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof globalThis.fetch;
    const mode = useDeploymentMode();
    await mode.ensureLoaded();
    expect(mode.isReadOnly.value).toBe(false);
    expect(mode.isResolved.value).toBe(false);
  });

  it('asks once, however many callers there are', async () => {
    const fetchImpl = healthReturning({ readOnly: true });
    globalThis.fetch = fetchImpl as typeof globalThis.fetch;
    await Promise.all([
      useDeploymentMode().ensureLoaded(),
      useDeploymentMode().ensureLoaded(),
      useDeploymentMode().ensureLoaded(),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
