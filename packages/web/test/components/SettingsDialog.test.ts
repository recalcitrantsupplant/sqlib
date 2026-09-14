import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';

/*
 * Settings is small enough that its whole risk is wiring: the toggles have to
 * be the shared `Switch` rather than a second hand-rolled one, and the Prefix
 * Manager row has to reach the emit that used to have no caller at all.
 *
 * useSettings is a module-level singleton over localStorage, so each test
 * re-imports it.
 */

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

  it('closes on Done without committing anything — settings apply on change', async () => {
    const { wrapper, settings } = await open({ hofstadterMode: false });
    await click(switchFor('setting-hofstadter-mode'));
    expect(settings.settings.value.hofstadterMode).toBe(true);

    await click(query('.btn-done'));
    expect(wrapper.emitted('update:open')?.at(-1)).toEqual([false]);
    expect(settings.settings.value.hofstadterMode).toBe(true);
  });
});
