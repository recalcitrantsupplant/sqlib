import { describe, it, expect } from 'vitest';
import { formatCompactAge } from '@/lib/time';

const NOW = Date.parse('2026-08-06T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('formatCompactAge', () => {
  it('reads the recent past in one or two characters', () => {
    expect(formatCompactAge(ago(2_000), NOW)).toBe('now');
    expect(formatCompactAge(ago(42_000), NOW)).toBe('42s');
    expect(formatCompactAge(ago(20 * 60_000), NOW)).toBe('20m');
    expect(formatCompactAge(ago(2 * 3_600_000), NOW)).toBe('2h');
    expect(formatCompactAge(ago(3 * 86_400_000), NOW)).toBe('3d');
  });

  it('never renders a negative age from a clock that ran backwards', () => {
    expect(formatCompactAge(new Date(NOW + 60_000).toISOString(), NOW)).toBe('now');
  });

  it('returns nothing for absent or unparseable input', () => {
    expect(formatCompactAge(null, NOW)).toBe('');
    expect(formatCompactAge('not a date', NOW)).toBe('');
  });
});
