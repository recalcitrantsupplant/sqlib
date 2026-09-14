import { describe, it, expect, beforeEach, vi } from 'vitest';
import { nextTick } from 'vue';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(import.meta.dirname, '../../src');

const store: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store[k] ?? null,
  setItem: (k: string, v: string) => { store[k] = v; },
  removeItem: (k: string) => { delete store[k]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
});

let systemPrefersDark = false;
const mediaListeners: ((e: { matches: boolean }) => void)[] = [];
vi.stubGlobal('matchMedia', (q: string) => ({
  get matches() { return q.includes('dark') && systemPrefersDark; },
  addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => { mediaListeners.push(fn); },
  removeEventListener: () => {},
}));

/** Simulate the OS theme changing, as the real MediaQueryList would. */
function setSystemDark(value: boolean) {
  systemPrefersDark = value;
  mediaListeners.forEach((fn) => fn({ matches: value }));
}

describe('useTheme', () => {
  beforeEach(() => {
    document.documentElement.className = '';
  });

  it('applies and removes the .dark class as the preference changes', async () => {
    const { useTheme } = await import('../../src/composables/useTheme');
    const { setTheme, isDark } = useTheme();

    setTheme('dark');
    await nextTick();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(isDark.value).toBe(true);

    setTheme('light');
    await nextTick();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(isDark.value).toBe(false);
  });

  it('follows the OS preference when set to system', async () => {
    const { useTheme } = await import('../../src/composables/useTheme');
    const { setTheme, isDark } = useTheme();

    setTheme('system');
    setSystemDark(true);
    await nextTick();
    expect(isDark.value).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    setSystemDark(false);
    await nextTick();
    expect(isDark.value).toBe(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('ignores OS changes once the preference is pinned', async () => {
    const { useTheme } = await import('../../src/composables/useTheme');
    const { setTheme, isDark } = useTheme();

    setTheme('light');
    setSystemDark(true);
    await nextTick();
    expect(isDark.value).toBe(false);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    setSystemDark(false);
  });

  it('sets color-scheme so native controls and scrollbars match', async () => {
    const { useTheme } = await import('../../src/composables/useTheme');
    const { setTheme } = useTheme();
    setTheme('dark');
    await nextTick();
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('persists the preference through the settings store', async () => {
    const { useTheme } = await import('../../src/composables/useTheme');
    useTheme().setTheme('dark');
    await nextTick();
    expect(JSON.parse(store['sparql-query-lib-settings']).theme).toBe('dark');
  });
});

describe('theme hygiene', () => {
  it('has no colour keywords left in component styles', () => {
    // `color: white` is not hex, so color-no-hex never caught it, and it is
    // just as broken in dark mode. This is the regression guard.
    const hits = execSync(
      `grep -rlE '(background|background-color|color|border[a-z-]*color)\\s*:\\s*(white|black|red|green|blue|gray|grey|silver|whitesmoke)\\b' ${SRC}/components ${SRC}/pages || true`,
      { encoding: 'utf8' },
    ).trim();
    expect(hits, `colour keywords found in:\n${hits}`).toBe('');
  });

  it('themes off the .dark class rather than the OS preference', () => {
    /*
     * `.dark` is the single switch (see useTheme). A component that read
     * `prefers-color-scheme` instead ignored the preference in Settings, so
     * pinning dark under a light OS left its chrome light — and pinning light
     * under a dark OS painted a dark panel into a light app. Both shipped:
     * the results viewer, the execution results and the RDF viewers all had
     * one of these blocks (issue #38).
     */
    const hits = execSync(
      `grep -rn 'prefers-color-scheme' ${SRC}/components ${SRC}/pages ${SRC}/assets/css || true`,
      { encoding: 'utf8' },
    )
      .trim()
      .split('\n')
      .filter((line) => line && !/^\S+:\d+:\s*\*/.test(line)) // prose in a comment block
      .join('\n');
    expect(hits, `prefers-color-scheme used instead of .dark:\n${hits}`).toBe('');
  });

  it('never paints ink-inverse on a surface that does not flip', () => {
    /*
     * --ink-inverse flips with the theme; --action / --danger / --success do
     * not. Pairing them gave every primary button in dark mode near-black
     * text on blue, while the components already on --action-fg stayed white.
     * The fixed on-colour tokens (--action-fg and friends) are the pairing.
     */
    const files = execSync(`find ${SRC}/components ${SRC}/pages -name '*.vue'`, { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);
    const CHROMATIC = /^--(action|danger|success|warning)(-hover|-active)?$/;

    const hits: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        if (!/color:\s*var\(--ink-inverse\)/.test(line)) return;
        // Every background in the rule this declaration sits in — the
        // declaration order within a rule is nobody's business but the author's.
        const start = lines.slice(0, index).findLastIndex((l) => l.includes('{'));
        const end = index + lines.slice(index).findIndex((l) => l.includes('}'));
        for (const l of lines.slice(start + 1, end + 1)) {
          const background = l.match(/background(?:-color)?:\s*var\((--[a-z0-9-]+)\)/);
          if (background && CHROMATIC.test(background[1])) {
            hits.push(`${file.replace(SRC, '')}:${index + 1}`);
            return;
          }
        }
      });
    }
    expect(hits, `ink-inverse on a chromatic surface:\n${hits.join('\n')}`).toEqual([]);
  });

  it('never uses an ink token as a background', () => {
    // The codemod's role resolution originally classified `background-color`
    // as foreground, because it also ends in `-color`. That looks correct in
    // light mode and inverts in dark.
    const hits = execSync(
      `grep -rnE 'background(-color)?:\\s*var\\(--(ink|[a-z]+-ink)\\b' ${SRC}/components ${SRC}/pages || true`,
      { encoding: 'utf8' },
    ).trim();
    expect(hits, `ink token used as a background:\n${hits}`).toBe('');
  });

  it('has no var() reference to an undefined custom property', () => {
    // EtlPlayground referenced seven --color-* names that were never defined,
    // so 84 declarations silently did nothing. Third-party namespaces are
    // excluded: those properties are provided by the libraries themselves.
    const THIRD_PARTY = /^--(radix|vf|cm|reka|sonner|tw)-/;
    const cssFiles = ['tokens.css', 'tailwind.css', 'compact-buttons.css', 'codemirror-theme.css'];
    const defined = new Set<string>();
    for (const name of cssFiles) {
      for (const m of readFileSync(resolve(SRC, 'assets/css', name), 'utf8').matchAll(/^\s*(--[a-z0-9-]+):/gm)) {
        defined.add(m[1]);
      }
    }

    const files = execSync(`find ${SRC}/components ${SRC}/pages -name '*.vue'`, { encoding: 'utf8' })
      .trim().split('\n').filter(Boolean);

    const missing: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const local = new Set([...src.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]));
      for (const m of src.matchAll(/var\((--[a-z0-9-]+)\)/g)) {
        const token = m[1];
        if (defined.has(token) || local.has(token) || THIRD_PARTY.test(token)) continue;
        missing.push(`${token} in ${file.replace(SRC, '')}`);
      }
    }
    expect([...new Set(missing)], 'undefined custom properties').toEqual([]);
  });

  it('defines a dark value for every semantic token the light theme sets', () => {
    const tokens = readFileSync(resolve(SRC, 'assets/css/tokens.css'), 'utf8');
    const dark = tokens.slice(tokens.indexOf('.dark {'));
    for (const token of ['--surface', '--ink', '--border-default', '--action', '--danger']) {
      expect(dark, `${token} has no dark value`).toContain(`${token}:`);
    }
  });

  it('carries every step of a status ramp into the dark theme', () => {
    /*
     * The base colour was overridden and the hover/active steps were not, so
     * they kept the light theme's direction — *darker* than the base, which is
     * away from a dark surface rather than toward it. --danger-active is the
     * details panel's Delete button: it rendered at 2.75:1 (issue #38).
     */
    const tokens = readFileSync(resolve(SRC, 'assets/css/tokens.css'), 'utf8');
    const dark = tokens.slice(tokens.indexOf('.dark {'));
    const light = tokens.slice(0, tokens.indexOf('.dark {'));

    const missing: string[] = [];
    for (const family of ['action', 'success', 'danger', 'warning']) {
      for (const step of ['', '-hover', '-active']) {
        const token = `--${family}${step}`;
        if (!light.includes(`${token}:`)) continue;
        if (!dark.includes(`${token}:`)) missing.push(token);
      }
    }
    expect(missing, 'status ramp steps with no dark value').toEqual([]);
  });

  it('carries the categorical ramps into the dark theme', () => {
    /*
     * --stratum-* are pale fills behind a label and --series-* are marks that
     * have to hold against the page, so both are wrong at their light values
     * on a dark surface: the stratification bands rendered their labels at
     * 1.3:1 and --series-4 sat at 2.14:1 on every benchmark chart.
     *
     * --tag-* is deliberately absent: a tag stores its hex in the RDF, so the
     * ramp cannot move here without disagreeing with the store.
     */
    const tokens = readFileSync(resolve(SRC, 'assets/css/tokens.css'), 'utf8');
    const dark = tokens.slice(tokens.indexOf('.dark {'));

    const missing = [
      ...Array.from({ length: 8 }, (_, i) => `--stratum-${i + 1}`),
      ...Array.from({ length: 6 }, (_, i) => `--series-${i + 1}`),
    ].filter((token) => !dark.includes(`${token}:`));
    expect(missing, 'categorical ramp entries with no dark value').toEqual([]);
  });
});
