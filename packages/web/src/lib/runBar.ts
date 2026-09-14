/**
 * The run bar's vocabulary.
 *
 * These live outside the SFC because `<script setup>` cannot export, and
 * because every screen that draws a run sentence has to name the same parts:
 * what it runs *with*, what it runs *against*, what it wants back *as*, and
 * what the whole recipe can be kept as.
 */
import type { FeatureFlagKey } from '@sparql-query-lib/types';

/** The icon vocabulary a pick may draw from. Named by role, not by glyph. */
export type PickIcon = 'tuples' | 'data' | 'arguments' | 'cases' | 'strata' | 'backends';

/** One term of the "with" clause. */
export interface RunBarPick {
  /** Emitted back on `pick`; also the `data-testid` suffix. */
  key: string;
  /** The muted noun in front of the value: "tuples", "data", "arguments". */
  kind?: string;
  value: string;
  /** Draw `emptyLabel` in italic instead of `value`. */
  empty?: boolean;
  emptyLabel?: string;
  icon?: PickIcon;
  title?: string;
  disabled?: boolean;
  /** A statement, not a control: no chevron, no click, no hover. */
  inert?: boolean;
}

/** One option of a choice. `muted` draws it played down but still selectable. */
export interface RunBarChoiceOption {
  value: string;
  label: string;
  /**
   * Shown, selectable, but not suggested — a format that would be odd for the
   * query at hand, say. Drawn greyed so the suggested ones read first.
   */
  muted?: boolean;
  title?: string;
}

/** A heading and the options under it, when a flat list would say too little. */
export interface RunBarChoiceGroup {
  key: string;
  label: string;
  options: RunBarChoiceOption[];
}

/** The "against" and "as" terms: a choice, or a fact when there is no choice. */
export interface RunBarChoice {
  value: string;
  options: RunBarChoiceOption[];
  /**
   * The same options under headings. When present the dropdown draws these
   * instead; `options` stays the flat list the readonly label reads from.
   */
  groups?: RunBarChoiceGroup[];
  loading?: boolean;
  disabled?: boolean;
  /** No dropdown — the subject does not get to choose. `label` says what is. */
  readonly?: boolean;
  label?: string;
  title?: string;
}

/** What the recipe beyond the rule can be kept as. */
export type CreateTarget = 'benchmark' | 'test';

/**
 * The feature each target creates into.
 *
 * The bar is the door: pressing `create test` in a build with `tests` off calls
 * a route the client refuses before it is sent, so the button offered a feature
 * that is not there and said so as an error toast. `RunBar` filters on this
 * rather than each screen filtering its own list — three screens pass
 * `['benchmark', 'test']` today and a fourth would be written the same way, so
 * the one place that can be right is the bar itself.
 */
export const CREATE_TARGET_FEATURE: Record<CreateTarget, FeatureFlagKey> = {
  benchmark: 'benchmarks',
  test: 'tests',
};

export interface RunOption {
  key: string;
  label: string;
  disabled?: boolean;
}
