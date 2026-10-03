/**
 * The query record page, mounted whole against a fake API.
 *
 * Every store and composable the work area uses is the real one; only the API
 * client beneath them is fake (`test/fixtures/fakeApiClient.ts`), so what these
 * specs pin is the round trip: what the screen shows for a query the server
 * returned, and what it sends back when you save or run it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import QueryWorkArea from '@/components/QueryWorkArea.vue';
import type { FakeApiClient } from '../fixtures/fakeApiClient';

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
const QUERY_ID = 'urn:sqlib:query:countries';
const VERSION_ID = 'urn:sqlib:query-version:countries-2';
const BACKEND_ID = 'urn:sqlib:backend:wikidata';
const QUERY_TEXT = 'SELECT ?country WHERE { ?country a <http://example.org/Country> }';
const EDITED_TEXT = 'SELECT ?country WHERE { ?country a <http://example.org/Nation> }';
const SELECT_TYPE = 'https://sparql-query-lib/query-type/select';

const query = {
  id: QUERY_ID,
  name: 'Countries of the world',
  description: 'Every country, by IRI.',
  currentVersion: VERSION_ID,
  currentVersionNumber: 2,
  defaultBackend: BACKEND_ID,
  isPartOf: [LIBRARY_ID],
  dateCreated: '2026-09-01T00:00:00.000Z',
  dateModified: '2026-09-02T00:00:00.000Z',
};

const versionTwo = {
  id: VERSION_ID,
  isPartOf: QUERY_ID,
  version: 2,
  immutable: true,
  queryString: QUERY_TEXT,
  comment: null,
  queryType: SELECT_TYPE,
  dateCreated: '2026-09-02T00:00:00.000Z',
  dateModified: '2026-09-02T00:00:00.000Z',
};

const versionOne = {
  ...versionTwo,
  id: 'urn:sqlib:query-version:countries-1',
  version: 1,
  queryString: 'SELECT * WHERE { ?s ?p ?o }',
};

/** An expanded version, the shape `GET /queries/:id/v/:n` and `POST …/v` return. */
function expanded(version: typeof versionTwo) {
  return {
    queryVersion: version,
    limitParameters: [],
    offsetParameters: [],
    inputs: [],
    outputs: [],
    inputTuples: [],
    outputTuples: [],
    tupleMembers: [],
  };
}

/**
 * CodeMirror stands in as a textarea, as it does in the rule set specs: the
 * work area only cares that text goes in and comes back out.
 */
const EditorStub = {
  props: ['sparqlCode'],
  emits: ['update:sparqlCode'],
  template:
    '<textarea aria-label="Query editor" :value="sparqlCode" '
    + '@input="$emit(\'update:sparqlCode\', $event.target.value)"></textarea>',
};

function api(): FakeApiClient {
  if (!fake.api) throw new Error('the fake API client was not created');
  return fake.api;
}

async function mountSaved() {
  const wrapper = mount(QueryWorkArea, {
    props: { creationRequest: null, queryId: QUERY_ID, scratchId: null },
    global: { stubs: { SparqlEditorPanel: EditorStub } },
  });
  await flushPromises();
  return wrapper;
}

function editor(wrapper: Awaited<ReturnType<typeof mountSaved>>) {
  return wrapper.get('textarea[aria-label="Query editor"]').element as HTMLTextAreaElement;
}

beforeEach(() => {
  toasts.error.length = 0;
  toasts.success.length = 0;
  try { localStorage.clear(); } catch { /* no storage in this environment */ }

  const fakeApi = api();
  fakeApi.reset();
  fakeApi.responses.getQuery = (id: string) => ({ data: { ...query, id }, etag: '"q1"' });
  fakeApi.responses.listQueryVersions = () => [versionTwo, versionOne];
  fakeApi.responses.getQueryVersion = (_id: string, number: number) => ({
    data: expanded(number === 1 ? versionOne : versionTwo),
    etag: `"v${number}"`,
  });
  fakeApi.responses.listBackends = () => [
    {
      id: BACKEND_ID,
      name: 'Wikidata',
      description: null,
      backendType: 'http',
      endpoint: 'https://query.wikidata.org/sparql',
      authEnvKey: null,
      queryMethod: 'post',
      oxigraphConfig: null,
    },
  ];
  fakeApi.responses.validateQuery = () => ({ valid: true, queryType: SELECT_TYPE });
  fakeApi.responses.detectInputs = () => ({ valuesInputs: [], limitParameters: [], offsetParameters: [] });
  fakeApi.responses.detectOutputs = () => ({ outputs: ['country'] });
});

describe('QueryWorkArea — a saved query, mounted against the API', () => {
  it('loads the query and shows its name and current version\'s text', async () => {
    const wrapper = await mountSaved();

    expect(api().callsTo('getQuery')).toEqual([[QUERY_ID]]);
    expect(wrapper.get('[data-testid="save-bar"]').text()).toContain('Countries of the world');
    expect(wrapper.get('[data-testid="version-pill"]').text()).toContain('v2');
    expect(editor(wrapper).value).toBe(QUERY_TEXT);
    expect(toasts.error).toEqual([]);
  });

  it('saves an edit as the next version, sending the edited text', async () => {
    const wrapper = await mountSaved();
    const saveButton = wrapper.get('[data-testid="save"]');
    // Nothing edited, nothing to save.
    expect(saveButton.attributes('disabled')).toBeDefined();

    api().responses.createQueryVersion = (id: string) => ({
      data: { ...expanded({ ...versionTwo, id: 'urn:sqlib:query-version:countries-3', version: 3, queryString: EDITED_TEXT, isPartOf: id }), iriMap: {} },
      etag: '"v3"',
    });

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await wrapper.get('textarea[aria-label="Query editor"]').setValue(EDITED_TEXT);
    // Edits become a draft after a short debounce; only then is there
    // something to save.
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    await flushPromises();

    expect(wrapper.get('[data-testid="draft-pill"]').text()).toMatch(/1 unsaved edit/);
    expect(saveButton.attributes('disabled')).toBeUndefined();

    await saveButton.trigger('click');
    await flushPromises();

    expect(api().callsTo('createQueryVersion')).toEqual([
      [QUERY_ID, { queryVersion: { queryString: EDITED_TEXT, comment: null } }],
    ]);
    expect(toasts.error).toEqual([]);
    expect(wrapper.get('[data-testid="version-pill"]').text()).toContain('v3');
    expect(wrapper.find('[data-testid="draft-pill"]').exists()).toBe(false);
  });

  /*
   * The current version runs by the query's own id (so the server resolves
   * "current" itself); only a non-current version is named by its version id.
   */
  it('runs the query against its default backend', async () => {
    const wrapper = await mountSaved();
    api().responses.executeTarget = () => ({
      body: 'country\r\nhttp://example.org/France\r\n',
      contentType: 'text/csv',
      timing: { clientTotalMs: 12 },
    });

    const run = wrapper.get('[data-testid="run-bar-run"]');
    expect(run.attributes('disabled')).toBeUndefined();
    await run.trigger('click');
    await flushPromises();

    const executions = api().callsTo('executeTarget');
    expect(executions).toHaveLength(1);
    const [payload, accept] = executions[0] as [Record<string, unknown>, string];
    expect(payload).toMatchObject({ targetId: QUERY_ID, backendId: BACKEND_ID });
    // A SELECT asks for CSV unless another format is picked in the run bar.
    expect(accept).toBe('text/csv');
    expect(toasts.error).toEqual([]);
    expect(wrapper.text()).toContain('http://example.org/France');
  });
});
