/**
 * Grouping a section's list by tag — option 1a of the tags mockup.
 *
 * The three things that make that option what it is, and the three things
 * asserted here: a row appears under every tag it carries; the dots on a row
 * are the tags it carries *other* than the one whose heading it is under; and
 * rows with no tag at all fall into a computed Untagged group rather than a
 * stored default tag.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { h } from 'vue';
import EntityListSidebar from '@/components/EntityListSidebar.vue';
import { useSettings } from '@/composables/useSettings';

vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => ({ listTags: vi.fn().mockResolvedValue([]) }) }));
vi.mock('@/composables/useActiveLibrary', () => ({
  useActiveLibrary: () => ({
    libraries: { value: [{ id: 'lib:1', name: 'Main' }] },
    activeLibraryId: { value: 'lib:1' },
    activeLibrary: { value: { id: 'lib:1', name: 'Main' } },
    activeLibraryName: { value: 'Main' },
    setActiveLibrary: vi.fn(),
    ensureLoaded: vi.fn(),
  }),
}));

const TAGS = [
  { id: 'tag:prod', name: 'Production', color: '#2f6feb' },
  { id: 'tag:geo', name: 'Geo', color: '#15803d' },
];

const SAVED = [
  { id: 'q:1', name: 'Country populations', tags: ['tag:prod', 'tag:geo'] },
  { id: 'q:2', name: 'Dataset labels', tags: ['tag:prod'] },
  { id: 'q:3', name: 'Taxon rank hierarchy', tags: [] },
];

function mountSidebar(props: Record<string, unknown> = {}, slots: Record<string, string> = {}) {
  return mount(EntityListSidebar, {
    slots,
    props: {
      saved: SAVED,
      scratch: [],
      selection: { kind: 'none', id: null },
      tags: TAGS,
      savedKinds: [{ type: 'query', label: 'Queries' }],
      supportsSaved: true,
      supportsScratch: true,
      supportsTags: true,
      ...props,
    } as never,
    global: { stubs: { TagManagerDialog: true } },
  });
}

describe('EntityListSidebar — grouped by tag', () => {
  beforeEach(() => {
    const { settings } = useSettings();
    settings.value.entityListGrouping = 'tag';
    settings.value.entityListDensity = 'compact';
  });

  it('files a row under every tag it carries, and untagged rows under Untagged', () => {
    const wrapper = mountSidebar();

    const headings = wrapper.findAll('.group-header').map((header) => header.find('.group-name').text());
    expect(headings).toEqual(['Production', 'Geo', 'Untagged']);

    // Country populations carries both tags, so it is listed twice — grouping
    // is a view over the list, not a partition of it.
    const names = wrapper.findAll('[data-testid="saved-row"] .entity-name').map((row) => row.text());
    expect(names.filter((name) => name === 'Country populations')).toHaveLength(2);
    expect(names.filter((name) => name === 'Taxon rank hierarchy')).toHaveLength(1);
  });

  it('marks a row with the colours of its other tags only', () => {
    const wrapper = mountSidebar();

    const production = wrapper.find('[data-testid="tag-group-tag:prod"]');
    expect(production.exists()).toBe(true);

    const rows = wrapper.findAll('[data-testid="saved-row"]');
    const inProduction = rows.filter((row) => row.text().includes('Country populations'))[0];
    const dots = inProduction.findAll('[data-testid="other-tag-dots"] [data-testid="tag-dot"]');
    expect(dots).toHaveLength(1);
    expect(dots[0].attributes('style')).toContain('#15803d');
    expect(inProduction.find('[data-testid="other-tag-dots"]').attributes('title')).toBe('Also in Geo');

    // A row with nothing else on it gets no dots at all.
    const onlyProduction = rows.filter((row) => row.text().includes('Dataset labels'))[0];
    expect(onlyProduction.find('[data-testid="other-tag-dots"]').exists()).toBe(false);
  });

  it('collapses a group without dropping the others', async () => {
    const wrapper = mountSidebar();

    await wrapper.find('[data-testid="tag-group-tag:prod"]').trigger('click');

    const names = wrapper.findAll('[data-testid="saved-row"] .entity-name').map((row) => row.text());
    expect(names).not.toContain('Dataset labels');
    // Still under Geo, which is untouched.
    expect(names).toContain('Country populations');
  });

  it('drops a tag nothing in the section carries', () => {
    const wrapper = mountSidebar({
      tags: [...TAGS, { id: 'tag:unused', name: 'Nightly', color: '#0d7676' }],
    });

    expect(wrapper.find('[data-testid="tag-group-tag:unused"]').exists()).toBe(false);
  });

  it('goes back to a flat list when grouping is off', async () => {
    const { settings } = useSettings();
    settings.value.entityListGrouping = 'none';
    const wrapper = mountSidebar();

    expect(wrapper.findAll('[data-testid="saved-row"]')).toHaveLength(3);
    expect(wrapper.find('[data-testid="other-tag-dots"]').exists()).toBe(false);

    // Flat is flat. A single-kind section used to fold by `Test.group` here —
    // a second axis this control silently replaced whenever it was on, so a
    // reader's persisted choice decided which of the two they saw.
    expect(wrapper.findAll('.group-header')).toHaveLength(0);
  });

  it('tells a group action which tag its heading is, and nothing for a kind heading', () => {
    // Tests runs a heading's tests server-side when the heading *is* a tag, so
    // the slot has to say which tag — the rows alone cannot, since a row under
    // Production may carry Geo too.
    const wrapper = mountSidebar({}, {
      'group-actions': `<template #group-actions="{ label, tagId }">
        <span class="probe">{{ label }}={{ tagId ?? 'none' }}</span>
      </template>`,
    });

    expect(wrapper.findAll('.probe').map((probe) => probe.text())).toEqual([
      'Production=tag:prod',
      'Geo=tag:geo',
      'Untagged=none',
    ]);
  });

  it('runs a heading action without collapsing the heading', async () => {
    // The heading is the collapse toggle, so an action drawn inside it has to
    // stop the click: Run tagged used to fold the group away instead of running.
    const run = vi.fn();
    const wrapper = mountSidebar({}, {
      'group-actions': () => h('button', { class: 'probe-run', onClick: run }, 'Run'),
    });

    await wrapper.findAll('.probe-run')[0].trigger('click');

    expect(run).toHaveBeenCalledTimes(1);

    // Production's rows are still listed — the group did not collapse.
    const names = wrapper.findAll('[data-testid="saved-row"] .entity-name').map((row) => row.text());
    expect(names).toContain('Dataset labels');
    expect(wrapper.find('[data-testid="tag-group-tag:prod"]').attributes('aria-expanded')).toBe('true');
  });

  it('offers no grouping control where the entities cannot be tagged', () => {
    const wrapper = mountSidebar({ supportsTags: false, tags: [] });

    expect(wrapper.find('[data-testid="group-by"]').exists()).toBe(false);
    // …and the list stays flat even though the setting says tag.
    expect(wrapper.findAll('[data-testid="saved-row"]')).toHaveLength(3);
  });
});
