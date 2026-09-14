/**
 * The predicate layer, enumerated.
 *
 * Every cell of the edge-discriminator space (see `harness/canvasCells.ts`) is
 * realized as a concrete canvas state and judged twice - by `checkInvariants`
 * and by `validateEdge` - against an oracle that re-states the documented
 * rules without importing them. One test per verdict rather than per cell:
 * ~10^4 `it()` blocks would drown the reporter, and a failing cell is named in
 * the assertion message with everything needed to reproduce it.
 *
 * The partition counts are pinned on purpose. If a domain grows (a new flow
 * type, node kind, endpoint class, mapping class), the counts change and this
 * fails - which is the moment to extend the oracle rather than discover years
 * later that the matrix quietly stopped covering the new member. That is the
 * same role the phase 2 fuzz tally plays on the API side.
 */

import { describe, it, expect } from 'vitest';

import { checkInvariants } from '../../src/composables/queryGroupInvariants';
import { ioModelOf, GRAPH_NODE_KINDS } from '../../src/composables/useQueryGroupGraph';
import { EDGE_FLOW_TYPES, validateEdge } from '../../src/composables/queryGroupCompatibility';
import {
  allCells,
  allNodeCells,
  describeCell,
  expectedEdgeErrors,
  expectedNodeViolations,
  expectedViolations,
  realizeCell,
  realizeNodeCell,
  type Cell,
} from './harness/canvasCells';

type Judged = {
  cell: Cell;
  actualViolations: string[];
  actualEdgeErrors: string[];
};

const cells = allCells(EDGE_FLOW_TYPES, GRAPH_NODE_KINDS);

const realized: Judged[] = [];
const unrealizable: { cell: Cell; reason: string }[] = [];

for (const cell of cells) {
  const realization = realizeCell(cell);
  if (realization.status === 'unrealizable') {
    unrealizable.push({ cell, reason: realization.reason });
    continue;
  }
  const { state } = realization;
  const model = ioModelOf(state);
  const edge = state.edges[0];
  const sourceNode = state.nodes.find(node => node.id === edge.source);
  const targetNode = state.nodes.find(node => node.id === edge.target);

  realized.push({
    cell,
    actualViolations: checkInvariants(state)
      .map(violation => violation.code)
      .sort(),
    actualEdgeErrors: validateEdge(edge, sourceNode, targetNode, model)
      .filter(issue => issue.level === 'error')
      .map(issue => issue.code)
      .sort(),
  });
}

describe('canvas cell matrix', () => {
  it('covers the full product, and the partition is exactly what it was', () => {
    // 5 flows x 36 kind pairs x 4 source classes x 4 target classes x 8
    // mapping classes. The realizable/unrealizable split is a consequence of
    // the rules (no legal port for CONTROL_FLOW, no wrong-kind port for
    // VARIABLE_BINDINGS sources, the End alias), so a change to either number
    // means the rules changed and the oracle needs to be re-derived.
    expect(cells.length).toBe(23040);
    expect(realized.length).toBe(18720);
    expect(unrealizable.length).toBe(cells.length - realized.length);
  });

  it('every unrealizable cell says why', () => {
    for (const entry of unrealizable) {
      expect(entry.reason, describeCell(entry.cell)).toBeTruthy();
    }
  });

  it('checkInvariants agrees with the oracle on every realized cell', () => {
    const disagreements = realized
      .filter(entry => {
        const expected = expectedViolations(entry.cell).join(',');
        return expected !== entry.actualViolations.join(',');
      })
      .map(
        entry =>
          `${describeCell(entry.cell)}\n  expected [${expectedViolations(entry.cell)}]\n  actual   [${entry.actualViolations}]`,
      );

    expect(disagreements, `${disagreements.length} disagreement(s):\n${disagreements.slice(0, 10).join('\n')}`).toEqual(
      [],
    );
  });

  it('validateEdge agrees with the oracle on every realized cell', () => {
    const disagreements = realized
      .filter(entry => {
        const expected = expectedEdgeErrors(entry.cell).join(',');
        return expected !== entry.actualEdgeErrors.join(',');
      })
      .map(
        entry =>
          `${describeCell(entry.cell)}\n  expected [${expectedEdgeErrors(entry.cell)}]\n  actual   [${entry.actualEdgeErrors}]`,
      );

    expect(disagreements, `${disagreements.length} disagreement(s):\n${disagreements.slice(0, 10).join('\n')}`).toEqual(
      [],
    );
  });

  it('checkInvariants agrees with the node-cell oracle', () => {
    // The node dimensions: resolution status x version coherence x interface
    // registration x canonical-port presence, per kind. Only `ready` claims
    // anything; the matrix proves the other statuses assert nothing, which is
    // what lets `useQueryGroupExecution` set `loading` while node reference
    // and interface legitimately disagree mid-fetch.
    const nodeCells = allNodeCells(GRAPH_NODE_KINDS);
    let realizedCount = 0;
    const disagreements: string[] = [];

    for (const cell of nodeCells) {
      const realization = realizeNodeCell(cell);
      if (!realization) continue;
      realizedCount++;

      const actual = checkInvariants(realization.state)
        .map(violation => violation.code)
        .sort();
      const expected = expectedNodeViolations(cell).sort();
      if (actual.join(',') !== expected.join(',')) {
        disagreements.push(`${JSON.stringify(cell)}\n  expected [${expected}]\n  actual   [${actual}]`);
      }
    }

    expect(nodeCells.length).toBe(192);
    expect(realizedCount).toBe(88);
    expect(disagreements, disagreements.slice(0, 5).join('\n')).toEqual([]);
  });

  it('the clean region is not empty, and is exactly the legal edges', () => {
    // A matrix whose every cell violates something is a matrix testing a
    // broken constructor. The clean cells must include the canonical shapes
    // the app actually builds.
    const clean = realized.filter(entry => entry.actualViolations.length === 0 && entry.actualEdgeErrors.length === 0);
    expect(clean.length).toBeGreaterThan(0);

    const cleanShapes = new Set(clean.map(entry => describeCell(entry.cell)));
    expect(cleanShapes.has('query[legal] --VARIABLE_BINDINGS(none)--> query[legal]')).toBe(true);
    expect(cleanShapes.has('start[legal] --VARIABLE_BINDINGS(none)--> query[legal]')).toBe(true);
    expect(cleanShapes.has('query[legal] --VARIABLE_BINDINGS(none)--> end[legal]')).toBe(true);
    expect(cleanShapes.has('query[unbound] --CONTROL_FLOW(none)--> query[unbound]')).toBe(true);
    expect(cleanShapes.has('query[legal] --QUERY_ID(none)--> dynamic[legal]')).toBe(true);
    expect(cleanShapes.has('ruleset[legal] --RDF_GRAPH(none)--> ruleset[legal]')).toBe(true);
  });
});
