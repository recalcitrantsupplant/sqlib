/**
 * The copy button in an editor's control row: copies the whole text, shows a
 * check for a moment, and stays as it was when the browser refuses the write.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import CopyButton from '@/components/shared/CopyButton.vue';

const { toastError, toastSuccess } = vi.hoisted(() => ({ toastError: vi.fn(), toastSuccess: vi.fn() }));
vi.mock('vue-sonner', () => ({ toast: { error: toastError, success: toastSuccess } }));

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  toastError.mockReset();
  toastSuccess.mockReset();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('CopyButton', () => {
  it('names what it copies', () => {
    const wrapper = mount(CopyButton, { props: { text: 'SELECT * {}', subject: 'query' } });
    expect(wrapper.attributes('title')).toBe('Copy query');
    expect(wrapper.attributes('aria-label')).toBe('Copy query');
  });

  it('is disabled with nothing to copy', () => {
    const wrapper = mount(CopyButton, { props: { text: '', subject: 'query' } });
    expect(wrapper.attributes('disabled')).toBeDefined();
  });

  it('copies the text, shows Copied, then goes back', async () => {
    const wrapper = mount(CopyButton, { props: { text: 'SELECT * {}', subject: 'query' } });
    vi.useFakeTimers();
    await wrapper.trigger('click');
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('SELECT * {}'));
    await wrapper.vm.$nextTick();
    expect(wrapper.attributes('title')).toBe('Copied');
    expect(wrapper.classes()).toContain('copy-button--done');
    expect(toastSuccess).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1500);
    await wrapper.vm.$nextTick();
    expect(wrapper.attributes('title')).toBe('Copy query');
  });

  it('says so and shows no check when the write is refused', async () => {
    writeText.mockRejectedValue(new Error('NotAllowedError'));
    const wrapper = mount(CopyButton, { props: { text: 'SELECT * {}', subject: 'query' } });
    await wrapper.trigger('click');
    await flush();
    await wrapper.vm.$nextTick();
    expect(toastError).toHaveBeenCalledOnce();
    expect(wrapper.attributes('title')).toBe('Copy query');
  });
});
