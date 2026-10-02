import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as oxigraph from 'oxigraph';
import { checkWellFormed, parseRuleSet, splitRuleSet, stratify } from '@sparql-query-lib/srl';
import { readW3cRulesDocumentSuite, readW3cRulesEvalSuite } from '../../src/lib/w3cRulesSuite/manifest.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';
import { overrideFeatureFlags, resetFeatureFlags } from '../../src/config/featureFlags.js';

/**
 * The rule-aggregates extension against the proposed W3C-style cases in
 * `packages/srl/test/w3c-proposed/aggregates/`.
 *
 * The cases are written in the suite's own layout and vocabulary, so they can
 * be offered upstream with the proposal in w3c/data-shapes#840. They are read
 * with the same manifest reader as the vendored suite, which also checks they
 * are in its format: syntax, well-formedness and stratification as document
 * checks, evaluation through the real executor on Oxigraph.
 */

const hoisted = vi.hoisted(() => ({ entities: new Map<string, unknown>() }));

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({ get: (id: string) => hoisted.entities.get(id) }),
});

const { RuleSetExecutor } = await import('../../src/lib/RuleSetExecutor.js');

const PROPOSED_DIR = fileURLToPath(new URL('../../../srl/test/w3c-proposed/aggregates', import.meta.url));
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

const syntaxSuite = await readW3cRulesDocumentSuite('syntax', PROPOSED_DIR);
const wellformedSuite = await readW3cRulesDocumentSuite('wellformed', PROPOSED_DIR);
const stratificationSuite = await readW3cRulesDocumentSuite('stratification', PROPOSED_DIR);
const evalSuite = await readW3cRulesEvalSuite('eval', PROPOSED_DIR);

describe('proposed aggregate cases — the manifests', () => {
  it('reads every entry of every category', () => {
    expect(syntaxSuite.entries).toHaveLength(22);
    expect(wellformedSuite.entries).toHaveLength(20);
    expect(stratificationSuite.entries).toHaveLength(6);
    expect(evalSuite.entries).toHaveLength(16);
  });
});

describe('proposed aggregate cases — syntax', () => {
  for (const entry of syntaxSuite.entries) {
    it(`${entry.name} is ${entry.accepted ? 'accepted' : 'rejected'}`, () => {
      expect(parses(entry.document)).toBe(entry.accepted);
    });
  }

  it('rejects every positive case when the extension is off', () => {
    const accepted = syntaxSuite.entries
      .filter((entry) => entry.accepted && parses(entry.document, { aggregates: false } as never))
      .map((entry) => entry.name);
    expect(accepted).toEqual([]);
  });
});

describe('proposed aggregate cases — well-formedness', () => {
  for (const entry of wellformedSuite.entries) {
    it(`${entry.name} is ${entry.accepted ? 'accepted' : 'rejected'}`, () => {
      const ruleSet = parseRuleSet(entry.document, OPTIONS);
      expect(checkWellFormed(ruleSet)).toEqual(entry.accepted ? [] : expect.arrayContaining([expect.anything()]));
    });
  }
});

describe('proposed aggregate cases — stratification', () => {
  for (const entry of stratificationSuite.entries) {
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

describe('proposed aggregate cases — evaluation', () => {
  for (const entry of evalSuite.entries) {
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
