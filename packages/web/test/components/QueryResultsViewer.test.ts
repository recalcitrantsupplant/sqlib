import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';
import type { SparqlBindingValue } from '@sparql-query-lib/types';

// Mock localStorage for usePrefixManager / useSettings
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
    for (const key in mockLocalStorage) {
      delete mockLocalStorage[key];
    }
  }),
});

// Mock useCopyToClipboard
const mockCopyToClipboard = vi.fn();
vi.mock('@/composables/useCopyToClipboard', () => ({
  useCopyToClipboard: () => ({
    copyToClipboard: mockCopyToClipboard,
  }),
}));

// The prefix manager keeps module-level singleton state guarded by an
// `initialized` flag. Reset the module registry before each test and
// dynamically import both the component and the composable so each test starts
// from a fresh singleton that re-reads localStorage.
async function loadComponent() {
  const { mount } = await import('@vue/test-utils');
  const { default: QueryResultsViewer } = await import('@/components/QueryResultsViewer.vue');
  const { usePrefixManager } = await import('@/composables/usePrefixManager');
  return { mount, QueryResultsViewer, usePrefixManager };
}

describe('QueryResultsViewer', () => {
  // `foaf` and `xsd` come from the merged DEFAULT_PREFIXES, so we only need to
  // seed the user-added `ex` prefix. (The old fixture supplied foaf/xsd with
  // fabricated ids that collided by namespace with the merged defaults and were
  // dropped during duplicate resolution.) `enabled` is now managed by
  // useSettings and defaults to true, so it is not part of these settings.
  const initialPrefixSettings = {
    showTooltips: true,
    duplicateResolution: 'longest',
    mappings: [
      { id: 'ex1', prefix: 'ex', namespace: 'http://example.org/', enabled: true, isDefault: false, source: 'user-added', createdAt: Date.now() },
    ],
  };

  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    localStorage.setItem('sparqlQueryLib.prefixSettings', JSON.stringify(initialPrefixSettings));
    vi.clearAllMocks();
  });

  it('should abbreviate IRIs in table cells when enabled', async () => {
    const { mount, QueryResultsViewer } = await loadComponent();
    const results = {
      head: { vars: ['person', 'name'] },
      results: {
        bindings: [
          {
            person: { type: 'uri', value: 'http://xmlns.com/foaf/0.1/Person' },
            name: { type: 'literal', value: 'John Doe' },
          },
          {
            person: { type: 'uri', value: 'http://example.org/Alice' },
            name: { type: 'literal', value: 'Alice' },
          },
        ],
      },
    };

    const wrapper = mount(QueryResultsViewer, { props: { results } });
    await nextTick();

    // Check foaf:Person
    expect(wrapper.html()).toContain('foaf:Person');
    // Check ex:Alice
    expect(wrapper.html()).toContain('ex:Alice');
  });

  it('reveals the full IRI in the cell popover, with a copy button', async () => {
    const { mount, QueryResultsViewer } = await loadComponent();
    const results = {
      head: { vars: ['person'] },
      results: {
        bindings: [
          {
            person: { type: 'uri', value: 'http://xmlns.com/foaf/0.1/Person' },
          },
        ],
      },
    };

    const wrapper = mount(QueryResultsViewer, { props: { results } });
    await nextTick();

    const popover = wrapper.find('[data-testid="term-iri-popover"]');
    expect(popover.exists()).toBe(true);
    expect(popover.find('code').text()).toBe('http://xmlns.com/foaf/0.1/Person');

    await popover.find('button').trigger('click');
    expect(mockCopyToClipboard).toHaveBeenCalledWith(
      'http://xmlns.com/foaf/0.1/Person',
      'Copied IRI to clipboard',
    );
  });

  it('should not abbreviate IRIs when prefix manager is globally disabled', async () => {
    const { mount, QueryResultsViewer, usePrefixManager } = await loadComponent();
    // Disable prefix abbreviation before mounting (component seeds its local
    // toggle from the global enabled value at setup time).
    const { enabled } = usePrefixManager();
    enabled.value = false;
    await nextTick();

    const results = {
      head: { vars: ['person'] },
      results: {
        bindings: [
          {
            person: { type: 'uri', value: 'http://xmlns.com/foaf/0.1/Person' },
          },
        ],
      },
    };

    const wrapper = mount(QueryResultsViewer, { props: { results } });
    await nextTick();

    expect(wrapper.html()).toContain('http://xmlns.com/foaf/0.1/Person');
    expect(wrapper.html()).not.toContain('foaf:Person');
  });

  it('should copy full IRI to clipboard, not abbreviated form', async () => {
    const { mount, QueryResultsViewer } = await loadComponent();
    const results = {
      head: { vars: ['person'] },
      results: {
        bindings: [
          {
            person: { type: 'uri', value: 'http://xmlns.com/foaf/0.1/Person' },
          },
        ],
      },
    };

    const wrapper = mount(QueryResultsViewer, { props: { results } });
    await nextTick();

    const copyButton = wrapper.find('button[title="Copy IRI to clipboard"]');
    expect(copyButton.exists()).toBe(true);

    await copyButton.trigger('click');

    expect(mockCopyToClipboard).toHaveBeenCalledWith(
      'http://xmlns.com/foaf/0.1/Person',
      'Copied IRI to clipboard',
    );
  });

  it('should abbreviate datatype IRIs when enabled', async () => {
    const { mount, QueryResultsViewer } = await loadComponent();
    const results = {
      head: { vars: ['value'] },
      results: {
        bindings: [
          {
            value: {
              type: 'literal',
              value: '42',
              datatype: 'http://www.w3.org/2001/XMLSchema#integer',
            },
          },
        ],
      },
    };

    const wrapper = mount(QueryResultsViewer, { props: { results } });
    await nextTick();

    // Ensure xsd:integer is displayed
    expect(wrapper.html()).toContain('xsd:integer');
  });

  it('should fallback to hardcoded xsd: abbreviation if prefix manager is disabled', async () => {
    const { mount, QueryResultsViewer, usePrefixManager } = await loadComponent();
    const { enabled } = usePrefixManager();
    enabled.value = false;
    await nextTick();

    const results = {
      head: { vars: ['value'] },
      results: {
        bindings: [
          {
            value: {
              type: 'literal',
              value: 'true',
              datatype: 'http://www.w3.org/2001/XMLSchema#boolean',
            },
          },
        ],
      },
    };

    const wrapper = mount(QueryResultsViewer, { props: { results } });
    await nextTick();

    // Still expect xsd:boolean even if prefix manager is disabled because of fallback logic
    expect(wrapper.html()).toContain('xsd:boolean');
  });

  it('should abbreviate IRIs in tabular (N-Triples/N-Quads/CSV/TSV) results', async () => {
    const { mount, QueryResultsViewer } = await loadComponent();
    // Simulate an N-Triples response with an IRI that can be abbreviated
    const rawContent = '<http://example.org/subject> <http://xmlns.com/foaf/0.1/knows> <http://example.org/object> .';
    const contentType = 'application/n-triples';

    const wrapper = mount(QueryResultsViewer, { props: { rawContent, contentType } });
    await nextTick();

    // Wait for internal component rendering if necessary, then check HTML
    // This might require multiple nextTick() calls depending on DataTable's internal reactivity
    await nextTick();
    await nextTick();

    expect(wrapper.html()).toContain('foaf:knows');
    expect(wrapper.html()).toContain('ex:subject'); // ex: is a user-added prefix for example.org
    expect(wrapper.html()).toContain('ex:object');

    // The full IRI is one hover away
    const popovers = wrapper.findAll('[data-testid="term-iri-popover"] code');
    expect(popovers.map((c) => c.text())).toContain('http://xmlns.com/foaf/0.1/knows');
  });

  it('should handle unknown binding types gracefully in renderCell', async () => {
    const { mount, QueryResultsViewer } = await loadComponent();
    const unknownBinding: SparqlBindingValue = { type: 'unknown', value: 'someValue' };
    const results = {
      head: { vars: ['test'] },
      results: { bindings: [{ test: unknownBinding }] },
    };

    const wrapper = mount(QueryResultsViewer, { props: { results } });
    await nextTick();

    // Should display the value and the raw type label (rendered lowercase in the
    // DOM; the badge is uppercased purely via CSS text-transform).
    expect(wrapper.html()).toContain('someValue');
    expect(wrapper.html()).toContain('unknown'); // Default typeLabel for unknown
  });

  it('should not show the IRI popover when prefixSettings.showTooltips is false', async () => {
    const { mount, QueryResultsViewer, usePrefixManager } = await loadComponent();
    const { prefixSettings } = usePrefixManager();
    prefixSettings.value.showTooltips = false; // Disable tooltips
    await nextTick();

    const results = {
      head: { vars: ['person'] },
      results: {
        bindings: [
          {
            person: { type: 'uri', value: 'http://xmlns.com/foaf/0.1/Person' },
          },
        ],
      },
    };

    const wrapper = mount(QueryResultsViewer, { props: { results } });
    await nextTick();

    // Expect abbreviation, but nothing revealing the IRI on hover
    const abbreviatedIriElement = wrapper.find('code');
    expect(abbreviatedIriElement.exists()).toBe(true);
    expect(abbreviatedIriElement.text()).toContain('foaf:Person');
    expect(wrapper.find('[data-testid="term-iri-popover"]').exists()).toBe(false);
  });
  /*
   * Adding a prefix has to reach tables that are already on screen.
   *
   * Every cell is its own `FlexRender` component, so each one only re-renders
   * when a ref *it* read during its last render changes. `abbreviateIri`
   * memoizes by IRI, so the second and later cells showing the same IRI used to
   * return from the memo without touching a single reactive value — they
   * tracked nothing, and stayed on the full IRI after a prefix was added while
   * the first cell updated. Hence two rows carrying the same IRI here: one
   * updating and one not is exactly the bug.
   */
  it('re-renders already displayed cells when a prefix is added', async () => {
    const { mount, QueryResultsViewer, usePrefixManager } = await loadComponent();
    const results = {
      head: { vars: ['thing'] },
      results: {
        bindings: [
          { thing: { type: 'uri', value: 'http://vocab.example.com/Widget' } },
          { thing: { type: 'uri', value: 'http://vocab.example.com/Widget' } },
        ],
      },
    };

    const wrapper = mount(QueryResultsViewer, { props: { results } });
    await nextTick();

    // No mapping covers this namespace yet, so both cells show the full IRI.
    expect(wrapper.html()).not.toContain('vocab:Widget');

    const { addPrefix } = usePrefixManager();
    addPrefix('vocab', 'http://vocab.example.com/', 'user-added');
    await nextTick();

    const cells = wrapper.findAll('td code');
    const abbreviated = cells.filter((c) => c.text() === 'vocab:Widget');
    expect(abbreviated.length).toBe(2);
    // The full IRI survives only in each cell's hover popover.
    expect(
      wrapper
        .findAll('[data-testid="term-iri-popover"] code')
        .filter((c) => c.text() === 'http://vocab.example.com/Widget').length,
    ).toBe(2);
  });

  it('re-renders already displayed cells when a prefix is removed', async () => {
    const { mount, QueryResultsViewer, usePrefixManager } = await loadComponent();
    const results = {
      head: { vars: ['person'] },
      results: {
        bindings: [
          { person: { type: 'uri', value: 'http://example.org/Alice' } },
          { person: { type: 'uri', value: 'http://example.org/Alice' } },
        ],
      },
    };

    const wrapper = mount(QueryResultsViewer, { props: { results } });
    await nextTick();
    expect(wrapper.findAll('td code').filter((c) => c.text() === 'ex:Alice').length).toBe(2);

    const { prefixSettings, removePrefix } = usePrefixManager();
    const ex = prefixSettings.value.mappings.find((m) => m.prefix === 'ex')!;
    removePrefix(ex.id);
    await nextTick();

    const cells = wrapper.findAll('td code');
    expect(cells.filter((c) => c.text() === 'http://example.org/Alice').length).toBe(2);
  });

  // The tabular (N-Triples/N-Quads/CSV/TSV) path renders through the shared
  // `RdfTermTable`, which memoizes the same way; it has to follow a prefix
  // change too. Both triples below carry the same predicate, so this fails the
  // same way an un-subscribed memo hit does.
  it('re-renders tabular results when a prefix is added', async () => {
    const { mount, QueryResultsViewer, usePrefixManager } = await loadComponent();
    const rawContent = [
      '<http://vocab.example.com/s1> <http://vocab.example.com/knows> <http://example.org/o> .',
      '<http://vocab.example.com/s2> <http://vocab.example.com/knows> <http://example.org/o> .',
    ].join('\n');

    const wrapper = mount(QueryResultsViewer, {
      props: { rawContent, contentType: 'application/n-triples' },
    });
    await nextTick();
    await nextTick();
    expect(wrapper.html()).not.toContain('vocab:knows');

    const { addPrefix } = usePrefixManager();
    addPrefix('vocab', 'http://vocab.example.com/', 'user-added');
    await nextTick();

    const cells = wrapper.findAll('td code');
    expect(cells.filter((c) => c.text() === 'vocab:knows').length).toBe(2);
  });

  it('offers an inline prefix adder only for IRIs abbreviation left alone', async () => {
    const { mount, QueryResultsViewer } = await loadComponent();
    const results = {
      head: { vars: ['known', 'unknown'] },
      results: {
        bindings: [
          {
            // foaf: is a default mapping, so this one is already abbreviated.
            known: { type: 'uri', value: 'http://xmlns.com/foaf/0.1/Person' },
            unknown: {
              type: 'uri',
              value: 'https://linked.data.gov.au/def/geoscience-commodities-wa/gold',
            },
          },
        ],
      },
    };

    const wrapper = mount(QueryResultsViewer, { props: { results } });
    await nextTick();

    const triggers = wrapper.findAll('button.prefix-trigger');
    expect(triggers).toHaveLength(1);
    expect(triggers[0].attributes().title).toBe(
      'Add a prefix for https://linked.data.gov.au/def/geoscience-commodities-wa/',
    );
  });

  it('adding a prefix from a row abbreviates that row', async () => {
    const { mount, QueryResultsViewer } = await loadComponent();
    const results = {
      head: { vars: ['commodity'] },
      results: {
        bindings: [
          {
            commodity: {
              type: 'uri',
              value: 'https://linked.data.gov.au/def/geoscience-commodities-wa/gold',
            },
          },
        ],
      },
    };

    const wrapper = mount(QueryResultsViewer, { props: { results }, attachTo: document.body });
    await nextTick();

    await wrapper.find('button.prefix-trigger').trigger('click');
    await nextTick();

    const input = document.querySelector<HTMLInputElement>('#inline-prefix-input')!;
    input.value = 'gswa-comm';
    input.dispatchEvent(new Event('input'));
    await nextTick();

    document.querySelector<HTMLButtonElement>('.popover-add')!.click();
    await nextTick();
    await nextTick();

    expect(wrapper.html()).toContain('gswa-comm:gold');
    expect(wrapper.find('button.prefix-trigger').exists()).toBe(false);
  });

  /*
   * Issue #52. `showTooltips` was read by the renderer but declared nowhere and
   * set by no constructor, so it only ever held a value for users whose
   * localStorage still carried the key from an older build. The tests above all
   * seed it, so they passed while a *fresh* install abbreviated `foaf:Person`
   * with no way to see the IRI behind it and no setting to turn it back on.
   * This is the case they were missing: no stored settings at all.
   */
  it('shows the full IRI on a fresh install, with nothing in localStorage', async () => {
    localStorage.clear();

    const { mount, QueryResultsViewer, usePrefixManager } = await loadComponent();
    expect(usePrefixManager().prefixSettings.value.showTooltips).toBe(true);

    const results = {
      head: { vars: ['person'] },
      results: {
        bindings: [
          {
            person: { type: 'uri', value: 'http://xmlns.com/foaf/0.1/Person' },
          },
        ],
      },
    };

    const wrapper = mount(QueryResultsViewer, { props: { results } });
    await nextTick();

    const abbreviated = wrapper.find('code');
    expect(abbreviated.text()).toContain('foaf:Person');
    expect(wrapper.find('[data-testid="term-iri-popover"] code').text()).toBe(
      'http://xmlns.com/foaf/0.1/Person',
    );
  });

  // Settings written before `showTooltips` existed must not read back as "off".
  it('defaults the tooltip on for settings stored without the key', async () => {
    localStorage.setItem('sparqlQueryLib.prefixSettings', JSON.stringify({
      duplicateResolution: 'longest',
      mappings: initialPrefixSettings.mappings,
    }));

    const { usePrefixManager } = await loadComponent();
    expect(usePrefixManager().prefixSettings.value.showTooltips).toBe(true);
  });
});
