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

/** Kind, assertion and origin; everything else in the catalogue is a feature. */
const NON_FEATURE = new Set([
  'evaluation', 'document-check',
  'must-accept', 'must-reject', 'expects-error',
  ...[...DOCUMENT_CATEGORIES, ...EVAL_CATEGORIES].map(category => `origin-${category}`),
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

  it('files every entry under the directory it came from', async () => {
    // The axis `Test.group` used to hold, now a tag family like any other. A
    // refreshed snapshot growing a seventh directory fails here rather than
    // filing its entries under no origin at all.
    for (const category of [...DOCUMENT_CATEGORIES, ...EVAL_CATEGORIES]) {
      expect(isW3cSuiteTagSlug(`origin-${category}`), category).toBe(true);
    }

    const rows = await tagged();
    for (const row of rows) {
      const origins = row.tags.filter(tag => tag.startsWith('origin-'));
      expect(origins, row.slug).toHaveLength(1);
      // The slug is `<category>-<name>`, so the origin has to agree with it.
      expect(row.slug.startsWith(`${origins[0].slice('origin-'.length)}-`), row.slug).toBe(true);
    }
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
      'evaluation', 'data-blocks', 'negation', 'origin-eval',
    ]);
    // The feature word lives in the rule set's file name, not the entry's.
    expect(bySlug.get('eval2-link-path-1')).toEqual(['evaluation', 'property-paths', 'origin-eval2']);
    // An error is an assertion, not a feature: it keeps `filters` too.
    expect(bySlug.get('eval-eval-filter-error-1')).toEqual([
      'evaluation', 'expects-error', 'filters', 'origin-eval',
    ]);
    expect(bySlug.get('syntax-syntax-template-bad-01')).toEqual([
      'document-check', 'must-reject', 'templates', 'origin-syntax',
    ]);
    // The two claims that share a word and are not the same claim: the
    // directory it came from, and the thing it is testing.
    expect(bySlug.get('stratification-stratification-01')).toEqual([
      'document-check', 'must-accept', 'stratification', 'origin-stratification',
    ]);
  });
});
