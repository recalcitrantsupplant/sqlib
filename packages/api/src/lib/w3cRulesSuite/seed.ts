/**
 * Loading the W3C SPARQL-RL test suite into a library, as Tests.
 *
 * All four categories, 166 entries, expressed with entities that already
 * existed. The conformance harness is not a harness: it is a `DataGraph`, a
 * `RuleSet` and a `Test` per manifest entry, run by the ordinary test runner
 * and visible on the ordinary Tests screen. Anything a custom harness would
 * have had to build — graph comparison, blank-node isomorphism, a verdict with
 * a diff — the runner already does, and doing it twice is how the two would
 * come to disagree.
 *
 * The two shapes:
 *
 * - `eval/` → a rule set run against a data graph, `graph` expectation against
 *   the suite's expected inference graph.
 * - `syntax/`, `wellformed/`, `stratification/` → a rule set holding the
 *   document, `analysis` expectation naming the check and whether it should
 *   accept. Nothing is executed, which is what makes the 30 documents that must
 *   *not parse* expressible: they are stored through the same invalid-save
 *   override the rule editor's "save anyway" uses, and the editor shows them in
 *   red exactly as it shows any rule the grammar rejected.
 *
 * See issue #150 and `docs/guides/testing-and-conformance.md`.
 *
 * **Idempotent by construction.** Every parent entity gets an id derived from
 * its name in the suite, and each step skips a complete artefact. A restart
 * against a persistent store re-seeds nothing; a seed interrupted half way
 * repairs the missing version rather than leaving a library that looks done.
 */

import {
  expandIris,
  parseRuleSet,
  splitDataBlocks,
  splitRuleSet,
  type SrlDataBlockDocument,
  type SrlRuleDocument,
} from '@sparql-query-lib/srl';
import { getCacheCoordinator, getEntityRepositories } from '../CacheCoordinatorProvider.js';
import { mintId } from '../id.js';
import { createDataBlockVersion } from '../DataBlockVersionWriter.js';
import { createDataGraphVersion } from '../DataGraphVersionWriter.js';
import { createRuleVersion } from '../RuleVersionWriter.js';
import { createRuleSetVersion } from '../RuleSetVersionWriter.js';
import { createTestVersion } from '../TestVersionWriter.js';
import type { LdkitDataBlock } from '../../persistence/schemas/DataBlockSchema.js';
import type { LdkitDataGraph } from '../../persistence/schemas/DataGraphSchema.js';
import type { LdkitLibrary } from '../../persistence/schemas/LibrarySchema.js';
import type { LdkitRule } from '../../persistence/schemas/RuleSchema.js';
import type { LdkitRuleSet } from '../../persistence/schemas/RuleSetSchema.js';
import type { LdkitTag } from '../../persistence/schemas/TagSchema.js';
import type { LdkitTest } from '../../persistence/schemas/TestSchema.js';
import { getFeatureFlags } from '../../config/featureFlags.js';
import { RuleGrammarValidator } from '../RuleGrammarValidator.js';
import type { SrlCheck } from '../srlChecks.js';
import {
  DOCUMENT_CATEGORIES,
  EVAL_CATEGORIES,
  readW3cRulesDocumentSuite,
  readW3cRulesEvalSuite,
  suiteExists,
  resolveSuiteDir,
  type W3cRulesDocumentEntry,
  type W3cRulesEvalEntry,
} from './manifest.js';
import { W3C_SUITE_TAGS, tagsForDocumentEntry, tagsForEvalEntry } from './tags.js';
import { seedShaclValidationExamples } from './validationExamples.js';
import { seedShaclValidationFanOutExample } from './validationExamplesFanOut.js';

/**
 * The library the suite lands in.
 *
 * A library of its own, not the system library: these are ordinary entities a
 * reader is meant to open, edit a copy of, and run — not machinery the app
 * needs to function. Naming it deterministically is what makes re-seeding a
 * no-op.
 */
// The slug predates the language's rename to SPARQL-RL; it is a persisted id, so
// changing it would re-seed a second library beside an existing store's.
export const W3C_RULES_SUITE_LIBRARY_ID = mintId('library', 'w3c-shacl12-rules');

const LIBRARY_NAME = 'W3C SPARQL-RL — conformance suite';
const LIBRARY_DESCRIPTION =
  'The W3C SPARQL-RL test suite, vendored at a pinned commit and loaded as Tests. The eval '
  + 'tests run a rule set against a data graph and compare the inference graph; the syntax, '
  + 'well-formedness and stratification tests check the document itself, and the ones the spec says '
  + 'must be rejected are stored deliberately invalid. Read-only in spirit — refreshing the '
  + 'snapshot rewrites it.';

export interface SeedResult {
  libraryId: string;
  suiteDir: string;
  /** Tests created by this call. Zero on a re-run, which is the point. */
  testsCreated: number;
  /** Tests that were already present and were left alone. */
  testsExisting: number;
  ruleSetsCreated: number;
  dataGraphsCreated: number;
  /** Tags created by this call. Zero on a re-run, like the rest. */
  tagsCreated: number;
  /**
   * Tests that gained a tag they were missing — new ones, and old ones seeded
   * before the suite had tags at all.
   */
  testsTagged: number;
  /**
   * Tests that gained their `criterion` on this run rather than at creation.
   *
   * Non-zero exactly once per store: on the first boot after the conformance
   * profile landed, when every seeded test predates the field.
   */
  testsLinked: number;
  /** Entries that could not be loaded, with the reason. Never throws for these. */
  skipped: Array<{ name: string; reason: string }>;
}

export interface SeedOptions {
  /** Where the vendored suite lives. Defaults to the monorepo snapshot. */
  suiteDir?: string;
  log?: (message: string) => void;
}

/**
 * Load the suite, skipping anything already loaded.
 *
 * An entry that will not load is recorded in `skipped` rather than thrown: one
 * entry the library cannot express must not cost the other 165 their tests.
 * What we *cannot express* is a different fact from what we *get wrong*, and
 * only the second should show up as a failing test.
 */
export async function seedW3cRulesSuite(options: SeedOptions = {}): Promise<SeedResult> {
  const log = options.log ?? (() => {});
  const suiteDir = resolveSuiteDir(options.suiteDir);

  const result: SeedResult = {
    libraryId: W3C_RULES_SUITE_LIBRARY_ID,
    suiteDir,
    testsCreated: 0,
    testsExisting: 0,
    ruleSetsCreated: 0,
    dataGraphsCreated: 0,
    tagsCreated: 0,
    testsTagged: 0,
    testsLinked: 0,
    skipped: [],
  };

  await ensureLibrary(log);
  await ensureTags(result, log);

  for (const category of EVAL_CATEGORIES) {
    const evalSuite = await readW3cRulesEvalSuite(category, suiteDir);
    for (const entry of evalSuite.entries) {
      // Ensure dependencies before deciding whether the Test itself exists.
      // A prior interrupted seed can leave a stable parent pointing at a
      // missing version; an existing Test must not hide that corruption.
      const dataGraphVersionId = await ensureDataGraph(entry, result, log);
      const ruleSetId = await ensureRuleSet(entry, result, log);
      await seedOne(entry.name, testIdFor(entry), tagsForEvalEntry(entry), entry.criterion, result, log, async testId => {
        await ensureEvalTest(entry, testId, ruleSetId, dataGraphVersionId);
      });
    }
  }

  for (const category of DOCUMENT_CATEGORIES) {
    const documents = await readW3cRulesDocumentSuite(category, suiteDir);
    for (const entry of documents.entries) {
      const ruleSetId = await ensureDocumentRuleSet(entry, result, log);
      await seedOne(entry.name, documentTestIdFor(entry), tagsForDocumentEntry(entry), entry.criterion, result, log, async testId => {
        await ensureDocumentTest(entry, testId, ruleSetId);
      });
    }
  }

  // Kept in a companion library: they use the local suite's boot path, but are
  // design examples rather than claims about the W3C conformance snapshot.
  await seedShaclValidationExamples(log);
  await seedShaclValidationFanOutExample(log);

  return result;
}

/**
 * One entry: skip it if it is already there, record it if it will not load.
 *
 * A test that is already present still has its tags checked. That is what makes
 * tagging reach a store seeded before the suite had tags — the alternative,
 * tagging only on create, would leave every existing rules-tests store
 * permanently untagged with no way to fix it short of `just
 * clean-local-rules-tests`.
 */
async function seedOne(
  name: string,
  testId: string,
  tagSlugs: string[],
  criterion: string,
  result: SeedResult,
  log: (message: string) => void,
  create: (testId: string) => Promise<void>,
): Promise<void> {
  const existing = repos().Test.get(testId) as LdkitTest | null;
  if (existing?.currentVersion) {
    result.testsExisting += 1;
    await applyTags(existing, tagSlugs, result);
    await applyCriterion(existing, criterion, result);
    return;
  }
  try {
    await create(testId);
    result.testsCreated += 1;
    const created = repos().Test.get(testId) as LdkitTest | null;
    if (created) {
      await applyTags(created, tagSlugs, result);
      await applyCriterion(created, criterion, result);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    result.skipped.push({ name, reason });
    log(`  – ${name} skipped: ${reason}`);
  }
}

/**
 * Add the suite's tags to a test, keeping any it already carries.
 *
 * A union rather than an assignment: these are ordinary entities, and someone
 * tagging one `to-investigate` should not have it swept away by the next boot.
 * The write is skipped entirely when there is nothing to add, so a re-seed of
 * 208 tagged tests performs no writes at all.
 */
async function applyTags(test: LdkitTest, tagSlugs: string[], result: SeedResult): Promise<void> {
  const wanted = tagSlugs.map(tagIdFor);
  const current = test.tags ?? [];
  const missing = wanted.filter(tag => !current.includes(tag));
  if (missing.length === 0) return;
  await repos().Test.update(test.$id, { tags: [...current, ...missing] } as Partial<LdkitTest>);
  result.testsTagged += 1;
}

/**
 * Point a seeded test at the manifest entry it implements, if it is not already.
 *
 * A backfill on the same terms as the tags above: a store seeded before the
 * field existed holds 208 tests that would otherwise never acquire it, and a
 * conformance report of tests with no criterion is a report citing our own
 * minted ids — worthless to a reviewer. Written only when it differs, so a
 * re-seed of a linked suite performs no writes; overwritten when it differs
 * because the criterion is the manifest's fact about the entry, not a user
 * annotation the way a tag is (a changed value means the suite was republished
 * elsewhere, and the report must follow it).
 */
async function applyCriterion(test: LdkitTest, criterion: string, result: SeedResult): Promise<void> {
  if (test.criterion === criterion) return;
  await repos().Test.update(test.$id, { criterion } as Partial<LdkitTest>);
  result.testsLinked += 1;
}

/**
 * Seed only if the suite is on disk and the store has not got it already.
 *
 * The startup path, where "the files are not there" is a fact about the
 * deployment rather than an error: a slim image that ships no test suite should
 * boot, not fail.
 */
export async function seedW3cRulesSuiteIfAvailable(options: SeedOptions = {}): Promise<SeedResult | null> {
  const dir = resolveSuiteDir(options.suiteDir);
  if (!(await suiteExists(dir))) {
    options.log?.(`W3C rules suite not found at ${dir}; nothing seeded.`);
    return null;
  }
  return seedW3cRulesSuite({ ...options, suiteDir: dir });
}

function repos() {
  return getEntityRepositories();
}

/**
 * A current-version pointer is usable only when its target still exists and
 * identifies this parent as its owner. Checking the pointer alone made an
 * interrupted write look complete to later seed runs.
 */
function hasCurrentVersion(
  kind: 'DataGraphVersion' | 'RuleSetVersion',
  parentId: string,
  versionId: string | null | undefined,
): boolean {
  if (!versionId) return false;
  const version = kind === 'DataGraphVersion'
    ? repos().DataGraphVersion.get(versionId)
    : repos().RuleSetVersion.get(versionId);
  return Boolean(version && (version as { isPartOf?: string }).isPartOf === parentId);
}

/**
 * A stable id per suite artefact, so a second seed recognises the first's work.
 *
 * Every one is category-qualified. `eval/` and `eval2/` both contain a
 * `data-empty.ttl`, and `examples/` names files that read like `eval/`'s — two
 * directories' worth of different content under one id would make the second
 * seed silently reuse the first's.
 */
function dataGraphIdFor(entry: W3cRulesEvalEntry): string {
  return mintId('dataGraph', `w3c-${entry.category}-${stem(entry.dataFile)}`);
}

function ruleSetIdFor(entry: W3cRulesEvalEntry): string {
  return mintId('ruleset', `w3c-${entry.category}-${stem(entry.rulesetFile)}`);
}

function testIdFor(entry: W3cRulesEvalEntry): string {
  return mintId('test', `w3c-${entry.slug}`);
}

function documentRuleSetIdFor(entry: W3cRulesDocumentEntry): string {
  return mintId('ruleset', `w3c-${entry.slug}`);
}

function documentTestIdFor(entry: W3cRulesDocumentEntry): string {
  return mintId('test', `w3c-${entry.slug}`);
}

/** A suite tag's id, from its slug. Same derivation, same idempotence. */
export function tagIdFor(slug: string): string {
  return mintId('tag', `w3c-${slug}`);
}

function stem(file: string): string {
  return file.replace(/\.[^.]+$/, '');
}

async function ensureLibrary(log: (message: string) => void): Promise<void> {
  if (repos().Library.get(W3C_RULES_SUITE_LIBRARY_ID)) return;
  await repos().Library.create({
    $id: W3C_RULES_SUITE_LIBRARY_ID,
    name: LIBRARY_NAME,
    description: LIBRARY_DESCRIPTION,
  } as Partial<LdkitLibrary> & { $id: string });
  log(`Created library ${W3C_RULES_SUITE_LIBRARY_ID}`);
}

/**
 * The suite's tags, one `Tag` entity each, created before anything carries them.
 *
 * Ids derive from the slug the same way every other suite artefact's does, so a
 * second seed finds the first's tags rather than minting a parallel set — and a
 * tag the reader has since renamed or recoloured is left exactly as they left
 * it, because presence is the only thing checked.
 */
async function ensureTags(result: SeedResult, log: (message: string) => void): Promise<void> {
  for (const tag of W3C_SUITE_TAGS) {
    const tagId = tagIdFor(tag.slug);
    if (repos().Tag.get(tagId)) continue;
    await repos().Tag.create({
      $id: tagId,
      name: tag.name,
      description: tag.description,
      color: tag.color,
      isPartOf: W3C_RULES_SUITE_LIBRARY_ID,
    } as Partial<LdkitTag> & { $id: string });
    result.tagsCreated += 1;
    log(`Created tag ${tag.name}`);
  }
}

/**
 * The data graph an entry runs against, created once per file.
 *
 * Six of the eleven entries share `rdfs.srl` and three share `data-empty.ttl`;
 * keying on the file rather than the entry is what makes the library read like
 * the suite — one RDFS rule set with six tests pointing at it — instead of six
 * copies of the same rules.
 */
async function ensureDataGraph(
  entry: W3cRulesEvalEntry,
  result: SeedResult,
  log: (message: string) => void,
): Promise<string> {
  const dataGraphId = dataGraphIdFor(entry);
  const existing = repos().DataGraph.get(dataGraphId) as LdkitDataGraph | null;
  if (hasCurrentVersion('DataGraphVersion', dataGraphId, existing?.currentVersion)) {
    return existing!.currentVersion!;
  }

  if (!existing) {
    await repos().DataGraph.create({
      $id: dataGraphId,
      name: entry.dataFile,
      description: `Base graph (G0) from the W3C rules ${entry.category} suite: ${entry.dataFile}`,
      isPartOf: [W3C_RULES_SUITE_LIBRARY_ID],
    } as Partial<LdkitDataGraph> & { $id: string });
    result.dataGraphsCreated += 1;
    log(`Created data graph ${entry.dataFile}`);
  }

  const version = await createDataGraphVersion(dataGraphId, {
    // Stored as the suite wrote it. The bytes on disk are the thing under
    // conformance, and a re-serialised copy would be a different artefact that
    // happens to mean the same.
    contentString: entry.data,
    contentFormat: 'text/turtle',
    comment: `W3C rules ${entry.category} suite: ${entry.dataFile}`,
    immutable: true,
  });
  return version.$id;
}

/** The rule set an eval entry runs, created once per file. */
async function ensureRuleSet(
  entry: W3cRulesEvalEntry,
  result: SeedResult,
  log: (message: string) => void,
): Promise<string> {
  return ensureRuleSetFromDocument({
    ruleSetId: ruleSetIdFor(entry),
    name: entry.rulesetFile,
    description: `Rule set from the W3C rules ${entry.category} suite: ${entry.rulesetFile}`,
    document: entry.ruleset,
    source: `${entry.category}/${entry.rulesetFile}`,
  }, result, log);
}

/**
 * Store one `.srl` document as a rule set, whatever state it is in.
 *
 * The document is split into rules and DATA blocks by the srl package — the
 * same split the `/rule-sets/:id/srl` import route uses — so what lands in the
 * library is what the editor would have written, not a seeder-specific shape.
 * No reconcile step: a rule set being created for the first time has nothing to
 * reconcile against.
 *
 * **Storing is not judging**, and the two are kept apart deliberately:
 *
 * - A document that does not parse has nothing to split, so it is stored whole
 *   as a single rule. Opening it shows the parser's complaint in red. This is
 *   the assertion itself for the 30 negative syntax tests — and, for an eval
 *   test using a construct we have not implemented, it is the difference
 *   between a visible failing test and an entry that silently never appeared.
 * - Whether the writers *accept* a rule is `RuleGrammarValidator`'s question —
 *   is this SRL or SPARQL we can execute — and it is stricter than any
 *   conformance check. `wellformed-bad-01.srl` is legal syntax, so it parses and
 *   splits, and then the validator refuses the rule for the very defect the test
 *   exists to assert. A conformance artefact has to be stored as written or the
 *   test is about something else.
 *
 * So anything the writers would refuse goes in through the invalid-save
 * override, which needs `rulesAllowInvalidSave`. Asked once up front rather than
 * caught per write, so a rule set is never left half built by a refusal on the
 * third of five rules.
 */
async function ensureRuleSetFromDocument(
  spec: { ruleSetId: string; name: string; description: string; document: string; source: string },
  result: SeedResult,
  log: (message: string) => void,
): Promise<string> {
  const { ruleSetId } = spec;
  const existing = repos().RuleSet.get(ruleSetId) as LdkitRuleSet | null;
  if (hasCurrentVersion('RuleSetVersion', ruleSetId, existing?.currentVersion)) return ruleSetId;

  let ruleDocs: Array<{ suggestedLabel: string; text: string }>;
  let dataDocs: Array<{ suggestedLabel: string; text: string }>;
  let parses: boolean;
  try {
    // `tuples: false` — TUPLE(…) is our extension, and no W3C test uses it.
    // With the extension on, a document that ought to be a syntax error would
    // parse, and we would report conformance we do not have.
    const parsed = expandIris(parseRuleSet(spec.document, { tuples: false }));
    ruleDocs = splitRuleSet(parsed) as SrlRuleDocument[];
    dataDocs = splitDataBlocks(parsed) as SrlDataBlockDocument[];
    parses = true;
  } catch {
    // The document is the rule. No label from the splitter, so it takes the
    // file's name — which is what the reader is looking for anyway.
    ruleDocs = [{ suggestedLabel: spec.name, text: spec.document.trim() }];
    dataDocs = [];
    parses = false;
  }

  const validator = new RuleGrammarValidator();
  const refused = !parses
    || ruleDocs.some(doc => !validator.validateWithAllGrammars(doc.text).valid)
    || dataDocs.some(doc => !validator.validateWithAllGrammars(doc.text).valid);

  if (refused && !getFeatureFlags().rulesAllowInvalidSave) {
    throw new Error(
      `${spec.name} is not valid by the storage grammar; set FEATURE_RULES_ALLOW_INVALID_SAVE=true to store it as written`,
    );
  }

  if (!existing) {
    await repos().RuleSet.create({
      $id: ruleSetId,
      name: spec.name,
      description: spec.description,
      isPartOf: [W3C_RULES_SUITE_LIBRARY_ID],
    } as Partial<LdkitRuleSet> & { $id: string });
    result.ruleSetsCreated += 1;
    log(`Created rule set ${spec.name}`);
  }

  const hasRule: string[] = [];
  for (const doc of ruleDocs) {
    const ruleId = mintId('rule');
    await repos().Rule.create({
      $id: ruleId,
      name: memberName(spec.name, doc.suggestedLabel, ruleDocs.length),
      description: `From ${spec.source}`,
      isPartOf: [W3C_RULES_SUITE_LIBRARY_ID],
    } as Partial<LdkitRule> & { $id: string });
    const version = await createRuleVersion(ruleId, {
      ruleString: doc.text,
      immutable: true,
      allowInvalidSave: refused,
    });
    hasRule.push(version.$id);
  }

  const hasDataBlock: string[] = [];
  for (const doc of dataDocs) {
    const dataBlockId = mintId('dataBlock');
    await repos().DataBlock.create({
      $id: dataBlockId,
      name: memberName(spec.name, doc.suggestedLabel, dataDocs.length),
      description: `From ${spec.source}`,
      isPartOf: [W3C_RULES_SUITE_LIBRARY_ID],
    } as Partial<LdkitDataBlock> & { $id: string });
    const version = await createDataBlockVersion(dataBlockId, {
      dataString: doc.text,
      immutable: true,
      allowInvalidSave: refused,
    });
    hasDataBlock.push(version.$id);
  }

  await createRuleSetVersion(ruleSetId, {
    comment: `Imported from ${spec.source} (W3C rules suite)`,
    hasRule,
    hasDataBlock,
    immutable: true,
    allowInvalidSave: refused,
  });
  return ruleSetId;
}

/**
 * What to call a rule or data block lifted out of a suite document.
 *
 * `splitRuleSet` labels members `rule-1`, `rule-2`, … scoped to the document
 * they came from, which is right for the SRL import route — you are looking at
 * one rule set. Here 200-odd documents land in one library, and most of the
 * syntax suite is a single `RULE {} WHERE {}` with no head predicate to suffix
 * the label with, so the rail filled up with 207 rules all called `rule-1`.
 *
 * The document name is what tells them apart, so it leads. The member label is
 * appended only when the document has more than one — for the single-rule
 * documents that are most of the suite, `rule-1` says nothing the reader wants.
 */
function memberName(documentName: string, label: string, siblings: number): string {
  return siblings > 1 ? `${documentName} · ${label}` : documentName;
}

/**
 * The test itself: this rule set, that data graph, this expected inference graph.
 *
 * The subject version is left unpinned. Pinning would make each of these a
 * conformance test against the rule set as seeded; unpinned they are regression
 * tests against whatever the rule set is now, which is what someone editing a
 * copy of the RDFS rules wants to see break.
 */
async function ensureEvalTest(
  entry: W3cRulesEvalEntry,
  testId: string,
  ruleSetId: string,
  dataGraphVersionId: string,
): Promise<void> {
  if (!repos().Test.get(testId)) {
    await repos().Test.create({
      $id: testId,
      name: entry.name,
      description: `W3C SPARQL-RL conformance: ${entry.rulesetFile} over ${entry.dataFile}`,
      criterion: entry.criterion,
      subject: ruleSetId,
      subjectKind: 'ruleSet',
      isPartOf: [W3C_RULES_SUITE_LIBRARY_ID],
    } as Partial<LdkitTest> & { $id: string });
  }

  await createTestVersion(testId, {
    expectationKind: 'graph',
    // One case. A manifest entry is one rule set against one data graph with
    // one expected result — the degenerate shape of a parametrised test, not a
    // different kind of one.
    cases: [{
      dataGraphVersion: dataGraphVersionId,
      // Verbatim Turtle, read through `expectedFormat`. The alternative —
      // converting to N-Quads on the way in — would show the reader a graph the
      // suite never wrote, in the one place they go to ask what is expected.
      expected: entry.result,
      expectedFormat: 'text/turtle',
    }],
    // `<category>/<file>`, the same shape a document test's comment takes, so
    // one reader can tell which part of the suite any test came from.
    comment: `${entry.category}/${entry.resultFile}`,
    immutable: true,
  });
}

/** A rule set holding one document from `syntax/`, `wellformed/` or `stratification/`. */
async function ensureDocumentRuleSet(
  entry: W3cRulesDocumentEntry,
  result: SeedResult,
  log: (message: string) => void,
): Promise<string> {
  return ensureRuleSetFromDocument({
    ruleSetId: documentRuleSetIdFor(entry),
    name: entry.name,
    description: `W3C rules ${entry.category} test: the document must be ${entry.accepted ? 'accepted' : 'rejected'}`,
    document: entry.document,
    source: `${entry.category}/${entry.file}`,
  }, result, log);
}

/**
 * The test: run this check over that document, and expect this answer.
 *
 * The check is named in the expectation rather than inferred from the rule set,
 * because a document can be legal syntax and badly stratified at once — the
 * suite has entries asserting each — and a test that did not say which check it
 * meant would be asserting whichever one the runner happened to pick.
 */
async function ensureDocumentTest(
  entry: W3cRulesDocumentEntry,
  testId: string,
  ruleSetId: string,
): Promise<void> {
  if (!repos().Test.get(testId)) {
    await repos().Test.create({
      $id: testId,
      name: entry.name,
      description: `W3C SPARQL-RL ${entry.category}: the check must `
        + `${entry.accepted ? 'accept' : 'reject'} ${entry.file}`,
      criterion: entry.criterion,
      subject: ruleSetId,
      subjectKind: 'ruleSet',
      isPartOf: [W3C_RULES_SUITE_LIBRARY_ID],
    } as Partial<LdkitTest> & { $id: string });
  }

  await createTestVersion(testId, {
    expectationKind: 'analysis',
    cases: [{
      expected: JSON.stringify({ check: entry.category, accepted: entry.accepted } satisfies { check: SrlCheck; accepted: boolean }),
    }],
    comment: `${entry.category}/${entry.file}`,
    immutable: true,
  });
}

/** Has the suite already been loaded into this store? */
export function isW3cRulesSuiteSeeded(): boolean {
  return Boolean(getCacheCoordinator().get(W3C_RULES_SUITE_LIBRARY_ID));
}
