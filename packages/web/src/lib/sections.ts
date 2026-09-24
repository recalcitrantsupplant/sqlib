/**
 * What each rail section puts in its sidebar.
 *
 * One table, six sections. Before this existed the Queries and Groups
 * sidebars were two hand-written branches in `pages/index.vue`, and adding
 * Rules, ETL and Bench that way would have meant five copies of the same
 * six decisions — which of them differ only in a noun and a store. They are
 * declared here instead, and `index.vue` reads them.
 *
 * The three axes a section actually varies on:
 *
 * - **What it saves.** `savedKinds` is the entity kinds its Saved cluster
 *   lists, in list order. Rules lists three (rule sets, rules, data blocks);
 *   everything else lists one. A section may list none, and the sidebar draws
 *   scratch-only when it does.
 * - **What it scratches.** `draftSection` is the `useCallableDrafts` section
 *   its unsaved items live in, or null where the work area cannot hold an
 *   unsaved body at all. Every section scratches today; the field stays
 *   nullable because "cannot hold an unsaved body" is a real shape a section
 *   can have, and the sidebar draws differently when it does.
 * - **What scopes it.** `libraryScoped` is false for Bench, because a
 *   benchmark experiment has no `isPartOf` — experiments are account-level,
 *   like backends. The rail's library switcher still scopes the rest of the
 *   app, it just does not filter this list.
 */
import type { FeatureFlagKey } from '@sparql-query-lib/types';
import type { DraftSection } from '../composables/useCallableDrafts';
import type { RailSection } from './railSections';
import type { Covers } from '@/composables/exhaustiveDomain';

/** A saved entity kind a sidebar row can be, and the work area it opens. */
export type SectionItemType = 'query' | 'queryGroup' | 'ruleSet' | 'benchmark' | 'etlJob' | 'test' | 'dataGraph' | 'tupleSet' | 'argumentSet';

/**
 * Every saved kind, for enumeration. See `exhaustiveDomain.ts`.
 *
 * `SECTION_DEFINITIONS` is a `Record<ListSection, …>`, so the *sections* cannot
 * fall behind their union. The item types are values inside those definitions
 * and had no such guard: a kind added to the union and forgotten in every
 * section's `savedKinds` would list nowhere, and nothing would say so.
 */
export const SECTION_ITEM_TYPES = [
  'query', 'queryGroup', 'ruleSet', 'benchmark', 'etlJob', 'test', 'dataGraph', 'tupleSet', 'argumentSet',
] as const satisfies readonly SectionItemType[];

export const _sectionItemTypesCover: Covers<SectionItemType, (typeof SECTION_ITEM_TYPES)[number]> = true;

/** Sections that render the flat sidebar. `connect` and `backends` are not lists. */
export type ListSection = Extract<RailSection, 'queries' | 'queryGroups' | 'rules' | 'etl' | 'benchmarks' | 'tests' | 'dataGraphs' | 'tupleSets' | 'argumentSets'>;

export interface SavedKind {
  type: SectionItemType;
  /** Subheading inside Saved. Only drawn when a section lists more than one. */
  label: string;
}

export interface SectionDefinition {
  section: ListSection;
  feature: FeatureFlagKey;
  /** Section heading, uppercased by the sidebar. */
  label: string;
  /** Singular/plural for the prose: filter label, empty state, `+ New` title. */
  noun: string;
  nounPlural: string;
  /** The scratch section, or null where the work area cannot hold an unsaved body. */
  draftSection: DraftSection | null;
  savedKinds: SavedKind[];
  /** False where the entity has no `isPartOf` and the active library cannot filter it. */
  libraryScoped: boolean;
  /**
   * What the section's entity is, in a sentence or two, for the pane that shows
   * when the section has nothing open. Someone who opened the section without
   * knowing what it holds is the reader.
   */
  blurb: string;
  /** The heading in `docs/concepts.md` that defines the entity. */
  docsAnchor: string;
}

export const SECTION_DEFINITIONS: Record<ListSection, SectionDefinition> = {
  queries: {
    section: 'queries',
    feature: 'queries',
    label: 'Queries',
    noun: 'query',
    nounPlural: 'queries',
    draftSection: 'query',
    savedKinds: [{ type: 'query', label: 'Queries' }],
    libraryScoped: true,
    blurb:
      'A query is a named, versioned SPARQL query. Its parameters are declared in the query text — a VALUES clause whose only row is all UNDEF, or a LIMIT or OFFSET written as 000n — and you invoke a version with arguments for them.',
    docsAnchor: 'query-and-queryversion',
  },
  queryGroups: {
    section: 'queryGroups',
    feature: 'queryGroups',
    label: 'Groups',
    noun: 'group',
    nounPlural: 'groups',
    // A canvas serializes, so a group holds an unsaved body like everything
    // else: `+ New` opens an untitled canvas and Save creates the group and
    // its v1 together. No creation dialog.
    draftSection: 'group',
    savedKinds: [{ type: 'queryGroup', label: 'Groups' }],
    libraryScoped: true,
    blurb:
      'A group is a canvas of execution steps: queries, rule sets and patches wired together, with each edge carrying bindings, triples or a boolean from one step\'s output to the next one\'s input. The start node\'s ports are the group\'s own parameters, so a group is called like a query.',
    docsAnchor: 'querygroup',
  },
  rules: {
    section: 'rules',
    feature: 'rulesSuite',
    label: 'Rules',
    noun: 'rule set',
    nounPlural: 'rule sets',
    draftSection: 'rule',
    /*
     * Rule sets, and only rule sets.
     *
     * **A rule set is the minimum editable unit.** Rules and data blocks are
     * what one is made of, not things you author on their own: a rule outside a
     * rule set has no prologue to resolve its prefixes, nothing to stratify
     * against, and no way to run. They stayed listed here while the rule set
     * work area lacked a drill-down, and the result was a second, poorer editor
     * for the same text — no stratification, no equivalent SPARQL — reachable
     * by clicking a row that looked like any other.
     *
     * They remain entities, because a rule set references rule *versions*;
     * reusing one across rule sets is a copy-or-import convenience, not a
     * screen.
     */
    savedKinds: [
      { type: 'ruleSet', label: 'Rule sets' },
    ],
    libraryScoped: true,
    blurb:
      'A rule set is the smallest runnable unit of inference: SRL rules and DATA blocks, stratified and evaluated to fixpoint against a data graph or a backend. Rules and data blocks are edited inside one.',
    docsAnchor: 'rule-datablock-and-ruleset',
  },
  etl: {
    section: 'etl',
    feature: 'etl',
    label: 'ETL',
    noun: 'pipeline',
    nounPlural: 'pipelines',
    draftSection: 'etl',
    savedKinds: [{ type: 'etlJob', label: 'Pipelines' }],
    libraryScoped: true,
    blurb:
      'A pipeline builds RDF from tabular sources: DuckDB SQL reads the rows, a SPARQL template constructs triples from them, and the result is written to a backend.',
    docsAnchor: 'etl-pipeline',
  },
  benchmarks: {
    section: 'benchmarks',
    feature: 'benchmarks',
    label: 'Bench',
    noun: 'benchmark',
    nounPlural: 'benchmarks',
    draftSection: 'bench',
    savedKinds: [{ type: 'benchmark', label: 'Benchmarks' }],
    // A BenchmarkExperiment has no isPartOf; experiments are account-level.
    libraryScoped: false,
    blurb:
      'A benchmark measures a callable rather than judging it. A run records iterations, per-node runs and observations, so timings can be read per node as well as per call.',
    docsAnchor: 'benchmark',
  },
  /*
   * Tests earn a section of their own rather than a tab under each callable,
   * because a test is not a property of its subject: one list answers "what is
   * tested here, and is it passing?" across queries, groups and rule sets at
   * once. The Tests tab on a record page is this same list filtered to one
   * subject — one set of entities, two views, so they cannot disagree.
   *
   * Benchmarks keep their own section beside this one. They share the
   * invocation vocabulary and nothing else: one is judged, the other measured.
   */
  /*
   * Data graphs get a section for the reason the issue that introduced them
   * gives: they are the same move backends made. The library registers remote
   * capabilities as Backends and reference RDF as DataGraphs, and a thing you
   * register needs somewhere to be registered — not a dropdown inside the
   * editor of something that happens to consume it.
   *
   * Deliberately *not* a fourth kind under Rules. Listing a data graph beside
   * DATA blocks would re-imply it is part of a rule set, which is the exact
   * conflation this entity exists to end: DATA blocks are part of the rule set
   * and come out in the inferred output; a data graph is the input.
   */
  dataGraphs: {
    section: 'dataGraphs',
    feature: 'dataGraphs',
    /*
     * "Graphs", not "Data". The old label said what the graph is *for* — the
     * store rules run against — which stopped being the whole story once a
     * group could take several, and once a backend could be hydrated from one.
     * "Graphs" says what it is, which is what Tuples does for tables. The
     * entity is still `DataGraph`.
     */
    label: 'Graphs',
    noun: 'data graph',
    nounPlural: 'data graphs',
    draftSection: 'dataGraph',
    savedKinds: [{ type: 'dataGraph', label: 'Data graphs' }],
    libraryScoped: true,
    blurb:
      'A data graph is reference RDF registered in the library, stored verbatim in whatever serialisation it arrived in. It seeds the store a rule set or a hermetic test runs against, fills a group\'s graph port, or hydrates a backend.',
    docsAnchor: 'datagraph',
  },
  /*
   * Tuple sets sit beside Data for the reason they are a separate entity at
   * all: both are static assets a library registers, and they differ in shape
   * — one is a graph, one is a table — not in kind.
   *
   * The split matters because the two are consumed at different seams. A data
   * graph is the store a rule set runs *against*: it occupies the same slot a
   * backend does, which is why a test or benchmark can vary one in place of the
   * other. A tuple set is never loaded into a store at all — its rows are
   * spliced into a query as a VALUES block, or matched positionally against a
   * TUPLE(…) declaration, and consumed. RDF input is data; tabular input is a
   * parameter.
   *
   * A tuple set is the *rule set's* tabular input: rows matched positionally
   * against a TUPLE(…) declaration. A query's and a group's tabular input is an
   * argument set, which has its own section below.
   */
  tupleSets: {
    section: 'tupleSets',
    feature: 'tupleSets',
    label: 'Tuples',
    noun: 'tuple set',
    nounPlural: 'tuple sets',
    draftSection: 'tupleSet',
    savedKinds: [{ type: 'tupleSet', label: 'Tuple sets' }],
    libraryScoped: true,
    blurb:
      'A tuple set is a named, versioned table of RDF terms. It is never loaded into a store: its rows are spliced into a query\'s VALUES clause, or matched against a rule set\'s TUPLE( … ) declaration.',
    docsAnchor: 'tupleset',
  },
  /*
   * An argument set is one call's worth of input to a query or a group: a table
   * for each VALUES clause, a graph for each of a group's start-node ports, and
   * the LIMIT/OFFSET numbers.
   *
   * This entry reverses an earlier decision, recorded here because the reasons
   * given for it read as settled and were not. The claim was that an argument
   * set "binds rows to one callable's signature and is meaningless anywhere
   * else", so it should stay with its query. The codebase already disagreed
   * three ways: `scope` is documented as provenance and explicitly "not a
   * fence", which is why the switcher computes a fits/partial/mismatch verdict
   * against whatever callable is open; `isPartOf → Library` is required and
   * `GET /argument-sets?libraryId=` exists; and a test case pins an argument
   * set *version*, so a rail entity already referenced one that had no rail
   * entry of its own.
   *
   * Not a cluster inside Tuples either: `LIMIT 20` and a data graph are not
   * tables, and the section name would lie.
   */
  argumentSets: {
    section: 'argumentSets',
    feature: 'argumentSets',
    label: 'Argument sets',
    noun: 'argument set',
    nounPlural: 'argument sets',
    draftSection: 'argumentSet',
    savedKinds: [{ type: 'argumentSet', label: 'Argument sets' }],
    libraryScoped: true,
    blurb:
      'An argument set is one call\'s worth of input: a table for every VALUES clause the callable declares, a number for every named limit or offset, and a graph for each of a group\'s start-node graph ports. A version is immutable, so a test or an MCP call that pins one is reproducible.',
    docsAnchor: 'argumentset',
  },
  tests: {
    section: 'tests',
    feature: 'tests',
    label: 'Tests',
    noun: 'test',
    nounPlural: 'tests',
    draftSection: 'test',
    savedKinds: [{ type: 'test', label: 'Tests' }],
    // A Test belongs to a library, like the callables it points at.
    libraryScoped: true,
    blurb:
      'A test is an invocation plus an expectation, run once and judged pass or fail. Its subject is a query, a group or a rule set, and its version holds the inputs it supplies and the result it expects.',
    docsAnchor: 'test',
  },
};

export const LIST_SECTIONS = Object.keys(SECTION_DEFINITIONS) as ListSection[];

export function isListSection(value: unknown): value is ListSection {
  return typeof value === 'string' && value in SECTION_DEFINITIONS;
}

export function sectionDefinition(section: ListSection): SectionDefinition {
  return SECTION_DEFINITIONS[section];
}

/** The section a scratch record belongs to, for resolving a `?scratch=` link. */
export function listSectionForDraftSection(draftSection: DraftSection): ListSection | null {
  for (const definition of Object.values(SECTION_DEFINITIONS)) {
    if (definition.draftSection === draftSection) return definition.section;
  }
  return null;
}

/** Whether a section can hold unsaved items at all — gates the whole cluster. */
export function supportsScratch(section: ListSection): boolean {
  return SECTION_DEFINITIONS[section].draftSection !== null;
}

/** Whether a section has any saved entities — false makes the sidebar scratch-only. */
export function supportsSaved(section: ListSection): boolean {
  return SECTION_DEFINITIONS[section].savedKinds.length > 0;
}
