/**
 * A prose cell.
 *
 * The rendered half goes through `v-html`, so the spec that matters most is the
 * one asserting that cell source cannot produce an element the renderer did not
 * write.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
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
    await wrapper.get('[data-testid="notebook-md-editor-md1"]').setValue('# Written');
    expect(wrapper.emitted('update')?.[0]).toEqual(['# Written']);
  });
});
