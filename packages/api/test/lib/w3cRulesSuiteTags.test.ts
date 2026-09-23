/**
 * The tags the W3C rules suite earns, read off its real manifests.
 *
 * Inference from names is only as good as the names, so this asserts against
 * the vendored snapshot rather than fixtures: a refreshed suite that renames a
 * family — or adds one nothing matches — should fail here, where the fix is a
 * rule in `tags.ts`, rather than silently filing 27 tests under nothing.
 */
import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_CATEGORIES,
  EVAL_CATEGORIES,
  readW3cRulesDocumentSuite,
  readW3cRulesEvalSuite,
} from '../../src/lib/w3cRulesSuite/manifest.js';
import {
  W3C_SUITE_TAGS,
  isW3cSuiteTagSlug,
  tagsForDocumentEntry,
  tagsForEvalEntry,
} from '../../src/lib/w3cRulesSuite/tags.js';

/** Kind and assertion; everything else in the catalogue is a feature. */
const NON_FEATURE = new Set([
  'evaluation', 'document-check',
  'must-accept', 'must-reject', 'expects-error',
]);

async function tagged(): Promise<Array<{ slug: string; tags: string[] }>> {
  const rows: Array<{ slug: string; tags: string[] }> = [];
  for (const category of EVAL_CATEGORIES) {
    for (const entry of (await readW3cRulesEvalSuite(category)).entries) {
      rows.push({ slug: entry.slug, tags: tagsForEvalEntry(entry) });
    }
  }
  for (const category of DOCUMENT_CATEGORIES) {
    for (const entry of (await readW3cRulesDocumentSuite(category)).entries) {
      rows.push({ slug: entry.slug, tags: tagsForDocumentEntry(entry) });
    }
  }
  return rows;
}

describe('W3C rules suite tags', () => {
  it('has a unique slug, name and palette colour for every tag', () => {
    const slugs = W3C_SUITE_TAGS.map(tag => tag.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const names = W3C_SUITE_TAGS.map(tag => tag.name);
    expect(new Set(names).size).toBe(names.length);
    for (const tag of W3C_SUITE_TAGS) {
      expect(tag.color, tag.slug).toMatch(/^#[0-9a-f]{6}$/);
      expect(tag.description.length, tag.slug).toBeGreaterThan(0);
    }
  });

  it('gives every entry a kind and at least one feature', async () => {
    const rows = await tagged();
    expect(rows.length).toBe(203);

    const featureless = rows.filter(row => row.tags.every(tag => NON_FEATURE.has(tag)));
    expect(
      featureless.map(row => row.slug),
      'these entries match no feature rule — add one to FEATURE_RULES in tags.ts',
    ).toEqual([]);

    for (const row of rows) {
      expect(row.tags.filter(tag => tag === 'evaluation' || tag === 'document-check'), row.slug).toHaveLength(1);
      for (const tag of row.tags) expect(isW3cSuiteTagSlug(tag), `${row.slug}: ${tag}`).toBe(true);
    }
  });

  it('carries no tag that only restates the directory', async () => {
    // The origin family — one tag per manifest directory — was retired because
    // every entry's name already opens with its directory. This is the guard
    // against it coming back a tag at a time.
    for (const category of [...DOCUMENT_CATEGORIES, ...EVAL_CATEGORIES]) {
      expect(isW3cSuiteTagSlug(`origin-${category}`), category).toBe(false);
    }
    for (const row of await tagged()) {
      expect(row.tags.filter(tag => tag.startsWith('origin-')), row.slug).toEqual([]);
    }
  });

  it('keeps the three directories that are a feature in their own right', async () => {
    // `stratification-01` says nothing about what it checks, so the directory
    // is the only source for it. These are what is left of the origin axis.
    const bySlug = new Map((await tagged()).map(row => [row.slug, row.tags]));
    const all = [...bySlug].filter(([slug]) => slug.startsWith('stratification-'));
    for (const [slug, tags] of all) expect(tags, slug).toContain('stratification');
    expect(all.length).toBe(10);
    for (const [slug, tags] of [...bySlug].filter(([slug]) => slug.startsWith('wellformed-'))) {
      expect(tags, slug).toContain('well-formedness');
    }
    for (const [slug, tags] of [...bySlug].filter(([slug]) => slug.startsWith('examples-'))) {
      expect(tags, slug).toContain('worked-example');
    }
  });

  it('stays small enough to read as a list of headings', () => {
    // Not an arbitrary cap: the sidebar draws one heading per tag, and a
    // catalogue that grows past this is worth a merge rather than an entry.
    expect(W3C_SUITE_TAGS.length).toBeLessThanOrEqual(21);
  });

  it('marks every document test with the polarity it asserts, and no eval test', async () => {
    const rows = await tagged();
    for (const row of rows) {
      const polarity = row.tags.filter(tag => tag === 'must-accept' || tag === 'must-reject');
      expect(polarity, row.slug).toHaveLength(row.tags.includes('document-check') ? 1 : 0);
    }
    // The deliberately-invalid half of the syntax suite, which is the reason
    // the polarity axis exists at all.
    expect(rows.filter(row => row.tags.includes('must-reject')).length).toBeGreaterThanOrEqual(30);
  });

  it('reads the suite\'s own vocabulary off the entry names', async () => {
    const bySlug = new Map((await tagged()).map(row => [row.slug, row.tags]));

    // Two features at once, which is why every matching rule applies rather
    // than the first.
    expect(bySlug.get('eval-eval-neg-data-01')).toEqual([
      'evaluation', 'data-blocks', 'negation',
    ]);
    // The feature word lives in the rule set's file name, not the entry's.
    expect(bySlug.get('eval2-link-path-1')).toEqual(['evaluation', 'property-paths']);
    // An error is an assertion, not a feature: it keeps `filters` too.
    expect(bySlug.get('eval-eval-filter-error-1')).toEqual([
      'evaluation', 'expects-error', 'filters',
    ]);
    expect(bySlug.get('syntax-syntax-template-bad-01')).toEqual([
      'document-check', 'must-reject', 'templates',
    ]);
    expect(bySlug.get('stratification-stratification-01')).toEqual([
      'document-check', 'must-accept', 'stratification',
    ]);
    // The two merges the simplification made. `basic` and `patterns` are one
    // tag, and the document's shape and the RULE form are another.
    expect(bySlug.get('eval-eval-basic-01')).toEqual(['evaluation', 'patterns']);
    expect(bySlug.get('syntax-syntax-ruleset-structure-01')).toEqual([
      'document-check', 'must-accept', 'rule-structure',
    ]);
  });
});
