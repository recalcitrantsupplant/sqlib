import { describe, expect, it } from 'vitest';
import {
  flowTypeLabel,
  formatFlowTypeLabel,
  getConfidenceBadgeClass,
  recommendFlowType,
  validateFlowTypeCompatibility,
  type DataFlowType,
} from '@/composables/edgeFlowTypeDefaults';
import type { GraphNodeState } from '@/composables/useQueryGroupGraph';

/**
 * `recommendFlowType` and `validateFlowTypeCompatibility` are pure functions
 * over `edge-flow-type-defaults.json`'s rule table — the one place the canvas
 * decides what an edge between two node kinds *should* carry, and what it will
 * refuse. No test exercised either before this, so a rule accidentally
 * reordered or a query-type IRI mistyped in the config would only be caught by
 * clicking through the canvas by hand.
 */

const SELECT = 'https://sparql-query-lib/query-type/select';
const CONSTRUCT = 'https://sparql-query-lib/query-type/construct';
const DESCRIBE = 'https://sparql-query-lib/query-type/describe';
const ASK = 'https://sparql-query-lib/query-type/ask';
const UPDATE = 'https://sparql-query-lib/query-type/update';

function node(overrides: Partial<GraphNodeState> & Pick<GraphNodeState, 'kind'>): GraphNodeState {
  return {
    id: `urn:sqlib:node:${overrides.kind}`,
    label: overrides.kind,
    inputs: [],
    outputs: [],
    ...overrides,
  };
}

describe('recommendFlowType', () => {
  it('recommends RDF_GRAPH whenever either side is a ruleset, ahead of every other rule', () => {
    const bySource = recommendFlowType(node({ kind: 'ruleset' }), node({ kind: 'end' }));
    expect(bySource).toMatchObject({ defaultFlowType: 'RDF_GRAPH', confidence: 'high' });

    const byTarget = recommendFlowType(node({ kind: 'start' }), node({ kind: 'ruleset' }));
    expect(byTarget).toMatchObject({ defaultFlowType: 'RDF_GRAPH', confidence: 'high' });
  });

  it('matches start -> end as CONTROL_FLOW', () => {
    const result = recommendFlowType(node({ kind: 'start' }), node({ kind: 'end' }));
    expect(result.defaultFlowType).toBe('CONTROL_FLOW');
  });

  it('matches start -> query as VARIABLE_BINDINGS', () => {
    const result = recommendFlowType(node({ kind: 'start' }), node({ kind: 'query', queryType: SELECT }));
    expect(result.defaultFlowType).toBe('VARIABLE_BINDINGS');
  });

  it('matches SELECT -> end as VARIABLE_BINDINGS', () => {
    const result = recommendFlowType(node({ kind: 'query', queryType: SELECT }), node({ kind: 'end' }));
    expect(result.defaultFlowType).toBe('VARIABLE_BINDINGS');
  });

  it('matches CONSTRUCT -> SELECT as RDF_GRAPH (querying a constructed graph)', () => {
    const result = recommendFlowType(
      node({ kind: 'query', queryType: CONSTRUCT }),
      node({ kind: 'query', queryType: SELECT })
    );
    expect(result.defaultFlowType).toBe('RDF_GRAPH');
  });

  it('matches ASK -> anything as BOOLEAN', () => {
    const result = recommendFlowType(node({ kind: 'query', queryType: ASK }), node({ kind: 'query', queryType: CONSTRUCT }));
    expect(result.defaultFlowType).toBe('BOOLEAN');
  });

  it('matches UPDATE -> anything as CONTROL_FLOW, with a warning that it produces no data', () => {
    const result = recommendFlowType(node({ kind: 'query', queryType: UPDATE }), node({ kind: 'query', queryType: SELECT }));
    expect(result.defaultFlowType).toBe('CONTROL_FLOW');
    expect(result.warnings).toContain('UPDATE queries produce no data output');
  });

  it('recommends QUERY_ID when the target dynamic node has a QueryIdInput port', () => {
    const dynamicWithQueryId = node({
      kind: 'dynamic',
      inputs: [{ id: 'urn:sqlib:port:1', label: 'variant', entityType: 'QueryIdInput', direction: 'input' }],
    });
    const result = recommendFlowType(node({ kind: 'query', queryType: SELECT }), dynamicWithQueryId);
    expect(result.defaultFlowType).toBe('QUERY_ID');
    expect(result.confidence).toBe('medium');
  });

  it('recommends VARIABLE_BINDINGS for a dynamic target with no QueryIdInput port', () => {
    const dynamicNoQueryId = node({
      kind: 'dynamic',
      inputs: [{ id: 'urn:sqlib:port:1', label: 'rows', entityType: 'QueryInputTuple', direction: 'input' }],
    });
    const result = recommendFlowType(node({ kind: 'query', queryType: SELECT }), dynamicNoQueryId);
    expect(result.defaultFlowType).toBe('VARIABLE_BINDINGS');
  });

  it('falls back to a low-confidence CONTROL_FLOW when nothing matches', () => {
    // Neither node carries a queryType or a kind any rule names.
    const result = recommendFlowType(node({ kind: 'end' }), node({ kind: 'start' }));
    expect(result).toMatchObject({ defaultFlowType: 'CONTROL_FLOW', confidence: 'low' });
    expect(result.warnings).toBeDefined();
  });

  it('takes the first matching rule when a pair could match more than one', () => {
    // start -> query with no queryType matches only the start/query rule
    // (VARIABLE_BINDINGS), not any of the queryType-keyed rules — since those
    // require a queryType this node does not have.
    const result = recommendFlowType(node({ kind: 'start' }), node({ kind: 'query' }));
    expect(result.defaultFlowType).toBe('VARIABLE_BINDINGS');
    expect(result.explanation).toMatch(/external parameters/i);
  });
});

describe('validateFlowTypeCompatibility', () => {
  it('rejects an end node as the edge source', () => {
    const result = validateFlowTypeCompatibility(node({ kind: 'end' }), node({ kind: 'query' }), 'CONTROL_FLOW');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('End nodes cannot have outgoing edges');
  });

  it('warns, but does not fail, on an edge into a start node', () => {
    const result = validateFlowTypeCompatibility(node({ kind: 'query' }), node({ kind: 'start' }), 'CONTROL_FLOW');
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain('Creating edge to start node is unusual');
  });

  it('accepts CONTROL_FLOW unconditionally once the structural checks pass', () => {
    const result = validateFlowTypeCompatibility(
      node({ kind: 'query', queryType: CONSTRUCT }),
      node({ kind: 'query', queryType: DESCRIBE }),
      'CONTROL_FLOW'
    );
    expect(result).toEqual({ valid: true, errors: [], warnings: [] });
  });

  it('requires RDF_GRAPH whenever a ruleset is on either side', () => {
    const result = validateFlowTypeCompatibility(node({ kind: 'ruleset' }), node({ kind: 'query' }), 'VARIABLE_BINDINGS');
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Ruleset nodes require RDF_GRAPH edges for data transfer');
  });

  it('lets RDF_GRAPH through a ruleset edge', () => {
    const result = validateFlowTypeCompatibility(node({ kind: 'ruleset' }), node({ kind: 'query' }), 'RDF_GRAPH');
    expect(result.valid).toBe(true);
  });

  it('rejects an unknown flow type outright', () => {
    const result = validateFlowTypeCompatibility(
      node({ kind: 'query', queryType: SELECT }),
      node({ kind: 'query', queryType: SELECT }),
      'NOT_A_REAL_FLOW_TYPE' as DataFlowType
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Unknown flow type: NOT_A_REAL_FLOW_TYPE');
  });

  it('reports the query-type-specific message for a disallowed VARIABLE_BINDINGS source', () => {
    const result = validateFlowTypeCompatibility(
      node({ kind: 'query', queryType: CONSTRUCT }),
      node({ kind: 'query', queryType: SELECT }),
      'VARIABLE_BINDINGS'
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('CONSTRUCT queries produce RDF graphs, not tuple bindings');
  });

  it('falls back to the default message when no per-type message is configured', () => {
    const result = validateFlowTypeCompatibility(
      node({ kind: 'query', queryType: SELECT }),
      node({ kind: 'query', queryType: SELECT }),
      'RDF_GRAPH'
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Only CONSTRUCT/DESCRIBE queries produce RDF graphs');
  });

  it('accepts a CONSTRUCT source for RDF_GRAPH', () => {
    const result = validateFlowTypeCompatibility(
      node({ kind: 'query', queryType: CONSTRUCT }),
      node({ kind: 'query', queryType: SELECT }),
      'RDF_GRAPH'
    );
    expect(result.valid).toBe(true);
  });

  it('accepts VARIABLE_BINDINGS from a start node even with no queryType', () => {
    const result = validateFlowTypeCompatibility(node({ kind: 'start' }), node({ kind: 'query' }), 'VARIABLE_BINDINGS');
    expect(result.valid).toBe(true);
  });

  it('rejects QUERY_ID targeting a non-dynamic node', () => {
    const result = validateFlowTypeCompatibility(
      node({ kind: 'query', queryType: SELECT }),
      node({ kind: 'query', queryType: SELECT }),
      'QUERY_ID'
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('QUERY_ID flow can only target DynamicQueryNode');
  });

  it('accepts QUERY_ID from a SELECT source targeting a dynamic node, with its warning', () => {
    const result = validateFlowTypeCompatibility(
      node({ kind: 'query', queryType: SELECT }),
      node({ kind: 'dynamic' }),
      'QUERY_ID'
    );
    expect(result.valid).toBe(true);
    expect(result.warnings).toContain('Ensure SELECT query produces exactly one variable for query ID');
  });
});

describe('formatFlowTypeLabel', () => {
  it('labels every flow type', () => {
    expect(formatFlowTypeLabel('CONTROL_FLOW')).toBe('Control Flow (execution order)');
    expect(formatFlowTypeLabel('VARIABLE_BINDINGS')).toBe('Variable Bindings (tuple data)');
    expect(formatFlowTypeLabel('RDF_GRAPH')).toBe('RDF Graph (triples/quads)');
    expect(formatFlowTypeLabel('BOOLEAN')).toBe('Boolean (true/false)');
    expect(formatFlowTypeLabel('QUERY_ID')).toBe('Query ID (dynamic selection)');
  });
});

describe('flowTypeLabel', () => {
  it('reads the canvas-facing label for a known flow type', () => {
    expect(flowTypeLabel('VARIABLE_BINDINGS')).toBe('result rows');
  });

  it('defaults to the CONTROL_FLOW label when given null or undefined', () => {
    expect(flowTypeLabel(null)).toBe('runs after');
    expect(flowTypeLabel(undefined)).toBe('runs after');
  });
});

describe('getConfidenceBadgeClass', () => {
  it('prefixes the confidence level for a CSS class', () => {
    expect(getConfidenceBadgeClass('high')).toBe('confidence-high');
    expect(getConfidenceBadgeClass('medium')).toBe('confidence-medium');
    expect(getConfidenceBadgeClass('low')).toBe('confidence-low');
  });
});
