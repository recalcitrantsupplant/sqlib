import { computed, ref, watch } from 'vue';
import { useSettings, type ThemePreference } from './useSettings';

/**
 * Applies the theme preference by toggling `.dark` on <html>.
 *
 * The whole dark theme is the `.dark` block in assets/css/tokens.css, which
 * redefines only the semantic layer — so this class is the single switch.
 *
 * 'system' follows prefers-color-scheme and keeps following it as the OS
 * setting changes; 'light' and 'dark' pin it.
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

function apply(dark: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

let installed = false;

export function useTheme() {
  const { settings, setTheme } = useSettings();

  const preference = computed<ThemePreference>(() => settings.value.theme);
  const isDark = computed(() =>
    (preference.value === 'system' ? systemDark.value : preference.value === 'dark'));

  if (!installed && typeof window !== 'undefined') {
    installed = true;
    media()?.addEventListener('change', (e) => { systemDark.value = e.matches; });
    watch(isDark, apply, { immediate: true });
  }

  return { preference, isDark, setTheme };
}
