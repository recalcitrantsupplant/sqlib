import { describe, it, expect } from 'vitest';

import {
  EDGE_FLOW_TYPES,
  arityDiagnostics,
  autoBind,
  checkEndpoint,
  checkNodeKinds,
  isEndNodePassThrough,
  legalSourcePortKinds,
  legalTargetPortKinds,
  parseVariableMappings,
  resolveEndpoints,
  sourceCandidates,
  targetCandidates,
  validateVariableMappings,
  type EdgeFlowType,
} from '../../src/composables/queryGroupCompatibility';
import type { GraphNodeState } from '../../src/composables/useQueryGroupGraph';
import type { GraphPort, IoEntityKind, IoModel } from '../../src/composables/queryGroupIoModel';

const ALL_PORT_KINDS: IoEntityKind[] = [
  'QueryInputTuple',
  'QueryOutputTuple',
  'TriplesQuadsIO',
  'BooleanIO',
  'QueryIdInput',
  'ControlFlowIO',
  'Unknown',
];

const port = (id: string, entityType: IoEntityKind, direction: 'input' | 'output'): GraphPort => ({
  id,
  label: id,
  entityType,
  direction,
  origin: 'query-version',
  resolved: true,
});

const node = (
  id: string,
  kind: GraphNodeState['kind'],
  ports: { inputs?: GraphPort[]; outputs?: GraphPort[] } = {},
): GraphNodeState => ({
  id,
  kind,
  label: id,
  inputs: ports.inputs ?? [],
  outputs: ports.outputs ?? [],
});

describe('flow-type port compatibility', () => {
  /**
   * Every flow type against every port kind, in both directions. The table is
   * the point: a rule that only exists in one caller's switch statement cannot
   * be enumerated, and that is how the callers drifted apart.
   */
  const EXPECTED: Record<EdgeFlowType, { source: IoEntityKind[]; target: IoEntityKind[] }> = {
    CONTROL_FLOW: { source: [], target: [] },
    VARIABLE_BINDINGS: { source: ['QueryOutputTuple'], target: ['QueryInputTuple'] },
    RDF_GRAPH: { source: ['TriplesQuadsIO'], target: ['TriplesQuadsIO'] },
    BOOLEAN: { source: ['BooleanIO'], target: ['BooleanIO'] },
    QUERY_ID: { source: ['QueryOutputTuple'], target: ['QueryIdInput'] },
  };

  for (const flowType of EDGE_FLOW_TYPES) {
    for (const kind of ALL_PORT_KINDS) {
      const sourceAllowed = EXPECTED[flowType].source.includes(kind);
      it(`${flowType}: a ${kind} source port is ${sourceAllowed ? 'accepted' : 'rejected'}`, () => {
        expect(legalSourcePortKinds(flowType, node('a', 'query')).includes(kind)).toBe(sourceAllowed);
      });

      const targetAllowed = EXPECTED[flowType].target.includes(kind);
      it(`${flowType}: a ${kind} target port is ${targetAllowed ? 'accepted' : 'rejected'}`, () => {
        expect(legalTargetPortKinds(flowType, node('b', 'query')).includes(kind)).toBe(targetAllowed);
      });
    }
  }

  it('treats a start node’s outputs as the group’s input tuples', () => {
    // What Start saves is what callers supply, so its outputs are inputs.
    expect(legalSourcePortKinds('VARIABLE_BINDINGS', node('s', 'start'))).toEqual(['QueryInputTuple']);
  });

  it('treats an end node’s inputs as the group’s output tuples', () => {
    expect(legalTargetPortKinds('VARIABLE_BINDINGS', node('e', 'end'))).toEqual(['QueryOutputTuple']);
  });
});

describe('node-kind restrictions', () => {
  it('rejects an edge out of the end node and into the start node', () => {
    const codes = checkNodeKinds('CONTROL_FLOW', node('e', 'end'), node('s', 'start')).map(d => d.code);
    expect(codes).toContain('end-node-source');
    expect(codes).toContain('start-node-target');
  });

  it('requires QUERY_ID to target a dynamic node', () => {
    expect(checkNodeKinds('QUERY_ID', node('a', 'query'), node('b', 'query')).map(d => d.code)).toContain(
      'target-node-kind',
    );
    expect(checkNodeKinds('QUERY_ID', node('a', 'query'), node('b', 'dynamic'))).toEqual([]);
  });

  it('requires ruleset data edges to be RDF, but allows ordering them', () => {
    expect(checkNodeKinds('VARIABLE_BINDINGS', node('r', 'ruleset'), node('b', 'query')).map(d => d.code)).toContain(
      'ruleset-requires-rdf',
    );
    // RDF from a ruleset is fine - to a consumer that can read it. A query
    // node cannot (the backend's EDGE_RDF_GRAPH_TARGET_CANNOT_CONSUME).
    expect(checkNodeKinds('RDF_GRAPH', node('r', 'ruleset'), node('b', 'ruleset'))).toEqual([]);
    expect(checkNodeKinds('RDF_GRAPH', node('r', 'ruleset'), node('b', 'end'))).toEqual([]);
    expect(checkNodeKinds('RDF_GRAPH', node('r', 'ruleset'), node('b', 'query')).map(d => d.code)).toContain(
      'rdf-graph-target-cannot-consume',
    );
    expect(checkNodeKinds('CONTROL_FLOW', node('r', 'ruleset'), node('b', 'query'))).toEqual([]);
  });
});

describe('endpoint checks', () => {
  const source = node('a', 'query', { outputs: [port('out', 'QueryOutputTuple', 'output')] });
  const target = node('b', 'query', { inputs: [port('in', 'QueryInputTuple', 'input')] });

  it('rejects a port that is not on the node', () => {
    expect(checkEndpoint('VARIABLE_BINDINGS', source, 'missing', 'source')?.code).toBe('endpoint-not-on-node');
  });

  it('rejects a port of the wrong kind for the flow type', () => {
    expect(checkEndpoint('RDF_GRAPH', source, 'out', 'source')?.code).toBe('endpoint-kind-mismatch');
  });

  it('accepts a matching port', () => {
    expect(checkEndpoint('VARIABLE_BINDINGS', source, 'out', 'source')).toBeNull();
    expect(checkEndpoint('VARIABLE_BINDINGS', target, 'in', 'target')).toBeNull();
  });

  it('rejects any endpoint on a Control Flow edge', () => {
    expect(checkEndpoint('CONTROL_FLOW', source, 'out', 'source')?.code).toBe('control-flow-has-endpoint');
  });

  it('accepts the End node alias, which names a port of the source', () => {
    const endNode = node('e', 'end');
    expect(isEndNodePassThrough('VARIABLE_BINDINGS', endNode)).toBe(true);
    expect(checkEndpoint('VARIABLE_BINDINGS', endNode, 'out', 'target')).toBeNull();
    expect(targetCandidates('VARIABLE_BINDINGS', endNode)).toEqual([]);
  });
});

describe('auto-binding', () => {
  const outputs = (count: number) =>
    Array.from({ length: count }, (_, index) => port(`out-${index}`, 'QueryOutputTuple', 'output'));

  it('binds nothing and gives a reason when there are no candidates', () => {
    expect(autoBind([], 'source output')).toMatchObject({ status: 'none' });
  });

  it('binds when exactly one candidate fits', () => {
    expect(autoBind(outputs(1), 'source output')).toEqual({ status: 'bound', portId: 'out-0' });
  });

  it('asks the author to choose when several fit', () => {
    // Picking the first is a guess presented as a decision.
    const outcome = autoBind(outputs(3), 'source output');
    expect(outcome.status).toBe('ambiguous');
    expect(outcome.status === 'ambiguous' && outcome.candidates).toHaveLength(3);
  });

  it('offers an unresolved port as a candidate rather than hiding it', () => {
    const unresolved: GraphPort = { id: 'x', label: 'x', entityType: 'QueryOutputTuple', direction: 'output', resolved: false };
    expect(sourceCandidates('VARIABLE_BINDINGS', node('a', 'query', { outputs: [unresolved] }))).toHaveLength(1);
  });
});

describe('resolving endpoints for a flow type', () => {
  const source = node('a', 'query', {
    outputs: [port('tuple', 'QueryOutputTuple', 'output'), port('rdf', 'TriplesQuadsIO', 'output')],
  });
  const target = node('b', 'query', {
    inputs: [port('in-tuple', 'QueryInputTuple', 'input'), port('in-rdf', 'TriplesQuadsIO', 'input')],
  });

  it('clears endpoints entirely for Control Flow', () => {
    expect(
      resolveEndpoints({ flowType: 'VARIABLE_BINDINGS', sourceOutputId: 'tuple', targetInputId: 'in-tuple' }, source, target, 'CONTROL_FLOW'),
    ).toMatchObject({ sourceOutputId: null, targetInputId: null });
  });

  it('keeps bindings that survive the new flow type', () => {
    const result = resolveEndpoints(
      { flowType: 'VARIABLE_BINDINGS', sourceOutputId: 'tuple', targetInputId: 'in-tuple' },
      source,
      target,
      'VARIABLE_BINDINGS',
    );
    expect(result).toMatchObject({ sourceOutputId: 'tuple', targetInputId: 'in-tuple' });
  });

  it('re-binds incompatible endpoints and says it did', () => {
    const result = resolveEndpoints(
      { flowType: 'VARIABLE_BINDINGS', sourceOutputId: 'tuple', targetInputId: 'in-tuple' },
      source,
      target,
      'RDF_GRAPH',
    );
    expect(result).toMatchObject({ sourceOutputId: 'rdf', targetInputId: 'in-rdf' });
    expect(result.diagnostics.map(d => d.code)).toEqual(
      expect.arrayContaining(['source-cleared', 'target-cleared']),
    );
  });

  it('aliases the source port when the target is the End node', () => {
    const result = resolveEndpoints(
      { flowType: 'VARIABLE_BINDINGS', sourceOutputId: null, targetInputId: null },
      source,
      node('e', 'end'),
      'VARIABLE_BINDINGS',
    );
    expect(result.sourceOutputId).toBe('tuple');
    expect(result.targetInputId).toBe('tuple');
  });

  it('leaves an ambiguous endpoint unbound with a reason', () => {
    const ambiguous = node('a', 'query', {
      outputs: [port('t1', 'QueryOutputTuple', 'output'), port('t2', 'QueryOutputTuple', 'output')],
    });
    const result = resolveEndpoints(
      { flowType: 'VARIABLE_BINDINGS', sourceOutputId: null, targetInputId: null },
      ambiguous,
      target,
      'VARIABLE_BINDINGS',
    );
    expect(result.sourceOutputId).toBeNull();
    expect(result.diagnostics.map(d => d.code)).toContain('source-ambiguous');
  });
});

describe('variable mappings', () => {
  const model: IoModel = {
    entities: {
      src: { id: 'src', kind: 'QueryOutputTuple', memberEntries: ['m1', 'm2', 'm3'], arity: 3 },
      tgt: { id: 'tgt', kind: 'QueryInputTuple', memberEntries: ['m4', 'm5'], arity: 2 },
      unknownTuple: { id: 'unknownTuple', kind: 'QueryInputTuple', memberEntries: null, arity: null },
    },
    members: {
      m1: { id: 'm1', position: 0, variable: 'v-city' },
      m2: { id: 'm2', position: 1, variable: 'v-pop' },
      m3: { id: 'm3', position: 2, variable: 'v-area' },
      m4: { id: 'm4', position: 0, variable: 'v-in-city' },
      m5: { id: 'm5', position: 1, variable: 'v-in-country' },
    },
    variables: {
      'v-city': { id: 'v-city', variableName: 'city', direction: 'output' },
      'v-pop': { id: 'v-pop', variableName: 'pop', direction: 'output' },
      'v-area': { id: 'v-area', variableName: 'area', direction: 'output' },
      'v-in-city': { id: 'v-in-city', variableName: 'city', direction: 'input' },
      'v-in-country': { id: 'v-in-country', variableName: 'country', direction: 'input' },
    },
  };

  const edge = (variableMappings: string | null) => ({
    flowType: 'VARIABLE_BINDINGS' as const,
    sourceOutputId: 'src',
    targetInputId: 'tgt',
    variableMappings,
  });

  const errors = (mappings: string | null) =>
    validateVariableMappings(edge(mappings), model).filter(d => d.level === 'error');

  it('accepts a complete mapping', () => {
    expect(errors(JSON.stringify([{ source: 'city', target: 'city' }, { source: 'pop', target: 'country' }]))).toEqual([]);
  });

  it('accepts a partial mapping', () => {
    expect(errors(JSON.stringify([{ source: 'city', target: 'city' }]))).toEqual([]);
  });

  it('accepts a reordered mapping', () => {
    expect(errors(JSON.stringify([{ source: 'pop', target: 'city' }, { source: 'city', target: 'country' }]))).toEqual([]);
  });

  it('accepts an empty mapping', () => {
    expect(errors('[]')).toEqual([]);
    expect(errors(null)).toEqual([]);
  });

  it('rejects a reference to a variable that does not exist', () => {
    expect(errors(JSON.stringify([{ source: 'nope', target: 'city' }])).map(d => d.code)).toEqual([
      'mapping-unknown-source',
    ]);
    expect(errors(JSON.stringify([{ source: 'city', target: 'nope' }])).map(d => d.code)).toEqual([
      'mapping-unknown-target',
    ]);
  });

  it('rejects a malformed mapping', () => {
    expect(errors('not json').map(d => d.code)).toEqual(['mapping-malformed']);
    expect(parseVariableMappings('{"a":1}')).toBeNull();
  });

  it('warns about differing arity without making it an error', () => {
    const diagnostics = validateVariableMappings(edge('[]'), model);
    expect(diagnostics.filter(d => d.level === 'error')).toEqual([]);
    expect(diagnostics.map(d => d.code)).toContain('mapping-arity-differs');
  });

  it('raises nothing when the arities agree', () => {
    expect(arityDiagnostics('src', 'src', model)).toEqual([]);
  });

  it('warns that an unknown arity cannot be checked, rather than treating it as zero', () => {
    expect(arityDiagnostics('src', 'unknownTuple', model).map(d => d.code)).toEqual(['mapping-arity-unknown']);
  });
});
