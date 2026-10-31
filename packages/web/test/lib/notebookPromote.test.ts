import { describe, it, expect } from 'vitest';
import { emptyNotebook, markdownCell, type Notebook, type QueryCell, type RuleSetCell } from '@/lib/notebookFormat';
import { planPromotion, type PromotionTarget } from '@/lib/notebookPromote';

const BACKEND = 'urn:sqlib:backend:b1';

function select(id: string, outputVars: string[], slotVars: string[][] = []): PromotionTarget {
  return {
    kind: 'query', versionId: `urn:qv:${id}`, resultKind: 'BINDINGS',
    inputTupleIds: slotVars.map((_, index) => `urn:in:${id}:${index}`), slotVars,
    outputPortId: `urn:out:${id}`, outputVars, backendId: BACKEND,
  };
}

function cell(id: string, out: string, slots: QueryCell['slots'] = []): QueryCell {
  return { kind: 'query', id, query: `urn:q:${id}`, out, label: id, slots };
}

function notebookOf(...cells: Notebook['cells']): Notebook {
  return { ...emptyNotebook('urn:lib:1', 'Walk'), cells };
}

type Edge = Record<string, unknown>;
const edgesOf = (plan: ReturnType<typeof planPromotion>) =>
  (plan.ok ? (plan.payload as unknown as { edges: Edge[] }).edges : []);

describe('planPromotion', () => {
  it('writes a chain as nodes, a narrowed tuple per wire, and the last cell to the end node', () => {
    const notebook = notebookOf(
      markdownCell('## Who lives where'),
      cell('cities', 'cities'),
      cell('people', 'people', [{ from: 'value', ref: 'cities', whenEmpty: 'stop' }]),
    );
    const targets = new Map([
      ['cities', select('cities', ['city', 'label'])],
      ['people', select('people', ['person', 'name'], [['city']])],
    ]);

    const plan = planPromotion(notebook, targets);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.description).toBe('## Who lives where');

    const payload = plan.payload as unknown as {
      executionNodes: Array<Record<string, unknown>>;
      outputTuples: Array<{ id: string; memberEntries: string[] }>;
      outputs: Array<{ variableName: string }>;
    };
    expect(payload.executionNodes.map((node) => node.queryId)).toEqual(['urn:qv:cities', 'urn:qv:people']);
    // Two columns upstream, one variable in the slot: the group gets a
    // one-column tuple so the edge's arities match, holding ?city only.
    expect(payload.outputTuples).toHaveLength(1);
    expect(payload.outputs.map((o) => o.variableName)).toEqual(['city']);

    const [start, wire, end] = edgesOf(plan);
    expect(start).toMatchObject({ sourceNodeId: 'urn:__START__', dataFlowType: 'CONTROL_FLOW' });
    expect(wire).toMatchObject({
      dataFlowType: 'VARIABLE_BINDINGS', targetInputId: 'urn:in:people:0', whenEmpty: 'require',
      variableMappings: JSON.stringify([{ source: 'city', target: 'city' }]),
    });
    expect(end).toMatchObject({ targetNodeId: 'urn:__END__', sourceOutputId: 'urn:out:people' });
  });

  it('pairs by position when the names differ, as the notebook did', () => {
    const notebook = notebookOf(
      cell('a', 'a'),
      cell('b', 'b', [{ from: 'value', ref: 'a' }]),
    );
    const plan = planPromotion(notebook, new Map([
      ['a', select('a', ['x'])],
      ['b', select('b', ['y'], [['place']])],
    ]));
    expect(edgesOf(plan)[1]).toMatchObject({ variableMappings: JSON.stringify([{ source: 'x', target: 'place' }]) });
  });

  it('refuses a run cell that does not feed the last one, naming it', () => {
    const notebook = notebookOf(cell('a', 'a'), cell('b', 'b'));
    const plan = planPromotion(notebook, new Map([['a', select('a', ['x'])], ['b', select('b', ['y'])]]));
    expect(plan).toMatchObject({ ok: false, cellId: 'a' });
  });

  it('refuses a group cell, and a reference to a value bound below', () => {
    const group: QueryCell = cell('g', 'g');
    const groupPlan = planPromotion(notebookOf(group), new Map([['g', { ...select('g', []), kind: 'group' as const }]]));
    expect(groupPlan).toMatchObject({ ok: false, cellId: 'g' });

    const forward = notebookOf(cell('b', 'b', [{ from: 'value', ref: 'a' }]), cell('a', 'a'));
    const forwardPlan = planPromotion(forward, new Map([['a', select('a', ['x'])], ['b', select('b', [], [['x']])]]));
    expect(forwardPlan).toMatchObject({ ok: false, cellId: 'b' });
    if (!forwardPlan.ok) expect(forwardPlan.message).toMatch(/no cell above/);
  });

  it('hands a CONSTRUCT to a rule set over RDF and returns the rule set\'s graph', () => {
    const rules: RuleSetCell = { kind: 'ruleset', id: 'r', ruleSet: 'urn:rs:r', out: 'closure', inputGraph: { from: 'value', ref: 'graph' } };
    const plan = planPromotion(notebookOf(cell('c', 'graph'), rules), new Map<string, PromotionTarget>([
      ['c', { ...select('c', []), resultKind: 'GRAPH' }],
      ['r', { ...select('r', []), kind: 'ruleset', versionId: 'urn:rsv:r', backendId: null, outputPortId: null }],
    ]));
    expect(plan.ok).toBe(true);
    const [, rdf, end] = edgesOf(plan);
    expect(rdf).toMatchObject({ dataFlowType: 'RDF_GRAPH', sourceOutputId: 'urn:out:c' });
    expect(end).toMatchObject({ dataFlowType: 'RDF_GRAPH', targetNodeId: 'urn:__END__' });
    if (plan.ok) expect((plan.payload as unknown as { endNode: { mediaType: string } }).endNode.mediaType).toBe('application/n-triples');
  });

  it('says what it could not carry: typed values, LIMITs and skip-if-empty', () => {
    const notebook = notebookOf(
      { ...cell('a', 'a', [{ from: 'typed', bindings: [{ city: { type: 'uri', value: 'http://ex/Perth' } }] }]), limits: { '1': 5 } },
      cell('b', 'b', [{ from: 'value', ref: 'a', whenEmpty: 'skip' }]),
    );
    const plan = planPromotion(notebook, new Map([
      ['a', select('a', ['person'], [['city']])],
      ['b', select('b', ['x'], [['person']])],
    ]));
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.notes.join('\n')).toMatch(/typed for \?city are not kept/);
    expect(plan.notes.join('\n')).toMatch(/LIMIT \/ OFFSET/);
    expect(plan.notes.join('\n')).toMatch(/match nothing/);
  });
});
