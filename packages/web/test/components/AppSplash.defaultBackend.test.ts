/**
 * The landing screen's default-backend picker.
 *
 * The active library's default backend used to be a status fact in the strip
 * at the foot of the screen; where the deployment can write, it is now a
 * fuzzy picker beside it. Setting a default where there was none just saves;
 * replacing one moves every query that leans on it, so that asks first.
 *
 * Everything the splash reads besides libraries and backends — the inventory,
 * probes, tests, the palette — is replaced with a quiet stand-in: none of it
 * is what is under test, and each would otherwise reach for the network.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { computed, nextTick } from 'vue';
import { EPHEMERAL_BACKEND_ID } from '@sparql-query-lib/types';
import { resetDeploymentMode, useDeploymentMode } from '@/composables/useDeploymentMode';

const api = vi.hoisted(() => ({
  listLibraries: vi.fn(),
  getLibrary: vi.fn(),
  updateLibrary: vi.fn(),
  listBackends: vi.fn(),
}));
vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));
vi.mock('vue-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/composables/useLibraryInventory', () => ({
  useLibraryInventory: () => ({
    counts: computed(() => ({})),
    totalItems: computed(() => 0),
    activity: computed(() => []),
    load: vi.fn(async () => undefined),
  }),
}));
vi.mock('@/composables/useBackendProbes', () => ({
  useBackendProbes: () => ({ healthFor: () => 'never_probed', loadProbes: vi.fn(async () => undefined) }),
}));
vi.mock('@/composables/useTestsStore', () => ({
  useTestsStore: () => ({ tests: computed(() => []), lastRunByTest: computed(() => ({})) }),
}));
vi.mock('@/composables/useCommandPalette', () => ({ useCommandPalette: () => ({ openPalette: vi.fn() }) }));
vi.mock('@/composables/useFeatureFlags', () => ({ useFeatureFlags: () => ({ isEnabled: () => true }) }));

const BACKENDS = [
  { id: 'b:visual', name: 'Visual Backend', backendType: 'http' },
  { id: 'b:wikidata', name: 'Wikidata', backendType: 'http' },
  { id: EPHEMERAL_BACKEND_ID, name: 'In-memory', backendType: 'oxigraphMemory' },
];

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

let wrapper: VueWrapper | null = null;

async function mountSplash(defaultBackend: string | null) {
  const library = { id: 'lib:qa', name: 'Ontology QA', description: null, defaultBackend };
  api.listLibraries.mockResolvedValue([library]);
  api.getLibrary.mockResolvedValue({ data: library, etag: '"l1"' });
  const { useBackendsStore } = await import('@/composables/useBackendsStore');
  await useBackendsStore().loadBackends();
  const { useLibrariesStore } = await import('@/composables/useLibrariesStore');
  await useLibrariesStore().loadLibraries();
  const { useActiveLibrary } = await import('@/composables/useActiveLibrary');
  useActiveLibrary().setActiveLibrary('lib:qa');

  const AppSplash = (await import('@/components/AppSplash.vue')).default;
  wrapper = mount(AppSplash, {
    attachTo: document.body,
    global: {
      stubs: { SplashCountCard: true, SplashActivityLog: true, SplashStatusStrip: true },
    },
  });
  await flushPromises();
  return wrapper;
}

/** Open the picker and click the option with this label. */
async function choose(splash: VueWrapper, label: string) {
  await splash.find('[data-testid="splash-default-backend-select"]').trigger('click');
  await nextTick();
  const option = splash
    .findAll('[data-testid="splash-default-backend-select-option"]')
    .find((candidate) => candidate.text() === label);
  if (!option) throw new Error(`no backend option labelled "${label}"`);
  await option.trigger('click');
  await flushPromises();
}

describe('AppSplash default backend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDeploymentMode();
    api.listBackends.mockResolvedValue(BACKENDS);
    api.updateLibrary.mockImplementation(async (id: string, input: Record<string, unknown>) => ({
      data: { id, ...input },
      etag: '"l2"',
    }));
  });

  afterEach(async () => {
    wrapper?.unmount();
    wrapper = null;
    await tick();
    resetDeploymentMode();
  });

  it('shows the current default in the picker, without the in-memory store as an option', async () => {
    const splash = await mountSplash('b:visual');

    const input = splash.find('[data-testid="splash-default-backend-select"]').element as HTMLInputElement;
    expect(input.value).toBe('Visual Backend');

    await splash.find('[data-testid="splash-default-backend-select"]').trigger('click');
    await nextTick();
    const labels = splash.findAll('[data-testid="splash-default-backend-select-option"]').map((o) => o.text());
    expect(labels).toEqual(['None', 'Visual Backend', 'Wikidata']);
  });

  it('saves straight away when the library had no default', async () => {
    const splash = await mountSplash(null);

    await choose(splash, 'Wikidata');

    expect(document.body.textContent).not.toContain('This will change the library');
    expect(api.updateLibrary).toHaveBeenCalledTimes(1);
    expect(api.updateLibrary.mock.calls[0][0]).toBe('lib:qa');
    expect(api.updateLibrary.mock.calls[0][1]).toMatchObject({ name: 'Ontology QA', defaultBackend: 'b:wikidata' });
    // Against the token just read, not whatever was cached.
    expect(api.updateLibrary.mock.calls[0][2]).toEqual({ ifMatch: '"l1"' });
  });

  it('asks before replacing an existing default, naming both backends', async () => {
    const splash = await mountSplash('b:visual');

    await choose(splash, 'Wikidata');

    expect(api.updateLibrary).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "This will change the library's default backend from Visual Backend to Wikidata. "
      + 'Queries without their own default will run on Wikidata.',
    );

    (document.body.querySelector('[data-testid="confirm-library-backend"]') as HTMLElement).click();
    await flushPromises();

    expect(api.updateLibrary).toHaveBeenCalledTimes(1);
    expect(api.updateLibrary.mock.calls[0][1]).toMatchObject({ defaultBackend: 'b:wikidata' });
  });

  it('stays a read-only fact on a read-only deployment', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ status: 'ok', readOnly: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as typeof globalThis.fetch;
    try {
      await useDeploymentMode().ensureLoaded();
      const splash = await mountSplash('b:visual');

      expect(splash.find('[data-testid="splash-default-backend"]').exists()).toBe(false);
      expect(splash.findComponent({ name: 'SplashStatusStrip' }).props('backend')).toMatchObject({
        label: 'Visual Backend',
      });
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
