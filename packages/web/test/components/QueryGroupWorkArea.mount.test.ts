/**
 * The query group record page, mounted whole against a fake API.
 *
 * Every store and composable the work area uses is the real one, and so is
 * the Vue Flow canvas; only the API client beneath them is fake
 * (`test/fixtures/fakeApiClient.ts`). The group is the one-node graph the
 * canvas I/O specs use (`test/fixtures/queryGroupCanvasIo.ts`): Start → a
 * SELECT node → End.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import QueryGroupWorkArea from '@/components/QueryGroupWorkArea.vue';
import type { FakeApiClient } from '../fixtures/fakeApiClient';
import { IDS, selectGroupVersionExpanded } from '../fixtures/queryGroupCanvasIo';

const fake = vi.hoisted(() => ({ api: null as FakeApiClient | null }));

vi.mock('@/composables/useApiClient', async () => {
  const { createFakeApiClient } = await import('../fixtures/fakeApiClient');
  fake.api = createFakeApiClient();
  const client = fake.api.client;
  return { useApiClient: () => client };
});

const toasts = vi.hoisted(() => ({ error: [] as string[], success: [] as string[] }));
vi.mock('vue-sonner', () => ({
  toast: {
    success: vi.fn((message: string) => { toasts.success.push(String(message)); }),
    error: vi.fn((message: string) => { toasts.error.push(String(message)); }),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

const LIBRARY_ID = 'urn:sqlib:library:mount';
const BACKEND_ID = 'urn:sqlib:backend:1';

const group = {
  id: IDS.group,
  name: 'City statistics',
  description: 'Population and area for a list of cities.',
  currentVersion: IDS.groupVersion,
  currentVersionNumber: 1,
  isPartOf: LIBRARY_ID,
  dateCreated: '2026-09-01T00:00:00.000Z',
  dateModified: '2026-09-01T00:00:00.000Z',
};

const groupVersionSummary = {
  id: IDS.groupVersion,
  isPartOf: IDS.group,
  version: 1,
  startNode: IDS.startNode,
  endNode: IDS.endNode,
  executionNodes: [IDS.queryNode],
  edges: [IDS.boundaryEdge, IDS.resultEdge],
  canvasData: null,
  comment: null,
  dateCreated: '2026-09-01T00:00:00.000Z',
  dateModified: '2026-09-01T00:00:00.000Z',
};

function api(): FakeApiClient {
  if (!fake.api) throw new Error('the fake API client was not created');
  return fake.api;
}

async function mountSaved() {
  const wrapper = mount(QueryGroupWorkArea, {
    props: { creationRequest: null, queryGroupId: IDS.group, scratchId: null, versionNumber: null },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  toasts.error.length = 0;
  toasts.success.length = 0;
  try { localStorage.clear(); } catch { /* no storage in this environment */ }

  const fakeApi = api();
  fakeApi.reset();
  fakeApi.responses.getQueryGroup = (id: string) => ({ data: { ...group, id }, etag: '"g1"' });
  fakeApi.responses.listQueryGroupVersions = () => [groupVersionSummary];
  fakeApi.responses.getQueryGroupVersion = () => ({ data: selectGroupVersionExpanded(), etag: '"gv1"' });
  fakeApi.responses.listBackends = () => [
    {
      id: BACKEND_ID,
      name: 'City store',
      description: null,
      backendType: 'http',
      endpoint: 'https://cities.example/sparql',
      authEnvKey: null,
      queryMethod: 'post',
      oxigraphConfig: null,
    },
  ];
  fakeApi.responses.validateQueryGroupVersion = () => ({ valid: true, issues: [], warnings: [] });
});

describe('QueryGroupWorkArea — a saved group, mounted against the API', () => {
  it('loads the group and draws its name and its query node on the canvas', async () => {
    const wrapper = await mountSaved();

    expect(api().callsTo('getQueryGroup')).toEqual([[IDS.group]]);
    expect(api().callsTo('getQueryGroupVersion')).toEqual([[IDS.group, 1]]);
    expect(wrapper.get('[data-testid="save-bar"]').text()).toContain('City statistics');
    expect(wrapper.get('[data-testid="version-pill"]').text()).toContain('v1');
    // The query node is on the canvas (Vue Flow keys each node element by its
    // id), labelled with the query version it runs, by name.
    const queryNode = wrapper.find(`[data-id="${IDS.queryNode}"]`);
    expect(queryNode.exists()).toBe(true);
    expect(queryNode.text()).toContain('City lookup');
    expect(wrapper.find(`[data-id="${IDS.startNode}"]`).exists()).toBe(true);
    expect(wrapper.find(`[data-id="${IDS.endNode}"]`).exists()).toBe(true);
    // A loaded group is not an empty canvas.
    expect(wrapper.text()).not.toContain('This group has no steps yet');
    expect(toasts.error).toEqual([]);
  });

  it('runs the loaded version, validating it first, and shows the result', async () => {
    const wrapper = await mountSaved();
    api().responses.executeTarget = () => ({
      body: JSON.stringify({
        result: {
          head: { vars: ['city', 'pop'] },
          results: {
            bindings: [{
              city: { type: 'uri', value: 'http://example.org/Hobart' },
              pop: { type: 'literal', value: '251047' },
            }],
          },
        },
        resultContentType: 'application/sparql-results+json',
        nodes: [],
      }),
      contentType: 'application/json',
      timing: { clientTotalMs: 9 },
    });

    const run = wrapper.get('[data-testid="run-bar-run"]');
    expect(run.attributes('disabled')).toBeUndefined();
    await run.trigger('click');
    await flushPromises();

    expect(api().callsTo('validateQueryGroupVersion')).toEqual([[IDS.group, 1]]);
    const executions = api().callsTo('executeTarget');
    expect(executions).toHaveLength(1);
    const [payload] = executions[0] as [Record<string, unknown>];
    // A group names no backend: each node carries its own.
    expect(payload).toMatchObject({ targetId: IDS.groupVersion, nodeDetail: 'results' });
    expect(payload).not.toHaveProperty('backendId');
    // Validation precedes the run.
    const order = api().calls.map((call) => call.method);
    expect(order.indexOf('validateQueryGroupVersion')).toBeLessThan(order.indexOf('executeTarget'));
    expect(toasts.error).toEqual([]);
    expect(wrapper.text()).toContain('http://example.org/Hobart');
  });
});
