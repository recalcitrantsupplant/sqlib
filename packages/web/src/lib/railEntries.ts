/**
 * The rail's sections, as data.
 *
 * The table used to live inside `AppNavRail`. It is out here because the
 * splash screen lists the same sections with the same labels and the same
 * enabled/disabled answer, and two copies of that list would disagree the
 * first time one of them gained an entry.
 *
 * `feature` is the flag that decides whether the section exists at all; null
 * means the section is always on. The rail hides a disabled section; the
 * splash names it in a muted tone, because "this deployment does not have
 * that" is worth knowing on the screen you land on.
 */
import type { Component } from 'vue';
import {
  Plug,
  NotebookPen,
  FileCode2,
  Workflow,
  Scale,
  GitFork,
  Gauge,
  CircleCheck,
  Braces,
  Database,
  Table2,
  Server,
} from '@lucide/vue';
import type { FeatureFlagKey } from '@sparql-query-lib/types';
import type { RailSection } from './railSections';

export interface RailEntry {
  section: RailSection;
  label: string;
  title: string;
  icon: Component;
  /** The flag the section depends on, or null where it has none. */
  feature: FeatureFlagKey | null;
  /** Draws the rule that separates account-level Backends from the rest. */
  dividerBefore?: boolean;
}

/*
 * Order is the v2 mockup's, and the labels are deliberately short enough to fit
 * the 56px rail without wrapping. There is no Play entry: a playground is an
 * unsaved item inside its own section, not a destination (nav doc §1).
 *
 * The divider sits above Backends, not below MCP. Connections are
 * account-level and libraries point at them, so Backends is one level out from
 * everything above it — the rule is the whole explanation (nav doc §2).
 */
export const RAIL_ENTRIES: RailEntry[] = [
  // First, because it is the library's front page — the screen you show
  // someone before they know which type they want. Everything under it reads
  // as a drill-down. It replaced a screen that rendered every query in the
  // library as a cell whether or not anyone had asked for it: the contents are
  // what you import here, and what you write around them is the point.
  { section: 'notebooks', label: 'Notebook', title: 'Notebook — prose and cells you write, run in order, with each result named', icon: NotebookPen, feature: 'notebook' },
  { section: 'queries', label: 'Query', title: 'Queries', icon: FileCode2, feature: 'queries' },
  { section: 'queryGroups', label: 'Groups', title: 'Query groups', icon: Workflow, feature: 'queryGroups' },
  { section: 'rules', label: 'Rules', title: 'Rules, data blocks and rule sets', icon: Scale, feature: 'rulesSuite' },
  { section: 'etl', label: 'ETL', title: 'ETL', icon: GitFork, feature: 'playgroundEtl' },
  { section: 'benchmarks', label: 'Bench', title: 'Benchmarks', icon: Gauge, feature: 'benchmarks' },
  // Beside Bench because they invoke the same subjects the same way; separate
  // from it because a test is judged and a benchmark is measured.
  { section: 'tests', label: 'Tests', title: 'Tests — a callable, its inputs, and what it should produce', icon: CircleCheck, feature: 'tests' },
  // Data graphs are registered reference RDF — the same move Backends made for
  // remote capabilities, so they get the same kind of home rather than living
  // in a dropdown inside the editor of something that consumes them.
  { section: 'dataGraphs', label: 'Graphs', title: 'Data graphs — reference RDF the library holds', icon: Database, feature: 'dataGraphs' },
  // Beside Data because they are the same kind of thing — a static asset the
  // library registers — differing in shape rather than in kind. A data graph is
  // the store something runs against; a tuple set is rows spliced into a VALUES
  // clause and consumed. RDF input is data, tabular input is a parameter.
  { section: 'tupleSets', label: 'Tuples', title: 'Tuple sets — tabular rows a rule set\'s TUPLE(…) declaration is filled with', icon: Table2, feature: 'tupleSets' },
  // The third of the three: Graphs and Tuples are pieces you keep, an argument
  // set is one filled-in call to a query or a group — a table per VALUES
  // clause, a graph per start-node port, and the LIMIT/OFFSET numbers.
  { section: 'argumentSets', label: 'Argument sets', title: 'Argument sets — one call\'s worth of input for a query or a group', icon: Braces, feature: 'argumentSets' },
  { section: 'mcp', label: 'MCP', title: 'MCP server: use sqlib from Claude or ChatGPT', icon: Plug, feature: 'mcp' },
  {
    section: 'backends',
    label: 'Backends',
    title: 'Account-level — shared by every library',
    icon: Server,
    feature: 'backends',
    dividerBefore: true,
  },
];
