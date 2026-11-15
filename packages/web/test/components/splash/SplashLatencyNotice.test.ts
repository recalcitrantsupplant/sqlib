/**
 * The warning row under the command field: shown at 100 ms or more, hidden by
 * its button until the round trip moves into a higher 100 ms band.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { computed, ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';

const roundTripMs = ref<number | null>(null);
const location = ref<string | null>(null);
vi.mock('@/composables/useServerLatency', () => ({
  useServerLatency: () => ({
    roundTripMs: computed(() => roundTripMs.value),
    location: computed(() => location.value),
    isSlow: computed(() => roundTripMs.value !== null && roundTripMs.value >= 100),
    ensureMeasured: vi.fn(async () => undefined),
  }),
}));

const store: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: (key: string) => {
    delete store[key];
  },
});

async function mountNotice() {
  const { default: SplashLatencyNotice } = await import('@/components/splash/SplashLatencyNotice.vue');
  const wrapper = mount(SplashLatencyNotice);
  await flushPromises();
  return wrapper;
}

describe('SplashLatencyNotice', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const key in store) delete store[key];
    roundTripMs.value = null;
    location.value = null;
  });

  it('is absent before a measurement and below 100 ms', async () => {
    const wrapper = await mountNotice();
    expect(wrapper.find('[data-testid="splash-latency-notice"]').exists()).toBe(false);
    roundTripMs.value = 99;
    await flushPromises();
    expect(wrapper.find('[data-testid="splash-latency-notice"]').exists()).toBe(false);
  });

  it('shows the time, the location and the deploying guide at 100 ms or more', async () => {
    roundTripMs.value = 350;
    location.value = 'Sydney';
    const wrapper = await mountNotice();
    expect(wrapper.get('[data-testid="splash-latency-time"]').text()).toBe('Server 350 ms away');
    expect(wrapper.get('[data-testid="splash-latency-location"]').text()).toBe('Hosted in Sydney');
    expect(wrapper.get('[data-testid="splash-latency-link"]').attributes('href')).toContain(
      'docs/guides/deploying.md#where-to-run-sqlib',
    );
  });

  it('leaves the location out when the server reports none', async () => {
    roundTripMs.value = 350;
    const wrapper = await mountNotice();
    expect(wrapper.find('[data-testid="splash-latency-location"]').exists()).toBe(false);
  });

  it('stays hidden in the same band and shows again in a higher band', async () => {
    roundTripMs.value = 350;
    const wrapper = await mountNotice();
    await wrapper.get('[data-testid="splash-latency-hide"]').trigger('click');
    expect(wrapper.find('[data-testid="splash-latency-notice"]').exists()).toBe(false);
    expect(store['sqlib-latency-notice-hidden-band']).toBe('3');

    roundTripMs.value = 390;
    await flushPromises();
    expect(wrapper.find('[data-testid="splash-latency-notice"]').exists()).toBe(false);

    roundTripMs.value = 420;
    await flushPromises();
    expect(wrapper.find('[data-testid="splash-latency-notice"]').exists()).toBe(true);
  });
});
