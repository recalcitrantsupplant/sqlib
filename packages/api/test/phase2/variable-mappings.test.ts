import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GroupHarness, START, END, type EdgeSpec } from './harness/group-harness.js';
import { getTemplate } from './harness/query-templates.js';

/**
 * Edge variable mappings, pinned with exact results.
 *
 * The fuzzer covers these too, but a property says "the engine agrees with the
 * oracle" - it does not say what either of them does. These tests write the
 * answer down, which is what makes the rule reviewable and what turns a future
 * change into a readable failure rather than a shrunk counterexample.
 *
 * Everything here is arity 2 by necessity: with one variable a side, every
 * pairing rule produces the same answer, so an arity-1 test of mapping would
 * pass no matter what the rule was.
 *
 * Fixture rows for `labelRankPairs` (SELECT ?label ?rank) are
 * (alpha,1) (beta,2) (gamma,3) - t4 has a rank but no label, so it drops out.
 */
describe('Phase 2 edge variable mappings', () => {
  let harness: GroupHarness;

  beforeAll(async () => {
    harness = await GroupHarness.create('phase2-mappings');
    for (const key of ['labelRankPairs', 'echoGroupLabel']) {
      await harness.defineQuery(key, getTemplate(key).sparql);
    }
  }, 60000);

  afterAll(async () => {
    await harness.destroy();
  });

  /** source: ?label ?rank -> target slot: ?group ?label, with the given mapping. */
  const runChain = async (variableMappings?: string) => {
    const chain: EdgeSpec = {
      from: 'a', to: 'b', flow: 'VARIABLE_BINDINGS',
      source: { node: 'a', port: 'outputTuple' },
      target: { node: 'b', input: 0 },
      ...(variableMappings !== undefined ? { variableMappings } : {}),
    };
    const built = await harness.build({
      nodes: [
        { key: 'a', query: 'labelRankPairs' },
        { key: 'b', query: 'echoGroupLabel' },
      ],
      edges: [
        { from: START, to: 'a', flow: 'CONTROL_FLOW' },
        chain,
        {
          from: 'b', to: END, flow: 'VARIABLE_BINDINGS',
          source: { node: 'b', port: 'outputTuple' },
          target: { node: 'b', port: 'outputTuple' },
        },
      ],
    });
    return harness.execute(built);
  };

  /** Result as sorted "group=…|label=…" strings, so row order never decides. */
  const pairs = (response: { statusCode: number; payload: string; json: () => any }) => {
    expect(response.statusCode, response.payload.slice(0, 400)).toBe(200);
    return (response.json().results.bindings as any[])
      .map(row => `${row.group?.value ?? '-'}|${row.label?.value ?? '-'}`)
      .sort();
  };

  it('pairs exact name matches first, then the leftovers by position', async () => {
    // ?label exists on both sides, so it maps to itself even though it sits at
    // index 0 on the left and index 1 on the right. ?rank is then the only
    // source left and ?group the only target, so they pair up.
    //
    // Plain positional pairing would instead put the label in ?group and the
    // rank in ?label - which is why this template pair was chosen.
    expect(pairs(await runChain())).toEqual(['1|alpha', '2|beta', '3|gamma']);
  }, 30000);

  it('honours an explicit mapping that contradicts the default', async () => {
    const explicit = JSON.stringify([
      { source: 'label', target: 'group' },
      { source: 'rank', target: 'label' },
    ]);
    expect(pairs(await runChain(explicit))).toEqual(['alpha|1', 'beta|2', 'gamma|3']);
  }, 30000);

  it('falls back to the default when the mapping is unparseable', async () => {
    expect(pairs(await runChain('{not json'))).toEqual(['1|alpha', '2|beta', '3|gamma']);
    // A JSON value that is not an array is equally unusable.
    expect(pairs(await runChain('"a string"'))).toEqual(['1|alpha', '2|beta', '3|gamma']);
  }, 30000);

  it('drops mapping entries naming variables that are not on the tuple', async () => {
    // ?rank -> ?nosuchvar is discarded; the surviving ?label -> ?label leaves
    // ?group unbound, which is a legal partial-UNDEF row rather than an error.
    const partlyBogus = JSON.stringify([
      { source: 'label', target: 'label' },
      { source: 'rank', target: 'nosuchvar' },
    ]);
    expect(pairs(await runChain(partlyBogus))).toEqual(['-|alpha', '-|beta', '-|gamma']);
  }, 30000);

  it('fails by name when a mapping survives as empty and unbinds every row', async () => {
    // Nothing in the mapping is usable, so no variable is bound and all three
    // rows become all-UNDEF. That is the shape §1.1 rejects outright, because a
    // wildcard mixed with real rows would dissolve them.
    const allBogus = JSON.stringify([{ source: 'nope', target: 'alsonope' }]);
    const execution = await runChain(allBogus);
    expect(execution.statusCode).toBe(400);
    expect(execution.payload).toContain('all-UNDEF row cannot be mixed with bound rows');
  }, 30000);

  it('dedupes fan-in rows that two edges spell with different variable order', async () => {
    // Regression test. Rows are assembled in edge-mapping order, so these two
    // edges deliver identical rows with opposite key insertion order:
    //   b -> c maps group->group, label->label   (keys: group, label)
    //   a -> c maps label->label, rank->group    (keys: label, group)
    // Keying the dedupe on the row as written rather than on what it means let
    // both copies through, and the result silently doubled.
    const built = await harness.build({
      nodes: [
        { key: 'a', query: 'labelRankPairs' },
        { key: 'b', query: 'echoGroupLabel' },
        { key: 'c', query: 'echoGroupLabel' },
      ],
      edges: [
        { from: START, to: 'a', flow: 'CONTROL_FLOW' },
        {
          from: 'a', to: 'b', flow: 'VARIABLE_BINDINGS',
          source: { node: 'a', port: 'outputTuple' }, target: { node: 'b', input: 0 },
        },
        {
          from: 'b', to: 'c', flow: 'VARIABLE_BINDINGS',
          source: { node: 'b', port: 'outputTuple' }, target: { node: 'c', input: 0 },
        },
        {
          from: 'a', to: 'c', flow: 'VARIABLE_BINDINGS',
          source: { node: 'a', port: 'outputTuple' }, target: { node: 'c', input: 0 },
        },
        {
          from: 'c', to: END, flow: 'VARIABLE_BINDINGS',
          source: { node: 'c', port: 'outputTuple' }, target: { node: 'c', port: 'outputTuple' },
        },
      ],
    });

    expect(pairs(await harness.execute(built))).toEqual(['1|alpha', '2|beta', '3|gamma']);
  }, 30000);
});
