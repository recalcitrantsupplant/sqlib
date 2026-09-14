/**
 * How far `tupleSets`, `dataGraphs` and `argumentSets` reach outside their own
 * rail sections.
 *
 * These three are not features in the way `tests` or `etl` are. They are
 * **inputs**: a tuple set fills a query's VALUES clause and a rule set's
 * `TUPLE(…)` declaration, a data graph is what a rule set or a hermetic query
 * test runs against, an argument set is what a callable is called with. Every
 * one of them is named from a screen that is not its own section, and the
 * server says so in the clearest way available — `/tuple-sets`, `/data-graphs`
 * and `/argument-sets` are registered without consulting these flags, each with
 * a comment giving the reason ("gating it would leave argument sets referencing
 * versions nothing could resolve").
 *
 * So the flag hides a **section**, not an entity, and the split this composable
 * exists to keep is:
 *
 * - **Reading an input is never gated.** A picker, a resolution, a preview. A
 *   rule set that pins a data graph still has to run, and a query whose clause
 *   names a tuple set still has to run against its rows — silently fewer rows
 *   is a wrong answer, which is worse than a refusal.
 * - **A door into the section is absent.** Navigating there, or creating a
 *   record you would then have to manage there. That is the rule
 *   `docs/reference/feature-flags.md` states for `tests`, and it holds here
 *   for the same reason: a control that leads somewhere this build does not
 *   draw is a control you press to learn nothing.
 *
 * Both halves are read through here rather than through `isEnabled` at each
 * door, so that a sixth door asks the question the five ask, and
 * `inputSectionDoors.test.ts` holds them to it.
 */
import { computed, type ComputedRef } from 'vue';
import type { FeatureFlagKey } from '@sparql-query-lib/types';
import { useFeatureFlags } from './useFeatureFlags';

/** The three entity kinds that are inputs to a callable as well as sections. */
export type InputSectionKind = 'tupleSet' | 'dataGraph' | 'argumentSet';

/**
 * Which flag draws each section.
 *
 * Written once and exported so a door cannot pair a kind with the wrong flag,
 * and so the guard can enumerate the kinds rather than re-listing them.
 */
export const INPUT_SECTION_FEATURE: Record<InputSectionKind, FeatureFlagKey> = {
  tupleSet: 'tupleSets',
  dataGraph: 'dataGraphs',
  argumentSet: 'argumentSets',
};

export function useInputSections() {
  const { isEnabled } = useFeatureFlags();

  /**
   * Whether this build draws the rail section for `kind`.
   *
   * The only question a door may ask. It is deliberately *not* named
   * "…Enabled": what it answers is whether there is a section to send someone
   * to, and the entity itself is readable either way.
   */
  const sectionOpen = (kind: InputSectionKind): ComputedRef<boolean> =>
    computed(() => isEnabled(INPUT_SECTION_FEATURE[kind]));

  return { sectionOpen };
}
