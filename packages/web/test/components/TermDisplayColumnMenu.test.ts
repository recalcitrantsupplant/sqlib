/**
 * Term display is a column property, not a table-wide mode.
 *
 * There is no toolbar control any more: a result table renders prefixed names
 * and a reader who wants the IRIs asks for them in the header menu of the one
 * column they care about — which is the point, since `s` and `p` stay narrow
 * while `o` goes long. These tests drive that menu on both tables that render
 * RDF terms: the SPARQL bindings grid and `RdfTermTable`.
 *
 * The radix portal is stubbed so the menu renders inside the wrapper, and an
 * open menu is closed before unmount (radix schedules its teardown, and
 * unmounting an open layer leaves that work to run after the environment is
 * gone). See RunByTagMenu.test.ts for the same treatment.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';
import type { VueWrapper } from '@vue/test-utils';

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

const mockCopyToClipboard = vi.fn();
vi.mock('@/composables/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({ copyToClipboard: mockCopyToClipboard }),
}));

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const PORTAL_STUB = {
  global: { stubs: { DropdownMenuPortal: { template: '<div><slot /></div>' } } },
};

async function load() {
  const { mount } = await import('@vue/test-utils');
  const { default: QueryResultsViewer } = await import('@/components/QueryResultsViewer.vue');
  const { usePrefixManager } = await import('@/composables/usePrefixManager');
  return { mount, QueryResultsViewer, usePrefixManager };
}

const openMenu = async (wrapper: VueWrapper, columnId: string) => {
  await wrapper.find(`[data-testid="column-menu-${columnId}"]`).trigger('click');
  await tick();
};

const closeMenus = async (wrapper: VueWrapper) => {
  for (const trigger of wrapper.findAll('[data-testid^="column-menu-"]')) {
    if (trigger.attributes('aria-expanded') === 'true') {
      await trigger.trigger('click');
      await tick();
    }
  }
};

/** The abbreviated terms on screen, ignoring what the hover popovers carry. */
const cellTerms = (wrapper: VueWrapper) =>
  wrapper
    .findAll('td .term-cell')
    .map((cell) => cell.find('code').text());

describe('per-column term display', () => {
  const initialPrefixSettings = {
    showTooltips: true,
    duplicateResolution: 'longest',
    mappings: [
      {
        id: 'ex1',
        prefix: 'ex',
        namespace: 'http://example.org/',
        enabled: true,
        isDefault: false,
        source: 'user-added',
        createdAt: Date.now(),
      },
    ],
  };

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    localStorage.setItem('sparqlQueryLib.prefixSettings', JSON.stringify(initialPrefixSettings));
    vi.clearAllMocks();
  });

  const results = {
    head: { vars: ['s', 'o'] },
    results: {
      bindings: [
        {
          s: { type: 'uri', value: 'http://example.org/Alice' },
          o: { type: 'uri', value: 'http://xmlns.com/foaf/0.1/Person' },
        },
      ],
    },
  };

  it('has no table-wide display control left in the toolbar', async () => {
    const { mount, QueryResultsViewer } = await load();
    const wrapper = mount(QueryResultsViewer, { props: { results }, ...PORTAL_STUB });
    await nextTick();

    expect(wrapper.find('.iri-curie-switcher').exists()).toBe(false);
    wrapper.unmount();
  });

  it('switches one column to full IRIs and leaves the others prefixed', async () => {
    const { mount, QueryResultsViewer } = await load();
    const wrapper = mount(QueryResultsViewer, { props: { results }, ...PORTAL_STUB });
    await nextTick();

    expect(cellTerms(wrapper)).toEqual(['ex:Alice', 'foaf:Person']);

    await openMenu(wrapper, 's');
    await wrapper.find('[data-testid="term-display-full"]').trigger('click');
    await nextTick();

    expect(cellTerms(wrapper)).toEqual(['http://example.org/Alice', 'foaf:Person']);

    await closeMenus(wrapper);
    wrapper.unmount();
    await tick();
  });

  it('applies one column\'s choice to every column on request', async () => {
    const { mount, QueryResultsViewer } = await load();
    const wrapper = mount(QueryResultsViewer, { props: { results }, ...PORTAL_STUB });
    await nextTick();

    await openMenu(wrapper, 's');
    await wrapper.find('[data-testid="term-display-full"]').trigger('click');
    await nextTick();
    await openMenu(wrapper, 's');
    await wrapper.find('[data-testid="term-display-apply-all"]').trigger('click');
    await nextTick();

    expect(cellTerms(wrapper)).toEqual([
      'http://example.org/Alice',
      'http://xmlns.com/foaf/0.1/Person',
    ]);

    await closeMenus(wrapper);
    wrapper.unmount();
    await tick();
  });

  /*
   * The app-wide "Abbreviate IRIs" setting is the *default* a column follows,
   * so a column switched back to prefixed names has to abbreviate even with
   * the setting off — which is why `abbreviateIri` no longer reads it.
   */
  it('lets a column ask for prefixed names while the app default is full IRIs', async () => {
    const { mount, QueryResultsViewer, usePrefixManager } = await load();
    usePrefixManager().enabled.value = false;
    await nextTick();

    const wrapper = mount(QueryResultsViewer, { props: { results }, ...PORTAL_STUB });
    await nextTick();

    expect(cellTerms(wrapper)).toEqual([
      'http://example.org/Alice',
      'http://xmlns.com/foaf/0.1/Person',
    ]);

    await openMenu(wrapper, 'o');
    await wrapper.find('[data-testid="term-display-prefixed"]').trigger('click');
    await nextTick();

    expect(cellTerms(wrapper)).toEqual(['http://example.org/Alice', 'foaf:Person']);

    await closeMenus(wrapper);
    wrapper.unmount();
    await tick();
  });

  it('gives the row-number gutter no menu of its own', async () => {
    const { mount, QueryResultsViewer } = await load();
    const wrapper = mount(QueryResultsViewer, { props: { results }, ...PORTAL_STUB });
    await nextTick();

    expect(wrapper.find('[data-testid="column-menu-row-number"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('offers the same menu on the N-Triples table, with a copyable full IRI', async () => {
    const { mount, QueryResultsViewer } = await load();
    const wrapper = mount(QueryResultsViewer, {
      props: {
        rawContent:
          '<http://example.org/subject> <http://xmlns.com/foaf/0.1/knows> <http://example.org/object> .',
        contentType: 'application/n-triples',
      },
      ...PORTAL_STUB,
    });
    await nextTick();
    await nextTick();

    expect(cellTerms(wrapper)).toEqual(['ex:subject', 'foaf:knows', 'ex:object']);

    await openMenu(wrapper, 'p');
    await wrapper.find('[data-testid="term-display-full"]').trigger('click');
    await nextTick();

    expect(cellTerms(wrapper)).toEqual([
      'ex:subject',
      'http://xmlns.com/foaf/0.1/knows',
      'ex:object',
    ]);

    // The copy button in a still-abbreviated cell's popover yields the full IRI.
    const popover = wrapper.find('[data-testid="term-iri-popover"]');
    expect(popover.find('code').text()).toBe('http://example.org/subject');
    await popover.find('button').trigger('click');
    expect(mockCopyToClipboard).toHaveBeenCalledWith(
      'http://example.org/subject',
      'Copied IRI to clipboard',
    );

    await closeMenus(wrapper);
    wrapper.unmount();
    await tick();
  });
});
