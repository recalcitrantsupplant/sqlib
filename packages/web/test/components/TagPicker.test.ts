/**
 * The picker's one non-obvious behaviour: create-on-enter, folded the way the
 * server folds names for uniqueness.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import TagPicker from '@/components/tags/TagPicker.vue';

const TAGS = [
  { id: 'tag:prod', name: 'Production', isPartOf: 'lib:1', color: '#2f6feb' },
  { id: 'tag:geo', name: 'Geo', isPartOf: 'lib:1', color: '#15803d' },
];

function mountPicker(selected: string[] = []) {
  return mount(TagPicker, {
    props: {
      tags: TAGS,
      selected,
      entityName: 'Airports by country',
      counts: { 'tag:prod': 4 },
      nextColor: '#b8603a',
    } as never,
  });
}

describe('TagPicker', () => {
  it('marks the tags the entity already carries', () => {
    const wrapper = mountPicker(['tag:geo']);

    expect(wrapper.find('[data-testid="tag-option-tag:geo"]').attributes('aria-selected')).toBe('true');
    expect(wrapper.find('[data-testid="tag-option-tag:prod"]').attributes('aria-selected')).toBe('false');
    expect(wrapper.find('[data-testid="tag-option-tag:prod"]').text()).toContain('4');
  });

  it('offers to create a name that does not exist, and applies it on enter', async () => {
    const wrapper = mountPicker();

    await wrapper.find('[data-testid="tag-picker-search"]').setValue('airport');
    expect(wrapper.find('[data-testid="tag-picker-create"]').text()).toContain('Create “airport”');

    await wrapper.find('[data-testid="tag-picker-search"]').trigger('keydown.enter');
    expect(wrapper.emitted('create')?.[0]).toEqual(['airport']);
  });

  it('offers the existing tag rather than a clash the server would reject', async () => {
    const wrapper = mountPicker();

    await wrapper.find('[data-testid="tag-picker-search"]').setValue('geo');
    expect(wrapper.find('[data-testid="tag-picker-create"]').exists()).toBe(false);

    await wrapper.find('[data-testid="tag-picker-search"]').trigger('keydown.enter');
    expect(wrapper.emitted('toggle')?.[0]).toEqual(['tag:geo']);
    expect(wrapper.emitted('create')).toBeUndefined();
  });

  it('toggles a tag off when it is already applied', async () => {
    const wrapper = mountPicker(['tag:prod']);

    await wrapper.find('[data-testid="tag-option-tag:prod"]').trigger('click');
    expect(wrapper.emitted('toggle')?.[0]).toEqual(['tag:prod']);
  });
});
