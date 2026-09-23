import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import BackendWorkArea from '@/components/BackendWorkArea.vue';
import { resetBackendProbesForTest } from '@/composables/useBackendProbes';
import { resetDeploymentMode, useDeploymentMode } from '@/composables/useDeploymentMode';

const backend = {
  id: 'b:wikidata',
  name: 'Wikidata Public',
  description: 'Read-only mirror.',
  backendType: 'http' as const,
  endpoint: 'https://query.wikidata.org/sparql',
  authEnvKey: 'WIKIDATA_PUBLIC',
  queryMethod: 'post' as const,
  oxigraphConfig: null,
  dateCreated: '2026-08-01T00:00:00.000Z',
  dateModified: '2026-08-01T00:00:00.000Z',
};

const memoryBackend = {
  id: 'b:reference',
  name: 'Reference data',
  description: null,
  backendType: 'oxigraphMemory' as const,
  endpoint: null,
  authEnvKey: null,
  queryMethod: null,
  oxigraphConfig: JSON.stringify({
    storeType: 'ephemeral',
    mode: 'readOnly',
    sources: [{ dataGraphId: 'dg:species' }],
  }),
  dateCreated: '2026-08-01T00:00:00.000Z',
  dateModified: '2026-08-01T00:00:00.000Z',
};

const api = vi.hoisted(() => ({
  listBackends: vi.fn(),
  getBackend: vi.fn(),
  createBackend: vi.fn(),
  updateBackend: vi.fn(),
  deleteBackend: vi.fn(),
  listLibraries: vi.fn(),
  getLibrary: vi.fn(),
  updateLibrary: vi.fn(),
  getBackendEnv: vi.fn(),
  getBackendUsage: vi.fn(),
  probeBackend: vi.fn(),
  getBackendProbeHistory: vi.fn(),
  listBackendProbes: vi.fn(),
  probeAllBackends: vi.fn(),
  listDataGraphs: vi.fn(),
  listDataGraphVersions: vi.fn(),
}));
vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));
vi.mock('vue-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

async function mountRecord(props: Record<string, unknown> = {}) {
  const wrapper = mount(BackendWorkArea, {
    // The confirm dialogs portal into document.body, so let them.
    props: { backendId: backend.id, draft: false, ...props } as never,
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

/** Open a source row's fuzzy graph chooser and click the row with this name. */
async function chooseGraph(wrapper: VueWrapper, label: string) {
  await wrapper.find('[data-testid="source-graph-select"]').trigger('click');
  await nextTick();
  const option = wrapper
    .findAll('[data-testid="source-graph-select-option"]')
    .find((candidate) => candidate.text() === label);
  if (!option) throw new Error(`no data graph option labelled "${label}"`);
  await option.trigger('click');
}

describe('BackendWorkArea', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetBackendProbesForTest();
    api.getBackend.mockResolvedValue({ data: backend, etag: '"tag"' });
    api.listBackends.mockResolvedValue([backend]);
    api.updateBackend.mockImplementation(async (_id: string, input: Record<string, unknown>) => ({
      data: { ...backend, ...input },
      etag: '"tag2"',
    }));
    api.createBackend.mockResolvedValue({ data: { ...backend, id: 'b:new' }, etag: '"tag"' });
    api.listLibraries.mockResolvedValue([
      { id: 'lib:qa', name: 'Ontology QA', defaultBackend: backend.id },
      { id: 'lib:other', name: 'Other', defaultBackend: null },
    ]);
    api.getLibrary.mockResolvedValue({ data: { id: 'lib:qa', name: 'Ontology QA', description: null, defaultBackend: backend.id }, etag: '"l"' });
    api.updateLibrary.mockResolvedValue({ data: { id: 'lib:qa', name: 'Ontology QA', defaultBackend: null }, etag: '"l2"' });
    api.getBackendEnv.mockResolvedValue({
      authEnvKey: 'WIKIDATA_PUBLIC',
      variables: [
        { name: 'SQLIB_BACKEND_WIKIDATA_PUBLIC_USERNAME', role: 'Basic auth username', set: true },
        { name: 'SQLIB_BACKEND_WIKIDATA_PUBLIC_PASSWORD', role: 'Basic auth password', set: false },
        { name: 'SQLIB_BACKEND_WIKIDATA_PUBLIC_AUTH_HEADER', role: 'Authorization header override', set: false },
      ],
    });
    api.getBackendUsage.mockResolvedValue({
      queries: { count: 41, sample: [{ id: 'q1', name: 'One' }] },
      queryGroups: { count: 6, sample: [] },
      benchmarks: { count: 3, sample: [] },
      libraries: { count: 1, sample: [] },
    });
    api.probeBackend.mockResolvedValue({
      backendId: backend.id, health: 'healthy', latencyMs: 84, product: 'Blazegraph 2.1.6',
      probedAt: new Date().toISOString(), error: null, httpStatus: 200,
    });
    api.getBackendProbeHistory.mockResolvedValue([
      { backendId: backend.id, health: 'healthy', latencyMs: 84, product: null, probedAt: new Date().toISOString(), error: null, httpStatus: 200 },
      { backendId: backend.id, health: 'unreachable', latencyMs: null, product: null, probedAt: new Date(Date.now() - 3_600_000).toISOString(), error: 'HTTP 403 Forbidden', httpStatus: 403 },
    ]);
    api.listDataGraphs.mockResolvedValue([
      { id: 'dg:species', name: 'Species reference', description: null, currentVersion: 'dgv:species:3', currentVersionNumber: 3, isPartOf: ['lib:qa'] },
      { id: 'dg:regions', name: 'Regions', description: null, currentVersion: 'dgv:regions:1', currentVersionNumber: 1, isPartOf: ['lib:qa'] },
    ]);
    api.listDataGraphVersions.mockResolvedValue([
      { id: 'dgv:species:3', isPartOf: 'dg:species', version: 3, contentString: '', contentFormat: 'text/turtle' },
    ]);
  });

  it('reads the record: name, health, environment variables and usage', async () => {
    const wrapper = await mountRecord();

    expect(wrapper.find('[data-testid="backend-record-name"]').text()).toBe('Wikidata Public');
    // Nothing has probed this backend yet, and the header says exactly that.
    expect(wrapper.find('[data-testid="backend-health-pill"]').text()).toContain('Never probed');
    expect(wrapper.find('[data-testid="backend-probe-summary"]').text()).toContain('never probed');
    expect(wrapper.find('[data-testid="backend-env-table"]').text()).toContain('SQLIB_BACKEND_WIKIDATA_PUBLIC_USERNAME');
    expect(wrapper.find('[data-testid="backend-env-table"]').text()).toContain('not set');
    // Rows, not tiles, and no libraries row — the card above already lists them.
    expect(wrapper.findAll('[data-testid="usage-row"]').map((row) => row.find('.usage-label').text()))
      .toEqual(['Queries', 'Query groups', 'Benchmarks']);
    expect(wrapper.findAll('[data-testid="usage-row"]').map((row) => row.find('.usage-count').text()))
      .toEqual(['41', '6', '3']);
    expect(wrapper.find('[data-testid="attached-library"]').text()).toContain('Ontology QA');
  });

  it('commits one field on its own, with no page-level save', async () => {
    const wrapper = await mountRecord();

    await wrapper.find('[data-testid="backend-field-name"]').trigger('click');
    await wrapper.find('[data-testid="backend-field-name-input"]').setValue('Wikidata');
    await wrapper.find('[data-testid="backend-field-name-input"]').trigger('keydown.enter');
    await flushPromises();

    expect(api.updateBackend).toHaveBeenCalledTimes(1);
    expect(api.updateBackend.mock.calls[0][1]).toMatchObject({ name: 'Wikidata', endpoint: backend.endpoint });
  });

  it('refuses an endpoint with no scheme and keeps the saved value live', async () => {
    const wrapper = await mountRecord();

    await wrapper.find('[data-testid="backend-field-endpoint"]').trigger('click');
    await wrapper.find('[data-testid="backend-field-endpoint-input"]').setValue('localhost:7878/sparql');
    await wrapper.find('[data-testid="backend-field-endpoint-input"]').trigger('keydown.enter');
    await flushPromises();

    expect(api.updateBackend).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="backend-field-endpoint-error"]').text()).toContain('scheme');
  });

  it('re-probes after the endpoint changes, because the old dot describes another store', async () => {
    const wrapper = await mountRecord();

    await wrapper.find('[data-testid="backend-field-endpoint"]').trigger('click');
    await wrapper.find('[data-testid="backend-field-endpoint-input"]').setValue('https://example.org/sparql');
    await wrapper.find('[data-testid="backend-field-endpoint-input"]').trigger('keydown.enter');
    await flushPromises();

    expect(api.updateBackend).toHaveBeenCalledTimes(1);
    expect(api.probeBackend).toHaveBeenCalledWith(backend.id);
  });

  it('switches the query method straight from the segmented control', async () => {
    const wrapper = await mountRecord();

    await wrapper.find('[data-testid="query-method-get"]').trigger('click');
    await flushPromises();

    expect(api.updateBackend.mock.calls[0][1]).toMatchObject({ queryMethod: 'get' });
  });

  it('holds an environment key rename behind a confirm that names both sets of variables', async () => {
    const wrapper = await mountRecord();

    await wrapper.find('[data-testid="backend-field-env-key"]').trigger('click');
    await wrapper.find('[data-testid="backend-field-env-key-input"]').setValue('wikidata mirror');
    await wrapper.find('[data-testid="backend-field-env-key-input"]').trigger('keydown.enter');
    await flushPromises();

    // Nothing saved yet — the confirm owns the decision.
    expect(api.updateBackend).not.toHaveBeenCalled();
    const confirm = document.body.textContent ?? '';
    expect(confirm).toContain('SQLIB_BACKEND_WIKIDATA_PUBLIC_USERNAME');
    expect(confirm).toContain('SQLIB_BACKEND_WIKIDATA_MIRROR_USERNAME');

    document.querySelector<HTMLElement>('[data-testid="confirm-env-key-rename"]')!.click();
    await flushPromises();

    expect(api.updateBackend.mock.calls[0][1]).toMatchObject({ authEnvKey: 'WIKIDATA_MIRROR' });
  });

  it('probes once on Test connection and moves the header', async () => {
    const wrapper = await mountRecord();

    await wrapper.find('[data-testid="test-connection"]').trigger('click');
    await flushPromises();

    expect(api.probeBackend).toHaveBeenCalledWith(backend.id);
    expect(wrapper.find('[data-testid="backend-health-pill"]').text()).toContain('Healthy');
    expect(wrapper.find('[data-testid="backend-health-card"]').text()).toContain('Answered in 84 ms');
    expect(wrapper.find('[data-testid="backend-product"]').text()).toBe('Blazegraph 2.1.6');
  });

  it('creates from a draft record rather than a dialog, and probes the new backend once', async () => {
    const wrapper = await mountRecord({ backendId: null, draft: true });

    const create = wrapper.find('[data-testid="create-backend"]');
    expect(create.attributes('disabled')).toBeDefined();

    await wrapper.find('[data-testid="backend-draft-name"]').setValue('New store');
    // The environment key fills itself in from the name.
    expect((wrapper.find('[data-testid="backend-draft-env-key"]').element as HTMLInputElement).value).toBe('NEW_STORE');

    await wrapper.find('[data-testid="backend-draft-endpoint"]').setValue('http://localhost:7878/sparql');
    expect(wrapper.find('[data-testid="create-backend"]').attributes('disabled')).toBeUndefined();

    await wrapper.find('[data-testid="create-backend"]').trigger('click');
    await flushPromises();

    expect(api.createBackend).toHaveBeenCalledWith(expect.objectContaining({
      name: 'New store',
      endpoint: 'http://localhost:7878/sparql',
      authEnvKey: 'NEW_STORE',
      backendType: 'http',
      queryMethod: 'post',
    }));
    expect(api.probeBackend).toHaveBeenCalledWith('b:new');
    expect(wrapper.emitted('created')).toHaveLength(1);
  });

  it('keeps Create disabled while the endpoint has no scheme', async () => {
    const wrapper = await mountRecord({ backendId: null, draft: true });

    await wrapper.find('[data-testid="backend-draft-name"]').setValue('New store');
    await wrapper.find('[data-testid="backend-draft-endpoint"]').setValue('localhost:7878');

    expect(wrapper.find('[data-testid="create-backend"]').attributes('disabled')).toBeDefined();
  });
  it('says a 403 on the service description may still answer queries', async () => {
    api.probeBackend.mockResolvedValue({
      backendId: backend.id, health: 'unreachable', latencyMs: 61, product: null,
      probedAt: new Date().toISOString(), error: 'HTTP 403 Forbidden', httpStatus: 403,
    });
    const wrapper = await mountRecord();

    await wrapper.find('[data-testid="test-connection"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="backend-health-pill"]').text()).toContain('Unreachable');
    expect(wrapper.find('[data-testid="backend-health-message"]').text())
      .toBe('403 on the service description. Queries may still succeed.');
    expect(wrapper.find('[data-testid="backend-probe-summary"]').text()).toContain('HTTP 403 Forbidden');
  });

  it('loads the probe history only when it is asked for', async () => {
    const wrapper = await mountRecord();

    expect(api.getBackendProbeHistory).not.toHaveBeenCalled();
    expect(wrapper.find('[data-testid="probe-history-list"]').exists()).toBe(false);

    await wrapper.find('[data-testid="probe-history"]').trigger('click');
    await flushPromises();

    expect(api.getBackendProbeHistory).toHaveBeenCalledWith(backend.id);
    expect(wrapper.findAll('.history-row')).toHaveLength(2);
    expect(wrapper.find('[data-testid="probe-history-list"]').text()).toContain('HTTP 403 Forbidden');
  });

  it('follows a Used by row to the list that holds them, and leaves zeroes inert', async () => {
    const wrapper = await mountRecord();
    const rows = wrapper.findAll('[data-testid="usage-row"]');

    await rows[0].trigger('click');
    expect(wrapper.emitted('open-usage')?.[0]).toEqual(['queries']);

    api.getBackendUsage.mockResolvedValue({
      queries: { count: 0, sample: [] },
      queryGroups: { count: 0, sample: [] },
      benchmarks: { count: 0, sample: [] },
      libraries: { count: 0, sample: [] },
    });
    const empty = await mountRecord();
    expect(empty.find('[data-testid="usage-row"]').attributes('disabled')).toBeDefined();
  });

  it('creates an in-memory backend hydrated from a data graph', async () => {
    const wrapper = await mountRecord({ backendId: null, draft: true });

    await wrapper.find('[data-testid="backend-kind-oxigraphMemory"]').setValue();
    await flushPromises();

    // No wire to describe: the endpoint field belongs to HTTP backends only.
    expect(wrapper.find('[data-testid="backend-draft-endpoint"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="backend-draft-env-key"]').exists()).toBe(false);

    await wrapper.find('[data-testid="backend-draft-name"]').setValue('Reference data');
    // An unseeded store is legitimate, so a name alone is enough…
    expect(wrapper.find('[data-testid="create-backend"]').attributes('disabled')).toBeUndefined();

    // …but a half-filled source row is not.
    await wrapper.find('[data-testid="add-memory-source"]').trigger('click');
    expect(wrapper.find('[data-testid="create-backend"]').attributes('disabled')).toBeDefined();

    await chooseGraph(wrapper, 'Species reference');
    expect(wrapper.find('[data-testid="create-backend"]').attributes('disabled')).toBeUndefined();

    await wrapper.find('[data-testid="store-mode-durable"]').setValue();
    await wrapper.find('[data-testid="create-backend"]').trigger('click');
    await flushPromises();

    expect(api.createBackend).toHaveBeenCalledTimes(1);
    const payload = api.createBackend.mock.calls[0][0];
    expect(payload).toMatchObject({ name: 'Reference data', backendType: 'oxigraphMemory', endpoint: null, authEnvKey: null });
    expect(JSON.parse(payload.oxigraphConfig)).toEqual({
      storeType: 'durable',
      mode: 'durable',
      sources: [{ dataGraphId: 'dg:species' }],
    });
    expect(wrapper.emitted('created')).toHaveLength(1);
  });

  it('reads a memory backend as a store, not a connection', async () => {
    api.getBackend.mockResolvedValue({ data: memoryBackend, etag: '"tag"' });
    const wrapper = await mountRecord({ backendId: memoryBackend.id });

    expect(wrapper.find('[data-testid="backend-store-section"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="backend-store-type"]').text()).toBe('In-memory Oxigraph');
    expect(wrapper.find('[data-testid="backend-field-endpoint"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="backend-env-table"]').exists()).toBe(false);
    expect(api.getBackendEnv).not.toHaveBeenCalled();

    const graphInput = wrapper.find('[data-testid="source-graph-select"]');
    expect((graphInput.element as HTMLInputElement).value).toBe('Species reference');
  });

  it('commits a store mode change straight from the segmented control', async () => {
    api.getBackend.mockResolvedValue({ data: memoryBackend, etag: '"tag"' });
    api.updateBackend.mockImplementation(async (_id: string, input: Record<string, unknown>) => ({
      data: { ...memoryBackend, ...input },
      etag: '"tag2"',
    }));
    const wrapper = await mountRecord({ backendId: memoryBackend.id });

    await wrapper.find('[data-testid="store-mode-ephemeral"]').trigger('click');
    await flushPromises();

    expect(api.updateBackend).toHaveBeenCalledTimes(1);
    const input = api.updateBackend.mock.calls[0][1];
    expect(input.endpoint).toBeNull();
    expect(JSON.parse(input.oxigraphConfig)).toMatchObject({
      mode: 'ephemeral',
      storeType: 'ephemeral',
      sources: [{ dataGraphId: 'dg:species' }],
    });
  });

  it('commits the shorter source list when a row is removed', async () => {
    api.getBackend.mockResolvedValue({ data: memoryBackend, etag: '"tag"' });
    api.updateBackend.mockImplementation(async (_id: string, input: Record<string, unknown>) => ({
      data: { ...memoryBackend, ...input },
      etag: '"tag2"',
    }));
    const wrapper = await mountRecord({ backendId: memoryBackend.id });

    await wrapper.find('[data-testid="source-remove"]').trigger('click');
    await flushPromises();

    expect(api.updateBackend).toHaveBeenCalledTimes(1);
    expect(JSON.parse(api.updateBackend.mock.calls[0][1].oxigraphConfig).sources).toEqual([]);
  });

  it('says None attached when no library points here', async () => {
    api.listLibraries.mockResolvedValue([{ id: 'lib:other', name: 'Other', defaultBackend: null }]);
    const wrapper = await mountRecord();
    await flushPromises();

    expect(wrapper.find('[data-testid="attached-library"]').exists()).toBe(false);
    expect(wrapper.find('.card-empty').text()).toBe('None attached.');
  });

  /*
   * Each kind is asked for what it has. A browser backend has an endpoint and
   * a method and nothing else: no environment key, because its credentials
   * never leave the browser, and no store fields, which belong to the
   * in-process Oxigraph. They reached it through a `v-else` that caught every
   * kind that was not `http`.
   */
  describe('the draft form asks only for the chosen kind\'s fields', () => {
    it('gives an HTTP backend its method and environment key', async () => {
      const wrapper = await mountRecord({ backendId: null, draft: true });

      expect(wrapper.find('[data-testid="backend-draft-env-key"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="store-mode-readOnly"]').exists()).toBe(false);
    });

    it('gives a browser backend its method, and neither the key nor the store', async () => {
      const wrapper = await mountRecord({ backendId: null, draft: true });
      await wrapper.find('[data-testid="backend-kind-browser"]').setValue();
      await nextTick();

      expect(wrapper.find('[data-testid="backend-draft-env-key"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="store-mode-readOnly"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="browser-backend-note"]').exists()).toBe(true);
      expect(wrapper.text()).toContain('Query method');
    });

    it('gives an in-memory backend the store fields and no endpoint', async () => {
      const wrapper = await mountRecord({ backendId: null, draft: true });
      await wrapper.find('[data-testid="backend-kind-oxigraphMemory"]').setValue();
      await nextTick();

      expect(wrapper.find('[data-testid="store-mode-readOnly"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="backend-draft-endpoint"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="backend-draft-env-key"]').exists()).toBe(false);
    });
  });

  /*
   * Copy and Delete sat behind a ⋮ that had to be opened to find out it held
   * one thing anybody wants and one nobody wants by accident. They are where
   * every other record keeps them: the id beside a copy button in Identity,
   * Delete at the foot. The confirm stays the page's dialog, which names what
   * points at the backend — worth more than an in-place "are you sure".
   */
  describe('copy and delete, out of the overflow menu', () => {
    it('shows the id with a copy button beside it', async () => {
      const wrapper = await mountRecord();

      expect(wrapper.find('[data-testid="backend-id"]').text()).toBe(backend.id);
      expect(wrapper.find('[data-testid="copy-backend-id"]').exists()).toBe(true);
      expect(wrapper.find('[data-testid="backend-overflow"]').exists()).toBe(false);
    });

    it('asks the page to delete, from the footer', async () => {
      const wrapper = await mountRecord();

      await wrapper.find('[data-testid="delete-backend"]').trigger('click');

      expect(wrapper.emitted('delete-request')).toEqual([
        [{ backendId: backend.id, backendName: backend.name }],
      ]);
    });
  });

  /*
   * A browser backend is registered in this browser and nowhere else, so every
   * edit on this screen has to go there. They all went to `PUT /backends/:id`,
   * which is a request about a record the server has never seen: a 404 where
   * it can write, a 405 where it cannot. Renaming one is the whole reason this
   * screen is where naming a pasted endpoint happens.
   */
  describe('a backend registered in this browser', () => {
    const browserBackend = {
      id: 'urn:sqlib:browser-backend:wikidata',
      name: 'query.wikidata.org/sparql',
      description: null,
      endpoint: 'https://query.wikidata.org/sparql',
      queryMethod: null,
      headers: {},
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
    };

    beforeEach(async () => {
      const { useBrowserBackends } = await import('@/composables/useBrowserBackends');
      const store = useBrowserBackends();
      for (const record of [...store.records.value]) store.remove(record.id);
      store.save(browserBackend);
    });

    it('renames it in the browser, without asking the server', async () => {
      const { useBrowserBackends } = await import('@/composables/useBrowserBackends');
      const wrapper = await mountRecord({ backendId: browserBackend.id });

      await wrapper.find('[data-testid="backend-field-name"]').trigger('click');
      await wrapper.find('[data-testid="backend-field-name-input"]').setValue('Wikidata');
      await wrapper.find('[data-testid="backend-field-name-input"]').trigger('keydown.enter');
      await flushPromises();

      expect(api.updateBackend).not.toHaveBeenCalled();
      expect(useBrowserBackends().get(browserBackend.id)?.name).toBe('Wikidata');
    });

    it('changes its query method the same way', async () => {
      const { useBrowserBackends } = await import('@/composables/useBrowserBackends');
      const wrapper = await mountRecord({ backendId: browserBackend.id });

      const get = wrapper.findAll('button').find((b) => b.text() === 'GET');
      await get!.trigger('click');
      await flushPromises();

      expect(api.updateBackend).not.toHaveBeenCalled();
      expect(useBrowserBackends().get(browserBackend.id)?.queryMethod).toBe('get');
    });

    /*
     * A probe is the server reporting what it found at the URL, and it does
     * not know this backend exists; the environment table is about variables
     * on the machine running the query, which for this one is the visitor's.
     */
    it('shows neither the probe card nor the environment table', async () => {
      const wrapper = await mountRecord({ backendId: browserBackend.id });

      expect(wrapper.find('[data-testid="backend-sidecar"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="backend-env-table"]').exists()).toBe(false);
    });

    /* The header said "Never probed — run Test again" beside no such button. */
    it('claims nothing about a probe in its header', async () => {
      const wrapper = await mountRecord({ backendId: browserBackend.id });

      expect(wrapper.find('[data-testid="backend-health-pill"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="backend-probe-summary"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="backend-record-name"]').text()).toBe(browserBackend.name);
    });
  });

  /*
   * A read-only deployment refuses `POST /backends`, so it offers the browser
   * kind alone — and the draft has to *open* on it. Resetting to `http` left
   * the form on a kind no radio could select: server-side fields on screen,
   * nothing chosen, and Create posting for the 405 it was always going to get.
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

    it('opens a new draft on the only kind it can create', async () => {
      const wrapper = await mountRecord({ backendId: null, draft: true });

      const chosen = wrapper.find('[data-testid="backend-kind-browser"]').element as HTMLInputElement;
      expect(chosen.checked).toBe(true);
      expect(wrapper.find('[data-testid="backend-kind-http"]').exists()).toBe(false);
      expect(wrapper.find('[data-testid="backend-draft-env-key"]').exists()).toBe(false);
    });

    it('creates it in the browser, without asking the server', async () => {
      const wrapper = await mountRecord({ backendId: null, draft: true });

      await wrapper.find('[data-testid="backend-draft-name"]').setValue('nlib finland');
      await wrapper.find('[data-testid="backend-draft-endpoint"]')
        .setValue('https://data.nationallibrary.fi/bib/sparql');
      await wrapper.find('[data-testid="create-backend"]').trigger('click');
      await flushPromises();

      expect(api.createBackend).not.toHaveBeenCalled();
      expect(api.probeBackend).not.toHaveBeenCalled();
      const created = wrapper.emitted('created');
      expect(created).toHaveLength(1);
      expect((created![0][0] as { endpoint: string }).endpoint)
        .toBe('https://data.nationallibrary.fi/bib/sparql');
    });
  });
});
