import { describe, it, expect, vi, afterEach } from 'vitest';
import { debug, debugEnabled } from '../../src/lib/debug';

/**
 * The channel, from both ends.
 *
 * `test/browserTraces.test.ts` checks that traces go through here; that is only
 * worth anything if here is silent in a build. So: silent under anything but
 * development, and speaking under development, with the flag read at call time
 * rather than captured at import so both cases are reachable from one module.
 */
describe('debug', () => {
  const setEnv = (value: string | undefined) => {
    if (value === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = value;
  };

  const original = process.env.NODE_ENV;
  afterEach(() => {
    setEnv(original);
    vi.restoreAllMocks();
  });

  it('says nothing in a production build', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    setEnv('production');
    debug('useApiClient', 'request', { url: '/queries' });
    expect(debugEnabled()).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  /*
   * Under vitest `NODE_ENV` is `test`, so this is also the state every other
   * suite in this package runs its subject in: a unit run prints no commentary,
   * which is what keeps a failure legible.
   */
  it('says nothing under test, which is what the rest of the suite relies on', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    setEnv('test');
    debug('useApiClient', 'request');
    expect(spy).not.toHaveBeenCalled();
  });

  it('traces in development, scope first and detail left inspectable', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    setEnv('development');
    const detail = { url: '/queries/q1', method: 'PUT' };
    debug('useApiClient', 'request', detail);
    // The detail is passed, not interpolated: the console gets the object.
    expect(spy).toHaveBeenCalledWith('[useApiClient] request', detail);
  });

  it('omits the detail argument entirely when there is none', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    setEnv('development');
    debug('runtime-config', 'loaded runtime config');
    expect(spy).toHaveBeenCalledWith('[runtime-config] loaded runtime config');
  });
});
