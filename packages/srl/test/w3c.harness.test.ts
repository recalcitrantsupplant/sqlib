import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkWellFormed, parseRuleSet, stratify } from '../src/index.js';

/**
 * Manifest-driven W3C SPARQL-RL conformance harness.
 *
 * Vendored snapshot under ./w3c (pinned — see w3c/SOURCE). We drive every
 * manifest entry, decide whether our implementation *conforms* to the test's
 * expected accept/reject, and maintain:
 *   - w3c/scoreboard.json    — per-category pass/fail/total (regenerated)
 *   - w3c/expected-pass.json — ratchet baseline of conforming test names
 *
 * The suite may exercise more than we implement, so a test may be expected-fail.
 * The assertion is a ratchet: no test that previously conformed may regress. New
 * conformances are reported and, on first run, the baseline is written.
 */

const w3cUrl = (rel: string) => fileURLToPath(new URL(`./w3c/${rel}`, import.meta.url));

type Kind = 'syntax' | 'wellformed' | 'stratification';
interface Entry {
  kind: Kind;
  name: string;
  positive: boolean;
  file: string;
}

const CATEGORIES: Array<{ dir: Kind }> = [{ dir: 'syntax' }, { dir: 'wellformed' }, { dir: 'stratification' }];

/** Extract (type, name, action-file) tuples from a test-manifest .ttl. */
function parseManifest(kind: Kind): Entry[] {
  const ttl = readFileSync(w3cUrl(`${kind}/manifest.ttl`), 'utf8');
  const re = /rdf:type\s+srlt:(\w+)\s*;\s*mf:name\s+"([^"]+)"\s*;\s*mf:action\s+<([^>]+)>/g;
  const entries: Entry[] = [];
  for (const m of ttl.matchAll(re)) {
    const type = m[1];
    entries.push({ kind, name: m[2], positive: type.startsWith('RulesPositive'), file: m[3] });
  }
  return entries;
}

/** Does our implementation conform to what the test expects? */
function conforms(entry: Entry): boolean {
  const src = readFileSync(w3cUrl(`${entry.kind}/${entry.file}`), 'utf8');

  let parsed = false;
  let ruleSet: ReturnType<typeof parseRuleSet> | undefined;
  try {
    ruleSet = parseRuleSet(src);
    parsed = true;
  } catch {
    parsed = false;
  }

  if (entry.kind === 'syntax') {
    // Positive: must parse. Negative: must be rejected.
    return entry.positive ? parsed : !parsed;
  }

  // wellformed / stratification: the input is syntactically legal, so it must
  // parse; then the relevant check decides accept/reject.
  if (!parsed || !ruleSet) return false;
  const accepted =
    entry.kind === 'wellformed'
      ? checkWellFormed(ruleSet).length === 0
      : stratify(ruleSet.rules.map((ast, i) => ({ id: `r${i}`, ast }))).issues.length === 0;

  return entry.positive ? accepted : !accepted;
}

const allEntries = CATEGORIES.flatMap((c) => parseManifest(c.dir));

const results = allEntries.map((e) => ({ ...e, ok: safeConforms(e) }));
function safeConforms(e: Entry): boolean {
  try {
    return conforms(e);
  } catch {
    return false;
  }
}

// Scoreboard (regenerated every run for visibility).
const scoreboard: Record<string, { pass: number; total: number }> = {};
for (const r of results) {
  const s = (scoreboard[r.kind] ??= { pass: 0, total: 0 });
  s.total += 1;
  if (r.ok) s.pass += 1;
}
writeFileSync(w3cUrl('scoreboard.json'), `${JSON.stringify(scoreboard, null, 2)}\n`);

const passingNow = results
  .filter((r) => r.ok)
  .map((r) => `${r.kind}/${r.name}`)
  .sort();

const baselineFile = w3cUrl('expected-pass.json');
if (!existsSync(baselineFile)) {
  writeFileSync(baselineFile, `${JSON.stringify(passingNow, null, 2)}\n`);
}
const baseline: string[] = JSON.parse(readFileSync(baselineFile, 'utf8'));

describe('W3C SPARQL-RL conformance', () => {
  it('prints a scoreboard', () => {
    const line = Object.entries(scoreboard)
      .map(([k, s]) => `${k}: ${s.pass}/${s.total}`)
      .join('  |  ');
    // eslint-disable-next-line no-console
    console.log(`[W3C conformance] ${line}`);
    expect(results.length).toBeGreaterThan(0);
  });

  it('does not regress the ratchet baseline', () => {
    const nowSet = new Set(passingNow);
    const regressed = baseline.filter((name) => !nowSet.has(name));
    expect(regressed, `these previously conformed and now fail: ${regressed.join(', ')}`).toEqual([]);
  });

  it('reports newly-conforming tests (update expected-pass.json to lock them in)', () => {
    const baseSet = new Set(baseline);
    const gained = passingNow.filter((name) => !baseSet.has(name));
    if (gained.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[W3C conformance] ${gained.length} newly conforming (not yet in baseline): ${gained.join(', ')}`);
    }
    // Informational — never fails.
    expect(true).toBe(true);
  });
});
