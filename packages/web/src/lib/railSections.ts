/**
 * The nav rail's sections, and what each one scopes the artifact tree to.
 *
 * Order is the v2 mockup's, with Library ahead of it: the library's front page,
 * then the library-scoped sections that drill down from it, then Build, then
 * a divider, then Backends. Backends is account-level — libraries point at
 * connections rather than containing them — and the divider says so without a
 * word of explanation.
 *
 * `library` and `build` are the odd ones out among the rest: they are screens
 * (`/library`, `/build`), not scopes, and they render without the tree at all —
 * inside either the scope is the whole library, so a per-type navigator would
 * only duplicate the rail.
 *
 * There is no `playground` section, and no playground screens either. A
 * playground is not a place, it is an unsaved item — the scratch record in
 * `useCallableDrafts` — and every section now lists its own.
 *
 * A null section means "no scope" and renders the tree exactly as it was
 * before the rail existed. That is the state the app starts in, and it is
 * transitional: the rail is opt-in until every screen has an entry.
 */
export const RAIL_SECTIONS = [
  'library',
  'queries',
  'queryGroups',
  'rules',
  'etl',
  'benchmarks',
  'tests',
  'dataGraphs',
  'tupleSets',
  'argumentSets',
  'build',
  'backends',
] as const;

export type RailSection = (typeof RAIL_SECTIONS)[number];

/**
 * The sections that are screens rather than tree scopes.
 *
 * `build` was the first; `library` is the second. Both render the whole library
 * at once with no per-type navigator, and both live at their own route, so
 * neither has a scoping entry in the maps below — the `Exclude` keeps that a
 * type error rather than a dead entry somebody has to invent a value for.
 */
export const SCREEN_SECTIONS = ['library', 'build'] as const;

export type ScreenSection = (typeof SCREEN_SECTIONS)[number];

export function isScreenSection(section: RailSection): section is ScreenSection {
  return (SCREEN_SECTIONS as readonly string[]).includes(section);
}

/** Where a screen section lives. Every other section is a query on `/`. */
export const SCREEN_SECTION_PATHS: Record<ScreenSection, string> = {
  library: '/library',
  build: '/build',
};

export function isRailSection(value: unknown): value is RailSection {
  return typeof value === 'string' && (RAIL_SECTIONS as readonly string[]).includes(value);
}

/** The tree's top-level sections, keyed by what the rail is scoped to. */
export interface TreeVisibility {
  libraries: boolean;
  backends: boolean;
}

/** The per-library categories inside the Libraries section. */
export type TreeCategory = 'queries' | 'queryGroups' | 'ruleSets' | 'benchmarks' | 'tests' | 'dataGraphs' | 'tupleSets';

/*
 * No section scopes the tree any more. The library sections render the
 * flat sidebar and Backends renders its own list and record page, so the tree
 * survives only as the unscoped view — these entries exist to keep the map
 * total, not because they are reachable.
 */
const SECTION_VISIBILITY: Record<Exclude<RailSection, ScreenSection>, TreeVisibility> = {
  queries: { libraries: true, backends: false },
  queryGroups: { libraries: true, backends: false },
  rules: { libraries: true, backends: false },
  etl: { libraries: false, backends: false },
  benchmarks: { libraries: true, backends: false },
  tests: { libraries: true, backends: false },
  dataGraphs: { libraries: true, backends: false },
  tupleSets: { libraries: true, backends: false },
  argumentSets: { libraries: true, backends: false },
  backends: { libraries: false, backends: true },
};

const SECTION_CATEGORIES: Record<Exclude<RailSection, ScreenSection>, TreeCategory[]> = {
  queries: ['queries'],
  queryGroups: ['queryGroups'],
  // A rule set is the smallest editable unit — rules and data blocks are
  // edited inside one, so the section lists rule sets and nothing else.
  rules: ['ruleSets'],
  etl: [],
  benchmarks: ['benchmarks'],
  tests: ['tests'],
  dataGraphs: ['dataGraphs'],
  tupleSets: ['tupleSets'],
  /*
   * Empty, unlike the sections above it. The tree predates argument sets and
   * has no category for one; it survives only as the unscoped view (see the
   * note on SECTION_VISIBILITY), so adding a category would be inventing a
   * navigator nobody reaches rather than keeping this map total.
   */
  argumentSets: [],
  backends: [],
};

const ALL_VISIBLE: TreeVisibility = { libraries: true, backends: true };

export function treeVisibilityFor(section: RailSection | null | undefined): TreeVisibility {
  if (!section || isScreenSection(section)) return ALL_VISIBLE;
  return SECTION_VISIBILITY[section];
}

export function treeCategoriesFor(section: RailSection | null | undefined): TreeCategory[] | null {
  if (!section || isScreenSection(section)) return null;
  return SECTION_CATEGORIES[section];
}

/** Which rail entry should light up for a tree selection. */
export function sectionForItemType(itemType: string | null | undefined): RailSection | null {
  switch (itemType) {
    case 'query':
      return 'queries';
    case 'queryGroup':
      return 'queryGroups';
    case 'ruleSet':
      return 'rules';
    case 'benchmark':
      return 'benchmarks';
    case 'test':
      return 'tests';
    case 'dataGraph':
      return 'dataGraphs';
    case 'tupleSet':
      return 'tupleSets';
    case 'argumentSet':
      return 'argumentSets';
    case 'etlJob':
      return 'etl';
    default:
      return null;
  }
}
