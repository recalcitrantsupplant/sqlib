/**
 * Screens versus scopes on the rail.
 *
 * `build` was the only rail entry that was a destination rather than a filter,
 * and every place that knew it said `section === 'build'`. Notebook is the
 * second, so the distinction is now a set: what is worth pinning is that the
 * set and the scoping tables stay in step — a screen with a tree scope, or a
 * scope with no route, is the drift these tables exist to prevent.
 */
import { describe, it, expect } from 'vitest';
import {
  RAIL_SECTIONS,
  SCREEN_SECTIONS,
  SCREEN_SECTION_PATHS,
  isScreenSection,
  treeCategoriesFor,
  treeVisibilityFor,
} from '@/lib/railSections';

describe('screen sections', () => {
  it('are rail sections', () => {
    for (const section of SCREEN_SECTIONS) {
      expect(RAIL_SECTIONS).toContain(section);
    }
  });

  it('each name a route, because selecting one navigates rather than filters', () => {
    for (const section of SCREEN_SECTIONS) {
      expect(SCREEN_SECTION_PATHS[section]).toMatch(/^\//);
    }
  });

  it('scope nothing — a screen renders the whole library, so the tree is unscoped', () => {
    for (const section of SCREEN_SECTIONS) {
      expect(treeCategoriesFor(section)).toBeNull();
      expect(treeVisibilityFor(section)).toEqual({ libraries: true, backends: true });
    }
  });

  it('leave every other section scoping as it did', () => {
    for (const section of RAIL_SECTIONS) {
      if (isScreenSection(section)) continue;
      expect(treeCategoriesFor(section)).not.toBeNull();
    }
  });

  /*
   * Notebook took this slot from a `library` screen that rendered every query
   * in the library as a cell. One front page, and it is the one someone wrote.
   */
  it('puts Notebook first — it is the library\'s front page, not a drill-down', () => {
    expect(RAIL_SECTIONS[0]).toBe('notebooks');
  });
});
