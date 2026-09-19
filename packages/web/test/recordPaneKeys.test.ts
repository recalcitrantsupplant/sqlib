/**
 * How the work-area pane is keyed, which decides whether a record swaps or the
 * pane is rebuilt.
 *
 * A `:key` that carries the record's id destroys the component on every row
 * click. The replacement renders its defaults, re-runs its mount — which
 * fetches the lists the *screen* needs, not the record — and only then fills
 * in what was clicked. It is visible: measured over one switch, the pane that
 * rebuilt scored 0.2368 of layout shift and six list requests against the
 * swapping one's 0.0000 and one (`tests/e2e/perf/record-switch.spec.ts`).
 *
 * Five of the nine panes were already keyed by a constant and four were not,
 * which is the shape of a rule nobody wrote down. Here it is: a saved record's
 * pane is keyed by its *kind*, and each work area reloads itself from its id
 * prop, which every one of them already watches. Only a scratch record keys by
 * id, because the browser mints those ids and two of them share no state worth
 * carrying across.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const INDEX = resolve(import.meta.dirname, '../src/pages/index.vue');

/** Every `:key` bound on a work area in the main pane, with its expression. */
function paneKeys(): Array<{ component: string; expression: string }> {
  const source = readFileSync(INDEX, 'utf8');
  const keys: Array<{ component: string; expression: string }> = [];
  for (const [, component, expression] of source.matchAll(
    /<([A-Z]\w+(?:WorkArea|Playground))\b[^>]*?:key="([^"]*)"/g,
  )) {
    keys.push({ component, expression });
  }
  return keys;
}

describe('the work-area pane', () => {
  it('is keyed for every work area the page draws', () => {
    // Nine panes when this was written; the assertion is that they are all
    // keyed deliberately, not that there are exactly nine.
    expect(paneKeys().length).toBeGreaterThanOrEqual(9);
  });

  it('keys a saved record by its kind, so picking another swaps in place', () => {
    const offenders = paneKeys().filter(({ expression }) => {
      // The shape is `scratchSection === 'x' ? \`scratch-${id}\` : 'kind'`:
      // the branch after the colon is the saved one, and it may not interpolate.
      const saved = expression.split(':').at(-1) ?? '';
      return saved.includes('${');
    });

    expect(offenders, 'a saved pane keyed by id is rebuilt on every row click').toEqual([]);
  });
});
