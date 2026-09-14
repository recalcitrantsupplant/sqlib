/**
 * The sync dialog: what it offers for a given store's capability, and what it
 * refuses to apply.
 *
 * The merge itself is tested in `test/lib/prefixSyncPlan.test.ts` — this file
 * is about the gates around it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick, computed, ref } from 'vue';

const mockLocalStorage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => mockLocalStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { mockLocalStorage[key] = value; }),
  removeItem: vi.fn((key: string) => { delete mockLocalStorage[key]; }),
  clear: vi.fn(() => { for (const key in mockLocalStorage) delete mockLocalStorage[key]; }),
});

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const backends = [
  { id: 'urn:backend:rw', name: 'Fuseki RW' },
  { id: 'urn:backend:ro', name: 'Fuseki RO' },
  { id: 'urn:backend:none', name: 'Blazegraph' },
];

const capabilities: Record<string, unknown> = {
  'urn:backend:rw': { read: 'jena-prefixes', write: 'jena-prefixes', readEndpoint: 'x', writeEndpoint: 'y', count: 2 },
  'urn:backend:ro': { read: 'jena-prefixes', write: null, readEndpoint: 'x', writeEndpoint: null, count: 1 },
  'urn:backend:none': { read: null, write: null, readEndpoint: null, writeEndpoint: null, count: null },
};

const getBackendPrefixes = vi.fn();
const pushBackendPrefixes = vi.fn();

vi.mock('@/composables/useApiClient', () => ({
  useApiClient: () => ({ getBackendPrefixes, pushBackendPrefixes }),
}));

vi.mock('@/composables/useBackendsStore', () => ({
  useBackendsStore: () => ({ backends: computed(() => backends), loadBackends: vi.fn() }),
}));

vi.mock('@/composables/useBackendProbes', () => ({
  useBackendProbes: () => ({
    loadProbes: vi.fn(),
    probeFor: (id: string) => ({ backendId: id, prefixes: capabilities[id] ?? null }),
  }),
}));

async function open(mappings: unknown[] = []) {
  localStorage.setItem(
    'sparqlQueryLib.prefixSettings',
    JSON.stringify({ duplicateResolution: 'longest', mappings, showTooltips: true }),
  );
  const { mount } = await import('@vue/test-utils');
  const { default: PrefixSyncDialog } = await import('@/components/PrefixSyncDialog.vue');
  const wrapper = mount(PrefixSyncDialog, { props: { open: true }, attachTo: document.body });
  await nextTick();
  await nextTick();
  return wrapper;
}

/** Open the backend chooser and return its rows. */
async function backendOptions(): Promise<HTMLElement[]> {
  const input = document.querySelector('[data-testid="prefix-sync-backend"]') as HTMLElement;
  input.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await nextTick();
  await nextTick();
  return [...document.querySelectorAll('[data-testid="prefix-sync-backend-option"]')] as HTMLElement[];
}

/** Choose a backend by name and let the remote read settle. */
async function choose(name: string) {
  const option = (await backendOptions()).find((row) => row.textContent?.includes(name));
  if (!option) throw new Error(`no backend option for "${name}"`);
  option.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await nextTick();
  await nextTick();
  await nextTick();
}

function directionButton(label: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('.direction-card')].find(
    (element) => element.textContent?.includes(label)
  ) as HTMLButtonElement | undefined;
}

function applyButton(): HTMLButtonElement {
  return document.querySelector('.sync-footer .btn-primary') as HTMLButtonElement;
}

const mapping = (prefix: string, namespace: string, overrides: Record<string, unknown> = {}) => ({
  id: `id-${prefix}`,
  prefix,
  namespace,
  enabled: true,
  isDefault: false,
  source: 'user-added',
  createdAt: 0,
  ...overrides,
});

describe('PrefixSyncDialog', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.clearAllMocks();
    document.body.innerHTML = '';
    getBackendPrefixes.mockResolvedValue({ mappings: [], source: 'jena-prefixes', readOnly: false, endpoint: 'x' });
    pushBackendPrefixes.mockResolvedValue({ results: [], applied: 0, failed: 0 });
  });

  it('annotates each backend with what it can do, and disables the one that can do nothing', async () => {
    await open();

    const rows = await backendOptions();
    const text = (name: string) => rows.find((row) => row.textContent?.includes(name));

    expect(text('Fuseki RW')?.textContent).toContain('read/write');
    expect(text('Fuseki RO')?.textContent).toContain('read-only');
    expect(text('Blazegraph')?.textContent).toContain('no prefix service');
    expect(text('Blazegraph')?.hasAttribute('data-disabled')).toBe(true);
  });

  it('offers only Pull for a store that exposes its prefixes read-only, and says why', async () => {
    await open();
    await choose('Fuseki RO');

    expect(directionButton('Push')?.disabled).toBe(true);
    expect(directionButton('Both ways')?.disabled).toBe(true);
    expect(directionButton('Pull')?.disabled).toBe(false);
    expect(document.querySelector('.field-note')?.textContent).toContain('prefixes-rw');
  });

  it('previews what a pull would do without touching anything', async () => {
    getBackendPrefixes.mockResolvedValue({
      mappings: [{ prefix: 'ex', namespace: 'http://example.org/' }],
      source: 'jena-prefixes',
      readOnly: false,
      endpoint: 'x',
    });

    await open();
    await choose('Fuseki RW');

    expect(document.querySelector('.preview')?.textContent).toContain('Add here (1)');
    expect(pushBackendPrefixes).not.toHaveBeenCalled();
    expect(applyButton().textContent).toContain('Apply 1 change');
  });

  it('will not apply while a conflict is unanswered', async () => {
    getBackendPrefixes.mockResolvedValue({
      mappings: [{ prefix: 'ex', namespace: 'http://theirs/' }],
      source: 'jena-prefixes',
      readOnly: false,
      endpoint: 'x',
    });

    await open([mapping('ex', 'http://ours/')]);
    await choose('Fuseki RW');
    directionButton('Both ways')?.click();
    await nextTick();

    expect(document.querySelector('.conflict-row')).not.toBeNull();
    expect(applyButton().disabled).toBe(true);
    expect(document.querySelector('.sync-footer')?.textContent).toContain('Resolve every conflict');

    const takeRemote = [...document.querySelectorAll('.resolution')].find(
      (element) => element.textContent === 'Take remote'
    ) as HTMLButtonElement;
    takeRemote.click();
    await nextTick();

    expect(applyButton().disabled).toBe(false);
  });

  it('confirms before a mirror deletes anything from the store', async () => {
    getBackendPrefixes.mockResolvedValue({
      mappings: [{ prefix: 'theirs', namespace: 'http://theirs/' }],
      source: 'jena-prefixes',
      readOnly: false,
      endpoint: 'x',
    });

    await open([mapping('ours', 'http://ours/')]);
    await choose('Fuseki RW');
    directionButton('Push')?.click();
    await nextTick();

    const mirror = document.querySelector('.checkbox input') as HTMLInputElement;
    mirror.checked = true;
    mirror.dispatchEvent(new Event('change'));
    await nextTick();

    applyButton().click();
    await nextTick();

    expect(document.body.textContent).toContain('Delete prefixes from the store?');
    expect(pushBackendPrefixes).not.toHaveBeenCalled();
  });

  it('reports what the store refused rather than claiming the push landed', async () => {
    getBackendPrefixes.mockResolvedValue({ mappings: [], source: 'jena-prefixes', readOnly: false, endpoint: 'x' });
    pushBackendPrefixes.mockResolvedValue({
      results: [{ prefix: 'ours', action: 'upsert', status: 'failed', error: 'HTTP 400: nope' }],
      applied: 0,
      failed: 1,
    });

    await open([mapping('ours', 'http://ours/')]);
    await choose('Fuseki RW');
    directionButton('Push')?.click();
    await nextTick();

    applyButton().click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await nextTick();

    expect(pushBackendPrefixes).toHaveBeenCalledWith('urn:backend:rw', {
      upserts: [{ prefix: 'ours', namespace: 'http://ours/' }],
      deletes: [],
    });
    expect(document.querySelector('.outcome')?.textContent).toContain('1 refused by the store');
    expect(document.querySelector('.failures')?.textContent).toContain('HTTP 400: nope');
  });
});
