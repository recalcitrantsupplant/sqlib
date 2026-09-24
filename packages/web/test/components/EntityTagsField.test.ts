/**
 * Tag assignment writes for itself.
 *
 * Tags live on the stable entity rather than on a version (tags doc §4.4), so
 * a click here is its own small PUT — not something the work area's save
 * later carries or reverts. These assert exactly that, plus the create-and-
 * apply gesture the picker's Enter key stands for.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import EntityTagsField from '@/components/tags/EntityTagsField.vue';
import { resetDeploymentMode, useDeploymentMode } from '@/composables/useDeploymentMode';

const api = vi.hoisted(() => ({
  listTags: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  updateQuery: vi.fn(),
  updateQueryGroup: vi.fn(),
  updateRuleSet: vi.fn(),
  updateTest: vi.fn(),
  updateDataGraph: vi.fn(),
}));
vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));

const queries = vi.hoisted(() => ({ value: [{ id: 'q:1', name: 'Airports', tags: ['tag:geo'] }] }));
const loadQueries = vi.hoisted(() => vi.fn());
vi.mock('@/composables/useQueriesStore', () => ({
  useQueriesStore: () => ({ queries, loadQueries }),
}));
vi.mock('@/composables/useQueryGroupsStore', () => ({
  useQueryGroupsStore: () => ({ queryGroups: { value: [] }, loadQueryGroups: vi.fn() }),
}));
vi.mock('@/composables/useRuleSetsStore', () => ({
  useRuleSetsStore: () => ({ ruleSets: { value: [] }, fetchRuleSets: vi.fn() }),
}));
vi.mock('@/composables/useTestsStore', () => ({
  useTestsStore: () => ({ tests: { value: [] }, loadTests: vi.fn() }),
}));
vi.mock('@/composables/useDataGraphsStore', () => ({
  useDataGraphsStore: () => ({ dataGraphs: { value: [] }, loadDataGraphs: vi.fn() }),
}));
vi.mock('@/composables/useActiveLibrary', () => ({
  useActiveLibrary: () => ({ activeLibraryId: { value: 'lib:1' }, activeLibraryName: { value: 'Main' } }),
}));

const TAGS = [
  { id: 'tag:geo', name: 'Geo', isPartOf: 'lib:1', color: '#15803d' },
  { id: 'tag:prod', name: 'Production', isPartOf: 'lib:1', color: '#2f6feb' },
];

function mountField(entityId: string | null = 'q:1') {
  return mount(EntityTagsField, {
    props: { entityId, kind: 'query', entityName: 'Airports' } as never,
    attachTo: document.body,
  });
}

describe('EntityTagsField', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.listTags.mockResolvedValue(TAGS);
    api.updateQuery.mockResolvedValue({ data: { id: 'q:1' } });
  });

  it('shows the tags the entity carries, and removing one writes the rest', async () => {
    const wrapper = mountField();
    await flushPromises();

    const chip = wrapper.find('[data-testid="entity-tag-chip-tag:geo"]');
    expect(chip.text()).toContain('Geo');

    await chip.find('button').trigger('click');
    await flushPromises();

    expect(api.updateQuery).toHaveBeenCalledWith('q:1', { tags: [] });
    expect(loadQueries).toHaveBeenCalled();
  });

  it('creates the tag and applies it in one gesture', async () => {
    api.createTag.mockResolvedValue({ data: { id: 'tag:new', name: 'airport', color: '#b8603a', isPartOf: 'lib:1' } });
    const wrapper = mountField();
    await flushPromises();

    await wrapper.find('[data-testid="entity-tags-add"]').trigger('click');
    await wrapper.find('[data-testid="tag-picker-search"]').setValue('airport');
    await wrapper.find('[data-testid="tag-picker-create"]').trigger('click');
    await flushPromises();

    expect(api.createTag).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'airport', isPartOf: 'lib:1' }),
    );
    expect(api.updateQuery).toHaveBeenCalledWith('q:1', { tags: ['tag:geo', 'tag:new'] });
  });

  it('cannot tag a scratch item, and says why', async () => {
    const wrapper = mountField(null);
    await flushPromises();

    const trigger = wrapper.find('[data-testid="entity-tags-add"]');
    expect(trigger.attributes('disabled')).toBeDefined();
    expect(trigger.attributes('title')).toContain('Save this first');
  });

  it('surfaces a rejected write rather than swallowing it', async () => {
    api.updateQuery.mockRejectedValue(new Error('Tag belongs to a different library'));
    const wrapper = mountField();
    await flushPromises();

    await wrapper.find('[data-testid="entity-tag-chip-tag:geo"] button').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="entity-tags-error"]').text()).toContain('different library');
  });

  /*
   * A read-only deployment refuses the PUT behind every one of these clicks,
   * so both controls go and the chips stay: an assigned tag is still a label
   * worth reading, it is only changing it that is unavailable.
   */
  describe('on a read-only deployment', () => {
    const realFetch = globalThis.fetch;

    beforeEach(async () => {
      resetDeploymentMode();
      globalThis.fetch = vi.fn(async () =>
        new Response(JSON.stringify({ status: 'ok', readOnly: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ) as typeof globalThis.fetch;
      await useDeploymentMode().ensureLoaded();
    });

    afterEach(() => {
      globalThis.fetch = realFetch;
      resetDeploymentMode();
    });

    it('still shows the tags, without the controls that would change them', async () => {
      const wrapper = mountField();
      await flushPromises();

      expect(wrapper.find('[data-testid="entity-tag-chip-tag:geo"]').text()).toContain('Geo');
      expect(wrapper.find('[data-testid="entity-tag-chip-tag:geo"] button').exists()).toBe(false);
      expect(wrapper.find('[data-testid="entity-tags-add"]').exists()).toBe(false);
    });
  });
});
