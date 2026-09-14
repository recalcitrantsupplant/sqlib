#!/usr/bin/env node
/*
 * Codemod: collapse the uppercase chrome-label styles onto three canonical
 * specs matching components/shared/SectionLabel.vue.
 *
 * The audit found 98 uppercase-label rules across 37 files using 54 distinct
 * combinations of (font-size, weight, colour, letter-spacing). They were all
 * tokenised by the earlier sweep, so they draw from one palette — but they
 * still render at a dozen different sizes and trackings, which is the visual
 * inconsistency the design system is supposed to remove.
 *
 * Rules are bucketed by their CURRENT font size so most sites do not move:
 * each canonical spec was chosen to match the largest existing cluster exactly.
 *
 *   micro / label (10-11px)  -> sm   11px / 600 / ink-muted     / 0.02em
 *   body (12px)              -> md   12px / 600 / ink-muted     / 0.03em
 *   body-lg and up (13px+)   -> lg   13px / 600 / ink-secondary / 0.025em
 *
 * Non-neutral colours (--action, --danger, --success, --warning) are left
 * alone: those are deliberate accents, not drift.
 *
 * Usage:
 *   node scripts/codemod-section-labels.mjs           # report
 *   node scripts/codemod-section-labels.mjs --write   # apply
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const WRITE = process.argv.includes('--write');
const ROOT = path.resolve(import.meta.dirname, '..');
const WEB = path.join(ROOT, 'packages/web/src');

const SPECS = {
  sm: { size: 'text-label', weight: 'var(--weight-semibold)', color: 'var(--ink-muted)', tracking: '0.02em' },
  md: { size: 'text-body', weight: 'var(--weight-semibold)', color: 'var(--ink-muted)', tracking: '0.03em' },
  lg: { size: 'text-body-lg', weight: 'var(--weight-semibold)', color: 'var(--ink-secondary)', tracking: '0.025em' },
};

/*
 * Only chrome-label sizes are bucketed. --text-content and --text-title are
 * heading sizes: a page title that happens to be uppercase is not a chrome
 * label, and squashing it to 13px shifts the whole layout beneath it. The
 * first pass did exactly that to the playground titles, which the visual
 * baselines caught.
 */
const BUCKET = {
  'text-micro': 'sm', 'text-label': 'sm',
  'text-body': 'md',
  'text-body-lg': 'lg',
};

/** Colours that mean something and must survive. */
const ACCENT = /--(action|danger|success|warning|info|rdf|state)/;

const files = execSync(
  `grep -rl 'text-transform: uppercase' ${WEB}/components ${WEB}/pages 2>/dev/null || true`,
  { encoding: 'utf8' },
).trim().split('\n').filter(Boolean);

let changed = 0, rules = 0, skippedAccent = 0;
const buckets = { sm: 0, md: 0, lg: 0 };

for (const file of files) {
  const before = readFileSync(file, 'utf8');
  const styleAt = before.search(/<style[^>]*>/);
  if (styleAt === -1) continue;

  const head = before.slice(0, styleAt);
  let css = before.slice(styleAt);

  css = css.replace(/([^{}]+)\{([^{}]*)\}/g, (whole, sel, body) => {
    if (!/text-transform:\s*uppercase/.test(body)) return whole;

    const sizeM = /font-size:\s*var\(--([a-z-]+)\)/.exec(body);
    if (!sizeM) return whole;                    // non-token size: leave it
    const bucket = BUCKET[sizeM[1]];
    if (!bucket) return whole;

    const colorM = /(^|\n)\s*color:\s*([^;]+);/.exec(body);
    if (colorM && ACCENT.test(colorM[2])) { skippedAccent++; return whole; }

    const spec = SPECS[bucket];
    let next = body
      .replace(/font-size:\s*var\(--[a-z-]+\)/, `font-size: var(--${spec.size})`)
      .replace(/font-weight:\s*[^;]+/, `font-weight: ${spec.weight}`)
      .replace(/letter-spacing:\s*[^;]+/, `letter-spacing: ${spec.tracking}`);

    if (colorM) next = next.replace(/(^|\n)(\s*)color:\s*[^;]+;/, `$1$2color: ${spec.color};`);
    if (!/letter-spacing:/.test(next)) {
      next = next.replace(/(\n(\s*))text-transform:/, `$1letter-spacing: ${spec.tracking};$1text-transform:`);
    }

    if (next === body) return whole;
    rules++; buckets[bucket]++;
    return `${sel}{${next}}`;
  });

  const after = head + css;
  if (after !== before) {
    if (WRITE) writeFileSync(file, after);
    changed++;
  }
}

console.log(`${WRITE ? 'Rewrote' : 'Would rewrite'} ${changed} files, ${rules} label rules.`);
console.log(`  buckets: sm=${buckets.sm} md=${buckets.md} lg=${buckets.lg}`);
console.log(`  left alone (accent colour): ${skippedAccent}`);
