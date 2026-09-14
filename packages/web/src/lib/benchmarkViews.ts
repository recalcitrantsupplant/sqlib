/**
 * The shapes the benchmark components hand each other.
 *
 * They live here rather than in the components because `<script setup>` cannot
 * export a type, and three of these cross two component boundaries — the plan
 * column builds them, the work area fills them, the detail panels read them.
 */

import type { Covers } from '@/composables/exhaustiveDomain';

/**
 * The axes. Everything on one of these multiplies.
 *
 * `tupleSets` and `dataGraphs` are the rule-set pair: a rule set has no
 * backend axis and takes tuple sets where a query takes argument sets, plus a
 * graph axis of its own. They are separate keys rather than a relabelling of
 * `argumentSets` because a plan may hold both kinds of case at once, and
 * because the two lists of candidates are picked from different libraries.
 */
export type AxisKey =
  | 'cases'
  | 'backends'
  | 'argumentSets'
  | 'tupleSets'
  | 'dataGraphs'
  | 'loadProfiles';

/** The four policy items. None of them multiplies. */
export type SettingKey = 'statistic' | 'equivalence' | 'failure' | 'order';

/*
 * Runtime domains, so a sweep over the axes can iterate them, with the
 * compile-time guard that says when one has fallen behind its union. Adding a
 * further axis without extending the array would silently shrink every matrix
 * built from it — see `exhaustiveDomain.ts`.
 */
export const AXIS_KEYS = [
  'cases',
  'backends',
  'argumentSets',
  'tupleSets',
  'dataGraphs',
  'loadProfiles',
] as const satisfies readonly AxisKey[];
export const _axisKeysCover: Covers<AxisKey, (typeof AXIS_KEYS)[number]> = true;

export const SETTING_KEYS = ['statistic', 'equivalence', 'failure', 'order'] as const satisfies readonly SettingKey[];
export const _settingKeysCover: Covers<SettingKey, (typeof SETTING_KEYS)[number]> = true;

export interface AxisItemView {
  id: string;
  name: string;
  meta?: string;
  /** A CSS colour for the leading square — the store's series colour. */
  dot?: string;
}

export interface AxisGroupView {
  key: AxisKey;
  name: string;
  multiplier: string;
  addLabel: string;
  hint?: string;
  items: AxisItemView[];
  /** False where the axis has nothing the user can add to it. */
  canAdd: boolean;
}

export interface SettingItemView {
  key: SettingKey;
  name: string;
  value: string;
}

export interface RunListItem {
  id: string;
  when: string;
  duration: string;
  note: string;
}

/** One row of a case's support matrix: a backend, and how the case runs on it. */
export interface SupportRow {
  backendId: string;
  name: string;
  dot: string;
  /** Measured on the run in view, or null if this pair has never run. */
  p95Ms: number | null;
  /** Requests behind the p95, so a one-sample number does not read as a trend. */
  samples: number;
  failed: number;
}

/**
 * One row of a rule-set case's graph table: a data graph, and what it cost.
 *
 * The support matrix's counterpart on the axis a rule set actually has. A rule
 * set has no store to compare across, so the comparison worth drawing beside
 * it is the one over graphs: the same rule set, the same seeds, a bigger graph.
 */
export interface GraphCostRow {
  dataGraphId: string;
  name: string;
  /** Measured on the run in view, or null if this graph has never run. */
  p95Ms: number | null;
  samples: number;
  failed: number;
  /**
   * Inferred triples — a rule set's `resultCount`.
   *
   * Null where nothing succeeded, or where the repeats disagree, in which case
   * `triplesVary` says which of the two it is. A rule set producing different
   * output sizes over the same graph was not measuring the same thing twice,
   * and that is worth saying rather than averaging away.
   */
  triples: number | null;
  triplesVary: boolean;
  /**
   * Passes to fixpoint over this graph, reported side by side rather than
   * averaged.
   *
   * The pass counts across the graph axis are the finding a rules benchmark
   * exists for: the same rule set needing four passes over a small graph and
   * eleven over a large one is what the timings alone cannot say. Null where
   * nothing recorded passes, or where the repeats of this graph disagree —
   * `passesVary` says which, the same pairing `triples`/`triplesVary` has.
   */
  passes: number | null;
  passesVary: boolean;
}

/** A membership checkbox in an axis picker. */
export interface PickerOption {
  id: string;
  name: string;
  meta?: string;
  dot?: string;
}
