import { ref, watch } from 'vue';

export type ThemePreference = 'system' | 'light' | 'dark';

export type EntityListDensity = 'compact' | 'comfortable';

/**
 * How a section's Saved cluster is folded.
 *
 * `none` is the flat run of rows the sidebar has always drawn. `tag` groups it
 * by the library's tags, which is a *view* over the same list rather than a
 * move — an entity carrying two tags appears under both, marked with the
 * other's colour (tags mockup 1a). Kept in settings rather than per section so
 * that switching sections does not silently switch the view back.
 */
export type EntityListGrouping = 'none' | 'tag';

interface Settings {
  hofstadterMode: boolean;
  prefixAbbreviationEnabled: boolean;
  theme: ThemePreference;
  /** Row height in the section sidebars: 26px names, or name plus description. */
  entityListDensity: EntityListDensity;
  /** Whether the Saved cluster is grouped by tag. */
  entityListGrouping: EntityListGrouping;
}

const STORAGE_KEY = 'sparql-query-lib-settings';

const DEFAULT_SETTINGS: Settings = {
  hofstadterMode: false, // System library hidden by default
  prefixAbbreviationEnabled: true, // Prefix abbreviation enabled by default
  theme: 'system', // Follow the OS preference unless the user picks a side
  entityListDensity: 'compact', // As drawn: more of the library on screen at once
  entityListGrouping: 'none', // Flat until asked otherwise; untagged is the normal state
};

// Shared reactive state
const settings = ref<Settings>({ ...DEFAULT_SETTINGS });

// Load settings from localStorage
function loadSettings(): Settings {
  if (typeof window === 'undefined') {
    // SSR: return defaults without accessing localStorage
    return { ...DEFAULT_SETTINGS };
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to handle missing keys
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch (error) {
    console.warn('Failed to load settings from localStorage:', error);
  }

  return { ...DEFAULT_SETTINGS };
}

// Save settings to localStorage
function saveSettings(newSettings: Settings): void {
  if (typeof window === 'undefined') {
    // SSR: skip localStorage access
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newSettings));
  } catch (error) {
    console.warn('Failed to save settings to localStorage:', error);
  }
}

// Initialize settings on first use
let initialized = false;

export function useSettings() {
  if (!initialized) {
    const loaded = loadSettings();
    settings.value = loaded;
    initialized = true;

    // Auto-save when settings change
    watch(
      settings,
      (newSettings) => {
        saveSettings(newSettings);
      },
      { deep: true }
    );
  }

  function setHofstadterMode(value: boolean): void {
    settings.value.hofstadterMode = value;
  }

  function setPrefixAbbreviationEnabled(value: boolean): void {
    settings.value.prefixAbbreviationEnabled = value;
  }

  function setTheme(value: ThemePreference): void {
    settings.value.theme = value;
  }

  function setEntityListDensity(value: EntityListDensity): void {
    settings.value.entityListDensity = value;
  }

  function setEntityListGrouping(value: EntityListGrouping): void {
    settings.value.entityListGrouping = value;
  }

  return {
    settings,
    setHofstadterMode,
    setPrefixAbbreviationEnabled,
    setTheme,
    setEntityListDensity,
    setEntityListGrouping,
  };
}
