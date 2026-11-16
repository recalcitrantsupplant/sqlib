/**
 * `lib/isolatedRuleSet.ts`: a rule set run in a worker thread, stopped at the
 * deadline even while one rule is still running.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { IsolatedRunStopped, runRuleSetIsolated, type RuleSetWorkerJob } from '../../src/lib/isolatedRuleSet.js';
import { RuleGrammarValidator } from '../../src/lib/RuleGrammarValidator.js';

const validator = new RuleGrammarValidator();
const now = new Date().toISOString();

function job(data: string, rules: string[], deadlineMs: number): RuleSetWorkerJob {
  const id = `urn:sqlib:ruleset:${Math.random().toString(16).slice(2)}`;
  const block = validator.validateWithAllGrammars(data);
  const dataBlock = {
    $id: `${id}:data-1`, '@type': 'DataBlockVersion' as const, isPartOf: id, version: 1,
    dataString: data, normalizedInsertData: block.normalized ?? null, grammarValid: block.valid,
    dateCreated: now, dateModified: now,
  };
  const ruleVersions = rules.map((source, idx) => {
    const checked = validator.validateWithAllGrammars(source);
    return {
      $id: `${id}:rule-${idx + 1}`, '@type': 'RuleVersion' as const, isPartOf: id, version: idx + 1,
      ruleString: source, normalizedInsert: checked.normalized ?? null, grammarValid: checked.valid,
      dateCreated: now, dateModified: now,
    };
  });
  return {
    ruleSetVersion: {
      $id: `${id}:version-1`, '@type': 'RuleSetVersion', isPartOf: id, version: 1,
      hasRule: ruleVersions.map(rv => rv.$id), hasDataBlock: [dataBlock.$id],
      dateCreated: now, dateModified: now,
    } as RuleSetWorkerJob['ruleSetVersion'],
    entities: [dataBlock, ...ruleVersions] as RuleSetWorkerJob['entities'],
    options: { inferenceFormat: 'application/n-triples', deadlineMs },
  };
}

const RING = `DATA {\n${Array.from({ length: 60 }, (_, i) => `  <urn:n${i}> <urn:p> <urn:n${(i + 1) % 60}> .`).join('\n')}\n}`;
const TRANSITIVE = 'RULE { ?a <urn:q> ?b } WHERE { ?a <urn:p> ?b }';
/** A 4-way cross product over 60 triples: about 13 million rows, many seconds on one rule. */
const HEAVY = 'RULE { ?a <urn:q> ?d } WHERE { ?a <urn:p> ?x . ?b <urn:p> ?y . ?c <urn:p> ?z . ?d <urn:p> ?w }';

/** The longest gap between ticks of a 20 ms timer while `work` runs. */
async function longestStall<T>(work: Promise<T>): Promise<number> {
  let last = Date.now();
  let longest = 0;
  const timer = setInterval(() => {
    const at = Date.now();
    longest = Math.max(longest, at - last);
    last = at;
  }, 20);
  try {
    await work.catch(() => undefined);
  } finally {
    clearInterval(timer);
  }
  return longest;
}

afterEach(() => {
  delete process.env.SQLIB_PLAYGROUND_RULE_RUNS;
});

describe('runRuleSetIsolated', () => {
  it('runs a rule set in a worker and returns its result', async () => {
    const result = await runRuleSetIsolated(job(RING, [TRANSITIVE], 10_000));
    expect(result.error ?? null, JSON.stringify(result).slice(0, 600)).toBeNull();
    expect(result.status).toBe('converged');
    expect(result.finalGraphNQuads ?? '').toContain('<urn:q>');
  }, 30_000);

  it('stops a long rule at the deadline and keeps this thread free', async () => {
    // The same deadline is long enough for a small run, worker start-up included,
    // so the stop below comes from the rule, not from a slow start.
    await expect(runRuleSetIsolated(job(RING, [TRANSITIVE], 2_000))).resolves.toMatchObject({ status: 'converged' });

    const started = Date.now();
    const run = runRuleSetIsolated(job(RING, [HEAVY], 2_000));
    const stall = await longestStall(run);
    await expect(run).rejects.toMatchObject({ name: 'IsolatedRunStopped', status: 504 });
    // 2 s deadline + 0.5 s grace, far short of the rule's own run time.
    expect(Date.now() - started).toBeLessThan(4_000);
    expect(stall).toBeLessThan(250);
  }, 30_000);

  it('refuses a run past SQLIB_PLAYGROUND_RULE_RUNS', async () => {
    process.env.SQLIB_PLAYGROUND_RULE_RUNS = '1';
    const first = runRuleSetIsolated(job(RING, [HEAVY], 300));
    await expect(runRuleSetIsolated(job(RING, [TRANSITIVE], 300))).rejects.toMatchObject({ status: 503 });
    await expect(first).rejects.toBeInstanceOf(IsolatedRunStopped);
    // The slot is free again once the first run has stopped.
    await expect(runRuleSetIsolated(job(RING, [TRANSITIVE], 10_000))).resolves.toMatchObject({ status: 'converged' });
  }, 30_000);

  it('stops when the caller goes away', async () => {
    const controller = new AbortController();
    const run = runRuleSetIsolated(job(RING, [HEAVY], 0), { signal: controller.signal });
    setTimeout(() => controller.abort(), 200);
    await expect(run).rejects.toMatchObject({ status: 499 });
  }, 30_000);
});
