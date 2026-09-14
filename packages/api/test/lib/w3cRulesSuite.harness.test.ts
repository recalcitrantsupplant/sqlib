/**
 * The W3C SHACL 1.2 Rules conformance suite, run the way a user runs it.
 *
 * `packages/srl` drives the same snapshot directly against its parser and
 * analyses. This drives it through the *library*: every entry is seeded as a
 * rule set and a `Test`, then run by the ordinary `TestRunner`. The two answer
 * different questions — "does the parser conform" versus "can the library hold
 * and judge this" — and both are worth asking, which is why there are two
 * baselines beside the snapshot.
 *
 * The harness is deliberately thin, because the interesting claim is that it
 * *has nothing to do*. If this file grew a comparison of its own, the property
 * that CI checks what the Tests screen shows would be gone.
 *
 * The assertion is a **ratchet**: nothing that conformed may stop conforming.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { memoryCacheManager } from '../../src/lib/MemoryCacheManager.js';
import { oxigraphStoreManager } from '../../src/lib/OxigraphStoreManager.js';
import { TestRunner } from '../../src/lib/TestRunner.js';
import { getEntityRepositories } from '../../src/lib/CacheCoordinatorProvider.js';
import { overrideFeatureFlags, resetFeatureFlags } from '../../src/config/featureFlags.js';
import { seedW3cRulesSuite, tagIdFor, W3C_RULES_SUITE_LIBRARY_ID } from '../../src/lib/w3cRulesSuite/seed.js';
import { W3C_SUITE_TAGS } from '../../src/lib/w3cRulesSuite/tags.js';
import {
  EPHEMERAL_GROUP_ID,
  GROUP_ID,
  SHACL_VALIDATION_DATA,
  SHACL_VALIDATION_EXAMPLES_LIBRARY_ID,
  SHACL_VALIDATION_SHAPES,
} from '../../src/lib/w3cRulesSuite/validationExamples.js';
import { FANOUT_GROUP_ID } from '../../src/lib/w3cRulesSuite/validationExamplesFanOut.js';
import { GraphBuilder } from '../../src/lib/orchestration/GraphBuilder.js';
import { ExecutionEngine } from '../../src/lib/orchestration/ExecutionEngine.js';
import type { LdkitQueryGroup } from '../../src/persistence/schemas/QueryGroupSchema.js';
import type { LdkitQueryGroupVersion } from '../../src/persistence/schemas/QueryGroupVersionSchema.js';
import type { LdkitQueryNode } from '../../src/persistence/schemas/QueryNodeSchema.js';
import type { LdkitTag } from '../../src/persistence/schemas/TagSchema.js';
import type { LdkitRuleSet } from '../../src/persistence/schemas/RuleSetSchema.js';
import type { LdkitRuleSetVersion } from '../../src/persistence/schemas/RuleSetVersionSchema.js';
import type { LdkitTest } from '../../src/persistence/schemas/TestSchema.js';
import type { LdkitTestVersion } from '../../src/persistence/schemas/TestVersionSchema.js';

/** Ratchet artefacts live beside the snapshot they score. */
const w3cUrl = (rel: string) => fileURLToPath(new URL(`../../../srl/test/w3c/${rel}`, import.meta.url));
const BASELINE_FILE = w3cUrl('library-expected-pass.json');
const SCOREBOARD_FILE = w3cUrl('library-scoreboard.json');

interface Verdict {
  name: string;
  category: string;
  passed: boolean;
  message: string;
}

let tempDir: string;
let verdicts: Verdict[] = [];
let skipped: Array<{ name: string; reason: string }> = [];
let seededCounts = { tests: 0, ruleSets: 0, dataGraphs: 0 };

/**
 * Which category a test belongs to.
 *
 * From the test version's own comment, which the seeder writes as
 * `<category>/<file>`: the three eval-shaped categories cannot be told apart by
 * expectation kind, and scoring them together would hide which of them we are
 * failing.
 */
function categoryOf(version: LdkitTestVersion | null): string {
  const comment = version?.comment ?? '';
  const category = comment.split('/')[0]?.trim();
  return category || 'unknown';
}

beforeAll(async () => {
  process.env.CACHE_WRITE_THROUGH = 'false';
  process.env.CACHE_PRELOAD = 'false';
  // 30 of these documents are *supposed* not to parse. Without the override the
  // writers refuse them — correctly — and a third of the suite would be
  // unseedable rather than failing, which is a different and less useful fact.
  overrideFeatureFlags({ rulesAllowInvalidSave: true });
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'w3c-rules-suite-'));
  await oxigraphStoreManager.initialize(tempDir);
  await memoryCacheManager.loadAll();

  const seeded = await seedW3cRulesSuite();
  skipped = seeded.skipped;
  seededCounts = {
    tests: seeded.testsCreated,
    ruleSets: seeded.ruleSetsCreated,
    dataGraphs: seeded.dataGraphsCreated,
  };

  const repos = getEntityRepositories();
  const tests = (repos.Test.list() as LdkitTest[])
    .filter(test => test.isPartOf?.includes(W3C_RULES_SUITE_LIBRARY_ID));

  const runner = new TestRunner();
  const results: Verdict[] = [];
  for (const test of tests) {
    if (!test.currentVersion) continue;
    const category = categoryOf(repos.TestVersion.get(test.currentVersion) as LdkitTestVersion | null);
    try {
      const result = await runner.runTestVersion(test.currentVersion);
      results.push({ name: test.name, category, passed: result.passed, message: result.message });
    } catch (error) {
      // A test that cannot run is not a conforming one. It is still a verdict.
      results.push({
        name: test.name,
        category,
        passed: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  verdicts = results.sort((a, b) => a.name.localeCompare(b.name));
}, 300_000);

afterAll(async () => {
  resetFeatureFlags();
  await oxigraphStoreManager.shutdown();
  if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
});

describe('W3C SPARQL-RL conformance, as library Tests', () => {
  it('seeds every manifest entry in every category', () => {
    // A refresh that changes the count should be noticed rather than quietly
    // scored against a shorter suite. The per-category counts are asserted too,
    // because a manifest that stopped listing a whole directory would otherwise
    // balance against another one growing.
    const perCategory: Record<string, number> = {};
    for (const verdict of verdicts) perCategory[verdict.category] = (perCategory[verdict.category] ?? 0) + 1;
    expect(perCategory).toEqual({
      eval: 35,
      eval2: 6,
      examples: 5,
      syntax: 139,
      wellformed: 8,
      stratification: 10,
    });
    expect(seededCounts.tests).toBe(203);
    expect(skipped, `entries the library could not express: ${JSON.stringify(skipped)}`).toEqual([]);
  });

  it('writes the scoreboard', () => {
    const scoreboard: Record<string, { pass: number; total: number }> = {};
    for (const verdict of verdicts) {
      const entry = (scoreboard[verdict.category] ??= { pass: 0, total: 0 });
      entry.total += 1;
      if (verdict.passed) entry.pass += 1;
    }
    if (skipped.length > 0) scoreboard.unseedable = { pass: 0, total: skipped.length };
    writeFileSync(SCOREBOARD_FILE, `${JSON.stringify(scoreboard, null, 2)}\n`);
    // eslint-disable-next-line no-console
    console.log(
      `[W3C conformance, as Tests] ${Object.entries(scoreboard)
        .map(([category, score]) => `${category}: ${score.pass}/${score.total}`)
        .join('  |  ')}`,
    );
    expect(verdicts.length).toBeGreaterThan(0);
  });

  it('does not regress the ratchet baseline', () => {
    const passingNow = verdicts.filter(v => v.passed).map(v => v.name).sort();
    if (!existsSync(BASELINE_FILE)) {
      writeFileSync(BASELINE_FILE, `${JSON.stringify(passingNow, null, 2)}\n`);
    }
    const baseline: string[] = JSON.parse(readFileSync(BASELINE_FILE, 'utf8'));
    const nowSet = new Set(passingNow);
    const regressed = baseline.filter(name => !nowSet.has(name));
    const why = verdicts
      .filter(v => regressed.includes(v.name))
      .map(v => `${v.name}: ${v.message}`)
      .join(' | ');
    expect(regressed, `these previously conformed and now fail: ${why}`).toEqual([]);
  });

  it('reports newly-conforming entries (add them to library-expected-pass.json to lock them in)', () => {
    const baseline: string[] = existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) : [];
    const baseSet = new Set(baseline);
    const gained = verdicts.filter(v => v.passed && !baseSet.has(v.name)).map(v => v.name);
    if (gained.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`[W3C conformance, as Tests] ${gained.length} newly conforming: ${gained.join(', ')}`);
    }
    // Informational — a gain is good news and must never fail a run.
    expect(true).toBe(true);
  });

  it('stores the deliberately-invalid documents rather than skipping them', () => {
    // The half of the suite that only exists because of the invalid-save
    // override. If these ever became unseedable the ratchet would still pass —
    // they would simply stop being tests — so the count is asserted directly.
    const negativeSyntax = verdicts.filter(v => v.category === 'syntax' && v.name.includes('-bad-'));
    expect(negativeSyntax.length).toBeGreaterThanOrEqual(30);
  });

  it('tags every test, in the suite\'s own library', () => {
    const repos = getEntityRepositories();
    const tags = (repos.Tag.list() as LdkitTag[]).filter(tag => tag.isPartOf === W3C_RULES_SUITE_LIBRARY_ID);
    expect(tags).toHaveLength(W3C_SUITE_TAGS.length);

    const tests = (repos.Test.list() as LdkitTest[])
      .filter(test => test.isPartOf?.includes(W3C_RULES_SUITE_LIBRARY_ID));
    const untagged = tests.filter(test => (test.tags ?? []).length === 0).map(test => test.name);
    expect(untagged, 'every seeded test carries at least its kind tag').toEqual([]);

    // The two axes the tags exist to add, spot-checked against the counts the
    // suite's own shape fixes: 46 entries evaluate, 157 check a document.
    const carrying = (slug: string) =>
      tests.filter(test => (test.tags ?? []).includes(tagIdFor(slug))).length;
    expect(carrying('evaluation')).toBe(46);
    expect(carrying('document-check')).toBe(157);
    expect(carrying('must-reject')).toBe(39);
  });

  it('seeding twice creates nothing the second time', async () => {
    const again = await seedW3cRulesSuite();
    expect(again.testsCreated).toBe(0);
    expect(again.ruleSetsCreated).toBe(0);
    expect(again.dataGraphsCreated).toBe(0);
    expect(again.tagsCreated).toBe(0);
    // Nothing to add: the first seed tagged them, and tagging is a union, so
    // the second seed performs no writes at all.
    expect(again.testsTagged).toBe(0);
    expect(again.testsExisting).toBe(verdicts.length);
  });

  it('seeds and runs the StartNode-data SHACL query-group example', async () => {
    const repos = getEntityRepositories();
    // Three example tests: the backend-based group, the two-input group that
    // could not be covered by a Test until a case could carry more than one
    // data graph (#298), and the per-constraint-kind fan-out group (#295).
    const examples = (repos.Test.list() as LdkitTest[])
      .filter(test => test.isPartOf?.includes(SHACL_VALIDATION_EXAMPLES_LIBRARY_ID));
    expect(examples).toHaveLength(3);

    const example = examples.find(test => test.subject === GROUP_ID);
    expect(example?.subjectKind).toBe('queryGroup');
    expect(example?.currentVersion).toBeTruthy();

    const result = await new TestRunner().runTestVersion(example!.currentVersion!);
    expect(result.passed, result.message).toBe(true);
  });

  /**
   * #295: the fan-out variant, exercised as a real Test the same way the
   * minimal group's own bindings comparison is — one extraction/checker pair
   * per constraint kind and depth, a shared focus-resolution node, the
   * unsupported-constraint and shapes-cycle detectors, and the merge node
   * that unions them all into one report.
   */
  it('seeds and runs the fan-out SHACL query-group example', async () => {
    const repos = getEntityRepositories();
    const examples = (repos.Test.list() as LdkitTest[])
      .filter(test => test.isPartOf?.includes(SHACL_VALIDATION_EXAMPLES_LIBRARY_ID));

    const example = examples.find(test => test.subject === FANOUT_GROUP_ID);
    expect(example?.subjectKind).toBe('queryGroup');
    expect(example?.currentVersion).toBeTruthy();

    const result = await new TestRunner().runTestVersion(example!.currentVersion!);
    expect(result.passed, result.message).toBe(true);
  });

  /*
   * The point of #298. This group takes shapes *and* data as separate inputs,
   * so before a TestCase could carry several data graphs it could not be run
   * as a Test at all — it was covered by a direct GraphBuilder + ExecutionEngine
   * test, which kept it out of the library's own test run and the EARL report.
   */
  it('covers the two-input SHACL group with a real Test', async () => {
    const repos = getEntityRepositories();
    const example = (repos.Test.list() as LdkitTest[])
      .find(test => test.subject === EPHEMERAL_GROUP_ID);
    expect(example?.currentVersion, 'the two-input group has no Test').toBeTruthy();

    const result = await new TestRunner().runTestVersion(example!.currentVersion!);
    expect(result.passed, result.message).toBe(true);

    // Both graphs are recorded as inputs of the case, not just the first —
    // an assertion citing half its data would misreport what was run.
    const [firstCase] = result.cases;
    expect(firstCase.inputs.dataGraphVersions).toHaveLength(2);
  });

  it('runs the two-input SHACL group with both graphs supplied at the start node', async () => {
    const repos = getEntityRepositories();
    const group = repos.QueryGroup.get(EPHEMERAL_GROUP_ID) as LdkitQueryGroup | null;
    expect(group?.currentVersion).toBeTruthy();

    const version = repos.QueryGroupVersion.get(group!.currentVersion!) as LdkitQueryGroupVersion;
    // Neither node may fall back to a real backend: both read only what this
    // run hands them, into stores of their own.
    const stores = (version.executionNodes ?? [])
      .map(nodeId => (repos.QueryNode.get(nodeId) as LdkitQueryNode).backendConfig)
      .map(config => {
        expect(config?.type).toBe('ephemeral-oxigraph');
        return config!.storeId;
      });
    expect(new Set(stores).size).toBe(stores.length);

    const graph = new GraphBuilder().buildFromGroupVersion(version);
    // Positional, in the order the start node declares them: shapes, then data.
    const { result } = await new ExecutionEngine().execute(graph, [], undefined, {
      dataGraphs: [
        { content: SHACL_VALIDATION_SHAPES, format: 'turtle' },
        { content: SHACL_VALIDATION_DATA, format: 'turtle' },
      ],
    });

    const bindings = (result as { results?: { bindings?: Array<Record<string, { value: string }>> } })
      .results?.bindings ?? [];
    // The same three violations the backend-based group finds: passing the
    // shapes in by value must not change the verdict.
    expect(bindings.map(row => [row.focus?.value, row.path1?.value, row.constraintKind?.value])).toEqual([
      ['https://example.com/validation#bert', 'https://example.com/validation#address', 'minCount'],
      ['https://example.com/validation#bert', 'https://example.com/validation#age', 'datatype'],
      ['https://example.com/validation#bert', 'https://example.com/validation#email', 'minCount'],
    ]);
  });

  it('reseeds a validation group version that lost the node config it needs', async () => {
    const repos = getEntityRepositories();
    const group = repos.QueryGroup.get(EPHEMERAL_GROUP_ID) as LdkitQueryGroup;
    const staleVersionId = group.currentVersion!;
    const nodeIds = (repos.QueryGroupVersion.get(staleVersionId) as LdkitQueryGroupVersion).executionNodes ?? [];

    // The state a store seeded before #280 is in, and equally the state #305
    // leaves every store in after a restart: the group and its version are
    // present, but the nodes have no usable `backendConfig`. A presence check
    // calls this seeded.
    //
    // Since #297 these nodes carry no `backendId` either — the ephemeral store
    // *is* their backend — so losing the config leaves them with no backend at
    // all, and the builder now says exactly that instead of reporting it
    // downstream as an edge that cannot be consumed.
    for (const nodeId of nodeIds) {
      await repos.QueryNode.update(nodeId, { backendConfig: null });
    }
    expect(() => new GraphBuilder().buildFromGroupVersionId(staleVersionId)).toThrow(/has no backend/);

    await seedW3cRulesSuite();

    const repaired = repos.QueryGroup.get(EPHEMERAL_GROUP_ID) as LdkitQueryGroup;
    expect(repaired.currentVersion).not.toBe(staleVersionId);
    expect(() => new GraphBuilder().buildFromGroupVersionId(repaired.currentVersion!)).not.toThrow();
  });

  it('repairs a rule set whose current-version target was lost', async () => {
    const repos = getEntityRepositories();
    const ruleSet = (repos.RuleSet.list() as LdkitRuleSet[])
      .find(candidate => candidate.name === 'eval-basic-02.srl');
    expect(ruleSet?.currentVersion).toBeTruthy();

    // Simulate the state a failed historical write or a bad migration leaves:
    // the stable parent remains, but its current-version target is gone.
    await repos.RuleSetVersion.delete(ruleSet!.currentVersion!);

    await seedW3cRulesSuite();

    const repaired = repos.RuleSet.get(ruleSet!.$id) as LdkitRuleSet;
    const current = repos.RuleSetVersion.get(repaired.currentVersion!) as LdkitRuleSetVersion | null;
    expect(current).toMatchObject({ isPartOf: repaired.$id, version: 1 });
  });
});
