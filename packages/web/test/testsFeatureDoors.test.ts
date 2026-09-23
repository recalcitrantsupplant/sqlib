/**
 * Every door into the tests feature, and whether it consults the flag.
 *
 * The `tests` flag has always hidden the rail section and the work area behind
 * it. What it did not hide were the doors other screens draw into the same
 * feature, because each was written where it was needed and none of them was
 * the section: the Tests tab on four record pages, the run bar's `create test`,
 * and the rules screen's `Save as test`. With `FEATURE_TESTS=0` all six stayed
 * on screen and failed a step later — `useApiClient` refuses `listTests` before
 * the request, so the tab said "No tests yet" about a feature that is not
 * there, and a row in it would have navigated to a section that is not drawn.
 *
 * The fix is a composable and a filter, so this guard checks that each door
 * asks *them* rather than re-deciding for itself:
 *
 * - a Tests tab, and anything that renders `SubjectTestsPanel`, takes its
 *   subject from `useTestsSurface` — the one place where "unsaved" and
 *   "switched off" are both answered
 * - the run bar filters its own `create` targets through
 *   `CREATE_TARGET_FEATURE`, so the three screens that pass `['benchmark',
 *   'test']` — and the fourth that will — cannot offer a door into a feature
 *   this build does not have
 * - `Save as test` is absent rather than disabled where the feature is off
 *
 * What is deliberately **not** guarded is the API call behind each door.
 * `createTest`/`listTests` already refuse when the flag is off, which is the
 * backstop this guard sits in front of: the fault was never that the request
 * went through, it was that a switched-off feature had a control on screen.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { CREATE_TARGET_FEATURE, type CreateTarget } from '@/lib/runBar';

const SRC = resolve(import.meta.dirname, '../src');

/** The composable that answers both absences; it is allowed to know the flag. */
const SURFACE = 'composables/useTestsSurface.ts';

/**
 * The **call**, not the name.
 *
 * Every surface here also *mentions* `useTestsSurface` in the comment above its
 * subject, which is how the first version of this guard passed a file that had
 * stopped calling it: a docblock is not a gate. So a door has to import the
 * composable and read a subject out of it.
 */
const IMPORTS_SURFACE = /import \{[^}]*useTestsSurface[^}]*\} from ['"][^'"]*composables\/useTestsSurface['"]/;
const READS_SUBJECT = /\btestSubject\(/;

const asksTheSurface = (text: string): boolean => IMPORTS_SURFACE.test(text) && READS_SUBJECT.test(text);

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(vue|ts)$/.test(entry.name) ? [path] : [];
  });

const files = sourceFiles(SRC).map((path) => ({
  name: relative(SRC, path).split(/[\\/]/).join('/'),
  text: readFileSync(path, 'utf8'),
}));

/** The `<button …>` (or other tag) an attribute sits in, opening angle to `>`. */
function enclosingTag(text: string, needle: string): string {
  const at = text.indexOf(needle);
  if (at < 0) return '';
  const open = text.lastIndexOf('<', at);
  const close = text.indexOf('>', at);
  return text.slice(open, close < 0 ? undefined : close + 1);
}

describe('doors into the tests feature', () => {
  it('takes every Tests tab from useTestsSurface', () => {
    const offenders = files
      .filter((file) => file.name !== SURFACE)
      .filter((file) => /id: 'tests'/.test(file.text))
      .filter((file) => !asksTheSurface(file.text))
      .map((file) => file.name);
    expect(offenders).toEqual([]);
  });

  it('takes every SubjectTestsPanel subject from useTestsSurface', () => {
    const offenders = files
      .filter((file) => file.name !== SURFACE)
      .filter((file) => /<SubjectTestsPanel/.test(file.text))
      .filter((file) => !asksTheSurface(file.text))
      .map((file) => file.name);
    expect(offenders).toEqual([]);
  });

  it('states a feature for every create target the run bar can draw', () => {
    // The type makes this exhaustive at build time; the assertion is for the
    // reader, and for a target added to the union with no flag decided.
    const targets: CreateTarget[] = ['benchmark', 'test'];
    expect(Object.keys(CREATE_TARGET_FEATURE).sort()).toEqual([...targets].sort());
    expect(Object.values(CREATE_TARGET_FEATURE).every(Boolean)).toBe(true);
  });

  it('filters the create targets in the bar rather than in its callers', () => {
    const bar = files.find((file) => file.name === 'components/shared/RunBar.vue');
    expect(bar).toBeDefined();
    expect(bar!.text).toContain('CREATE_TARGET_FEATURE');

    /*
     * A caller may say what its recipe could become; what it may not do is
     * decide whether the feature holding the result exists, because then the
     * next screen decides it again and one of them gets it wrong.
     */
    const callers = files.filter((file) => /:create-targets=/.test(file.text));
    expect(callers.length).toBeGreaterThan(0);
    expect(callers.filter((file) => file.text.includes('CREATE_TARGET_FEATURE')).map((file) => file.name))
      .toEqual([]);
  });

  /*
   * "Save as test" exists twice, and the two were written years apart in
   * spirit: the notebook's has been behind the flag since it was written
   * (`canWrite` on `pages/library.vue` *is* `isEnabled('tests')`), the rules
   * screen's was not. Listing both, with the condition each is behind, is what
   * makes the inventory the thing under test rather than a pattern — a third
   * door fails here until someone says which condition holds it.
   */
  it('hides every "save as test" door rather than disabling it', () => {
    const expected: Record<string, RegExp> = {
      'components/rules/RuleSetInputsPanel.vue': /v-if="testsEnabled && canWrite"/,
      'components/library-notebook/NotebookCell.vue': /v-if="canWrite && lastResult"/,
    };
    const doors = files.filter((file) => /data-testid="[a-z-]*save-as-test"/.test(file.text));
    expect(doors.map((file) => file.name).sort()).toEqual(Object.keys(expected).sort());
    for (const door of doors) {
      const testid = /data-testid="[a-z-]*save-as-test"/.exec(door.text)![0];
      expect(enclosingTag(door.text, testid)).toMatch(expected[door.name]);
    }
  });
});
