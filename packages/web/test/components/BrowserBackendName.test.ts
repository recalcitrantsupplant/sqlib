/**
 * Naming a pasted endpoint, the optional second step.
 *
 * Two behaviours carry the weight. The field opens *empty* for an endpoint
 * still called after its URL, because there is no name yet to correct. And a
 * commit happens once: removing a focused input fires `blur`, so a submit that
 * closed after saving was re-entered by its own unmount with a cleared draft —
 * and an empty name means "call it after its URL", which sent a just-named
 * endpoint straight back to being one.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import BrowserBackendName from '@/components/shared/BrowserBackendName.vue';
import { useBrowserBackends } from '@/composables/useBrowserBackends';

const api = vi.hoisted(() => ({ listBackends: vi.fn() }));
vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));

const ENDPOINT = 'https://query.wikidata.org/sparql';

function register(name = 'query.wikidata.org/sparql') {
  return useBrowserBackends().save({
    name,
    description: null,
    endpoint: ENDPOINT,
    queryMethod: null,
    headers: {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listBackends.mockResolvedValue([]);
  localStorage.clear();
  for (const record of [...useBrowserBackends().records.value]) {
    useBrowserBackends().remove(record.id);
  }
});

async function openField(id: string, current: string) {
  const wrapper = mount(BrowserBackendName, { props: { backendId: id, current } });
  await wrapper.find('[data-testid="backend-name-endpoint"]').trigger('click');
  await flushPromises();
  return wrapper;
}

describe('BrowserBackendName', () => {
  it('opens an empty field while the endpoint is called after its URL', async () => {
    const record = register();
    const wrapper = await openField(record.id, record.name);

    const input = wrapper.find('[data-testid="backend-name-input"]').element as HTMLInputElement;
    expect(input.value).toBe('');
  });

  it('offers an existing name back for correction', async () => {
    const record = register('Wikidata');
    const wrapper = await openField(record.id, record.name);

    const input = wrapper.find('[data-testid="backend-name-input"]').element as HTMLInputElement;
    expect(input.value).toBe('Wikidata');
  });

  it('commits on Enter', async () => {
    const record = register();
    const wrapper = await openField(record.id, record.name);

    await wrapper.find('[data-testid="backend-name-input"]').setValue('Wikidata');
    await wrapper.find('[data-testid="backend-name-input"]').trigger('keydown.enter');
    await flushPromises();

    expect(useBrowserBackends().get(record.id)?.name).toBe('Wikidata');
    expect(useBrowserBackends().get(record.id)?.endpoint).toBe(ENDPOINT);
  });

  it('keeps the name when the field is unmounted after committing', async () => {
    const record = register();
    const wrapper = await openField(record.id, record.name);

    const input = wrapper.find('[data-testid="backend-name-input"]');
    await input.setValue('Wikidata');
    await input.trigger('keydown.enter');
    // What a real browser does next: the removed input reports a blur.
    await input.trigger('blur');
    await flushPromises();

    expect(useBrowserBackends().get(record.id)?.name).toBe('Wikidata');
  });

  it('leaves the name alone on Escape', async () => {
    const record = register('Wikidata');
    const wrapper = await openField(record.id, record.name);

    await wrapper.find('[data-testid="backend-name-input"]').setValue('Something else');
    await wrapper.find('[data-testid="backend-name-input"]').trigger('keydown.esc');
    await flushPromises();

    expect(useBrowserBackends().get(record.id)?.name).toBe('Wikidata');
  });

  /* Clearing the name is how an endpoint goes back to being called after itself. */
  it('falls back to the URL when the name is cleared', async () => {
    const record = register('Wikidata');
    const wrapper = await openField(record.id, record.name);

    await wrapper.find('[data-testid="backend-name-input"]').setValue('   ');
    await wrapper.find('[data-testid="backend-name-input"]').trigger('keydown.enter');
    await flushPromises();

    expect(useBrowserBackends().get(record.id)?.name).toBe(ENDPOINT);
  });
});
