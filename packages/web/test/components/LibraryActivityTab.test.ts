/**
 * The library Activity tab: rows by day, the filters, and paging.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import LibraryActivityTab from '@/components/library-page/LibraryActivityTab.vue';
import { groupByDay } from '@/lib/libraryActivity';
import { resetPrincipalNames } from '@/composables/usePrincipalNames';
import type { LibraryActivityItem } from '@/composables/useApiClient';

const ALICE = 'urn:sqlib:principal:user:alice';

const item = (over: Partial<LibraryActivityItem>): LibraryActivityItem => ({
  id: 'i', kind: 'created', at: '2026-11-14T10:00:00.000Z', actor: null,
  entity: 'urn:q', entityType: 'Query', entityName: 'heights', ...over,
});

const listLibraryActivity = vi.fn();
const lookupPrincipalNames = vi.fn(async (iris: string[]) =>
  iris.filter((iri) => iri === ALICE).map((iri) => ({ iri, displayName: 'Alice Ng' })));

vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => ({ listLibraryActivity, lookupPrincipalNames }) }));
vi.mock('@/composables/useAuth', () => ({ useAuth: () => ({ me: ref(null) }) }));

describe('groupByDay', () => {
  it('labels today and yesterday, then the date', () => {
    const now = new Date(2026, 10, 14, 18, 0);
    const days = groupByDay([
      item({ id: 'a', at: new Date(2026, 10, 14, 9).toISOString() }),
      item({ id: 'b', at: new Date(2026, 10, 14, 8).toISOString() }),
      item({ id: 'c', at: new Date(2026, 10, 13, 8).toISOString() }),
      item({ id: 'd', at: new Date(2026, 10, 2, 8).toISOString() }),
    ], now);
    expect(days.map((day) => [day.label.replace(/\s+/g, ' '), day.items.length])).toEqual([
      ['Today', 2], ['Yesterday', 1], [expect.stringMatching(/2/), 1],
    ]);
  });
});

describe('LibraryActivityTab', () => {
  beforeEach(() => {
    resetPrincipalNames();
    listLibraryActivity.mockReset();
  });

  it('shows who did what, and asks again with the filter and the cursor', async () => {
    listLibraryActivity.mockResolvedValueOnce({
      items: [
        item({ id: 'm', kind: 'moved', actor: ALICE, environmentName: 'prod', fromVersionNumber: 2, toVersionNumber: 3 }),
        item({ id: 'd', kind: 'deleted', entityName: 'Old churn' }),
      ],
      next: 'cursor-1',
    });
    const wrapper = mount(LibraryActivityTab, { props: { libraryId: 'urn:lib' } });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();

    expect(listLibraryActivity).toHaveBeenLastCalledWith('urn:lib', { kind: undefined, actor: undefined, before: undefined, limit: 50 });
    const parts = wrapper.findAll('[data-testid="activity-moved"] .what > *').map((part) => part.text()).filter(Boolean);
    expect(parts).toEqual(['moved', 'heights', 'in', 'prod', 'v2', 'v3']);
    expect(wrapper.find('[data-testid="activity-moved"] .person-name').text()).toBe('Alice Ng');
    expect(wrapper.find('[data-testid="activity-deleted"] s.name').text()).toBe('Old churn');

    listLibraryActivity.mockResolvedValueOnce({ items: [item({ id: 'c' })], next: null });
    await wrapper.find('[data-testid="activity-more"]').trigger('click');
    await flushPromises();
    expect(listLibraryActivity).toHaveBeenLastCalledWith('urn:lib', { kind: undefined, actor: undefined, before: 'cursor-1', limit: 50 });
    expect(wrapper.findAll('.row')).toHaveLength(3);
    expect(wrapper.find('[data-testid="activity-more"]').exists()).toBe(false);

    listLibraryActivity.mockResolvedValueOnce({ items: [], next: null });
    await wrapper.find('[data-testid="activity-filter-deleted"]').trigger('click');
    await flushPromises();
    expect(listLibraryActivity).toHaveBeenLastCalledWith('urn:lib', { kind: 'deleted', actor: undefined, before: undefined, limit: 50 });
    expect(wrapper.text()).toContain('No activity');
  });
});
