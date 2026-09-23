/**
 * A prose cell.
 *
 * The rendered half goes through `v-html`, so the spec that matters most is the
 * one asserting that cell source cannot produce an element the renderer did not
 * write.
 */
import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';

// A textarea stands in for CodeMirror, as CodePeek's own spec does it: this is
// about which text reaches the cell, not about how CodeMirror paints it.
vi.mock('vue-codemirror', () => ({
  Codemirror: {
    props: ['modelValue'],
    emits: ['update:modelValue'],
    template:
      '<textarea :value="modelValue" @input="$emit(\'update:modelValue\', $event.target.value)"></textarea>',
  },
}));

import NotebookMarkdownCell from '@/components/notebook/NotebookMarkdownCell.vue';

function render(source: string) {
  return mount(NotebookMarkdownCell, { props: { cell: { kind: 'markdown', id: 'md1', source }, index: 1 } });
}

describe('markdown cell', () => {
  it('renders the prose rather than an editor once it has content', () => {
    const wrapper = render('## Candidates');
    expect(wrapper.get('[data-testid="notebook-md-rendered-md1"]').html()).toContain('<h2>Candidates</h2>');
    expect(wrapper.find('[data-testid="notebook-md-editor-md1"]').exists()).toBe(false);
  });

  it('opens in the editor when it is empty, because there is nothing to read', () => {
    expect(render('').find('[data-testid="notebook-md-editor-md1"]').exists()).toBe(true);
  });

  it('renders no element the source asked for', () => {
    const wrapper = render('<script>alert(1)</script>');
    expect(wrapper.get('[data-testid="notebook-md-rendered-md1"]').html()).not.toContain('<script>');
  });

  it('emits the edited source', async () => {
    const wrapper = render('');
    await wrapper.get('[data-testid="notebook-md-editor-md1"] textarea').setValue('# Written');
    expect(wrapper.emitted('update')?.[0]).toEqual(['# Written']);
  });

  /*
   * The editor is the app's own CodeEditor rather than a textarea: prose has
   * headings to weight and code spans to tint, and asking for it by media type
   * is how every other document in the app gets its language.
   */
  it('types prose into the shared editor, as markdown', () => {
    const wrapper = render('');
    expect(wrapper.findComponent({ name: 'CodeEditor' }).props('contentType')).toBe('text/markdown');
  });
});
