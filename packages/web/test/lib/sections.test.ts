import { describe, it, expect } from 'vitest';
import {
  SECTION_DEFINITIONS,
  LIST_SECTIONS,
  isListSection,
  listSectionForDraftSection,
  supportsSaved,
  supportsScratch,
  SECTION_ITEM_TYPES,
  type ListSection,
} from '@/lib/sections';
import { DRAFT_SECTIONS } from '@/composables/useCallableDrafts';
import { RAIL_SECTIONS, isScreenSection } from '@/lib/railSections';

describe('the section table', () => {
  it('covers every rail section that is a list', () => {
    // Library and Build are screens and Backends is account-level; the rest
    // are lists.
    const listable = RAIL_SECTIONS.filter((s) => !isScreenSection(s) && s !== 'backends');
    expect([...LIST_SECTIONS].sort()).toEqual([...listable].sort());
  });

  it('keys each definition by its own section name', () => {
    for (const [key, definition] of Object.entries(SECTION_DEFINITIONS)) {
      expect(definition.section).toBe(key);
    }
  });

  /*
   * One scratch section per list section, in both directions. Two sections
   * sharing a draft section would put one section's unsaved items in the
   * other's cluster, and a `?scratch=` link would resolve to the wrong screen.
   */
  it('maps draft sections one-to-one', () => {
    const draftSections = LIST_SECTIONS
      .map((section) => SECTION_DEFINITIONS[section].draftSection)
      .filter((value): value is NonNullable<typeof value> => value !== null);
    expect(new Set(draftSections).size).toBe(draftSections.length);

    for (const section of LIST_SECTIONS) {
      const draftSection = SECTION_DEFINITIONS[section].draftSection;
      if (draftSection) expect(listSectionForDraftSection(draftSection)).toBe(section);
    }
  });

  it('gives every section something to show', () => {
    // A section with neither saved entities nor scratch is an empty screen
    // with a + New that does nothing.
    for (const section of LIST_SECTIONS) {
      expect(supportsSaved(section) || supportsScratch(section)).toBe(true);
    }
  });

  it('names every saved kind it lists', () => {
    for (const section of LIST_SECTIONS) {
      for (const kind of SECTION_DEFINITIONS[section].savedKinds) {
        expect(kind.label.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('lists every saved kind somewhere, and invents none', () => {
    /*
     * `SECTION_DEFINITIONS` is keyed by `ListSection`, so a *section* cannot
     * fall behind its union. An item *type* could: adding one to
     * `SectionItemType` and forgetting to put it in a section's `savedKinds`
     * leaves an entity kind that opens a work area and lists nowhere.
     *
     * `SECTION_ITEM_TYPES` carries a `Covers<>` guard, so the array cannot
     * fall behind the union either; this closes the other half.
     */
    const listed = new Set(
      LIST_SECTIONS.flatMap((section) => SECTION_DEFINITIONS[section].savedKinds.map((kind) => kind.type)),
    );
    expect([...listed].sort()).toEqual([...SECTION_ITEM_TYPES].sort());
  });

  it('draws its draft sections from the draft store vocabulary', () => {
    for (const section of LIST_SECTIONS) {
      const draftSection = SECTION_DEFINITIONS[section].draftSection;
      if (draftSection === null) continue;
      expect(DRAFT_SECTIONS, section).toContain(draftSection);
    }
  });

  /*
   * Tests are library-scoped and benchmarks are not, and that is not an
   * oversight in either direction: a Test has an `isPartOf` because it points
   * at library-scoped callables, while a BenchmarkExperiment is account-level.
   * Getting this backwards makes one list ignore the library strip.
   */
  it('scopes tests to the library and benchmarks to the account', () => {
    expect(SECTION_DEFINITIONS.tests.libraryScoped).toBe(true);
    expect(SECTION_DEFINITIONS.benchmarks.libraryScoped).toBe(false);
  });

  it('keeps tests and benchmarks as separate sections over separate kinds', () => {
    // They share the invocation vocabulary and nothing else: one is judged,
    // the other measured. Folding either into the other loses that.
    expect(SECTION_DEFINITIONS.tests.savedKinds.map((kind) => kind.type)).toEqual(['test']);
    expect(SECTION_DEFINITIONS.benchmarks.savedKinds.map((kind) => kind.type)).toEqual(['benchmark']);
    expect(SECTION_DEFINITIONS.tests.draftSection).not.toBe(SECTION_DEFINITIONS.benchmarks.draftSection);
  });

  it('recognises only real sections', () => {
    expect(isListSection('rules')).toBe(true);
    expect(isListSection('build')).toBe(false);
    expect(isListSection('playground')).toBe(false);
    expect(isListSection(null)).toBe(false);
  });
});

describe('the sections that differ from Queries', () => {
  it('gives Groups both clusters', () => {
    // A canvas serializes, so a group holds an unsaved body like everything
    // else — `+ New` opens one rather than a creation dialog.
    expect(supportsScratch('queryGroups')).toBe(true);
    expect(supportsSaved('queryGroups')).toBe(true);
  });

  it('gives ETL both clusters', () => {
    // An EtlJob is a real server entity, so a pipeline saves into one and
    // the Saved cluster lists it.
    expect(supportsScratch('etl')).toBe(true);
    expect(supportsSaved('etl')).toBe(true);
  });

  it('lists rule sets and nothing else', () => {
    // A rule set is the smallest editable unit: rules and data blocks are
    // edited inside one, so listing them separately would be a second door to
    // a screen that no longer exists.
    const kinds = SECTION_DEFINITIONS.rules.savedKinds.map((kind) => kind.type);
    expect(kinds).toEqual(['ruleSet']);
  });

  it('does not scope benchmarks by library', () => {
    // BenchmarkExperiment has no isPartOf — experiments are account-level.
    expect(SECTION_DEFINITIONS.benchmarks.libraryScoped).toBe(false);
    for (const section of LIST_SECTIONS.filter((s): s is ListSection => s !== 'benchmarks')) {
      expect(SECTION_DEFINITIONS[section].libraryScoped).toBe(true);
    }
  });
});

describe('the argument sets section', () => {
  /*
   * The section that reverses an earlier decision, so it is asserted rather
   * than left to the totality checks above: an argument set is a rail entity
   * like any other, with its own scratch cluster and record page.
   */
  it('is a list section with its own draft section', () => {
    expect(LIST_SECTIONS).toContain('argumentSets');
    const definition = SECTION_DEFINITIONS.argumentSets;
    expect(definition.draftSection).toBe('argumentSet');
    expect(definition.savedKinds.map((kind) => kind.type)).toEqual(['argumentSet']);
    expect(definition.libraryScoped).toBe(true);
  });

  it('is not a cluster inside Tuples: the two list different kinds', () => {
    expect(SECTION_DEFINITIONS.tupleSets.savedKinds.map((kind) => kind.type)).toEqual(['tupleSet']);
  });

  /* "Data" said what a graph is for; "Graphs" says what it is. */
  it('leaves the graphs section labelled Graphs', () => {
    expect(SECTION_DEFINITIONS.dataGraphs.label).toBe('Graphs');
  });
});
