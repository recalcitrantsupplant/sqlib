/**
 * Term display is one switch for the whole browser.
 *
 * It sat in each column's header menu, which meant a four-column table took
 * four trips into a menu before it read the way you wanted, and the next table
 * started over. The switch is in the results action bar now, between the
 * download button and pop-out, and it writes the same stored flag Settings →
 * Abbreviate IRIs writes — so it holds across tables and across reloads.
 *
 * The radix portal is stubbed so any menu renders inside the wrapper. See
 * RunByTagMenu.test.ts for the same treatment.
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

/** The terms on screen, in the form the tables are currently rendering. */
const cellTerms = (wrapper: VueWrapper) =>
  wrapper
    .findAll('td .term-cell')
    .map((cell) => cell.find('code').text());

describe('term display', () => {
  const initialPrefixSettings = {
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

  it('switches every column at once, from the action bar', async () => {
    const { mount, QueryResultsViewer } = await load();
    const wrapper = mount(QueryResultsViewer, { props: { results }, ...PORTAL_STUB });
    await nextTick();

    expect(cellTerms(wrapper)).toEqual(['ex:Alice', 'foaf:Person']);

    await wrapper.get('[data-testid="term-display-full"]').trigger('click');
    await nextTick();

    expect(cellTerms(wrapper)).toEqual([
      'http://example.org/Alice',
      'http://xmlns.com/foaf/0.1/Person',
    ]);

    await wrapper.get('[data-testid="term-display-prefixed"]').trigger('click');
    await nextTick();

    expect(cellTerms(wrapper)).toEqual(['ex:Alice', 'foaf:Person']);
    wrapper.unmount();
  });

  /* One value, whether it is set from the bar or from Settings. */
  it('is the stored app-wide setting, so a second table opens in the same form', async () => {
    const { mount, QueryResultsViewer, usePrefixManager } = await load();
    const first = mount(QueryResultsViewer, { props: { results }, ...PORTAL_STUB });
    await nextTick();

    await first.get('[data-testid="term-display-full"]').trigger('click');
    await nextTick();
    expect(usePrefixManager().enabled.value).toBe(false);
    first.unmount();

    const second = mount(QueryResultsViewer, { props: { results }, ...PORTAL_STUB });
    await nextTick();
    expect(cellTerms(second)).toEqual([
      'http://example.org/Alice',
      'http://xmlns.com/foaf/0.1/Person',
    ]);
    second.unmount();
  });

  it('shows which form the tables are in', async () => {
    const { mount, QueryResultsViewer } = await load();
    const wrapper = mount(QueryResultsViewer, { props: { results }, ...PORTAL_STUB });
    await nextTick();

    expect(wrapper.get('[data-testid="term-display-prefixed"]').attributes('aria-pressed')).toBe('true');
    expect(wrapper.get('[data-testid="term-display-full"]').attributes('aria-pressed')).toBe('false');

    await wrapper.get('[data-testid="term-display-full"]').trigger('click');
    await nextTick();

    expect(wrapper.get('[data-testid="term-display-full"]').attributes('aria-pressed')).toBe('true');
    wrapper.unmount();
  });

  it('leaves nothing in the column header menus', async () => {
    const { mount, QueryResultsViewer } = await load();
    const wrapper = mount(QueryResultsViewer, { props: { results }, ...PORTAL_STUB });
    await nextTick();

    await wrapper.find('[data-testid="column-menu-s"]').trigger('click');
    await tick();

    expect(wrapper.find('[data-testid="term-display-menu"]').exists()).toBe(false);

    await wrapper.find('[data-testid="column-menu-s"]').trigger('click');
    await tick();
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

  it('switches the N-Triples table too, and its badge copies the full IRI', async () => {
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

    await wrapper.get('[data-testid="term-display-full"]').trigger('click');
    await nextTick();

    expect(cellTerms(wrapper)).toEqual([
      'http://example.org/subject',
      'http://xmlns.com/foaf/0.1/knows',
      'http://example.org/object',
    ]);

    /*
     * The IRI behind an abbreviated cell is not revealed by a hover popover —
     * the type badge copies it, whichever form the cell is showing.
     */
    expect(wrapper.find('[data-testid="term-iri-popover"]').exists()).toBe(false);
    const badge = wrapper.findAll('td .term-cell button').at(0)!;
    await badge.trigger('click');
    expect(mockCopyToClipboard).toHaveBeenCalledWith(
      'http://example.org/subject',
      'Copied IRI to clipboard',
    );

    wrapper.unmount();
    await tick();
  });
});
