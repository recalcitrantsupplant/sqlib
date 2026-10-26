import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as oxigraph from 'oxigraph';
import { checkWellFormed, parseRuleSet, splitRuleSet, stratify } from '@sparql-query-lib/srl';
import { readW3cRulesDocumentSuite, readW3cRulesEvalSuite } from '../../src/lib/w3cRulesSuite/manifest.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';
import { overrideFeatureFlags, resetFeatureFlags } from '../../src/config/featureFlags.js';

/**
 * `GROUP` aggregation against three sets of W3C-style cases:
 *
 * - `packages/srl/test/w3c-proposed/pr-1375/syntax/`: the suite's `GROUP`
 *   syntax tests as they stand on w3c/data-shapes#1375, which puts a comma
 *   between aggregation assignments;
 * - `packages/srl/test/w3c-proposed/group/`: the cases proposed for the suite
 *   in data-shapes `notes-1347/proposed-tests.html`, written against #1375,
 *   #1376 and #1377 as if merged;
 * - `packages/srl/test/w3c-proposed/aggregates/`: sqlib's earlier cases for
 *   syntax, well-formedness, stratification and evaluation.
 *
 * Both are read with the same manifest reader as the vendored suite, which also
 * checks they are in its format. Syntax, well-formedness and stratification
 * are document checks; evaluation runs through the real executor on Oxigraph.
 */

const hoisted = vi.hoisted(() => ({ entities: new Map<string, unknown>() }));

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({ get: (id: string) => hoisted.entities.get(id) }),
});

const { RuleSetExecutor } = await import('../../src/lib/RuleSetExecutor.js');

const PROPOSED_DIR = fileURLToPath(new URL('../../../srl/test/w3c-proposed/aggregates', import.meta.url));
const PR_DIR = fileURLToPath(new URL('../../../srl/test/w3c-proposed/pr-1375', import.meta.url));
const GROUP_DIR = fileURLToPath(new URL('../../../srl/test/w3c-proposed/group', import.meta.url));
const OPTIONS = { aggregates: true } as const;

/** Register one RuleVersion per rule in the document, and return their ids. */
function rulesOf(slug: string, document: string): string[] {
  const ruleSet = parseRuleSet(document, OPTIONS);
  return splitRuleSet(ruleSet).map((rule) => {
    const $id = `urn:test:rule-version:${slug}:${rule.index}`;
    hoisted.entities.set($id, {
      $id,
      '@type': 'RuleVersion',
      isPartOf: `urn:test:rule:${slug}:${rule.index}`,
      version: 1,
      ruleString: `${ruleSet.prologueText}\n${rule.text}`,
      grammarValid: true,
    });
    return $id;
  });
}

/** A graph as sorted N-Quads lines, so two spellings of it compare equal. */
function canonical(text: string, format: string): string[] {
  const store = new oxigraph.Store();
  if (text.trim()) store.load(text, { format });
  return store.dump({ format: 'application/n-quads' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

const parses = (document: string, options = OPTIONS): boolean => {
  try {
    parseRuleSet(document, options);
    return true;
  } catch {
    return false;
  }
};

beforeEach(() => {
  hoisted.entities.clear();
  overrideFeatureFlags({ ruleAggregates: true });
});

afterAll(() => {
  resetFeatureFlags();
});

const prSyntaxSuite = await readW3cRulesDocumentSuite('syntax', PR_DIR);
const syntaxSuite = await readW3cRulesDocumentSuite('syntax', PROPOSED_DIR);
const wellformedSuite = await readW3cRulesDocumentSuite('wellformed', PROPOSED_DIR);
const stratificationSuite = await readW3cRulesDocumentSuite('stratification', PROPOSED_DIR);
const evalSuite = await readW3cRulesEvalSuite('eval', PROPOSED_DIR);
const groupSyntaxSuite = await readW3cRulesDocumentSuite('syntax', GROUP_DIR);
const groupWellformedSuite = await readW3cRulesDocumentSuite('wellformed', GROUP_DIR);
const groupStratificationSuite = await readW3cRulesDocumentSuite('stratification', GROUP_DIR);
const groupEvalSuite = await readW3cRulesEvalSuite('eval', GROUP_DIR);

describe('GROUP cases — the manifests', () => {
  it('reads every entry of every category', () => {
    expect(prSyntaxSuite.entries).toHaveLength(26);
    expect(syntaxSuite.entries).toHaveLength(25);
    expect(wellformedSuite.entries).toHaveLength(22);
    expect(stratificationSuite.entries).toHaveLength(6);
    expect(evalSuite.entries).toHaveLength(25);
    expect(groupSyntaxSuite.entries).toHaveLength(40);
    expect(groupWellformedSuite.entries).toHaveLength(26);
    expect(groupStratificationSuite.entries).toHaveLength(7);
    expect(groupEvalSuite.entries).toHaveLength(23);
  });
});

describe('GROUP cases — the syntax tests of w3c/data-shapes#1375', () => {
  for (const entry of prSyntaxSuite.entries) {
    it(`${entry.name} is ${entry.accepted ? 'accepted' : 'rejected'}`, () => {
      expect(parses(entry.document)).toBe(entry.accepted);
    });
  }
});

type DocumentSuite = Awaited<ReturnType<typeof readW3cRulesDocumentSuite>>;
type EvalSuite = Awaited<ReturnType<typeof readW3cRulesEvalSuite>>;

/** The four categories of one set of cases, each read from its manifest. */
function describeCases(
  label: string,
  suites: { syntax: DocumentSuite; wellformed: DocumentSuite; stratification: DocumentSuite; eval: EvalSuite },
): void {
  describe(`${label} — syntax`, () => {
    for (const entry of suites.syntax.entries) {
      it(`${entry.name} is ${entry.accepted ? 'accepted' : 'rejected'}`, () => {
        expect(parses(entry.document)).toBe(entry.accepted);
      });
    }

    it('rejects every positive case when the extension is off', () => {
      const accepted = suites.syntax.entries
        .filter((entry) => entry.accepted && parses(entry.document, { aggregates: false } as never))
        .map((entry) => entry.name);
      expect(accepted).toEqual([]);
    });
  });

  describe(`${label} — well-formedness`, () => {
    for (const entry of suites.wellformed.entries) {
      it(`${entry.name} is ${entry.accepted ? 'accepted' : 'rejected'}`, () => {
        const ruleSet = parseRuleSet(entry.document, OPTIONS);
        expect(checkWellFormed(ruleSet)).toEqual(entry.accepted ? [] : expect.arrayContaining([expect.anything()]));
      });
    }
  });

  describe(`${label} — stratification`, () => {
    for (const entry of suites.stratification.entries) {
      it(`${entry.name} is ${entry.accepted ? 'accepted' : 'rejected'}`, () => {
        const ruleSet = parseRuleSet(entry.document, OPTIONS);
        // Each case is syntactically legal and well-formed, so a rejection is
        // the stratifier's and nothing else's.
        expect(checkWellFormed(ruleSet)).toEqual([]);
        const report = stratify(ruleSet.rules.map((ast, i) => ({ id: `r${i}`, ast })));
        expect(report.issues.length === 0).toBe(entry.accepted);
      });
    }
  });

  describe(`${label} — evaluation`, () => {
    for (const entry of suites.eval.entries) {
      it(entry.name, async () => {
        // Every case is well-formed, so the executor's answer is the one tested.
        expect(checkWellFormed(parseRuleSet(entry.ruleset, OPTIONS))).toEqual([]);
        const result = await new RuleSetExecutor().execute(
          {
            $id: `urn:test:rule-set-version:${entry.slug}`,
            '@type': 'RuleSetVersion',
            isPartOf: `urn:test:rule-set:${entry.slug}`,
            version: 1,
            hasRule: rulesOf(entry.slug, entry.ruleset),
            hasDataBlock: [],
          } as never,
          { initialGraph: entry.data, initialGraphFormat: 'turtle', maxIterations: 10 },
        );

        expect(result.error).toBeUndefined();
        expect(result.status).toBe('converged');
        expect(canonical(result.finalGraphNQuads ?? '', 'application/n-quads'))
          .toEqual(canonical(entry.result, 'text/turtle'));
      });
    }
  });
}

describeCases('GROUP cases', {
  syntax: syntaxSuite, wellformed: wellformedSuite, stratification: stratificationSuite, eval: evalSuite,
});

describeCases('GROUP cases proposed in notes-1347', {
  syntax: groupSyntaxSuite,
  wellformed: groupWellformedSuite,
  stratification: groupStratificationSuite,
  eval: groupEvalSuite,
});
