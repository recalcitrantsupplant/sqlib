#!/usr/bin/env node
/*
 * Codemod: collapse badge and empty-state styling onto canonical specs.
 *
 * Badges: 36 rules, 16 distinct specs of (radius, padding, size, weight).
 * They all become the StatusBadge shape — pill radius, --space-1/--space-4
 * padding, --text-label, semibold. Only rules that actually define a spec are
 * touched; the modifier rules that just set a colour are left alone, because
 * that colour is the badge's meaning.
 *
 * Empty states: typography and colour only. Their padding is deliberately NOT
 * normalised — an empty state's padding determines the height of the pane it
 * sits in, so changing it moves layout, and the visual baselines showed that is
 * exactly the kind of change worth avoiding for no gain.
 *
 * Usage:
 *   node scripts/codemod-badges-empties.mjs           # report
 *   node scripts/codemod-badges-empties.mjs --write   # apply
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const WRITE = process.argv.includes('--write');
const ROOT = path.resolve(import.meta.dirname, '..');
const WEB = path.join(ROOT, 'packages/web/src');

const BADGE_SEL = /\.[a-z0-9-]*badge[a-z0-9-]*(\s*[,:.]|\s*$)/i;
const EMPTY_SEL = /\.[a-z0-9-]*(empty|no-results|no-data|placeholder)[a-z0-9-]*(\s*[,:.]|\s*$)/i;

/* A badge rule only counts as a spec if it sizes itself. Colour-only modifiers
 * (.badge.error, .badge--stale) carry meaning and must survive untouched. */
const isBadgeSpec = (b) => /border-radius:|padding:/.test(b) && /font-size:/.test(b);

const files = execSync(
  `grep -rlE 'badge|empty|no-results|no-data|placeholder' ${WEB}/components ${WEB}/pages 2>/dev/null || true`,
  { encoding: 'utf8' },
).trim().split('\n').filter(Boolean);

let badges = 0, empties = 0, changedFiles = 0;

for (const file of files) {
  const before = readFileSync(file, 'utf8');
  const at = before.search(/<style[^>]*>/);
  if (at === -1) continue;

  const head = before.slice(0, at);
  const css = before.slice(at).replace(/([^{}]+)\{([^{}]*)\}/g, (whole, sel, body) => {
    const s = sel.trim();

    if (BADGE_SEL.test(s) && isBadgeSpec(body)) {
      let next = body
        .replace(/border-radius:\s*[^;]+/, 'border-radius: var(--radius-full)')
        .replace(/font-size:\s*var\(--[a-z-]+\)/, 'font-size: var(--text-label)')
        .replace(/padding:\s*[^;]+/, 'padding: var(--space-1) var(--space-4)');
      if (/font-weight:/.test(next)) {
        next = next.replace(/font-weight:\s*[^;]+/, 'font-weight: var(--weight-semibold)');
      }
      if (next !== body) { badges++; return `${sel}{${next}}`; }
      return whole;
    }

    if (EMPTY_SEL.test(s)) {
      let next = body;
      // one muted voice for "nothing here", not two
      next = next.replace(/color:\s*var\(--ink-disabled\)/, 'color: var(--ink-muted)');
      // oversized display type in empty states is a leftover, not a decision
      next = next.replace(/font-size:\s*var\(--text-(hero|hero-lg|display-lg)\)/, 'font-size: var(--text-display)');
      next = next.replace(/font-size:\s*var\(--text-content\)/, 'font-size: var(--text-body)');
      if (next !== body) { empties++; return `${sel}{${next}}`; }
      return whole;
    }

    return whole;
  });

  const after = head + css;
  if (after !== before) {
    if (WRITE) writeFileSync(file, after);
    changedFiles++;
  }
}

console.log(`${WRITE ? 'Rewrote' : 'Would rewrite'} ${changedFiles} files.`);
console.log(`  badge specs normalised:  ${badges}`);
console.log(`  empty-state rules tuned: ${empties}`);
