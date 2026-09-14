import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import InputPreview from '@/components/shared/InputPreview.vue';

// The preview is a CodeMirror instance; what this spec is about is which text
// reaches it, so a textarea stands in.
vi.mock('vue-codemirror', () => ({
  Codemirror: {
    props: ['modelValue'],
    template: '<textarea :value="modelValue"></textarea>',
  },
}));

const body = (preview: ReturnType<typeof mount>) =>
  (preview.get('textarea').element as HTMLTextAreaElement).value;

describe('InputPreview', () => {
  it('shows the first lines of the input, without a second click', () => {
    const preview = mount(InputPreview, {
      props: { label: 'Data graph', content: ':a :edge :b .', meta: 'text/turtle · v1' },
    });
    expect(preview.text()).toContain('Data graph');
    expect(preview.text()).toContain('text/turtle');
    expect(body(preview)).toBe(':a :edge :b .');
  });

  it('renders nothing at all when there is no content and nothing to say', () => {
    const preview = mount(InputPreview, { props: { label: 'Data graph', content: '' } });
    expect(preview.find('textarea').exists()).toBe(false);
    expect(preview.text()).toBe('');
  });

  it('says so when there is no content and a reason was given', () => {
    const preview = mount(InputPreview, {
      props: { label: 'Data graph', content: '', empty: 'None chosen' },
    });
    expect(preview.text()).toBe('None chosen');
  });

  it('drops the prologue from the peek, and says it did', () => {
    const graph = [':a :edge :b .', ':b :edge :c .', ':c :edge :d .', ':d :edge :e .', ':e :edge :f .'];
    const preview = mount(InputPreview, {
      props: {
        label: 'Data graph',
        content: ['@prefix : <http://example/> .', '@prefix ex: <http://ex/> .', '', ...graph].join('\n'),
      },
    });
    // The two directives say nothing about what this graph *is*, and the blank
    // line they left goes with them. A graph short enough to fit whole keeps
    // them — there is no room to save there, so nothing is bought by hiding
    // them.
    expect(body(preview)).toBe(graph.join('\n'));
    expect(preview.text()).toContain('2 prefixes hidden');
  });

  it('hands over the whole document once it is expanded', async () => {
    const content = '@prefix : <http://example/> .\n:a :edge :b .';
    const preview = mount(InputPreview, { props: { label: 'Data graph', content } });
    await preview.get('[aria-expanded="false"]').trigger('click');
    // The prefixes are part of the document, and a reader who opened it wants
    // it whole.
    expect(body(preview)).toBe(content);
  });

  it('says nothing about hiding when the peek is already showing everything', () => {
    const preview = mount(InputPreview, {
      props: { label: 'Small', content: 'one\ntwo', collapsedLines: 5 },
    });
    expect(preview.text()).not.toContain('hidden');
    expect(preview.text()).not.toContain('click to expand');
  });
});
