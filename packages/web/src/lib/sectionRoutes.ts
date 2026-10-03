/**
 * Where a section and the record open in it live in the URL.
 *
 * `/<section>` opens a rail section, `/<section>/<id>` a record in it — a saved
 * entity by its IRI, or an unsaved one by its `urn:ui-temp:` id, which is what
 * tells the two apart. Before this the workspace was one page at `/` that read
 * fourteen query parameters by hand (`?section=`, `?query=`, `?scratch=`, …)
 * and wrote them back from a watcher that had to remember every one of them;
 * the four newest sections were once missing from its comparison, so switching
 * between two of their records left the URL naming the first.
 *
 * What stays in the query string is what modifies a record rather than naming
 * one: `version`, `library`, and a preselected `argumentSet` for "Run with…".
 *
 * The old URLs keep working: `legacyRedirect` maps each to its new path, and a
 * global route middleware applies it (one release, per the work package).
 */
import { sectionForItemType, isScreenSection, RAIL_SECTIONS, type RailSection } from './railSections';
import type { SectionItemType } from './sections';

/** A rail section that is part of the workspace rather than a screen of its own. */
export type RoutedSection = Exclude<RailSection, 'notebooks' | 'mcp'>;

export const ROUTED_SECTIONS = RAIL_SECTIONS.filter(
  (section): section is RoutedSection => !isScreenSection(section),
);

export function isRoutedSection(value: unknown): value is RoutedSection {
  return typeof value === 'string' && (ROUTED_SECTIONS as readonly string[]).includes(value);
}

/** A section, and the record open in it. Both null is the splash. */
export interface SectionRoute {
  section: RoutedSection | null;
  id: string | null;
}

/** Unsaved records carry an id no server minted. */
export function isScratchId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('urn:ui-temp:');
}

export function sectionPath({ section, id }: SectionRoute): string {
  if (!section) return '/';
  return id ? `/${section}/${encodeURIComponent(id)}` : `/${section}`;
}

function single(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' && first ? first : null;
}

/**
 * Read the route's params. Undefined when the first segment names no section,
 * which the page answers with a 404 rather than an empty workspace.
 */
export function parseSectionRoute(params: Record<string, unknown>): SectionRoute | undefined {
  const section = single(params.section);
  const id = single(params.id);
  if (!section) return { section: null, id: null };
  if (!isRoutedSection(section)) return undefined;
  return { section, id };
}

/** The old query parameter that named each kind of saved record. */
export const LEGACY_ITEM_PARAMS: Record<string, SectionItemType> = {
  query: 'query',
  queryGroup: 'queryGroup',
  ruleSet: 'ruleSet',
  benchmark: 'benchmark',
  etlJob: 'etlJob',
  test: 'test',
  dataGraph: 'dataGraph',
  tupleSet: 'tupleSet',
  argumentSet: 'argumentSet',
};

/** Old `?playground=` links, to the section that absorbed each one. */
export const PLAYGROUND_REDIRECTS: Record<string, RoutedSection> = {
  queries: 'queries',
  rules: 'rules',
  etl: 'etl',
};

/** Query parameters that modify a record and survive the redirect unchanged. */
const CARRIED = ['library', 'version'] as const;

export interface LegacyRedirect {
  path: string;
  query: Record<string, string>;
}

/**
 * The new address for an old `/?…` link, or null when the link is not one.
 *
 * Precedence is the old page's: a scratch id first, then the first record
 * parameter, then a playground. `?argumentSet=` alongside a query or group was
 * "Run with…" choosing a set, not a link to the set, and stays a parameter.
 *
 * `resolveScratchSection` answers for a scratch link that does not say its
 * section: only the browser that holds the record knows where it belongs.
 */
export function legacyRedirect(
  query: Record<string, unknown>,
  resolveScratchSection: (id: string) => RoutedSection | null = () => null,
): LegacyRedirect | null {
  const named = (key: string) => single(query[key]);
  const section = named('section');
  const carried: Record<string, string> = {};
  for (const key of CARRIED) {
    const value = named(key);
    if (value) carried[key] = value;
  }

  const scratch = named('scratch');
  if (scratch) {
    const target = isRoutedSection(section) ? section : resolveScratchSection(scratch);
    return { path: sectionPath({ section: target, id: target ? scratch : null }), query: carried };
  }

  for (const [param, type] of Object.entries(LEGACY_ITEM_PARAMS)) {
    const id = named(param);
    if (!id) continue;
    // A preselected set rides along with the callable it was chosen for.
    if (param === 'argumentSet' && (named('query') || named('queryGroup'))) continue;
    const target = sectionForItemType(type);
    if (!isRoutedSection(target)) continue;
    const argumentSet = named('argumentSet');
    const extra: Record<string, string> = argumentSet && param !== 'argumentSet' ? { argumentSet } : {};
    // `?benchmark=true` predates experiments being selectable and meant "the
    // Bench screen", which is the section now.
    const recordId = param === 'benchmark' && id === 'true' ? null : id;
    return { path: sectionPath({ section: target, id: recordId }), query: { ...carried, ...extra } };
  }

  const playground = named('playground');
  if (playground) {
    return { path: sectionPath({ section: PLAYGROUND_REDIRECTS[playground] ?? null, id: null }), query: carried };
  }

  if (section) {
    return { path: sectionPath({ section: isRoutedSection(section) ? section : null, id: null }), query: carried };
  }

  return null;
}
