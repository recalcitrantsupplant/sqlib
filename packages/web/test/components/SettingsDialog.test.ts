import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { nextTick } from 'vue';

/*
 * Settings is small enough that its whole risk is wiring: the toggles have to
 * be the shared `Switch` rather than a second hand-rolled one, and the Prefix
 * Manager row has to reach the emit that used to have no caller at all.
 *
 * useSettings is a module-level singleton over localStorage, so each test
 * re-imports it.
 */

// The telemetry section reads the server; it has tests of its own.
vi.mock('@/components/settings/TelemetryStatusSection.vue', () => ({
  default: { name: 'TelemetryStatusSection', render: () => null },
}));

/*
 * The Connection section reads the round trip, the backend probes and the
 * active library. Each is a stand-in here, so no test reaches the network.
 */
const connection = vi.hoisted(() => ({
  roundTripMs: null as number | null,
  location: null as string | null,
  measure: (() => undefined) as () => unknown,
  probe: (() => undefined) as (id: string) => unknown,
  defaultBackend: null as string | null,
  probes: {} as Record<string, { health: string; latencyMs: number | null; error: string | null }>,
}));
vi.mock('@/composables/useServerLatency', async () => {
  const { computed } = await import('vue');
  return {
    SLOW_ROUND_TRIP_MS: 100,
    useServerLatency: () => ({
      roundTripMs: computed(() => connection.roundTripMs),
      location: computed(() => connection.location),
      measuring: computed(() => false),
      ensureMeasured: async () => undefined,
      measure: () => connection.measure(),
    }),
  };
});
vi.mock('@/composables/useBackendProbes', () => ({
  useBackendProbes: () => ({
    probeFor: (id: string | null | undefined) => (id ? connection.probes[id] ?? null : null),
    isProbing: () => false,
    probe: (id: string) => connection.probe(id),
    loadProbes: async () => undefined,
  }),
}));
vi.mock('@/composables/useActiveLibrary', async () => {
  const { computed } = await import('vue');
  return {
    useActiveLibrary: () => ({
      libraries: computed(() => [{ id: 'lib:a', name: 'A', defaultBackend: connection.defaultBackend }]),
      activeLibraryId: computed(() => 'lib:a'),
    }),
  };
});
vi.mock('@/composables/useBackendsStore', async () => {
  const { computed } = await import('vue');
  return {
    useBackendsStore: () => ({
      backends: computed(() => [{ id: 'b:fuseki', name: 'Fuseki', backendType: 'http' }]),
    }),
  };
});

const mockLocalStorage: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => mockLocalStorage[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    mockLocalStorage[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete mockLocalStorage[key];
  }),
  clear: vi.fn(() => {
    for (const key in mockLocalStorage) delete mockLocalStorage[key];
  }),
});

async function open(settings: Record<string, unknown> = {}) {
  localStorage.setItem('sparql-query-lib-settings', JSON.stringify(settings));
  const { mount } = await import('@vue/test-utils');
  const { default: SettingsDialog } = await import('@/components/SettingsDialog.vue');
  const { useSettings } = await import('@/composables/useSettings');
  const wrapper = mount(SettingsDialog, { props: { open: true }, attachTo: document.body });
  await nextTick();
  await nextTick();
  return { wrapper, settings: useSettings() };
}

function query<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`no element matching ${selector}`);
  return el;
}

function switchFor(id: string): HTMLElement {
  return query(`[id="${id}"]`);
}

function click(el: Element): Promise<void> {
  (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return nextTick();
}

describe('SettingsDialog', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.clearAllMocks();
    document.body.innerHTML = '';
    document.documentElement.className = '';
  });

  it('uses the shared Switch for every toggle', async () => {
    await open();
    const switches = document.querySelectorAll('[data-slot="switch"]');
    expect(switches).toHaveLength(2);
    // The hand-rolled 44x24 toggle this replaced.
    expect(document.querySelector('.toggle-button')).toBeNull();
  });

  it('toggles abbreviation and Hofstadter mode', async () => {
    const { settings } = await open({ prefixAbbreviationEnabled: true, hofstadterMode: false });

    await click(switchFor('setting-abbreviate-iris'));
    expect(settings.settings.value.prefixAbbreviationEnabled).toBe(false);

    await click(switchFor('setting-hofstadter-mode'));
    expect(settings.settings.value.hofstadterMode).toBe(true);
  });

  it('picks a theme', async () => {
    const { settings } = await open({ theme: 'system' });
    const dark = Array.from(document.querySelectorAll<HTMLElement>('.theme-option')).find(
      (b) => b.textContent?.trim() === 'Dark',
    )!;
    await click(dark);
    expect(settings.settings.value.theme).toBe('dark');
    expect(dark.getAttribute('aria-checked')).toBe('true');
  });

  it('picks a light theme and a dark theme from their swatches', async () => {
    const { settings } = await open({ theme: 'system' });

    const paper = query('[data-testid="theme-light-paper"]');
    await click(paper);
    expect(settings.settings.value.lightTheme).toBe('paper');
    expect(paper.getAttribute('aria-checked')).toBe('true');
    expect(query('[data-testid="theme-light-default"]').getAttribute('aria-checked')).toBe('false');

    await click(query('[data-testid="theme-dark-ember"]'));
    expect(settings.settings.value.darkTheme).toBe('ember');
  });

  it('dims the picker the mode does not use, and neither under System', async () => {
    await open({ theme: 'light' });
    const rows = () => Array.from(document.querySelectorAll('.theme-swatches'))
      .map((group) => group.closest('.setting-row')!.classList.contains('theme-row-idle'));
    expect(rows()).toEqual([false, true]);

    const system = Array.from(document.querySelectorAll<HTMLElement>('.theme-option'))
      .find((b) => b.textContent?.trim() === 'System')!;
    await click(system);
    expect(rows()).toEqual([false, false]);
  });

  it('drops a stored theme that no longer exists', async () => {
    const { settings } = await open({ lightTheme: 'retired', darkTheme: 'paper' });
    expect(settings.settings.value.lightTheme).toBe('default');
    expect(settings.settings.value.darkTheme).toBe('default');
  });

  it('reaches the Prefix Manager from the row under the toggle that depends on it', async () => {
    const { wrapper } = await open();
    const row = query('.nav-row');
    expect(row.textContent).toContain('Prefix Manager');
    // The summary says how many mappings are behind the row.
    expect(row.textContent).toMatch(/\d+ prefixes/);

    await click(row);
    expect(wrapper.emitted('open-prefix-manager')).toHaveLength(1);
    // One dialog at a time: Settings steps aside for the manager it opened.
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false]);
  });

  describe('Connection', () => {
    beforeEach(() => {
      connection.roundTripMs = null;
      connection.location = null;
      connection.defaultBackend = null;
      connection.probes = {};
    });

    it('shows the round trip from this browser, in warning above 100 ms', async () => {
      connection.roundTripMs = 350;
      connection.location = 'Sydney';
      await open();
      const badge = query('[data-testid="settings-browser-latency"]');
      expect(badge.textContent?.trim()).toBe('350 ms');
      expect(badge.className).toContain('status-badge--warning');
      expect(query('[data-testid="settings-connection"]').textContent).toContain('Sydney');
    });

    it('shows a short round trip as healthy', async () => {
      connection.roundTripMs = 40;
      await open();
      expect(query('[data-testid="settings-browser-latency"]').className).toContain('status-badge--success');
    });

    it('measures again on request', async () => {
      connection.measure = vi.fn();
      await open();
      await click(query('[data-testid="settings-measure-latency"]'));
      expect(connection.measure).toHaveBeenCalledTimes(1);
    });

    it('has no backend row when the library has no default backend', async () => {
      await open();
      expect(document.querySelector('[data-testid="settings-backend-row"]')).toBeNull();
    });

    it('shows the last probe of the default backend, and tests it again', async () => {
      connection.defaultBackend = 'b:fuseki';
      connection.probes = { 'b:fuseki': { health: 'slow', latencyMs: 420, error: null } };
      connection.probe = vi.fn();
      await open();
      expect(query('[data-testid="settings-backend-row"]').textContent).toContain('sqlib to Fuseki');
      const badge = query('[data-testid="settings-backend-latency"]');
      expect(badge.textContent?.trim()).toBe('420 ms');
      expect(badge.className).toContain('status-badge--warning');
      await click(query('[data-testid="settings-probe-backend"]'));
      expect(connection.probe).toHaveBeenCalledWith('b:fuseki');
    });

    it('says when the default backend has not been tested', async () => {
      connection.defaultBackend = 'b:fuseki';
      await open();
      expect(query('[data-testid="settings-backend-latency"]').textContent?.trim()).toBe('Not tested');
    });
  });

  it('closes on Done without committing anything — settings apply on change', async () => {
    const { wrapper, settings } = await open({ hofstadterMode: false });
    await click(switchFor('setting-hofstadter-mode'));
    expect(settings.settings.value.hofstadterMode).toBe(true);

    await click(query('.btn-done'));
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false]);
    expect(settings.settings.value.hofstadterMode).toBe(true);
  });

  /*
   * Settings stays on a read-only deployment — the theme and the Prefix
   * Manager are as useful on a public site as anywhere. What goes is the one
   * section that can do nothing there: the System Library it reveals is hidden
   * whatever the switch says, so the row could only have explained itself.
   */
  describe('on a read-only deployment', () => {
    const realFetch = globalThis.fetch;

    beforeEach(() => {
      globalThis.fetch = vi.fn(async () =>
        new Response(JSON.stringify({ status: 'ok', readOnly: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      ) as typeof globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    async function openReadOnly() {
      const { resetDeploymentMode, useDeploymentMode } = await import('@/composables/useDeploymentMode');
      resetDeploymentMode();
      await useDeploymentMode().ensureLoaded();
      const opened = await open();
      await nextTick();
      return opened;
    }

    it('keeps the theme and the Prefix Manager', async () => {
      await openReadOnly();

      expect(document.querySelectorAll('.theme-option')).toHaveLength(3);
      expect(query('.nav-row').textContent).toContain('Prefix Manager');
      expect(switchFor('setting-abbreviate-iris')).toBeTruthy();
    });

    it('takes Hofstadter mode away rather than disabling it', async () => {
      await openReadOnly();

      expect(document.querySelector('[data-testid="setting-hofstadter-mode"]')).toBeNull();
      expect(document.body.textContent).not.toContain('Advanced');
    });

    /* The probe route is refused there, so only the last result is shown. */
    it('shows the backend probe without a Test button', async () => {
      connection.defaultBackend = 'b:fuseki';
      await openReadOnly();
      expect(document.querySelector('[data-testid="settings-backend-row"]')).toBeTruthy();
      expect(document.querySelector('[data-testid="settings-probe-backend"]')).toBeNull();
      connection.defaultBackend = null;
    });

    /* Per browser, so flipping between deployments must not rewrite it. */
    it('leaves the stored preference alone', async () => {
      const { resetDeploymentMode, useDeploymentMode } = await import('@/composables/useDeploymentMode');
      resetDeploymentMode();
      await useDeploymentMode().ensureLoaded();
      const { settings } = await open({ hofstadterMode: true });

      expect(settings.settings.value.hofstadterMode).toBe(true);
    });
  });
});
