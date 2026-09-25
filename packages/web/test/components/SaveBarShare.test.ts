import { beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import SaveBar from '@/components/shared/SaveBar.vue';
import { decodeSharePayload, sharePayloadFromHash, type ScratchSharePayload } from '@/lib/shareLink';

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() }));
vi.mock('vue-sonner', () => ({ toast }));

const BASE = {
  title: 'A query',
  isScratch: false,
  canSave: true,
  saving: false,
  currentVersionNumber: 2,
  editCount: 0,
};

const PAYLOAD: ScratchSharePayload = {
  section: 'query',
  name: 'A query',
  description: null,
  body: 'SELECT * WHERE { ?s ?p ?o }',
  defaultBackend: null,
};

describe('SaveBar share', () => {
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    window.history.replaceState(null, '', '/?section=queries&query=urn%3Aq%3A1&version=2#stale');
  });

  it('copies a saved item\'s address, without the fragment', async () => {
    const wrapper = mount(SaveBar, { props: BASE });
    await wrapper.find('[data-testid="share-link"]').trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?section=queries&query=urn%3Aq%3A1&version=2`);
    expect(toast.success).toHaveBeenCalledWith('Link copied');
  });

  it('says unsaved edits are not in a saved item\'s link', () => {
    const wrapper = mount(SaveBar, { props: { ...BASE, editCount: 2 } });
    expect(wrapper.find('[data-testid="share-link"]').attributes('title')).toContain('unsaved edits are not included');
  });

  it('has no Share on a scratch item whose section cannot carry its body', () => {
    const wrapper = mount(SaveBar, { props: { ...BASE, isScratch: true } });
    expect(wrapper.find('[data-testid="share-link"]').exists()).toBe(false);
  });

  it('copies a link carrying a scratch item\'s body, and no scratch id', async () => {
    window.history.replaceState(null, '', '/?scratch=urn%3Aui-temp%3Aabc');
    const shareScratch = vi.fn(() => PAYLOAD);
    const wrapper = mount(SaveBar, { props: { ...BASE, isScratch: true, shareScratch } });
    await wrapper.find('[data-testid="share-link"]').trigger('click');
    // Compression is a stream, which settles over more than one microtask.
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled());
    const url = new URL(writeText.mock.calls[0]![0] as string);
    expect(url.search).toBe('');
    expect(await decodeSharePayload(sharePayloadFromHash(url.hash)!)).toEqual(PAYLOAD);
    expect(toast.success).toHaveBeenCalledOnce();
  });

  it('reports a clipboard failure rather than claiming success', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    const wrapper = mount(SaveBar, { props: BASE });
    await wrapper.find('[data-testid="share-link"]').trigger('click');
    await flushPromises();
    expect(toast.error).toHaveBeenCalledWith('Could not copy the link');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('can be switched off', () => {
    const wrapper = mount(SaveBar, { props: { ...BASE, showShare: false } });
    expect(wrapper.find('[data-testid="share-link"]').exists()).toBe(false);
  });
});
