import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fc from 'fast-check';
import { GroupHarness } from './harness/group-harness.js';
import { ALL_TEMPLATES } from './harness/query-templates.js';
import { caseArbitrary, type GeneratedCase } from './harness/graph-generator.js';
import { ReferenceInterpreter, resultsEqual, type OracleResult } from './harness/reference-interpreter.js';
import { OxigraphSparqlExecutor } from '../../src/server/OxigraphSparqlExecutor.js';
import { oxigraphStoreManager } from '../../src/lib/OxigraphStoreManager.js';

/**
 * Phase 2 Layer B: property-based graph fuzzing (docs §2.3).
 *
 * Properties P1-P7 from the plan. Each generated case is built through the real
 * API, executed, and compared against the reference interpreter, which computes
 * the same answer without touching any production orchestration code.
 *
 * Budget: the PR run is a fixed seed and a small case count so it stays inside
 * the smoke budget; `PHASE2_FUZZ_RUNS` turns the same file into the nightly deep
 * run. See test/phase2/README.md.
 */

import { fuzzBudget } from './harness/fuzz-budget.js';
import { findSurvivingParameterSlots } from './harness/parameter-slots.js';

// A fixed seed makes the PR run reproducible; the nightly run overrides it so
// consecutive nights explore different ground, and prints what it used.
const { runs: RUNS, seed: SEED } = fuzzBudget(50);

/**
 * The message each oracle-predicted failure must actually produce. Asserting the
 * reason - not merely that something went wrong - is what stops a refusal for an
 * unrelated cause from counting as agreement.
 */
const EXPECTED_MESSAGE: Record<'require' | 'wrongOrder' | 'mixedWildcard', string> = {
  require: 'received no bindings',
  wrongOrder: 'order mismatch',
  mixedWildcard: 'all-UNDEF row cannot be mixed with bound rows',
};

/** Turns a successful engine response into the same shape the oracle reports. */
const asOracleResult = (response: { statusCode: number; payload: string; json: () => any }): OracleResult => {
  const body = response.json();
  if (typeof body === 'boolean') return { kind: 'boolean', value: body };
  if (typeof body === 'string') {
    return { kind: 'rdf', triples: body.split('\n').map(l => l.trim()).filter(Boolean) };
  }
  return { kind: 'bindings', rows: body.results?.bindings ?? [] };
};

describe('Phase 2 graph fuzzing', () => {
  let harness: GroupHarness;
  let oracle: ReferenceInterpreter;

  beforeAll(async () => {
    harness = await GroupHarness.create('phase2-fuzz');
    for (const template of ALL_TEMPLATES) {
      await harness.defineQuery(template.key, template.sparql);
    }
    oracle = new ReferenceInterpreter(harness.rawExecutor());
  }, 120000);

  afterAll(async () => {
    await harness.destroy();
  });

  /**
   * Run one generated case end to end and return everything the properties need
   * to judge it. Shared so a single API round trip serves several properties
   * rather than rebuilding the same graph once per assertion.
   */
  const runCase = async (generated: GeneratedCase) => {
    const built = await harness.build(generated.spec);

    // P7 needs to see exactly what left the engine, and P6 needs the ephemeral
    // store lifecycle. Both are observed by spying on the shared singletons -
    // `vi.spyOn` calls through, so this records without changing behaviour -
    // rather than by reaching inside the engine. Spies go on after the graph is
    // built so only the execution's own traffic is counted.
    const recorders = [
      vi.spyOn(OxigraphSparqlExecutor.prototype, 'selectQueryParsed'),
      vi.spyOn(OxigraphSparqlExecutor.prototype, 'constructQueryParsed'),
      vi.spyOn(OxigraphSparqlExecutor.prototype, 'askQuery'),
      vi.spyOn(OxigraphSparqlExecutor.prototype, 'update'),
    ];
    const createSpy = vi.spyOn(oxigraphStoreManager, 'createEphemeralStore');
    const destroySpy = vi.spyOn(oxigraphStoreManager, 'destroyEphemeralStore');

    try {
      const execution = await harness.execute(built, { arguments: generated.externalArguments });
      return {
        built,
        execution,
        dispatched: recorders.flatMap(recorder => recorder.mock.calls.map(call => String(call[0]))),
        created: createSpy.mock.calls.map(call => String(call[0])),
        destroyed: destroySpy.mock.calls.map(call => String(call[0])),
      };
    } finally {
      vi.restoreAllMocks();
    }
  };

  it('P1/P3/P4/P7: engine agrees with the reference interpreter', async () => {
    // What the run actually reached. A property that never generates a `require`
    // input still passes its `require` assertion, so the tally is checked at the
    // end rather than trusted - and printed, so a nightly run says what it
    // covered instead of implying it covered everything.
    const tally: Record<string, number> = {
      ok: 0, emptyResult: 0, nonEmptyResult: 0, require: 0, mixedWildcard: 0, wrongOrder: 0,
      arity1: 0, arity2: 0, explicitMapping: 0, defaultMapping: 0,
    };

    await fc.assert(fc.asyncProperty(caseArbitrary, async (generated: GeneratedCase) => {
      const { execution, dispatched } = await runCase(generated);
      const expected = await oracle.run(generated.oracle);
      tally[expected.kind === 'error' ? expected.reason : 'ok'] += 1;
      if (expected.kind === 'bindings') {
        tally[expected.rows.length === 0 ? 'emptyResult' : 'nonEmptyResult'] += 1;
      }
      tally[generated.describe.startsWith('arity=2') ? 'arity2' : 'arity1'] += 1;
      tally[generated.oracle.edges.some(e => e.variableMappings) ? 'explicitMapping' : 'defaultMapping'] += 1;

      if (expected.kind === 'error') {
        // A named failure must stay a client error, and must be the *same*
        // failure: "some 400 came back" would be satisfied by the engine
        // refusing for an entirely unrelated reason.
        expect(execution.statusCode, `${generated.describe}: expected a refusal`).toBeGreaterThanOrEqual(400);
        expect(execution.statusCode, `${generated.describe}: refused as a server error`).toBeLessThan(500);
        expect(execution.payload, `${generated.describe}: refused for the wrong reason`)
          .toContain(EXPECTED_MESSAGE[expected.reason]);
        return;
      }

      // P1: a graph the validator accepted must not die of its own shape.
      expect(
        execution.statusCode,
        `${generated.describe}: execution failed with ${execution.payload.slice(0, 300)}`,
      ).toBe(200);

      // P3/P4: exact multiset equality, so fan-in dedupe and renames are held
      // to the answer rather than to "some rows came back".
      const actual = asOracleResult(execution);
      expect(
        resultsEqual(actual, expected),
        `${generated.describe}\nengine:   ${JSON.stringify(actual).slice(0, 600)}\noracle:   ${JSON.stringify(expected).slice(0, 600)}`,
      ).toBe(true);

      // P7: the total-rewrite invariant. No parameter slot may survive into a
      // dispatched query. Note this is narrower than "no UNDEF is dispatched":
      // an edge mapping that binds only some of a target's variables leaves the
      // rest UNDEF within a bound row, which §1.1 keeps legal. Only the reserved
      // shape - one row, every term UNDEF - is a slot.
      for (const query of dispatched) {
        const surviving = findSurvivingParameterSlots(query);
        expect(
          surviving,
          `${generated.describe}: dispatched an unresolved parameter slot ${JSON.stringify(surviving)}`,
        ).toEqual([]);
      }
    }), { numRuns: RUNS, seed: SEED });

    console.log(`[phase2 fuzz] seed=${SEED} runs=${RUNS} coverage=${JSON.stringify(tally)}`);
    // The corpus must keep reaching the cases that matter, or the assertions
    // above quietly stop meaning anything.
    expect(tally.nonEmptyResult, 'no case produced rows').toBeGreaterThan(0);
    expect(tally.emptyResult, 'no case produced an empty result').toBeGreaterThan(0);
    expect(tally.require, 'no case exercised whenEmpty=require').toBeGreaterThan(0);
    // Unasserted until #49, because it was ungeneratable: the §1.3 order
    // mismatch needs a slot with at least two variables, and the corpus was
    // arity-1 only. `graph-mutations.test.ts` covered it deterministically the
    // whole time; what was missing was the fuzzer ever reaching it, so the
    // tally reported `wrongOrder: 0` and nobody could tell that from a
    // generator that had quietly stopped producing it.
    expect(tally.wrongOrder, 'no case declared an argument set in the wrong order').toBeGreaterThan(0);
    // Below arity 2 every variable-pairing rule agrees, so an arity-1-only run
    // would report the mapping assertions as covered while testing nothing.
    expect(tally.arity2, 'no case used a two-variable tuple').toBeGreaterThan(0);
    expect(tally.explicitMapping, 'no case set an explicit variable mapping').toBeGreaterThan(0);
  }, 600000);

  it('P5: the same graph and data produce the same result twice', async () => {
    await fc.assert(fc.asyncProperty(caseArbitrary, async (generated: GeneratedCase) => {
      const first = await runCase(generated);
      const second = await runCase(generated);
      expect(second.execution.statusCode).toBe(first.execution.statusCode);
      if (first.execution.statusCode !== 200) return;
      expect(
        resultsEqual(asOracleResult(second.execution), asOracleResult(first.execution)),
        `${generated.describe}: two runs of the same graph disagreed`,
      ).toBe(true);
    }), { numRuns: Math.max(5, Math.floor(RUNS / 3)), seed: SEED });
  }, 600000);

  it('P6: every ephemeral store created during a run is destroyed', async () => {
    // Scope, because "no leaks" reads wider than what this checks (#49). The
    // assertion ranges over the stores a run actually creates, and today those
    // are only the ones `RuleSetExecutor` opens. `ExecutionEngine` also cleans
    // up stores from a node-level `backendConfig` (`ExecutionEngine.ts`, the
    // `backendConfig?.type === 'ephemeral-oxigraph'` branch), and that path
    // cannot be reached through the API at all — it was descoped in Phase 7. So
    // a green P6 says nothing about it. If that path is ever wired up, this
    // property has to grow a case that reaches it, or it will keep passing
    // while covering half the cleanup surface.
    await fc.assert(fc.asyncProperty(caseArbitrary, async (generated: GeneratedCase) => {
      const { created, destroyed } = await runCase(generated);
      const leaked = created.filter(id => !destroyed.includes(id));
      expect(leaked, `${generated.describe}: leaked ephemeral stores`).toEqual([]);
    }), { numRuns: Math.max(5, Math.floor(RUNS / 3)), seed: SEED });
  }, 600000);
});
