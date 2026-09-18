/**
 * Labels at bind time.
 *
 * The three outcomes are the design: arity is an error, a name collision is a
 * warning, and everything else is one line saying matching is positional. What
 * these also pin down is the thing that must never happen — a label changing a
 * verdict. The collision case is a *warning*, not a refusal, and nothing here
 * returns a different binding depending on what the columns are called.
 */
import { describe, it, expect } from 'vitest';
import { parseTupleDeclarations, tupleBindNotice } from '@/lib/tupleSetLabels';

describe('parseTupleDeclarations', () => {
  it('reads a declaration and its ground lead term', () => {
    expect(parseTupleDeclarations('RULE { TUPLE(:seed, ?x, ?y) }')).toEqual([[':seed', '?x', '?y']]);
  });

  it('ignores a ground TUPLE, which is a row rather than a shape', () => {
    expect(parseTupleDeclarations('TUPLE(:reach, :a, :b) .')).toEqual([]);
  });

  it('finds every declaration in a document', () => {
    const document = 'RULE { TUPLE(?a, ?b) } RULE { TUPLE(:seed, ?x) }';
    expect(parseTupleDeclarations(document)).toEqual([['?a', '?b'], [':seed', '?x']]);
  });
});

describe('tupleBindNotice', () => {
  it('refuses an arity mismatch, which no naming can fix', () => {
    const notice = tupleBindNotice(['x', 'y'], [':seed', '?x', '?y']);
    expect(notice.level).toBe('error');
    expect(notice.message).toContain('2 columns');
    expect(notice.message).toContain('takes 3');
  });

  it('warns when the labels are the declaration\'s names in a different order', () => {
    const notice = tupleBindNotice([':seed', 'y', 'x'], [':seed', '?x', '?y']);
    expect(notice.level).toBe('warning');
    expect(notice.message).toContain('y | x');
    expect(notice.message).toContain('?x ?y');
  });

  it('is only an info line when the labels agree, because they are still ignored', () => {
    const notice = tupleBindNotice(['seed', 'x', 'y'], [':seed', '?x', '?y']);
    expect(notice.level).toBe('info');
    expect(notice.message).toContain('positional');
  });

  /*
   * Labels that have nothing to do with the declaration's variables are the
   * normal case — a CSV import brings its own headers — and say nothing beyond
   * the positional line. Only same-names-wrong-order is the trap.
   */
  it('does not warn about unrelated labels', () => {
    expect(tupleBindNotice(['city', 'population'], ['?x', '?y']).level).toBe('info');
  });

  it('says nothing extra when a column has no label at all', () => {
    expect(tupleBindNotice(['', ''], ['?y', '?x']).level).toBe('info');
  });

  /*
   * The load-bearing assertion: renaming the columns cannot change what binds.
   * The notice may differ; the binding never does, because nothing here returns
   * one.
   */
  it('never turns a label into a verdict', () => {
    const declaration = ['?x', '?y'];
    for (const columns of [['x', 'y'], ['y', 'x'], ['a', 'b'], ['', '']]) {
      expect(tupleBindNotice(columns, declaration).level).not.toBe('error');
    }
  });
});
