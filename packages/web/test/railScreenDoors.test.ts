/**
 * The two rail entries that are screens — Notebook and Build — and the flags
 * that hold them.
 *
 * Both were unflagged in their own right: Notebook rode on `queries`, so the
 * only way to drop the query-centric front page was to drop the Query section
 * with it, and Build had no flag at all, so every deployment drew it whatever
 * else it had turned off. A library whose content is rule sets and tests wants
 * neither, which is what `notebook` and `build` are for.
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

describe('the Notebook and Build rails are held by flags of their own', () => {
  it('names both flags, defaulting on so an existing deployment is unchanged', () => {
    expect(FEATURE_FLAG_KEYS).toContain('notebook');
    expect(FEATURE_FLAG_KEYS).toContain('build');
    const defaults = buildFeatureFlags({});
    expect(defaults.notebook).toBe(true);
    expect(defaults.build).toBe(true);
  });

  it('leaves no rail entry unholdable', () => {
    // `build` was the last `feature: null` entry. Nothing should go back to
    // being drawn unconditionally without a stated reason.
    expect(RAIL_ENTRIES.filter(entry => entry.feature === null)).toEqual([]);
  });

  it('drops each entry with its own flag and nothing else', () => {
    const on = buildFeatureFlags({});
    expect(visible(on)).toContain('Notebook');
    expect(visible(on)).toContain('Build');

    const noNotebook = visible({ ...on, notebook: false });
    expect(noNotebook).not.toContain('Notebook');
    // The point of the separate flag: Query survives.
    expect(noNotebook).toContain('Query');

    expect(visible({ ...on, build: false })).not.toContain('Build');
  });

  it('keeps the Notebook when only queries is off, and vice versa', () => {
    expect(visible({ ...buildFeatureFlags({}), queries: false })).toContain('Notebook');
  });

  it('holds the link each screen keeps to the other', () => {
    // A hidden rail entry with a live link to the same screen beside it would
    // be a door left open on a section the deployment said it does not have.
    // The notebook keeps no link to Build — the screen it replaced did — so a
    // new one has to arrive with its guard.
    expect(read('pages/build.vue')).toContain('v-if="isEnabled(\'notebook\')"');
    const notebook = read('pages/notebook.vue');
    const buildLinks = notebook.match(/<NuxtLink[^>]*build[^>]*>/gi) ?? [];
    for (const link of buildLinks) expect(link).toContain('v-if="isEnabled(\'build\')"');
  });
});
