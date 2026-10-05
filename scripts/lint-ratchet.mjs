#!/usr/bin/env node
/**
 * ESLint ratchet. Lints every package's TypeScript with the root
 * eslint.config.mjs, counts problems per package and rule, and fails if any
 * count is above the checked-in baseline (scripts/lint-baseline.json).
 *
 * Usage:
 *   node scripts/lint-ratchet.mjs            # report + fail if above baseline
 *   node scripts/lint-ratchet.mjs --update   # rewrite baseline to current counts
 *   node scripts/lint-ratchet.mjs --json     # machine-readable counts
 *
 * ESLint landed on a tree that had never been linted, so most rules start at
 * zero and are enforced outright, while the few with a backlog (`any`, mostly
 * in tests) are held at their count until someone lowers it. A package/rule
 * pair absent from the baseline has a baseline of zero, so a new kind of
 * problem fails at the first occurrence.
 *
 * To see the problems themselves: `pnpm exec eslint packages/<name>`.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { ESLint } from 'eslint';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(ROOT, 'scripts', 'lint-baseline.json');
const args = new Set(process.argv.slice(2));

const eslint = new ESLint({ cwd: ROOT });
const results = await eslint.lintFiles(['packages']);

// Zero files linted is zero problems, which reads as a clean tree. A moved
// config, an ignore pattern that swallowed `packages/`, a glob that stopped
// matching: all of them land here rather than on a green build.
if (results.length === 0) {
  console.error('✗ ESLint linted no files under packages/. A count of 0 from an empty run is not a pass.');
  process.exit(1);
}

/** @type {Record<string, Record<string, number>>} */
const counts = {};
for (const result of results) {
  const rel = relative(ROOT, result.filePath);
  const pkg = rel.split('/')[1];
  for (const message of result.messages) {
    // A parse failure has no rule id. Counted rather than dropped, so a file
    // ESLint could not read is a rise, not an absence.
    const rule = message.ruleId ?? (message.fatal ? 'fatal-parse-error' : 'unused-disable-directive');
    counts[pkg] ??= {};
    counts[pkg][rule] = (counts[pkg][rule] ?? 0) + 1;
  }
}

const sorted = (obj) => Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
const current = sorted(Object.fromEntries(Object.entries(counts).map(([pkg, rules]) => [pkg, sorted(rules)])));

if (args.has('--json')) {
  console.log(JSON.stringify({ files: results.length, counts: current }, null, 2));
  process.exit(0);
}

if (args.has('--update')) {
  writeFileSync(BASELINE_PATH, JSON.stringify(current, null, 2) + '\n');
  console.log(`Baseline updated from ${results.length} file(s).`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
} catch {
  console.error(`No readable baseline at ${relative(ROOT, BASELINE_PATH)}. Run: node scripts/lint-ratchet.mjs --update`);
  process.exit(1);
}
for (const [pkg, rules] of Object.entries(baseline)) {
  for (const [rule, n] of Object.entries(rules ?? {})) {
    if (!Number.isInteger(n) || n < 0) {
      console.error(`✗ baseline ${pkg} ${rule} is not a count (read: ${JSON.stringify(n)}).`);
      process.exit(1);
    }
  }
}

const rises = [];
const drops = [];
for (const pkg of new Set([...Object.keys(current), ...Object.keys(baseline)])) {
  for (const rule of new Set([...Object.keys(current[pkg] ?? {}), ...Object.keys(baseline[pkg] ?? {})])) {
    const now = current[pkg]?.[rule] ?? 0;
    const was = baseline[pkg]?.[rule] ?? 0;
    if (now > was) rises.push({ pkg, rule, now, was });
    else if (now < was) drops.push({ pkg, rule, now, was });
  }
}

const total = Object.values(current).flatMap((r) => Object.values(r)).reduce((a, b) => a + b, 0);
console.log(`lint ratchet: ${results.length} file(s) linted, ${total} baselined problem(s)`);

if (rises.length > 0) {
  console.error('\n✗ lint problems rose above the baseline:');
  for (const { pkg, rule, now, was } of rises) console.error(`    ${pkg}  ${rule}: ${was} → ${now}`);
  console.error('\n  Fix them (`pnpm exec eslint packages/<name>` lists each one; `--fix` handles');
  console.error('  unused imports). Raising scripts/lint-baseline.json is a decision to explain in');
  console.error('  the pull request, not a way past a red build.');
  process.exit(1);
}

if (drops.length > 0) {
  console.log('\n↓ counts dropped below baseline. Run `node scripts/lint-ratchet.mjs --update` to lock in the win:');
  for (const { pkg, rule, now, was } of drops) console.log(`    ${pkg}  ${rule}: ${was} → ${now}`);
}
