import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import type { QueryGroupVersionExpandedWithIriMap } from '@sparql-query-lib/contracts';
import {
  createGraphStateFromExpanded,
  type QueryGroupGraphState,
  type GraphNodeState,
} from '../../../web/src/composables/useQueryGroupGraph.js';
import { useQueryGroupGraphState } from '../../../web/src/composables/useQueryGroupGraphState.js';
import { useQueryGroupIO } from '../../../web/src/composables/useQueryGroupIO.js';
import { GroupHarness, START, END, type BuiltGroup } from '../phase2/harness/group-harness.js';
import { ALL_TEMPLATES, queryIdSelect } from '../phase2/harness/query-templates.js';
import { caseArbitrary, type GeneratedCase } from '../phase2/harness/graph-generator.js';
import { fuzzBudget } from '../phase2/harness/fuzz-budget.js';

/**
 * Frontend round-trip property (issue #47, item 2 — the half that needs an API).
 *
 * `packages/web`'s own `queryGroupPayloadContract.test.ts` takes the first three
 * steps of that item: generate a graph, drive it through the canvas composables,
 * check the payload against the Zod schema. It stops there because the web suite
 * has no server, so the expanded version it starts from is hand-built — and a
 * fixture that satisfies the schema can still be a shape no server sends. Every
 * mock-drift finding on this issue (#374, #379, #382, #389) was exactly that:
 * valid, and untrue.
 *
 * This file closes the loop against the real thing. A graph the API itself built
 * is read back, loaded into the real composables, saved with the real
 * `buildVersionCreatePayload`, and posted to the real writer. The version that
 * comes out must describe the same graph as the one that went in, and still run
 * to the same answer.
 *
 * The comparison is on the *canvas's* view rather than on the expanded
 * response's, because the canvas is the subject: a field the server keeps and
 * the canvas cannot read is a field the next save drops (#301), and a
 * fingerprint taken on the wire would call that a pass.
 *
 * Cribbed from `test/phase2/flat-round-trip.test.ts`, which asks the same
 * question of a client that is not the canvas.
 */

// Three API calls and two canvas loads per case, so the PR default matches the
// flat round trip's rather than the execution fuzzer's. The nightly run
// (`scripts/ci/fuzz-nightly.sh`) raises both together.
const { runs: RUNS, seed: SEED } = fuzzBudget(25);

/** Silence the composables' user-facing channels; the assertions are the report. */
const noopToast = { success: () => {}, error: () => {}, info: () => {}, warning: () => {} };
const quietLogger = { debug: () => {}, error: () => {} };

/**
 * Load an expanded version the way the canvas does, with the payload a "Save new
 * version" would send left as a call rather than a value — a test that wants to
 * say what the canvas *read* should be able to, before a save that cannot
 * happen throws over it.
 *
 * Deliberately the real composables rather than `graphStateToFlatPayload`: the
 * flat payload is one step of the save, and the two fields known to have been
 * dropped silently — `backendConfig` (#301) and `variableMappings` (#372) — were
 * both lost in the step after it.
 */
function loadCanvas(expanded: QueryGroupVersionExpandedWithIriMap): {
  state: QueryGroupGraphState;
  buildPayload: () => Record<string, unknown>;
} {
  const state = createGraphStateFromExpanded(expanded);
  const graph = useQueryGroupGraphState({ initialGraphState: state });
  const io = useQueryGroupIO({ graph, toast: noopToast, logger: quietLogger });
  return {
    state,
    buildPayload: () => io.buildVersionCreatePayload({ versionComment: null }) as Record<string, unknown>,
  };
}

/**
 * Describe a port by what it *is* rather than by its IRI: a tuple by its
 * variable names in member order, anything else by its kind. A save mints fresh
 * IRIs for anything it had to create, so anything compared by IRI would either
 * always fail or have to ignore the very thing being tested.
 */
function portIdentity(state: QueryGroupGraphState, id: string | null | undefined): string {
  if (!id) return 'none';
  const entity = state.ioEntities[id];
  if (!entity) return `unresolved:${id}`;
  if (entity.kind === 'QueryInputTuple' || entity.kind === 'QueryOutputTuple') {
    const members = (entity.memberEntries ?? [])
      .map(memberId => state.tupleMembers[memberId])
      .filter(Boolean)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const names = members.map(member => state.variables[member.variable]?.variableName ?? '?');
    // Arity is carried separately because it is `null` for a tuple whose members
    // were never described, and that is not the same as a tuple of no members.
    const arity = entity.arity == null ? '?' : String(entity.arity);
    return `${entity.kind}(${arity}:${names.join(',')})`;
  }
  return entity.kind;
}

/** Identify a node by what it runs, not by its minted IRI. */
function nodeIdentity(state: QueryGroupGraphState, id: string): string {
  const node = state.nodes.find(n => n.id === id);
  if (!node) return `missing:${id}`;
  if (node.kind === 'start' || node.kind === 'end') return node.kind.toUpperCase();
  const subject = node.queryVersionId ?? node.ruleSetVersionId ?? '?';
  return `${node.kind}:${subject}`;
}

/** The ports a node declares, as identities, so a lost or duplicated port shows. */
function nodePorts(state: QueryGroupGraphState, node: GraphNodeState): string {
  const side = (ports: GraphNodeState['inputs']) =>
    ports.map(port => portIdentity(state, port.id)).sort().join(',');
  return `in[${side(node.inputs)}] out[${side(node.outputs)}]`;
}

/**
 * A whole-graph fingerprint of the canvas's view. Two graph states with the same
 * fingerprint describe the same execution, whatever IRIs they happen to use.
 */
function fingerprint(state: QueryGroupGraphState): string {
  const nodes = state.nodes
    .map(node => `${nodeIdentity(state, node.id)} ${nodePorts(state, node)}`)
    .sort();
  const edges = state.edges
    .map(edge => [
      nodeIdentity(state, edge.source),
      nodeIdentity(state, edge.target),
      edge.flowType,
      portIdentity(state, edge.sourceOutputId),
      portIdentity(state, edge.targetInputId),
      edge.whenEmpty ?? 'default',
      edge.variableMappings ?? 'none',
    ].join('|'))
    .sort();
  const backends = state.nodes
    .filter(node => node.kind !== 'start' && node.kind !== 'end')
    .map(node => `${nodeIdentity(state, node.id)}=${node.backendId ?? JSON.stringify(node.backendConfig ?? null)}`)
    .sort();
  const endMediaType = state.nodes.find(node => node.kind === 'end')?.mediaType ?? null;
  return JSON.stringify({ nodes, edges, backends, endMediaType });
}

describe('query group canvas round trip', () => {
  let harness: GroupHarness;

  beforeAll(async () => {
    harness = await GroupHarness.create('canvas-round-trip');
    for (const template of ALL_TEMPLATES) {
      await harness.defineQuery(template.key, template.sparql);
    }
    await harness.defineRuleSet('derive', [
      'PREFIX ex: <http://example.org/>\nRULE { ?s a ex:Derived } WHERE { ?s a ex:Copy }',
    ]);
  }, 120000);

  afterAll(async () => {
    await harness.destroy();
  });

  const expand = async (built: BuiltGroup): Promise<QueryGroupVersionExpandedWithIriMap> => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/query-groups/${encodeURIComponent(built.groupId)}/v/${built.version}`,
    });
    expect(response.statusCode, response.payload.slice(0, 400)).toBe(200);
    return response.json() as QueryGroupVersionExpandedWithIriMap;
  };

  const save = async (built: BuiltGroup, payload: Record<string, unknown>): Promise<BuiltGroup> => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `/query-groups/${encodeURIComponent(built.groupId)}/v`,
      payload,
    });
    expect(
      response.statusCode,
      `the writer refused the canvas's payload: ${response.payload.slice(0, 600)}`,
    ).toBe(201);
    const body = response.json();
    return {
      ...built,
      versionId: body.queryGroupVersion.id,
      version: Number(body.queryGroupVersion.version),
    };
  };

  it('a generated graph survives load -> save -> reload through the canvas composables', async () => {
    /*
     * The corpus reports what it reached, for the reason `test/phase2/README.md`
     * gives: a property that never generates its subject passes vacuously. Every
     * field this test exists to protect is a field some case has to carry, and
     * the tally is what says so rather than the assertion's green.
     */
    const tally: Record<string, number> = {
      explicitMapping: 0,
      defaultMapping: 0,
      nonDefaultWhenEmpty: 0,
      fanIn: 0,
      startTuple: 0,
      arity2: 0,
      multiNode: 0,
    };

    await fc.assert(fc.asyncProperty(caseArbitrary, async (generated: GeneratedCase) => {
      const built = await harness.build(generated.spec);

      const first = await expand(built);
      const loaded = loadCanvas(first);

      tally[generated.spec.edges.some(edge => edge.variableMappings) ? 'explicitMapping' : 'defaultMapping'] += 1;
      if (generated.spec.edges.some(edge => edge.whenEmpty)) tally.nonDefaultWhenEmpty += 1;
      if (generated.spec.declaredPorts?.length) tally.startTuple += 1;
      if (generated.describe.startsWith('arity=2')) tally.arity2 += 1;
      if (generated.spec.nodes.length > 1) tally.multiNode += 1;
      // Fan-in is two edges landing on one node, which is where the canvas has
      // to keep two mappings apart on one input tuple.
      const inbound = new Map<string, number>();
      for (const edge of generated.spec.edges) inbound.set(edge.to, (inbound.get(edge.to) ?? 0) + 1);
      if ([...inbound.values()].some(count => count > 1)) tally.fanIn += 1;

      const resaved = await save(built, loaded.buildPayload());
      const second = await expand(resaved);
      const reloaded = createGraphStateFromExpanded(second);

      expect(fingerprint(reloaded), `${generated.describe}: the canvas save changed the graph`)
        .toBe(fingerprint(loaded.state));

      // Same shape is necessary but not sufficient: the version the canvas wrote
      // must also still run, and run to the same answer.
      const before = await harness.execute(built, { arguments: generated.externalArguments });
      const after = await harness.execute(resaved, {
        target: 'version',
        arguments: generated.externalArguments,
      });
      expect(after.statusCode, `${generated.describe}: the canvas save stopped the group executing`)
        .toBe(before.statusCode);
      if (before.statusCode === 200) {
        expect(after.payload, `${generated.describe}: the canvas save changed the answer`)
          .toBe(before.payload);
      }
    }), { numRuns: RUNS, seed: SEED });

    console.log(`[canvas round trip] seed=${SEED} runs=${RUNS} coverage=${JSON.stringify(tally)}`);

    expect(tally.explicitMapping, 'no case set an explicit variable mapping').toBeGreaterThan(0);
    expect(tally.defaultMapping, 'every case set a mapping, so the default pairing was never saved').toBeGreaterThan(0);
    expect(tally.nonDefaultWhenEmpty, 'no case set a whenEmpty policy').toBeGreaterThan(0);
    expect(tally.fanIn, 'no case fanned two edges into one node').toBeGreaterThan(0);
    expect(tally.startTuple, 'no case declared a boundary tuple on the start node').toBeGreaterThan(0);
    expect(tally.arity2, 'no case used a two-variable tuple').toBeGreaterThan(0);
    expect(tally.multiNode, 'no case had more than one execution node').toBeGreaterThan(0);
  }, 600000);

  /*
   * The generator builds QueryNodes wired with VARIABLE_BINDINGS, because that
   * is the composition the phase 2 fuzzer was written to explore. The node kinds
   * the canvas has actually lost things on are the other three, and each has its
   * own reason to be here rather than in the web suite's synthetic fixture:
   * every canvas bug this issue turned up on them (#374, #379) was a mock saying
   * something the server does not.
   */
  it('carries a rule set node through a canvas save, with its version and both RDF ports', async () => {
    const built = await harness.build({
      nodes: [
        { key: 'a', query: 'constructThings' },
        { key: 'r', kind: 'RuleSetNode', ruleSet: 'derive' },
      ],
      declaredPorts: [
        { key: 'rIn', type: 'TriplesQuadsIO', attachTo: 'r', attachAs: 'inputs' },
        { key: 'rOut', type: 'TriplesQuadsIO', attachTo: 'r', attachAs: 'outputs' },
      ],
      edges: [
        { from: START, to: 'a', flow: 'CONTROL_FLOW' },
        { from: 'a', to: 'r', flow: 'RDF_GRAPH', source: { node: 'a', port: 'rdf' }, target: { declared: 'rIn' } },
        { from: 'r', to: END, flow: 'RDF_GRAPH', source: { declared: 'rOut' }, target: { declared: 'rOut' } },
      ],
      endNodeMediaType: 'application/n-triples',
    });

    const loaded = loadCanvas(await expand(built));
    // Asserted before the save, and separately from it: a node read without its
    // version cannot be saved at all, and "the writer refused" is a much worse
    // report of that than "the canvas never got the version".
    const ruleSetNode = loaded.state.nodes.find(node => node.kind === 'ruleset');
    expect(ruleSetNode?.ruleSetVersionId, 'the canvas read the rule set node without its version').toBe(
      harness.ruleSetVersionId('derive'),
    );

    const resaved = await save(built, loaded.buildPayload());
    const reloaded = createGraphStateFromExpanded(await expand(resaved));
    expect(fingerprint(reloaded)).toBe(fingerprint(loaded.state));

    // The media type is on the end node rather than on any edge, so a save that
    // dropped it would still round-trip every node and edge and then answer in
    // the wrong format.
    expect(reloaded.nodes.find(node => node.kind === 'end')?.mediaType).toBe('application/n-triples');

    const after = await harness.execute(resaved, { target: 'version', accept: 'application/n-triples' });
    expect(after.statusCode, after.payload.slice(0, 400)).toBe(200);
    expect(after.payload.split('\n').filter(line => line.includes('/Derived'))).toHaveLength(4);
  }, 120000);

  it('carries boolean and query-id ports through a canvas save, which carry no variable names', async () => {
    // Every other port identifies itself by the variables it holds. These two
    // have none, so a canvas that lost their type would produce a payload whose
    // ports look like tuples of nothing - which is also what an empty tuple
    // looks like.
    const target = harness.queryHandle('groups');
    await harness.defineQuery('pointToGroups', queryIdSelect(target.versionId));

    const built = await harness.build({
      nodes: [
        { key: 'ask', query: 'askThings' },
        { key: 'echo', query: 'echoThing' },
        { key: 'ptr', query: 'pointToGroups' },
        { key: 'dyn', query: 'echoThing', kind: 'DynamicQueryNode' },
      ],
      declaredPorts: [{ key: 'dynQuery', type: 'QueryIdInput', attachTo: 'dyn', attachAs: 'inputs' }],
      edges: [
        { from: START, to: 'ask', flow: 'CONTROL_FLOW' },
        { from: START, to: 'ptr', flow: 'CONTROL_FLOW' },
        { from: 'ask', to: 'echo', flow: 'VARIABLE_BINDINGS', source: { node: 'ask', port: 'boolean' }, target: { node: 'echo', input: 0 } },
        { from: 'ptr', to: 'dyn', flow: 'QUERY_ID', source: { node: 'ptr', port: 'outputTuple' }, target: { declared: 'dynQuery' } },
        { from: 'dyn', to: END, flow: 'VARIABLE_BINDINGS', source: { node: 'dyn', port: 'outputTuple' }, target: { node: 'dyn', port: 'outputTuple' } },
      ],
    });

    const loaded = loadCanvas(await expand(built));
    const kinds = Object.values(loaded.state.ioEntities).map(entity => entity.kind);
    expect(kinds, 'the canvas did not read the boolean port as one').toContain('BooleanIO');
    expect(kinds, 'the canvas did not read the query-id port as one').toContain('QueryIdInput');
    expect(loaded.state.nodes.some(node => node.kind === 'dynamic'), 'the dynamic node was read as an ordinary query node').toBe(true);

    const resaved = await save(built, loaded.buildPayload());
    expect(fingerprint(createGraphStateFromExpanded(await expand(resaved)))).toBe(fingerprint(loaded.state));
  }, 120000);

  it('is stable under a second save, so the canvas does not drift a version at a time', async () => {
    // One round trip catches a field dropped outright. A field that is *changed*
    // rather than lost - a mapping rewritten to its default, a policy defaulted
    // to the value it already had - can look identical after one hop and drift
    // after two.
    const generated = (fc.sample(caseArbitrary, { numRuns: 1, seed: SEED })[0]) as GeneratedCase;
    const built = await harness.build(generated.spec);

    const first = createGraphStateFromExpanded(await expand(built));
    let current = built;
    for (let hop = 0; hop < 3; hop += 1) {
      const loaded = loadCanvas(await expand(current));
      current = await save(current, loaded.buildPayload());
      expect(fingerprint(createGraphStateFromExpanded(await expand(current))), `drifted at hop ${hop + 1}`)
        .toBe(fingerprint(first));
    }
  }, 120000);
});
