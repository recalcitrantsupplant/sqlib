import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import BackendListSidebar from '@/components/BackendListSidebar.vue';
import { resetBackendProbesForTest, useBackendProbes } from '@/composables/useBackendProbes';

const api = vi.hoisted(() => ({
  listBackendProbes: vi.fn(),
  probeAllBackends: vi.fn(),
  probeBackend: vi.fn(),
}));
vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));

const backends = [
  { id: 'b:wikidata', name: 'Wikidata Public', backendType: 'http', endpoint: 'https://query.wikidata.org/sparql' },
  { id: 'b:graphdb', name: 'GraphDB Prod', backendType: 'http', endpoint: 'http://graphdb.corp:7200/repositories/x' },
  { id: 'b:memory', name: 'In memory', backendType: 'oxigraphEphemeral', endpoint: null },
] as never[];

function mountSidebar(props: Record<string, unknown> = {}) {
  return mount(BackendListSidebar, {
    props: { backends, selectedId: null, draft: false, ...props } as never,
  });
}

describe('BackendListSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBackendProbesForTest();
  });

  it('lists every backend with its host, alphabetically', () => {
    const wrapper = mountSidebar();

    const rows = wrapper.findAll('[data-testid="backend-row"]');
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.find('.row-name').text())).toEqual(['GraphDB Prod', 'In memory', 'Wikidata Public']);
    expect(rows[0].find('.row-host').text()).toBe('graphdb.corp:7200');
    // Nothing to reach means nothing to show a host for.
    expect(rows[1].find('.row-host').text()).toBe('in-process');
    expect(wrapper.find('[data-testid="backend-count"]').text()).toBe('3');
  });

  it('filters on name and on endpoint', async () => {
    const wrapper = mountSidebar();

    await wrapper.find('[data-testid="backend-filter"]').setValue('wikidata');
    expect(wrapper.findAll('[data-testid="backend-row"]')).toHaveLength(1);

    await wrapper.find('[data-testid="backend-filter"]').setValue('7200');
    expect(wrapper.findAll('[data-testid="backend-row"]').at(0)?.find('.row-name').text()).toBe('GraphDB Prod');

    await wrapper.find('[data-testid="backend-filter"]').setValue('nothing matches this');
    expect(wrapper.findAll('[data-testid="backend-row"]')).toHaveLength(0);
    expect(wrapper.text()).toContain('Nothing matches');
  });

  it('draws an unprobed backend as never probed rather than unhealthy', () => {
    const wrapper = mountSidebar();

    const dots = wrapper.findAll('[data-testid="backend-health-dot"]');
    expect(dots.every((dot) => dot.classes().includes('health-dot--never_probed'))).toBe(true);
    expect(wrapper.findAll('.row-latency').every((cell) => cell.text() === '—')).toBe(true);
  });

  it('shows health and latency once probes arrive', async () => {
    api.listBackendProbes.mockResolvedValue([
      { backendId: 'b:wikidata', health: 'healthy', latencyMs: 84, product: null, probedAt: new Date().toISOString(), error: null },
      { backendId: 'b:graphdb', health: 'unreachable', latencyMs: null, product: null, probedAt: new Date().toISOString(), error: 'connection refused' },
    ]);
    await useBackendProbes().loadProbes();

    const wrapper = mountSidebar();
    const rows = wrapper.findAll('[data-testid="backend-row"]');

    expect(rows[0].find('[data-testid="backend-health-dot"]').classes()).toContain('health-dot--unreachable');
    expect(rows[0].find('[data-testid="backend-health-dot"]').attributes('title')).toContain('connection refused');
    expect(rows[2].find('[data-testid="backend-health-dot"]').classes()).toContain('health-dot--healthy');
    expect(rows[2].find('.row-latency').text()).toBe('84 ms');
  });

  it('emits selection, creation and probe-all', async () => {
    const wrapper = mountSidebar();

    await wrapper.findAll('[data-testid="backend-row"]')[0].trigger('click');
    await wrapper.find('[data-testid="new-backend"]').trigger('click');
    await wrapper.find('[data-testid="probe-all"]').trigger('click');

    expect(wrapper.emitted('select')?.[0]).toEqual(['b:graphdb']);
    expect(wrapper.emitted('create')).toHaveLength(1);
    expect(wrapper.emitted('probe-all')).toHaveLength(1);
  });

  it('pins the unsaved row above the saved ones and can discard it', async () => {
    const wrapper = mountSidebar({ draft: true, draftName: 'New store' });

    const draftRow = wrapper.find('[data-testid="backend-draft-row"]');
    expect(draftRow.exists()).toBe(true);
    expect(draftRow.text()).toContain('New store');
    expect(draftRow.text()).toContain('unsaved');

    await wrapper.find('[data-testid="discard-backend-draft"]').trigger('click');
    expect(wrapper.emitted('discard-draft')).toHaveLength(1);
  });

  it('says so when there are no backends at all', () => {
    const wrapper = mountSidebar({ backends: [] });
    expect(wrapper.text()).toContain('No backends yet');
  });

  /*
   * A browser backend cannot be probed — the server has no record of it — so
   * the list says nothing about its health rather than showing the grey dot
   * and the dash that mean "never probed".
   */
  describe('a backend registered in this browser', () => {
    const browser = {
      id: 'urn:sqlib:browser-backend:wikidata',
      name: 'query.wikidata.org/sparql',
      description: null,
      backendType: 'http' as const,
      endpoint: 'https://query.wikidata.org/sparql',
      authEnvKey: null,
      queryMethod: null,
      oxigraphConfig: null,
      dateCreated: '2026-09-01T00:00:00.000Z',
      dateModified: '2026-09-01T00:00:00.000Z',
    };

    it('keeps the dot\'s space without claiming a health', () => {
      const wrapper = mountSidebar({ backends: [browser] });

      const dot = wrapper.find('[data-testid="backend-health-dot"]');
      expect(dot.classes()).toContain('health-dot--none');
      expect(dot.attributes('title')).toBeUndefined();
      expect(wrapper.find('.row-latency').exists()).toBe(false);
    });

    it('offers no Probe all when nothing in the list can be probed', () => {
      const wrapper = mountSidebar({ backends: [browser] });

      expect(wrapper.find('[data-testid="probe-all"]').attributes('disabled')).toBeDefined();
    });

    it('offers it again as soon as one backend is the server\'s', () => {
      const wrapper = mountSidebar({ backends: [browser, ...backends] });

      expect(wrapper.find('[data-testid="probe-all"]').attributes('disabled')).toBeUndefined();
    });
  });
});
