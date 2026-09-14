/**
 * The commands that escape the cell abstraction, paired with everything.
 *
 * The cell and transition matrices reason per edge, which is sound because
 * almost every command writes one edge or one node. Three do not:
 * `assignQueryVersion`, `deleteNode` and `deleteEdge` all call
 * `pruneUnreferencedEntities` over the shared entity table, and assignment
 * additionally rewrites every edge touching the node. Their failure modes are
 * a function of *sharing* - metadata one node still needs, referenced through
 * an edge the command was not looking at - so they are tested here over the
 * fixture built for exactly that: two nodes on one query version, with the
 * boundary and result edges of a real loaded group.
 *
 * Every (global command x any command) ordered pair runs from the seed. After
 * each applied step the state must still satisfy every invariant - the seed is
 * clean, so "no new damage" and "stays clean" coincide. Refusals must leave
 * the state untouched and say why. H2 lives in this file's space: it was a
 * (setEdgeVariableMappings, assignQueryVersion) ordered pair.
 */

import { describe, it, expect } from 'vitest';

import { checkInvariants } from '../../src/composables/queryGroupInvariants';
import { createGraphStateFromExpanded } from '../../src/composables/useQueryGroupGraph';
import type { QueryGroupGraphState } from '../../src/composables/useQueryGroupGraph';
import { commandInstances, type CommandInstance } from './harness/canvasCells';
import { selectGroupVersionExpanded } from '../fixtures/queryGroupCanvasIo';

const seed = () => createGraphStateFromExpanded(selectGroupVersionExpanded({ withSecondNode: true }));

const GLOBAL_COMMANDS = new Set(['assignQueryVersion', 'deleteNode', 'deleteEdge']);

describe('canvas pair matrix', () => {
  it('the seed is clean and actually shares entities', () => {
    const state = seed();
    expect(checkInvariants(state)).toEqual([]);

    // Two nodes on one query version, sharing its tuples - the situation
    // `pruneUnreferencedEntities` exists to not break. If a fixture change
    // removes the sharing, every pair below still passes while testing
    // nothing, so the sharing itself is asserted.
    const owners = new Map<string, number>();
    for (const node of state.nodes) {
      for (const port of [...node.inputs, ...node.outputs]) {
        owners.set(port.id, (owners.get(port.id) ?? 0) + 1);
      }
    }
    expect([...owners.values()].some(count => count > 1)).toBe(true);
  });

  it('every ordered (global, any) pair holds the contract at both steps', () => {
    const start = seed();
    const instances = commandInstances(start);
    const globals = instances.filter(instance => GLOBAL_COMMANDS.has(instance.command));
    const failures: string[] = [];
    let pairs = 0;

    const step = (state: QueryGroupGraphState, instance: CommandInstance, context: string): QueryGroupGraphState => {
      const before = new Set(checkInvariants(state).map(violation => violation.code));
      const result = instance.run(state);

      if (!result.applied) {
        if (result.state !== state) failures.push(`${context} :: refused but returned a different state`);
        if (!result.diagnostics.some(diagnostic => diagnostic.level === 'error')) {
          failures.push(`${context} :: refused with no error diagnostic`);
        }
        return state;
      }

      const introduced = checkInvariants(result.state)
        .map(violation => violation.code)
        .filter(code => !before.has(code));
      if (introduced.length > 0) failures.push(`${context} :: introduced [${introduced}]`);
      return result.state;
    };

    for (const global of globals) {
      for (const other of instances) {
        pairs += 2;

        let state = step(start, global, `[${global.label} ; ${other.label}] step 1`);
        step(state, other, `[${global.label} ; ${other.label}] step 2`);

        state = step(start, other, `[${other.label} ; ${global.label}] step 1`);
        step(state, global, `[${other.label} ; ${global.label}] step 2`);
      }
    }

    // Failures before the pinned count, so a stale count cannot mask them.
    expect(failures, `${failures.length} failure(s):\n${failures.slice(0, 10).join('\n')}`).toEqual([]);
    expect(pairs).toBe(4872);
  });
});
