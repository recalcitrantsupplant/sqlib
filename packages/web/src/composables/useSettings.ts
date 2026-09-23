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
/**
 * How the Saved cluster is split.
 *
 * `origin` is available only where a section's rows carry one (Graphs, Argument
 * sets). It is a weak organiser on purpose: a set made on one query is
 * legitimately what another wants, and a graph minted from a group is an
 * ordinary graph the moment it exists — so origin is how you *find* things and
 * tags are how you *mean* things.
 */
export type EntityListGrouping = 'none' | 'tag' | 'origin';

interface Settings {
  hofstadterMode: boolean;
  prefixAbbreviationEnabled: boolean;
  theme: ThemePreference;
  /** Row height in the section sidebars: 26px names, or name plus description. */
  entityListDensity: EntityListDensity;
  /** Whether the Saved cluster is grouped, and by what. */
  entityListGrouping: EntityListGrouping;
  settingsVersion: number;
}

const STORAGE_KEY = 'sparql-query-lib-settings';

/**
 * Bumped when a default changes in a way stored settings should pick up.
 * v2: grouping by tag became the default. Every save writes the whole object,
 * so anyone who had touched any setting carried `entityListGrouping: 'none'`
 * without ever having chosen it; below v2 that value is dropped on load.
 */
const SETTINGS_VERSION = 2;

const DEFAULT_SETTINGS: Settings = {
  hofstadterMode: false, // System library hidden by default
  prefixAbbreviationEnabled: true, // Prefix abbreviation enabled by default
  theme: 'system', // Follow the OS preference unless the user picks a side
  entityListDensity: 'compact', // As drawn: more of the library on screen at once
  entityListGrouping: 'tag', // Grouped by tag; a library with no tags reads as flat
  settingsVersion: SETTINGS_VERSION,
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
      if ((parsed.settingsVersion ?? 1) < 2) delete parsed.entityListGrouping;
      parsed.settingsVersion = SETTINGS_VERSION;
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
