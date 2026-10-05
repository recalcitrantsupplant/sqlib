/**
 * `dateModified` is the revision `If-Match` compares, so every write must
 * change it — including two inside one millisecond (WP22).
 */
import { describe, it, expect } from 'vitest';
import { nextDateModified } from '../../src/lib/CacheCoordinator.js';

describe('nextDateModified', () => {
  const now = new Date('2026-03-01T12:00:00.000Z');

  it('is now when now is later than the previous stamp', () => {
    expect(nextDateModified('2026-03-01T11:59:59.999Z', now)).toBe('2026-03-01T12:00:00.000Z');
  });

  it('moves one millisecond past a stamp from the same millisecond', () => {
    expect(nextDateModified('2026-03-01T12:00:00.000Z', now)).toBe('2026-03-01T12:00:00.001Z');
  });

  it('moves past a stamp from the future, so a skewed clock cannot repeat a tag', () => {
    expect(nextDateModified('2026-03-01T12:00:05.000Z', now)).toBe('2026-03-01T12:00:05.001Z');
  });

  it('reads a Date as well as a string, and starts from now with neither', () => {
    expect(nextDateModified(new Date('2026-03-01T12:00:00.000Z'), now)).toBe('2026-03-01T12:00:00.001Z');
    expect(nextDateModified(undefined, now)).toBe('2026-03-01T12:00:00.000Z');
    expect(nextDateModified('not a date', now)).toBe('2026-03-01T12:00:00.000Z');
  });
});
