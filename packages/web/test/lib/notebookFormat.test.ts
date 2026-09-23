import { describe, it, expect } from 'vitest';
import {
  NOTEBOOK_FORMAT,
  dependentCellIds,
  emptyNotebook,
  markdownCell,
  mintCellId,
  nextValueName,
  parseNotebook,
  parseNotebookJson,
  renameValue,
  serializeNotebook,
  validateNotebook,
  type Notebook,
  type QueryCell,
  type RuleSetCell,
} from '@/lib/notebookFormat';

function queryCell(out: string, ref?: string): QueryCell {
  return {
    kind: 'query',
    id: mintCellId(),
    query: `urn:q:${out}`,
    out,
    slots: ref ? [{ from: 'value', ref }] : [{ from: 'typed', bindings: [{}] }],
  };
}

function notebookOf(...cells: Notebook['cells']): Notebook {
  return { ...emptyNotebook('urn:lib:1', 'Test'), cells };
}

describe('notebook document', () => {
  it('round-trips through serialise and parse', () => {
    const notebook = notebookOf(markdownCell('# Hello'), queryCell('out1'));
    expect(parseNotebookJson(serializeNotebook(notebook))).toEqual(notebook);
  });

  it('refuses a document written in a format it does not know', () => {
    expect(() => parseNotebook({ format: 'sqlib-notebook/9', cells: [] })).toThrow(/Unsupported/);
  });

  it('keeps unknown cell fields out rather than carrying them through', () => {
    const parsed = parseNotebook({
      format: NOTEBOOK_FORMAT,
      title: 'T',
      library: 'urn:lib:1',
      cells: [{ kind: 'query', id: 'c1', query: 'urn:q:1', out: 'out1', mystery: 'kept?' }],
    });
    expect(parsed.cells[0]).not.toHaveProperty('mystery');
  });

  it('hands out the next free value name, counting from the highest taken', () => {
    const notebook = notebookOf(queryCell('out1'), queryCell('out7'));
    expect(nextValueName(notebook)).toBe('out8');
  });
});

describe('references', () => {
  it('rewrites every reference when a value is renamed', () => {
    const producer = queryCell('out1');
    const consumer = queryCell('out2', 'out1');
    const ruleSet: RuleSetCell = {
      kind: 'ruleset',
      id: mintCellId(),
      ruleSet: 'urn:rs:1',
      out: 'out3',
      inputGraph: { from: 'value', ref: 'out1' },
    };

    const renamed = renameValue(notebookOf(producer, consumer, ruleSet), 'out1', 'candidates');

    expect((renamed.cells[0] as QueryCell).out).toBe('candidates');
    expect((renamed.cells[1] as QueryCell).slots?.[0]).toEqual({ from: 'value', ref: 'candidates' });
    expect((renamed.cells[2] as RuleSetCell).inputGraph).toEqual({ from: 'value', ref: 'candidates' });
  });

  it('reports a reference to a value bound below it', () => {
    const problems = validateNotebook(notebookOf(queryCell('out2', 'out1'), queryCell('out1')));
    expect(problems).toHaveLength(1);
    expect(problems[0]?.message).toContain('@out1 is not bound by a cell above');
  });

  it('reports a name bound twice', () => {
    const problems = validateNotebook(notebookOf(queryCell('same'), queryCell('same')));
    expect(problems.some((problem) => problem.message.includes('bound twice'))).toBe(true);
  });

  it('accepts a chain that only reads upwards', () => {
    expect(validateNotebook(notebookOf(queryCell('out1'), queryCell('out2', 'out1')))).toEqual([]);
  });
});

describe('staleness', () => {
  it('follows a chain transitively', () => {
    const first = queryCell('out1');
    const second = queryCell('out2', 'out1');
    const third = queryCell('out3', 'out2');
    const unrelated = queryCell('out4');

    const dependents = dependentCellIds(notebookOf(first, second, third, unrelated), first.id);

    expect(dependents).toEqual([second.id, third.id]);
  });

  it('never looks upwards: a cell above cannot depend on one below', () => {
    const first = queryCell('out1');
    const second = queryCell('out2', 'out1');
    expect(dependentCellIds(notebookOf(first, second), second.id)).toEqual([]);
  });
});
