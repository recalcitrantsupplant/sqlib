/**
 * How far the `tests` flag reaches into a screen that is not the Tests section.
 *
 * The flag has always hidden the rail section and the work area behind it
 * (`SECTION_DEFINITIONS.tests.feature`, `isItemFeatureEnabled` in
 * `pages/index.vue`). What it did not hide were the doors *into* the feature
 * that other screens draw: the Tests tab on the four record pages, the run
 * bar's `create test`, and the rules screen's `Save as test`. With the feature
 * off those stayed on screen and failed one step later — `listTests` throws
 * before the request, so the tab said "No tests yet" about a switched-off
 * feature, and a row in it would have navigated to a section that is not
 * rendered.
 *
 * So the rule is the one the rail already follows: **a switched-off feature has
 * no doors**, and a door is absent rather than disabled — the same distinction
 * the tab already makes for a scratch subject, where a tab that could only ever
 * say "none" is a tab you click to learn nothing.
 *
 * Both readings live here rather than in each screen so that a fifth surface
 * asks the same question the four ask, and `testsFeatureDoors.test.ts` holds
 * them to it.
 */
import { computed, toValue, type ComputedRef, type MaybeRefOrGetter } from 'vue';
import { useFeatureFlags } from './useFeatureFlags';

export function useTestsSurface() {
  const { isEnabled } = useFeatureFlags();

  /** Whether this build offers tests at all. */
  const testsEnabled = computed(() => isEnabled('tests'));

  /**
   * The subject a test would name, or null while there is nothing to name.
   *
   * Two ways there is nothing: the entity is unsaved, so a test could not point
   * at it, or the feature is off, so there is no test to point at all. Both
   * produce the same absence, which is why one computed answers both — a caller
   * asks "is there a subject here?" and never has to remember the second half.
   *
   * A getter rather than a string, because these tabs are mounted once per
   * screen and the entity under them changes: a value read at call time would
   * pin the first subject the screen ever held.
   */
  const testSubject = (
    source: MaybeRefOrGetter<string | null | undefined>,
  ): ComputedRef<string | null> => computed(() => (testsEnabled.value ? toValue(source) || null : null));

  return { testsEnabled, testSubject };
}
