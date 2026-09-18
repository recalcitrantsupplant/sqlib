/**
 * The notebook's run loop.
 *
 * What is worth pinning here is everything that makes a notebook more than a
 * list of queries: a value bound under a name, the next cell reading it, the
 * cells below going stale when it is rebound, and the request that carries it
 * being the payload `/execute` takes rather than substituted text.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { effectScope, nextTick, ref } from 'vue';

const executeTarget = vi.fn();
const executeRuleSet = vi.fn();
const createDataGraph = vi.fn();
const createDataGraphVersion = vi.fn();
const createTupleSet = vi.fn();
const createTupleSetVersion = vi.fn();

vi.mock('@/composables/useApiClient', () => ({
  useApiClient: () => ({
    executeTarget,
    executeRuleSet,
    createDataGraph,
    createDataGraphVersion,
    createTupleSet,
    createTupleSetVersion,
  }),
}));

const callables = ref<unknown[]>([]);
const load = vi.fn();

vi.mock('@/composables/useCallables', () => ({
  useCallables: () => ({ callables, loading: ref(false), load }),
}));

const ruleSets = ref<unknown[]>([]);
const fetchRuleSets = vi.fn();

vi.mock('@/composables/useRuleSetsStore', () => ({
  useRuleSetsStore: () => ({ ruleSets, fetchRuleSets }),
}));

import { useNotebook } from '@/composables/useNotebook';
import { mintCellId, type QueryCell, type RuleSetCell } from '@/lib/notebookFormat';

const LIBRARY = 'urn:lib:1';

function selectCallable(id: string, slots: string[][] = []) {
  return {
    id,
    name: id.split(':').pop(),
    description: null,
    type: 'query',
    state: 'live',
    version: 1,
    libraryId: LIBRARY,
    resultKind: 'BINDINGS',
    inputTuples: slots.map((members, index) => ({
      id: `${id}#tuple-${index}`,
      name: null,
      members: members.map((variableName) => ({ variableName, datatype: null })),
    })),
    limitParameters: [],
    offsetParameters: [],
    outputs: [],
    composes: null,
  };
}

function rowsResponse(vars: string[], bindings: Array<Record<string, unknown>>) {
  return {
    body: JSON.stringify({ head: { vars }, results: { bindings } }),
    contentType: 'application/sparql-results+json',
    timing: null,
  };
}

function runIn(fn: (nb: ReturnType<typeof useNotebook>) => Promise<void> | void) {
  const scope = effectScope();
  return scope.run(async () => {
    const nb = useNotebook(ref(LIBRARY));
    await fn(nb);
    scope.stop();
  }) as Promise<void>;
}

function queryCell(query: string, out: string, slots?: QueryCell['slots']): QueryCell {
  return { kind: 'query', id: mintCellId(), query, out, ...(slots ? { slots } : {}) };
}

describe('running a cell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callables.value = [];
    ruleSets.value = [];
  });

  it('binds a SELECT result under the cell name, with its stats', async () => {
    callables.value = [selectCallable('urn:q:people')];
    executeTarget.mockResolvedValue(rowsResponse(['name'], [{ name: { type: 'literal', value: 'Ada' } }]));

    await runIn(async (nb) => {
      const cell = queryCell('urn:q:people', 'candidates');
      nb.addCell(cell);
      await nextTick();
      await nb.run(cell.id);

      const value = nb.values.value.candidates;
      expect(value?.type).toBe('rows');
      expect(value && value.type === 'rows' && value.bindings).toHaveLength(1);
      expect(nb.stateFor(cell.id).status).toBe('ok');
    });
  });

  it('sends the payload to /execute rather than substituted text', async () => {
    callables.value = [selectCallable('urn:q:people', [['city']])];
    executeTarget.mockResolvedValue(rowsResponse(['name'], []));

    await runIn(async (nb) => {
      const cell = queryCell('urn:q:people', 'out1', [
        { from: 'typed', bindings: [{ city: { type: 'uri', value: 'urn:city:1' } }] },
      ]);
      nb.addCell(cell);
      await nextTick();
      await nb.run(cell.id);

      expect(executeTarget).toHaveBeenCalledWith({
        targetId: 'urn:q:people',
        arguments: [
          {
            head: { vars: ['city'] },
            arguments: { bindings: [{ city: { type: 'uri', value: 'urn:city:1' } }] },
          },
        ],
      });
    });
  });

  it('pipes one cell rows into the next cell slot, renamed to its variables', async () => {
    callables.value = [selectCallable('urn:q:first'), selectCallable('urn:q:second', [['asset']])];
    executeTarget
      .mockResolvedValueOnce(rowsResponse(['s'], [{ s: { type: 'uri', value: 'urn:a' } }]))
      .mockResolvedValueOnce(rowsResponse(['out'], []));

    await runIn(async (nb) => {
      const first = queryCell('urn:q:first', 'candidates');
      const second = queryCell('urn:q:second', 'out2', [{ from: 'value', ref: 'candidates' }]);
      nb.addCell(first);
      nb.addCell(second);
      await nextTick();

      await nb.run(first.id);
      await nb.run(second.id);

      expect(executeTarget).toHaveBeenLastCalledWith({
        targetId: 'urn:q:second',
        arguments: [
          { head: { vars: ['asset'] }, arguments: { bindings: [{ asset: { type: 'uri', value: 'urn:a' } }] } },
        ],
      });
    });
  });

  it('marks the cells below stale when an upstream value is rebound, and does not re-run them', async () => {
    callables.value = [selectCallable('urn:q:first'), selectCallable('urn:q:second', [['asset']])];
    executeTarget.mockResolvedValue(rowsResponse(['s'], [{ s: { type: 'uri', value: 'urn:a' } }]));

    await runIn(async (nb) => {
      const first = queryCell('urn:q:first', 'candidates');
      const second = queryCell('urn:q:second', 'out2', [{ from: 'value', ref: 'candidates' }]);
      nb.addCell(first);
      nb.addCell(second);
      await nextTick();

      await nb.run(first.id);
      await nb.run(second.id);
      expect(nb.stateFor(second.id).stale).toBe(false);

      const callsBefore = executeTarget.mock.calls.length;
      await nb.run(first.id);

      expect(nb.stateFor(second.id).stale).toBe(true);
      expect(executeTarget.mock.calls.length).toBe(callsBefore + 1);
    });
  });

  it('skips a cell whose referenced value came back empty', async () => {
    callables.value = [selectCallable('urn:q:first'), selectCallable('urn:q:second', [['asset']])];
    executeTarget.mockResolvedValueOnce(rowsResponse(['s'], []));

    await runIn(async (nb) => {
      const first = queryCell('urn:q:first', 'candidates');
      const second = queryCell('urn:q:second', 'out2', [
        { from: 'value', ref: 'candidates', whenEmpty: 'skip' },
      ]);
      nb.addCell(first);
      nb.addCell(second);
      await nextTick();

      await nb.run(first.id);
      await nb.run(second.id);

      expect(nb.stateFor(second.id).status).toBe('skipped');
      expect(executeTarget).toHaveBeenCalledTimes(1);
    });
  });

  it('refuses to put a graph into a parameter slot, in the server own terms', async () => {
    callables.value = [selectCallable('urn:q:construct'), selectCallable('urn:q:second', [['asset']])];
    executeTarget
      .mockResolvedValueOnce({ body: '<urn:a> <urn:p> <urn:b> .', contentType: 'text/turtle', timing: null });

    await runIn(async (nb) => {
      const first = queryCell('urn:q:construct', 'graph1');
      const second = queryCell('urn:q:second', 'out2', [{ from: 'value', ref: 'graph1' }]);
      nb.addCell(first);
      nb.addCell(second);
      await nextTick();

      await nb.run(first.id);
      await nb.run(second.id);

      expect(nb.stateFor(second.id).status).toBe('error');
      expect(nb.stateFor(second.id).error).toContain('a parameter slot takes rows');
    });
  });

  it('feeds a graph into a rule set as the base graph, by value', async () => {
    callables.value = [selectCallable('urn:q:construct')];
    ruleSets.value = [
      { id: 'urn:rs:1', name: 'closure', description: null, isPartOf: [LIBRARY], currentVersionNumber: 2 },
    ];
    executeTarget.mockResolvedValue({
      body: '<urn:a> <urn:p> <urn:b> .',
      contentType: 'application/n-triples',
      timing: null,
    });
    executeRuleSet.mockResolvedValue({
      status: 'converged',
      iterations: [],
      dataBlocks: [],
      finalGraphNQuads: '<urn:a> <urn:p> <urn:b> .\n<urn:a> <urn:q> <urn:c> .',
    });

    await runIn(async (nb) => {
      const construct = queryCell('urn:q:construct', 'neighbourhood');
      const rules: RuleSetCell = {
        kind: 'ruleset',
        id: mintCellId(),
        ruleSet: 'urn:rs:1',
        out: 'closure',
        inputGraph: { from: 'value', ref: 'neighbourhood' },
      };
      nb.addCell(construct);
      nb.addCell(rules);
      await nextTick();

      await nb.run(construct.id);
      await nb.run(rules.id);

      expect(executeRuleSet).toHaveBeenCalledWith('urn:rs:1', {
        dataGraphInline: '<urn:a> <urn:p> <urn:b> .',
        dataGraphInlineFormat: 'application/n-triples',
      });
      const value = nb.values.value.closure;
      expect(value?.type).toBe('graph');
      expect(value && value.type === 'graph' && value.tripleCount).toBe(2);
    });
  });

  it('reports the server own message when a run fails', async () => {
    callables.value = [selectCallable('urn:q:people')];
    executeTarget.mockRejectedValue({ statusMessage: 'Backend refused the query' });

    await runIn(async (nb) => {
      const cell = queryCell('urn:q:people', 'out1');
      nb.addCell(cell);
      await nextTick();
      await nb.run(cell.id);

      expect(nb.stateFor(cell.id).error).toBe('Backend refused the query');
    });
  });

  it('says so when a cell names something the library no longer holds', async () => {
    await runIn(async (nb) => {
      const cell = queryCell('urn:q:gone', 'out1');
      nb.addCell(cell);
      await nextTick();
      await nb.run(cell.id);

      expect(nb.stateFor(cell.id).error).toContain('no longer holds');
      expect(executeTarget).not.toHaveBeenCalled();
    });
  });
});

describe('editing the document', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callables.value = [selectCallable('urn:q:people')];
    ruleSets.value = [];
  });

  it('carries the bound value and every reference through a rename', async () => {
    executeTarget.mockResolvedValue(rowsResponse(['name'], [{ name: { type: 'literal', value: 'Ada' } }]));

    await runIn(async (nb) => {
      const cell = queryCell('urn:q:people', 'out1');
      nb.addCell(cell);
      await nextTick();
      await nb.run(cell.id);

      expect(nb.renameOutput(cell.id, 'candidates')).toBeNull();
      expect(nb.values.value.candidates).toBeDefined();
      expect(nb.values.value.out1).toBeUndefined();
    });
  });

  it('refuses a name another cell already binds', async () => {
    await runIn(async (nb) => {
      const first = queryCell('urn:q:people', 'out1');
      const second = queryCell('urn:q:people', 'out2');
      nb.addCell(first);
      nb.addCell(second);
      await nextTick();

      expect(nb.renameOutput(second.id, 'out1')).toContain('already bound');
    });
  });

  it('drops the value with the cell that bound it', async () => {
    executeTarget.mockResolvedValue(rowsResponse(['name'], []));

    await runIn(async (nb) => {
      const cell = queryCell('urn:q:people', 'out1');
      nb.addCell(cell);
      await nextTick();
      await nb.run(cell.id);
      nb.removeCell(cell.id);

      expect(nb.values.value.out1).toBeUndefined();
    });
  });
});

describe('saving a value', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    callables.value = [selectCallable('urn:q:people')];
    ruleSets.value = [];
  });

  it('promotes rows to a tuple set version, as query results', async () => {
    executeTarget.mockResolvedValue(rowsResponse(['name'], [{ name: { type: 'literal', value: 'Ada' } }]));
    createTupleSet.mockResolvedValue({ data: { id: 'urn:ts:1' } });
    createTupleSetVersion.mockResolvedValue({});

    await runIn(async (nb) => {
      const cell = queryCell('urn:q:people', 'out1');
      nb.addCell(cell);
      await nextTick();
      await nb.run(cell.id);
      await nb.saveValue('out1', 'People');

      expect(createTupleSet).toHaveBeenCalledWith(expect.objectContaining({ name: 'People', isPartOf: [LIBRARY] }));
      expect(createTupleSetVersion).toHaveBeenCalledWith(
        'urn:ts:1',
        expect.objectContaining({ sourceFormat: 'query-results' }),
      );
    });
  });

  it('promotes a graph to a data graph version, keeping its serialization', async () => {
    executeTarget.mockResolvedValue({
      body: '<urn:a> <urn:p> <urn:b> .',
      contentType: 'text/turtle',
      timing: null,
    });
    createDataGraph.mockResolvedValue({ data: { id: 'urn:dg:1' } });
    createDataGraphVersion.mockResolvedValue({});

    await runIn(async (nb) => {
      const cell = queryCell('urn:q:people', 'out1');
      nb.addCell(cell);
      await nextTick();
      await nb.run(cell.id);
      await nb.saveValue('out1', 'Neighbourhood');

      expect(createDataGraphVersion).toHaveBeenCalledWith(
        'urn:dg:1',
        expect.objectContaining({ contentString: '<urn:a> <urn:p> <urn:b> .', contentFormat: 'text/turtle' }),
      );
    });
  });
});
