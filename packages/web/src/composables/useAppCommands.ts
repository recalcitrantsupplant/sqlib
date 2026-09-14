// @ts-ignore - Nuxt auto-imports
import { useRoute, useRouter } from '#imports';
import { computed } from 'vue';
import type { FeatureFlagKey } from '@sparql-query-lib/types';

import {
  RAIL_SECTIONS,
  SCREEN_SECTION_PATHS,
  isScreenSection,
  isRailSection,
  type RailSection,
} from '../lib/railSections';
import { useActiveLibrary } from './useActiveLibrary';
import { useCommandPalette } from './useCommandPalette';
import { useCommand, useCommandProvider, type Command } from './useCommandRegistry';
import { useFeatureFlags } from './useFeatureFlags';
import { useQueriesStore } from './useQueriesStore';
import { useQueryGroupsStore } from './useQueryGroupsStore';
import { useSidebarCollapse } from './useSidebarCollapse';
import { useTheme } from './useTheme';

/**
 * The commands that exist everywhere, registered once from app.vue.
 *
 * Everything here is reachable from any screen: the eleven rail destinations,
 * the palette, the cheat sheet, the two view toggles. Anything that needs an
 * open query or an open group is registered by the work area that owns it
 * instead, so it exists only while it would work.
 *
 * The navigation bindings are Vim/Linear-style sequences — `g q` for queries,
 * `g g` for groups — because eleven destinations is more than the modifier
 * combinations worth spending, and because a two-key run reads as a sentence
 * ("go queries") in a way Ctrl+Alt+3 never does.
 */

interface Destination {
  section: RailSection;
  title: string;
  keys: string;
  /** The flag that has to be on, if any; the rail hides these entries too. */
  flag?: FeatureFlagKey;
  keywords?: string;
}

/*
 * One letter per destination, mnemonic where the initial was free and adjacent
 * where it was not: Groups took `g`, so Benchmarks is `m` (measure), Backends
 * `k` (the connection it stands for), Build `a` (the assistant lives there),
 * Tuples `u`. The table is the cheat sheet's source, so a change here is a
 * change everywhere.
 */
const DESTINATIONS: Destination[] = [
  { section: 'library', title: 'Go to Library', keys: 'g l', flag: 'queries', keywords: 'notebook front page' },
  { section: 'queries', title: 'Go to Queries', keys: 'g q', flag: 'queries' },
  { section: 'queryGroups', title: 'Go to Query groups', keys: 'g g', flag: 'queryGroups', keywords: 'groups pipeline' },
  { section: 'rules', title: 'Go to Rules', keys: 'g r', flag: 'rulesSuite', keywords: 'rule sets data blocks' },
  { section: 'etl', title: 'Go to ETL', keys: 'g e', flag: 'playgroundEtl' },
  { section: 'benchmarks', title: 'Go to Benchmarks', keys: 'g m', flag: 'benchmarks', keywords: 'measure performance' },
  { section: 'tests', title: 'Go to Tests', keys: 'g t', flag: 'tests' },
  { section: 'dataGraphs', title: 'Go to Data graphs', keys: 'g d', flag: 'dataGraphs', keywords: 'rdf reference data' },
  { section: 'tupleSets', title: 'Go to Tuple sets', keys: 'g u', flag: 'tupleSets', keywords: 'values rows tabular' },
  { section: 'build', title: 'Go to Build', keys: 'g a', keywords: 'assistant callable library' },
  { section: 'backends', title: 'Go to Backends', keys: 'g k', flag: 'backends', keywords: 'connections endpoints sparql' },
];

export function useAppCommands(): void {
  const route = useRoute();
  const router = useRouter();
  const { isEnabled } = useFeatureFlags();
  const { activeLibraryId } = useActiveLibrary();
  const { togglePalette, toggleCheatSheet } = useCommandPalette();
  const { preference, isDark, setTheme } = useTheme();
  const queriesStore = useQueriesStore();
  const queryGroupsStore = useQueryGroupsStore();

  /**
   * Where a rail section lives as a route.
   *
   * The two screen sections are pages of their own; every other section is the
   * home page under `?section=`, which is exactly what `AppNavRail` drives on
   * index.vue — so a command and a rail click land in the same place, and the
   * destination survives a reload and a shared link.
   */
  const go = (section: RailSection) => {
    const library = activeLibraryId.value ? { library: activeLibraryId.value } : {};
    if (isScreenSection(section)) {
      return router.push({ path: SCREEN_SECTION_PATHS[section], query: library });
    }
    return router.push({ path: '/', query: { ...library, section } });
  };

  /*
   * The left list's fold, keyed the way the sidebars key it themselves —
   * `useSidebarCollapse` holds one shared map, so toggling from here and
   * clicking the hinge are the same state.
   */
  const sidebarKey = computed(() => {
    const section = isRailSection(route.query.section) ? route.query.section : null;
    if (!section) return 'tree';
    return section === 'backends' ? 'backends' : section;
  });
  const { toggle: toggleSidebar } = useSidebarCollapse(sidebarKey);

  const destinations: Command[] = DESTINATIONS.filter((entry) => RAIL_SECTIONS.includes(entry.section)).map((entry) => ({
    id: `go.${entry.section}`,
    title: entry.title,
    group: 'Go to' as const,
    keys: entry.keys,
    keywords: entry.keywords,
    when: () => (entry.flag ? isEnabled(entry.flag) : true),
    run: () => go(entry.section),
  }));

  useCommand([
    ...destinations,
    {
      id: 'palette.open',
      title: 'Command palette',
      group: 'Help',
      keys: ['Mod+k', 'Mod+Shift+p'],
      hidden: true,
      run: togglePalette,
    },
    {
      id: 'help.shortcuts',
      title: 'Keyboard shortcuts',
      group: 'Help',
      keys: '?',
      keywords: 'cheat sheet keys bindings',
      run: toggleCheatSheet,
    },
    {
      id: 'view.sidebar',
      title: 'Toggle the list sidebar',
      group: 'View',
      keys: 'Mod+b',
      keywords: 'collapse fold hide navigator',
      run: toggleSidebar,
    },
    {
      id: 'view.focusEditor',
      title: 'Focus the editor',
      group: 'View',
      keys: 'Mod+Shift+e',
      keywords: 'cursor code query text',
      /*
       * Focus, not selection: the work areas own their editors, and reaching
       * for the mounted CodeMirror through the DOM keeps this command from
       * having to know which of the eleven work areas is on screen. Escape
       * inside the editor is CodeMirror's own way back out.
       */
      when: () => typeof document !== 'undefined'
        && document.querySelector('main .cm-editor .cm-content') !== null,
      run: () => {
        const content = document.querySelector<HTMLElement>('main .cm-editor .cm-content');
        content?.focus();
      },
    },
    {
      id: 'view.theme',
      title: 'Toggle dark mode',
      group: 'View',
      keys: 'Mod+Shift+d',
      keywords: 'light theme appearance',
      /*
       * From 'system' the toggle pins the opposite of what the OS currently
       * gives you — the intent behind the keystroke is "not this", and leaving
       * it on 'system' would make the shortcut appear to do nothing.
       */
      run: () => setTheme(preference.value === 'system'
        ? (isDark.value ? 'light' : 'dark')
        : (preference.value === 'dark' ? 'light' : 'dark')),
    },
  ]);

  /*
   * Jump-to-item, as a provider rather than one command per query: the list is
   * as long as the library and changes under you, and none of it is bindable.
   * The palette asks the stores to load when it opens; here we only read them.
   */
  const jumpTo = (section: RailSection, key: string, id: string) => router.push({
    path: '/',
    query: {
      ...(activeLibraryId.value ? { library: activeLibraryId.value } : {}),
      section,
      [key]: id,
    },
  });

  useCommandProvider(() => [
    ...queriesStore.queries.value.map((query) => ({
      id: `go.query.${query.id}`,
      title: `Query: ${query.name}`,
      group: 'Go to' as const,
      keywords: query.description ?? undefined,
      run: () => jumpTo('queries', 'query', query.id),
    })),
    ...queryGroupsStore.queryGroups.value.map((group) => ({
      id: `go.queryGroup.${group.id}`,
      title: `Query group: ${group.name}`,
      group: 'Go to' as const,
      keywords: group.description ?? undefined,
      run: () => jumpTo('queryGroups', 'queryGroup', group.id),
    })),
  ]);
}
