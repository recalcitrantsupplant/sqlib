/**
 * The tags the W3C rules suite is seeded with, and how each entry earns them.
 *
 * The suite's first axis of organisation was `Test.group`, a free-text field
 * the seeder set to the manifest directory (`eval`, `syntax`, …). That axis is
 * *where a test came from*, and it was the only one a reader could sort 208
 * tests by. It answers "which directory", never "which feature", and the two
 * questions a reader actually asks — *what does this exercise* and *what is it
 * asserting* — cut straight across the directories: templates are in `syntax`
 * and `eval` alike, and half of `syntax` asserts rejection while all of `eval`
 * asserts a graph.
 *
 * Tags are the axis that answers those — classification, not containment — so
 * a test carries several and appears under each. `Test.group` is gone, and the
 * directory it held is the fourth family here. Four families:
 *
 * - **Kind** — `evaluation` or `document check`. Whether the test runs
 *   something. This is the eval/document split the seeder already makes, said
 *   in a way that survives a refreshed snapshot adding a seventh directory.
 * - **Assertion** — `must accept`, `must reject`, `expects error`. What a pass
 *   means. Without it the 30 documents that are *supposed* to be unparseable
 *   read as failures of ours.
 * - **Feature** — `templates`, `negation`, `RDFS`, … Which part of the spec is
 *   under test, inferred from the entry name.
 * - **Origin** — `eval/`, `syntax/`, … The manifest directory the entry came
 *   from, which is the axis `Test.group` used to hold. Named with the trailing
 *   slash it has in the suite, which says *directory* in one character and
 *   keeps `stratification/` from colliding with the `stratification` feature —
 *   two different claims about a test that happen to share a word.
 *
 * **Inferred from names, deliberately.** The manifests carry no feature
 * vocabulary — no `dct:subject`, no keywords — so there is nothing to read. The
 * names are the suite's own taxonomy, and consistently so: `syntax-template-*`,
 * `eval-neg-data-*`, `rdfs-domain-*`. Matching them keeps the mapping honest
 * about what it is (a reading of the file names) and keeps a refreshed snapshot
 * tagging itself. An entry matching no feature rule takes no feature tag, and
 * lands in the sidebar's computed Untagged group — a visible gap is better than
 * a wrong label, and it is the signal that a rule is missing here.
 *
 * Applying them is `seed.ts`; the tags themselves are ordinary `Tag` entities in
 * the suite's library, so they rename, recolour and delete like any other.
 */

import type { DocumentCategory, EvalCategory, W3cRulesDocumentEntry, W3cRulesEvalEntry } from './manifest.js';

/**
 * The eight categorical colours, mirroring `packages/web/src/lib/tagPalette.ts`.
 *
 * Copied rather than imported: the api package does not depend on the web one,
 * and a tag stores a literal `#rrggbb` precisely so that nothing has to resolve
 * a shared token. A drift between the two lists costs nothing — the colour is
 * data once written, and the UI renders whatever hex it finds.
 */
const PALETTE = [
  '#2f6feb',
  '#0d7676',
  '#b8603a',
  '#6b3a7a',
  '#15803d',
  '#b45309',
  '#0b7285',
  '#6f42c1',
] as const;

export interface W3cSuiteTag {
  /** Stable, id-forming, and never shown: `mintId('tag', 'w3c-<slug>')`. */
  slug: string;
  /** What the sidebar heading reads. */
  name: string;
  description: string;
  color: string;
}

/**
 * Every tag the suite can apply, in the order they are created.
 *
 * Order is what fixes the colours — the nth tag takes the nth palette entry,
 * wrapping past eight — so an insertion in the middle recolours the tail. Add
 * at the end unless the recolour is what you meant.
 */
export const W3C_SUITE_TAGS: readonly W3cSuiteTag[] = [
  // Kind.
  {
    slug: 'evaluation',
    name: 'evaluation',
    description: 'Runs a rule set over a data graph and compares the inference graph it produces.',
  },
  {
    slug: 'document-check',
    name: 'document check',
    description: 'Checks the document itself — syntax, well-formedness or stratification. Nothing is executed.',
  },
  // Assertion.
  {
    slug: 'must-accept',
    name: 'must accept',
    description: 'The check has to accept this document. A failure here is a parser or analysis that is too strict.',
  },
  {
    slug: 'must-reject',
    name: 'must reject',
    description: 'The check has to reject this document. These are stored deliberately invalid, and a pass means we caught it.',
  },
  {
    slug: 'expects-error',
    name: 'expects error',
    description: 'Evaluation is expected to raise an error rather than produce a graph.',
  },
  // Feature.
  { slug: 'basic', name: 'basic', description: 'Positive datalog — the plain rule shape everything else builds on.' },
  { slug: 'blank-nodes', name: 'blank nodes', description: 'Blank nodes in rule bodies and heads, and the ones inference mints.' },
  { slug: 'patterns', name: 'patterns', description: 'Triple patterns in the rule body.' },
  { slug: 'data-blocks', name: 'data blocks', description: 'DATA blocks: ground triples a rule set carries, and WHERE DATA / NOT DATA over them.' },
  { slug: 'negation', name: 'negation', description: 'NOT and NOT DATA, and the stratification they require.' },
  { slug: 'filters', name: 'filters', description: 'FILTER in the rule body, including the errors it can raise.' },
  { slug: 'rdfs', name: 'RDFS', description: 'The RDFS entailment rules — subclass, subproperty, domain, range.' },
  { slug: 'assignment', name: 'assignment', description: 'BIND-style assignment and the expressions it evaluates.' },
  { slug: 'property-paths', name: 'property paths', description: 'Property paths in the rule body.' },
  { slug: 'default-values', name: 'default values', description: 'Default values, and how they interact with WHERE and negation.' },
  { slug: 'templates', name: 'templates', description: 'The rule head — the template whose instances become the inference graph.' },
  { slug: 'terms', name: 'terms', description: 'Term syntax: IRIs, literals, datatypes and language tags.' },
  { slug: 'reification', name: 'reification', description: 'RDF 1.2 reifiers and triple terms.' },
  { slug: 'rule-set-structure', name: 'rule set structure', description: 'The shape of the document as a whole — prologue, rule order, nesting.' },
  { slug: 'stratification', name: 'stratification', description: 'Whether the rule set can be stratified at all.' },
  { slug: 'well-formedness', name: 'well-formedness', description: 'Constraints beyond the grammar — legal syntax that is still not a usable rule set.' },
  { slug: 'worked-example', name: 'worked example', description: 'An example from the specification, run as written.' },
  {
    slug: 'rule-form',
    name: 'rule form',
    description: 'The RULE … WHERE … shape itself — its keywords, its two blocks, and what may nest inside them.',
  },
  // Origin. Appended, and to be appended to: the order above fixes the
  // colours, so slotting these in beside their features would recolour every
  // feature tag after them.
  { slug: 'origin-eval', name: 'eval/', description: 'From the eval/ directory of the W3C rules suite.' },
  { slug: 'origin-eval2', name: 'eval2/', description: 'From the eval2/ directory of the W3C rules suite.' },
  { slug: 'origin-examples', name: 'examples/', description: 'From the examples/ directory of the W3C rules suite.' },
  { slug: 'origin-syntax', name: 'syntax/', description: 'From the syntax/ directory of the W3C rules suite.' },
  { slug: 'origin-wellformed', name: 'wellformed/', description: 'From the wellformed/ directory of the W3C rules suite.' },
  {
    slug: 'origin-stratification',
    name: 'stratification/',
    description: 'From the stratification/ directory of the W3C rules suite.',
  },
].map((tag, index) => ({ ...tag, color: PALETTE[index % PALETTE.length] }));

const BY_SLUG = new Map(W3C_SUITE_TAGS.map(tag => [tag.slug, tag]));

/** Every slug in `W3C_SUITE_TAGS`, for a caller that wants to check one. */
export function isW3cSuiteTagSlug(slug: string): boolean {
  return BY_SLUG.has(slug);
}

/**
 * Which feature a name names.
 *
 * Read against the entry's key — the manifest local name for an eval entry, the
 * file stem for a document one — with **every** matching rule applied:
 * `eval-neg-data-01` is about negation *and* about DATA blocks, and a first-match
 * rule would have to choose which of the two the reader was looking for.
 *
 * The `(^|-)…(-|$)` fencing is what keeps `-data-` from matching `dft-value`
 * and `-neg-` from matching a hypothetical `negotiate`; the suite's names are
 * hyphen-separated words throughout, so the word boundary is a hyphen.
 */
const FEATURE_RULES: ReadonlyArray<{ pattern: RegExp; tag: string }> = [
  { pattern: /(^|-)basic(-|$)/, tag: 'basic' },
  { pattern: /(^|-)bnodes?(-|$)/, tag: 'blank-nodes' },
  { pattern: /(^|-)patterns?(-|$)/, tag: 'patterns' },
  { pattern: /(^|-)data(-|$)/, tag: 'data-blocks' },
  { pattern: /(^|-)(neg|negation)(-|$)|elements-not/, tag: 'negation' },
  { pattern: /(^|-)(filter|elements-filter)(-|$)/, tag: 'filters' },
  { pattern: /(^|-)rdfs(-|$)/, tag: 'rdfs' },
  { pattern: /(^|-)assign(-|$)/, tag: 'assignment' },
  { pattern: /(^|-)paths?(-|$)/, tag: 'property-paths' },
  { pattern: /(^|-)dft-value(-|$)/, tag: 'default-values' },
  { pattern: /(^|-)template(-|$)/, tag: 'templates' },
  { pattern: /(^|-)terms(-|$)/, tag: 'terms' },
  { pattern: /(^|-)reification(-|$)/, tag: 'reification' },
  { pattern: /(^|-)ruleset-structure(-|$)/, tag: 'rule-set-structure' },
  // Last, and deliberately broad: `syntax-rule-bad-*` is a truncated `RULE`
  // with no other word in its name, and the `syntax-rule-elements/paths/terms`
  // families are all about what may appear inside those two blocks. They keep
  // their specific tag as well — a rule body with a FILTER in it is both.
  { pattern: /(^|-)rule(-|$)/, tag: 'rule-form' },
];

/**
 * The tag naming the directory an entry came from.
 *
 * Derived rather than mapped: every category has one, and a refreshed snapshot
 * growing a seventh directory should fail loudly in the catalogue check rather
 * than quietly file its entries under no origin at all.
 */
function originTag(category: DocumentCategory | EvalCategory): string {
  return `origin-${category}`;
}

/** The feature a category asserts wholesale, where the directory is the feature. */
const CATEGORY_FEATURE: Partial<Record<DocumentCategory | EvalCategory, string>> = {
  stratification: 'stratification',
  wellformed: 'well-formedness',
  examples: 'worked-example',
};

function featureTags(key: string): string[] {
  return FEATURE_RULES.filter(rule => rule.pattern.test(key)).map(rule => rule.tag);
}

/**
 * Strip the `<category>-` the slug carries, leaving the suite's own name.
 *
 * The category is already said by the origin tag, and leaving it in would make
 * `stratification-01` match nothing while `stratification-stratification-01`
 * matched a rule about the word appearing twice.
 */
function keyOf(slug: string, category: string): string {
  return slug.startsWith(`${category}-`) ? slug.slice(category.length + 1) : slug;
}

/** Distinct, in catalogue order, so two tests tagged the same read the same. */
function order(slugs: Iterable<string>): string[] {
  const wanted = new Set(slugs);
  return W3C_SUITE_TAGS.filter(tag => wanted.has(tag.slug)).map(tag => tag.slug);
}

/**
 * An eval entry's tags: it evaluates, it exercises features, and a few of them
 * expect an error rather than a graph.
 *
 * The key takes the rule set's file stem as well as the entry name, because
 * `eval2` names two entries `link-path-N` while their rule sets are
 * `link-N-path.srl` — the feature word is in one or the other depending on the
 * entry, and reading both means neither has to be canonical.
 */
export function tagsForEvalEntry(entry: W3cRulesEvalEntry): string[] {
  const key = `${keyOf(entry.slug, entry.category)}-${entry.rulesetFile.replace(/\.[^.]+$/, '')}`;
  const tags = ['evaluation', originTag(entry.category), ...featureTags(key)];
  const categoryFeature = CATEGORY_FEATURE[entry.category];
  if (categoryFeature) tags.push(categoryFeature);
  // `eval-filter-error-1`, `eval-assign-error-1`: the rule set is expected to
  // fail at evaluation, so a graph coming back is the failure.
  if (/(^|-)error(-|$|\d)/.test(key)) tags.push('expects-error');
  return order(tags);
}

/** A document entry's tags: it checks a document, with a polarity, over a feature. */
export function tagsForDocumentEntry(entry: W3cRulesDocumentEntry): string[] {
  const key = keyOf(entry.slug, entry.category);
  const tags = [
    'document-check',
    originTag(entry.category),
    entry.accepted ? 'must-accept' : 'must-reject',
    ...featureTags(key),
  ];
  const categoryFeature = CATEGORY_FEATURE[entry.category];
  if (categoryFeature) tags.push(categoryFeature);
  return order(tags);
}
