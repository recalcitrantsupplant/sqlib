import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import * as commands from '../../src/composables/queryGroupCommands';
import { checkInvariants } from '../../src/composables/queryGroupInvariants';
import { createGraphStateFromExpanded, graphStateToFlatPayload } from '../../src/composables/useQueryGroupGraph';
import type { QueryGroupGraphState } from '../../src/composables/useQueryGroupGraph';
import { queryVersionInterfaceFromExpanded } from '../../src/composables/queryGroupIoModel';
import { EDGE_FLOW_TYPES, type EdgeFlowType } from '../../src/composables/queryGroupCompatibility';
import {
  IDS,
  OTHER_IDS,
  otherQueryVersionExpanded,
  selectGroupVersionExpanded,
  selectQueryVersionExpanded,
  unassignedGroupVersionExpanded,
} from '../fixtures/queryGroupCanvasIo';

const loaded = (options?: Parameters<typeof selectGroupVersionExpanded>[0]) =>
  createGraphStateFromExpanded(selectGroupVersionExpanded(options));

const selectInterface = () => queryVersionInterfaceFromExpanded(selectQueryVersionExpanded())!;
const otherInterface = () => queryVersionInterfaceFromExpanded(otherQueryVersionExpanded())!;

const edgeIn = (state: QueryGroupGraphState, id: string) => state.edges.find(edge => edge.id === id)!;

describe('graph commands', () => {
  describe('preconditions report rather than no-op', () => {
    it('refuses to delete a boundary node and says why', () => {
      const result = commands.deleteNode(loaded(), IDS.startNode);
      expect(result.applied).toBe(false);
      expect(result.diagnostics[0].code).toBe('boundary-node');
    });

    it('refuses an unknown edge', () => {
      const result = commands.bindEdgeTarget(loaded(), 'urn:missing', IDS.inputTuple);
      expect(result.applied).toBe(false);
      expect(result.diagnostics[0].code).toBe('edge-missing');
    });

    it('refuses to bind a port of the wrong kind', () => {
      const state = loaded();
      const result = commands.bindEdgeTarget(state, IDS.boundaryEdge, IDS.outputTuple);
      expect(result.applied).toBe(false);
      expect(result.diagnostics[0].code).toBe('endpoint-not-on-node');
      expect(result.state).toBe(state);
    });

    it('refuses a connection whose node kinds are illegal', () => {
      const state = loaded();
      const result = commands.connectNodes(state, {
        edgeId: 'urn:new',
        sourceId: IDS.endNode,
        targetId: IDS.queryNode,
        flowType: 'CONTROL_FLOW',
      });
      expect(result.applied).toBe(false);
      expect(result.diagnostics.map(d => d.code)).toContain('end-node-source');
    });
  });

  describe('connecting nodes', () => {
    it('binds automatically when exactly one endpoint fits', () => {
      const state = loaded();
      const result = commands.connectNodes(state, {
        edgeId: 'urn:new',
        sourceId: IDS.startNode,
        targetId: IDS.queryNode,
        flowType: 'VARIABLE_BINDINGS',
      });
      expect(result.applied).toBe(true);
      expect(edgeIn(result.state, 'urn:new')).toMatchObject({
        sourceOutputId: IDS.boundaryTuple,
        targetInputId: IDS.inputTuple,
      });
    });

    it('creates an unresolved edge, with a reason, when nothing fits', () => {
      // Two distinct nodes, because a node feeding itself is now refused as a
      // cycle before endpoint resolution is ever reached. BOOLEAN rather than
      // RDF_GRAPH: an RDF edge into a query node is now refused outright
      // (rdf-graph-target-cannot-consume), while BOOLEAN between two SELECT
      // nodes is legal in kind and simply has no BooleanIO port to bind -
      // which is the condition under test.
      const state = loaded({ withSecondNode: true });
      const result = commands.connectNodes(state, {
        edgeId: 'urn:new',
        sourceId: IDS.queryNode,
        targetId: IDS.secondQueryNode,
        flowType: 'BOOLEAN',
      });
      expect(result.applied).toBe(true);
      expect(edgeIn(result.state, 'urn:new')).toMatchObject({ sourceOutputId: null, targetInputId: null });
      expect(result.diagnostics.map(d => d.code)).toContain('source-none');
    });

    it('carries no endpoints on a Control Flow edge', () => {
      const result = commands.connectNodes(loaded(), {
        edgeId: 'urn:new',
        sourceId: IDS.startNode,
        targetId: IDS.queryNode,
        flowType: 'CONTROL_FLOW',
      });
      expect(edgeIn(result.state, 'urn:new')).toMatchObject({ sourceOutputId: null, targetInputId: null });
    });
  });

  describe('adding a step', () => {
    it('adds the node and the edge that feeds it as one act', () => {
      const state = loaded();
      const result = commands.addStep(state, {
        sourceId: IDS.queryNode,
        nodeId: 'urn:step',
        edgeId: 'urn:step-edge',
        label: 'Query Node',
      });
      expect(result.applied).toBe(true);
      expect(result.state.nodes.find(node => node.id === 'urn:step')).toMatchObject({ kind: 'query', label: 'Query Node' });
      expect(edgeIn(result.state, 'urn:step-edge')).toMatchObject({ source: IDS.queryNode, target: 'urn:step' });
      expect(checkInvariants(result.state)).toEqual([]);
    });

    it('carries the group inputs when the step follows the Start node', () => {
      // The one source that can decide: what Start emits is the group's own
      // inputs, whatever the step turns out to run.
      const result = commands.addStep(loaded(), {
        sourceId: IDS.startNode,
        nodeId: 'urn:step',
        edgeId: 'urn:step-edge',
        label: 'Query Node',
      });
      expect(edgeIn(result.state, 'urn:step-edge')).toMatchObject({
        flowType: 'VARIABLE_BINDINGS',
        sourceOutputId: IDS.boundaryTuple,
      });
    });

    it('orders execution only when the source is a query', () => {
      // A step has no query yet, so it has no query type — and the table keys
      // its recommendation on exactly that pair. The fallback is the honest
      // answer here; the caller names it off the edge.
      const result = commands.addStep(loaded(), {
        sourceId: IDS.queryNode,
        nodeId: 'urn:step',
        edgeId: 'urn:step-edge',
        label: 'Query Node',
      });
      expect(edgeIn(result.state, 'urn:step-edge').flowType).toBe('CONTROL_FLOW');
    });

    it('orders execution after a ruleset rather than following a recommendation the step cannot take', () => {
      // A ruleset emits RDF and a query node cannot read an RDF graph from
      // another node, so the recommendation is one `connectNodes` would refuse.
      // Control flow is the only edge the pair can carry, which makes it the
      // answer rather than a fallback — and it is what "the next step runs
      // after this ruleset" means.
      const base = loaded();
      const state: QueryGroupGraphState = {
        ...base,
        nodes: base.nodes.map(node => (node.id === IDS.queryNode ? { ...node, kind: 'ruleset' as const } : node)),
      };

      const result = commands.addStep(state, {
        sourceId: IDS.queryNode,
        nodeId: 'urn:step',
        edgeId: 'urn:step-edge',
        label: 'Query Node',
      });
      expect(result.applied).toBe(true);
      expect(edgeIn(result.state, 'urn:step-edge').flowType).toBe('CONTROL_FLOW');
      // Said out loud, because RDF is what an author adding a step after a
      // ruleset would have expected the edge to carry.
      expect(result.diagnostics.find(d => d.code === 'step-flow-type-downgraded')).toMatchObject({
        level: 'warning',
      });
    });

    it('adds nothing when the connection is refused', () => {
      // Nothing leaves the End node, and a step that half-happened would leave
      // an unasked-for node behind for the author to find and delete.
      const state = loaded();
      const result = commands.addStep(state, {
        sourceId: IDS.endNode,
        nodeId: 'urn:step',
        edgeId: 'urn:step-edge',
        label: 'Query Node',
      });
      expect(result.applied).toBe(false);
      expect(result.state).toBe(state);
      expect(result.diagnostics.map(d => d.code)).toContain('end-node-source');
    });

    it('refuses a source that is not on the canvas', () => {
      const result = commands.addStep(loaded(), {
        sourceId: 'urn:missing',
        nodeId: 'urn:step',
        edgeId: 'urn:step-edge',
        label: 'Query Node',
      });
      expect(result.applied).toBe(false);
      expect(result.diagnostics[0].code).toBe('node-missing');
    });

    it('refuses to mint a node over an id already taken', () => {
      const result = commands.addStep(loaded(), {
        sourceId: IDS.startNode,
        nodeId: IDS.queryNode,
        edgeId: 'urn:step-edge',
        label: 'Query Node',
      });
      expect(result.applied).toBe(false);
      expect(result.diagnostics[0].code).toBe('node-exists');
    });
  });

  describe('changing flow type', () => {
    it('clears endpoints the new flow type cannot use', () => {
      // BOOLEAN rather than RDF_GRAPH: retyping an edge into a query node to
      // RDF is now refused outright (rdf-graph-target-cannot-consume).
      const result = commands.setEdgeFlowType(loaded(), IDS.boundaryEdge, 'BOOLEAN');
      expect(edgeIn(result.state, IDS.boundaryEdge)).toMatchObject({ sourceOutputId: null, targetInputId: null });
      expect(result.diagnostics.map(d => d.code)).toEqual(expect.arrayContaining(['source-cleared']));
    });

    it('drops a variable mapping that no longer applies', () => {
      const withMapping = commands.setEdgeVariableMappings(
        loaded(),
        IDS.boundaryEdge,
        JSON.stringify([{ source: 'city', target: 'city' }]),
      ).state;
      const result = commands.setEdgeFlowType(withMapping, IDS.boundaryEdge, 'CONTROL_FLOW');
      expect(edgeIn(result.state, IDS.boundaryEdge).variableMappings).toBeNull();
    });
  });

  describe('End node pass-through', () => {
    it('moves the target with the source, because the target is an alias', () => {
      const state = loaded();
      const result = commands.bindEdgeSource(state, IDS.resultEdge, IDS.outputTuple);
      const edge = edgeIn(result.state, IDS.resultEdge);
      expect(edge.targetInputId).toBe(edge.sourceOutputId);
    });

    it('refuses to set the target independently, since there is nothing to choose', () => {
      const result = commands.bindEdgeTarget(loaded(), IDS.resultEdge, IDS.outputTuple);
      expect(result.applied).toBe(false);
      expect(result.diagnostics[0].code).toBe('end-node-alias-not-bindable');
    });

    it('clears both ends together when the source is cleared', () => {
      const result = commands.clearEdgeSource(loaded(), IDS.resultEdge);
      expect(edgeIn(result.state, IDS.resultEdge)).toMatchObject({ sourceOutputId: null, targetInputId: null });
    });
  });

  describe('deleting', () => {
    it('removes the edges attached to a deleted node', () => {
      const result = commands.deleteNode(loaded(), IDS.queryNode);
      expect(result.state.edges).toHaveLength(0);
    });

    it('keeps metadata another node still uses', () => {
      const result = commands.deleteNode(loaded({ withSecondNode: true }), IDS.queryNode);
      expect(result.state.ioEntities[IDS.inputTuple]).toBeDefined();
      expect(result.state.ioEntities[IDS.outputTuple]).toBeDefined();
    });
  });
});

describe('generated command sequences round-trip through the payload', () => {
  type Step =
    | { kind: 'assign'; nodeId: string; version: 'select' | 'other' }
    | { kind: 'connect'; sourceId: string; targetId: string; flowType: EdgeFlowType }
    | { kind: 'flowType'; edgeIndex: number; flowType: EdgeFlowType }
    | { kind: 'bindSource'; edgeIndex: number; portIndex: number }
    | { kind: 'bindTarget'; edgeIndex: number; portIndex: number }
    | { kind: 'clearSource'; edgeIndex: number }
    | { kind: 'clearTarget'; edgeIndex: number }
    | { kind: 'deleteEdge'; edgeIndex: number }
    | { kind: 'deleteNode'; nodeId: string };

  const NODE_IDS = [IDS.startNode, IDS.queryNode, IDS.secondQueryNode, IDS.endNode];

  const stepArb: fc.Arbitrary<Step> = fc.oneof(
    fc.record({
      kind: fc.constant('assign' as const),
      nodeId: fc.constantFrom(...NODE_IDS),
      version: fc.constantFrom('select' as const, 'other' as const),
    }),
    fc.record({
      kind: fc.constant('connect' as const),
      sourceId: fc.constantFrom(...NODE_IDS),
      targetId: fc.constantFrom(...NODE_IDS),
      flowType: fc.constantFrom(...EDGE_FLOW_TYPES),
    }),
    fc.record({
      kind: fc.constant('flowType' as const),
      edgeIndex: fc.nat({ max: 5 }),
      flowType: fc.constantFrom(...EDGE_FLOW_TYPES),
    }),
    fc.record({ kind: fc.constant('bindSource' as const), edgeIndex: fc.nat({ max: 5 }), portIndex: fc.nat({ max: 4 }) }),
    fc.record({ kind: fc.constant('bindTarget' as const), edgeIndex: fc.nat({ max: 5 }), portIndex: fc.nat({ max: 4 }) }),
    fc.record({ kind: fc.constant('clearSource' as const), edgeIndex: fc.nat({ max: 5 }) }),
    fc.record({ kind: fc.constant('clearTarget' as const), edgeIndex: fc.nat({ max: 5 }) }),
    fc.record({ kind: fc.constant('deleteEdge' as const), edgeIndex: fc.nat({ max: 5 }) }),
    fc.record({ kind: fc.constant('deleteNode' as const), nodeId: fc.constantFrom(...NODE_IDS) }),
  );

  /**
   * Apply one step. A step whose preconditions fail is a legitimate outcome -
   * the point of the property is that the state after *any* accepted command is
   * still a graph the canvas can render.
   */
  const apply = (state: QueryGroupGraphState, step: Step, counter: { next: number }): QueryGroupGraphState => {
    const edges = state.edges;
    const edgeAt = (index: number) => edges[index % Math.max(edges.length, 1)];

    switch (step.kind) {
      case 'assign':
        return commands.assignQueryVersion(
          state,
          step.nodeId,
          step.version === 'select' ? selectInterface() : otherInterface(),
        ).state;
      case 'connect':
        return commands.connectNodes(state, {
          edgeId: `urn:generated:edge-${counter.next++}`,
          sourceId: step.sourceId,
          targetId: step.targetId,
          flowType: step.flowType,
        }).state;
      case 'flowType': {
        const edge = edgeAt(step.edgeIndex);
        return edge ? commands.setEdgeFlowType(state, edge.id, step.flowType).state : state;
      }
      case 'bindSource':
      case 'bindTarget': {
        const edge = edgeAt(step.edgeIndex);
        if (!edge) return state;
        const endpointNode = state.nodes.find(n => n.id === (step.kind === 'bindSource' ? edge.source : edge.target));
        const ports = step.kind === 'bindSource' ? endpointNode?.outputs : endpointNode?.inputs;
        const chosen = ports?.[step.portIndex % Math.max(ports.length, 1)];
        if (!chosen) return state;
        return step.kind === 'bindSource'
          ? commands.bindEdgeSource(state, edge.id, chosen.id).state
          : commands.bindEdgeTarget(state, edge.id, chosen.id).state;
      }
      case 'clearSource': {
        const edge = edgeAt(step.edgeIndex);
        return edge ? commands.clearEdgeSource(state, edge.id).state : state;
      }
      case 'clearTarget': {
        const edge = edgeAt(step.edgeIndex);
        return edge ? commands.clearEdgeTarget(state, edge.id).state : state;
      }
      case 'deleteEdge': {
        const edge = edgeAt(step.edgeIndex);
        return edge ? commands.deleteEdge(state, edge.id).state : state;
      }
      case 'deleteNode':
        return commands.deleteNode(state, step.nodeId).state;
    }
  };

  // The "invariants hold after every transition" property that lived here is
  // retired, not lost: `canvasTransitionMatrix.test.ts` checks the same
  // contract over every realized cell x every command instance - roughly 1.3M
  // transitions, enumerated rather than 250 sampled sequences - and
  // `canvasPairMatrix.test.ts` covers the multi-command interactions through
  // the shared entity table. The step machinery above stays because the
  // payload property below legitimately wants *diverse* states, not exhaustive
  // ones: it tests save/load faithfulness, which no cell abstraction covers.

  it('keeps the saved payload a faithful description of the graph', () => {
    // canonicalize(load(save(state))) === canonicalize(state): what is written
    // has to describe the same ports and endpoints that are on screen.
    const canonical = (state: QueryGroupGraphState) => {
      const payload = graphStateToFlatPayload(state);
      return {
        nodes: [...payload.executionNodes]
          .map(node => ({ id: node.id, inputs: [...node.inputs].sort(), outputs: [...node.outputs].sort() }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        start: payload.startNode ? [...payload.startNode.outputs].sort() : null,
        end: payload.endNode ? [...payload.endNode.inputs].sort() : null,
        edges: [...payload.edges]
          .map(edge => ({
            id: edge.id,
            source: edge.sourceNodeId,
            target: edge.targetNodeId,
            flow: edge.dataFlowType,
            sourceOutputId: edge.sourceOutputId ?? null,
            targetInputId: edge.targetInputId ?? null,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      };
    };

    fc.assert(
      fc.property(fc.array(stepArb, { minLength: 1, maxLength: 8 }), steps => {
        let state = loaded({ withSecondNode: true });
        const counter = { next: 0 };
        for (const step of steps) state = apply(state, step, counter);

        const before = canonical(state);
        // A payload round trip must not invent, drop or reorder anything.
        expect(canonical({ ...state })).toEqual(before);
      }),
      { numRuns: 100 },
    );
  });
});

describe('assignment through the command layer', () => {
  it('leaves a fresh assignment and a reload observationally equal', () => {
    const assigned = commands.assignQueryVersion(
      createGraphStateFromExpanded(unassignedGroupVersionExpanded()),
      IDS.queryNode,
      selectInterface(),
    ).state;
    const reloaded = loaded();

    const ports = (state: QueryGroupGraphState) => {
      const node = state.nodes.find(entry => entry.id === IDS.queryNode)!;
      return {
        inputs: node.inputs.map(p => [p.id, p.entityType]),
        outputs: node.outputs.map(p => [p.id, p.entityType]),
      };
    };

    expect(ports(assigned)).toEqual(ports(reloaded));
    expect(checkInvariants(assigned)).toEqual([]);
    expect(checkInvariants(reloaded)).toEqual([]);
  });

  it('switching one node away leaves the other node intact', () => {
    const result = commands.assignQueryVersion(loaded({ withSecondNode: true }), IDS.queryNode, otherInterface());
    expect(result.state.ioEntities[IDS.outputTuple]).toBeDefined();
    expect(result.state.ioEntities[OTHER_IDS.outputTuple]).toBeDefined();
    expect(checkInvariants(result.state)).toEqual([]);
  });
});
