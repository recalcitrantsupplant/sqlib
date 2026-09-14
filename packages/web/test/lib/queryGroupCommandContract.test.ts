/**
 * The command contract, and the four holes in it that the random sequence
 * property never found.
 *
 * `queryGroupCommands.ts` states its own contract at the top: a command that
 * could not do what was asked returns diagnostics rather than failing silently,
 * and the state it returns is always one the canvas can render. Both halves
 * were violated. These are the pinned regressions - each one was verified
 * failing against the pre-fix implementation before the fix was written.
 *
 * Why sampling missed them is worth recording, because it is the argument for
 * the matrices in `canvasCellMatrix` / `canvasTransitionMatrix`:
 *
 * - H1 and H4 are *depth 1*. The property simply never called those two
 *   commands - `setEdgeVariableMappings` and `setNodeQueryVersionResolution`
 *   were absent from its `Step` union, so 250 runs x 12 steps could not reach
 *   them however long it ran. Enumeration over the command inventory cannot
 *   have that shape of gap, and D0's inventory assertion makes a newly exported
 *   command fail by name.
 * - H2 is an ordered pair of commands with a *precondition on the data*: the
 *   mapping has to be valid before the reassignment for the defect to appear.
 *   Random parameter choice makes that conjunction rare.
 * - H3 needs two specific edges between two specific nodes.
 */

import { describe, it, expect } from 'vitest';

import * as commands from '../../src/composables/queryGroupCommands';
import { checkInvariants } from '../../src/composables/queryGroupInvariants';
import { createGraphStateFromExpanded, ioModelOf } from '../../src/composables/useQueryGroupGraph';
import type { QueryGroupGraphState } from '../../src/composables/useQueryGroupGraph';
import { queryVersionInterfaceFromExpanded, variablesForPort } from '../../src/composables/queryGroupIoModel';
import { validateEdge } from '../../src/composables/queryGroupCompatibility';
import {
  IDS,
  otherQueryVersionExpanded,
  selectGroupVersionExpanded,
} from '../fixtures/queryGroupCanvasIo';

const loaded = () => createGraphStateFromExpanded(selectGroupVersionExpanded({ withSecondNode: true }));
const otherInterface = () => queryVersionInterfaceFromExpanded(otherQueryVersionExpanded())!;

const bindingsEdgeInto = (state: QueryGroupGraphState, nodeId: string) =>
  state.edges.find(
    edge => edge.flowType === 'VARIABLE_BINDINGS' && edge.target === nodeId && edge.sourceOutputId && edge.targetInputId,
  )!;

const codesOf = (issues: { code: string }[]) => issues.map(issue => issue.code).sort();

describe('H1: setEdgeVariableMappings refuses what the invariants reject', () => {
  // The command wrote any string straight onto the edge and returned
  // `applied: true, diagnostics: []`. `checkInvariants` then reported
  // `mapping-malformed` on the result - a command producing a state its own
  // module's checker rejects, silently, which is exactly what the header
  // paragraph promises will not happen.
  it('refuses malformed JSON and says why', () => {
    const state = loaded();
    const edge = bindingsEdgeInto(state, IDS.queryNode);

    const result = commands.setEdgeVariableMappings(state, edge.id, 'not json at all');

    expect(result.applied).toBe(false);
    expect(codesOf(result.diagnostics)).toEqual(['mapping-malformed']);
    expect(result.state).toBe(state);
    expect(checkInvariants(result.state)).toEqual([]);
  });

  it.each([
    ['JSON that is not an array', '{"source":"city","target":"city"}'],
    ['an entry with non-string fields', '[{"source":1,"target":2}]'],
    ['an entry missing a field', '[{"source":"city"}]'],
  ])('refuses %s', (_label, raw) => {
    const state = loaded();
    const edge = bindingsEdgeInto(state, IDS.queryNode);

    const result = commands.setEdgeVariableMappings(state, edge.id, raw);

    expect(result.applied).toBe(false);
    expect(codesOf(result.diagnostics)).toEqual(['mapping-malformed']);
  });

  it.each([
    ['null', null],
    ['the empty string', ''],
    ['an empty array', '[]'],
  ])('accepts %s as "no mapping"', (_label, raw) => {
    const state = loaded();
    const edge = bindingsEdgeInto(state, IDS.queryNode);

    const result = commands.setEdgeVariableMappings(state, edge.id, raw);

    expect(result.applied).toBe(true);
    expect(checkInvariants(result.state)).toEqual([]);
  });

  // The other half of D1's mapping policy. A mapping naming variables that do
  // not exist is *reachable* without any command doing anything wrong (H2), so
  // it is a validation diagnostic the author has to see and act on, not a state
  // the canvas refuses to hold. Accepting it is the point; the assertion is
  // that it stays visible through `validateEdge`.
  it('accepts unknown variable names, and they surface as edge validation', () => {
    const state = loaded();
    const edge = bindingsEdgeInto(state, IDS.queryNode);

    const result = commands.setEdgeVariableMappings(
      state,
      edge.id,
      JSON.stringify([{ source: 'nosuchsource', target: 'nosuchtarget' }]),
    );

    expect(result.applied).toBe(true);
    expect(checkInvariants(result.state)).toEqual([]);

    const after = result.state.edges.find(entry => entry.id === edge.id)!;
    const issues = validateEdge(
      after,
      result.state.nodes.find(node => node.id === after.source),
      result.state.nodes.find(node => node.id === after.target),
      ioModelOf(result.state),
    );
    expect(codesOf(issues.filter(issue => issue.level === 'error'))).toEqual([
      'mapping-unknown-source',
      'mapping-unknown-target',
    ]);
  });
});

describe('H5: retyping to VARIABLE_BINDINGS does not materialize stored junk', () => {
  // Found by the transition matrix, not by inspection. `setEdgeFlowType` nulls
  // the mapping when *leaving* VARIABLE_BINDINGS but kept whatever string was
  // present when *entering* it. A non-VB edge can hold an unreadable mapping
  // without violating anything - no rule reads mappings on such edges, and a
  // stale save can deliver one - so the retype was an applied command that
  // introduced `mapping-malformed` out of storage.
  it('drops an unreadable stored mapping on entry, with a warning', () => {
    const state = loaded();
    const edge = bindingsEdgeInto(state, IDS.queryNode);
    const withJunk: QueryGroupGraphState = {
      ...state,
      edges: state.edges.map(entry =>
        entry.id === edge.id ? { ...entry, flowType: 'CONTROL_FLOW' as const, sourceOutputId: null, targetInputId: null, variableMappings: 'stale junk from an old save' } : entry,
      ),
    };
    expect(checkInvariants(withJunk)).toEqual([]);

    const result = commands.setEdgeFlowType(withJunk, edge.id, 'VARIABLE_BINDINGS');

    expect(result.applied).toBe(true);
    expect(checkInvariants(result.state)).toEqual([]);
    expect(result.state.edges.find(entry => entry.id === edge.id)!.variableMappings).toBeNull();
    expect(result.diagnostics.map(issue => issue.code)).toContain('mapping-dropped');
  });

  it('keeps a readable stored mapping on entry', () => {
    const state = loaded();
    const edge = bindingsEdgeInto(state, IDS.queryNode);
    const mapping = JSON.stringify([{ source: 'city', target: 'city' }]);
    const withMapping: QueryGroupGraphState = {
      ...state,
      edges: state.edges.map(entry =>
        entry.id === edge.id ? { ...entry, flowType: 'CONTROL_FLOW' as const, sourceOutputId: null, targetInputId: null, variableMappings: mapping } : entry,
      ),
    };

    const result = commands.setEdgeFlowType(withMapping, edge.id, 'VARIABLE_BINDINGS');

    expect(result.applied).toBe(true);
    expect(result.state.edges.find(entry => entry.id === edge.id)!.variableMappings).toBe(mapping);
  });
});

describe('H2: reassigning a query version does not orphan an edge mapping', () => {
  // `reconcileEdgesForNode` re-resolved endpoint *ports* after an assignment
  // and never looked at `variableMappings`, so a mapping written against the
  // old interface survived onto ports that no longer have those variables.
  // Two commands, each of which claims to preserve the invariants, composing
  // into a violation.
  it('drops a mapping the new interface cannot honour, and says so', () => {
    const state = loaded();
    const edge = bindingsEdgeInto(state, IDS.queryNode);
    const model = ioModelOf(state);
    const sourceVars = variablesForPort(edge.sourceOutputId!, model)!;
    const targetVars = variablesForPort(edge.targetInputId!, model)!;

    const withMapping = commands.setEdgeVariableMappings(
      state,
      edge.id,
      JSON.stringify([{ source: sourceVars[0].variableName, target: targetVars[0].variableName }]),
    );
    expect(withMapping.applied).toBe(true);
    expect(checkInvariants(withMapping.state)).toEqual([]);

    // The other version's input tuple is `[region]`; the mapping targets `city`.
    const result = commands.assignQueryVersion(withMapping.state, edge.target, otherInterface());

    expect(result.applied).toBe(true);
    expect(checkInvariants(result.state)).toEqual([]);

    const after = result.state.edges.find(entry => entry.id === edge.id)!;
    expect(after.variableMappings).toBeNull();
    expect(result.diagnostics.map(issue => issue.code)).toContain('mapping-dropped');
  });

  it('keeps a mapping the new interface can still honour', () => {
    // Reassigning to the *same* interface must not destroy the author's work.
    const state = loaded();
    const edge = bindingsEdgeInto(state, IDS.queryNode);
    const model = ioModelOf(state);
    const sourceVars = variablesForPort(edge.sourceOutputId!, model)!;
    const targetVars = variablesForPort(edge.targetInputId!, model)!;
    const mapping = JSON.stringify([
      { source: sourceVars[0].variableName, target: targetVars[0].variableName },
    ]);

    const withMapping = commands.setEdgeVariableMappings(state, edge.id, mapping);
    const sameInterface = state.queryVersionInterfaces[IDS.selectVersion];
    const result = commands.assignQueryVersion(withMapping.state, edge.target, sameInterface);

    expect(result.applied).toBe(true);
    const after = result.state.edges.find(entry => entry.id === edge.id)!;
    expect(after.variableMappings).toBe(mapping);
  });
});

describe('H3: the canvas refuses cycles, as the backend does', () => {
  // `connectNodes` accepted both of these with zero diagnostics and zero
  // invariant violations. The backend rejects them with `GRAPH_CYCLE`
  // (Kahn's algorithm over every edge, regardless of flow type - so the
  // frontend check is over every edge too), which means the canvas would let
  // an author build a group that can never be executed and never say so.
  it('refuses a self-loop', () => {
    const state = loaded();

    const result = commands.connectNodes(state, {
      edgeId: 'urn:test:self',
      sourceId: IDS.queryNode,
      targetId: IDS.queryNode,
      flowType: 'VARIABLE_BINDINGS',
    });

    expect(result.applied).toBe(false);
    expect(codesOf(result.diagnostics)).toEqual(['graph-cycle']);
    expect(result.state).toBe(state);
  });

  it('refuses the edge that closes a two-node cycle', () => {
    let state = loaded();
    const forward = commands.connectNodes(state, {
      edgeId: 'urn:test:ab',
      sourceId: IDS.queryNode,
      targetId: IDS.secondQueryNode,
      flowType: 'VARIABLE_BINDINGS',
    });
    expect(forward.applied).toBe(true);
    state = forward.state;

    const back = commands.connectNodes(state, {
      edgeId: 'urn:test:ba',
      sourceId: IDS.secondQueryNode,
      targetId: IDS.queryNode,
      flowType: 'VARIABLE_BINDINGS',
    });

    expect(back.applied).toBe(false);
    expect(codesOf(back.diagnostics)).toEqual(['graph-cycle']);
  });

  it('refuses a cycle closed through a control flow edge', () => {
    // Flow type is irrelevant to reachability: the backend's topological sort
    // walks every edge.
    let state = loaded();
    state = commands.connectNodes(state, {
      edgeId: 'urn:test:ab-control',
      sourceId: IDS.queryNode,
      targetId: IDS.secondQueryNode,
      flowType: 'CONTROL_FLOW',
    }).state;

    const back = commands.connectNodes(state, {
      edgeId: 'urn:test:ba-bindings',
      sourceId: IDS.secondQueryNode,
      targetId: IDS.queryNode,
      flowType: 'VARIABLE_BINDINGS',
    });

    expect(back.applied).toBe(false);
    expect(codesOf(back.diagnostics)).toEqual(['graph-cycle']);
  });

  it('still allows a diamond, which is not a cycle', () => {
    // The check must reject cycles, not fan-in. A node reachable by two
    // distinct paths is ordinary and the phase 2 suite depends on it.
    let state = loaded();
    state = commands.connectNodes(state, {
      edgeId: 'urn:test:diamond-1',
      sourceId: IDS.startNode,
      targetId: IDS.secondQueryNode,
      flowType: 'VARIABLE_BINDINGS',
    }).state;

    const second = commands.connectNodes(state, {
      edgeId: 'urn:test:diamond-2',
      sourceId: IDS.secondQueryNode,
      targetId: IDS.endNode,
      flowType: 'VARIABLE_BINDINGS',
    });

    expect(second.applied).toBe(true);
    expect(checkInvariants(second.state)).toEqual([]);
  });

  it('reports a cycle that arrived from outside as an invariant violation', () => {
    // A group saved before the check existed, or written by another client,
    // still has to be describable. The invariant is what makes that visible.
    const state = loaded();
    const cyclic: QueryGroupGraphState = {
      ...state,
      edges: [
        ...state.edges,
        { id: 'urn:test:x', source: IDS.queryNode, target: IDS.secondQueryNode, flowType: 'CONTROL_FLOW' },
        { id: 'urn:test:y', source: IDS.secondQueryNode, target: IDS.queryNode, flowType: 'CONTROL_FLOW' },
      ],
    };

    expect(checkInvariants(cyclic).map(violation => violation.code)).toContain('graph-cycle');
  });
});

describe('H4: a ready resolution names the version the node actually holds', () => {
  // Invariant 3 keyed its interface lookup on `node.queryVersionId ?? queryId`
  // and ignored `resolution.versionId` entirely, so the two could disagree
  // with nothing to see it. `assignQueryVersion` keeps them in lockstep; this
  // command could split them.
  it('refuses a ready resolution for a version the node does not reference', () => {
    const state = loaded();

    const result = commands.setNodeQueryVersionResolution(state, IDS.queryNode, {
      status: 'ready',
      versionId: 'urn:sqlib:query-version:not-the-one',
    });

    expect(result.applied).toBe(false);
    expect(codesOf(result.diagnostics)).toEqual(['resolution-version-mismatch']);
    expect(result.state).toBe(state);
  });

  it('refuses a ready resolution whose interface was never registered', () => {
    const state = loaded();
    const withoutInterfaces: QueryGroupGraphState = { ...state, queryVersionInterfaces: {} };

    const result = commands.setNodeQueryVersionResolution(withoutInterfaces, IDS.queryNode, {
      status: 'ready',
      versionId: IDS.selectVersion,
    });

    expect(result.applied).toBe(false);
    expect(codesOf(result.diagnostics)).toEqual(['resolution-interface-missing']);
  });

  it('accepts the ready resolution the node does reference', () => {
    const state = loaded();

    const result = commands.setNodeQueryVersionResolution(state, IDS.queryNode, {
      status: 'ready',
      versionId: IDS.selectVersion,
    });

    expect(result.applied).toBe(true);
    expect(checkInvariants(result.state)).toEqual([]);
  });

  it.each([
    ['loading', { status: 'loading' as const }],
    ['unloaded', { status: 'unloaded' as const }],
    ['error', { status: 'error' as const, message: 'nope' }],
  ])('accepts %s regardless of what the node references', (_label, resolution) => {
    // The in-flight statuses are exactly the ones the app sets while the node's
    // query reference and its interface legitimately disagree
    // (`useQueryGroupExecution` sets `loading` after pointing the node at a new
    // version but before the fetch returns). Only `ready` claims coherence.
    const state = loaded();

    const result = commands.setNodeQueryVersionResolution(state, IDS.queryNode, resolution);

    expect(result.applied).toBe(true);
    expect(checkInvariants(result.state)).toEqual([]);
  });

  it('reports an incoherent ready state that arrived from outside', () => {
    const state = loaded();
    const desynced: QueryGroupGraphState = {
      ...state,
      nodes: state.nodes.map(node =>
        node.id === IDS.queryNode
          ? { ...node, queryVersionResolution: { status: 'ready' as const, versionId: 'urn:sqlib:other' } }
          : node,
      ),
    };

    expect(checkInvariants(desynced).map(violation => violation.code)).toContain('resolution-version-mismatch');
  });
});
