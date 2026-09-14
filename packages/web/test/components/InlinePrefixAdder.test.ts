import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';

// usePrefixManager persists through localStorage; happy-dom supplies one, but
// the composable is a module-level singleton, so each test re-imports it.
const mockLocalStorage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => mockLocalStorage[key] || null),
  setItem: vi.fn((key: string, value: string) => {
    mockLocalStorage[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete mockLocalStorage[key];
  }),
  clear: vi.fn(() => {
    for (const key in mockLocalStorage) delete mockLocalStorage[key];
  }),
});

vi.mock('vue-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

async function load() {
  const { mount } = await import('@vue/test-utils');
  const { default: InlinePrefixAdder } = await import('@/components/shared/InlinePrefixAdder.vue');
  const { usePrefixManager } = await import('@/composables/usePrefixManager');
  return { mount, InlinePrefixAdder, usePrefixManager };
}

const IRI = 'https://linked.data.gov.au/def/geoscience-commodities-wa/gold';
const NAMESPACE = 'https://linked.data.gov.au/def/geoscience-commodities-wa/';

describe('InlinePrefixAdder', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    localStorage.setItem(
      'sparqlQueryLib.prefixSettings',
      JSON.stringify({ duplicateResolution: 'longest', mappings: [] }),
    );
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  it('renders nothing for a value that has no namespace worth registering', async () => {
    const { mount, InlinePrefixAdder } = await load();
    const wrapper = mount(InlinePrefixAdder, { props: { iri: 'not an iri' }, attachTo: document.body });
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('opens with the namespace and a suggested prefix', async () => {
    const { mount, InlinePrefixAdder } = await load();
    const wrapper = mount(InlinePrefixAdder, { props: { iri: IRI }, attachTo: document.body });

    await wrapper.find('button.prefix-trigger').trigger('click');
    await nextTick();

    const popover = document.querySelector('.prefix-popover');
    expect(popover).not.toBeNull();
    expect(popover!.textContent).toContain(NAMESPACE);

    const input = document.querySelector<HTMLInputElement>('#inline-prefix-input');
    expect(input!.value).toBe('geoscience-commodities');
  });

  it('adds the prefix to the manager and closes', async () => {
    const { mount, InlinePrefixAdder, usePrefixManager } = await load();
    const { prefixSettings, abbreviateIri } = usePrefixManager();
    const wrapper = mount(InlinePrefixAdder, { props: { iri: IRI }, attachTo: document.body });

    await wrapper.find('button.prefix-trigger').trigger('click');
    await nextTick();

    const input = document.querySelector<HTMLInputElement>('#inline-prefix-input')!;
    input.value = 'gswa-comm';
    input.dispatchEvent(new Event('input'));
    await nextTick();

    document.querySelector<HTMLButtonElement>('.popover-add')!.click();
    await nextTick();

    expect(wrapper.emitted('added')?.[0]).toEqual([{ prefix: 'gswa-comm', namespace: NAMESPACE }]);
    expect(
      prefixSettings.value.mappings.some(
        (m) => m.prefix === 'gswa-comm' && m.namespace === NAMESPACE && m.source === 'user-added',
      ),
    ).toBe(true);
    expect(document.querySelector('.prefix-popover')).toBeNull();

    // The point of the feature: the IRI that prompted it now abbreviates.
    expect(abbreviateIri(IRI).abbreviated).toBe('gswa-comm:gold');
  });

  it('refuses a prefix the manager would reject', async () => {
    const { mount, InlinePrefixAdder, usePrefixManager } = await load();
    const { prefixSettings } = usePrefixManager();
    const wrapper = mount(InlinePrefixAdder, { props: { iri: IRI }, attachTo: document.body });

    await wrapper.find('button.prefix-trigger').trigger('click');
    await nextTick();

    const input = document.querySelector<HTMLInputElement>('#inline-prefix-input')!;
    input.value = '9bad prefix';
    input.dispatchEvent(new Event('input'));
    await nextTick();

    const add = document.querySelector<HTMLButtonElement>('.popover-add')!;
    expect(add.disabled).toBe(true);
    add.click();
    await nextTick();

    expect(wrapper.emitted('added')).toBeUndefined();
    expect(prefixSettings.value.mappings.some((m) => m.namespace === NAMESPACE)).toBe(false);
    expect(document.querySelector('.popover-error')).not.toBeNull();
  });

  it('warns when the typed prefix already points somewhere else', async () => {
    const { mount, InlinePrefixAdder } = await load();
    const wrapper = mount(InlinePrefixAdder, { props: { iri: IRI }, attachTo: document.body });

    await wrapper.find('button.prefix-trigger').trigger('click');
    await nextTick();

    const input = document.querySelector<HTMLInputElement>('#inline-prefix-input')!;
    input.value = 'foaf';
    input.dispatchEvent(new Event('input'));
    await nextTick();

    expect(document.querySelector('.popover-warning')?.textContent).toContain(
      'http://xmlns.com/foaf/0.1/',
    );
  });

  it('cancel closes without adding anything', async () => {
    const { mount, InlinePrefixAdder, usePrefixManager } = await load();
    const { prefixSettings } = usePrefixManager();
    const wrapper = mount(InlinePrefixAdder, { props: { iri: IRI }, attachTo: document.body });

    await wrapper.find('button.prefix-trigger').trigger('click');
    await nextTick();
    document.querySelector<HTMLButtonElement>('.popover-cancel')!.click();
    await nextTick();

    expect(document.querySelector('.prefix-popover')).toBeNull();
    expect(prefixSettings.value.mappings.some((m) => m.namespace === NAMESPACE)).toBe(false);
  });
});
