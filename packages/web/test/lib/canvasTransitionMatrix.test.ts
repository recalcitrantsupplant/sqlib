/**
 * The transition layer, enumerated.
 *
 * Every realized edge cell x every command instance the state's own vocabulary
 * offers (see `commandInstances`). The full product replaced the planned
 * projected/nightly split: measured, the whole sweep is seconds, so nothing is
 * projected out and there is no separate projection claim left to verify.
 *
 * The oracle is the command contract itself, which every command must satisfy
 * uniformly:
 *
 * - **Refused means untouched and explained.** `applied: false` returns the
 *   same state object (not a copy - callers keep identity) and at least one
 *   error diagnostic. A refusal with no reason is the silent no-op the module
 *   header forswears.
 * - **Applied means no new damage.** Violation codes after ⊆ violation codes
 *   before. From a clean state this is "stays clean" - H1 and H2 were exactly
 *   failures of this line. From a violating state (representable because saves
 *   predating a rule still load) a command may fix or carry the violation, but
 *   must not add a kind of brokenness the state did not already have.
 *
 * H3's fix is visible here as the `connectNodes` instances that try to close
 * `target -> source` against the existing edge and must refuse.
 */

import { describe, it, expect } from 'vitest';

import * as commands from '../../src/composables/queryGroupCommands';
import { checkInvariants } from '../../src/composables/queryGroupInvariants';
import { GRAPH_NODE_KINDS } from '../../src/composables/useQueryGroupGraph';
import { EDGE_FLOW_TYPES } from '../../src/composables/queryGroupCompatibility';
import { allCells, commandInstances, describeCell, realizeCell } from './harness/canvasCells';

describe('canvas transition matrix', () => {
  it('the instance list mentions every exported command', () => {
    // Reflection over the module is what makes this future-proof: exporting a
    // new command without adding instances for it fails here by name, rather
    // than silently joining the untested set - which is how
    // `setEdgeVariableMappings` and `setNodeQueryVersionResolution` escaped
    // the random property.
    const probe = realizeCell({
      flowType: 'VARIABLE_BINDINGS',
      sourceKind: 'query',
      targetKind: 'query',
      source: 'legal',
      target: 'legal',
      mapping: 'none',
    });
    if (probe.status !== 'realized') throw new Error('probe cell must realize');

    const exported = Object.keys(commands).sort();
    const driven = [...new Set(commandInstances(probe.state).map(instance => instance.command))].sort();
    expect(driven).toEqual(exported);
  });

  it('every command holds the contract on every realized cell', { timeout: 60000 }, () => {
    const failures: string[] = [];
    let transitions = 0;

    for (const cell of allCells(EDGE_FLOW_TYPES, GRAPH_NODE_KINDS)) {
      const realization = realizeCell(cell);
      if (realization.status !== 'realized') continue;
      const { state } = realization;
      const before = new Set(checkInvariants(state).map(violation => violation.code));

      for (const instance of commandInstances(state)) {
        transitions++;
        const result = instance.run(state);

        if (!result.applied) {
          if (result.state !== state) {
            failures.push(`${describeCell(cell)} :: ${instance.label} :: refused but returned a different state`);
          }
          if (!result.diagnostics.some(diagnostic => diagnostic.level === 'error')) {
            failures.push(`${describeCell(cell)} :: ${instance.label} :: refused with no error diagnostic`);
          }
          continue;
        }

        const introduced = checkInvariants(result.state)
          .map(violation => violation.code)
          .filter(code => !before.has(code));
        if (introduced.length > 0) {
          failures.push(`${describeCell(cell)} :: ${instance.label} :: introduced [${introduced}]`);
        }
      }
    }

    // Failures first: a stale pinned count must not mask real contract
    // failures by throwing before they are read. It already happened once -
    // the H5 defect sat behind a wrong count for one commit.
    expect(failures, `${failures.length} contract failure(s):\n${failures.slice(0, 10).join('\n')}`).toEqual([]);

    // The count is pinned for the same reason the cell partition is: coverage
    // that shrinks must say so. It moves when a domain, the realizability
    // rules, or the per-state instance vocabulary changes - each of which is
    // exactly a moment to re-read this file.
    expect(transitions).toBe(2134080);
  });
});
