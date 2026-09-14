/**
 * The canvas cell space, and an oracle for it.
 *
 * A "cell" is the tuple of discriminators every rule in
 * `queryGroupCompatibility.ts` and `queryGroupInvariants.ts` actually reads
 * about one edge: the flow type, the kinds of the two nodes it joins, what
 * class of port each end is bound to, and what class of variable mapping it
 * carries. Everything else about a canvas state - ids, labels, positions,
 * query strings, how many other nodes there are - is invisible to those rules.
 * So the rules can be checked by enumerating this tuple rather than by
 * searching for states that happen to produce it.
 *
 * Two things make that honest rather than convenient:
 *
 * **Realizability is reported, not assumed.** Some cells cannot be built at
 * all - a `CONTROL_FLOW` edge has no legal port kinds, so "bound to a legal
 * port" does not exist for it. `realizeCell` returns `unrealizable` with a
 * reason instead of silently constructing something else, and the matrix
 * asserts the exact count of each. A cell quietly skipped is coverage that
 * shrank without saying so.
 *
 * **The oracle does not import the rules it judges.** `expectedViolations` and
 * `expectedEdgeIssues` re-state the documented rules in their own terms. An
 * oracle that called `checkEndpoint` would agree with every bug in it. This is
 * the same discipline `packages/api/test/phase2/harness/reference-interpreter.ts`
 * follows, for the same reason.
 */

import type {
  GraphEdgeState,
  GraphNodeKind,
  GraphNodeState,
  QueryGroupGraphState,
} from '../../../src/composables/useQueryGroupGraph';
import type {
  IoEntityKind,
  IoEntityRecord,
  TupleMemberRecord,
  VariableRecord,
} from '../../../src/composables/queryGroupIoModel';
import type { EdgeFlowType } from '../../../src/composables/queryGroupCompatibility';

/**
 * How an edge endpoint is bound.
 *
 * `foreign` is a port that exists, and has a typed entity behind it, but sits
 * on some other node - which is what makes it test `endpoint-not-on-node`
 * alone. An endpoint pointing at an id with no entity at all is a different
 * violation (`endpoint-unresolved`) and would confound the cell.
 */
export type EndpointClass = 'unbound' | 'legal' | 'wrongKind' | 'foreign';
export const ENDPOINT_CLASSES: readonly EndpointClass[] = ['unbound', 'legal', 'wrongKind', 'foreign'];

/** The classes of explicit variable mapping, one per code path in `parseVariableMappings`. */
export type MappingClass =
  | 'none'
  | 'validTotal'
  | 'validPartial'
  | 'unknownSource'
  | 'unknownTarget'
  | 'malformedNotJson'
  | 'malformedNotArray'
  | 'malformedEntry';
export const MAPPING_CLASSES: readonly MappingClass[] = [
  'none',
  'validTotal',
  'validPartial',
  'unknownSource',
  'unknownTarget',
  'malformedNotJson',
  'malformedNotArray',
  'malformedEntry',
];

const MALFORMED: Partial<Record<MappingClass, string>> = {
  malformedNotJson: 'not json at all',
  malformedNotArray: '{"source":"a","target":"x"}',
  malformedEntry: '[{"source":1,"target":2}]',
};

export const isMalformed = (mapping: MappingClass): boolean => mapping in MALFORMED;

export type Cell = {
  flowType: EdgeFlowType;
  sourceKind: GraphNodeKind;
  targetKind: GraphNodeKind;
  source: EndpointClass;
  target: EndpointClass;
  mapping: MappingClass;
};

export const describeCell = (cell: Cell): string =>
  `${cell.sourceKind}[${cell.source}] --${cell.flowType}(${cell.mapping})--> ${cell.targetKind}[${cell.target}]`;

// ---------------------------------------------------------------------------
// The rules, re-stated. Nothing below imports the implementation.
// ---------------------------------------------------------------------------

/**
 * Port kinds a source may offer, per flow type.
 *
 * The Start node is the documented exception: what it *saves* is the
 * group's input tuples, so its outputs are QueryInputTuple entities.
 */
function legalSourceKinds(flowType: EdgeFlowType, sourceKind: GraphNodeKind): IoEntityKind[] {
  switch (flowType) {
    case 'CONTROL_FLOW':
      return [];
    case 'RDF_GRAPH':
      return ['TriplesQuadsIO'];
    case 'BOOLEAN':
      return ['BooleanIO'];
    case 'QUERY_ID':
      // The Start node saves the caller's query choice as a group input.
      return sourceKind === 'start' ? ['QueryInputTuple'] : ['QueryOutputTuple'];
    case 'VARIABLE_BINDINGS':
      return sourceKind === 'start' ? ['QueryInputTuple'] : ['QueryOutputTuple'];
  }
}

/** Port kinds a target may offer. The End node consumes the group's results. */
function legalTargetKinds(flowType: EdgeFlowType, targetKind: GraphNodeKind): IoEntityKind[] {
  switch (flowType) {
    case 'CONTROL_FLOW':
      return [];
    case 'RDF_GRAPH':
      return ['TriplesQuadsIO'];
    case 'BOOLEAN':
      return ['BooleanIO'];
    case 'QUERY_ID':
      return ['QueryIdInput'];
    case 'VARIABLE_BINDINGS':
      return targetKind === 'end' ? ['QueryOutputTuple'] : ['QueryInputTuple'];
  }
}

/** An edge into the End node aliases its source port rather than owning one. */
const isPassThrough = (flowType: EdgeFlowType, targetKind: GraphNodeKind): boolean =>
  flowType !== 'CONTROL_FLOW' && targetKind === 'end';

// ---------------------------------------------------------------------------
// Realization
// ---------------------------------------------------------------------------

/**
 * Entity kinds a constructed node carries a port of.
 *
 * `ControlFlowIO` is excluded: those ids are synthetic runtime anchors that
 * `isControlFlowAnchor` deliberately exempts from entity resolution, so putting
 * one here would test the exemption rather than the rule. `Unknown` is
 * excluded because it is the marker for a reference with nothing behind it -
 * also a different concern.
 */
const PORTABLE_KINDS: IoEntityKind[] = [
  'QueryInputTuple',
  'QueryOutputTuple',
  'TriplesQuadsIO',
  'BooleanIO',
  'QueryIdInput',
];

const SOURCE_NODE = 'urn:cell:node:source';
const TARGET_NODE = 'urn:cell:node:target';
const OTHER_NODE = 'urn:cell:node:other';

const portId = (nodeId: string, kind: IoEntityKind) => `${nodeId}:port:${kind}`;

/** Variable names per node, chosen so source and target names never coincide. */
const VAR_NAMES: Record<string, string[]> = {
  [SOURCE_NODE]: ['srcA', 'srcB'],
  [TARGET_NODE]: ['tgtA', 'tgtB'],
  [OTHER_NODE]: ['othA', 'othB'],
};

type Built = {
  entities: Record<string, IoEntityRecord>;
  members: Record<string, TupleMemberRecord>;
  variables: Record<string, VariableRecord>;
};

/** One port of every portable kind, with tuples fully described down to variables. */
function buildPorts(nodeId: string, into: Built): { inputs: GraphNodeState['inputs']; outputs: GraphNodeState['outputs'] } {
  const ports = PORTABLE_KINDS.map(kind => {
    const id = portId(nodeId, kind);
    const isTuple = kind === 'QueryInputTuple' || kind === 'QueryOutputTuple';
    // A tuple's variables take their direction from the tuple's kind, not from
    // which array the port sits in - invariant 2 keys off the entity.
    const direction: 'input' | 'output' = kind === 'QueryInputTuple' ? 'input' : 'output';
    const memberEntries = isTuple
      ? VAR_NAMES[nodeId].map((_, index) => `${id}:member:${index}`)
      : undefined;

    if (isTuple) {
      VAR_NAMES[nodeId].forEach((name, index) => {
        const memberId = `${id}:member:${index}`;
        const variableId = `${id}:var:${index}`;
        into.members[memberId] = { id: memberId, position: index, variable: variableId };
        into.variables[variableId] = { id: variableId, variableName: name, direction };
      });
    }

    into.entities[id] = { id, kind, name: kind, memberEntries: memberEntries ?? null, origin: 'query-version' };
    return { id, label: kind, entityType: kind, direction: 'input' as const, origin: 'query-version' as const, resolved: true };
  });

  return {
    inputs: ports.map(port => ({ ...port, direction: 'input' as const })),
    outputs: ports.map(port => ({ ...port, direction: 'output' as const })),
  };
}

function buildNode(id: string, kind: GraphNodeKind, into: Built): GraphNodeState {
  const { inputs, outputs } = buildPorts(id, into);
  return {
    id,
    kind,
    label: `${kind} ${id}`,
    inputs,
    outputs,
    /*
     * A patch node's RDF output is one of its two named halves, and only a node
     * that says which is which can be asked "which half does this edge carry".
     * The constructor mints one port per kind, so the single `TriplesQuadsIO`
     * stands as the deletions half; the additions half is deliberately left
     * unset, which is what makes `legal` the only source class that names a
     * half and every other class one that does not.
     */
    ...(kind === 'patch' ? { deletionsOutputId: portId(id, 'TriplesQuadsIO') } : {}),
    // Left unresolved on purpose: a `ready` resolution pulls invariant 3 into
    // the cell, and the resolution status is a node dimension, tested
    // separately in the node matrix.
    queryVersionResolution: { status: 'unloaded' },
  };
}

/** The port id an endpoint class names, or `null` for unbound / unrealizable. */
function endpointFor(
  klass: EndpointClass,
  nodeId: string,
  legal: IoEntityKind[],
): { ok: true; id: string | null } | { ok: false; reason: string } {
  switch (klass) {
    case 'unbound':
      return { ok: true, id: null };
    case 'legal': {
      if (legal.length === 0) {
        return { ok: false, reason: 'no port kind is legal for this flow type, so a legal binding does not exist' };
      }
      return { ok: true, id: portId(nodeId, legal[0]) };
    }
    case 'wrongKind': {
      const wrong = PORTABLE_KINDS.find(kind => !legal.includes(kind));
      if (!wrong) return { ok: false, reason: 'every portable kind is legal here, so a wrong-kind binding does not exist' };
      return { ok: true, id: portId(nodeId, wrong) };
    }
    case 'foreign':
      // A real, resolvable port - on a third node.
      return { ok: true, id: portId(OTHER_NODE, 'QueryOutputTuple') };
  }
}

function mappingJson(cell: Cell): string | null {
  if (cell.mapping === 'none') return null;
  const malformed = MALFORMED[cell.mapping];
  if (malformed !== undefined) return malformed;

  const source = VAR_NAMES[SOURCE_NODE];
  const target = VAR_NAMES[TARGET_NODE];
  switch (cell.mapping) {
    case 'validTotal':
      return JSON.stringify(source.map((name, index) => ({ source: name, target: target[index] })));
    case 'validPartial':
      return JSON.stringify([{ source: source[0], target: target[0] }]);
    case 'unknownSource':
      return JSON.stringify([{ source: 'nosuchvar', target: target[0] }]);
    case 'unknownTarget':
      return JSON.stringify([{ source: source[0], target: 'nosuchvar' }]);
    default:
      return null;
  }
}

export type Realization =
  | { status: 'realized'; state: QueryGroupGraphState; edgeId: string }
  | { status: 'unrealizable'; reason: string };

export const EDGE_ID = 'urn:cell:edge';

export function realizeCell(cell: Cell): Realization {
  const into: Built = { entities: {}, members: {}, variables: {} };

  const sourceNode = buildNode(SOURCE_NODE, cell.sourceKind, into);
  const targetNode = buildNode(TARGET_NODE, cell.targetKind, into);
  const otherNode = buildNode(OTHER_NODE, 'query', into);

  const source = endpointFor(cell.source, SOURCE_NODE, legalSourceKinds(cell.flowType, cell.sourceKind));
  if (!source.ok) return { status: 'unrealizable', reason: `source: ${source.reason}` };

  // The End alias is not a free dimension: the target follows the source, so
  // any target class other than the alias itself is unrealizable there.
  let targetId: string | null;
  if (isPassThrough(cell.flowType, cell.targetKind)) {
    if (cell.target !== 'legal') {
      return {
        status: 'unrealizable',
        reason: 'an edge into the End node aliases its source port, so its target is not independently bindable',
      };
    }
    targetId = source.id;
  } else {
    const target = endpointFor(cell.target, TARGET_NODE, legalTargetKinds(cell.flowType, cell.targetKind));
    if (!target.ok) return { status: 'unrealizable', reason: `target: ${target.reason}` };
    targetId = target.id;
  }

  const edge: GraphEdgeState = {
    id: EDGE_ID,
    source: SOURCE_NODE,
    target: TARGET_NODE,
    flowType: cell.flowType,
    sourceOutputId: source.id,
    targetInputId: targetId,
    variableMappings: mappingJson(cell),
    whenEmpty: null,
  };

  return {
    status: 'realized',
    edgeId: EDGE_ID,
    state: {
      version: { id: 'urn:cell:version' } as QueryGroupGraphState['version'],
      // `otherNode` is on the canvas so that a `foreign` endpoint names a port
      // that genuinely exists somewhere - the violation under test is "not on
      // *this* node", not "nowhere at all".
      nodes: [sourceNode, targetNode, otherNode],
      edges: [edge],
      ioEntities: into.entities,
      tupleMembers: into.members,
      variables: into.variables,
      queryVersionInterfaces: {},
      iriMap: {},
    },
  };
}

// ---------------------------------------------------------------------------
// The oracle
// ---------------------------------------------------------------------------

/**
 * The variable names visible through an endpoint, or `null` when there is
 * nothing to check a mapping against (no port bound, or a non-tuple port).
 *
 * For `VARIABLE_BINDINGS` every bindable class lands on a tuple: the legal
 * kinds are tuples, the first portable non-legal kind is the *other* tuple
 * kind, and `foreign` is the other node's output tuple. The names differ per
 * node by construction, which is what lets membership decide everything.
 */
function endpointVarNames(
  klass: EndpointClass,
  flowType: EdgeFlowType,
  kind: GraphNodeKind,
  side: 'source' | 'target',
  nodeId: string,
): string[] | null {
  if (klass === 'unbound') return null;
  if (klass === 'foreign') return VAR_NAMES[OTHER_NODE];
  const legal = side === 'source' ? legalSourceKinds(flowType, kind) : legalTargetKinds(flowType, kind);
  const bound = klass === 'legal' ? legal[0] : PORTABLE_KINDS.find(entry => !legal.includes(entry));
  const isTuple = bound === 'QueryInputTuple' || bound === 'QueryOutputTuple';
  return isTuple ? VAR_NAMES[nodeId] : null;
}

/** The entries a mapping class writes, in the JSON `mappingJson` produces. */
function mappingEntries(mapping: MappingClass): { source: string; target: string }[] {
  const source = VAR_NAMES[SOURCE_NODE];
  const target = VAR_NAMES[TARGET_NODE];
  switch (mapping) {
    case 'validTotal':
      return source.map((name, index) => ({ source: name, target: target[index] }));
    case 'validPartial':
      return [{ source: source[0], target: target[0] }];
    case 'unknownSource':
      return [{ source: 'nosuchvar', target: target[0] }];
    case 'unknownTarget':
      return [{ source: source[0], target: 'nosuchvar' }];
    default:
      return [];
  }
}

/**
 * Invariant codes `checkInvariants` should report about this cell's edge, sorted.
 *
 * Order of reasoning follows the documented rules, not the implementation's
 * control flow, so a reordering in the implementation cannot make this agree by
 * accident.
 */
export function expectedViolations(cell: Cell): string[] {
  const codes: string[] = [];
  const passThrough = isPassThrough(cell.flowType, cell.targetKind);

  // Endpoint legality, per bound end.
  const endpointCodes = (klass: EndpointClass, side: 'source' | 'target', kind: GraphNodeKind): string[] => {
    if (klass === 'unbound') return [];
    if (cell.flowType === 'CONTROL_FLOW') return ['control-flow-has-endpoint'];
    // The alias: an End target legitimately names a port of the *source*.
    if (side === 'target' && passThrough) return [];
    if (klass === 'foreign') return ['endpoint-not-on-node'];
    if (klass === 'wrongKind') return ['endpoint-kind-mismatch'];
    return [];
  };

  codes.push(...endpointCodes(cell.source, 'source', cell.sourceKind));
  codes.push(...endpointCodes(cell.target, 'target', cell.targetKind));

  // Node-kind rules.
  if (cell.sourceKind === 'end') codes.push('end-node-source');
  if (cell.targetKind === 'start') codes.push('start-node-target');
  if (cell.flowType === 'QUERY_ID' && cell.targetKind !== 'dynamic') codes.push('target-node-kind');
  if (
    (cell.sourceKind === 'ruleset' || cell.targetKind === 'ruleset') &&
    cell.flowType !== 'RDF_GRAPH' &&
    cell.flowType !== 'CONTROL_FLOW'
  ) {
    codes.push('ruleset-requires-rdf');
  }
  // What leaves a patch node is half a patch: RDF, or an ordering edge that
  // carries nothing (the backend's NODE_PATCH_OUTBOUND_FLOW_TYPE, restated).
  if (cell.sourceKind === 'patch' && cell.flowType !== 'RDF_GRAPH' && cell.flowType !== 'CONTROL_FLOW') {
    codes.push('patch-outbound-flow-type');
  }
  // Only a ruleset or the End node can read an RDF graph (the backend's
  // EDGE_RDF_GRAPH_TARGET_CANNOT_CONSUME, restated). A patch node is on the
  // list of nodes that cannot: it reads its store over SPARQL, and nothing
  // materializes a graph into it.
  if (
    cell.flowType === 'RDF_GRAPH' &&
    (cell.targetKind === 'query' || cell.targetKind === 'dynamic' || cell.targetKind === 'patch')
  ) {
    codes.push('rdf-graph-target-cannot-consume');
  }

  // A Control Flow edge orders execution and carries no data.
  if (cell.flowType === 'CONTROL_FLOW' && (cell.source !== 'unbound' || cell.target !== 'unbound')) {
    codes.push('control-flow-endpoint');
  }

  // The alias has to actually alias. Realization always makes it so, so this
  // can only fire if the constructor is wrong - which is worth knowing.
  if (passThrough && cell.source !== 'unbound' && cell.target === 'unbound') {
    codes.push('end-node-alias');
  }

  // Only unreadable mappings are invariants; unknown variable names are
  // reachable authoring states and are reported by `validateEdge` instead.
  if (cell.flowType === 'VARIABLE_BINDINGS' && isMalformed(cell.mapping)) {
    codes.push('mapping-malformed');
  }

  return codes.sort();
}

/**
 * Error-level codes `validateEdge` should report, sorted.
 *
 * Differs from the invariant set in exactly one way: a mapping naming
 * variables that do not exist is an error to the author here, while not being
 * a violation of the state's integrity.
 */
export function expectedEdgeErrors(cell: Cell): string[] {
  const codes = expectedViolations(cell).filter(
    // `control-flow-endpoint` and `end-node-alias` are whole-state invariants,
    // not per-edge validation; `validateEdge` does not report them.
    code => code !== 'control-flow-endpoint' && code !== 'end-node-alias',
  );

  /*
   * An RDF edge off a patch node has to name which half it carries, and only
   * `legal` names one: the constructor makes the node's `TriplesQuadsIO` port
   * its deletions half. Asked only of a source that is otherwise fine, so a
   * foreign or wrong-kind port is reported once, as the endpoint mistake it is.
   */
  if (cell.sourceKind === 'patch' && cell.flowType === 'RDF_GRAPH' && cell.source === 'unbound') {
    codes.push('patch-source-port-unnamed');
  }

  if (cell.flowType !== 'VARIABLE_BINDINGS' || isMalformed(cell.mapping) || cell.mapping === 'none') {
    return codes.sort();
  }

  // A mapping entry may only name variables the bound tuples have; an unbound
  // end has nothing to contradict. One diagnostic *per offending entry*, not
  // per side - each one names the variable the author has to fix. Under the
  // End alias the target resolves through the source's port, so the mapping's
  // target names are checked against the *source* tuple's variables.
  const passThrough = isPassThrough(cell.flowType, cell.targetKind);
  const sourceNames = endpointVarNames(cell.source, cell.flowType, cell.sourceKind, 'source', SOURCE_NODE);
  const targetNames = passThrough
    ? sourceNames
    : endpointVarNames(cell.target, cell.flowType, cell.targetKind, 'target', TARGET_NODE);

  for (const entry of mappingEntries(cell.mapping)) {
    if (sourceNames && !sourceNames.includes(entry.source)) codes.push('mapping-unknown-source');
    if (targetNames && !targetNames.includes(entry.target)) codes.push('mapping-unknown-target');
  }

  return codes.sort();
}

// ---------------------------------------------------------------------------
// Command instances, for the transition matrix
// ---------------------------------------------------------------------------

import type { QueryVersionInterface } from '../../../src/composables/queryGroupIoModel';
import type { CommandResult } from '../../../src/composables/queryGroupCommands';
import * as commands from '../../../src/composables/queryGroupCommands';
import { CANVAS_TEMPLATES } from '../../../src/composables/canvasTemplates';

/** A hand-built interface, complete with the model entities its ports need. */
function interfaceNamed(versionId: string, varName: string): QueryVersionInterface {
  const inputTuple = `${versionId}:in`;
  const outputTuple = `${versionId}:out`;
  const record = (id: string, kind: IoEntityKind, member: string): IoEntityRecord => ({
    id,
    kind,
    memberEntries: [member],
    origin: 'query-version',
  });
  return {
    versionId,
    queryType: 'https://sparql-query-lib/query-type/select',
    queryString: `SELECT ?${varName} WHERE {}`,
    inputPortIds: [inputTuple],
    outputPortIds: [outputTuple],
    model: {
      entities: {
        [inputTuple]: record(inputTuple, 'QueryInputTuple', `${inputTuple}:m`),
        [outputTuple]: record(outputTuple, 'QueryOutputTuple', `${outputTuple}:m`),
      },
      members: {
        [`${inputTuple}:m`]: { id: `${inputTuple}:m`, position: 0, variable: `${inputTuple}:v` },
        [`${outputTuple}:m`]: { id: `${outputTuple}:m`, position: 0, variable: `${outputTuple}:v` },
      },
      variables: {
        [`${inputTuple}:v`]: { id: `${inputTuple}:v`, variableName: varName, direction: 'input' },
        [`${outputTuple}:v`]: { id: `${outputTuple}:v`, variableName: varName, direction: 'output' },
      },
    },
  };
}

export const INTERFACE_A = interfaceNamed('urn:cell:iface-a', 'alpha');
export const INTERFACE_B = interfaceNamed('urn:cell:iface-b', 'beta');

export type CommandInstance = {
  /** The exported command this instance drives, by name. */
  command: keyof typeof commands;
  label: string;
  run: (state: QueryGroupGraphState) => CommandResult;
};

/**
 * Every command instance applicable to a canvas state, enumerated from the
 * state's own vocabulary: its nodes, its edges, each node's ports, one port
 * that exists on a *different* node, and one that exists nowhere. Works for
 * any state, not only realized cells - the pair matrix drives it over the
 * shared-entity fixture. The transition matrix asserts that this list mentions
 * every command the module exports, so a new command cannot ship without
 * joining the enumeration.
 */
export function commandInstances(state: QueryGroupGraphState): CommandInstance[] {
  const instances: CommandInstance[] = [];
  const nodeIds = state.nodes.map(node => node.id);
  const flowTypes: EdgeFlowType[] = ['CONTROL_FLOW', 'VARIABLE_BINDINGS', 'RDF_GRAPH', 'BOOLEAN', 'QUERY_ID'];

  /** A real port belonging to any node other than the named one. */
  const foreignPortFor = (nodeId: string): string | null => {
    for (const node of state.nodes) {
      if (node.id === nodeId) continue;
      const port = node.outputs[0] ?? node.inputs[0];
      if (port) return port.id;
    }
    return null;
  };

  for (const nodeId of nodeIds) {
    for (const iface of [INTERFACE_A, INTERFACE_B]) {
      instances.push({
        command: 'assignQueryVersion',
        label: `assign ${iface.versionId} to ${nodeId}`,
        run: current => commands.assignQueryVersion(current, nodeId, iface),
      });
    }

    const node = state.nodes.find(entry => entry.id === nodeId)!;
    const referenced = node.queryVersionId ?? node.queryId ?? null;
    const resolutions = [
      { label: 'unloaded', value: { status: 'unloaded' as const } },
      { label: 'loading', value: { status: 'loading' as const } },
      { label: 'error', value: { status: 'error' as const, message: 'failed' } },
      { label: 'ready-referenced', value: { status: 'ready' as const, versionId: referenced ?? 'urn:cell:none' } },
      { label: 'ready-elsewhere', value: { status: 'ready' as const, versionId: 'urn:cell:unrelated' } },
    ];
    for (const resolution of resolutions) {
      instances.push({
        command: 'setNodeQueryVersionResolution',
        label: `resolve ${nodeId} ${resolution.label}`,
        run: current => commands.setNodeQueryVersionResolution(current, nodeId, resolution.value),
      });
    }

    instances.push({
      command: 'deleteNode',
      label: `delete ${nodeId}`,
      run: current => commands.deleteNode(current, nodeId),
    });
    instances.push({
      command: 'reconcileEdgesForNode',
      label: `reconcile ${nodeId}`,
      run: current => commands.reconcileEdgesForNode(current, nodeId),
    });
  }

  // `addStep` mints its own target, so the axis is the source alone. The second
  // instance per source aims the new node at an id the state already holds:
  // adding a step must refuse that rather than replace the node standing there.
  let stepCounter = 0;
  for (const sourceId of nodeIds) {
    const suffix = stepCounter++;
    instances.push({
      command: 'addStep',
      label: `add step after ${sourceId}`,
      run: current =>
        commands.addStep(current, {
          sourceId,
          nodeId: `urn:cell:new-step:${suffix}`,
          edgeId: `urn:cell:new-step-edge:${suffix}`,
          label: 'Query Node',
        }),
    });
    instances.push({
      command: 'addStep',
      label: `add step after ${sourceId} onto an id already taken`,
      run: current =>
        commands.addStep(current, {
          sourceId,
          nodeId: nodeIds[0],
          edgeId: `urn:cell:new-step-edge:taken-${suffix}`,
          label: 'Query Node',
        }),
    });
  }

  /*
   * Every catalogue template, twice: once with ids of its own, and once with
   * one id the state already holds.
   *
   * Both refuse on every realized cell, and that is the coverage they are here
   * for rather than a gap. `realizeCell` always puts `otherNode` on the canvas
   * so a `foreign` endpoint has somewhere to point, so no cell is ever empty of
   * execution nodes, and `template-canvas-not-empty` is the answer everywhere -
   * which the matrix then checks is a *clean* refusal: same state object, an
   * error diagnostic saying why. The applied path has no cell to live in, so it
   * is covered in `canvasTemplates.test.ts`, which runs this same instance list
   * against the shape each template builds.
   */
  for (const template of CANVAS_TEMPLATES) {
    instances.push({
      command: 'applyTemplate',
      label: `apply template ${template.id}`,
      run: current =>
        commands.applyTemplate(current, {
          template,
          nodeIds: template.steps.map((_, index) => `urn:cell:template:${template.id}:node-${index}`),
          edgeIds: template.edges.map((_, index) => `urn:cell:template:${template.id}:edge-${index}`),
        }),
    });
    instances.push({
      command: 'applyTemplate',
      label: `apply template ${template.id} onto an id already taken`,
      run: current =>
        commands.applyTemplate(current, {
          template,
          nodeIds: template.steps.map((_, index) => (index === 0 ? nodeIds[0] : `urn:cell:template:${template.id}:taken-${index}`)),
          edgeIds: template.edges.map((_, index) => `urn:cell:template:${template.id}:taken-edge-${index}`),
        }),
    });
  }

  let connectCounter = 0;
  for (const sourceId of nodeIds) {
    for (const targetId of nodeIds) {
      for (const flowType of flowTypes) {
        const edgeId = `urn:cell:new-edge:${connectCounter++}`;
        instances.push({
          command: 'connectNodes',
          label: `connect ${sourceId} --${flowType}--> ${targetId}`,
          run: current => commands.connectNodes(current, { edgeId, sourceId, targetId, flowType }),
        });
      }
    }
  }

  for (const edge of state.edges) {
    for (const flowType of flowTypes) {
      instances.push({
        command: 'setEdgeFlowType',
        label: `retype ${edge.id} ${flowType}`,
        run: current => commands.setEdgeFlowType(current, edge.id, flowType),
      });
    }

    const edgeSource = state.nodes.find(node => node.id === edge.source)!;
    const edgeTarget = state.nodes.find(node => node.id === edge.target)!;
    const bindCandidates = (node: GraphNodeState, direction: 'source' | 'target') => [
      ...(direction === 'source' ? node.outputs : node.inputs).map(port => port.id),
      ...(foreignPortFor(node.id) ? [foreignPortFor(node.id)!] : []),
      'urn:cell:no-such-port',
    ];
    for (const id of bindCandidates(edgeSource, 'source')) {
      instances.push({
        command: 'bindEdgeSource',
        label: `bind ${edge.id} source ${id}`,
        run: current => commands.bindEdgeSource(current, edge.id, id),
      });
    }
    for (const id of bindCandidates(edgeTarget, 'target')) {
      instances.push({
        command: 'bindEdgeTarget',
        label: `bind ${edge.id} target ${id}`,
        run: current => commands.bindEdgeTarget(current, edge.id, id),
      });
    }
    instances.push({
      command: 'clearEdgeSource',
      label: `clear ${edge.id} source`,
      run: current => commands.clearEdgeSource(current, edge.id),
    });
    instances.push({
      command: 'clearEdgeTarget',
      label: `clear ${edge.id} target`,
      run: current => commands.clearEdgeTarget(current, edge.id),
    });

    for (const mapping of MAPPING_CLASSES) {
      const raw = mapping === 'none' ? null : (MALFORMED[mapping] ?? JSON.stringify(mappingEntries(mapping)));
      instances.push({
        command: 'setEdgeVariableMappings',
        label: `set ${edge.id} mapping ${mapping}`,
        run: current => commands.setEdgeVariableMappings(current, edge.id, raw),
      });
    }

    instances.push({
      command: 'deleteEdge',
      label: `delete ${edge.id}`,
      run: current => commands.deleteEdge(current, edge.id),
    });
  }

  return instances;
}

// ---------------------------------------------------------------------------
// The node cell space
// ---------------------------------------------------------------------------

/**
 * The discriminators invariant 3 reads about one node: how far along its
 * query-version resolution claims to be, whether the interface it would need
 * is registered, and whether the node actually exposes that interface's
 * canonical ports. Only `ready` makes claims, so the other statuses exist in
 * the matrix to prove they assert nothing.
 */
export type NodeCell = {
  kind: GraphNodeKind;
  status: 'unloaded' | 'loading' | 'ready' | 'error';
  /** Whether `resolution.versionId` matches the node's reference (ready only). */
  versionMatches: boolean;
  interfaceRegistered: boolean;
  canonicalPortsPresent: boolean;
};

export const NODE_VERSION_ID = 'urn:cell:query-version';
const NODE_CANONICAL_INPUT = 'urn:cell:iface:input';
const NODE_CANONICAL_OUTPUT = 'urn:cell:iface:output';

export function realizeNodeCell(cell: NodeCell): { state: QueryGroupGraphState; nodeId: string } | null {
  // Start/End nodes never reference a query version; a resolution on one is
  // not constructible through any command and the load path never writes one.
  if ((cell.kind === 'start' || cell.kind === 'end') && cell.status !== 'unloaded') return null;
  // `versionMatches` only means something when `ready` claims a version.
  if (cell.status !== 'ready' && !cell.versionMatches) return null;

  const into: Built = { entities: {}, members: {}, variables: {} };
  const node = buildNode(SOURCE_NODE, cell.kind, into);

  const canonicalPorts = cell.canonicalPortsPresent
    ? {
        inputs: [
          ...node.inputs,
          { id: NODE_CANONICAL_INPUT, label: 'in', entityType: 'QueryInputTuple' as const, direction: 'input' as const, origin: 'query-version' as const, resolved: true },
        ],
        outputs: [
          ...node.outputs,
          { id: NODE_CANONICAL_OUTPUT, label: 'out', entityType: 'QueryOutputTuple' as const, direction: 'output' as const, origin: 'query-version' as const, resolved: true },
        ],
      }
    : { inputs: node.inputs, outputs: node.outputs };

  if (cell.canonicalPortsPresent) {
    into.entities[NODE_CANONICAL_INPUT] = { id: NODE_CANONICAL_INPUT, kind: 'QueryInputTuple', memberEntries: null, origin: 'query-version' };
    into.entities[NODE_CANONICAL_OUTPUT] = { id: NODE_CANONICAL_OUTPUT, kind: 'QueryOutputTuple', memberEntries: null, origin: 'query-version' };
  }

  const references = cell.kind === 'query' || cell.kind === 'dynamic';
  const resolution =
    cell.status === 'ready'
      ? { status: 'ready' as const, versionId: cell.versionMatches ? NODE_VERSION_ID : 'urn:cell:some-other-version' }
      : cell.status === 'error'
        ? { status: 'error' as const, message: 'failed' }
        : { status: cell.status };

  return {
    nodeId: SOURCE_NODE,
    state: {
      version: { id: 'urn:cell:version' } as QueryGroupGraphState['version'],
      nodes: [
        {
          ...node,
          ...canonicalPorts,
          queryVersionId: references ? NODE_VERSION_ID : null,
          queryVersionResolution: resolution,
        },
      ],
      edges: [],
      ioEntities: into.entities,
      tupleMembers: into.members,
      variables: into.variables,
      queryVersionInterfaces: cell.interfaceRegistered
        ? {
            [NODE_VERSION_ID]: {
              versionId: NODE_VERSION_ID,
              queryType: null,
              queryString: null,
              inputPortIds: [NODE_CANONICAL_INPUT],
              outputPortIds: [NODE_CANONICAL_OUTPUT],
              model: { entities: {}, members: {}, variables: {} },
            },
          }
        : {},
      iriMap: {},
    },
  };
}

/** Invariant codes for a node cell, from the rules as documented. */
export function expectedNodeViolations(cell: NodeCell): string[] {
  // Nothing below `ready` claims coherence.
  if (cell.status !== 'ready') return [];
  const references = cell.kind === 'query' || cell.kind === 'dynamic';
  // `ready` on a node that references nothing contradicts the reference itself.
  if (!references) return ['resolution-version-mismatch'];
  if (!cell.versionMatches) return ['resolution-version-mismatch'];
  if (!cell.interfaceRegistered) return ['query-version-missing'];
  if (!cell.canonicalPortsPresent) return ['canonical-input-missing', 'canonical-output-missing'];
  return [];
}

export function allNodeCells(nodeKinds: readonly GraphNodeKind[]): NodeCell[] {
  const cells: NodeCell[] = [];
  for (const kind of nodeKinds) {
    for (const status of ['unloaded', 'loading', 'ready', 'error'] as const) {
      for (const versionMatches of [true, false]) {
        for (const interfaceRegistered of [true, false]) {
          for (const canonicalPortsPresent of [true, false]) {
            cells.push({ kind, status, versionMatches, interfaceRegistered, canonicalPortsPresent });
          }
        }
      }
    }
  }
  return cells;
}

/** The full product. Conditioning is expressed by `realizeCell`, not by pruning. */
export function allCells(
  flowTypes: readonly EdgeFlowType[],
  nodeKinds: readonly GraphNodeKind[],
): Cell[] {
  const cells: Cell[] = [];
  for (const flowType of flowTypes) {
    for (const sourceKind of nodeKinds) {
      for (const targetKind of nodeKinds) {
        for (const source of ENDPOINT_CLASSES) {
          for (const target of ENDPOINT_CLASSES) {
            for (const mapping of MAPPING_CLASSES) {
              cells.push({ flowType, sourceKind, targetKind, source, target, mapping });
            }
          }
        }
      }
    }
  }
  return cells;
}
