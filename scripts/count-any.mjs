#!/usr/bin/env node
/**
 * `any` ratchet. Counts non-generated `as any` / `: any` / `catch (x: any)`
 * occurrences in TypeScript source and fails if the total exceeds the
 * checked-in baseline (scripts/any-baseline.json).
 *
 * Usage:
 *   node scripts/count-any.mjs            # report + fail if above baseline
 *   node scripts/count-any.mjs --update   # rewrite baseline to current counts
 *   node scripts/count-any.mjs --json     # machine-readable output
 *
 * The baseline can only be lowered by a human running --update. This lets the
 * cleanup land incrementally while guaranteeing the numbers never regress.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(ROOT, 'scripts', 'any-baseline.json');

const SCAN_DIRS = ['packages'];
const IGNORE_DIR = /(^|\/)(node_modules|dist|\.git|coverage)(\/|$)/;
const IGNORE_FILE = /\.generated\.ts$|\.d\.ts$/;
const isTest = (p) => /\.(test|spec)\.ts$|(^|\/)(test|tests|__tests__)(\/|$)/.test(p);

// Patterns we ratchet. `as any` and `: any` (annotations, incl. catch/params).
const AS_ANY = /\bas any\b/g;
const COLON_ANY = /:\s*any\b/g;
const CATCH_ANY = /catch \(\s*\w+\s*:\s*any\s*\)/g;

// Hard-zero zone: shipped API source. `as any` and `catch (x: any)` were fully
// eliminated here and must never come back. Unlike the whole-repo ratchet (which
// only forbids *increases*), any occurrence in this zone is an outright failure.
const STRICT_ZONE = /^packages\/api\/src\//;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(ROOT, full);
    if (IGNORE_DIR.test('/' + rel)) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith('.ts') && !IGNORE_FILE.test(name)) out.push(full);
  }
  return out;
}

function count() {
  const totals = { src: { asAny: 0, colonAny: 0 }, test: { asAny: 0, colonAny: 0 } };
  const perFile = {};
  const strictViolations = [];
  let scanned = 0;
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir))) {
      scanned++;
      const rel = relative(ROOT, file);
      const bucket = isTest(rel) ? 'test' : 'src';
      const text = readFileSync(file, 'utf8');
      const asAny = (text.match(AS_ANY) || []).length;
      const colonAny = (text.match(COLON_ANY) || []).length;
      totals[bucket].asAny += asAny;
      totals[bucket].colonAny += colonAny;
      if (asAny + colonAny > 0) perFile[rel] = { asAny, colonAny };
      if (STRICT_ZONE.test(rel) && bucket === 'src') {
        const catchAny = (text.match(CATCH_ANY) || []).length;
        if (asAny > 0 || catchAny > 0) strictViolations.push({ rel, asAny, catchAny });
      }
    }
  }
  // Zero files scanned counts zero `any`, which reads as a clean sweep and, on
  // an --update, writes that fiction into the baseline. The strict zone is the
  // sharper end of it: "no `as any` in packages/api/src" is satisfied trivially
  // by not looking at packages/api/src.
  if (scanned === 0) {
    console.error(`✗ scanned ${SCAN_DIRS.join(', ')} and found no .ts files at all.`);
    console.error(`  A count of 0 from an empty scan is not a win — it is a ratchet pointed at nothing.`);
    process.exit(1);
  }
  return { totals, perFile, strictViolations, scanned };
}

const args = new Set(process.argv.slice(2));
const { totals, perFile, strictViolations, scanned } = count();
const srcTotal = totals.src.asAny + totals.src.colonAny;
const testTotal = totals.test.asAny + totals.test.colonAny;

if (args.has('--json')) {
  console.log(JSON.stringify({ totals, srcTotal, testTotal, scanned, perFile }, null, 2));
  process.exit(0);
}

if (args.has('--update')) {
  const baseline = { srcTotal, testTotal, src: totals.src, test: totals.test };
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`Baseline updated: src=${srcTotal} test=${testTotal}`);
  process.exit(0);
}

let baseline;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
} catch {
  console.error(`No baseline at ${relative(ROOT, BASELINE_PATH)}. Run: node scripts/count-any.mjs --update`);
  process.exit(1);
}

// Non-numeric baselines compare false against every count, so the gate passes
// without gating. Checked rather than trusted, for the same reason the scan is.
for (const field of ['srcTotal', 'testTotal']) {
  if (!Number.isInteger(baseline[field])) {
    console.error(`✗ baseline ${relative(ROOT, BASELINE_PATH)} has no integer "${field}" (read: ${JSON.stringify(baseline[field])}).`);
    console.error(`  Re-record it with: node scripts/count-any.mjs --update`);
    process.exit(1);
  }
}

console.log(`any ratchet: ${scanned} file(s) scanned`);
console.log(`  source: ${srcTotal} (baseline ${baseline.srcTotal})   [as any ${totals.src.asAny}, : any ${totals.src.colonAny}]`);
console.log(`  test:   ${testTotal} (baseline ${baseline.testTotal})   [as any ${totals.test.asAny}, : any ${totals.test.colonAny}]`);
console.log(`  strict zone (packages/api/src): as any = 0, catch(x: any) = 0 enforced`);

let failed = false;
if (strictViolations.length > 0) {
  console.error(`\n✗ forbidden \`as any\` / \`catch (x: any)\` reintroduced in packages/api/src (must stay 0):`);
  for (const v of strictViolations) {
    console.error(`    ${v.rel}  [as any ${v.asAny}, catch-any ${v.catchAny}]`);
  }
  failed = true;
}
if (srcTotal > baseline.srcTotal) {
  console.error(`\n✗ source \`any\` rose by ${srcTotal - baseline.srcTotal}. Remove them or justify, then re-run --update.`);
  failed = true;
}
if (testTotal > baseline.testTotal) {
  console.error(`\n✗ test \`any\` rose by ${testTotal - baseline.testTotal}. Avoid new \`any\` in tests.`);
  failed = true;
}
if (!failed && (srcTotal < baseline.srcTotal || testTotal < baseline.testTotal)) {
  console.log(`\n↓ counts dropped below baseline. Run \`node scripts/count-any.mjs --update\` to lock in the win.`);
}
process.exit(failed ? 1 : 0);
