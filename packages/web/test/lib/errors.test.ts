import { describe, expect, it } from 'vitest';
import { describeError } from '../../src/lib/errors';

describe('describeError', () => {
  it('reads the message off an Error', () => {
    expect(describeError(new Error('the key was rejected'))).toBe('the key was rejected');
  });

  it('passes a string through', () => {
    expect(describeError('Not Found')).toBe('Not Found');
  });

  it('never renders a plain object as [object Object]', () => {
    // The assistant chat showed exactly this, which said nothing about the cause.
    for (const value of [{ a: 1 }, {}, [], Object.create(null)]) {
      expect(describeError(value)).not.toBe('[object Object]');
    }
  });

  it('prefers a message the object is already carrying', () => {
    expect(describeError({ message: 'quota exceeded' })).toBe('quota exceeded');
    expect(describeError({ error: 'Not Found' })).toBe('Not Found');
    expect(describeError({ statusText: 'Bad Gateway' })).toBe('Bad Gateway');
  });

  it('falls back to the object itself rather than losing the detail', () => {
    expect(describeError({ status: 502, detail: 'upstream' })).toBe('{"status":502,"detail":"upstream"}');
  });

  it('says something honest when there is nothing to read', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const value of [{}, circular, null, undefined, new Error('')]) {
      expect(describeError(value)).toBe('Something failed, and it gave no reason.');
    }
  });
});
