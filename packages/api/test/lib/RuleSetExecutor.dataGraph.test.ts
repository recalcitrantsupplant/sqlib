import { describe, it, expect, beforeEach, vi } from 'vitest';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';

/**
 * The data graph is an *input*, and the executor has to keep it out of the
 * output.
 *
 * This is the property the whole DataGraph entity exists to make expressible
 * (issue #151): DATA blocks are part of a rule set and appear in its inference
 * graph; the data graph is what the rules run against and never does. Before
 * data graphs existed the only way to supply base data was a DATA block, which
 * is exactly the conflation the SHACL 1.2 Rules semantics forbids — so a test
 * that the two behave *differently* is the point, not a detail.
 */

const hoisted = vi.hoisted(() => ({ entities: new Map<string, unknown>() }));

overrideCacheCoordinatorProvider({
  getCacheCoordinator: () => ({ get: (id: string) => hoisted.entities.get(id) }),
});

const { RuleSetExecutor } = await import('../../src/lib/RuleSetExecutor.js');

const PREFIX = 'PREFIX : <http://ex/>';

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

function dataBlock(id: string, dataString: string): string {
  const $id = `urn:test:data-block-version:${id}`;
  hoisted.entities.set($id, {
    $id,
    '@type': 'DataBlockVersion',
    isPartOf: `urn:test:data-block:${id}`,
    version: 1,
    dataString: `${PREFIX}\n${dataString}`,
    grammarValid: true,
  });
  return $id;
}

function ruleSetVersion(hasRule: string[], hasDataBlock: string[] = []) {
  return {
    $id: 'urn:test:rule-set-version:1',
    '@type': 'RuleSetVersion',
    isPartOf: 'urn:test:rule-set:1',
    version: 1,
    hasRule,
    hasDataBlock,
  } as never;
}

beforeEach(() => {
  hoisted.entities.clear();
});

describe('RuleSetExecutor — the data graph as base graph', () => {
  it('matches rules against Turtle handed in as the data graph', async () => {
    const result = await new RuleSetExecutor().execute(
      ruleSetVersion([rule('reach', 'RULE { ?x :reaches ?y } WHERE { ?x :edge ?y }')]),
      {
        initialGraph: '@prefix : <http://ex/> . :a :edge :b .',
        initialGraphFormat: 'turtle',
        maxIterations: 5,
      },
    );

    expect(result.status).toBe('converged');
    expect(result.finalGraphNQuads).toContain('http://ex/reaches');
  });

  it('keeps the data graph out of the inference graph, while DATA blocks stay in it', async () => {
    const dataGraphRun = await new RuleSetExecutor().execute(
      ruleSetVersion([rule('reach', 'RULE { ?x :reaches ?y } WHERE { ?x :edge ?y }')]),
      {
        initialGraph: '@prefix : <http://ex/> . :a :edge :b .',
        initialGraphFormat: 'turtle',
        maxIterations: 5,
      },
    );

    // The edge went in and did not come out; only what the rule derived did.
    expect(dataGraphRun.finalGraphNQuads).toContain('http://ex/reaches');
    expect(dataGraphRun.finalGraphNQuads).not.toContain('http://ex/edge');

    const dataBlockRun = await new RuleSetExecutor().execute(
      ruleSetVersion(
        [rule('reach', 'RULE { ?x :reaches ?y } WHERE { ?x :edge ?y }')],
        [dataBlock('edges', 'DATA { :a :edge :b }')],
      ),
      { maxIterations: 5 },
    );

    // Same triple, supplied the other way: part of the rule set, so it is part
    // of the inference graph. `GI = { t ∈ D | t ∉ G0 }`.
    expect(dataBlockRun.finalGraphNQuads).toContain('http://ex/edge');
    expect(dataBlockRun.finalGraphNQuads).toContain('http://ex/reaches');
  });

  it('subtracts a DATA triple that the data graph already carries', async () => {
    // `GI = { t ∈ D | t ∉ G0 }` — a DATA triple already in the base graph is
    // not an inference, so it does not appear in the output.
    const result = await new RuleSetExecutor().execute(
      ruleSetVersion([], [dataBlock('edges', 'DATA { :a :edge :b }')]),
      {
        initialGraph: '@prefix : <http://ex/> . :a :edge :b .',
        initialGraphFormat: 'turtle',
        maxIterations: 5,
      },
    );

    expect(result.status).toBe('converged');
    expect(result.finalGraphNQuads?.trim()).toBe('');
  });

  it('still reads N-Triples when no format is given, as query-group chaining sends', async () => {
    const result = await new RuleSetExecutor().execute(
      ruleSetVersion([rule('reach', 'RULE { ?x :reaches ?y } WHERE { ?x :edge ?y }')]),
      {
        initialGraph: '<http://ex/a> <http://ex/edge> <http://ex/b> .',
        maxIterations: 5,
      },
    );

    expect(result.finalGraphNQuads).toContain('http://ex/reaches');
  });
});
