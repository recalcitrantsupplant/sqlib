/**
 * The two rail entries that are screens — Notebook and Connect — and the flags
 * that hold them.
 *
 * Both were unflagged in their own right: Notebook rode on `queries`, so the
 * only way to drop the query-centric front page was to drop the Query section
 * with it, and Build — the entry Connect replaced — had no flag at all, so
 * every deployment drew it whatever else it had turned off. A library whose
 * content is rule sets and tests wants neither, which is what `notebook` and
 * `connect` are for.
 *
 * Listed rather than pattern-matched, for the reason the sibling guards give
 * (`ruleTuplesDoors.test.ts`, `testsFeatureDoors.test.ts`): a new door fails
 * here until someone says which condition holds it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { buildFeatureFlags, FEATURE_FLAG_KEYS } from '@sparql-query-lib/types';
import { RAIL_ENTRIES } from '../src/lib/railEntries';

const SRC = resolve(import.meta.dirname, '../src');
const read = (relative: string) => readFileSync(join(SRC, relative), 'utf8');

/** The rail draws an entry when its flag is on; `null` means it cannot be held. */
const visible = (flags: Record<string, boolean>) =>
  RAIL_ENTRIES.filter(entry => entry.feature === null || flags[entry.feature]).map(entry => entry.label);

describe('the Notebook and Connect rails are held by flags of their own', () => {
  it('names both flags, defaulting on so an existing deployment is unchanged', () => {
    expect(FEATURE_FLAG_KEYS).toContain('notebook');
    expect(FEATURE_FLAG_KEYS).toContain('connect');
    const defaults = buildFeatureFlags({});
    expect(defaults.notebook).toBe(true);
    expect(defaults.connect).toBe(true);
  });

  it('leaves no rail entry unholdable', () => {
    // `build` was the last `feature: null` entry, and `connect` inherited its
    // flag rather than the gap. Nothing should go back to being drawn
    // unconditionally without a stated reason.
    expect(RAIL_ENTRIES.filter(entry => entry.feature === null)).toEqual([]);
  });

  it('drops each entry with its own flag and nothing else', () => {
    const on = buildFeatureFlags({});
    expect(visible(on)).toContain('Notebook');
    expect(visible(on)).toContain('Connect');

    const noNotebook = visible({ ...on, notebook: false });
    expect(noNotebook).not.toContain('Notebook');
    // The point of the separate flag: Query survives.
    expect(noNotebook).toContain('Query');

    expect(visible({ ...on, connect: false })).not.toContain('Connect');
  });

  it('keeps the Notebook when only queries is off, and vice versa', () => {
    expect(visible({ ...buildFeatureFlags({}), queries: false })).toContain('Notebook');
  });

  it('holds any link one screen keeps to the other', () => {
    // A hidden rail entry with a live link to the same screen beside it would
    // be a door left open on a section the deployment said it does not have.
    // Neither screen links to the other today, so this guards the link that
    // arrives next rather than asserting the absence.
    const notebook = read('pages/notebook.vue');
    for (const link of notebook.match(/<NuxtLink[^>]*connect[^>]*>/gi) ?? []) {
      expect(link).toContain('v-if="isEnabled(\'connect\')"');
    }
    const connect = read('pages/connect.vue');
    for (const link of connect.match(/<NuxtLink[^>]*notebook[^>]*>/gi) ?? []) {
      expect(link).toContain('v-if="isEnabled(\'notebook\')"');
    }
  });
});
