import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as oxigraph from 'oxigraph';
import { checkWellFormed, parseRuleSet, splitRuleSet, wellFormednessErrors } from '@sparql-query-lib/srl';
import { readW3cRulesDocumentSuite, readW3cRulesEvalSuite } from '../../src/lib/w3cRulesSuite/manifest.js';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

/**
 * The order of `NOT` in a rule body, run through the executor.
 *
 * SRL evaluates a body as a sequence, so a `NOT` only sees the variables bound
 * before it; a variable bound after it is free inside the negation, and the
 * NOT becomes "does this match anywhere at all". A SPARQL `FILTER NOT EXISTS`
 * sees its whole group wherever it is written. Rules compile to SPARQL, so the
 * compiler has to scope the filter (`packages/srl/src/compile.ts`) — and these
 * are the cases that fail when it does not.
 *
 * The cases live in `packages/srl/test/w3c-proposed/` in the W3C suite's own
 * layout, as proposed additions upstream: the vendored suite has one rule that
 * puts a NOT ahead of its binder (`stratification-04`) and no evaluation test
 * that checks what such a rule infers. They are read with the same manifest
 * reader as the vendored suite, which also checks they are in its format.
 */

const hoisted = vi.hoisted(() => ({ entities: new Map<string, unknown>() }));

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({ get: (id: string) => hoisted.entities.get(id) }),
});

const { RuleSetExecutor } = await import('../../src/lib/RuleSetExecutor.js');

const PROPOSED_DIR = fileURLToPath(new URL('../../../srl/test/w3c-proposed', import.meta.url));

/** Register one RuleVersion per rule in the document, and return their ids. */
function rulesOf(slug: string, document: string): string[] {
  const ruleSet = parseRuleSet(document);
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

/** A graph as sorted N-Triples lines, so two spellings of it compare equal. */
function canonical(text: string, format: string): string[] {
  const store = new oxigraph.Store();
  if (text.trim()) store.load(text, { format });
  return store.dump({ format: 'application/n-quads' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

beforeEach(() => {
  hoisted.entities.clear();
});

const evalSuite = await readW3cRulesEvalSuite('eval', PROPOSED_DIR);
const wellformedSuite = await readW3cRulesDocumentSuite('wellformed', PROPOSED_DIR);

describe('proposed W3C cases — evaluation of NOT by position', () => {
  it('reads every entry', () => {
    expect(evalSuite.entries.map((entry) => entry.name)).toHaveLength(9);
  });

  for (const entry of evalSuite.entries) {
    it(entry.name, async () => {
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

      expect(result.status).toBe('converged');
      expect(canonical(result.finalGraphNQuads ?? '', 'application/n-quads'))
        .toEqual(canonical(entry.result, 'text/turtle'));
    });
  }
});

/*
 * The spec's inUse condition (w3c/data-shapes#690, tests in #1455) makes a
 * variable of a NOT that is not bound before it local to the NOT. So every
 * case above whose NOT comes before a binder of its variables is now
 * ill-formed, and only the two controls with the NOT last are well-formed.
 * The evaluation cases stay as a record of what the executor does with such
 * a rule when it is run anyway.
 */
describe('proposed W3C cases — well-formedness under inUse', () => {
  const wellFormed = new Set(['eval-neg-order-01', 'eval-neg-order-07']);
  for (const entry of evalSuite.entries) {
    it(`${entry.name} is ${wellFormed.has(entry.name) ? 'well-formed' : 'ill-formed'}`, () => {
      const categories = wellFormednessErrors(checkWellFormed(parseRuleSet(entry.ruleset))).map((issue) => issue.category);
      if (wellFormed.has(entry.name)) expect(categories).toEqual([]);
      else expect(categories).toContain('in-use');
    });
  }
});

describe('proposed W3C cases — well-formedness inside a NOT', () => {
  for (const entry of wellformedSuite.entries) {
    it(`${entry.name} is ${entry.accepted ? 'accepted' : 'rejected'}`, () => {
      expect(wellFormednessErrors(checkWellFormed(parseRuleSet(entry.document))).length === 0).toBe(entry.accepted);
    });
  }
});
