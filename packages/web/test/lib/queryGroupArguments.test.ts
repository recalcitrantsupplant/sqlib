import { describe, it, expect } from 'vitest';
import { graphStateToFlatPayload, createGraphStateFromExpanded } from '../../src/composables/useQueryGroupGraph';
import type { ArgumentTupleBinding } from '../../src/types/argument-sets';

/**
 * Mirrors buildInlineArguments in QueryGroupWorkArea. The rule it encodes is the
 * one that silently ruins results if inverted: an input the user left blank must be
 * omitted, never sent as `bindings: []`.
 */
function buildInlineArguments(bindings: ArgumentTupleBinding[]) {
  const args: Array<{ head: { vars: string[] }; arguments: { bindings: Array<Record<string, unknown>> } }> = [];
  for (const binding of bindings) {
    const vars = binding?.variables ?? [];
    const rows = (binding?.rows ?? []).filter((row) => row && Object.keys(row.values ?? {}).length > 0);
    if (vars.length === 0 || rows.length === 0) continue;
    args.push({ head: { vars }, arguments: { bindings: rows.map((row) => ({ ...row.values })) } });
  }
  return args;
}

describe('inline group arguments', () => {
  it('omits an input the user left blank rather than sending an empty set', () => {
    // bindings: [] means "match nothing" in the VALUES contract, so sending it for
    // an untouched field would silently return zero results.
    const args = buildInlineArguments([
      { tupleSignature: 'state', variables: ['state'], rows: [] },
    ]);
    expect(args).toEqual([]);
  });

  it('sends authored rows for the inputs that have them', () => {
    const args = buildInlineArguments([
      { tupleSignature: 'state', variables: ['state'], rows: [
        { values: { state: { type: 'literal', value: 'NSW' } } },
      ] },
      { tupleSignature: 'city', variables: ['city'], rows: [] },
    ]);

    expect(args).toHaveLength(1);
    expect(args[0]).toEqual({
      head: { vars: ['state'] },
      arguments: { bindings: [{ state: { type: 'literal', value: 'NSW' } }] },
    });
  });

  it('drops rows where every cell was left empty', () => {
    const args = buildInlineArguments([
      { tupleSignature: 'state', variables: ['state'], rows: [{ values: {} }] },
    ]);
    expect(args).toEqual([]);
  });
});

describe('whenEmpty round-trip through graph state', () => {
  it('reads the policy off an expanded edge and writes it back to the flat payload', () => {
    const expanded: any = {
      queryGroupVersion: { id: 'urn:sqlib:qgv:1' },
      executionNodes: [],
      edges: [{
        id: 'urn:sqlib:edge:1',
        sourceNodeId: 'urn:sqlib:node:a',
        targetNodeId: 'urn:sqlib:node:b',
        dataFlowType: 'VARIABLE_BINDINGS',
        sourceOutputId: 'urn:sqlib:out:1',
        targetInputId: 'urn:sqlib:in:1',
        whenEmpty: 'unconstrained',
      }],
      inputTuples: [], outputTuples: [], tupleMembers: [],
      inputs: [], outputs: [], rdfOutputs: [], iriMap: {},
    };

    const state = createGraphStateFromExpanded(expanded);
    expect(state.edges[0].whenEmpty).toBe('unconstrained');

    const flat = graphStateToFlatPayload(state);
    // Without this the setting is silently dropped on the next save.
    expect(flat.edges[0].whenEmpty).toBe('unconstrained');
  });

  it('leaves the policy null when the author never set one', () => {
    const expanded: any = {
      queryGroupVersion: { id: 'urn:sqlib:qgv:1' },
      executionNodes: [],
      edges: [{
        id: 'urn:sqlib:edge:1',
        sourceNodeId: 'urn:sqlib:node:a',
        targetNodeId: 'urn:sqlib:node:b',
        dataFlowType: 'VARIABLE_BINDINGS',
      }],
      inputTuples: [], outputTuples: [], tupleMembers: [],
      inputs: [], outputs: [], rdfOutputs: [], iriMap: {},
    };

    const state = createGraphStateFromExpanded(expanded);
    expect(state.edges[0].whenEmpty).toBeNull();
    expect(graphStateToFlatPayload(state).edges[0].whenEmpty).toBeNull();
  });
});
