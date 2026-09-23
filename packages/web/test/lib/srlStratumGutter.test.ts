import { describe, expect, it } from 'vitest';
import { Text } from '@codemirror/state';
import { bandForLine, type StratumBand } from '@/lib/srlStratumGutter';

/*
 * The gutter's only decision: which band, if any, paints a line — and whether
 * that line is the one carrying the number.
 *
 * The interesting half is the blank line between two rules. SRL is written with
 * one, and two rules in the same stratum used to draw as two stripes with a gap
 * between them, which reads as a break where the colour is saying there is none.
 */
const rule = (startLine: number, endLine: number, stratum: number | null): StratumBand =>
  ({ startLine, endLine, stratum, kind: 'rule', label: `rule ${startLine}` });

const doc = (...lines: string[]) => Text.of(lines);

describe('bandForLine', () => {
  const body = doc(
    'PREFIX : <http://example/>',
    '',
    'RULE { } WHERE { }',
    '',
    'RULE { } WHERE { }',
  );

  it('numbers a run once, at its first line', () => {
    const bands = [rule(3, 3, 0), rule(5, 5, 0)];
    expect(bandForLine(bands, body, 3)).toEqual({ band: bands[0], first: true });
    // Same stratum, one blank line apart: the second rule continues the run,
    // so it is painted but not numbered again.
    expect(bandForLine(bands, body, 5)).toEqual({ band: bands[1], first: false });
  });

  it('paints the rest of a multi-line block unlabelled', () => {
    const bands = [rule(3, 5, 0)];
    expect(bandForLine(bands, body, 3)).toEqual({ band: bands[0], first: true });
    expect(bandForLine(bands, body, 4)).toEqual({ band: bands[0], first: false });
    expect(bandForLine(bands, body, 5)).toEqual({ band: bands[0], first: false });
  });

  it('bridges a blank line between two blocks in the same stratum', () => {
    const bands = [rule(3, 3, 0), rule(5, 5, 0)];
    expect(bandForLine(bands, body, 4)).toEqual({ band: bands[0], first: false });
  });

  it('opens a new run, numbered again, where the stratum changes', () => {
    const bands = [rule(3, 3, 0), rule(5, 5, 1)];
    expect(bandForLine(bands, body, 4)).toBeNull();
    expect(bandForLine(bands, body, 5)).toEqual({ band: bands[1], first: true });
  });

  it('leaves the gap where the stratum changes kind across it', () => {
    const bands: StratumBand[] = [
      { startLine: 3, endLine: 3, stratum: null, kind: 'data', label: 'DATA' },
      rule(5, 5, null),
    ];
    expect(bandForLine(bands, body, 4)).toBeNull();
  });

  it('leaves a gap that holds something other than whitespace, and numbers what follows', () => {
    const commented = doc('RULE { } WHERE { }', '# why', 'RULE { } WHERE { }');
    const bands = [rule(1, 1, 0), rule(3, 3, 0)];
    expect(bandForLine(bands, commented, 2)).toBeNull();
    expect(bandForLine(bands, commented, 3)).toEqual({ band: bands[1], first: true });
  });

  it('paints nothing above the first band or below the last', () => {
    const bands = [rule(3, 3, 0), rule(5, 5, 0)];
    expect(bandForLine(bands, body, 1)).toBeNull();
    expect(bandForLine(bands, body, 2)).toBeNull();
  });
});

/*
 * A document that does not stratify has no strata. The gutter then marks which
 * rules are on the cycle — each one, since "which rules" is the whole question —
 * rather than merging them into a run the way it merges a stratum.
 */
describe('bandForLine on a non-stratifiable cycle', () => {
  const body = doc(
    'PREFIX : <http://example/>',
    '',
    'RULE { } WHERE { }',
    '',
    'RULE { } WHERE { }',
  );
  const onCycle = (startLine: number, endLine: number): StratumBand =>
    ({ ...rule(startLine, endLine, null), inCycle: true });

  it('marks every rule on the cycle at its own first line', () => {
    const bands = [onCycle(3, 3), onCycle(5, 5)];
    expect(bandForLine(bands, body, 3)).toEqual({ band: bands[0], first: true });
    expect(bandForLine(bands, body, 5)).toEqual({ band: bands[1], first: true });
  });

  it('does not paint the gap between two rules on the cycle', () => {
    const bands = [onCycle(3, 3), onCycle(5, 5)];
    expect(bandForLine(bands, body, 4)).toBeNull();
  });
});
