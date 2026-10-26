import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as oxigraph from 'oxigraph';
import { checkWellFormed, parseRuleSet, splitRuleSet, stratify } from '@sparql-query-lib/srl';
import { readW3cRulesDocumentSuite, readW3cRulesEvalSuite } from '../../src/lib/w3cRulesSuite/manifest.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';
import { overrideFeatureFlags, resetFeatureFlags } from '../../src/config/featureFlags.js';

/**
 * `GROUP` aggregation against sqlib's own cases in `packages/srl/test/group-cases/`,
 * which cover syntax, well-formedness, stratification and evaluation. The
 * suite's own `GROUP` tests are in the vendored W3C snapshot, and the two
 * conformance harnesses run them.
 *
 * The cases are read with the same manifest reader as the vendored suite, which
 * also checks they are in its format. Syntax, well-formedness and
 * stratification are document checks; evaluation runs through the real
 * executor on Oxigraph.
 */

const hoisted = vi.hoisted(() => ({ entities: new Map<string, unknown>() }));

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({ get: (id: string) => hoisted.entities.get(id) }),
});

const { RuleSetExecutor } = await import('../../src/lib/RuleSetExecutor.js');

const CASES_DIR = fileURLToPath(new URL('../../../srl/test/group-cases', import.meta.url));
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

const syntaxSuite = await readW3cRulesDocumentSuite('syntax', CASES_DIR);
const wellformedSuite = await readW3cRulesDocumentSuite('wellformed', CASES_DIR);
const stratificationSuite = await readW3cRulesDocumentSuite('stratification', CASES_DIR);
const evalSuite = await readW3cRulesEvalSuite('eval', CASES_DIR);

describe('GROUP cases — the manifests', () => {
  it('reads every entry of every category', () => {
    expect(syntaxSuite.entries).toHaveLength(25);
    expect(wellformedSuite.entries).toHaveLength(22);
    expect(stratificationSuite.entries).toHaveLength(6);
    expect(evalSuite.entries).toHaveLength(25);
  });
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
