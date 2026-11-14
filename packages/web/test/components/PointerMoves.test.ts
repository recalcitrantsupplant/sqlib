/**
 * Who moved an environment pointer: the chip on a pointer row, and the
 * history in the row's menu.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { ref } from 'vue';
import PointerMovedBy from '@/components/library-page/PointerMovedBy.vue';
import { buildBoard, indexPointers, type PromotableEntity } from '@/lib/environmentBoard';
import { resetPrincipalNames } from '@/composables/usePrincipalNames';

const ALICE = 'urn:sqlib:principal:user:alice';
const lookupPrincipalNames = vi.fn(async (iris: string[]) =>
  iris.filter((iri) => iri === ALICE).map((iri) => ({ iri, displayName: 'Alice Ng' })));

vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => ({ lookupPrincipalNames }) }));
vi.mock('@/composables/useAuth', () => ({ useAuth: () => ({ me: ref(null) }) }));

const query: PromotableEntity = {
  id: 'urn:q', name: 'heights', kind: 'Query', currentVersion: 'urn:q:v3', currentVersionNumber: 3, groupOnly: false,
};

describe('pointer moves', () => {
  beforeEach(() => {
    resetPrincipalNames();
    lookupPrincipalNames.mockClear();
  });

  it('carries the mover and the date from the pointer to the board cell', () => {
    const rows = buildBoard([query], [{ id: 'urn:env:prod', name: 'prod' }], indexPointers({
      'urn:env:prod': [{
        entity: 'urn:q', entityType: 'Query', version: 'urn:q:v3', versionNumber: 3,
        movedBy: ALICE, movedAt: '2026-11-02T14:02:00.000Z',
      }],
    }));
    expect(rows[0].cells[1]).toMatchObject({ movedBy: ALICE, movedAt: '2026-11-02T14:02:00.000Z' });
  });

  it('shows the mover by name beside the date', async () => {
    const wrapper = mount(PointerMovedBy, {
      props: { cell: { environment: 'e', version: 'v', versionNumber: 3, state: 'current', movedBy: ALICE, movedAt: '2026-11-02T14:02:00.000Z' } },
    });
    await flushPromises();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await flushPromises();
    expect(wrapper.find('.person-name').text()).toBe('Alice Ng');
    expect(wrapper.find('.when').text()).toContain('Nov');
  });

  it('shows nothing for a pointer with no recorded move', () => {
    const wrapper = mount(PointerMovedBy, {
      props: { cell: { environment: 'e', version: 'v', versionNumber: 3, state: 'current', movedBy: null, movedAt: null } },
    });
    expect(wrapper.find('[data-testid="pointer-moved-by"]').exists()).toBe(false);
  });
});
