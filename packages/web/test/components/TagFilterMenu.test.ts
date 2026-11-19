/**
 * The tag filter menu: search over many tags, the chosen tags first, and 50
 * rows drawn at a time.
 *
 * The popover portal is stubbed so the menu renders inside the wrapper.
 */
import { afterEach, describe, it, expect } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import TagFilterMenu from '@/components/tags/TagFilterMenu.vue';
import TagFilterChips from '@/components/tags/TagFilterChips.vue';
import { matchesTagFilter, normalizeTagFilter, tagFilterParams } from '@/lib/tagFilter';

const TAGS = [
  { id: 't:water', name: 'water', color: '#2f6feb' },
  { id: 't:geo', name: 'geo', color: '#0d7676' },
  { id: 't:wastewater', name: 'wastewater', color: '#b8603a' },
  { id: 't:unused', name: 'unused', color: '#6b3a7a' },
];
const COUNTS = { 't:water': 3, 't:geo': 9, 't:wastewater': 1 };

let wrapper: VueWrapper | null = null;
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function openMenu(props: Record<string, unknown> = {}) {
  wrapper = mount(TagFilterMenu, {
    props: { tags: TAGS, counts: COUNTS, modelValue: { tags: [], match: 'all' }, ...props } as never,
    global: { stubs: { PopoverPortal: { template: '<div><slot /></div>' } } },
    attachTo: document.body,
  });
  await wrapper.get('[data-testid="tag-filter"]').trigger('click');
  await tick();
  return wrapper;
}

const names = (menu: VueWrapper) =>
  menu.findAll('[role="option"]').map((row) => row.find('.tag-filter-name').text());

afterEach(async () => {
  wrapper?.unmount();
  wrapper = null;
  await tick();
});

describe('TagFilterMenu', () => {
  it('lists the tags this section carries by name, with counts', async () => {
    const menu = await openMenu();
    expect(names(menu)).toEqual(['geo', 'wastewater', 'water']);
    expect(menu.get('[data-testid="tag-filter-option-t:geo"]').text()).toContain('9');
  });

  it('puts the chosen tags first, and keeps a chosen tag no row carries', async () => {
    const menu = await openMenu({ modelValue: { tags: ['t:water', 't:unused'], match: 'all' } });
    expect(names(menu).slice(0, 2)).toEqual(['unused', 'water']);
    expect(menu.get('[data-testid="tag-filter"]').text()).toContain('2');
  });

  it('searches fuzzily and toggles from the keyboard', async () => {
    const menu = await openMenu();
    await menu.get('[data-testid="tag-filter-search"]').setValue('wat');
    expect(names(menu)).toEqual(['water', 'wastewater']);
    await menu.get('[data-testid="tag-filter-search"]').trigger('keydown', { key: 'Enter' });
    expect(menu.emitted('update:modelValue')?.[0]).toEqual([{ tags: ['t:water'], match: 'all' }]);
  });

  it('draws 50 tags at a time out of a thousand', async () => {
    const many = Array.from({ length: 1000 }, (_, i) => ({ id: `t:${i}`, name: `tag-${String(i).padStart(4, '0')}` }));
    const counts = Object.fromEntries(many.map((tag) => [tag.id, 1]));
    const menu = await openMenu({ tags: many, counts });
    expect(menu.findAll('[role="option"]')).toHaveLength(50);
    await menu.get('[data-testid="tag-filter-more"]').trigger('click');
    expect(menu.findAll('[role="option"]')).toHaveLength(100);
    await menu.get('[data-testid="tag-filter-search"]').setValue('0999');
    expect(names(menu)[0]).toBe('tag-0999');
  });
});

describe('TagFilterChips', () => {
  it('leads with Any of and All of only once two tags are chosen, and clears', async () => {
    const one = mount(TagFilterChips, { props: { tags: TAGS, modelValue: { tags: ['t:geo'], match: 'all' } } });
    expect(one.find('[data-testid="tag-filter-match-any"]').exists()).toBe(false);
    await one.get('[data-testid="tag-filter-clear"]').trigger('click');
    expect(one.emitted('update:modelValue')?.[0]).toEqual([{ tags: [], match: 'all' }]);

    const two = mount(TagFilterChips, { props: { tags: TAGS, modelValue: { tags: ['t:geo', 't:water'], match: 'all' } } });
    // The toggle comes first, so the row reads "Any of geo, water".
    expect(two.get('[data-testid="tag-filter-chips"]').element.firstElementChild?.textContent).toContain('Any of');
    await two.get('[data-testid="tag-filter-match-any"]').trigger('click');
    expect(two.emitted('update:modelValue')?.[0]).toEqual([{ tags: ['t:geo', 't:water'], match: 'any' }]);
  });
});

describe('lib/tagFilter', () => {
  it('matches any or all, and passes every row when empty', () => {
    expect(matchesTagFilter(['a'], { tags: ['a', 'b'], match: 'any' })).toBe(true);
    expect(matchesTagFilter(['a'], { tags: ['a', 'b'], match: 'all' })).toBe(false);
    expect(matchesTagFilter(null, { tags: [], match: 'all' })).toBe(true);
  });

  it('starts empty with Any of', () => {
    expect(normalizeTagFilter(undefined)).toEqual({ tags: [], match: 'any' });
  });

  it('normalizes stored values and sends tagMatch only for any', () => {
    expect(normalizeTagFilter({ tags: ['a', 'a', 3], match: 'nope' })).toEqual({ tags: ['a'], match: 'any' });
    expect(tagFilterParams({ tags: ['a'], match: 'all' })).toEqual({ tag: ['a'] });
    expect(tagFilterParams({ tags: ['a'], match: 'any' })).toEqual({ tag: ['a'], tagMatch: 'any' });
  });
});
