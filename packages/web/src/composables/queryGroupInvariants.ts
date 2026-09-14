/**
 * What must be true of a query-group graph after any command.
 *
 * These are the properties whose violation produced plausible-but-empty UI
 * rather than an error: a port with nothing behind it, an edge endpoint that is
 * not on its node, metadata one node deleted while another was still using it.
 * Checking them is cheap, so tests run this after every generated transition.
 */

import type { QueryGroupGraphState } from './useQueryGroupGraph';
import { ioModelOf } from './useQueryGroupGraph';
import { isControlFlowAnchor, variablesForPort } from './queryGroupIoModel';
import {
  checkEndpoint,
  checkNodeKinds,
  hasCycle,
  isEndNodePassThrough,
  validateVariableMappings,
} from './queryGroupCompatibility';

export type InvariantViolation = {
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
  entityId?: string;
};

const violation = (code: string, message: string, extra: Omit<InvariantViolation, 'code' | 'message'> = {}) => ({
  code,
  message,
  ...extra,
});

export function checkInvariants(state: QueryGroupGraphState): InvariantViolation[] {
  const violations: InvariantViolation[] = [];
  const model = ioModelOf(state);
  const nodesById = new Map(state.nodes.map(node => [node.id, node]));

  // 1. Every data port id resolves to a typed I/O entity.
  // 2. Every tuple member resolves to a variable of the expected kind.
  for (const node of state.nodes) {
    for (const port of [...node.inputs, ...node.outputs]) {
      if (isControlFlowAnchor(port.id)) continue;
      const entity = model.entities[port.id];
      if (!entity) {
        violations.push(
          violation('port-unresolved', `Port ${port.id} has no I/O entity.`, { nodeId: node.id, entityId: port.id }),
        );
        continue;
      }
      if (entity.kind !== port.entityType) {
        violations.push(
          violation(
            'port-kind-mismatch',
            `Port ${port.id} is typed ${port.entityType} but its entity is a ${entity.kind}.`,
            { nodeId: node.id, entityId: port.id },
          ),
        );
      }
      if (entity.kind === 'QueryInputTuple' || entity.kind === 'QueryOutputTuple') {
        const expected = entity.kind === 'QueryInputTuple' ? 'input' : 'output';
        for (const memberId of entity.memberEntries ?? []) {
          const member = model.members[memberId];
          if (!member) {
            violations.push(
              violation('member-unresolved', `Tuple ${entity.id} references unknown member ${memberId}.`, {
                entityId: entity.id,
              }),
            );
            continue;
          }
          const variable = model.variables[member.variable];
          if (!variable) {
            violations.push(
              violation('variable-unresolved', `Member ${memberId} references unknown variable ${member.variable}.`, {
                entityId: entity.id,
              }),
            );
          } else if (variable.direction !== expected) {
            violations.push(
              violation(
                'variable-direction',
                `Tuple ${entity.id} expects ${expected} variables but ${variable.id} is an ${variable.direction} variable.`,
                { entityId: entity.id },
              ),
            );
          }
        }
      }
    }
  }

  // 3. A ready query node exposes its query version's canonical ports.
  //
  // The resolution's own `versionId` is checked against the node's reference
  // first. Keying the interface lookup on the node's reference alone let the
  // two disagree with nothing to notice: a node could report itself ready for
  // one version while holding another, and the ports would be checked against
  // whichever the lookup happened to find.
  for (const node of state.nodes) {
    const resolution = node.queryVersionResolution;
    if (resolution?.status !== 'ready') continue;
    const versionId = node.queryVersionId ?? node.queryId ?? null;
    if (resolution.versionId !== versionId) {
      violations.push(
        violation(
          'resolution-version-mismatch',
          `Node ${node.id} is ready for ${resolution.versionId} but references ${versionId ?? 'no query version'}.`,
          { nodeId: node.id },
        ),
      );
      continue;
    }
    if (!versionId) continue;
    const iface = state.queryVersionInterfaces[versionId];
    if (!iface) {
      violations.push(
        violation('query-version-missing', `Node ${node.id} is ready but its query version is not described.`, {
          nodeId: node.id,
        }),
      );
      continue;
    }
    const inputIds = new Set(node.inputs.map(port => port.id));
    const outputIds = new Set(node.outputs.map(port => port.id));
    for (const id of iface.inputPortIds) {
      if (!inputIds.has(id)) {
        violations.push(
          violation('canonical-input-missing', `Node ${node.id} does not expose canonical input ${id}.`, {
            nodeId: node.id,
            entityId: id,
          }),
        );
      }
    }
    for (const id of iface.outputPortIds) {
      if (!outputIds.has(id)) {
        violations.push(
          violation('canonical-output-missing', `Node ${node.id} does not expose canonical output ${id}.`, {
            nodeId: node.id,
            entityId: id,
          }),
        );
      }
    }
  }

  for (const edge of state.edges) {
    const sourceNode = nodesById.get(edge.source);
    const targetNode = nodesById.get(edge.target);

    // 4. Every edge references existing source and target nodes.
    if (!sourceNode || !targetNode) {
      violations.push(
        violation('edge-dangling', `Edge ${edge.id} references a node that is not on the canvas.`, { edgeId: edge.id }),
      );
      continue;
    }

    // 5/6. Endpoints exist on their node, in the right direction, with a kind
    // the flow type accepts - except for the documented EndNode alias.
    for (const issue of [
      checkEndpoint(edge.flowType, sourceNode, edge.sourceOutputId, 'source'),
      checkEndpoint(edge.flowType, targetNode, edge.targetInputId, 'target'),
    ]) {
      if (issue) violations.push(violation(issue.code, issue.message, { edgeId: edge.id }));
    }

    for (const issue of checkNodeKinds(edge.flowType, sourceNode, targetNode)) {
      violations.push(violation(issue.code, issue.message, { edgeId: edge.id }));
    }

    // 8. Control Flow edges carry no data endpoints.
    if (edge.flowType === 'CONTROL_FLOW' && (edge.sourceOutputId || edge.targetInputId)) {
      violations.push(
        violation('control-flow-endpoint', `Control Flow edge ${edge.id} carries a data endpoint.`, { edgeId: edge.id }),
      );
    }

    // The EndNode alias has to actually alias: its target names the source port.
    if (isEndNodePassThrough(edge.flowType, targetNode) && edge.sourceOutputId && edge.targetInputId !== edge.sourceOutputId) {
      violations.push(
        violation('end-node-alias', `Edge ${edge.id} into the End node does not alias its source port.`, {
          edgeId: edge.id,
        }),
      );
    }

    // 7. An explicit mapping is at least readable.
    //
    // Only `mapping-malformed` is an invariant. A mapping naming variables that
    // do not exist used to be one too, and it should not have been: it is
    // reachable without any command misbehaving - reassign a node's query
    // version and yesterday's mapping stops matching - so promoting it to a
    // violation made a legitimate authoring state indistinguishable from a bug.
    // The commands now clear orphaned mappings where they can see the change
    // happen (`reconcileEdgesForNode`), and `validateEdge` reports the rest to
    // the author in the inspector. Arity differences stay warnings from the
    // same module.
    for (const issue of validateVariableMappings(edge, model)) {
      if (issue.level === 'error' && issue.code === 'mapping-malformed') {
        violations.push(violation(issue.code, issue.message, { edgeId: edge.id }));
      }
    }
  }

  // 10. The graph is acyclic, by the same method the executor uses. A cycle is
  // refused at `connectNodes`, so reaching one here means it arrived from a
  // save written before that check existed or by another client.
  if (hasCycle(state.nodes.map(node => node.id), state.edges)) {
    violations.push(violation('graph-cycle', 'The graph contains a cycle, so its nodes cannot be ordered for execution.'));
  }

  // 9. Nothing a node still references has been thrown away. Covered by the port
  // check above; this adds the tuples reachable only through an edge endpoint.
  for (const edge of state.edges) {
    for (const endpoint of [edge.sourceOutputId, edge.targetInputId]) {
      if (!endpoint || isControlFlowAnchor(endpoint)) continue;
      if (!model.entities[endpoint]) {
        violations.push(
          violation('endpoint-unresolved', `Edge ${edge.id} endpoint ${endpoint} has no I/O entity.`, {
            edgeId: edge.id,
            entityId: endpoint,
          }),
        );
      }
    }
  }

  // A tuple that claims members it cannot resolve is reported above; a tuple
  // with unknown members is legal and must not be confused with an empty one.
  for (const entity of Object.values(state.ioEntities)) {
    if (entity.kind !== 'QueryInputTuple' && entity.kind !== 'QueryOutputTuple') continue;
    if (entity.memberEntries == null) continue;
    if (variablesForPort(entity.id, model) === null) {
      violations.push(
        violation('tuple-partially-described', `Tuple ${entity.id} lists members that do not resolve.`, {
          entityId: entity.id,
        }),
      );
    }
  }

  return violations;
}

/** Throw on violation. For tests and development-mode assertions. */
export function assertInvariants(state: QueryGroupGraphState, context = 'graph state'): void {
  const violations = checkInvariants(state);
  if (violations.length === 0) return;
  throw new Error(
    `${violations.length} invariant violation(s) in ${context}:\n` +
      violations.map(v => `  [${v.code}] ${v.message}`).join('\n'),
  );
}
