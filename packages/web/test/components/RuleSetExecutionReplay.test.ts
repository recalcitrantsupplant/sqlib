import { describe, it, expect, vi } from 'vitest';
import { nextTick } from 'vue';
import { mount } from '@vue/test-utils';

import RuleSetExecutionReplay from '@/components/rules/RuleSetExecutionReplay.vue';

/**
 * The replay walks a trace that has already been produced, so what is worth
 * testing is the two derivations: the flattening of iterations into an ordered
 * list of steps, and the graph rebuilt by applying that list up to the cursor.
 *
 * The reconciliation invariant — seeded plus every delta equals the final graph —
 * is asserted server-side in RuleSetExecutor.dataBlocks.test.ts. Here the
 * concern is that the cursor lands on the right step and the set is rebuilt
 * correctly, including deletes.
 */

const T = (n: string) => `<http://e/${n}> <http://e/p> <http://e/o> .`;

function results(overrides: Record<string, unknown> = {}) {
  return {
    dataBlocks: [{ dataBlockVersionId: 'db1', tripleDelta: 1 }],
    seededQuads: [T('seed')],
    iterations: [
      {
        index: 1,
        delta: 2,
        rules: [
          {
            ruleVersionId: 'r1',
            ruleIri: 'http://e/first',
            stratum: 0,
            durationMs: 1,
            triplesInserted: 2,
            triplesDeleted: 0,
            insertedQuads: [T('a'), T('b')],
            deletedQuads: [],
            timedOut: false,
          },
          {
            ruleVersionId: 'r2',
            ruleIri: 'http://e/second',
            stratum: 1,
            durationMs: 1,
            triplesInserted: 0,
            triplesDeleted: 0,
            insertedQuads: [],
            deletedQuads: [],
            timedOut: false,
          },
        ],
      },
      {
        index: 2,
        delta: 0,
        rules: [
          {
            ruleVersionId: 'r1',
            stratum: 1,
            durationMs: 1,
            triplesInserted: 0,
            triplesDeleted: 1,
            insertedQuads: [],
            deletedQuads: [T('a')],
            timedOut: false,
          },
        ],
      },
    ],
    ...overrides,
  };
}

const mountReplay = (props: Record<string, unknown> = {}) =>
  mount(RuleSetExecutionReplay, {
    props: {
      results: results(),
      // The parent's labeller, standing in for ruleLabelFor: a rule is named by
      // its own IRI, shortened — never by a friendly name invented here.
      ruleLabel: (rule: { ruleIri?: string; ruleVersionId: string }) =>
        (rule.ruleIri ?? rule.ruleVersionId).replace(/^.*[/#]/, ''),
      ...props,
    },
  });

const position = (wrapper: ReturnType<typeof mountReplay>) =>
  wrapper.find('[data-testid="replay-position"]').text();

const soFarCount = (wrapper: ReturnType<typeof mountReplay>) =>
  wrapper.find('[data-testid="replay-so-far-count"]').text();

const stepCells = (wrapper: ReturnType<typeof mountReplay>) =>
  wrapper.findAll('.timeline-group .step-cell:not(.step-cell--none)');

async function goTo(wrapper: ReturnType<typeof mountReplay>, step: number) {
  for (let i = 0; i < step; i += 1) {
    await wrapper.find('[data-testid="replay-next"]').trigger('click');
  }
  await nextTick();
}

describe('RuleSetExecutionReplay', () => {
  it('flattens data blocks and every rule firing into one ordered list', () => {
    // 1 data block + 2 rules in iteration 1 + 1 rule in iteration 2.
    const wrapper = mountReplay();
    expect(position(wrapper)).toBe('Start');
    expect(stepCells(wrapper)).toHaveLength(4);
  });

  it('starts before the run, with nothing inferred', () => {
    const wrapper = mountReplay();
    expect(position(wrapper)).toBe('Start');
    expect(soFarCount(wrapper)).toBe('0');
    expect(wrapper.find('[data-testid="replay-current"]').text()).toContain('Before the run');
  });

  it('steps through the data block first', async () => {
    const wrapper = mountReplay();
    await goTo(wrapper, 1);
    expect(position(wrapper)).toBe('Step 1 of 4');
    expect(wrapper.find('[data-testid="replay-current"]').text()).toContain('DATA block');
    expect(soFarCount(wrapper)).toBe('1');
  });

  it('names the rule that fired, and where', async () => {
    const wrapper = mountReplay();
    await goTo(wrapper, 2);
    const current = wrapper.find('[data-testid="replay-current"]').text();
    expect(current).toContain('first');
    expect(current).toContain('Iteration 1');
    expect(soFarCount(wrapper)).toBe('3');
  });

  it('keeps a rule that changed nothing as a step of its own', async () => {
    const wrapper = mountReplay();
    await goTo(wrapper, 3);
    const current = wrapper.find('[data-testid="replay-current"]').text();
    expect(current).toContain('second');
    expect(current).toContain('Matched nothing new');
    // Still 3 — a rule that fires and adds nothing does not change the graph.
    expect(soFarCount(wrapper)).toBe('3');
  });

  it('applies deletes when rebuilding the graph', async () => {
    const wrapper = mountReplay();
    await goTo(wrapper, 4);
    expect(position(wrapper)).toBe('Step 4 of 4');
    expect(soFarCount(wrapper)).toBe('2');
    expect(wrapper.find('[data-testid="replay-so-far"]').text()).not.toContain('/a>');
  });

  it('steps backwards to exactly the earlier state', async () => {
    const wrapper = mountReplay();
    await goTo(wrapper, 4);
    await wrapper.find('[data-testid="replay-prev"]').trigger('click');
    await wrapper.find('[data-testid="replay-prev"]').trigger('click');
    expect(position(wrapper)).toBe('Step 2 of 4');
    expect(soFarCount(wrapper)).toBe('3');
  });

  it('disables the transport at each end', async () => {
    const wrapper = mountReplay();
    expect(wrapper.find('[data-testid="replay-prev"]').attributes('disabled')).toBeDefined();
    await wrapper.find('[data-testid="replay-last"]').trigger('click');
    expect(wrapper.find('[data-testid="replay-next"]').attributes('disabled')).toBeDefined();
  });

  it('marks the current step\'s additions, and can show only those', async () => {
    const wrapper = mountReplay();
    await goTo(wrapper, 2);
    expect(wrapper.findAll('[data-testid="replay-so-far"] .triple-row--added')).toHaveLength(2);

    await wrapper.find('[data-testid="replay-only-new"]').setValue(true);
    expect(wrapper.findAll('[data-testid="replay-so-far"] .triple-row')).toHaveLength(2);
  });

  it('falls back to quadSamples when the full list is absent', async () => {
    const wrapper = mountReplay({
      results: results({
        dataBlocks: [],
        seededQuads: [],
        iterations: [{
          index: 1,
          delta: 1,
          rules: [{
            ruleVersionId: 'r1',
            durationMs: 1,
            triplesInserted: 1,
            triplesDeleted: 0,
            quadSamples: [T('sampled')],
            timedOut: false,
          }],
        }],
      }),
    });
    await goTo(wrapper, 1);
    expect(soFarCount(wrapper)).toBe('1');
  });

  it('rewinds when a new run replaces the trace', async () => {
    const wrapper = mountReplay();
    await goTo(wrapper, 3);
    await wrapper.setProps({ results: results() });
    await nextTick();
    expect(position(wrapper)).toBe('Start');
  });

  it('says so when there is nothing to replay', () => {
    const wrapper = mountReplay({ results: { iterations: [], dataBlocks: [], seededQuads: [] } });
    expect(wrapper.text()).toContain('no steps to replay');
  });

  it('surfaces a rule error at the step it happened', async () => {
    const wrapper = mountReplay({
      results: results({
        dataBlocks: [],
        seededQuads: [],
        iterations: [{
          index: 1,
          delta: 0,
          rules: [{
            ruleVersionId: 'r1',
            durationMs: 1,
            triplesInserted: 0,
            triplesDeleted: 0,
            insertedQuads: [],
            deletedQuads: [],
            timedOut: false,
            error: { message: 'boom' },
          }],
        }],
      }),
    });
    await goTo(wrapper, 1);
    expect(wrapper.find('[data-testid="replay-current"]').text()).toContain('boom');
  });

  it('plays forward and stops at the end', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = mountReplay();
      await wrapper.find('[data-testid="replay-play"]').trigger('click');
      await vi.advanceTimersByTimeAsync(700 * 6);
      await nextTick();
      expect(position(wrapper)).toBe('Step 4 of 4');
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives every iteration a column of its own, however much fired in it', () => {
    const wrapper = mountReplay();
    // One for the DATA blocks, then one per iteration — regardless of how many
    // rules fired inside each, which is the point of the equal-width strip.
    const columns = wrapper.findAll('.timeline-group');
    expect(columns).toHaveLength(3);
    expect(columns.map((column) => column.find('.group-label').text())).toEqual(['DATA', '1', '2']);
    expect(columns[1]!.findAll('.step-cell')).toHaveLength(2);
    expect(columns[2]!.findAll('.step-cell')).toHaveLength(1);
  });

  it('keeps a pass in which no rule fired as a column with no step', () => {
    const wrapper = mountReplay({
      results: results({
        dataBlocks: [],
        seededQuads: [],
        iterations: [
          { index: 1, delta: 1, rules: [] },
          {
            index: 2,
            delta: 1,
            rules: [{
              ruleVersionId: 'r1',
              stratum: 1,
              durationMs: 1,
              triplesInserted: 1,
              triplesDeleted: 0,
              insertedQuads: [T('a')],
              deletedQuads: [],
              timedOut: false,
            }],
          },
        ],
      }),
    });
    expect(wrapper.findAll('.timeline-group')).toHaveLength(2);
    expect(wrapper.findAll('.step-cell--none')).toHaveLength(1);
    expect(stepCells(wrapper)).toHaveLength(1);
  });

  it('bands each column by the stratum its firings ran in', () => {
    const wrapper = mountReplay();
    const columns = wrapper.findAll('.timeline-group');

    // DATA blocks have no stratum, and say so the way the gutter does.
    const dataBands = columns[0]!.findAll('[data-testid="replay-stratum-band"]');
    expect(dataBands).toHaveLength(1);
    expect(dataBands[0]!.text()).toBe('D');

    // Iteration 1 ran a stratum-0 rule then a stratum-1 rule: two bands, in the
    // palette the editor gutter paints those strata with, labelled 1-based.
    const firstBands = columns[1]!.findAll('[data-testid="replay-stratum-band"]');
    expect(firstBands.map((band) => band.text())).toEqual(['1', '2']);
    expect(firstBands[0]!.attributes('style')).toContain('var(--stratum-1)');
    expect(firstBands[1]!.attributes('style')).toContain('var(--stratum-2)');

    // Iteration 2 ran only stratum 1: one band, spanning the column.
    expect(columns[2]!.findAll('[data-testid="replay-stratum-band"]')).toHaveLength(1);
  });

  it('merges consecutive firings of one stratum into a single band', () => {
    const rule = (id: string, stratum: number) => ({
      ruleVersionId: id,
      stratum,
      durationMs: 1,
      triplesInserted: 0,
      triplesDeleted: 0,
      insertedQuads: [],
      deletedQuads: [],
      timedOut: false,
    });
    const wrapper = mountReplay({
      results: results({
        dataBlocks: [],
        seededQuads: [],
        iterations: [{ index: 1, delta: 0, rules: [rule('a', 2), rule('b', 2), rule('c', 3)] }],
      }),
    });
    const bands = wrapper.findAll('[data-testid="replay-stratum-band"]');
    expect(bands.map((band) => band.text())).toEqual(['3', '4']);
    // The wider band is the one carrying two firings.
    expect(bands[0]!.attributes('style')).toContain('flex-grow: 2');
    expect(bands[1]!.attributes('style')).toContain('flex-grow: 1');
  });

  it('seeks to a step when its tick is clicked', async () => {
    const wrapper = mountReplay();
    await stepCells(wrapper)[2]!.trigger('click');
    expect(position(wrapper)).toBe('Step 3 of 4');
    expect(wrapper.find('[data-testid="replay-current"]').text()).toContain('second');
  });

  it('marks the tick the cursor is on, and the ones already played', async () => {
    const wrapper = mountReplay();
    await goTo(wrapper, 2);
    const cells = stepCells(wrapper);
    expect(cells[0]!.classes()).toContain('step-cell--done');
    expect(cells[1]!.classes()).toContain('step-cell--current');
    expect(cells[2]!.classes()).not.toContain('step-cell--done');
  });

  it('shows the stratum of the step the cursor is on', async () => {
    const wrapper = mountReplay();
    await goTo(wrapper, 1);
    expect(wrapper.find('[data-testid="replay-current-stratum"]').text()).toBe('D');
    await goTo(wrapper, 1);
    expect(wrapper.find('[data-testid="replay-current-stratum"]').text()).toBe('1');
  });

  it('falls back to no stratum when the run did not report one', () => {
    const wrapper = mountReplay({
      results: results({
        dataBlocks: [],
        seededQuads: [],
        iterations: [{
          index: 1,
          delta: 0,
          rules: [{
            ruleVersionId: 'r1',
            durationMs: 1,
            triplesInserted: 0,
            triplesDeleted: 0,
            insertedQuads: [],
            deletedQuads: [],
            timedOut: false,
          }],
        }],
      }),
    });
    const band = wrapper.find('[data-testid="replay-stratum-band"]');
    expect(band.text()).toBe('—');
    expect(band.attributes('style')).toContain('var(--stratum-none)');
  });

  it('pauses when a tick is clicked mid-play', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = mountReplay();
      await wrapper.find('[data-testid="replay-play"]').trigger('click');
      await stepCells(wrapper)[0]!.trigger('click');
      await vi.advanceTimersByTimeAsync(700 * 4);
      await nextTick();
      // Still where the click left it: seeking by hand is a deliberate stop.
      expect(position(wrapper)).toBe('Step 1 of 4');
    } finally {
      vi.useRealTimers();
    }
  });

  it('steps with the arrow keys', async () => {
    const wrapper = mountReplay();
    await wrapper.find('[data-testid="execution-replay"]').trigger('keydown', { key: 'ArrowRight' });
    expect(position(wrapper)).toBe('Step 1 of 4');
    await wrapper.find('[data-testid="execution-replay"]').trigger('keydown', { key: 'ArrowLeft' });
    expect(position(wrapper)).toBe('Start');
  });
});
