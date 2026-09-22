/**
 * One notebook cell.
 *
 * The cell is where the design's two non-negotiables live: the template beside
 * the substituted query (the page's teaching instrument), and "to edit, you
 * leave" — every editing affordance is a link out, never an editor in place.
 *
 * Assertions go through `data-testid` and rendered text, never through styling
 * classes. The first version of this spec asserted on `.run` and `pre`, which
 * meant it passed just as happily on a page whose stylesheet had never loaded —
 * and that is exactly what shipped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { defineArgsElement } from '@sparql-query-lib/runtime/args-element';
import NotebookCell from '@/components/library-notebook/NotebookCell.vue';

// A textarea stands in for the editor, as in CodePeek's own spec: this is about
// which text reaches the panes, not about how CodeMirror paints it.
vi.mock('vue-codemirror', () => ({
  Codemirror: {
    props: ['modelValue'],
    template: '<textarea :value="modelValue"></textarea>',
  },
}));

defineArgsElement();

const TEXT = 'SELECT ?name WHERE { VALUES ?city { UNDEF } ?p :livesIn ?city ; :name ?name }';
const SLOT_START = TEXT.indexOf('VALUES');
const SLOT_END = TEXT.indexOf('}', SLOT_START) + 1;

const PERTH = { type: 'uri', value: 'http://example.org/Perth' } as const;

const TAGS = new Map([
  ['urn:tag:people', { id: 'urn:tag:people', name: 'people', color: '#2159c9', ink: '#ffffff' }],
]);

function query(overrides: Record<string, unknown> = {}) {
  return {
    template: { text: TEXT, slots: [{ start: SLOT_START, end: SLOT_END, vars: ['city'] }], prefixes: [] },
    queryType: 'SELECT',
    limitParameters: [],
    offsetParameters: [],
    inferredInputs: [['city']],
    textHash: 'sha256-unchecked',
    sourceQuery: 'urn:q:people',
    description: 'Everyone in a city.',
    tags: ['urn:tag:people'],
    ...overrides,
  };
}

const RESULT = {
  head: { vars: ['name'] },
  results: { bindings: [{ name: { type: 'literal', value: 'Ada' } }] },
};

const preview = vi.fn(() => ({ text: 'SELECT … substituted', error: null as string | null }));
const execute = vi.fn(async () => ({ ok: true, data: RESULT as unknown }));

function mountCell(props: Record<string, unknown> = {}) {
  return mount(NotebookCell, {
    props: {
      slug: 'people',
      query: query(),
      canWrite: true,
      tagsById: TAGS,
      preview,
      execute,
      ...props,
    },
    global: {
      stubs: {
        NuxtLink: { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' },
        DataTable: {
          props: ['columns', 'data'],
          template: '<div data-testid="stub-table">{{ data.length }}</div>',
        },
      },
      config: { compilerOptions: { isCustomElement: (tag: string) => tag.startsWith('sqlib-') } },
    },
  });
}

/** The text that reached a pane's editor. */
const paneText = (wrapper: ReturnType<typeof mountCell>, testId: string) =>
  (wrapper.get(`[data-testid="${testId}"] textarea`).element as HTMLTextAreaElement).value;

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  preview.mockClear();
  preview.mockReturnValue({ text: 'SELECT … substituted', error: null });
  execute.mockClear();
  execute.mockResolvedValue({ ok: true, data: RESULT });
});

describe('NotebookCell', () => {
  it('renders the template in the author\'s all-UNDEF spelling, not the marker text', () => {
    const wrapper = mountCell();
    expect(paneText(wrapper, 'notebook-template')).toContain('VALUES ?city { UNDEF }');
    wrapper.unmount();
  });

  it('opens on the template, and shows the substituted query only when asked', async () => {
    const wrapper = mountCell();
    await wrapper.vm.$nextTick();
    // One pane, holding the document the toggle names: full width behind
    // whichever is being read, rather than half each for a pair that differs
    // by a line.
    expect(wrapper.find('[data-testid="notebook-substituted"]').exists()).toBe(false);
    await wrapper.get('[data-testid="notebook-view-substituted"]').trigger('click');
    expect(paneText(wrapper, 'notebook-substituted')).toContain('substituted');
    expect(wrapper.find('[data-testid="notebook-template"]').exists()).toBe(false);
    await wrapper.get('[data-testid="notebook-view-template"]').trigger('click');
    expect(paneText(wrapper, 'notebook-template')).toContain('VALUES ?city { UNDEF }');
    wrapper.unmount();
  });

  it('withholds the toggle from a query with nothing to substitute', () => {
    // No slots, no examples, and nothing typed in: the two views would be the
    // same document, and a control that does nothing is worse than no control.
    const wrapper = mountCell({
      query: query({
        template: { text: 'ASK { ?s ?p ?o }', slots: [], prefixes: [] },
        inferredInputs: [],
      }),
    });
    expect(wrapper.find('[data-testid="notebook-view-substituted"]').exists()).toBe(false);
    expect(paneText(wrapper, 'notebook-template')).toContain('ASK');
    wrapper.unmount();
  });

  it('offers the toggle to a query whose only arguments are an example\'s', () => {
    const wrapper = mountCell({
      query: query({
        template: { text: 'ASK { ?s ?p ?o }', slots: [], prefixes: [] },
        inferredInputs: [],
        examples: [{ name: 'any', arguments: [] }],
      }),
    });
    expect(wrapper.find('[data-testid="notebook-view-substituted"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('hands both views to the SPARQL highlighter rather than a bare block', async () => {
    const wrapper = mountCell();
    for (const view of ['template', 'substituted']) {
      await wrapper.get(`[data-testid="notebook-view-${view}"]`).trigger('click');
      const peek = wrapper.get(`[data-testid="notebook-${view}"]`).findComponent({ name: 'CodePeek' });
      expect(peek.props('contentType')).toBe('application/sparql-query');
      // The library is a column of cells: a pane sized to its query makes the
      // page's height a function of which queries happen to be long.
      expect(peek.props('collapsedLines')).toBe(8);
    }
    wrapper.unmount();
  });

  it('hides the prologue in the peek, and says how many it is holding back', () => {
    const prefixed = [
      'PREFIX : <http://example/>',
      'PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>',
      'SELECT ?name WHERE { VALUES ?city { UNDEF } ?p :livesIn ?city ; :name ?name }',
      '# a comment, so the document does not fit whole',
      '# and the prologue is worth hiding',
      '# ---',
      '# ---',
      '# ---',
      '# ---',
    ].join('\n');
    const wrapper = mountCell({
      query: query({ template: { text: prefixed, slots: [], prefixes: [] }, inferredInputs: [] }),
    });
    const template = wrapper.get('[data-testid="notebook-template"]');
    expect(paneText(wrapper, 'notebook-template')).not.toContain('PREFIX rdfs:');
    expect(template.text()).toContain('2 prefixes hidden');
    wrapper.unmount();
  });

  it('opens on a wildcard row, so a cell with no examples is runnable straight away', () => {
    mountCell().unmount();
    // A slot with one empty binding is dropped by the runtime — a slot with one
    // row of empty IRIs would be invalid, and the cell would open red.
    expect(preview).toHaveBeenCalledWith('people', {
      arguments: [{ head: { vars: ['city'] }, arguments: { bindings: [{}] } }],
    });
  });

  it('loads an example into the builder when its chip is pressed', async () => {
    const example = {
      name: 'Perth',
      arguments: [{ head: { vars: ['city'] }, arguments: { bindings: [{ city: PERTH }] } }],
    };
    const wrapper = mountCell({ query: query({ examples: [example] }) });
    preview.mockClear();
    await wrapper.get('[data-testid="notebook-example-0"]').trigger('click');
    expect(preview).toHaveBeenCalledWith('people', { arguments: example.arguments });
    wrapper.unmount();
  });

  it('refuses to run while the substituted query does not fit, and says why in place', async () => {
    preview.mockReturnValue({ text: null, error: 'Required input ?city was empty.' });
    const wrapper = mountCell();
    await wrapper.vm.$nextTick();
    expect(wrapper.get('[data-testid="notebook-run"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="notebook-preview-error"]').text()).toBe(
      'Required input ?city was empty.',
    );
    wrapper.unmount();
  });

  it('ignores a native change bubbling out of the builder\'s own inputs', async () => {
    // `<sqlib-args>` renders its form into its light DOM, so an input losing
    // focus fires a `change` that reaches the same listener with no detail on
    // it. Taken as a payload, it substituted `undefined` and painted the
    // mismatch error over a cell nobody had touched.
    const wrapper = mountCell();
    await wrapper.vm.$nextTick();
    preview.mockClear();
    wrapper.get('sqlib-args').element.dispatchEvent(new Event('change', { bubbles: true }));
    await wrapper.vm.$nextTick();
    expect(preview).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="notebook-preview-error"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('runs through the injected executor and tabulates what comes back', async () => {
    const wrapper = mountCell();
    await wrapper.get('[data-testid="notebook-run"]').trigger('click');
    await settle();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-testid="stub-table"]').text()).toBe('1');
    wrapper.unmount();
  });

  /*
   * The results table follows the same rule as the app's other term tables:
   * one browser-wide switch decides prefixed names or full IRIs, so a cell
   * here reads the same way as the rows in the query panel. The prefixes are
   * the query's own, which is what the exported page abbreviates against.
   */
  it('follows the browser-wide term display switch', async () => {
    const { useTermDisplay } = await import('@/composables/useTermDisplay');
    execute.mockResolvedValue({
      ok: true,
      data: {
        head: { vars: ['city'] },
        results: { bindings: [{ city: { type: 'uri', value: 'http://example.org/Perth' } }] },
      },
    });
    const wrapper = mount(NotebookCell, {
      props: {
        slug: 'people',
        query: query({
          template: { text: TEXT, slots: [], prefixes: [['ex', 'http://example.org/']] },
        }),
        canWrite: true,
        tagsById: TAGS,
        preview,
        execute,
      },
      global: {
        stubs: { NuxtLink: { props: ['to'], template: '<a><slot /></a>' } },
        config: { compilerOptions: { isCustomElement: (tag: string) => tag.startsWith('sqlib-') } },
      },
    });

    await wrapper.get('[data-testid="notebook-run"]').trigger('click');
    await settle();
    expect(wrapper.get('[data-testid="notebook-result"] code').text()).toBe('ex:Perth');

    useTermDisplay().setMode('full');
    await settle();
    expect(wrapper.get('[data-testid="notebook-result"] code').text()).toBe(
      'http://example.org/Perth',
    );

    useTermDisplay().setMode('prefixed');
    wrapper.unmount();
    await settle();
  });

  it('shows a failed run in place, in the transport\'s own words', async () => {
    execute.mockResolvedValueOnce({ ok: false, error: 'Backend refused the query.' } as never);
    const wrapper = mountCell();
    await wrapper.get('[data-testid="notebook-run"]').trigger('click');
    await settle();
    expect(wrapper.get('[data-testid="notebook-run-error"]').text()).toBe('Backend refused the query.');
    wrapper.unmount();
  });

  it('links out to the editor and the tests rather than editing in place', () => {
    const wrapper = mountCell();
    const links = wrapper.findAll('.cell__link').map((link) => link.attributes('data-to') ?? '');
    expect(links.some((to) => to.includes('"section":"queries"'))).toBe(true);
    expect(links.some((to) => to.includes('"section":"tests"'))).toBe(true);
    wrapper.unmount();
  });

  it('names a tag rather than showing its IRI', () => {
    const wrapper = mountCell();
    expect(wrapper.get('.tag-chip').text()).toBe('people');
    wrapper.unmount();
  });

  it('drops a tag the library no longer has instead of rendering its IRI', () => {
    const wrapper = mountCell({ query: query({ tags: ['urn:tag:deleted'] }) });
    expect(wrapper.find('.tag-chip').exists()).toBe(false);
    wrapper.unmount();
  });

  it('hides save-as-test from a viewer who cannot write', async () => {
    const wrapper = mountCell({ canWrite: false });
    await wrapper.get('[data-testid="notebook-run"]').trigger('click');
    await settle();
    expect(wrapper.find('[data-testid="notebook-save-as-test"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('offers save-as-test only once there is a result to record', async () => {
    const wrapper = mountCell();
    expect(wrapper.find('[data-testid="notebook-save-as-test"]').exists()).toBe(false);
    await wrapper.get('[data-testid="notebook-run"]').trigger('click');
    await settle();
    expect(wrapper.find('[data-testid="notebook-save-as-test"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('emits the payload and the result together, which is what a test case is', async () => {
    const wrapper = mountCell();
    await wrapper.get('[data-testid="notebook-run"]').trigger('click');
    await settle();
    await wrapper.get('[data-testid="notebook-save-as-test"]').trigger('click');
    const [emitted] = wrapper.emitted('save-as-test') as Array<[Record<string, unknown>]>;
    expect(emitted[0].slug).toBe('people');
    expect(emitted[0].result).toEqual(RESULT);
    expect(emitted[0].payload).toBeTruthy();
    wrapper.unmount();
  });

  it('labels a data-dependent example as seeded, because its result is not portable', () => {
    const wrapper = mountCell({
      query: query({ examples: [{ name: 'Seeded', arguments: [], dataDependent: true }] }),
    });
    expect(wrapper.get('[data-testid="notebook-example-seeded"]').text()).toBe('seeded');
    wrapper.unmount();
  });

  it('presents recorded results as reference, never as an assertion', () => {
    const wrapper = mountCell({
      query: query({ examples: [{ name: 'Perth', arguments: [], expected: '{"x":1}' }] }),
    });
    expect(wrapper.text()).toContain('reference only, not assertions');
    wrapper.unmount();
  });
});
