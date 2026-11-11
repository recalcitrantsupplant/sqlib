/**
 * "Copy token" beside a snippet: shown only to a signed-in person, copies an
 * export line, then shows when the copied token expires.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { computed, ref } from 'vue';
import CopyTokenButton from '@/components/shared/CopyTokenButton.vue';
import { resetApiTokenCopy } from '@/composables/useApiTokenCopy';

const signedIn = ref(true);
const freshAccessToken = vi.fn();

vi.mock('@/composables/useAuth', () => ({
  useAuth: () => ({
    isAuthenticated: computed(() => signedIn.value),
    freshAccessToken,
  }),
}));

const writeText = vi.fn();

beforeEach(() => {
  resetApiTokenCopy();
  signedIn.value = true;
  freshAccessToken.mockReset();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

describe('CopyTokenButton', () => {
  it('is absent when nobody is signed in', () => {
    signedIn.value = false;
    expect(mount(CopyTokenButton).find('[data-testid="copy-token-button"]').exists()).toBe(false);
  });

  it('copies an export line and shows the expiry of the copied token', async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
    freshAccessToken.mockResolvedValue({ token: 'aaa.bbb.ccc', expiresAt });
    const wrapper = mount(CopyTokenButton);
    expect(wrapper.find('[data-testid="copy-token-expiry"]').exists()).toBe(false);

    await wrapper.get('[data-testid="copy-token-button"]').trigger('click');
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("export SQLIB_TOKEN='aaa.bbb.ccc'"));
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-testid="copy-token-button"]').text()).toBe('Token copied');
    expect(wrapper.get('[data-testid="copy-token-expiry"]').text()).not.toBe('');
  });

  it('copies nothing when no token can be had', async () => {
    freshAccessToken.mockResolvedValue(null);
    const wrapper = mount(CopyTokenButton);
    await wrapper.get('[data-testid="copy-token-button"]').trigger('click');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(writeText).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="copy-token-button"]').text()).toBe('Copy token');
  });
});
