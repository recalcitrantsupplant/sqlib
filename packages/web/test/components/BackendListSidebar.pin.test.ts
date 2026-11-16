import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import BackendListSidebar from '@/components/BackendListSidebar.vue';
import { resetBackendProbesForTest } from '@/composables/useBackendProbes';
import { resetEntityPinsForTest } from '@/composables/useEntityPins';
import { useSettings } from '@/composables/useSettings';

const api = vi.hoisted(() => ({
  listBackendProbes: vi.fn(),
  probeAllBackends: vi.fn(),
  probeBackend: vi.fn(),
}));
vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));

const backends = [
  { id: 'b:a', name: 'Alpha', backendType: 'http', endpoint: 'https://a.example/sparql', dateCreated: '2026-10-01T00:00:00Z' },
  { id: 'b:b', name: 'Bravo', backendType: 'http', endpoint: 'https://b.example/sparql', dateCreated: '2026-11-01T00:00:00Z' },
  { id: 'b:auth', name: 'Auth store', backendType: 'http', endpoint: 'https://auth.example/sparql', authBackend: true },
] as never[];

const mountSidebar = () =>
  mount(BackendListSidebar, { props: { backends, selectedId: null, draft: false } as never });

const names = (wrapper: ReturnType<typeof mountSidebar>) =>
  wrapper.findAll('[data-testid="backend-row"]').map((row) => row.find('.row-name').text());

describe('BackendListSidebar — pin and sort', () => {
  beforeEach(() => {
    localStorage.clear();
    resetEntityPinsForTest();
    resetBackendProbesForTest();
    useSettings().settings.value.entityListSort = {};
  });

  it('puts a pinned backend in a Pinned group above Auth and Data', async () => {
    const wrapper = mountSidebar();
    await wrapper.findAll('[data-testid="backend-row"]')[2]!.get('[data-testid="pin-button"]').trigger('click');

    expect(wrapper.find('[data-testid="backend-group-pinned"]').exists()).toBe(true);
    expect(names(wrapper)[0]).toBe('Bravo');
    expect(wrapper.emitted('select')).toBeUndefined();
  });

  it('sorts by created date, newest first, with undated rows last', () => {
    useSettings().setEntityListSort('backends', { key: 'created', dir: 'desc' });
    const wrapper = mountSidebar();
    // Auth group first, then Data in date order.
    expect(names(wrapper)).toEqual(['Auth store', 'Bravo', 'Alpha']);
  });
});
