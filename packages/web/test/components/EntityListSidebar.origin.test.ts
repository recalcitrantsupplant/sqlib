/**
 * Grouping a section's list by origin.
 *
 * Origin answers "where did this come from?", which is a different question
 * from the one tags answer ("what is this about?") — and it is deliberately a
 * weak organiser: a set made on one query is legitimately what another wants.
 *
 * The three things asserted here are the three the design turns on: the buckets
 * are kinds of origin rather than one cluster per callable, a row with no
 * recorded origin is *Composed here* rather than missing, and the mode is
 * offered only where a section's rows can differ in it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
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

const SAVED = [
  { id: 'set:1', name: 'Perth seed', origin: 'query' as const },
  { id: 'set:2', name: 'Sydney seed', origin: 'query' as const },
  { id: 'set:3', name: 'Orders routing', origin: 'group' as const },
  // No origin recorded — everything saved before origin existed reads as this.
  { id: 'set:4', name: 'Hand-rolled', origin: null },
];

function mountSidebar(props: Record<string, unknown> = {}) {
  return mount(EntityListSidebar, {
    props: {
      saved: SAVED,
      scratch: [],
      selection: { kind: 'none', id: null },
      tags: [],
      savedKinds: [{ type: 'argumentSet', label: 'Argument sets' }],
      supportsSaved: true,
      supportsScratch: true,
      supportsOrigin: true,
      ...props,
    } as never,
    global: { stubs: { TagManagerDialog: true } },
  });
}

describe('EntityListSidebar — grouped by origin', () => {
  beforeEach(() => {
    const { settings } = useSettings();
    settings.value.entityListGrouping = 'origin';
    settings.value.entityListDensity = 'compact';
  });

  it('buckets by kind of origin, not one cluster per callable', () => {
    const wrapper = mountSidebar();

    const headings = wrapper.findAll('.group-header').map((header) => header.find('.group-name').text());
    expect(headings).toEqual(['Composed here', 'From queries', 'From groups']);

    // Two sets made on queries share one heading. One cluster per callable is
    // what would shatter a real library into dozens of single-row clusters.
    const queries = wrapper.findAll('.group-header').find((header) => header.text().includes('From queries'));
    expect(queries).toBeTruthy();
    const names = wrapper.findAll('[data-testid="saved-row"] .entity-name').map((row) => row.text());
    expect(names).toEqual(['Hand-rolled', 'Perth seed', 'Sydney seed', 'Orders routing']);
  });

  it('drops a bucket nothing lands in rather than showing an empty heading', () => {
    const wrapper = mountSidebar({
      saved: [{ id: 'set:1', name: 'Perth seed', origin: 'query' }],
    });
    const headings = wrapper.findAll('.group-header').map((header) => header.find('.group-name').text());
    expect(headings).toEqual(['From queries']);
  });

  it('offers the mode only where the section says its rows carry one', () => {
    // The options live inside the menu, which is closed until it is opened, so
    // the trigger is what says the control exists — and its label says which
    // mode is active.
    expect(mountSidebar().find('[data-testid="group-by"]').text()).toContain('Origin');

    const flat = mountSidebar({ supportsOrigin: false, supportsTags: false });
    expect(flat.find('[data-testid="group-by"]').exists()).toBe(false);
    // And the stored mode does not leak into a section that has no origin:
    // every row stays in one flat run.
    expect(flat.findAll('.group-header')).toHaveLength(0);
  });
});
