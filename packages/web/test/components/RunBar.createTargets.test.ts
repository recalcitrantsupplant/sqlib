/**
 * The run bar's `create` clause against the flags that hold what it creates.
 *
 * `create test` and `create benchmark` are doors into two flagged features, and
 * the bar drew both unconditionally: three screens pass `['benchmark', 'test']`
 * and none of them asked whether either feature is on. With `tests` off the
 * button was offered, pressed, and refused by `useApiClient` before the request
 * — a control whose only outcome is an error toast.
 *
 * The filter is the bar's rather than each screen's, so what is pinned here is
 * that the bar refuses to draw a door of its own accord. A fourth screen gets
 * it by construction.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import RunBar from '@/components/shared/RunBar.vue';

function setFlags(flags: Record<string, boolean> | null): void {
  globalThis.__NUXT_TEST_CONFIG__ = flags === null
    ? undefined
    : { public: { apiBaseUrl: 'http://api.test', featureFlags: flags } };
}

afterEach(() => setFlags(null));

const bar = () => mount(RunBar, {
  props: { createTargets: ['benchmark', 'test'] as Array<'benchmark' | 'test'> },
});

describe('RunBar create targets', () => {
  it('draws both doors when both features are on', () => {
    const wrapper = bar();
    expect(wrapper.find('[data-testid="run-bar-create-benchmark"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="run-bar-create-test"]').exists()).toBe(true);
  });

  it('drops the test door when tests are off, and keeps the other', () => {
    setFlags({ tests: false });
    const wrapper = bar();
    expect(wrapper.find('[data-testid="run-bar-create-test"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="run-bar-create-benchmark"]').exists()).toBe(true);
  });

  it('drops the benchmark door when benchmarks are off', () => {
    setFlags({ benchmarks: false });
    const wrapper = bar();
    expect(wrapper.find('[data-testid="run-bar-create-benchmark"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="run-bar-create-test"]').exists()).toBe(true);
  });

  /*
   * The clause and not just its buttons: "create" with nothing after it is a
   * sentence that stops mid-word, and the rule before it separates two parts of
   * a sentence that no longer has a second part.
   */
  it('drops the whole clause when neither feature is on', () => {
    setFlags({ tests: false, benchmarks: false });
    const wrapper = bar();
    expect(wrapper.text()).not.toContain('create');
    expect(wrapper.find('.create-group').exists()).toBe(false);
  });

  it('draws no clause for a screen that offers no target', () => {
    const wrapper = mount(RunBar, { props: { createTargets: [] } });
    expect(wrapper.find('.create-group').exists()).toBe(false);
  });
});
