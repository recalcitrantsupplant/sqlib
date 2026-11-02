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

  /*
   * The merge: two graph values above, one query over both. The query names no
   * backend, so the server runs it in an ephemeral store holding the graphs.
   */
  it('runs a query over graph values, sent inline, with no backend', async () => {
    callables.value = [
      { ...selectCallable('urn:q:a'), resultKind: 'GRAPH' },
      { ...selectCallable('urn:q:b'), resultKind: 'GRAPH' },
      { ...selectCallable('urn:q:merge'), resultKind: 'GRAPH' },
    ];
    const graphResponse = (triple: string) => ({ body: triple, contentType: 'application/n-triples', timing: null });
    executeTarget
      .mockResolvedValueOnce(graphResponse('<urn:a> <urn:p> <urn:b> .\n'))
      .mockResolvedValueOnce(graphResponse('<urn:c> <urn:p> <urn:d> .\n'))
      .mockResolvedValueOnce(graphResponse('<urn:a> <urn:p> <urn:b> .\n<urn:c> <urn:p> <urn:d> .\n'));

    await runIn(async (nb) => {
      const a = queryCell('urn:q:a', 'left');
      const b = queryCell('urn:q:b', 'right');
      const merge: QueryCell = { ...queryCell('urn:q:merge', 'both'), graphs: [{ from: 'value', ref: 'left' }, { from: 'value', ref: 'right' }] };
      nb.addCell(a);
      nb.addCell(b);
      nb.addCell(merge);
      await nextTick();
      await nb.runAll();

      const request = executeTarget.mock.calls[2]![0];
      expect(request.backendId).toBeUndefined();
      expect(request.dataGraphs).toEqual([
        { dataGraphInline: '<urn:a> <urn:p> <urn:b> .\n', dataGraphInlineFormat: 'application/n-triples' },
        { dataGraphInline: '<urn:c> <urn:p> <urn:d> .\n', dataGraphInlineFormat: 'application/n-triples' },
      ]);
      const merged = nb.values.value.both;
      expect(merged?.type === 'graph' && merged.tripleCount).toBe(2);
    });
  });

  /*
   * Pass by reference: a large value the server kept goes back as its handle.
   * The producer asks the server to keep it only because a cell below reads it.
   */
  it('sends a large kept value back by its handle, and asks to keep only what is read', async () => {
    callables.value = [selectCallable('urn:q:people'), selectCallable('urn:q:by-name', [['name']])];
    const many = Array.from({ length: 3000 }, (_, i) => ({ name: { type: 'literal', value: `person number ${i}` } }));
    executeTarget
      .mockResolvedValueOnce({ ...rowsResponse(['name'], many), resultRef: 'urn:sqlib:result:1' })
      .mockResolvedValueOnce(rowsResponse(['name'], []));

    await runIn(async (nb) => {
      const producer = queryCell('urn:q:people', 'people');
      const consumer = queryCell('urn:q:by-name', 'out2', [{ from: 'value', ref: 'people' }]);
      nb.addCell(producer);
      nb.addCell(consumer);
      await nextTick();
      await nb.runAll();

      const [first, second] = executeTarget.mock.calls.map((call) => call[0]);
      expect(first.keepResult).toBe(true);
      expect(second.keepResult).toBeUndefined();
      expect(second.argumentRefs).toEqual([
        { resultRef: 'urn:sqlib:result:1', columns: [{ from: 'name', to: 'name' }], vars: ['name'] },
      ]);
      expect(second.arguments ?? []).toEqual([]);
    });
  });

  it('sends a small value by content even when the server kept it', async () => {
    callables.value = [selectCallable('urn:q:people'), selectCallable('urn:q:by-name', [['name']])];
    executeTarget
      .mockResolvedValueOnce({ ...rowsResponse(['name'], [{ name: { type: 'literal', value: 'Ada' } }]), resultRef: 'urn:sqlib:result:1' })
      .mockResolvedValueOnce(rowsResponse(['name'], []));

    await runIn(async (nb) => {
      nb.addCell(queryCell('urn:q:people', 'people'));
      nb.addCell(queryCell('urn:q:by-name', 'out2', [{ from: 'value', ref: 'people' }]));
      await nextTick();
      await nb.runAll();

      const second = executeTarget.mock.calls[1]![0];
      expect(second.argumentRefs ?? []).toEqual([]);
      expect(second.arguments).toHaveLength(1);
    });
  });

  it('sends the value by content when its handle has expired', async () => {
    callables.value = [{ ...selectCallable('urn:q:a'), resultKind: 'GRAPH' }, { ...selectCallable('urn:q:merge'), resultKind: 'GRAPH' }];
    const big = Array.from({ length: 2000 }, (_, i) => `<urn:s:${i}> <urn:p> <urn:o:${i}> .`).join('\n');
    executeTarget
      .mockResolvedValueOnce({ body: big, contentType: 'application/n-triples', timing: null, resultRef: 'urn:sqlib:result:g' })
      .mockRejectedValueOnce({ statusCode: 410, message: 'The kept result has expired' })
      .mockResolvedValueOnce({ body: big, contentType: 'application/n-triples', timing: null });

    await runIn(async (nb) => {
      const a = queryCell('urn:q:a', 'left');
      const merge: QueryCell = { ...queryCell('urn:q:merge', 'both'), graphs: [{ from: 'value', ref: 'left' }] };
      nb.addCell(a);
      nb.addCell(merge);
      await nextTick();
      await nb.runAll();

      const calls = executeTarget.mock.calls.map((call) => call[0]);
      expect(calls[1].dataGraphs).toEqual([{ resultRef: 'urn:sqlib:result:g' }]);
      expect(calls[2].dataGraphs).toEqual([{ dataGraphInline: big, dataGraphInlineFormat: 'application/n-triples' }]);
      expect(nb.stateFor(merge.id).status).toBe('ok');
    });
  });

  it('sends a large kept graph to a rule set by its handle', async () => {
    callables.value = [{ ...selectCallable('urn:q:construct'), resultKind: 'GRAPH' }];
    ruleSets.value = [{ id: 'urn:rs:1', name: 'closure', description: null, isPartOf: [LIBRARY], currentVersionNumber: 1 }];
    const big = Array.from({ length: 2000 }, (_, i) => `<urn:s:${i}> <urn:p> <urn:o:${i}> .`).join('\n');
    executeTarget.mockResolvedValueOnce({ body: big, contentType: 'application/n-triples', timing: null, resultRef: 'urn:sqlib:result:g' });
    executeRuleSet.mockResolvedValue({ status: 'converged', iterations: [], dataBlocks: [], finalGraphNQuads: '<urn:a> <urn:p> <urn:b> .', resultRef: null });

    await runIn(async (nb) => {
      nb.addCell(queryCell('urn:q:construct', 'graph'));
      nb.addCell({ kind: 'ruleset', id: mintCellId(), ruleSet: 'urn:rs:1', out: 'closure', inputGraph: { from: 'value', ref: 'graph' } });
      await nextTick();
      await nb.runAll();

      expect(executeRuleSet).toHaveBeenCalledWith('urn:rs:1', { dataGraphResultRef: 'urn:sqlib:result:g' });
    });
  });

  it('refuses to run a cell that reads a value bound below it', async () => {
    callables.value = [selectCallable('urn:q:people'), selectCallable('urn:q:by-name', [['name']])];
    executeTarget.mockResolvedValue(rowsResponse(['name'], [{ name: { type: 'literal', value: 'Ada' } }]));

    await runIn(async (nb) => {
      const producer = queryCell('urn:q:people', 'people');
      const consumer = queryCell('urn:q:by-name', 'out2', [{ from: 'value', ref: 'people' }]);
      nb.addCell(producer);
      nb.addCell(consumer);
      await nextTick();
      await nb.run(producer.id);
      nb.moveCell(consumer.id, -1);
      await nextTick();

      expect(nb.problemsFor(consumer.id)).toEqual(['@people is not bound by a cell above this one.']);
      await nb.run(consumer.id);
      expect(nb.stateFor(consumer.id).status).toBe('error');
      expect(executeTarget).toHaveBeenCalledTimes(1);
    });
  });

  it('runs every cell down to the one asked for, and none below it', async () => {
    callables.value = [selectCallable('urn:q:people')];
    executeTarget.mockResolvedValue(rowsResponse(['name'], []));

    await runIn(async (nb) => {
      const cells = ['a', 'b', 'c'].map((name) => queryCell('urn:q:people', name));
      cells.forEach((cell) => nb.addCell(cell));
      await nextTick();
      await nb.runUpTo(cells[1]!.id);

      expect(executeTarget).toHaveBeenCalledTimes(2);
      expect(nb.stateFor(cells[2]!.id).status).toBe('idle');
    });
  });

  it('binds a rule set that stopped at its iteration limit, warns, and stops Run all there', async () => {
    callables.value = [selectCallable('urn:q:people')];
    ruleSets.value = [{ id: 'urn:rs:1', name: 'closure', description: null, isPartOf: [LIBRARY], currentVersionNumber: 1 }];
    executeRuleSet.mockResolvedValue({ status: 'maxIterations', iterations: [], dataBlocks: [], finalGraphNQuads: '<urn:a> <urn:p> <urn:b> .' });
    executeTarget.mockResolvedValue(rowsResponse(['name'], []));

    await runIn(async (nb) => {
      const rules: RuleSetCell = { kind: 'ruleset', id: mintCellId(), ruleSet: 'urn:rs:1', out: 'closure' };
      const after = queryCell('urn:q:people', 'after');
      nb.addCell(rules);
      nb.addCell(after);
      await nextTick();
      await nb.runAll();

      expect(nb.values.value.closure?.type).toBe('graph');
      expect(nb.stateFor(rules.id).warning).toContain('iteration limit');
      expect(executeTarget).not.toHaveBeenCalled();
    });
  });

  it('moves a cell to a position, as a drag ends', async () => {
    await runIn(async (nb) => {
      const cells = ['a', 'b', 'c'].map((name) => queryCell('urn:q:people', name));
      cells.forEach((cell) => nb.addCell(cell));
      await nextTick();
      nb.moveCellTo(cells[0]!.id, 2);
      expect(nb.notebook.value.cells.map((cell) => (cell as QueryCell).out)).toEqual(['b', 'c', 'a']);
      nb.moveCellTo(cells[0]!.id, 0);
      expect(nb.notebook.value.cells.map((cell) => (cell as QueryCell).out)).toEqual(['a', 'b', 'c']);
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

      expect(executeTarget).toHaveBeenCalledWith(
        {
          targetId: 'urn:q:people',
          arguments: [
            {
              head: { vars: ['city'] },
              results: { bindings: [{ city: { type: 'uri', value: 'urn:city:1' } }] },
            },
          ],
        },
        undefined,
      );
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

      expect(executeTarget).toHaveBeenLastCalledWith(
        {
          targetId: 'urn:q:second',
          arguments: [
            { head: { vars: ['asset'] }, results: { bindings: [{ asset: { type: 'uri', value: 'urn:a' } }] } },
          ],
        },
        undefined,
      );
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

  /*
   * The store is sent explicitly even when it is the library's default: which
   * backend a cell ran against is a fact the notebook shows, and leaving it out
   * would let that answer change under the reader when the default moves.
   */
  it('runs against the cell backend, falling back to the library default', async () => {
    callables.value = [selectCallable('urn:q:people')];
    executeTarget.mockResolvedValue(rowsResponse(['name'], []));

    const scope = effectScope();
    await scope.run(async () => {
      const nb = useNotebook(ref(LIBRARY), ref('urn:backend:library-default'));
      const fallback = queryCell('urn:q:people', 'out1');
      const named: QueryCell = { ...queryCell('urn:q:people', 'out2'), backend: 'urn:backend:ephemeral' };
      nb.addCell(fallback);
      nb.addCell(named);
      await nextTick();

      await nb.run(fallback.id);
      expect(executeTarget).toHaveBeenLastCalledWith(
        expect.objectContaining({ backendId: 'urn:backend:library-default' }),
        undefined,
      );

      await nb.run(named.id);
      expect(executeTarget).toHaveBeenLastCalledWith(
        expect.objectContaining({ backendId: 'urn:backend:ephemeral' }),
        undefined,
      );
    });
    scope.stop();
  });

  it('never sends a backend for a group, even one left on the cell', async () => {
    callables.value = [{ ...selectCallable('urn:g:orders'), type: 'group' }];
    executeTarget.mockResolvedValue(rowsResponse(['name'], []));

    const scope = effectScope();
    await scope.run(async () => {
      const nb = useNotebook(ref(LIBRARY), ref('urn:backend:library-default'));
      const cell = { kind: 'group' as const, id: mintCellId(), group: 'urn:g:orders', out: 'orders', backend: 'urn:backend:x' };
      nb.addCell(cell);
      await nextTick();
      await nb.run(cell.id);

      expect(executeTarget.mock.calls[0]![0].backendId).toBeUndefined();
    });
    scope.stop();
  });

  it('binds a SELECT asked for as CSV or TSV as rows, not a graph', async () => {
    callables.value = [selectCallable('urn:q:people')];
    executeTarget
      .mockResolvedValueOnce({ body: 'name,home\nAda,http://example.org/london\n', contentType: 'text/csv', timing: null, resultRef: 'urn:sqlib:result:1' })
      .mockResolvedValueOnce({ body: '?name\n"Ada"@en\n', contentType: 'text/tab-separated-values', timing: null });

    await runIn(async (nb) => {
      const csv: QueryCell = { ...queryCell('urn:q:people', 'csv'), accept: 'text/csv' };
      const tsv: QueryCell = { ...queryCell('urn:q:people', 'tsv'), accept: 'text/tab-separated-values' };
      nb.addCell(csv);
      nb.addCell(tsv);
      await nextTick();
      await nb.runAll();

      const fromCsv = nb.values.value.csv;
      expect(fromCsv?.type).toBe('rows');
      expect(fromCsv?.type === 'rows' && fromCsv.columns).toEqual(['name', 'home']);
      expect(fromCsv?.type === 'rows' && fromCsv.bindings[0]).toEqual({
        name: { type: 'literal', value: 'Ada' },
        home: { type: 'uri', value: 'http://example.org/london' },
      });
      expect(fromCsv?.resultRef).toBeNull();
      const fromTsv = nb.values.value.tsv;
      expect(fromTsv?.type === 'rows' && fromTsv.bindings[0]).toEqual({ name: { type: 'literal', value: 'Ada', 'xml:lang': 'en' } });
    });
  });

  it("prefers the query's own default backend over the library's", async () => {
    callables.value = [{ ...selectCallable('urn:q:people'), defaultBackend: 'urn:backend:query-default' }];
    executeTarget.mockResolvedValue(rowsResponse(['name'], []));

    const scope = effectScope();
    await scope.run(async () => {
      const nb = useNotebook(ref(LIBRARY), ref('urn:backend:library-default'));
      const cell = queryCell('urn:q:people', 'out1');
      nb.addCell(cell);
      await nextTick();

      expect(nb.defaultBackendFor(cell)).toBe('urn:backend:query-default');
      await nb.run(cell.id);
      expect(executeTarget).toHaveBeenLastCalledWith(
        expect.objectContaining({ backendId: 'urn:backend:query-default' }),
        undefined,
      );
    });
    scope.stop();
  });

  it('asks for the format the cell names', async () => {
    callables.value = [selectCallable('urn:q:people')];
    executeTarget.mockResolvedValue({
      body: '<urn:a> <urn:p> <urn:b> .',
      contentType: 'text/turtle',
      timing: null,
    });

    await runIn(async (nb) => {
      const cell: QueryCell = { ...queryCell('urn:q:people', 'out1'), accept: 'text/turtle' };
      nb.addCell(cell);
      await nextTick();
      await nb.run(cell.id);

      expect(executeTarget).toHaveBeenLastCalledWith(expect.anything(), 'text/turtle');
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

      expect(nb.renameOutput(second.id, 'out1')).toContain('already used');
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
