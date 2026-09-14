/**
 * Reading a version's cases.
 *
 * One function, because the writer and the runner have to agree on two things
 * that are easy to get subtly different: the order (`position`, not insertion)
 * and what a version with no cases means. Split across two call sites, the
 * drift shows up as a test that validates one way and runs another.
 */

import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import type { LdkitTestCase } from '../persistence/schemas/TestCaseSchema.js';
import type { LdkitTestCaseDataGraph } from '../persistence/schemas/TestCaseDataGraphSchema.js';

/** A version's stored cases, in `position` order. Empty for a version written before cases existed. */
export function listStoredCases(testVersionId: string): LdkitTestCase[] {
  return (getCacheCoordinator().list('TestCase') as unknown as LdkitTestCase[])
    .filter(testCase => testCase.isPartOf === testVersionId)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/**
 * The cases a version actually runs.
 *
 * A version with none still runs once, as a smoke case with no inputs — the
 * shape stored before cases existed. Reporting a vacuous pass over zero cases
 * would be worse than either running it or refusing to.
 */
export function effectiveCases(testVersionId: string): LdkitTestCase[] {
  const stored = listStoredCases(testVersionId);
  if (stored.length > 0) return stored;
  return [{ $id: `${testVersionId}#case-0`, isPartOf: testVersionId, position: 0 }];
}

/**
 * A case's RDF inputs, in `position` order.
 *
 * Lives here rather than in the runner for the reason above: the order these
 * come back in decides which start-node port each graph fills when no `port`
 * is named, so the writer and the runner must not each have their own answer.
 *
 * Filtered by `isPartOf` rather than by following the case's own `dataGraphs`
 * list, matching how `listStoredCases` reads a version's cases — the child
 * knows its parent, and one direction is enough.
 */
export function listCaseDataGraphs(testCaseId: string): LdkitTestCaseDataGraph[] {
  return (getCacheCoordinator().list('TestCaseDataGraph') as unknown as LdkitTestCaseDataGraph[])
    .filter(entry => entry.isPartOf === testCaseId)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}
