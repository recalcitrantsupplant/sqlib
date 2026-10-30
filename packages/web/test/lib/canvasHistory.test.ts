/**
 * The canvas history: undo walks back, redo walks forward, and a new edit
 * after an undo drops what could have been redone.
 */
import { describe, expect, it } from 'vitest';
import { createSnapshotHistory } from '../../src/lib/canvasHistory';

const entry = (key: string) => ({ key });

describe('createSnapshotHistory', () => {
  it('undoes and redoes in order', () => {
    const history = createSnapshotHistory();
    history.reset(entry('a'));
    history.record(entry('b'));
    history.record(entry('c'));
    expect(history.undo()?.key).toBe('b');
    expect(history.undo()?.key).toBe('a');
    expect(history.undo()).toBeNull();
    expect(history.redo()?.key).toBe('b');
    expect(history.redo()?.key).toBe('c');
    expect(history.redo()).toBeNull();
  });

  it('ignores a state it already holds', () => {
    const history = createSnapshotHistory();
    history.reset(entry('a'));
    expect(history.record(entry('a'))).toBe(false);
    expect(history.canUndo()).toBe(false);
  });

  it('drops the redo branch on a new edit', () => {
    const history = createSnapshotHistory();
    history.reset(entry('a'));
    history.record(entry('b'));
    history.undo();
    expect(history.canRedo()).toBe(true);
    history.record(entry('x'));
    expect(history.canRedo()).toBe(false);
    expect(history.undo()?.key).toBe('a');
  });

  it('keeps at most the limit', () => {
    const history = createSnapshotHistory(2);
    history.reset(entry('0'));
    for (const key of ['1', '2', '3']) history.record(entry(key));
    expect(history.undo()?.key).toBe('2');
    expect(history.undo()?.key).toBe('1');
    expect(history.undo()).toBeNull();
  });

  it('takes the first record as the start when never reset', () => {
    const history = createSnapshotHistory();
    expect(history.record(entry('a'))).toBe(false);
    history.record(entry('b'));
    expect(history.undo()?.key).toBe('a');
  });
});
