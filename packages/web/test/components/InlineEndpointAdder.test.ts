/**
 * Pasting an endpoint into the picker.
 *
 * The behaviour worth pinning is what the paste *is*: a browser backend, named
 * after its own URL, registered without a single request. Everything else here
 * is the guard rails that make one paste enough — Enter commits, a URL with no
 * scheme is refused before it becomes a backend that cannot answer.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import InlineEndpointAdder from '@/components/shared/InlineEndpointAdder.vue';
import { useBrowserBackends } from '@/composables/useBrowserBackends';

const api = vi.hoisted(() => ({ listBackends: vi.fn() }));
vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));

beforeEach(() => {
  vi.clearAllMocks();
  api.listBackends.mockResolvedValue([]);
  localStorage.clear();
  for (const record of [...useBrowserBackends().records.value]) {
    useBrowserBackends().remove(record.id);
  }
});

async function openField() {
  const wrapper = mount(InlineEndpointAdder);
  await wrapper.find('[data-testid="run-bar-add-endpoint"]').trigger('click');
  await flushPromises();
  return wrapper;
}

describe('InlineEndpointAdder', () => {
  it('starts as one row, and opens into a field', async () => {
    const wrapper = mount(InlineEndpointAdder);
    expect(wrapper.find('[data-testid="run-bar-endpoint-input"]').exists()).toBe(false);

    await wrapper.find('[data-testid="run-bar-add-endpoint"]').trigger('click');

    expect(wrapper.find('[data-testid="run-bar-endpoint-input"]').exists()).toBe(true);
  });

  it('registers the endpoint in this browser and hands back its id', async () => {
    const wrapper = await openField();
    const input = wrapper.find('[data-testid="run-bar-endpoint-input"]');

    await input.setValue('https://query.wikidata.org/sparql');
    await input.trigger('keydown.enter');
    await flushPromises();

    const records = useBrowserBackends().records.value;
    expect(records).toHaveLength(1);
    expect(records[0].endpoint).toBe('https://query.wikidata.org/sparql');
    // The URL is the name until someone gives it one.
    expect(records[0].name).toBe('query.wikidata.org/sparql');

    const added = wrapper.emitted('added');
    expect(added).toHaveLength(1);
    expect(added![0][0]).toBe(records[0].id);
  });

  /* The point of a browser backend: the server is never told it exists. */
  it('posts nothing', async () => {
    const wrapper = await openField();
    const input = wrapper.find('[data-testid="run-bar-endpoint-input"]');
    await input.setValue('https://query.wikidata.org/sparql');
    await input.trigger('keydown.enter');
    await flushPromises();

    // The only call it makes is the read that refreshes the picker.
    expect(api.listBackends).toHaveBeenCalledTimes(1);
  });

  it('refuses a URL with no scheme, and says so', async () => {
    const wrapper = await openField();
    const input = wrapper.find('[data-testid="run-bar-endpoint-input"]');

    await input.setValue('query.wikidata.org/sparql');
    await input.trigger('keydown.enter');
    await flushPromises();

    expect(wrapper.find('[data-testid="run-bar-endpoint-error"]').text()).toMatch(/scheme/);
    expect(useBrowserBackends().records.value).toHaveLength(0);
    expect(wrapper.emitted('added')).toBeUndefined();
  });

  /* Nothing typed is not an error; it is a field nobody has filled in yet. */
  it('says nothing about an empty field', async () => {
    const wrapper = await openField();

    expect(wrapper.find('[data-testid="run-bar-endpoint-error"]').exists()).toBe(false);
  });

  it('abandons the field on Escape', async () => {
    const wrapper = await openField();
    const input = wrapper.find('[data-testid="run-bar-endpoint-input"]');

    await input.setValue('https://query.wikidata.org/sparql');
    await input.trigger('keydown.esc');

    expect(wrapper.find('[data-testid="run-bar-endpoint-input"]').exists()).toBe(false);
    expect(useBrowserBackends().records.value).toHaveLength(0);
  });
});
