import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkWellFormed, expandIris, parseRuleSet, stratify } from '../src/index.js';
import { readDocumentManifest, readEvalManifest } from './w3cManifest.js';

/**
 * Manifest-driven W3C SPARQL-RL conformance harness.
 *
 * Vendored snapshot under ./w3c (pinned — see w3c/SOURCE). We drive every
 * manifest entry, decide whether our implementation *conforms* to the test's
 * expected accept/reject, and compare against:
 *   - w3c/expected-pass.json — ratchet baseline of conforming test names
 *   - w3c/scoreboard.json    — per-category pass/total, as last recorded
 *
 * Both files are committed and only ever rewritten on request: run with
 * `SRL_W3C_UPDATE=1` to record the current results. A plain run writes nothing,
 * so running the tests never dirties the tree, and a missing baseline is a
 * failure rather than something the run quietly fills in with whatever it
 * happened to get.
 *
 * The suite may exercise more than we implement, so a test may be expected-fail.
 * The assertion is a ratchet: no test that previously conformed may regress. New
 * conformances are reported, and locked in by an update run.
 *
 * The evaluation categories (`eval/`, `eval2/`, `examples/`) assert an inferred
 * graph, which needs a store this package does not have; they are evaluated
 * through the library by `packages/api/test/lib/w3cRulesSuite.harness.test.ts`
 * (which `packages/api` can do and this package cannot import). What this
 * package *can* say about them is run here: every rule set they evaluate is a
 * legal document — it parses, is well-formed and stratifies — since a rule set
 * we refused could never produce the expected graph.
 */

const w3cUrl = (rel: string) => fileURLToPath(new URL(`./w3c/${rel}`, import.meta.url));
const UPDATE = process.env.SRL_W3C_UPDATE === '1';

type DocumentKind = 'syntax' | 'wellformed' | 'stratification';
type EvalKind = 'eval' | 'eval2' | 'examples';
interface Entry {
  kind: DocumentKind | EvalKind;
  name: string;
  /** For a document test, whether the check should accept; eval rule sets always should. */
  positive: boolean;
  file: string;
}

const DOCUMENT_KINDS: DocumentKind[] = ['syntax', 'wellformed', 'stratification'];
const EVAL_KINDS: EvalKind[] = ['eval', 'eval2', 'examples'];

const manifest = (kind: string) => readFileSync(w3cUrl(`${kind}/manifest.ttl`), 'utf8');

function documentEntries(kind: DocumentKind): Entry[] {
  return readDocumentManifest(manifest(kind)).map((e) => ({ kind, ...e }));
}

function evalEntries(kind: EvalKind): Entry[] {
  return readEvalManifest(manifest(kind)).map((e) => ({ kind, name: e.name, positive: true, file: e.ruleset }));
}

/** Does the document stratify? Expanded first: stratification compares full IRIs. */
function stratifies(ruleSet: ReturnType<typeof parseRuleSet>): boolean {
  expandIris(ruleSet);
  return stratify(ruleSet.rules.map((ast, i) => ({ id: `r${i}`, ast }))).issues.length === 0;
}

/** Does our implementation conform to what the test expects? */
function conforms(entry: Entry): boolean {
  const src = readFileSync(w3cUrl(`${entry.kind}/${entry.file}`), 'utf8');

  let ruleSet: ReturnType<typeof parseRuleSet> | undefined;
  try {
    ruleSet = parseRuleSet(src);
  } catch {
    ruleSet = undefined;
  }

  if (entry.kind === 'syntax') {
    // Positive: must parse. Negative: must be rejected.
    return entry.positive ? ruleSet !== undefined : ruleSet === undefined;
  }

  // Everything else is syntactically legal, so it must parse; then the
  // relevant check decides accept/reject.
  if (!ruleSet) return false;
  if (entry.kind === 'wellformed') {
    const accepted = checkWellFormed(ruleSet).length === 0;
    return entry.positive ? accepted : !accepted;
  }
  if (entry.kind === 'stratification') {
    const accepted = stratifies(ruleSet);
    return entry.positive ? accepted : !accepted;
  }
  // An evaluated rule set has to pass all three.
  return checkWellFormed(ruleSet).length === 0 && stratifies(ruleSet);
}

const allEntries = [...DOCUMENT_KINDS.flatMap(documentEntries), ...EVAL_KINDS.flatMap(evalEntries)];

const results = allEntries.map((e) => ({ ...e, ok: safeConforms(e) }));
function safeConforms(e: Entry): boolean {
  try {
    return conforms(e);
  } catch {
    return false;
  }
}

const scoreboard: Record<string, { pass: number; total: number }> = {};
for (const r of results) {
  const s = (scoreboard[r.kind] ??= { pass: 0, total: 0 });
  s.total += 1;
  if (r.ok) s.pass += 1;
}

const passingNow = results
  .filter((r) => r.ok)
  .map((r) => `${r.kind}/${r.name}`)
  .sort();

const scoreboardFile = w3cUrl('scoreboard.json');
const baselineFile = w3cUrl('expected-pass.json');
if (UPDATE) {
  writeFileSync(scoreboardFile, `${JSON.stringify(scoreboard, null, 2)}\n`);
  writeFileSync(baselineFile, `${JSON.stringify(passingNow, null, 2)}\n`);
}
const baseline: string[] | undefined = existsSync(baselineFile)
  ? JSON.parse(readFileSync(baselineFile, 'utf8'))
  : undefined;

describe('W3C SPARQL-RL conformance', () => {
  it('reads every manifest entry in every category', () => {
    // A manifest the reader stopped understanding would otherwise score as a
    // shorter suite rather than fail. The counts are the vendored snapshot's.
    const perKind: Record<string, number> = {};
    for (const e of allEntries) perKind[e.kind] = (perKind[e.kind] ?? 0) + 1;
    expect(perKind).toEqual({ syntax: 139, wellformed: 8, stratification: 10, eval: 35, eval2: 6, examples: 5 });
    // Names identify baseline entries, so they must be unique within a category.
    const ids = allEntries.map((e) => `${e.kind}/${e.name}`);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('prints a scoreboard', () => {
    const line = Object.entries(scoreboard)
      .map(([k, s]) => `${k}: ${s.pass}/${s.total}`)
      .join('  |  ');
    // eslint-disable-next-line no-console
    console.log(`[W3C conformance] ${line}`);
    expect(results.length).toBeGreaterThan(0);
  });

  it('has a committed baseline', () => {
    expect(baseline, 'w3c/expected-pass.json is missing — run with SRL_W3C_UPDATE=1 to record one').toBeDefined();
  });

  it('does not regress the ratchet baseline', () => {
    const nowSet = new Set(passingNow);
    const regressed = (baseline ?? []).filter((name) => !nowSet.has(name));
    expect(regressed, `these previously conformed and now fail: ${regressed.join(', ')}`).toEqual([]);
  });

  it('reports newly-conforming tests (run with SRL_W3C_UPDATE=1 to lock them in)', () => {
    const baseSet = new Set(baseline ?? []);
    const gained = passingNow.filter((name) => !baseSet.has(name));
    const recorded: unknown = existsSync(scoreboardFile) ? JSON.parse(readFileSync(scoreboardFile, 'utf8')) : undefined;
    if (gained.length > 0 || JSON.stringify(recorded) !== JSON.stringify(scoreboard)) {
      // eslint-disable-next-line no-console
      console.log(
        `[W3C conformance] results differ from the committed scoreboard/baseline; ${gained.length} newly conforming: `
        + `${gained.join(', ')}. Run with SRL_W3C_UPDATE=1 to record them.`,
      );
    }
    // Informational — never fails.
    expect(true).toBe(true);
  });
});
