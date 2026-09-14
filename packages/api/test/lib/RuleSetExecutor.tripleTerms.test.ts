import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * A rule set that reads RDF 1.2 reified data, run end to end (issue #176).
 *
 * The W3C suite's `link-path-1` is the same claim, and the harness scores it —
 * but a vendored suite is a snapshot someone else maintains. This states the
 * property in our own terms so it stays checked if the snapshot moves: a rule
 * may match a reifier and its annotation, filter on the annotation, and derive
 * from the triple the reification names.
 */

const hoisted = vi.hoisted(() => ({ entities: new Map<string, unknown>() }));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({ get: (id: string) => hoisted.entities.get(id) }),
}));

const { RuleSetExecutor } = await import('../../src/lib/RuleSetExecutor.js');

const PREFIX = 'PREFIX : <http://example/>';

function rule(id: string, ruleString: string): string {
  const $id = `urn:test:rule-version:${id}`;
  hoisted.entities.set($id, {
    $id,
    '@type': 'RuleVersion',
    isPartOf: `urn:test:rule:${id}`,
    version: 1,
    ruleString: `${PREFIX}\n${ruleString}`,
    grammarValid: true,
  });
  return $id;
}

function ruleSetVersion(hasRule: string[]) {
  return {
    $id: 'urn:test:rule-set-version:1',
    '@type': 'RuleSetVersion',
    isPartOf: 'urn:test:rule-set:1',
    version: 1,
    hasRule,
  } as never;
}

/** Three links, the middle one too weak to count. */
const LINKS = `PREFIX : <http://example/>
:x1 :link :x2 ~:linkB {| :weight 9 |} .
:x2 :link :x3 ~:linkC {| :weight 1 |} .
:x3 :link :x4 ~:linkD {| :weight 8 |} .`;

beforeEach(() => {
  hoisted.entities.clear();
});

describe('RuleSetExecutor — rules over RDF 1.2 reified data', () => {
  it('derives through a reifier annotation, and stops at the weak link', async () => {
    const result = await new RuleSetExecutor().execute(
      ruleSetVersion([
        rule('step', 'RULE { ?x :connected ?z } WHERE { ?x :link ?z ~?link {| :weight ?w |} FILTER(?w > 5) }'),
        rule('transitive', 'RULE { ?x :connected ?y } WHERE { ?x :connected ?z . ?z :connected ?y }'),
      ]),
      { initialGraph: LINKS, initialGraphFormat: 'turtle', maxIterations: 10 },
    );

    expect(result.status).toBe('converged');
    const inferred = (result.finalGraphNQuads ?? '').split('\n').filter(Boolean).sort();
    expect(inferred).toEqual([
      '<http://example/x1> <http://example/connected> <http://example/x2> .',
      '<http://example/x3> <http://example/connected> <http://example/x4> .',
    ]);
  });

  it('renders a derived triple term rather than failing on it', async () => {
    // The other direction: a rule that *writes* a reification, so the triple
    // term is in the executor's own output rather than only in its input.
    const result = await new RuleSetExecutor().execute(
      ruleSetVersion([
        rule('echo', 'RULE { ?r :restates <<( ?x :link ?z )>> } WHERE { ?r <http://www.w3.org/1999/02/22-rdf-syntax-ns#reifies> <<( ?x :link ?z )>> }'),
      ]),
      { initialGraph: LINKS, initialGraphFormat: 'turtle', maxIterations: 10 },
    );

    expect(result.status).toBe('converged');
    expect(result.finalGraphNQuads).toContain(
      '<http://example/linkB> <http://example/restates> <<( <http://example/x1> <http://example/link> <http://example/x2> )>> .',
    );
  });
});
