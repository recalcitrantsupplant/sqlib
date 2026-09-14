import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import { GroupHarness, START, END, type BuiltGroup } from './harness/group-harness.js';
import { ALL_TEMPLATES, getTemplate, queryIdSelect } from './harness/query-templates.js';
import { caseArbitrary, type GeneratedCase } from './harness/graph-generator.js';
import { fuzzBudget } from './harness/fuzz-budget.js';

/**
 * Phase 2 round-trip property (docs §2.3, "Round-trip property").
 *
 * A generated graph goes out through the flat `POST /v`, comes back through the
 * expanded `GET /v/:version`, is rebuilt from what came back, and the rebuild
 * must describe the same graph and execute to the same answer.
 *
 * This is the property that catches writer/expander drift - the temp-URN and
 * `iriMap` path where an entity is minted on the way in but not collected on the
 * way out. Comparison is on a structural fingerprint rather than on IRIs,
 * because a rebuild legitimately mints new ones; anything compared by IRI would
 * either always fail or have to ignore the very thing being tested.
 */

// Round trips are three API calls per case, so the PR default is smaller than
// the execution fuzzer's; the nightly run raises both together.
const { runs: RUNS, seed: SEED } = fuzzBudget(25);

interface Expanded {
  executionNodes: any[];
  startNode?: any;
  endNode?: any;
  edges: any[];
  inputTuples?: any[];
  outputTuples?: any[];
  tupleMembers?: any[];
  inputs?: any[];
  outputs?: any[];
  rdfOutputs?: any[];
  booleanOutputs?: any[];
  queryIdInputs?: any[];
}

/**
 * Describe a port by what it *is* rather than by its IRI: a tuple by its
 * variable names in member order, anything else by its kind.
 */
function portIdentity(expanded: Expanded, id: string | undefined): string {
  if (!id) return 'none';
  const tuple = [...(expanded.inputTuples || []), ...(expanded.outputTuples || [])].find(t => t.id === id);
  if (tuple) {
    const members = (tuple.memberEntries || [])
      .map((memberId: string) => (expanded.tupleMembers || []).find(m => m.id === memberId))
      .filter(Boolean)
      .sort((a: any, b: any) => (a.position ?? 0) - (b.position ?? 0));
    const names = members.map((member: any) => {
      const variable = [...(expanded.inputs || []), ...(expanded.outputs || [])]
        .find(v => v.id === member.variable);
      return variable?.variableName ?? '?';
    });
    const kind = (expanded.inputTuples || []).some(t => t.id === id) ? 'in' : 'out';
    return `${kind}(${names.join(',')})`;
  }
  if ((expanded.rdfOutputs || []).some(o => o.id === id)) return 'rdf';
  if ((expanded.booleanOutputs || []).some(o => o.id === id)) return 'boolean';
  if ((expanded.queryIdInputs || []).some(o => o.id === id)) return 'queryId';
  // An id that resolves to nothing is itself a finding, so it is reported
  // rather than normalised away.
  return `unresolved:${id.replace(/[0-9a-f]{32}/g, '*')}`;
}

/** Identify a node by what it runs, not by its minted IRI. */
function nodeIdentity(expanded: Expanded, id: string): string {
  if (id === expanded.startNode?.id) return 'START';
  if (id === expanded.endNode?.id) return 'END';
  const node = expanded.executionNodes.find(n => n.id === id);
  if (!node) return `missing:${id}`;
  return `${node.nodeType ?? 'QueryNode'}:${node.queryId ?? node.ruleSetVersion ?? '?'}`;
}

/**
 * A whole-graph fingerprint. Two group versions with the same fingerprint
 * describe the same execution, whatever IRIs they happen to use.
 */
function fingerprint(expanded: Expanded): string {
  const nodes = expanded.executionNodes
    .map(n => nodeIdentity(expanded, n.id))
    .sort();
  const edges = expanded.edges
    .map(e => [
      nodeIdentity(expanded, e.sourceNodeId),
      nodeIdentity(expanded, e.targetNodeId),
      e.dataFlowType ?? 'CONTROL_FLOW',
      portIdentity(expanded, e.sourceOutputId),
      portIdentity(expanded, e.targetInputId),
      e.whenEmpty ?? 'default',
    ].join('|'))
    .sort();
  const startOutputs = (expanded.startNode?.outputs || []).map((id: string) => portIdentity(expanded, id)).sort();
  const endInputs = (expanded.endNode?.inputs || []).map((id: string) => portIdentity(expanded, id)).sort();
  return JSON.stringify({ nodes, edges, startOutputs, endInputs });
}

describe('Phase 2 flat round trip', () => {
  let harness: GroupHarness;

  beforeAll(async () => {
    harness = await GroupHarness.create('phase2-round-trip');
    for (const template of ALL_TEMPLATES) {
      await harness.defineQuery(template.key, template.sparql);
    }
  }, 120000);

  afterAll(async () => {
    await harness.destroy();
  });

  const expand = async (built: BuiltGroup): Promise<Expanded> => {
    const response = await harness.app.inject({
      method: 'GET',
      url: `/query-groups/${encodeURIComponent(built.groupId)}/v/${built.version}`,
    });
    expect(response.statusCode, response.payload.slice(0, 400)).toBe(200);
    return response.json() as Expanded;
  };

  /**
   * Rebuild a flat create payload from an expanded version. Existing IO entities
   * are referenced by their real IRIs - the writer leaves non-temp ids alone -
   * while nodes and edges get fresh temp URNs, which is exactly the path a
   * client editing a loaded graph takes.
   */
  const rebuildPayload = (expanded: Expanded): Record<string, unknown> => {
    const nodeRef = (id: string): string => {
      if (id === expanded.startNode?.id) return 'urn:__START__';
      if (id === expanded.endNode?.id) return 'urn:__END__';
      return `urn:ui-temp:rebuilt-${expanded.executionNodes.findIndex(n => n.id === id)}`;
    };

    return {
      queryGroupVersion: {},
      startNode: { outputs: expanded.startNode?.outputs || [] },
      endNode: { mediaType: expanded.endNode?.mediaType ?? null },
      executionNodes: expanded.executionNodes.map((node, index) => {
        const base: Record<string, unknown> = {
          id: `urn:ui-temp:rebuilt-${index}`,
          nodeType: node.nodeType ?? 'QueryNode',
        };
        if ((node.nodeType ?? 'QueryNode') === 'RuleSetNode') {
          base.ruleSetVersion = node.ruleSetVersion;
        } else {
          base.queryId = node.queryId;
          base.backendId = node.backendId;
        }
        if (node.inputs?.length) base.inputs = node.inputs;
        if (node.outputs?.length) base.outputs = node.outputs;
        return base;
      }),
      edges: expanded.edges.map((edge, index) => ({
        id: `urn:ui-temp:rebuilt-edge-${index}`,
        sourceNodeId: nodeRef(edge.sourceNodeId),
        targetNodeId: nodeRef(edge.targetNodeId),
        dataFlowType: edge.dataFlowType,
        ...(edge.sourceOutputId ? { sourceOutputId: edge.sourceOutputId } : {}),
        ...(edge.targetInputId ? { targetInputId: edge.targetInputId } : {}),
        ...(edge.whenEmpty ? { whenEmpty: edge.whenEmpty } : {}),
      })),
    };
  };

  const rebuild = async (built: BuiltGroup, expanded: Expanded): Promise<BuiltGroup> => {
    const response = await harness.app.inject({
      method: 'POST',
      url: `/query-groups/${encodeURIComponent(built.groupId)}/v`,
      payload: rebuildPayload(expanded),
    });
    expect(response.statusCode, `rebuild rejected: ${response.payload.slice(0, 500)}`).toBe(201);
    const body = response.json();
    return { ...built, versionId: body.queryGroupVersion.id, version: Number(body.queryGroupVersion.version) };
  };

  it('generated graphs survive create -> expand -> rebuild unchanged', async () => {
    await fc.assert(fc.asyncProperty(caseArbitrary, async (generated: GeneratedCase) => {
      const built = await harness.build(generated.spec);
      const first = await expand(built);
      const rebuilt = await rebuild(built, first);
      const second = await expand(rebuilt);

      expect(fingerprint(second), `${generated.describe}: rebuild changed the graph`)
        .toBe(fingerprint(first));

      // Same shape is necessary but not sufficient: the rebuild must also
      // still run, and run to the same answer.
      const before = await harness.execute(built, { arguments: generated.externalArguments });
      const after = await harness.execute(rebuilt, { target: 'version', arguments: generated.externalArguments });
      expect(after.statusCode, `${generated.describe}: rebuild stopped executing`).toBe(before.statusCode);
      if (before.statusCode === 200) {
        expect(after.payload).toBe(before.payload);
      }
    }), { numRuns: RUNS, seed: SEED });
  }, 600000);

  it('preserves whenEmpty through create, expand and rebuild', async () => {
    // whenEmpty has to survive four hops to mean anything, and dropping it at
    // any one of them silently changes what an empty upstream does.
    const built = await harness.build({
      nodes: [
        { key: 'a', query: 'noThings' },
        { key: 'b', query: 'thingByThing' },
      ],
      edges: [
        { from: START, to: 'a', flow: 'CONTROL_FLOW' },
        {
          from: 'a', to: 'b', flow: 'VARIABLE_BINDINGS', whenEmpty: 'unconstrained',
          source: { node: 'a', port: 'outputTuple' }, target: { node: 'b', input: 0 },
        },
        {
          from: 'b', to: END, flow: 'VARIABLE_BINDINGS',
          source: { node: 'b', port: 'outputTuple' }, target: { node: 'b', port: 'outputTuple' },
        },
      ],
    });

    const expanded = await expand(built);
    expect(expanded.edges.find(e => e.dataFlowType === 'VARIABLE_BINDINGS' && e.whenEmpty)?.whenEmpty)
      .toBe('unconstrained');

    const rebuilt = await rebuild(built, expanded);
    const again = await expand(rebuilt);
    expect(again.edges.some(e => e.whenEmpty === 'unconstrained')).toBe(true);

    // The behaviour, not just the field: unconstrained means the empty upstream
    // does not filter, so all four Things come back.
    const execution = await harness.execute(rebuilt, { target: 'version' });
    expect(execution.statusCode).toBe(200);
    expect(execution.json().results.bindings).toHaveLength(4);
  }, 30000);

  it('round-trips boolean and query-id ports, which carry no variable names', async () => {
    // These ports were invisible in the expanded form until Phase 2: a client
    // could write a group using them and then not be able to read it back.
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

    const expanded = await expand(built);
    expect(expanded.booleanOutputs?.length, 'boolean port missing from the expanded form').toBeGreaterThan(0);
    expect(expanded.queryIdInputs?.length, 'query-id port missing from the expanded form').toBeGreaterThan(0);

    const rebuilt = await rebuild(built, expanded);
    expect(fingerprint(await expand(rebuilt))).toBe(fingerprint(expanded));
  }, 30000);
});
