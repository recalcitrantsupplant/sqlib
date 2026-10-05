/**
 * The "Browser default" label, its two actions, and the screens' rule for
 * applying a default on open.
 *
 * A browser default is stored on the server and applied only here, so the
 * label says so in its tooltip, and the actions follow the read-only rule every
 * other write control follows: absent, not disabled.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { ref, computed } from 'vue';
import { resetDeploymentMode, useDeploymentMode } from '@/composables/useDeploymentMode';

const api = vi.hoisted(() => ({
  getBrowserDefaults: vi.fn(),
  putBrowserDefaults: vi.fn(),
  getDataGraph: vi.fn(),
}));
vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));
vi.mock('vue-sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const BrowserDefaultControl = (await import('@/components/shared/BrowserDefaultControl.vue')).default;
const DataGraphBrowserDefault = (await import('@/components/shared/DataGraphBrowserDefault.vue')).default;
const ArgumentSetBrowserDefault = (await import('@/components/query-work-area/ArgumentSetBrowserDefault.vue')).default;
const {
  BROWSER_DEFAULT_HINT,
  resetBrowserDefaultsCache,
  sameDataGraphs,
  useBrowserDefaults,
} = await import('@/composables/useBrowserDefaults');

const realFetch = globalThis.fetch;

async function deploymentIs(readOnly: boolean) {
  globalThis.fetch = vi.fn(async () =>
    new Response(JSON.stringify({ status: 'ok', readOnly }), { status: 200 }),
  ) as typeof globalThis.fetch;
  await useDeploymentMode().ensureLoaded();
}

beforeEach(() => {
  resetDeploymentMode();
  resetBrowserDefaultsCache();
  vi.clearAllMocks();
  api.getBrowserDefaults.mockResolvedValue({ argumentSet: null, dataGraphs: [] });
  api.putBrowserDefaults.mockImplementation(async (_kind: string, _id: string, body: unknown) => body);
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('BrowserDefaultControl', () => {
  it('labels the current pick as the default, says what that means, and offers to clear it', () => {
    const w = mount(BrowserDefaultControl, { props: { isDefault: true, hasDefault: true, canSet: true } });
    const badge = w.get('[data-testid="browser-default-badge"]');
    expect(badge.text()).toBe('Browser default');
    expect(badge.attributes('title')).toBe(BROWSER_DEFAULT_HINT);
    expect(w.find('[data-testid="browser-default-set"]').exists()).toBe(false);
    expect(w.find('[data-testid="browser-default-clear"]').exists()).toBe(true);
  });

  it('offers to set a pick that is not the default', async () => {
    const w = mount(BrowserDefaultControl, { props: { isDefault: false, hasDefault: false, canSet: true } });
    await w.get('[data-testid="browser-default-set"]').trigger('click');
    expect(w.emitted('set')).toHaveLength(1);
  });

  it('draws nothing when there is no default and nothing to set', () => {
    const w = mount(BrowserDefaultControl, { props: { isDefault: false, hasDefault: false, canSet: false } });
    expect(w.find('[data-testid="browser-default"]').exists()).toBe(false);
  });

  it('keeps the label and drops both actions on a read-only deployment', async () => {
    await deploymentIs(true);
    const w = mount(BrowserDefaultControl, { props: { isDefault: true, hasDefault: true, canSet: true } });
    expect(w.find('[data-testid="browser-default-badge"]').exists()).toBe(true);
    expect(w.find('button').exists()).toBe(false);
  });
});

describe('sameDataGraphs', () => {
  it('ignores trailing holes, which name no input', () => {
    expect(sameDataGraphs(['a', null], ['a'])).toBe(true);
    expect(sameDataGraphs([null, 'a'], ['a'])).toBe(false);
  });
});

describe('useBrowserDefaults', () => {
  it('reads a failed load as no default, so a screen opens the same way', async () => {
    api.getBrowserDefaults.mockRejectedValue(new Error('404'));
    expect(await useBrowserDefaults().load('query', 'urn:q')).toEqual({ argumentSet: null, dataGraphs: [] });
  });

  it('keeps the other field when it saves one', async () => {
    api.getBrowserDefaults.mockResolvedValue({ argumentSet: 'urn:set', dataGraphs: ['urn:dg'] });
    await useBrowserDefaults().save('queryGroup', 'urn:g', { dataGraphs: [] });
    expect(api.putBrowserDefaults).toHaveBeenCalledWith('queryGroup', 'urn:g', { argumentSet: 'urn:set', dataGraphs: [] });
  });

  it('resolves a floating graph to its current version and leaves a pin alone', async () => {
    api.getDataGraph.mockResolvedValue({ data: { currentVersion: 'urn:sqlib:data-graph-version:v3' } });
    const resolved = await useBrowserDefaults().resolveDataGraphs([
      'urn:sqlib:data-graph:g1', null, 'urn:sqlib:data-graph-version:v1',
    ]);
    expect(resolved).toEqual(['urn:sqlib:data-graph-version:v3', null, 'urn:sqlib:data-graph-version:v1']);
  });

  describe('applyArgumentSet', () => {
    function stubArgs(listed: string[], selected = 'none') {
      const selection = ref<{ kind: string; id?: string }>({ kind: selected });
      return {
        selection,
        selectedSetId: computed(() => (selection.value.kind === 'set' ? selection.value.id ?? null : null)),
        argumentSets: ref(listed.map((id) => ({ id }))),
        loadArgumentSets: vi.fn(async () => {}),
        selectSet: vi.fn(async (id: string) => { selection.value = { kind: 'set', id }; }),
      } as never as Parameters<ReturnType<typeof useBrowserDefaults>['applyArgumentSet']>[2];
    }

    it('opens the default when nothing is open', async () => {
      api.getBrowserDefaults.mockResolvedValue({ argumentSet: 'urn:set', dataGraphs: [] });
      const args = stubArgs(['urn:set']);
      expect(await useBrowserDefaults().applyArgumentSet('query', 'urn:q', args)).toBe(true);
      expect(args.selectSet).toHaveBeenCalledWith('urn:set');
    });

    it('leaves a pick already made alone', async () => {
      api.getBrowserDefaults.mockResolvedValue({ argumentSet: 'urn:set', dataGraphs: [] });
      const args = stubArgs(['urn:set'], 'scratch');
      expect(await useBrowserDefaults().applyArgumentSet('query', 'urn:q', args)).toBe(false);
      expect(args.selectSet).not.toHaveBeenCalled();
    });

    it('selects nothing, quietly, for a default this screen cannot list', async () => {
      api.getBrowserDefaults.mockResolvedValue({ argumentSet: 'urn:gone', dataGraphs: [] });
      const args = stubArgs(['urn:set']);
      expect(await useBrowserDefaults().applyArgumentSet('query', 'urn:q', args)).toBe(false);
      expect(args.selectSet).not.toHaveBeenCalled();
    });
  });
});

describe('ArgumentSetBrowserDefault', () => {
  it('saves the open set as the default: the set, not a version', async () => {
    const selection = ref({ kind: 'set', id: 'urn:set' });
    const args = { selection, selectedSetId: computed(() => 'urn:set') };
    const w = mount(ArgumentSetBrowserDefault, { props: { kind: 'query', ownerId: 'urn:q', args: args as never } });
    await flushPromises();

    await w.get('[data-testid="browser-default-set"]').trigger('click');
    await flushPromises();

    expect(api.putBrowserDefaults).toHaveBeenCalledWith('query', 'urn:q', { argumentSet: 'urn:set', dataGraphs: [] });
    expect(w.find('[data-testid="browser-default-badge"]').exists()).toBe(true);
  });

  it('cannot save a scratch set, which has no server id', async () => {
    const args = { selection: ref({ kind: 'scratch', id: 's1' }), selectedSetId: computed(() => null) };
    const w = mount(ArgumentSetBrowserDefault, { props: { kind: 'query', ownerId: 'urn:q', args: args as never } });
    await flushPromises();
    expect(w.find('[data-testid="browser-default-set"]').exists()).toBe(false);
  });
});

describe('DataGraphBrowserDefault', () => {
  const OPTIONS = [
    { versionId: 'urn:sqlib:data-graph-version:v1', name: 'Cities', version: 1, detail: '', graphId: 'urn:sqlib:data-graph:g1' },
  ];

  it('saves a picked version as its graph, so the default follows new versions', async () => {
    const w = mount(DataGraphBrowserDefault, {
      props: { kind: 'queryGroup', ownerId: 'urn:g', selection: [null, 'urn:sqlib:data-graph-version:v1'], options: OPTIONS },
    });
    await flushPromises();

    await w.get('[data-testid="browser-default-set"]').trigger('click');
    await flushPromises();

    expect(api.putBrowserDefaults).toHaveBeenCalledWith('queryGroup', 'urn:g', {
      argumentSet: null,
      dataGraphs: [null, 'urn:sqlib:data-graph:g1'],
    });
  });

  it('labels the pick as the default when the stored graph resolves to it', async () => {
    api.getBrowserDefaults.mockResolvedValue({ argumentSet: null, dataGraphs: ['urn:sqlib:data-graph:g1'] });
    api.getDataGraph.mockResolvedValue({ data: { currentVersion: 'urn:sqlib:data-graph-version:v1' } });
    const w = mount(DataGraphBrowserDefault, {
      props: { kind: 'ruleSet', ownerId: 'urn:r', selection: ['urn:sqlib:data-graph-version:v1'], options: OPTIONS },
    });
    await flushPromises();
    expect(w.find('[data-testid="browser-default-badge"]').exists()).toBe(true);
  });
});
