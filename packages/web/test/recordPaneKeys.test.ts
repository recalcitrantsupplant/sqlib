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
import { WORK_AREAS, paneKey, workAreaPane } from '@/components/workspace/workAreas';
import { SECTION_ITEM_TYPES } from '@/lib/sections';

const KINDS = Object.keys(WORK_AREAS) as Array<keyof typeof WORK_AREAS>;

describe('the work-area pane', () => {
  it('has a work area for every kind a section lists', () => {
    expect([...KINDS].sort()).toEqual([...SECTION_ITEM_TYPES].sort());
  });

  it.each(KINDS)('keys a saved %s by its kind, so picking another swaps in place', (kind) => {
    expect(paneKey(kind, null)).toBe(WORK_AREAS[kind].savedKey);
    const first = workAreaPane({ kind, savedId: 'urn:a', scratchId: null }, { onSaved() {}, onDeleted() {}, onLoadFailed() {}, extra: {} });
    const second = workAreaPane({ kind, savedId: 'urn:b', scratchId: null }, { onSaved() {}, onDeleted() {}, onLoadFailed() {}, extra: {} });
    expect(first!.key).toBe(second!.key);
    expect(first!.props[WORK_AREAS[kind].idProp]).toBe('urn:a');
  });

  it.each(KINDS)('keys a scratch %s by its id, and passes no saved id', (kind) => {
    const pane = workAreaPane({ kind, savedId: null, scratchId: 'urn:ui-temp:1' }, { onSaved() {}, onDeleted() {}, onLoadFailed() {}, extra: {} });
    expect(pane!.key).toBe('scratch-urn:ui-temp:1');
    expect(pane!.props.scratchId).toBe('urn:ui-temp:1');
    expect(pane!.props[WORK_AREAS[kind].idProp]).toBeNull();
  });

  it('routes the shared events to the page, whatever a work area calls them', () => {
    const calls: string[] = [];
    const pane = workAreaPane({ kind: 'ruleSet', savedId: 'urn:r', scratchId: null }, {
      onSaved: (kind, id) => calls.push(`saved ${kind} ${id}`),
      onDeleted: (kind, id) => calls.push(`deleted ${kind} ${id}`),
      onLoadFailed: (kind) => calls.push(`failed ${kind}`),
      extra: {},
    })!;
    (pane.on['scratch-saved'] as (payload: { id: string }) => void)({ id: 'urn:r2' });
    (pane.on['ruleset-deleted'] as (id?: string) => void)();
    (pane.on['ruleset-load-failed'] as () => void)();
    expect(calls).toEqual(['saved ruleSet urn:r2', 'deleted ruleSet null', 'failed ruleSet']);
  });
});
