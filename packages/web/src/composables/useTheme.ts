import { computed, ref, watch } from 'vue';
import { useSettings, type ThemePreference } from './useSettings';
import { DEFAULT_THEME_ID } from '../lib/themes';

/**
 * Applies the theme preference to <html>.
 *
 * Two switches, both on the root element:
 *
 * - `.dark` picks the base. The dark base is the `.dark` block in
 *   assets/css/tokens.css, which redefines only the semantic layer.
 * - `data-theme` picks a colour theme on top of that base, from
 *   assets/css/themes.css. It is absent for the default theme of each base.
 *
 * 'system' follows prefers-color-scheme and keeps following it as the OS
 * setting changes; 'light' and 'dark' pin it. The user picks one light theme
 * and one dark theme, and the mode chooses between them.
 */

const QUERY = '(prefers-color-scheme: dark)';

function media(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(QUERY);
}

/*
 * The OS preference is held in a ref rather than read from matchMedia on
 * demand. matchMedia is not a reactive source, so a computed that called it
 * directly would never re-evaluate when the OS theme changed — the class on
 * <html> would update while anything bound to isDark went stale.
 */
const systemDark = ref(media()?.matches ?? false);

function apply([dark, themeId]: [boolean, string]): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', dark);
  const root = document.documentElement;
  root.style.colorScheme = dark ? 'dark' : 'light';
  if (themeId === DEFAULT_THEME_ID) root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', themeId);
}

let installed = false;

export function useTheme() {
  const { settings, setTheme, setLightTheme, setDarkTheme } = useSettings();

  const preference = computed<ThemePreference>(() => settings.value.theme);
  const isDark = computed(() =>
    (preference.value === 'system' ? systemDark.value : preference.value === 'dark'));
  const lightTheme = computed(() => settings.value.lightTheme);
  const darkTheme = computed(() => settings.value.darkTheme);
  const activeTheme = computed(() => (isDark.value ? darkTheme.value : lightTheme.value));

  if (!installed && typeof window !== 'undefined') {
    installed = true;
    media()?.addEventListener('change', (e) => { systemDark.value = e.matches; });
    watch(() => [isDark.value, activeTheme.value] as [boolean, string], apply, { immediate: true });
  }

  return { preference, isDark, lightTheme, darkTheme, activeTheme, setTheme, setLightTheme, setDarkTheme };
}
