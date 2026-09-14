/**
 * Unmount every component a test mounted, after that test.
 *
 * A wrapper that is never unmounted stays alive until the *file's* environment
 * is torn down, and anything the component still has in flight then runs
 * against a dead environment: `c.removeEventListener is not a function` from
 * radix's deferred listener cleanup, or `Cannot read properties of null
 * (reading 'emitsOptions')` from a re-render on an unmounted tree. Both arrive
 * as unhandled rejections, both are attributed to whichever file happened to
 * be running next, and vitest exits 1 with every test green — which is the
 * worst kind of red, because the file it names is not the file at fault.
 *
 * `2cafeba` fixed one instance of this by hand in the tag-menu spec. This is
 * the general form: sixteen specs mount without unmounting, so the next one to
 * grow a late-resolving promise reintroduces it. Auto-unmount at the end of
 * each test means a component's teardown always runs while its environment is
 * still there.
 *
 * Real timers are restored for the same reason: a spec that installs fake
 * timers and never gives them back leaves the next test in the file waiting on
 * a clock nobody is advancing.
 */
import { afterEach, vi } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';

enableAutoUnmount(afterEach);

afterEach(() => {
  vi.useRealTimers();
});
