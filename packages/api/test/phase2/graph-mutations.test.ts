import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { GroupHarness, START, END, type GraphSpec } from './harness/group-harness.js';
import { BNODE_TEMPLATE, getTemplate } from './harness/query-templates.js';

/**
 * Phase 2 mutation testing (docs §2.3, "Mutation testing for invalid graphs").
 *
 * Take one graph that is known good, break it exactly one way, and require two
 * things: validation catches it, and it names the entity at fault. Single
 * mutations are the point - a graph broken two ways proves nothing about which
 * check did the catching.
 *
 * Written as a table over a fixed base graph rather than over generated ones.
 * Each mutation has a specific expected code, so generating the base adds noise
 * without adding coverage, and a failure here points straight at one rule.
 */
describe('Phase 2 graph mutations', () => {
  let harness: GroupHarness;

  beforeAll(async () => {
    harness = await GroupHarness.create('phase2-mutations');
    for (const key of ['things', 'thingByThing', 'echoThing', 'pairFilter', 'thingLabelPairs', 'labelledThings']) {
      await harness.defineQuery(key, getTemplate(key).sparql);
    }
    await harness.defineQuery(BNODE_TEMPLATE.key, BNODE_TEMPLATE.sparql);
  }, 120000);

  afterAll(async () => {
    await harness.destroy();
  });

  /** The known-good graph every mutation starts from: things -> thingByThing -> END. */
  const baseSpec = (): GraphSpec => ({
    nodes: [
      { key: 'a', query: 'things' },
      { key: 'b', query: 'thingByThing' },
    ],
    edges: [
      { from: START, to: 'a', flow: 'CONTROL_FLOW', id: 'urn:ui-temp:edge-entry' },
      {
        from: 'a', to: 'b', flow: 'VARIABLE_BINDINGS', id: 'urn:ui-temp:edge-chain',
        source: { node: 'a', port: 'outputTuple' }, target: { node: 'b', input: 0 },
      },
      {
        from: 'b', to: END, flow: 'VARIABLE_BINDINGS', id: 'urn:ui-temp:edge-exit',
        source: { node: 'b', port: 'outputTuple' }, target: { node: 'b', port: 'outputTuple' },
      },
    ],
  });

  it('the base graph is valid, so every failure below is the mutation', async () => {
    const built = await harness.build(baseSpec());
    expect((await harness.validate(built)).valid).toBe(true);
    expect((await harness.execute(built)).statusCode).toBe(200);
  }, 30000);

  interface Mutation {
    name: string;
    /** Breaks the spec in place. */
    apply: (spec: GraphSpec) => void;
    code?: string;
    /** Which entity the issue must name. */
    at?: 'edge-chain' | 'node-b' | 'graph';
    /**
     * The mutation names an entity that does not exist anywhere, so the write
     * refuses the payload before a version is created and validation never
     * gets a turn. The rejection still has to name the entity at fault, which
     * is what this asserts.
     */
    rejectedAtWrite?: string;
  }

  const mutations: Mutation[] = [
    {
      name: 'introduces a cycle',
      apply: spec => {
        spec.edges.push({
          from: 'b', to: 'a', flow: 'CONTROL_FLOW', id: 'urn:ui-temp:edge-cycle',
        });
      },
      code: 'GRAPH_CYCLE',
      at: 'graph',
    },
    {
      name: 'mismatches tuple arity',
      apply: spec => {
        // A two-variable producer feeding a one-variable slot.
        spec.nodes[0].query = 'thingLabelPairs';
        spec.edges[1].source = { node: 'a', port: 'outputTuple' };
      },
      code: 'EDGE_TUPLE_ARITY_MISMATCH',
      at: 'edge-chain',
    },
    {
      name: 'drops the VALUES clause the edge feeds',
      apply: spec => {
        // The target no longer has a parameter slot, so nothing can receive the
        // upstream rows - the input tuple is still declared but unbacked.
        spec.nodes[1].query = 'labelledThings';
        spec.edges[1].target = { node: 'b', port: 'outputTuple' };
        spec.edges[2].source = { node: 'b', port: 'outputTuple' };
        spec.edges[2].target = { node: 'b', port: 'outputTuple' };
      },
      code: 'EDGE_TARGET_PORT_TYPE',
      at: 'edge-chain',
    },
    {
      name: 'points the edge at the wrong port entity type',
      apply: spec => {
        spec.declaredPorts = [{ key: 'stray', type: 'TriplesQuadsIO', attachTo: 'b', attachAs: 'inputs' }];
        spec.edges[1].target = { declared: 'stray' };
      },
      code: 'EDGE_TARGET_PORT_TYPE',
      at: 'edge-chain',
    },
    {
      name: 'dangles the source IO reference',
      apply: spec => {
        spec.edges[1].source = { literal: 'urn:sqlib:output-tuple:does-not-exist' };
      },
      rejectedAtWrite: 'urn:sqlib:output-tuple:does-not-exist',
    },
    {
      name: 'dangles the target IO reference',
      apply: spec => {
        spec.edges[1].target = { literal: 'urn:sqlib:input-tuple:does-not-exist' };
      },
      rejectedAtWrite: 'urn:sqlib:input-tuple:does-not-exist',
    },
    {
      // Distinct from dangling: the port exists, so the write accepts it, and
      // it is the graph rules that must notice it belongs to the wrong node.
      // Without this the UNDECLARED branches lose their only coverage.
      name: 'sources an edge from a port the source node does not declare',
      apply: spec => {
        spec.edges[1].source = { node: 'b', port: 'outputTuple' };
      },
      code: 'EDGE_SOURCE_OUTPUT_UNDECLARED',
      at: 'edge-chain',
    },
    {
      name: 'targets an edge at a port the target node does not declare',
      apply: spec => {
        spec.edges[1].target = { node: 'a', port: 'outputTuple' };
      },
      code: 'EDGE_TARGET_INPUT_UNDECLARED',
      at: 'edge-chain',
    },
    {
      name: 'names ports on a control flow edge',
      apply: spec => {
        spec.edges[0].source = { node: 'a', port: 'outputTuple' };
        spec.edges[0].target = { node: 'a', port: 'outputTuple' };
      },
      code: 'EDGE_CONTROL_FLOW_HAS_IO',
      at: 'graph',
    },
  ];

  for (const mutation of mutations) {
    it(`rejects a graph that ${mutation.name}`, async () => {
      const spec = baseSpec();
      mutation.apply(spec);

      if (mutation.rejectedAtWrite) {
        const { built: rejected, response } = await harness.tryBuild(spec);
        expect(rejected, `${mutation.name} was accepted`).toBeNull();
        expect(response.statusCode).toBe(422);
        expect(response.payload).toContain(mutation.rejectedAtWrite);
        return;
      }

      const built = await harness.build(spec);

      const validation = await harness.validate(built);
      expect(validation.valid, `${mutation.name} was accepted`).toBe(false);
      const issue = validation.issues.find(i => i.code === mutation.code);
      expect(
        issue,
        `expected ${mutation.code}, got ${JSON.stringify(validation.issues.map(i => i.code))}`,
      ).toBeDefined();

      if (mutation.at === 'edge-chain') {
        expect(issue!.entityId).toBe(built.edgeIris['urn:ui-temp:edge-chain']);
      } else if (mutation.at === 'node-b') {
        expect(issue!.entityId).toBe(built.nodeIris.b);
      }

      // The executor must refuse it too, as a client error.
      const execution = await harness.execute(built);
      expect(execution.statusCode).toBeGreaterThanOrEqual(400);
      expect(execution.statusCode).toBeLessThan(500);
    }, 30000);
  }

  it('rejects a blank node crossing a chained edge', async () => {
    // Not a validation failure: nothing about the graph shape is wrong, and the
    // offending value only exists once the upstream has run. It must still fail
    // by name rather than dropping the row.
    const spec = baseSpec();
    spec.nodes[0].query = BNODE_TEMPLATE.key;
    const built = await harness.build(spec);

    expect((await harness.validate(built)).valid).toBe(true);
    const execution = await harness.execute(built);
    expect(execution.statusCode).toBe(400);
    expect(execution.payload).toContain('Unsupported SPARQL value type');
    expect(execution.json().failedNodeId).toBe(built.nodeIris.b);
  }, 30000);

  it('rejects external arguments whose variables are in the wrong order', async () => {
    // §1.3: right variables, wrong order used to pass the order-insensitive
    // filter, fail the order-sensitive match, and fall through to running
    // unconstrained. It is a named error now, and needs a two-variable slot to
    // be expressible at all.
    const built = await harness.build({
      nodes: [{ key: 'a', query: 'pairFilter' }],
      edges: [
        { from: START, to: 'a', flow: 'CONTROL_FLOW' },
        {
          from: 'a', to: END, flow: 'VARIABLE_BINDINGS',
          source: { node: 'a', port: 'outputTuple' }, target: { node: 'a', port: 'outputTuple' },
        },
      ],
    });

    const wrongOrder = await harness.execute(built, {
      arguments: [{
        head: { vars: ['thing', 'label'] },
        arguments: {
          bindings: [{
            thing: { type: 'uri', value: 'http://example.org/t1' },
            label: { type: 'literal', value: 'alpha' },
          }],
        },
      }],
    });
    expect(wrongOrder.statusCode).toBe(400);
    expect(wrongOrder.payload).toContain('order mismatch');

    // The same values in the declared order are accepted, so the rejection is
    // about order rather than about the arguments being unusable.
    const rightOrder = await harness.execute(built, {
      arguments: [{
        head: { vars: ['label', 'thing'] },
        arguments: {
          bindings: [{
            label: { type: 'literal', value: 'alpha' },
            thing: { type: 'uri', value: 'http://example.org/t1' },
          }],
        },
      }],
    });
    expect(rightOrder.statusCode).toBe(200);
    expect(rightOrder.json().results.bindings).toHaveLength(1);
  }, 30000);
});
