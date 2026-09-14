import { mintId } from './id.js';
import { getCacheCoordinator } from './CacheCoordinatorProvider.js';
import { nextVersionNumber } from './versionNumbering.js';
import type { LdkitTestVersion } from '../persistence/schemas/TestVersionSchema.js';
import { toLdkit } from '../persistence/utils/id-adapter.js';
import { EXPECTATION_KINDS, isExpectationKind, type ExpectationKind } from './testComparators.js';
import { isSrlCheck, SRL_CHECKS } from './srlChecks.js';
import { checkSubjectKindInputs, isSubjectKind } from './subjectKinds.js';
import type { LdkitTest } from '../persistence/schemas/TestSchema.js';

type AnyRecord = Record<string, unknown>;

/**
 * One RDF input a case supplies.
 *
 * Which declared input it fills is decided by where it sits in the case's
 * list — a case says what it supplies and in what order, and the group routes
 * it.
 */
export interface TestCaseDataGraphInput {
  dataGraphVersion: string;
}

/** One parametrised case: its inputs, and what is correct given them. */
export interface TestCaseInput {
  name?: string | null;
  argumentSetVersion?: string | null;
  dataGraphVersion?: string | null;
  /**
   * The RDF inputs, for a subject that takes more than one.
   *
   * Exclusive with `dataGraphVersion`: the two are spellings of the same
   * thing, and a case setting both would leave the runner picking one and
   * silently ignoring the other (issue #298).
   */
  dataGraphs?: TestCaseDataGraphInput[] | null;
  tupleSeeds?: string | null;
  /** DuckDB statements run before an ETL subject's own SQL — the rows it reads. */
  sqlFixture?: string | null;
  expected?: string | null;
  expectedFormat?: string | null;
  ordered?: boolean | null;
}

export interface AnnotateTestVersionInput {
  comment?: string | null;
  immutable?: boolean;
}

export interface TestVersionInput {
  expectationKind: string;
  /**
   * At least one, and exactly one for an ordinary test.
   *
   * A caller that sends none gets a single empty case rather than an error: a
   * smoke test with no inputs is a legitimate one-case test, and demanding an
   * empty array to say so would be ceremony.
   */
  cases?: TestCaseInput[] | null;
  subjectVersion?: string | null;
  backend?: string | null;
  maxIterations?: number | null;
  timeoutMs?: number | null;
  comment?: string | null;
  immutable?: boolean;
}

export class TestVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestVersionError';
  }
}

/**
 * The rule the entity model cannot state: a non-smoke expectation needs
 * something to compare against.
 *
 * It spans `expectationKind` on the version and `expected` on the case, so it
 * is a property of neither — which is why it is checked here. Saving a `graph`
 * expectation with nothing expected produces a test that always passes and
 * looks like it means something, which is worse than a rejected write.
 *
 * Checked per case, because that is where `expected` lives: one bad row should
 * name itself rather than failing the whole version anonymously.
 */
function validateExpectationKind(kind: string): ExpectationKind {
  if (!isExpectationKind(kind)) {
    throw new TestVersionError(
      `Unknown expectation kind "${kind}". Expected one of: ${EXPECTATION_KINDS.join(', ')}`,
    );
  }
  return kind;
}

function describeCase(index: number, testCase: TestCaseInput): string {
  return testCase.name?.trim() ? `Case "${testCase.name.trim()}"` : `Case ${index + 1}`;
}

function validateCase(kind: ExpectationKind, testCase: TestCaseInput, index: number): void {
  const expected = testCase.expected;
  const where = describeCase(index, testCase);

  /*
   * The two spellings of the same input. Refused rather than merged: a merge
   * has to pick an order for the lone one, and any pick would be this writer
   * inventing a fact the caller did not state.
   */
  if (testCase.dataGraphVersion && testCase.dataGraphs?.length) {
    throw new TestVersionError(
      `${where} sets both dataGraphVersion and dataGraphs. They are the same input: ` +
        `use dataGraphs alone for a subject taking more than one graph.`,
    );
  }
  for (const [position, graph] of (testCase.dataGraphs ?? []).entries()) {
    if (!graph?.dataGraphVersion?.trim()) {
      throw new TestVersionError(`${where}: dataGraphs[${position}] needs a dataGraphVersion`);
    }
  }

  if (kind !== 'smoke' && !expected?.trim()) {
    throw new TestVersionError(
      `${where} needs an expected result for a ${kind} expectation. Use the smoke kind for "runs without error".`,
    );
  }
  if (kind === 'boolean' && expected && !['true', 'false'].includes(expected.trim())) {
    throw new TestVersionError(`${where}: a boolean expectation must be exactly "true" or "false"`);
  }
  if (kind === 'bindings' && expected) {
    try {
      JSON.parse(expected);
    } catch {
      throw new TestVersionError(`${where}: a bindings expectation must be a SPARQL JSON results document`);
    }
  }
  // Checked at write because the alternative is a test that runs, fails, and
  // reports that its own expectation was malformed — which looks exactly like
  // the subject being wrong, at the moment nobody is looking at the test.
  if (kind === 'analysis' && expected) {
    let parsed: { check?: unknown; accepted?: unknown };
    try {
      parsed = JSON.parse(expected);
    } catch {
      throw new TestVersionError(`${where}: an analysis expectation must be JSON`);
    }
    if (!isSrlCheck(parsed?.check) || typeof parsed?.accepted !== 'boolean') {
      throw new TestVersionError(
        `${where}: an analysis expectation must be {"check": "${SRL_CHECKS.join('" | "')}", "accepted": true | false}`,
      );
    }
  }
}

/**
 * Write the cases for a version.
 *
 * Cases are children of an immutable version, so they are written once and
 * never edited — a changed case is a new version, exactly as a changed rule is.
 */
async function writeCases(
  versionId: string,
  kind: ExpectationKind,
  cases: TestCaseInput[],
): Promise<string[]> {
  const cacheCoordinator = getCacheCoordinator();
  const ids: string[] = [];

  for (const [index, testCase] of cases.entries()) {
    validateCase(kind, testCase, index);
    const caseId = mintId('testCase');

    /*
     * Written before the case, so the case's `dataGraphs` list can name them.
     * A failure part-way leaves unreferenced children — invisible garbage —
     * rather than a case pointing at graphs that do not exist, which is the
     * same ordering `GroupVersionWriter` uses and for the same reason.
     */
    const dataGraphIds: string[] = [];
    for (const [position, graph] of (testCase.dataGraphs ?? []).entries()) {
      const graphId = mintId('testCaseDataGraph');
      await cacheCoordinator.create('TestCaseDataGraph', toLdkit({
        $id: graphId,
        '@type': 'TestCaseDataGraph',
        isPartOf: caseId,
        position,
        dataGraphVersion: graph.dataGraphVersion,
      } as Record<string, unknown>));
      dataGraphIds.push(graphId);
    }

    await cacheCoordinator.create('TestCase', toLdkit({
      $id: caseId,
      '@type': 'TestCase',
      isPartOf: versionId,
      position: index,
      name: testCase.name?.trim() || undefined,
      argumentSetVersion: testCase.argumentSetVersion ?? undefined,
      dataGraphVersion: testCase.dataGraphVersion ?? undefined,
      dataGraphs: dataGraphIds.length > 0 ? dataGraphIds : undefined,
      tupleSeeds: testCase.tupleSeeds ?? undefined,
      sqlFixture: testCase.sqlFixture ?? undefined,
      // A smoke case has no expectation by definition; storing whatever the
      // caller sent would leave a payload nothing reads.
      expected: kind === 'smoke' ? undefined : testCase.expected ?? undefined,
      expectedFormat: testCase.expectedFormat ?? undefined,
      ordered: testCase.ordered ?? undefined,
    } as Record<string, unknown>));
    ids.push(caseId);
  }

  return ids;
}

/**
 * Check the version's inputs against what its subject kind accepts.
 *
 * The rules live in `subjectKinds`, shared with the runner, so what is
 * accepted here is exactly what can be honoured there. Refused at write rather
 * than ignored at run: a stored backend on a query-group test is a value
 * nothing reads, and it would still be reported as the run's `hermetic` claim.
 *
 * A test whose subject kind is unreadable is passed over rather than refused —
 * the route that creates the test already validates the kind, so an unknown one
 * here means the entity predates the check, and failing every subsequent
 * version of it would be a worse outcome than skipping one rule.
 */
function validateSubjectKindInputs(testId: string, body: TestVersionInput, cases: TestCaseInput[]): void {
  const test = getCacheCoordinator().get(testId) as LdkitTest | null;
  const kind = test?.subjectKind;
  if (!isSubjectKind(kind)) return;

  const problems = checkSubjectKindInputs(
    kind,
    { backend: body.backend ?? null },
    cases,
    index => describeCase(index, cases[index]),
  );
  if (problems.length > 0) {
    throw new TestVersionError(problems.join(' '));
  }
  /*
   * A group case used to be refused for supplying a graph the port its pinned
   * argument set already filled. There is no such collision to check for now
   * that routing lives on the group: `TestRunner` appends a case's graphs after
   * the set's, so the set fills slots 0..n-1 and the case fills what follows.
   * Whether that adds up to the ports the start node declares is a question
   * only the run can answer, since only it has the group in hand — and
   * `ExecutionEngine.seedStartNodeDataGraphs` answers it, in both directions,
   * with a hard error.
   */

}

export async function createTestVersion(testId: string, body: TestVersionInput): Promise<LdkitTestVersion> {
  const cacheCoordinator = getCacheCoordinator();
  const nextVersion = nextVersionNumber('TestVersion', testId);

  const expectationKind = validateExpectationKind(body.expectationKind);

  // No cases means one empty case: a smoke test with no inputs is a legitimate
  // single-case test, and requiring `[{}]` to express it would be ceremony.
  const cases = body.cases?.length ? body.cases : [{}];

  // Before anything is written: `writeCases` creates as it validates, so a
  // refusal after it starts would leave the cases it had already minted behind
  // as children of a version that never existed.
  validateSubjectKindInputs(testId, body, cases);

  const versionId = mintId('testVersion');
  const caseIds = await writeCases(versionId, expectationKind, cases);

  const payload: AnyRecord = {
    $id: versionId,
    '@type': 'TestVersion',
    isPartOf: testId,
    version: nextVersion,
    // Frozen on create (issue #192). A version is a snapshot: what it holds is
    // what the reference to it means, so it is never created in a state where
    // it could still change. `immutable` on the request body is ignored rather
    // than honoured — there is no such thing as a mutable version.
    immutable: true,
    expectationKind,
    cases: caseIds,
    subjectVersion: body.subjectVersion ?? undefined,
    backend: body.backend ?? undefined,
    maxIterations: body.maxIterations ?? undefined,
    timeoutMs: body.timeoutMs ?? undefined,
    comment: body.comment ?? undefined,
  };

  const created = await cacheCoordinator.create('TestVersion', toLdkit(payload));

  const updated = await cacheCoordinator.update('Test', testId, { currentVersion: versionId });
  if (!updated) {
    throw new Error(`Failed to set currentVersion on Test ${testId}`);
  }

  return created;
}

/**
 * Annotate an existing TestVersion.
 *
 * A version is a snapshot (issue #192). Cases already refused in-place edits —
 * they carry the expectation, so rewriting one would silently change what a
 * stored verdict was a verdict *about* — and that rule now covers the whole
 * version: the subject, the backend, the limits and the expectation kind are
 * all what the test *was* when it ran. What is left is the comment, plus the
 * freeze transition for versions stored before freeze-on-create.
 */
export async function annotateTestVersion(
  versionId: string,
  body: AnnotateTestVersionInput,
): Promise<LdkitTestVersion> {
  const cacheCoordinator = getCacheCoordinator();
  const current = cacheCoordinator.get(versionId) as LdkitTestVersion | null;
  if (!current || current['@type'] !== 'TestVersion') {
    throw new Error(`TestVersion ${versionId} not found`);
  }

  const updates: AnyRecord = {};
  if (body.comment !== undefined) updates.comment = body.comment;
  if (body.immutable === true) updates.immutable = true;

  if (Object.keys(updates).length === 0) return current;

  const updated = await cacheCoordinator.update('TestVersion', versionId, updates);
  if (!updated) {
    throw new Error(`Failed to update TestVersion ${versionId}`);
  }

  return updated;
}
