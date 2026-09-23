/**
 * Saving what the library page is holding as a test, tags included.
 *
 * The dialog's own job is two writes in order — an argument set on the query,
 * then a test whose first case points at it — and these specs are about the
 * third thing it now decides: whether the new test carries the query's tags.
 * As on the scratch editor, the assertion is about the *shape* of the create
 * body rather than a list of tag IRIs. The copy itself is the server's; what
 * the dialog sends is either nothing at all or an explicit `[]`.
 *
 * The dialog portals its content, so everything is queried from `document`
 * rather than from the wrapper.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import SaveAsTestDialog from '@/components/notebook/SaveAsTestDialog.vue';

const LIBRARY = 'urn:sqlib:library:lib1';
const QUERY = 'urn:sqlib:query:q1';
const W3C = 'urn:sqlib:tag:w3c';

const api = vi.hoisted(() => ({
  createArgumentSet: vi.fn(),
  createTest: vi.fn(),
  createTestVersion: vi.fn(),
  listTags: vi.fn(),
  updateQuery: vi.fn(),
  updateQueryGroup: vi.fn(),
  updateRuleSet: vi.fn(),
  updateTest: vi.fn(),
  updateDataGraph: vi.fn(),
}));
vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));

vi.mock('@/composables/useQueriesStore', () => ({
  useQueriesStore: () => ({
    queries: { value: [{ id: QUERY, name: 'Airports', isPartOf: [LIBRARY], tags: [W3C] }] },
    loadQueries: vi.fn(),
  }),
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

function mountDialog() {
  return mount(SaveAsTestDialog, {
    props: {
      open: true,
      libraryId: LIBRARY,
      queryId: QUERY,
      queryName: 'Airports',
      queryType: 'SELECT',
      payload: { arguments: [], limits: {}, offsets: {} },
      result: null,
      backendId: 'urn:sqlib:backend:b1',
    },
    attachTo: document.body,
  });
}

/** The portal puts the content on `document.body`, not inside the wrapper. */
function inDialog(selector: string): HTMLElement | null {
  return document.querySelector(selector);
}

async function clickCreate() {
  const buttons = Array.from(document.querySelectorAll('button'));
  const create = buttons.find((button) => button.textContent?.trim() === 'Create test');
  if (!create) throw new Error('no "Create test" button');
  create.click();
  await flushPromises();
}

describe('SaveAsTestDialog — copying the query’s tags', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    api.listTags.mockResolvedValue([{ id: W3C, name: 'w3c', color: '#2f6feb', isPartOf: LIBRARY }]);
    api.createArgumentSet.mockResolvedValue({ data: { id: 'urn:as:1', currentVersion: { id: 'urn:asv:1' } } });
    api.createTest.mockResolvedValue({ data: { id: 'urn:sqlib:test:t1' } });
    api.createTestVersion.mockResolvedValue({ data: { id: 'urn:tv:1' } });
  });

  it('offers the copy, ticked, naming the query’s tags', async () => {
    mountDialog();
    await flushPromises();

    const toggle = inDialog('[data-testid="inherit-tags-toggle"]');
    expect(toggle).not.toBeNull();
    expect(toggle!.textContent).toContain('Copy 1 tag from the query');
    expect(inDialog(`[data-testid="inherit-tag-chip-${W3C}"]`)).not.toBeNull();
    expect((inDialog('[data-testid="inherit-tags-checkbox"]') as HTMLInputElement).checked).toBe(true);
  });

  it('leaves tags out of the create body while ticked', async () => {
    mountDialog();
    await flushPromises();

    await clickCreate();

    expect(api.createTest).toHaveBeenCalledTimes(1);
    expect(api.createTest.mock.calls[0][0]).not.toHaveProperty('tags');
  });

  it('sends an empty array once unticked', async () => {
    mountDialog();
    await flushPromises();

    const checkbox = inDialog('[data-testid="inherit-tags-checkbox"]') as HTMLInputElement;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    await flushPromises();

    await clickCreate();

    expect(api.createTest).toHaveBeenCalledTimes(1);
    expect(api.createTest.mock.calls[0][0]).toMatchObject({ tags: [] });
  });
});
