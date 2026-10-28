import { describe, it, expect, beforeEach, vi } from 'vitest';
import { defineComponent, h, type Component } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import PrincipalAccessView from '@/components/access/PrincipalAccessView.vue';
import PrincipalGrantsEditor from '@/components/access/PrincipalGrantsEditor.vue';
import TestAsPanel from '@/components/access/TestAsPanel.vue';
import { createAccessData, provideAccessData, type AccessData } from '@/composables/useAccessData';

const api = vi.hoisted(() => ({
  listPrincipals: vi.fn(),
  listGrants: vi.fn(),
  listLibraries: vi.fn(),
  listBackends: vi.fn(),
  createGrant: vi.fn(),
  deleteGrant: vi.fn(),
  testGraphPolicy: vi.fn(),
  runSparql: vi.fn(),
}));
vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));

const ANALYSTS = 'urn:sqlib:principal:group:analysts';
const ALICE = 'urn:sqlib:principal:user:alice';
const EVERYONE = 'urn:sqlib:principal:authenticated';
const LIBRARY = 'urn:lib:reporting';
const BACKEND = 'urn:backend:prod';

const principals = [
  { iri: ANALYSTS, rawClaim: 'analysts', kind: 'group' },
  { iri: ALICE, rawClaim: 'alice@example.org', kind: 'user', groups: [ANALYSTS] },
];

let grants: Array<Record<string, unknown>>;

/** Mounts `child` under a host that provides the screen's data, as the page does. */
async function mountWithData(child: Component, props: Record<string, unknown>) {
  let data: AccessData | null = null;
  const Host = defineComponent({
    setup() {
      data = createAccessData();
      provideAccessData(data);
      return () => h(child, props);
    },
  });
  const wrapper = mount(Host, { global: { stubs: { NuxtLink: { template: '<a><slot /></a>' } } } });
  await data!.load();
  await flushPromises();
  return { wrapper, data: data! };
}

describe('Access screen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    grants = [
      { id: 'g1', principal: ANALYSTS, resourceKind: 'library', resource: LIBRARY, modes: ['read', 'execute'] },
      { id: 'g2', principal: ANALYSTS, resourceKind: 'backend', resource: BACKEND, modes: ['query:adhoc'] },
      { id: 'g3', principal: EVERYONE, resourceKind: 'backend', resource: BACKEND, modes: ['query:saved'] },
    ];
    api.listPrincipals.mockResolvedValue(principals);
    api.listGrants.mockImplementation(async () => grants);
    api.listLibraries.mockResolvedValue([{ id: LIBRARY, name: 'Reporting', defaultBackend: BACKEND }]);
    api.listBackends.mockResolvedValue([{ id: BACKEND, name: 'fuseki-prod', graphPolicyQueryVersion: 'urn:v4' }]);
    api.runSparql.mockResolvedValue({ results: { bindings: [{ g: { value: 'urn:g:1' } }, { g: { value: 'urn:g:2' } }, { g: { value: 'urn:g:3' } }] } });
    api.testGraphPolicy.mockResolvedValue({
      user: null, groups: [ANALYSTS], groupsSource: 'given', admin: false, modes: ['query:saved', 'query:adhoc'],
      policy: { queryVersion: 'urn:v4', backend: 'urn:auth' }, defaultGraphs: ['urn:g:1'], namedGraphs: ['urn:g:1', 'urn:g:2'],
      error: null, via: [ANALYSTS],
    });
    api.createGrant.mockResolvedValue({});
    api.deleteGrant.mockResolvedValue(true);
  });

  it('shows a group its roles, levels and readable graphs', async () => {
    const { wrapper } = await mountWithData(PrincipalGrantsEditor, { principal: principals[0] });

    const role = wrapper.find('select[aria-label="Role on Reporting"]');
    expect((role.element as HTMLSelectElement).value).toBe('run');
    const query = wrapper.find('[aria-label="Query on fuseki-prod"]');
    expect(query.find('.segment.on').text()).toBe('Ad hoc');
    expect(wrapper.find('[data-testid="access-graphs-badge"]').text()).toBe('2 of 3 · policy');
  });

  it('saves a role as its modes, replacing the old grant', async () => {
    const { wrapper } = await mountWithData(PrincipalGrantsEditor, { principal: principals[0] });

    await wrapper.find('select[aria-label="Role on Reporting"]').setValue('edit');
    await flushPromises();

    expect(api.deleteGrant).toHaveBeenCalledWith('g1');
    expect(api.createGrant).toHaveBeenCalledWith({
      principal: ANALYSTS, resourceKind: 'library', resource: LIBRARY, modes: ['read', 'execute', 'write'],
    });
  });

  it('shows Custom as five mode checkboxes without changing the grant', async () => {
    const { wrapper } = await mountWithData(PrincipalGrantsEditor, { principal: principals[0] });

    await wrapper.find('select[aria-label="Role on Reporting"]').setValue('custom');
    await flushPromises();

    expect(wrapper.findAll('.mode-grid input')).toHaveLength(5);
    expect(api.createGrant).not.toHaveBeenCalled();
  });

  it('changes one operation level and keeps the other', async () => {
    const { wrapper } = await mountWithData(PrincipalGrantsEditor, { principal: principals[0] });

    const update = wrapper.find('[aria-label="Update on fuseki-prod"]');
    await update.findAll('button').find((b) => b.text() === 'Saved')!.trigger('click');
    await flushPromises();

    expect(api.createGrant).toHaveBeenCalledWith({
      principal: ANALYSTS, resourceKind: 'backend', resource: BACKEND, modes: ['query:adhoc', 'update:saved'],
    });
  });

  it('shows a person what they end up with, and where each part comes from', async () => {
    const { wrapper } = await mountWithData(PrincipalAccessView, { principal: principals[1] });

    expect(wrapper.find('[data-testid="no-direct-grants"]').exists()).toBe(true);
    const rows = wrapper.find('[data-testid="effective-access"]').findAll('tbody tr');
    const backendRow = rows.find((row) => row.text().includes('fuseki-prod'))!;
    expect(backendRow.text()).toContain('Query ad hoc · Update none');
    expect(backendRow.text()).toContain('analysts');
    expect(backendRow.text()).toContain('Everyone');
    expect(rows.find((row) => row.text().includes('Reporting'))!.text()).toContain('Run');
  });

  it('compares the latest policy version with the pinned one', async () => {
    api.testGraphPolicy
      .mockResolvedValueOnce({
        user: ALICE, groups: [ANALYSTS], groupsSource: 'given', admin: false, modes: ['query:adhoc'],
        policy: { queryVersion: 'urn:v5', backend: 'urn:auth' }, defaultGraphs: ['urn:g:1', 'urn:g:3'], namedGraphs: [],
        error: null, via: [ANALYSTS],
      })
      .mockResolvedValueOnce({
        user: ALICE, groups: [ANALYSTS], groupsSource: 'given', admin: false, modes: ['query:adhoc'],
        policy: { queryVersion: 'urn:v4', backend: 'urn:auth' }, defaultGraphs: ['urn:g:1', 'urn:g:2'], namedGraphs: [],
        error: null, via: [ANALYSTS],
      });
    const summary = {
      policy: { queryVersion: 'urn:v4', backend: 'urn:auth' },
      query: { id: 'urn:q', name: 'Team graph access' },
      pinned: { id: 'urn:v4', version: 4, dateCreated: null, queryString: '' },
      latest: { id: 'urn:v5', version: 5, dateCreated: null },
    };
    const { wrapper } = await mountWithData(TestAsPanel, {
      backend: { id: BACKEND, name: 'fuseki-prod', graphPolicyQueryVersion: 'urn:v4' },
      summary,
    });

    await wrapper.find('[aria-label="Policy version"]').findAll('button')[1].trigger('click');
    await wrapper.find('[data-testid="test-as-run"]').trigger('click');
    await flushPromises();

    expect(api.testGraphPolicy).toHaveBeenNthCalledWith(1, BACKEND, { groups: [], queryVersion: 'urn:v5', policyBackend: 'urn:auth' });
    const result = wrapper.find('[data-testid="test-as-result"]').text();
    expect(result).toContain('2 of 3 graphs');
    expect(result).toContain('+1');
    expect(result).toContain('−1');
    expect(result).toContain('via analysts');
    expect(wrapper.find('.g-row.new').text()).toContain('urn:g:3');
    expect(wrapper.find('.g-row.gone').text()).toContain('urn:g:2');
  });
});
