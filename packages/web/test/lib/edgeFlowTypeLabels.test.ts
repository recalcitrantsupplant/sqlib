import { describe, it, expect } from 'vitest';
import { FLOW_TYPE_LABELS, flowTypeLabel, type DataFlowType } from '../../src/composables/edgeFlowTypeDefaults';

/**
 * The canvas labels every edge with what travels along it, so the mapping has to
 * be total: a flow type with no label would render an edge that says nothing.
 */
describe('edge flow type labels', () => {
  const ALL: DataFlowType[] = ['CONTROL_FLOW', 'VARIABLE_BINDINGS', 'RDF_GRAPH', 'BOOLEAN', 'QUERY_ID'];

  it('names every flow type without leaking the enum spelling', () => {
    for (const flowType of ALL) {
      const label = flowTypeLabel(flowType);
      expect(label, `${flowType} has no label`).toBeTruthy();
      expect(label).not.toContain('_');
      expect(label).toBe(FLOW_TYPE_LABELS[flowType]);
    }
    expect(new Set(ALL.map(flowTypeLabel)).size, 'two flow types share a label').toBe(ALL.length);
  });

  it('falls back to the control-flow label for an absent flow type', () => {
    // An edge with no dataFlowType is control flow, both in the API and here.
    expect(flowTypeLabel(null)).toBe(FLOW_TYPE_LABELS.CONTROL_FLOW);
    expect(flowTypeLabel(undefined)).toBe(FLOW_TYPE_LABELS.CONTROL_FLOW);
  });
});
