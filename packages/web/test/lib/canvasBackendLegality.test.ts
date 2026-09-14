/**
 * The canvas connection rules, checked cell by cell against the backend's
 * verdicts.
 *
 * `packages/contracts/fixtures/query-group-edge-legality.json` is written and
 * proven by the API suite (`test/phase2/legality-artifact.test.ts` against the
 * oracle, `legality-matrix.test.ts` against the real GraphBuilder). This side
 * realizes each of its 160 cells as a canvas edge wired the same way - the
 * source contributes its natural port, the target the port the flow demands -
 * and asserts agreement in both directions:
 *
 * - A cell the backend REJECTS must not be silent on the canvas: an error
 *   from the connection rules, or at minimum the "no compatible port" signal
 *   that leaves the edge visibly unresolvable.
 * - A cell the backend ACCEPTS must not be refused: an over-strict canvas
 *   blocks authoring of graphs the engine runs happily.
 *
 * Divergences that survive are enumerated in DIVERGENCES with a reason each.
 * The test fails on any divergence not in the table and on any table entry
 * that stopped diverging - the list must shrink deliberately, not rot.
 */

import { describe, it, expect } from 'vitest';

import type { GraphNodeKind, GraphNodeState, GraphEdgeState } from '../../src/composables/useQueryGroupGraph';
import type { IoEntityKind } from '../../src/composables/queryGroupIoModel';
import {
  checkEndpoint,
  checkNodeKinds,
  isEndNodePassThrough,
  sourceCandidates,
  targetCandidates,
  type EdgeFlowType,
} from '../../src/composables/queryGroupCompatibility';
import legalityTable from '../../../contracts/fixtures/query-group-edge-legality.json';

type ArtifactCell = {
  source: string;
  flow: EdgeFlowType;
  target: string;
  code: string | null;
};

/** How the artifact's source kinds land on the canvas. */
const SOURCE_NODE_KIND: Record<string, GraphNodeKind> = {
  select: 'query',
  construct: 'query',
  describe: 'query',
  ask: 'query',
  update: 'query',
  dynamic: 'dynamic',
  ruleset: 'ruleset',
  start: 'start',
};

/**
 * The natural output port per source kind, in the canvas's own model - which
 * is why `start` differs from the artifact's backend-side table: the canvas
 * models what the Start node saves as the group's input tuples.
 */
const SOURCE_PORT_KIND: Record<string, IoEntityKind | null> = {
  select: 'QueryOutputTuple',
  construct: 'TriplesQuadsIO',
  describe: 'TriplesQuadsIO',
  ask: 'BooleanIO',
  update: null,
  dynamic: 'QueryOutputTuple',
  ruleset: 'TriplesQuadsIO',
  start: 'QueryInputTuple',
};

/** The input port the flow demands of a non-End target. */
const FLOW_TARGET_PORT_KIND: Record<Exclude<EdgeFlowType, 'CONTROL_FLOW'>, IoEntityKind> = {
  VARIABLE_BINDINGS: 'QueryInputTuple',
  RDF_GRAPH: 'TriplesQuadsIO',
  BOOLEAN: 'BooleanIO',
  QUERY_ID: 'QueryIdInput',
};

const node = (id: string, kind: GraphNodeKind, inputs: IoEntityKind[], outputs: IoEntityKind[]): GraphNodeState => ({
  id,
  kind,
  label: id,
  inputs: inputs.map(entityType => ({ id: `${id}:in:${entityType}`, label: entityType, entityType, direction: 'input' })),
  outputs: outputs.map(entityType => ({ id: `${id}:out:${entityType}`, label: entityType, entityType, direction: 'output' })),
});

/** The canvas verdict on one artifact cell. */
type Verdict = 'error' | 'unresolvable' | 'clean';

function canvasVerdict(cell: ArtifactCell): Verdict {
  const sourcePortKind = SOURCE_PORT_KIND[cell.source];
  const sourceNode = node('src', SOURCE_NODE_KIND[cell.source], [], sourcePortKind ? [sourcePortKind] : []);
  const targetKind = cell.target as GraphNodeKind & ('query' | 'dynamic' | 'ruleset' | 'end');
  const targetNode =
    targetKind === 'end'
      ? node('tgt', 'end', [], [])
      : node('tgt', targetKind, cell.flow === 'CONTROL_FLOW' ? [] : [FLOW_TARGET_PORT_KIND[cell.flow]], []);

  const errors = checkNodeKinds(cell.flow, sourceNode, targetNode).filter(issue => issue.level === 'error');

  if (cell.flow !== 'CONTROL_FLOW') {
    const sources = sourceCandidates(cell.flow, sourceNode);
    const passThrough = isEndNodePassThrough(cell.flow, targetNode);
    const targets = passThrough ? [] : targetCandidates(cell.flow, targetNode);

    // Wire the edge the way the backend matrix does; a side with no candidate
    // stays unbound, which the canvas shows as an unresolvable draft.
    const edge: Pick<GraphEdgeState, 'flowType' | 'sourceOutputId' | 'targetInputId'> = {
      flowType: cell.flow,
      sourceOutputId: sourceNode.outputs[0]?.id ?? null,
      targetInputId: passThrough ? (sourceNode.outputs[0]?.id ?? null) : (targetNode.inputs[0]?.id ?? null),
    };

    for (const [endpointNode, portId, direction] of [
      [sourceNode, edge.sourceOutputId, 'source'],
      [targetNode, edge.targetInputId, 'target'],
    ] as const) {
      const issue = checkEndpoint(cell.flow, endpointNode, portId, direction);
      if (issue?.level === 'error') errors.push(issue);
    }

    if (errors.length === 0 && (sources.length === 0 || (!passThrough && targets.length === 0))) {
      return 'unresolvable';
    }
  }

  return errors.length > 0 ? 'error' : 'clean';
}

/**
 * The divergences that remain, each with the reason it is tolerated. Keyed by
 * `source|flow|target`.
 */
const DIVERGENCES: Record<string, string> = {
  // GRAPH_NO_EXECUTABLE_NODE and END_NODE_NO_DATA_INPUT are whole-graph
  // verdicts - nothing about the *edge* is wrong, the graph around it is
  // degenerate. The canvas's local connection rules cannot see them; they
  // reach the author through `useCanvasValidation` when `/validate` runs.
  // (Only these two spellings of start->end stay locally silent: on the other
  // three flows the canvas already errors for its own port/kind reasons.)
  'start|CONTROL_FLOW|end': 'graph-level: nothing to execute; surfaced by /validate',
  'start|VARIABLE_BINDINGS|end': 'graph-level: nothing to execute; surfaced by /validate',
  'select|CONTROL_FLOW|end': 'graph-level: EndNode needs a data input; surfaced by /validate',
  'construct|CONTROL_FLOW|end': 'graph-level: EndNode needs a data input; surfaced by /validate',
  'describe|CONTROL_FLOW|end': 'graph-level: EndNode needs a data input; surfaced by /validate',
  'ask|CONTROL_FLOW|end': 'graph-level: EndNode needs a data input; surfaced by /validate',
  'update|CONTROL_FLOW|end': 'graph-level: EndNode needs a data input; surfaced by /validate',
  'dynamic|CONTROL_FLOW|end': 'graph-level: EndNode needs a data input; surfaced by /validate',
  'ruleset|CONTROL_FLOW|end': 'graph-level: EndNode needs a data input; surfaced by /validate',

  // The engine accepts an ASK result as a one-column binding source; the
  // canvas does not offer BooleanIO as a VARIABLE_BINDINGS source, so it
  // refuses what the backend runs. Stricter is the safe direction - it blocks
  // authoring, never an invalid save - and widening it needs the End-alias
  // target rules reworked alongside, so it is recorded rather than patched.
  'ask|VARIABLE_BINDINGS|query': 'canvas stricter: ASK-as-bindings not yet authorable',
  'ask|VARIABLE_BINDINGS|dynamic': 'canvas stricter: ASK-as-bindings not yet authorable',
};

describe('canvas rules vs the backend legality artifact', () => {
  const cells = legalityTable as ArtifactCell[];

  it('reads the artifact the API suite proved', () => {
    expect(cells.length).toBe(160);
  });

  it('agrees with every cell, minus the documented divergences', () => {
    const failures: string[] = [];
    const seenDivergences = new Set<string>();

    for (const cell of cells) {
      const key = `${cell.source}|${cell.flow}|${cell.target}`;
      const verdict = canvasVerdict(cell);
      const agrees = cell.code === null ? verdict === 'clean' : verdict !== 'clean';

      if (agrees) {
        if (DIVERGENCES[key]) failures.push(`${key}: listed as a divergence but agrees (${cell.code ?? 'legal'} / ${verdict}) - remove it`);
        continue;
      }
      if (DIVERGENCES[key]) {
        seenDivergences.add(key);
        continue;
      }
      failures.push(`${key}: backend says ${cell.code ?? 'legal'}, canvas says ${verdict}`);
    }

    expect(failures, `${failures.length} undocumented divergence(s):\n${failures.join('\n')}`).toEqual([]);
    expect([...seenDivergences].sort()).toEqual(Object.keys(DIVERGENCES).sort());
  });
});
