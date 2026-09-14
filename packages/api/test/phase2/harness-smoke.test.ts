import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GroupHarness, START, END } from './harness/group-harness.js';
import { getTemplate } from './harness/query-templates.js';

/**
 * The harness is machinery for the legality matrix and the fuzzer, so it needs
 * its own coverage: a bug here would show up as a fleet of confusing failures in
 * tests that are actually fine.
 */
describe('Phase 2 harness', () => {
  let harness: GroupHarness;

  beforeAll(async () => {
    harness = await GroupHarness.create('phase2-smoke');
    for (const key of ['things', 'thingByThing', 'labelByThing', 'constructByThing', 'askThings', 'noThings']) {
      await harness.defineQuery(key, getTemplate(key).sparql);
    }
  }, 60000);

  afterAll(async () => {
    await harness.destroy();
  });

  it('classifies the ports a query version infers', () => {
    const select = harness.queryHandle('things');
    expect(select.outputTuple).toBeDefined();
    expect(select.rdfOutput).toBeUndefined();
    expect(select.inputTuples).toHaveLength(0);

    const construct = harness.queryHandle('constructByThing');
    expect(construct.rdfOutput).toBeDefined();
    expect(construct.inputTuples).toHaveLength(1);

    const ask = harness.queryHandle('askThings');
    expect(ask.booleanOutput).toBeDefined();
  });

  it('builds, validates and executes a two-node chain with exact results', async () => {
    const built = await harness.build({
      nodes: [
        { key: 'a', query: 'things' },
        { key: 'b', query: 'labelByThing' },
      ],
      edges: [
        { from: START, to: 'a', flow: 'CONTROL_FLOW' },
        {
          from: 'a', to: 'b', flow: 'VARIABLE_BINDINGS',
          source: { node: 'a', port: 'outputTuple' },
          target: { node: 'b', input: 0 },
        },
        {
          from: 'b', to: END, flow: 'VARIABLE_BINDINGS',
          source: { node: 'b', port: 'outputTuple' },
          target: { node: 'b', port: 'outputTuple' },
        },
      ],
    });

    const validation = await harness.validate(built);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);

    const execution = await harness.execute(built);
    expect(execution.statusCode).toBe(200);
    const labels = execution.json().results.bindings.map((row: any) => row.label.value).sort();
    expect(labels).toEqual(['alpha', 'beta', 'gamma']);
  }, 30000);

  it('propagates an empty upstream result as an empty set by default', async () => {
    const built = await harness.build({
      nodes: [
        { key: 'a', query: 'noThings' },
        { key: 'b', query: 'thingByThing' },
      ],
      edges: [
        { from: START, to: 'a', flow: 'CONTROL_FLOW' },
        {
          from: 'a', to: 'b', flow: 'VARIABLE_BINDINGS',
          source: { node: 'a', port: 'outputTuple' },
          target: { node: 'b', input: 0 },
        },
        {
          from: 'b', to: END, flow: 'VARIABLE_BINDINGS',
          source: { node: 'b', port: 'outputTuple' },
          target: { node: 'b', port: 'outputTuple' },
        },
      ],
    });

    const execution = await harness.execute(built);
    expect(execution.statusCode).toBe(200);
    expect(execution.json().results.bindings).toEqual([]);
  }, 30000);

  it('surfaces a structural rejection through validate with a typed code', async () => {
    // CONTROL_FLOW edges carry no data, so naming ports on one is a wiring error.
    const built = await harness.build({
      nodes: [{ key: 'a', query: 'things' }],
      edges: [
        { from: START, to: 'a', flow: 'CONTROL_FLOW' },
        {
          from: 'a', to: END, flow: 'VARIABLE_BINDINGS',
          source: { node: 'a', port: 'outputTuple' },
          target: { node: 'a', port: 'outputTuple' },
        },
        {
          from: START, to: 'a', flow: 'CONTROL_FLOW',
          source: { node: 'a', port: 'outputTuple' },
          target: { node: 'a', port: 'outputTuple' },
          id: 'urn:ui-temp:edge-bad',
        },
      ],
    });

    const validation = await harness.validate(built);
    expect(validation.valid).toBe(false);
    const issue = validation.issues.find(i => i.code === 'EDGE_CONTROL_FLOW_HAS_IO');
    expect(issue).toBeDefined();
    expect(issue!.entityId).toBe(built.edgeIris['urn:ui-temp:edge-bad']);
  }, 30000);
});
