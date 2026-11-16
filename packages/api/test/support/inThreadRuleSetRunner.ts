/**
 * A stand-in for `lib/isolatedRuleSet.ts` that runs the rule set on this
 * thread, for route tests that mock `RuleSetExecutor`. A mock does not cross
 * into a worker thread, so without this those tests would run the real one.
 *
 *     vi.mock('../../src/lib/isolatedRuleSet.js', async () =>
 *       (await import('../support/inThreadRuleSetRunner.js')).inThreadRuleSetRunner());
 */
import { vi } from 'vitest';
import type * as Isolated from '../../src/lib/isolatedRuleSet.js';

export async function inThreadRuleSetRunner(): Promise<typeof Isolated> {
  const actual = await vi.importActual<typeof Isolated>('../../src/lib/isolatedRuleSet.js');
  const { RuleSetExecutor } = await import('../../src/lib/RuleSetExecutor.js');
  return {
    ...actual,
    runRuleSetIsolated: async job =>
      new RuleSetExecutor().execute(job.ruleSetVersion, {
        ...job.options,
        entities: new Map(job.entities.map(entity => [entity.$id, entity])),
      }),
  };
}
