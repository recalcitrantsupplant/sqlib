#!/usr/bin/env node
/*
 * Codemod: replace hex colour literals in the web package with design tokens.
 *
 * See docs/reference/ui-design-tokens.md.
 *
 * The mapping is PROPERTY-AWARE. A given hex means different things depending
 * on the declaration it sits in: `#ffffff` as a background is --surface, but as
 * a `color` it is --ink-inverse. A naive global replace produces a file that
 * looks identical in light mode and is wrong in dark mode, so each concept
 * carries a token per role (bg / fg / border).
 *
 * Usage:
 *   node scripts/codemod-design-tokens.mjs            # report only
 *   node scripts/codemod-design-tokens.mjs --write    # apply
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const WRITE = process.argv.includes('--write');
const ROOT = path.resolve(import.meta.dirname, '..');
const WEB = path.join(ROOT, 'packages/web/src');

/* ---------------------------------------------------------------- concepts */
/* Each concept maps a family of near-identical shades onto one token per role.
 * Collapsing near-duplicates (e.g. #f9fafb and #f8f9fa) onto a single step is
 * the point of the exercise, and does shift some pixels by a hair. */
const CONCEPTS = {
  white:      { bg: 'surface',         fg: 'ink-inverse',    border: 'surface' },
  gray50:     { bg: 'surface-subtle',  fg: 'ink-inverse',    border: 'border-subtle' },
  gray100:    { bg: 'surface-sunken',  fg: 'ink-disabled',   border: 'border-subtle' },
  gray200:    { bg: 'surface-raised',  fg: 'ink-disabled',   border: 'border-subtle' },
  gray300:    { bg: 'surface-raised',  fg: 'ink-disabled',   border: 'border-default' },
  gray400:    { bg: 'surface-raised',  fg: 'ink-disabled',   border: 'border-strong' },
  gray500:    { bg: 'gray-500',        fg: 'ink-disabled',   border: 'border-hover' },
  gray600:    { bg: 'gray-600',        fg: 'ink-muted',      border: 'border-hover' },
  gray700:    { bg: 'gray-700',        fg: 'ink-secondary',  border: 'border-hover' },
  gray800:    { bg: 'gray-800',        fg: 'ink',            border: 'gray-800' },
  gray900:    { bg: 'gray-900',        fg: 'ink',            border: 'gray-900' },

  action:        { bg: 'action',         fg: 'action',       border: 'action' },
  actionHover:   { bg: 'action-hover',   fg: 'action-hover', border: 'action-hover' },
  actionDeep:    { bg: 'action-active',  fg: 'action-ink',   border: 'action-active' },
  actionSurface: { bg: 'action-surface', fg: 'action-ink',   border: 'action-border' },
  actionBorder:  { bg: 'action-surface', fg: 'action',       border: 'action-border' },

  success:        { bg: 'success',         fg: 'success',      border: 'success' },
  successDeep:    { bg: 'success-hover',   fg: 'success-ink',  border: 'success-hover' },
  successSurface: { bg: 'success-surface', fg: 'success-ink',  border: 'success-border' },
  successBorder:  { bg: 'success-surface', fg: 'success',      border: 'success-border' },

  danger:        { bg: 'danger',         fg: 'danger',      border: 'danger' },
  dangerDeep:    { bg: 'danger-hover',   fg: 'danger-ink',  border: 'danger-active' },
  dangerSurface: { bg: 'danger-surface', fg: 'danger-ink',  border: 'danger-border' },
  dangerBorder:  { bg: 'danger-surface', fg: 'danger',      border: 'danger-border' },

  warning:        { bg: 'warning',         fg: 'warning',     border: 'warning' },
  warningDeep:    { bg: 'warning-hover',   fg: 'warning-ink', border: 'warning-hover' },
  warningSurface: { bg: 'warning-surface', fg: 'warning-ink', border: 'warning-border' },
  warningBorder:  { bg: 'warning-surface', fg: 'warning',     border: 'warning-border' },

  violet:        { bg: 'violet-500',  fg: 'violet-500',  border: 'violet-500' },
  violetDeep:    { bg: 'violet-700',  fg: 'violet-700',  border: 'violet-700' },
  violetSurface: { bg: 'violet-50',   fg: 'violet-700',  border: 'violet-100' },
  violetBorder:  { bg: 'violet-50',   fg: 'violet-500',  border: 'violet-100' },

  rdfVar:      { bg: 'rdf-var',      fg: 'rdf-var',   border: 'rdf-var' },
  info:        { bg: 'info',         fg: 'info',      border: 'info' },
  infoSurface: { bg: 'info-surface', fg: 'info-ink',  border: 'info-border' },
  infoBorder:  { bg: 'info-surface', fg: 'info',      border: 'info-border' },
};

/* ------------------------------------------------------------------ palette */
const HEX = {
  // neutrals
  '#ffffff': 'white', '#fff': 'white', '#fdfefe': 'white', '#fafbfc': 'white', '#fafaff': 'white',
  '#f8f9fa': 'gray50', '#f9fafb': 'gray50', '#fafafa': 'gray50', '#f8fafc': 'gray50', '#f5f5f5': 'gray50',
  '#f1f3f5': 'gray100', '#f3f4f6': 'gray100', '#f1f5f9': 'gray100', '#eef1f4': 'gray100',
  '#e9ecef': 'gray200', '#e5e7eb': 'gray200', '#e2e8f0': 'gray200', '#e8e8e8': 'gray200', '#e1e4e8': 'gray200',
  '#dee2e6': 'gray300', '#d1d5db': 'gray300', '#cbd5e1': 'gray300', '#ddd': 'gray300',
  '#ced4da': 'gray400', '#ccc': 'gray400', '#cbd5f5': 'gray400',
  '#adb5bd': 'gray500', '#9ca3af': 'gray500', '#94a3b8': 'gray500', '#aaa': 'gray500',
  '#6c757d': 'gray600', '#6b7280': 'gray600', '#64748b': 'gray600', '#868e96': 'gray600',
  '#718096': 'gray600', '#555': 'gray600',
  '#495057': 'gray700', '#4b5563': 'gray700', '#475569': 'gray700', '#4a5568': 'gray700',
  '#374151': 'gray700', '#334155': 'gray700', '#333': 'gray700',
  '#343a40': 'gray800', '#1f2937': 'gray800', '#1e293b': 'gray800', '#23304f': 'gray800',
  '#1f2a44': 'gray800', '#1a273b': 'gray800',
  '#212529': 'gray900', '#111827': 'gray900', '#0f172a': 'gray900', '#1a202c': 'gray900',
  '#0b1221': 'gray900',

  // blue / action
  '#0d6efd': 'action', '#3b82f6': 'action', '#1c7ed6': 'action', '#339af0': 'action',
  '#1971c2': 'action', '#0ea5e9': 'info', '#5b9dff': 'action',
  '#0b5ed7': 'actionHover', '#2563eb': 'actionHover', '#1d4ed8': 'actionHover',
  '#0a58ca': 'actionDeep', '#084298': 'actionDeep', '#1e40af': 'actionDeep', '#0d47a1': 'actionDeep',
  '#1565c0': 'actionDeep', '#1864ab': 'actionDeep', '#0056b3': 'actionDeep',
  '#e7f1ff': 'actionSurface', '#cfe2ff': 'actionSurface', '#dbeafe': 'actionSurface',
  '#eff6ff': 'actionSurface', '#e7f3ff': 'actionSurface', '#e8f4ff': 'actionSurface',
  '#f0f7ff': 'actionSurface', '#d0ebff': 'actionSurface', '#e9f5ff': 'actionSurface',
  '#e7f5ff': 'actionSurface', '#f1f8ff': 'actionSurface', '#e3f2fd': 'actionSurface',
  '#dceafe': 'actionSurface', '#d3e3fd': 'actionSurface', '#e0f2fe': 'actionSurface',
  '#e7f0ff': 'actionSurface', '#edf2ff': 'actionSurface', '#eef2ff': 'actionSurface',
  '#e0e7ff': 'actionSurface', '#e8ecfa': 'actionSurface', '#dce4fa': 'actionSurface',
  '#b6d4fe': 'actionBorder', '#bfdbfe': 'actionBorder', '#93c5fd': 'actionBorder',
  '#60a5fa': 'actionBorder', '#74c0fc': 'actionBorder', '#4dabf7': 'actionBorder',
  '#80bdff': 'actionBorder', '#a5d8ff': 'actionBorder', '#bbdefb': 'actionBorder',
  '#c1d5fb': 'actionBorder', '#c0d9fc': 'actionBorder', '#c4d8fc': 'actionBorder',
  '#bae6fd': 'actionBorder', '#c7d2fe': 'actionBorder', '#a5b4fc': 'actionBorder',

  // green / success
  '#28a745': 'success', '#198754': 'success', '#16a34a': 'success', '#10b981': 'success',
  '#059669': 'success', '#0ca678': 'success', '#23c483': 'success', '#2b8a3e': 'success',
  '#218838': 'successDeep', '#1e7e34': 'successDeep', '#15803d': 'successDeep',
  '#0f5132': 'successDeep', '#166534': 'successDeep', '#065f46': 'successDeep', '#155724': 'successDeep',
  '#d1e7dd': 'successSurface', '#dcfce7': 'successSurface', '#d3f9d8': 'successSurface',
  '#d1fae5': 'successSurface', '#f0fdf4': 'successSurface', '#e6fcf5': 'successSurface',
  '#d7f5f0': 'successSurface', '#d1f4e0': 'successSurface',
  '#86efac': 'successBorder', '#8ce99a': 'successBorder', '#4ade80': 'successBorder',
  '#a3e4c2': 'successBorder', '#bbf7d0': 'successBorder',

  // red / danger
  '#dc3545': 'danger', '#dc2626': 'danger', '#fa5252': 'danger', '#f03e3e': 'danger',
  '#d21c1c': 'danger', '#c0392b': 'danger', '#d6336c': 'danger',
  '#c82333': 'dangerDeep', '#bb2d3b': 'dangerDeep', '#b02a37': 'dangerDeep', '#bd2130': 'dangerDeep',
  '#b21f2d': 'dangerDeep', '#b91c1c': 'dangerDeep', '#b42318': 'dangerDeep', '#c92a2a': 'dangerDeep',
  '#c1121f': 'dangerDeep', '#842029': 'dangerDeep', '#721c24': 'dangerDeep',
  '#f8d7da': 'dangerSurface', '#fee2e2': 'dangerSurface', '#fef2f2': 'dangerSurface',
  '#ffe3e3': 'dangerSurface', '#ffe0e0': 'dangerSurface', '#fdecec': 'dangerSurface',
  '#fde2e4': 'dangerSurface', '#fae2e1': 'dangerSurface', '#fff4f4': 'dangerSurface',
  '#f5c2c7': 'dangerBorder', '#fca5a5': 'dangerBorder', '#ffa8a8': 'dangerBorder',
  '#ffc9c9': 'dangerBorder', '#f87171': 'dangerBorder', '#fecdd3': 'dangerBorder',

  // amber / warning
  '#f59e0b': 'warning', '#ffc107': 'warning', '#fd7e14': 'warning', '#e67700': 'warning',
  '#f08c00': 'warning', '#fbbf24': 'warning',
  '#b26b00': 'warningDeep', '#b35c00': 'warningDeep', '#92400e': 'warningDeep',
  '#856404': 'warningDeep', '#b45309': 'warningDeep',
  '#fff3cd': 'warningSurface', '#fef3c7': 'warningSurface', '#fff3bf': 'warningSurface',
  '#fef7d1': 'warningSurface', '#fff7ed': 'warningSurface', '#fff4e6': 'warningSurface',
  '#ffecb5': 'warningBorder', '#fde68a': 'warningBorder', '#ffe066': 'warningBorder',
  '#fed7aa': 'warningBorder',

  // violet
  '#6610f2': 'violet', '#7048e8': 'violet', '#7c3aed': 'violet', '#8b5cf6': 'violet',
  '#9775fa': 'violet', '#7a5cff': 'violet', '#6366f1': 'violet', '#818cf8': 'violet',
  '#7b1fa2': 'violetDeep', '#4338ca': 'violetDeep',
  '#f5e0ff': 'violetSurface', '#e5defc': 'violetSurface', '#e0cffc': 'violetSurface',
  '#f3f0ff': 'violetSurface', '#f3e8ff': 'violetSurface', '#e9d5ff': 'violetSurface',
  '#e1bee7': 'violetSurface', '#f3e5f5': 'violetSurface',

  // cyan / info
  '#cffafe': 'infoSurface',

  // stragglers
  '#c2410c': 'rdfVar',      // stratification graph: recursive-rule label
  '#991b1b': 'dangerDeep',  // SRL editor: error text
  '#5a6268': 'gray700',     // secondary button hover
  '#545b62': 'gray800',     // secondary button active
};

/* CSS colour keywords. Easy to miss: they are not hex, so neither the hex
 * sweep nor stylelint's color-no-hex catches them. `color: white` on a blue
 * button must become --ink-inverse, not --surface, or it vanishes in dark
 * mode against a dark surface. */
const KEYWORDS = {
  white: 'white',
  black: 'gray900',
  whitesmoke: 'gray50',
  lightgray: 'gray300',
  lightgrey: 'gray300',
  gray: 'gray600',
  grey: 'gray600',
  silver: 'gray400',
  red: 'danger',
  green: 'success',
  blue: 'action',
  orange: 'warning',
};

/* Literal replacements for values that aren't plain hex colours. */
const RAW = {
  '#0d6efd33': 'color-mix(in srgb, var(--action) 20%, transparent)',
  '#3b82f633': 'color-mix(in srgb, var(--action) 20%, transparent)',
};

/* --------------------------------------------------------------- role rules */
function roleFor(prop) {
  const p = prop.toLowerCase();
  // Order matters: `background-color` also ends in `-color`, so backgrounds and
  // borders must be classified before the generic colour test.
  if (/background/.test(p)) return 'bg';
  if (/border|outline|column-rule|shadow/.test(p)) return 'border';
  if (p === 'color' || /(^|-)color$/.test(p)) return 'fg';
  if (/fill|stroke/.test(p)) return 'fg';
  return 'bg';
}

/* ------------------------------------------------- font-size & radius maps */
/* Keyed by computed px so 14px, 0.875rem and 0.9rem all land on one step. */
const toPx = (v) => {
  const m = /^([0-9.]+)(px|rem|em)$/.exec(v.trim());
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2] === 'px' ? n : n * 16;
};

const FONT_STEPS = [
  [10.5, 'text-micro'],
  [11.5, 'text-label'],
  [12.5, 'text-body'],
  [13.5, 'text-body-lg'],
  [15.5, 'text-content'],
  [17, 'text-title'],
  [21, 'text-heading'],
  [26, 'text-display'],
  [36, 'text-display-lg'],
  [56, 'text-hero'],
  [Infinity, 'text-hero-lg'],
];

const RADIUS_STEPS = [
  [3.5, 'radius-sm'],
  [5, 'radius'],
  [7, 'radius-panel'],
  [9, 'radius-lg'],
  [Infinity, 'radius-xl'],
];

const pick = (steps, px) => steps.find(([limit]) => px <= limit)[1];

function rewriteSizes(src) {
  let n = 0;

  src = src.replace(/(\bfont-size:\s*)([^;{}]+)(;|(?=\n\s*\}))/g, (m, head, value, tail) => {
    const bang = /!important/.test(value);
    const px = toPx(value.replace(/!important/, ''));
    if (px === null) return m; // clamp(), calc(), inherit, var() — leave alone
    n++;
    return `${head}var(--${pick(FONT_STEPS, px)})${bang ? ' !important' : ''}${tail}`;
  });

  src = src.replace(/(\bborder-radius:\s*)([^;{}]+)(;|(?=\n\s*\}))/g, (m, head, value, tail) => {
    const v = value.trim();
    if (v === '0' || v === '50%' || v === '100%' || v.includes('var(')) return m;
    if (/^(999+px|9999px)$/.test(v)) { n++; return `${head}var(--radius-full)${tail}`; }
    // multi-value shorthand, e.g. "6px 6px 0 0"
    const parts = v.split(/\s+/);
    if (parts.length > 1) {
      const mapped = parts.map((p) => {
        const px = toPx(p);
        return px === null ? p : `var(--${pick(RADIUS_STEPS, px)})`;
      });
      n++;
      return `${head}${mapped.join(' ')}${tail}`;
    }
    const px = toPx(v);
    if (px === null) return m;
    n++;
    return `${head}var(--${pick(RADIUS_STEPS, px)})${tail}`;
  });

  return [src, n];
}

const files = execSync(
  `grep -rlE '#[0-9a-fA-F]{3,8}\\b|font-size:|border-radius:' ${WEB}/components ${WEB}/pages ${WEB}/layouts 2>/dev/null || true`,
  { encoding: 'utf8' },
).trim().split('\n').filter(Boolean);

const unmapped = new Map();
let totalReplaced = 0;
let filesChanged = 0;

for (const file of files) {
  const before = readFileSync(file, 'utf8');
  let replaced = 0;

  // Walk declarations: `prop: ...value...;`
  let after = before.replace(
    /([a-zA-Z-]+)\s*:\s*((?=[^;{}]*(?:#[0-9a-fA-F]{3,8}|\b(?:white|black|whitesmoke|lightgray|lightgrey|silver|gray|grey|red|green|blue|orange)\b))[^;{}]+)(;|(?=\n\s*\}))/g,
    (match, prop, value, tail) => {
      const role = roleFor(prop);
      let newValue = value.replace(
        new RegExp(`\\b(${Object.keys(KEYWORDS).join('|')})\\b(?![-\\w(])`, 'gi'),
        (word) => {
          const concept = KEYWORDS[word.toLowerCase()];
          if (!concept) return word;
          replaced++;
          return `var(--${CONCEPTS[concept][role]})`;
        },
      );
      newValue = newValue.replace(/#[0-9a-fA-F]{3,8}\b/g, (hex) => {
        const key = hex.toLowerCase();
        if (RAW[key]) { replaced++; return RAW[key]; }
        const concept = HEX[key];
        if (!concept) {
          unmapped.set(key, (unmapped.get(key) || 0) + 1);
          return hex;
        }
        replaced++;
        return `var(--${CONCEPTS[concept][role]})`;
      });
      return `${prop}: ${newValue}${tail}`;
    },
  );

  const [afterSizes, sizeCount] = rewriteSizes(after);
  after = afterSizes;
  replaced += sizeCount;

  if (after !== before) {
    if (WRITE) writeFileSync(file, after);
    filesChanged++;
    totalReplaced += replaced;
  }
}

console.log(`${WRITE ? 'Rewrote' : 'Would rewrite'} ${filesChanged} files, ${totalReplaced} literals.`);
if (unmapped.size) {
  console.log(`\nUnmapped (${unmapped.size} distinct, left untouched):`);
  [...unmapped.entries()].sort((a, b) => b[1] - a[1])
    .forEach(([hex, n]) => console.log(`  ${String(n).padStart(4)}  ${hex}`));
}
