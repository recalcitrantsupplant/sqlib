/**
 * The rules Inputs tab against the flags that hold **Tuples** and **Data**.
 *
 * Four doors, two sections, and one thing that must survive both being closed:
 * the inputs themselves. A rule set's seed rows and data graph are what it runs
 * against, so a closed section has to leave the pickers, the mode toggles and
 * the saved previews exactly where they were — the flag decides whether there
 * is a *section* to open, not whether the rule set has inputs.
 *
 * Which is why the assertions come in pairs: for every control that goes, one
 * that stays.
 */
import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import RuleSetInputsPanel from '@/components/rules/RuleSetInputsPanel.vue';

const TUPLE_OPTION = {
  versionId: 'urn:sqlib:tuple-set-version:t1v2',
  tupleSetId: 'urn:sqlib:tuple-set:t1',
  name: 'Cities',
  version: 2,
};

const GRAPH_OPTION = {
  versionId: 'urn:sqlib:data-graph-version:g1v3',
  graphId: 'urn:sqlib:data-graph:g1',
  name: 'Reference',
  version: 3,
  detail: '412 triples',
};

const panel = (props: Record<string, unknown> = {}) => mount(RuleSetInputsPanel, {
  shallow: true,
  props: {
    tupleSetOptions: [TUPLE_OPTION],
    dataGraphOptions: [GRAPH_OPTION],
    savedTuplePreview: 'TUPLE(:reach, :a, :b)',
    savedDataPreview: 'ex:Alice foaf:knows ex:Bob .',
    ...props,
  },
});

const saved = (props: Record<string, unknown> = {}) => panel({
  tupleSource: 'saved',
  dataSource: 'saved',
  tupleSetVersionId: TUPLE_OPTION.versionId,
  dataGraphVersionId: GRAPH_OPTION.versionId,
  ...props,
});

describe('RuleSetInputsPanel input sections', () => {
  it('offers all four doors by default', () => {
    const inline = panel();
    expect(inline.find('[data-testid="save-to-tuples"]').exists()).toBe(true);
    expect(inline.find('[data-testid="save-to-data"]').exists()).toBe(true);

    const pinned = saved();
    expect(pinned.find('[data-testid="open-in-tuples"]').exists()).toBe(true);
    expect(pinned.find('[data-testid="open-in-data"]').exists()).toBe(true);
  });

  it('takes both Tuples doors away where that section is not drawn', () => {
    expect(panel({ tupleSetSectionOpen: false }).find('[data-testid="save-to-tuples"]').exists())
      .toBe(false);
    expect(saved({ tupleSetSectionOpen: false }).find('[data-testid="open-in-tuples"]').exists())
      .toBe(false);
  });

  it('takes both Data doors away where that section is not drawn', () => {
    expect(panel({ dataGraphSectionOpen: false }).find('[data-testid="save-to-data"]').exists())
      .toBe(false);
    expect(saved({ dataGraphSectionOpen: false }).find('[data-testid="open-in-data"]').exists())
      .toBe(false);
  });

  it('closes one section without touching the other\'s doors', () => {
    const half = saved({ tupleSetSectionOpen: false });
    expect(half.find('[data-testid="open-in-tuples"]').exists()).toBe(false);
    expect(half.find('[data-testid="open-in-data"]').exists()).toBe(true);
  });

  it('keeps both pickers, and what they are pointing at, with both sections closed', () => {
    /*
     * The half that is not about doors. A rule set that pins a tuple set
     * version and a data graph version has to keep running against them, so the
     * pickers, the Saved/Inline toggles and the read-only previews stay. If
     * these ever go, a build with the sections off silently runs a different
     * rule set from the one on screen.
     */
    const closed = saved({ tupleSetSectionOpen: false, dataGraphSectionOpen: false });
    // Both choosers are `SearchSelect`, stubbed here; the class is what survives
    // shallow mounting, and there is one per block.
    expect(closed.findAll('.entity-picker')).toHaveLength(2);
    expect(closed.find('[data-testid="tuples-source-saved"]').exists()).toBe(true);
    expect(closed.find('[data-testid="data-source-saved"]').exists()).toBe(true);
    expect(closed.find('[data-testid="inputs-tuples"]').exists()).toBe(true);
    expect(closed.find('[data-testid="inputs-data"]').exists()).toBe(true);
  });

  it('keeps the inline side usable with both sections closed', () => {
    // Which is what makes removing `Save to …` safe rather than lossy: rows and
    // triples typed here run without ever becoming a record in a section.
    const closed = panel({ tupleSetSectionOpen: false, dataGraphSectionOpen: false });
    expect(closed.find('[data-testid="tuples-source-inline"]').exists()).toBe(true);
    expect(closed.find('[data-testid="data-source-inline"]').exists()).toBe(true);
    expect(closed.find('[data-testid="data-format"]').exists()).toBe(true);
  });
});
