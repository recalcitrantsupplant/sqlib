import { describe, it, expect, vi } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import InlineField from '@/components/backends/InlineField.vue';

function mountField(props: Partial<InstanceType<typeof InlineField>['$props']> = {}) {
  return mount(InlineField, {
    props: {
      modelValue: 'https://query.wikidata.org/sparql',
      label: 'Endpoint URL',
      commit: vi.fn(() => null),
      testId: 'field',
      ...props,
    } as never,
  });
}

describe('InlineField', () => {
  it('rests as text and turns into an input on click', async () => {
    const wrapper = mountField();

    expect(wrapper.find('input').exists()).toBe(false);
    expect(wrapper.text()).toContain('https://query.wikidata.org/sparql');

    await wrapper.find('[data-testid="field"]').trigger('click');

    expect(wrapper.find('input').element.value).toBe('https://query.wikidata.org/sparql');
  });

  it('commits on Enter and closes', async () => {
    const commit = vi.fn(() => null);
    const wrapper = mountField({ commit });

    await wrapper.find('[data-testid="field"]').trigger('click');
    await wrapper.find('input').setValue('https://example.org/sparql');
    await wrapper.find('input').trigger('keydown.enter');
    await nextTick();

    expect(commit).toHaveBeenCalledWith('https://example.org/sparql');
    expect(wrapper.find('input').exists()).toBe(false);
  });

  it('commits on blur', async () => {
    const commit = vi.fn(() => null);
    const wrapper = mountField({ commit });

    await wrapper.find('[data-testid="field"]').trigger('click');
    await wrapper.find('input').setValue('https://example.org/sparql');
    await wrapper.find('input').trigger('blur');
    await nextTick();

    expect(commit).toHaveBeenCalledWith('https://example.org/sparql');
  });

  it('reverts on Escape without committing', async () => {
    const commit = vi.fn(() => null);
    const wrapper = mountField({ commit });

    await wrapper.find('[data-testid="field"]').trigger('click');
    await wrapper.find('input').setValue('nonsense');
    await wrapper.find('input').trigger('keydown.esc');

    expect(commit).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain('https://query.wikidata.org/sparql');
  });

  it('does not commit the blur that Escape itself causes', async () => {
    // A real browser fires blur when the focused input unmounts, which is
    // exactly what Escape does — the e2e run caught this, jsdom did not.
    const commit = vi.fn(() => null);
    const wrapper = mountField({ commit });

    await wrapper.find('[data-testid="field"]').trigger('click');
    const input = wrapper.find('input');
    await input.setValue('abandoned');
    await input.trigger('keydown.esc');
    await input.trigger('blur');
    await nextTick();

    expect(commit).not.toHaveBeenCalled();
  });

  it('does not call the commit handler when nothing changed', async () => {
    const commit = vi.fn(() => null);
    const wrapper = mountField({ commit });

    await wrapper.find('[data-testid="field"]').trigger('click');
    await wrapper.find('input').trigger('keydown.enter');

    expect(commit).not.toHaveBeenCalled();
  });

  it('stays open with the message when the commit is rejected, leaving the saved value live', async () => {
    const commit = vi.fn(() => 'Include a scheme, e.g. https://');
    const wrapper = mountField({ commit });

    await wrapper.find('[data-testid="field"]').trigger('click');
    await wrapper.find('input').setValue('localhost:7878/sparql');
    await wrapper.find('input').trigger('keydown.enter');
    await nextTick();

    expect(wrapper.find('[data-testid="field-error"]').text()).toBe('Include a scheme, e.g. https://');
    expect(wrapper.find('input').exists()).toBe(true);
    expect(wrapper.props('modelValue')).toBe('https://query.wikidata.org/sparql');
  });

  it('does not commit on blur while it is showing an error', async () => {
    const commit = vi.fn(() => 'Nope');
    const wrapper = mountField({ commit });

    await wrapper.find('[data-testid="field"]').trigger('click');
    await wrapper.find('input').setValue('bad');
    await wrapper.find('input').trigger('keydown.enter');
    await nextTick();
    await wrapper.find('input').trigger('blur');
    await nextTick();

    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('gives a multiline field explicit Save and Cancel instead of Enter', async () => {
    const commit = vi.fn(() => null);
    const wrapper = mountField({ modelValue: 'A description', multiline: true, commit });

    await wrapper.find('[data-testid="field"]').trigger('click');
    expect(wrapper.find('textarea').exists()).toBe(true);

    await wrapper.find('textarea').setValue('Two\nlines');
    const [save] = wrapper.findAll('.inline-field__action');
    await save.trigger('click');
    await nextTick();

    expect(commit).toHaveBeenCalledWith('Two\nlines');
  });

  it('is inert when read-only — no pencil, no editing', async () => {
    const wrapper = mountField({ readonly: true });

    expect(wrapper.find('[data-testid="field"]').attributes('disabled')).toBeDefined();
    await wrapper.find('[data-testid="field"]').trigger('click');
    expect(wrapper.find('input').exists()).toBe(false);
  });

  it('shows the empty text when there is no value', () => {
    const wrapper = mountField({ modelValue: '', emptyText: 'No description' });
    expect(wrapper.text()).toContain('No description');
  });
});
