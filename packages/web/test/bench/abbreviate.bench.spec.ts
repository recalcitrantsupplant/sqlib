/**
 * How expensive is turning an IRI into a CURIE?
 *
 * Runs the real `usePrefixManager().abbreviateIri`, not a copy of its
 * algorithm, so the memo cache and the longest-match scan are the ones that
 * actually ship.
 *
 * Two numbers, because they answer different questions:
 *
 *   cold   every IRI distinct, so every call is a real lookup. This is the
 *          number to compare implementations on.
 *   warm   a realistic working set re-read many times, which is what the
 *          rendered table does — 25 rows redrawn out of a memo the first
 *          draw populated. The gap between the two is what the cache buys.
 */
import { describe, it, expect } from 'vitest';
import { usePrefixManager } from '@/composables/usePrefixManager';

const KNOWN = [
  'http://xmlns.com/foaf/0.1/',
  'http://www.w3.org/2004/02/skos/core#',
  'http://purl.org/dc/terms/',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
];
const UNKNOWN = 'http://example.org/no-prefix-for-this/';

/** Two thirds abbreviable, one third a miss — a miss walks the whole list. */
function corpus(count: number, distinct = true, salt = 0): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    // `salt` keeps each repeat's IRIs distinct from the previous repeat's, so a
    // shared memo cannot make a later repeat look faster than the first.
    const n = distinct ? `${salt}_${i}` : `${i % 25}`;
    out.push(i % 3 === 2 ? `${UNKNOWN}term${n}` : `${KNOWN[i % 4]!}term${n}`);
  }
  return out;
}

/**
 * Median of several timed passes, never a single one.
 *
 * A single pass on a shared runner spread 1.7 to 4.2µs/op for identical code —
 * 2.5x, which is wider than most regressions worth catching. Each repeat gets
 * its own corpus so the memo is cold every time; the median is what gets
 * asserted, and the spread is printed so a wild machine is visible rather than
 * silently moving the number.
 */
function timeOps(
  label: string,
  makeCorpus: () => string[],
  makeFn: () => (iri: string) => unknown,
  repeats = 7,
) {
  const perOps: number[] = [];
  for (let r = 0; r < repeats; r++) {
    const iris = makeCorpus();
    const fn = makeFn();
    for (let i = 0; i < 200; i++) fn(iris[i]!); // let the JIT settle
    const fresh = makeCorpus();
    const start = performance.now();
    for (const iri of fresh) fn(iri);
    perOps.push(((performance.now() - start) * 1000) / fresh.length);
  }
  const sorted = [...perOps].sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1]!;
  console.log(
    `${label.padEnd(28)} median ${median.toFixed(3).padStart(7)}µs/op` +
      `   (min ${sorted[0]!.toFixed(2)}, max ${sorted[sorted.length - 1]!.toFixed(2)}, n=${repeats})`,
  );
  return median;
}

describe('abbreviateIri cost', () => {
  it('reports per-operation cost, cold and warm', () => {
    const { abbreviateIri, enabled } = usePrefixManager();
    expect(enabled.value).toBe(true);

    // Sanity: the corpus really does abbreviate, or we are timing a no-op.
    expect(abbreviateIri(`${KNOWN[0]}alice`).wasAbbreviated).toBe(true);
    expect(abbreviateIri(`${UNKNOWN}alice`).wasAbbreviated).toBe(false);

    // A fresh manager per repeat, so "cold" means an empty memo rather than one
    // the previous repeat filled.
    let salt = 0;
    const coldPerOp = timeOps(
      'cold (all distinct)',
      () => corpus(20_000, true, salt++),
      () => usePrefixManager().abbreviateIri,
    );

    const warmPerOp = timeOps('warm (25 distinct, memoed)', () => corpus(20_000, false), () => {
      const fn = usePrefixManager().abbreviateIri;
      for (const iri of corpus(25, false)) fn(iri);
      return fn;
    });

    console.log(`\ncache speedup: ${(coldPerOp / warmPerOp).toFixed(1)}x\n`);

    /*
     * A ceiling, not a target, and a loose one on purpose.
     *
     * This runs wherever CI runs, and identical code measured 1.7 to 4.2µs/op
     * on the same box. The median above absorbs most of that, but the ceiling
     * still has to clear a bad day. What it exists to catch is a structural
     * mistake — making these lookups deep-reactive again cost 7.4x on the scan
     * alone — not a 20% drift, which no threshold could tell from the noise.
     */
    expect(coldPerOp).toBeLessThan(12);
  });
});
