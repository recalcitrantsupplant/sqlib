import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';

/**
 * The wiring every editor now shares: what is on screen teaches the prefix
 * manager, once the typing stops.
 */
const autoDiscoverFromText = vi.fn();

vi.mock('@/composables/usePrefixManager', () => ({
  usePrefixManager: () => ({ autoDiscoverFromText }),
}));

const { usePrefixDiscovery } = await import('@/composables/usePrefixDiscovery');

function mountEditor(text: ReturnType<typeof ref<string>>, source: () => string | null | undefined) {
  return mount(
    defineComponent({
      setup() {
        usePrefixDiscovery(() => text.value, source, { delay: 10 });
        return () => h('div');
      },
    }),
  );
}

describe('usePrefixDiscovery', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    autoDiscoverFromText.mockClear();
  });

  it('records what is already in the editor when it opens', async () => {
    const text = ref('PREFIX ex: <http://example.org/> SELECT * WHERE { ?s ?p ?o }');
    mountEditor(text, () => 'query:urn:sqlib:query:1');

    await vi.advanceTimersByTimeAsync(20);

    expect(autoDiscoverFromText).toHaveBeenCalledWith(text.value, 'query:urn:sqlib:query:1');
  });

  it('waits for typing to stop rather than reading every keystroke', async () => {
    const text = ref('PREFIX e');
    mountEditor(text, () => null);

    text.value = 'PREFIX ex';
    await nextTick();
    text.value = 'PREFIX ex: <http://example.org/>';
    await nextTick();
    await vi.advanceTimersByTimeAsync(5);
    expect(autoDiscoverFromText).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(20);
    expect(autoDiscoverFromText).toHaveBeenCalledTimes(1);
    expect(autoDiscoverFromText).toHaveBeenCalledWith('PREFIX ex: <http://example.org/>', null);
  });

  it('reads nothing from a document with no declarations', async () => {
    const text = ref('SELECT * WHERE { ?s ?p ?o }');
    mountEditor(text, () => null);

    await vi.advanceTimersByTimeAsync(20);

    expect(autoDiscoverFromText).not.toHaveBeenCalled();
  });

  it('stays off for a box that is not holding RDF', async () => {
    const text = ref('@prefix ex: <http://example.org/> .');
    mountEditor(text, () => undefined);

    await vi.advanceTimersByTimeAsync(20);

    expect(autoDiscoverFromText).not.toHaveBeenCalled();
  });

  it('drops a pending read when the editor goes away', async () => {
    const text = ref('@prefix ex: <http://example.org/> .');
    const wrapper = mountEditor(text, () => null);

    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(20);

    expect(autoDiscoverFromText).not.toHaveBeenCalled();
  });
});
