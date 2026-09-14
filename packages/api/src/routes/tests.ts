/**
 * `/tests` — an invocation spec plus an expectation, run once, judged.
 *
 * Tests are a general library feature, not an SRL one. A test of a query
 * (arguments in, bindings out) is the same shape as a test of a rule set (data
 * graph in, inference graph out), so there is one entity with a `subject` that
 * points at any callable, and one comparator interface keyed by result kind.
 * The reference points *at* the subject, so a Query or RuleSet stays unaware
 * that it is tested — the same way it is unaware that it is benchmarked.
 *
 * See `docs/guides/testing-and-conformance.md`.
 */

import type { FastifyInstance, FastifyReply } from 'fastify';
import { classifyVersionPatch } from '../lib/versionPatch.js';
import { mintId } from '../lib/id.js';
import { toRestApi } from '../persistence/utils/id-adapter.js';
import type { LdkitTest } from '../persistence/schemas/TestSchema.js';
import type { LdkitTestVersion } from '../persistence/schemas/TestVersionSchema.js';
import type { LdkitTestCase } from '../persistence/schemas/TestCaseSchema.js';
import { reposRoute, validateIfMatch, setEntityConcurrencyHeaders, findVersionByNumber } from './route-helpers.js';
import type { EntityRepositories } from '../lib/EntityRepositories.js';
import { getCacheCoordinator } from '../lib/CacheCoordinatorProvider.js';
import { analyseReferences, describeWrongType } from '../lib/entityReferences.js';
import { analyseTags, inheritableTags } from '../lib/tagMembership.js';
import { createTestSchema, updateTestSchema } from '@sparql-query-lib/contracts/schema';
import { createTestVersion, annotateTestVersion, TestVersionError } from '../lib/TestVersionWriter.js';
import {
  ENTITY_TYPE_FOR_SUBJECT_KIND,
  SUBJECT_KINDS,
  TestNotRunnableError,
  TestRunner,
  isSubjectKind,
  type TestRunResult,
} from '../lib/TestRunner.js';
import { EXPECTATION_KINDS } from '../lib/testComparators.js';
import { ImmutableEntityError } from '../lib/immutability.js';
import { registerEntityAuthGuard } from '../auth/entityGuard.js';
import { filterReadable, requireLibraryMode } from '../auth/enforce.js';
import {
  negotiateReportFormat,
  renderReport,
  type TestReportEntry,
  type TestReportFormat,
  type TestReportInput,
} from '../lib/reportFormats/index.js';
import {
  getTestRun,
  listTestRuns,
  recordTestRun,
  recordTestRuns,
  toReportEntry,
} from '../lib/TestRunStore.js';

export const testResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    description: { type: 'string', nullable: true },
    subject: { type: 'string' },
    // The external test this one implements, when it implements one — a W3C
    // manifest entry, say. Exposed because it is what a conformance report
    // cites, so "which upstream test is this" has to be answerable over the API
    // rather than only inside the store.
    criterion: { type: 'string', nullable: true },
    subjectKind: { type: 'string' },
    currentVersion: { type: 'string', nullable: true },
    isPartOf: { type: 'array', items: { type: 'string' } },
    dateCreated: { type: 'string', format: 'date-time', nullable: true },
    dateModified: { type: 'string', format: 'date-time', nullable: true },
    tags: {
      type: 'array',
      items: { type: 'string' },
      nullable: true,
    },
  },
  required: ['id', 'name', 'subject', 'subjectKind', 'isPartOf'],
  additionalProperties: false,
} as const;

/**
 * A version's cases come back expanded rather than as IRIs.
 *
 * A case is meaningless without its version — it is not addressable on its own
 * and there is no `/test-cases` endpoint — so returning ids would only oblige
 * every caller to fetch N more times to draw one table.
 */
const testCaseResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    isPartOf: { type: 'string' },
    position: { type: 'integer' },
    name: { type: 'string', nullable: true },
    argumentSetVersion: { type: 'string', nullable: true },
    dataGraphVersion: { type: 'string', nullable: true },
    dataGraphs: { type: 'array', items: { type: 'string' }, nullable: true },
    tupleSeeds: { type: 'string', nullable: true },
    sqlFixture: { type: 'string', nullable: true },
    expected: { type: 'string', nullable: true },
    expectedFormat: { type: 'string', nullable: true },
    ordered: { type: 'boolean', nullable: true },
    dateCreated: { type: 'string', format: 'date-time', nullable: true },
    dateModified: { type: 'string', format: 'date-time', nullable: true },
  },
  required: ['id', 'isPartOf', 'position'],
  additionalProperties: false,
} as const;

const testVersionResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    isPartOf: { type: 'string' },
    version: { type: 'integer' },
    immutable: { type: 'boolean', nullable: true },
    expectationKind: { type: 'string' },
    cases: { type: 'array', items: testCaseResponseSchema },
    subjectVersion: { type: 'string', nullable: true },
    backend: { type: 'string', nullable: true },
    maxIterations: { type: 'integer', nullable: true },
    timeoutMs: { type: 'integer', nullable: true },
    comment: { type: 'string', nullable: true },
    dateCreated: { type: 'string', format: 'date-time', nullable: true },
    dateModified: { type: 'string', format: 'date-time', nullable: true },
  },
  required: ['id', 'isPartOf', 'version', 'expectationKind', 'cases'],
  additionalProperties: false,
} as const;

/**
 * One RDF input a case supplies, and which declared input it fills.
 *
 * A case could name only one data graph, so a query group with several RDF
 * inputs could not be covered by a Test at all (issue #298).
 */
const testCaseDataGraphBodySchema = {
  type: 'object',
  properties: {
    dataGraphVersion: { type: 'string' },
    /** By IRI or by name; omitted means positional. */
    port: { type: 'string', nullable: true },
  },
  required: ['dataGraphVersion'],
  additionalProperties: false,
} as const;

const testCaseBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string', nullable: true },
    argumentSetVersion: { type: 'string', nullable: true },
    dataGraphVersion: { type: 'string', nullable: true },
    /** Exclusive with `dataGraphVersion`; the writer refuses a case setting both. */
    dataGraphs: { type: 'array', items: testCaseDataGraphBodySchema, nullable: true },
    tupleSeeds: { type: 'string', nullable: true },
    /** DuckDB statements run before an ETL subject's own SQL — the rows it reads. */
    sqlFixture: { type: 'string', nullable: true },
    expected: { type: 'string', nullable: true },
    expectedFormat: { type: 'string', nullable: true },
    ordered: { type: 'boolean', nullable: true },
  },
  additionalProperties: false,
} as const;

const testVersionBodyProperties = {
  expectationKind: { type: 'string', enum: [...EXPECTATION_KINDS] },
  /**
   * Omitted means one empty case — a smoke test with no inputs. Order is the
   * order sent; `position` is assigned from it rather than accepted, so two
   * cases cannot claim the same slot.
   */
  cases: { type: 'array', items: testCaseBodySchema, nullable: true },
  subjectVersion: { type: 'string', nullable: true },
  backend: { type: 'string', nullable: true },
  maxIterations: { type: 'integer', minimum: 1, nullable: true },
  timeoutMs: { type: 'integer', minimum: 1, nullable: true },
  comment: { type: 'string', nullable: true },
  immutable: { type: 'boolean', nullable: true },
} as const;

const createTestVersionBodySchema = {
  type: 'object',
  properties: testVersionBodyProperties,
  required: ['expectationKind'],
  additionalProperties: false,
} as const;


/**
 * A version PATCH answers a content field with a 409 that says why, so the
 * shape carries the offending fields alongside the message.
 */
const contentPatchRejectedSchema = {
  type: 'object',
  properties: {
    error: { type: 'string' },
    fields: { type: 'array', items: { type: 'string' } },
  },
  required: ['error'],
} as const;

const annotateTestVersionBodySchema = {
  type: 'object',
  properties: { ...testVersionBodyProperties, expectationKind: { type: 'string', enum: [...EXPECTATION_KINDS], nullable: true } },
  additionalProperties: false,
} as const;

const comparisonDetailSchema = {
  type: 'object',
  nullable: true,
  properties: {
    missing: { type: 'array', items: { type: 'string' } },
    unexpected: { type: 'array', items: { type: 'string' } },
    matched: { type: 'integer' },
  },
  additionalProperties: false,
} as const;

const testCaseRunResponseSchema = {
  type: 'object',
  properties: {
    caseId: { type: 'string' },
    name: { type: 'string' },
    position: { type: 'integer' },
    passed: { type: 'boolean' },
    message: { type: 'string' },
    detail: comparisonDetailSchema,
    /**
     * What the subject produced, capped. The diff says what differs; this is
     * the thing itself, which is what a reader wants on a pass (right for the
     * right reason?) and when a diff is too long to read.
     */
    result: { type: 'string', nullable: true },
    resultTruncated: { type: 'boolean', nullable: true },
    inputs: {
      type: 'object',
      properties: {
        argumentSetVersion: { type: 'string', nullable: true },
        /** The first graph. `dataGraphVersions` is the whole list (issue #298). */
        dataGraphVersion: { type: 'string', nullable: true },
        dataGraphVersions: { type: 'array', items: { type: 'string' }, nullable: true },
      },
      additionalProperties: false,
    },
    durationMs: { type: 'number' },
  },
  required: ['caseId', 'name', 'position', 'passed', 'message', 'durationMs'],
  additionalProperties: false,
} as const;

/**
 * The verdict is per case; the top level summarises.
 *
 * `detail` is deliberately not repeated up here: a diff belongs to the case
 * that produced it, and one flattened diff across N cases would be a diff of
 * nothing in particular.
 */
const testRunResponseSchema = {
  type: 'object',
  properties: {
    testId: { type: 'string' },
    testVersionId: { type: 'string' },
    passed: { type: 'boolean' },
    message: { type: 'string' },
    expectationKind: { type: 'string' },
    hermetic: { type: 'boolean' },
    durationMs: { type: 'number' },
    subjectVersionId: { type: 'string', nullable: true },
    ranAt: { type: 'string' },
    cases: { type: 'array', items: testCaseRunResponseSchema },
    passedCount: { type: 'integer' },
    failedCount: { type: 'integer' },
  },
  required: [
    'testId', 'testVersionId', 'passed', 'message', 'expectationKind', 'hermetic',
    'durationMs', 'ranAt', 'cases', 'passedCount', 'failedCount',
  ],
  additionalProperties: false,
} as const;

/**
 * A run as it was *stored*, which is not the shape a run answers in.
 *
 * The differences are the point rather than an omission. `outcome` replaces
 * `passed` because a stored history has to hold a third state — a test that
 * could not run is not a failing test, and a boolean cannot say so. The
 * produced result text is absent because history does not keep it (see
 * `TestRunCaseSchema`). And `id` is here because a stored run is addressable,
 * which a live verdict never was.
 */
const storedRunResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    test: { type: 'string' },
    testVersion: { type: 'string', nullable: true },
    subject: { type: 'string', nullable: true },
    subjectVersion: { type: 'string', nullable: true },
    backend: { type: 'string', nullable: true },
    suite: { type: 'string', nullable: true },
    outcome: { type: 'string' },
    expectationKind: { type: 'string' },
    hermetic: { type: 'boolean', nullable: true },
    message: { type: 'string', nullable: true },
    durationMs: { type: 'number', nullable: true },
    passedCount: { type: 'integer', nullable: true },
    failedCount: { type: 'integer', nullable: true },
    ranAt: { type: 'string' },
    dateCreated: { type: 'string', format: 'date-time', nullable: true },
    dateModified: { type: 'string', format: 'date-time', nullable: true },
  },
  required: ['id', 'test', 'outcome', 'ranAt'],
  additionalProperties: false,
} as const;

const storedRunCaseResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    isPartOf: { type: 'string' },
    testCase: { type: 'string', nullable: true },
    name: { type: 'string', nullable: true },
    position: { type: 'integer', nullable: true },
    outcome: { type: 'string' },
    message: { type: 'string', nullable: true },
    /** The comparator diff, as the JSON string the exports carry. */
    detail: { type: 'string', nullable: true },
    durationMs: { type: 'number', nullable: true },
    argumentSetVersion: { type: 'string', nullable: true },
    dataGraphVersion: { type: 'string', nullable: true },
    dataGraphVersions: { type: 'array', items: { type: 'string' }, nullable: true },
    dateCreated: { type: 'string', format: 'date-time', nullable: true },
    dateModified: { type: 'string', format: 'date-time', nullable: true },
  },
  required: ['id', 'isPartOf', 'outcome'],
  additionalProperties: false,
} as const;

/** One stored run with its case rows — the run history's drill-in. */
const storedRunDetailResponseSchema = {
  type: 'object',
  properties: {
    ...storedRunResponseSchema.properties,
    cases: { type: 'array', items: storedRunCaseResponseSchema },
  },
  required: [...storedRunResponseSchema.required, 'cases'],
  additionalProperties: false,
} as const;

const runHistoryQuerySchema = {
  type: 'object',
  properties: {
    /** Newest N. Absent means everything retention kept, which is bounded. */
    limit: { type: 'integer', minimum: 1 },
  },
  additionalProperties: false,
} as const;

/**
 * Selecting tests by tag, for the list and for a batch run alike.
 *
 * `any` is the default because it is what a reader asking for two tags almost
 * always means — "the negation ones and the RDFS ones" — while `all` is the
 * narrowing they reach for deliberately ("negation *and* must-reject").
 */
export const TAG_MATCH_MODES = ['any', 'all'] as const;

export type TagMatchMode = (typeof TAG_MATCH_MODES)[number];

/** Comma-separated, whitespace-tolerant, order-preserving, duplicate-free. */
function parseTagList(raw: string | string[] | undefined | null): string[] {
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const seen = new Set<string>();
  for (const value of values) {
    for (const part of String(value).split(',')) {
      const iri = part.trim();
      if (iri) seen.add(iri);
    }
  }
  return [...seen];
}

/**
 * The tests a run named, de-duplicated and in the order they were given.
 *
 * Not `parseTagList`: an IRI may not contain a comma but nothing guarantees the
 * repository's ids never will, and splitting one in half here would report a
 * missing test that exists.
 */
function parseTestList(raw: string[] | undefined | null): string[] {
  const seen = new Set<string>();
  for (const value of Array.isArray(raw) ? raw : []) {
    const iri = String(value).trim();
    if (iri) seen.add(iri);
  }
  return [...seen];
}

/**
 * What a suite run is called, in the caller's terms.
 *
 * The tags name the suite: they are what was asked for, and the only label
 * under which a report of this run is identifiable. A run that named its tests
 * one by one has no such label — the caller's own name for that selection is
 * not something the server can know — so it says what it is. Used for the
 * report heading and stored on every run the suite produces, so a stored run
 * carries the same label its export did.
 */
function reportSuite(tags: string[]): string {
  return tags.length > 0 ? tags.join(', ') : 'selected tests';
}

function matchesTags(test: LdkitTest, tags: string[], match: TagMatchMode): boolean {
  if (tags.length === 0) return true;
  const carried = test.tags ?? [];
  return match === 'all'
    ? tags.every(tag => carried.includes(tag))
    : tags.some(tag => carried.includes(tag));
}

const errorResponseSchema = {
  type: 'object',
  properties: { error: { type: 'string' } },
  required: ['error'],
} as const;

const runByTagsBodySchema = {
  type: 'object',
  properties: {
    /**
     * The tags to run, as IRIs. Commas inside an entry are split too, so the
     * `?tags=a,b` a listing uses can be handed straight back as a run request.
     */
    tags: { type: 'array', items: { type: 'string' }, minItems: 1 },
    /**
     * The tests to run, named one by one.
     *
     * The other half of the same route: a tag is a suite the server can select,
     * and this is a suite only the caller can — the whole list, one heading of
     * it, or the failures of the last run. Both arrive as one request that runs
     * and reports as a single suite, which is what makes a report of "all
     * tests" possible at all.
     *
     * Exclusive with `tags`: a run selects one way or the other, and a body
     * carrying both is a caller that has not decided which suite it means.
     */
    tests: { type: 'array', items: { type: 'string' }, minItems: 1 },
    match: { type: 'string', enum: [...TAG_MATCH_MODES] },
    /**
     * Narrows the selection to one library.
     *
     * Rarely needed — a tag belongs to exactly one library, so the tags already
     * scope it — but it is what the route guard reads to resolve the target
     * library before the handler runs, and a caller holding grants on one
     * library of several says so here.
     */
    library: { type: 'string', nullable: true },
  },
  additionalProperties: false,
} as const;

/**
 * The tally, and every verdict behind it.
 *
 * `requested` is how many tests the tags selected, and `results` is one entry
 * per selected test — including the ones that could not run, which appear as
 * failed verdicts. The two are always the same length; the field exists so a
 * caller can say "0 tests matched" without inspecting an empty array.
 */
const runByTagsResponseSchema = {
  type: 'object',
  properties: {
    /** Empty when the run named its tests directly rather than by tag. */
    tags: { type: 'array', items: { type: 'string' } },
    match: { type: 'string' },
    requested: { type: 'integer' },
    passed: { type: 'integer' },
    failed: { type: 'integer' },
    results: { type: 'array', items: testRunResponseSchema },
  },
  required: ['tags', 'match', 'requested', 'passed', 'failed', 'results'],
  additionalProperties: false,
} as const;

/**
 * A verdict for a test that never ran.
 *
 * Shaped exactly like a real one, with no cases: no case ran, which is a
 * different fact from every case passing. The reason travels as the message, so
 * "the subject is wrong" still reads differently from "the test is wrong" — the
 * distinction the single-test route protects with a 400.
 */
function notRunResult(
  testId: string,
  testVersionId: string,
  message: string,
  expectationKind = 'unknown',
): TestRunResult {
  return {
    testId,
    testVersionId,
    passed: false,
    message,
    // Widened rather than narrowed: the kind is read off the version when there
    // is one, and a test that has no version has no expectation kind either.
    expectationKind: expectationKind as TestRunResult['expectationKind'],
    hermetic: true,
    durationMs: 0,
    subjectVersionId: null,
    ranAt: new Date().toISOString(),
    cases: [],
    passedCount: 0,
    failedCount: 0,
  };
}

/**
 * Answers with a rendered export instead of the route's JSON response.
 *
 * The `serializer` call is the load-bearing part: the route declares a response
 * schema describing its JSON body, and fastify would otherwise push a JUnit
 * document through fast-json-stringify and emit nonsense. An identity serialiser
 * is how a payload is declared already final.
 */
function sendRenderedReport(
  reply: FastifyReply,
  format: TestReportFormat,
  input: TestReportInput,
): FastifyReply {
  const rendered = renderReport(format, input);
  reply.header('content-type', rendered.contentType);
  reply.header('content-disposition', rendered.contentDisposition);
  reply.serializer((payload: unknown) => String(payload));
  return reply.send(rendered.body);
}

const idParamSchema = {
  type: 'object',
  properties: { id: { type: 'string' } },
  required: ['id'],
} as const;

const versionParamSchema = {
  type: 'object',
  properties: { id: { type: 'string' }, version: { type: 'string' } },
  required: ['id', 'version'],
} as const;

/**
 * The subject filter behind the Tests tab on a record page.
 *
 * The tab is the rail list narrowed to one subject, which is a query parameter
 * rather than a second endpoint precisely so that the two views cannot go out
 * of step.
 */
const listQuerySchema = {
  type: 'object',
  properties: {
    subject: { type: 'string' },
    subjectKind: { type: 'string', enum: [...SUBJECT_KINDS] },
    /**
     * One or more tag IRIs, comma-separated.
     *
     * A single repeated-or-comma parameter rather than `tag=&tag=`: the same
     * spelling has to work in a URL, in a run request body and in whatever a
     * reader types by hand, and one parser for all three is what keeps
     * "the list I am looking at" and "the tests that just ran" the same set.
     */
    tags: { type: 'string' },
    /** `any` (default) is a union across the tags; `all` is an intersection. */
    match: { type: 'string', enum: [...TAG_MATCH_MODES] },
  },
  additionalProperties: false,
} as const;

/**
 * A version with its cases inlined, in `position` order.
 *
 * Every route that returns a version goes through this, so the shape cannot
 * differ between "created" and "fetched" — which is the divergence that would
 * otherwise show up as a UI that renders cases only after a reload.
 */
function serializeVersion(version: LdkitTestVersion, allCases: LdkitTestCase[]): Record<string, unknown> {
  const cases = allCases
    .filter(testCase => testCase.isPartOf === version.$id)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map(testCase => toRestApi(testCase));
  return { ...toRestApi(version), cases };
}

/**
 * Delete a version and the cases that belong to it.
 *
 * Cases have no life of their own — they are addressable only through their
 * version — so leaving them behind would accumulate orphans that nothing can
 * reach and nothing will ever clean up.
 */
async function deleteVersionCascade(repos: EntityRepositories, versionId: string): Promise<void> {
  const cases = (repos.TestCase.list() as LdkitTestCase[]).filter(testCase => testCase.isPartOf === versionId);
  for (const testCase of cases) {
    await repos.TestCase.delete(testCase.$id);
  }
  await repos.TestVersion.delete(versionId);
}

export default async function (fastify: FastifyInstance) {
  registerEntityAuthGuard(fastify, { executeSuffixes: ['/run'], exemptSuffixes: [] });

  fastify.get('/', ...reposRoute({
      tags: ['Test'],
      summary: 'List tests, optionally filtered by subject or tags',
      querystring: listQuerySchema,
      response: {
        200: { type: 'array', items: testResponseSchema },
      },
    }, async ({ repos, reply, request }) => {
    const { subject, subjectKind, match } = request.query;
    const tags = parseTagList(request.query.tags);
    const items = (repos.Test.list() as LdkitTest[])
      .filter(test => (subject ? test.subject === subject : true))
      .filter(test => (subjectKind ? test.subjectKind === subjectKind : true))
      .filter(test => matchesTags(test, tags, match === 'all' ? 'all' : 'any'));
    // The querystring narrows; it does not authorize. `route-coverage.test.ts`
    // classified this listing as returning "what the caller may see, filtered
    // downstream" — nothing downstream filtered it, so a principal holding
    // nothing was answered every test in the deployment.
    return reply.send(filterReadable(request, items).map(test => toRestApi(test)));
  }));

  fastify.post('/', ...reposRoute({
      tags: ['Test'],
      summary: 'Create test',
      body: createTestSchema.body,
      response: {
        201: testResponseSchema,
        400: errorResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const cacheCoordinator = getCacheCoordinator();
    const body = request.body;
    const name = String(body.name ?? '').trim();
    if (!name) {
      return reply.status(400).send({ error: 'Test name is required' });
    }

    const rawIsPartOf = body.isPartOf;
    const isPartOfArray: string[] = Array.isArray(rawIsPartOf)
      ? rawIsPartOf.map((value: unknown) => String(value))
      : rawIsPartOf
        ? [String(rawIsPartOf)]
        : [];
    const parents = analyseReferences('Test', 'isPartOf', isPartOfArray, iri => cacheCoordinator.get(iri));
    if (parents.exactlyOneCount !== 1) {
      return reply.status(400).send({ error: 'Test must belong to exactly one library' });
    }
    if (parents.missing.length > 0) {
      return reply.status(400).send({ error: `Referenced entity ${parents.missing[0]} does not exist` });
    }
    if (parents.wrongType.length > 0) {
      return reply.status(400).send({ error: describeWrongType(parents.wrongType[0]) });
    }

    const subjectKind = String(body.subjectKind ?? '');
    if (!isSubjectKind(subjectKind)) {
      return reply.status(400).send({
        error: `Unknown subject kind "${subjectKind}". Expected one of: ${SUBJECT_KINDS.join(', ')}`,
      });
    }

    // The kind and the subject have to agree, and only a lookup can tell —
    // which is why this is here rather than in the entity model.
    const subject = String(body.subject ?? '');
    const subjectEntity = cacheCoordinator.get(subject) as { '@type'?: string } | null;
    if (!subjectEntity) {
      return reply.status(400).send({ error: `Subject ${subject} does not exist` });
    }
    const expectedType = ENTITY_TYPE_FOR_SUBJECT_KIND[subjectKind];
    if (subjectEntity['@type'] !== expectedType) {
      return reply.status(400).send({
        error: `Subject ${subject} is a ${subjectEntity['@type']}, but subjectKind says ${subjectKind}`,
      });
    }

    const tagCheck = analyseTags('Test', body.tags, isPartOfArray, iri =>
      cacheCoordinator.get(iri)
    );
    if (!tagCheck.ok) {
      return reply.status(400).send({ error: tagCheck.error });
    }

    /**
     * A body that says nothing about tags gets the subject's, copied.
     *
     * The distinction is between *silent* and *empty*: `tags: []` is a caller
     * saying "none", and is honoured, while an absent `tags` is a caller with
     * no opinion — and the useful default for a test is the tags of the thing
     * it tests, so that tagging a rule set `w3c` makes its tests part of the
     * `w3c` suite without a second pass over each one. See `inheritableTags`
     * for why this is a copy rather than a link.
     *
     * Here rather than in the client because tests are created from four
     * places in the UI, from the REST API and through MCP; a default that only
     * some callers apply is not a default. The UI's "Copy tags" checkbox is
     * this rule's switch — ticked omits `tags`, unticked sends `[]`.
     */
    const tags = tagCheck.tags ?? inheritableTags(subjectEntity, isPartOfArray, iri =>
      cacheCoordinator.get(iri)
    );

    const created = await repos.Test.create({
      $id: mintId('test'),
      name,
      description: body.description ?? null,
      subject,
      // Carried through rather than derived: a caller seeding their own
      // conformance suite is the one who knows which upstream test each of
      // theirs implements, and the W3C seeder is only the first such caller.
      ...(body.criterion ? { criterion: String(body.criterion) } : {}),
      subjectKind,
      isPartOf: isPartOfArray,
      ...(tags.length > 0 || tagCheck.tags !== undefined ? { tags } : {}),
    } as Partial<LdkitTest> & { $id: string });
    setEntityConcurrencyHeaders(reply, created);
    return reply.status(201).send(toRestApi(created));
  }));

  fastify.get('/:id', ...reposRoute({
      tags: ['Test'],
      summary: 'Get test',
      params: idParamSchema,
      response: { 200: testResponseSchema, 404: errorResponseSchema },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const entity = repos.Test.get(id) as LdkitTest | null;
    if (!entity) {
      return reply.status(404).send({ error: 'Not Found' });
    }
    setEntityConcurrencyHeaders(reply, entity);
    return reply.send(toRestApi(entity));
  }));

  fastify.put('/:id', ...reposRoute({
      tags: ['Test'],
      summary: 'Update test',
      params: idParamSchema,
      body: updateTestSchema.body,
      response: { 200: testResponseSchema, 404: errorResponseSchema },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    const updates = request.body;

    const current = repos.Test.get(id) as LdkitTest | null;
    if (!current) {
      return reply.status(404).send({ error: 'Not Found' });
    }

    const { valid, currentTag } = validateIfMatch(request, current);
    if (!valid) {
      return reply.status(412).send({
        error: 'Precondition Failed',
        expected: currentTag,
        current: toRestApi(current),
      });
    }

    // The subject is what every Test reference means; repointing it turns one
    // test into a different test, silently, while keeping its history. Rename
    // it, re-expect it, move it between libraries — but to test another
    // subject, write another test.
    if (updates.subject && updates.subject !== current.subject) {
      return reply.status(400).send({ error: "A test's subject cannot be changed; create a new test instead" });
    }

    let ids: string[] | undefined;
    if (updates.isPartOf) {
      ids = Array.isArray(updates.isPartOf)
        ? updates.isPartOf.map(value => String(value))
        : [String(updates.isPartOf)];
      const parents = analyseReferences('Test', 'isPartOf', ids, iri => getCacheCoordinator().get(iri));
      if (parents.exactlyOneCount !== 1) {
        return reply.status(400).send({ error: 'Test must belong to exactly one library' });
      }
      if (parents.wrongType.length > 0) {
        return reply.status(400).send({ error: describeWrongType(parents.wrongType[0]) });
      }
    }

    const tagCheck = analyseTags('Test', updates.tags, ids ?? current.isPartOf, iri =>
      getCacheCoordinator().get(iri)
    );
    if (!tagCheck.ok) {
      return reply.status(400).send({ error: tagCheck.error });
    }

    const updated = await repos.Test.update(id, {
      ...updates,
      ...(ids ? { isPartOf: ids } : {}),
      ...(tagCheck.tags !== undefined ? { tags: tagCheck.tags } : {}),
    } as Partial<LdkitTest>);
    if (!updated) {
      return reply.status(404).send({ error: 'Not Found' });
    }
    setEntityConcurrencyHeaders(reply, updated);
    return reply.send(toRestApi(updated));
  }));

  fastify.delete('/:id', ...reposRoute({
      tags: ['Test'],
      summary: 'Delete test and all its versions (cascading delete)',
      params: idParamSchema,
      response: { 204: { type: 'null' }, 404: errorResponseSchema },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    if (!repos.Test.get(id)) {
      return reply.status(404).send({ error: 'Not Found' });
    }

    const versions = (repos.TestVersion.list() as LdkitTestVersion[]).filter(v => v.isPartOf === id);
    for (const version of versions) {
      await deleteVersionCascade(repos, version.$id);
    }
    await repos.Test.delete(id);
    return reply.status(204).send();
  }));

  fastify.get('/:id/versions', ...reposRoute({
      tags: ['Test'],
      summary: 'List test versions',
      params: idParamSchema,
      response: { 200: { type: 'array', items: testVersionResponseSchema }, 404: errorResponseSchema },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    if (!repos.Test.get(id)) {
      return reply.status(404).send({ error: 'Test not found' });
    }
    const allCases = repos.TestCase.list() as LdkitTestCase[];
    const versions = (repos.TestVersion.list() as LdkitTestVersion[])
      .filter(v => v.isPartOf === id)
      .sort((a, b) => (a.version ?? 0) - (b.version ?? 0));
    return reply.send(versions.map(v => serializeVersion(v, allCases)));
  }));

  fastify.post('/:id/versions', ...reposRoute({
      tags: ['Test'],
      summary: 'Create test version',
      params: idParamSchema,
      body: createTestVersionBodySchema,
      response: { 201: testVersionResponseSchema, 400: errorResponseSchema, 404: errorResponseSchema },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    if (!repos.Test.get(id)) {
      return reply.status(404).send({ error: 'Test not found' });
    }

    try {
      // `?? undefined` on the fields the body marks `nullable: true` but the
      // writer declares non-nullable — a null there means "not supplied".
      const created = await createTestVersion(id, {
        ...request.body,
        immutable: request.body.immutable ?? undefined,
      });
      setEntityConcurrencyHeaders(reply, created);
      return reply.status(201).send(serializeVersion(created, repos.TestCase.list() as LdkitTestCase[]));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }));

  fastify.get('/:id/versions/:version', ...reposRoute({
      tags: ['Test'],
      summary: 'Get test version',
      params: versionParamSchema,
      response: { 200: testVersionResponseSchema, 404: errorResponseSchema },
    }, async ({ repos, reply, request }) => {
    const { id, version } = request.params;
    if (!repos.Test.get(id)) {
      return reply.status(404).send({ error: 'Test not found' });
    }
    const lookup = findVersionByNumber(
      repos.TestVersion.list() as LdkitTestVersion[],
      id,
      version,
      'test',
    );
    if (!lookup.ok) {
      return reply.status(lookup.status).send({ error: lookup.error });
    }
    const match = lookup.version;
    setEntityConcurrencyHeaders(reply, match);
    return reply.send(serializeVersion(match, repos.TestCase.list() as LdkitTestCase[]));
  }));

  // PATCH /tests/:id/versions/:version — annotate a version
  //
  // A version is a snapshot (issue #192). Cases already refused in-place edits,
  // for the reason that now covers the whole version: rewriting them would
  // silently change what a stored verdict was a verdict *about*. Only the
  // comment is writable.
  fastify.patch('/:id/versions/:version', ...reposRoute({
      tags: ['Test'],
      summary: 'Annotate a test version (comment only; content is immutable)',
      params: versionParamSchema,
      body: annotateTestVersionBodySchema,
      response: {
        200: testVersionResponseSchema,
        404: errorResponseSchema,
        409: contentPatchRejectedSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id, version } = request.params;
    if (!repos.Test.get(id)) {
      return reply.status(404).send({ error: 'Test not found' });
    }
    const lookup = findVersionByNumber(
      repos.TestVersion.list() as LdkitTestVersion[],
      id,
      version,
      'test',
    );
    if (!lookup.ok) {
      return reply.status(lookup.status).send({ error: lookup.error });
    }
    const match = lookup.version;

    const { annotations, rejection } = classifyVersionPatch(request.body as Record<string, unknown>);
    if (rejection) return reply.status(rejection.status).send(rejection);

    try {
      const updated = await annotateTestVersion(match.$id, {
        comment: annotations.comment as string | null | undefined,
        immutable: annotations.immutable as boolean | undefined,
      });
      setEntityConcurrencyHeaders(reply, updated);
      return reply.send(serializeVersion(updated, repos.TestCase.list() as LdkitTestCase[]));
    } catch (error) {
      if (error instanceof ImmutableEntityError) {
        return reply.status(409).send({ error: error.message });
      }
      const message = error instanceof Error ? error.message : String(error);
      return reply.status(400).send({ error: message });
    }
  }));

  fastify.delete('/:id/versions/:version', ...reposRoute({
      tags: ['Test'],
      summary: 'Delete test version',
      params: versionParamSchema,
      response: { 204: { type: 'null' }, 404: errorResponseSchema },
    }, async ({ repos, reply, request }) => {
    const { id, version } = request.params;
    if (!repos.Test.get(id)) {
      return reply.status(404).send({ error: 'Test not found' });
    }
    const lookup = findVersionByNumber(
      repos.TestVersion.list() as LdkitTestVersion[],
      id,
      version,
      'test',
    );
    if (!lookup.ok) {
      return reply.status(lookup.status).send({ error: lookup.error });
    }
    const match = lookup.version;
    await deleteVersionCascade(repos, match.$id);
    return reply.status(204).send();
  }));

  /**
   * Run a suite of tests — every test carrying one or more tags, or the tests
   * the caller names — in one request.
   *
   * The rail could already run a whole section or a whole heading by firing one
   * `/:id/run` per row, and for two hundred rows that is two hundred requests
   * whose only relationship is that a human clicked once. This is the same run
   * asked for as one thing: the server selects, runs in order, and answers with
   * every verdict plus the tally — so a tag is a suite you can name, and a
   * caller that is not the SPA (a script, CI) can ask for it without
   * reimplementing selection.
   *
   * Sequential, like the SPA's loop and for the same reason: a run can reach a
   * live backend, and firing two hundred at one endpoint is a load test nobody
   * asked for.
   *
   * A test that cannot run comes back as a **failed verdict, not an error**.
   * The whole point of running a suite is the tally, and a suite stops being a
   * suite the moment one unrunnable member ends the run.
   */
  fastify.post('/run', ...reposRoute({
      tags: ['Test'],
      summary: 'Run a suite of tests, selected by tag or named one by one',
      body: runByTagsBodySchema,
      response: {
        200: runByTagsResponseSchema,
        400: errorResponseSchema,
        403: errorResponseSchema,
        404: errorResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const cacheCoordinator = getCacheCoordinator();
    const body = request.body;

    // Negotiated before anything runs, for the same reason the sink is validated
    // early: an unsatisfiable `Accept` is a bad request, and discovering it after
    // two hundred tests have run wastes the run to say so.
    const negotiated = negotiateReportFormat(request.headers.accept);
    if (negotiated.kind === 'unacceptable') {
      return reply.status(406).send({
        error: `No supported export format in Accept: ${negotiated.accept}`,
      });
    }

    const tags = parseTagList(body.tags);
    const named = parseTestList(body.tests);
    if (tags.length > 0 && named.length > 0) {
      return reply.status(400).send({ error: 'Run by tags or by tests, not both' });
    }
    if (tags.length === 0 && named.length === 0) {
      return reply.status(400).send({ error: 'At least one tag or test is required' });
    }
    // Checked rather than silently returning nothing: a mistyped tag IRI and a
    // tag nothing carries are different mistakes, and "0 tests ran" reads as the
    // second when it was the first.
    const tagCheck = analyseReferences('Test', 'tags', tags, iri => cacheCoordinator.get(iri));
    if (tagCheck.missing.length > 0) {
      return reply.status(404).send({ error: `Tag ${tagCheck.missing[0]} does not exist` });
    }
    if (tagCheck.wrongType.length > 0) {
      return reply.status(400).send({ error: describeWrongType(tagCheck.wrongType[0]) });
    }

    const match: TagMatchMode = body.match === 'all' ? 'all' : 'any';
    const library = body.library ? String(body.library) : null;
    const all = (repos.Test.list() as LdkitTest[])
      .filter(test => (library ? test.isPartOf?.includes(library) : true));
    let selected: LdkitTest[];
    if (named.length > 0) {
      const byId = new Map(all.map(test => [test.$id, test]));
      const missing = named.find(id => !byId.has(id));
      // Same reasoning as the tag check above, and the same reason it is a 404
      // rather than a shrunken run: a report that quietly covered fewer tests
      // than were asked for is worse than no report.
      if (missing) {
        return reply.status(404).send({ error: `Test ${missing} does not exist` });
      }
      // The caller's order, not the repository's: the run reads back as the
      // list it was asked for.
      selected = named.map(id => byId.get(id) as LdkitTest);
    } else {
      selected = all.filter(test => matchesTags(test, tags, match));
    }

    // Execute is checked per library the selection reaches. The route guard
    // cannot do it: there is no `:id` in the path and the body names tags, not
    // an entity, so without this a caller with no grants at all would run
    // whatever the tags happened to select.
    for (const owner of new Set(selected.flatMap(test => test.isPartOf ?? []))) {
      requireLibraryMode(request, owner, 'execute');
    }

    const runner = new TestRunner();
    // One list, not three. Every consumer downstream — the JSON summary, the
    // EARL assertions, every export format — is a projection of the same runs,
    // and keeping parallel arrays in step is how a test ends up in the tally but
    // missing from the report.
    const entries: TestReportEntry[] = [];

    for (const test of selected) {
      const versions = (repos.TestVersion.list() as LdkitTestVersion[]).filter(v => v.isPartOf === test.$id);
      const target = versions.find(v => v.$id === test.currentVersion)
        ?? versions.sort((a, b) => (a.version ?? 0) - (b.version ?? 0)).at(-1);
      if (!target) {
        entries.push({
          result: notRunResult(test.$id, '', 'Test has no version to run'),
          subject: test.subject,
          criterion: test.criterion ?? null,
        });
        continue;
      }
      try {
        const result = await runner.runTestVersion(target.$id);
        entries.push({ result, subject: test.subject, backend: target.backend, criterion: test.criterion ?? null });
      } catch (error) {
        if (error instanceof TestNotRunnableError || error instanceof TestVersionError) {
          entries.push({
            result: notRunResult(test.$id, target.$id, error.message, target.expectationKind),
            subject: test.subject,
            backend: target.backend,
            criterion: test.criterion ?? null,
          });
          continue;
        }
        throw error;
      }
    }

    /*
     * Filed after the suite has run, not per test, so that pruning reads the
     * stored history once instead of once per verdict (issue #179). Failures
     * to record are swallowed inside the store: the run happened, and the
     * tally is the caller's answer whether or not it was written down.
     */
    await recordTestRuns(entries.map(entry => ({
      result: entry.result,
      subject: entry.subject,
      backend: entry.backend,
      suite: reportSuite(tags),
    })));

    const results = entries.map(entry => entry.result);
    const passed = results.filter(result => result.passed === true).length;
    const summary = {
      tags,
      match,
      requested: selected.length,
      passed,
      failed: results.length - passed,
      results,
    };

    const reportInput: TestReportInput = { suite: reportSuite(tags), entries };

    return negotiated.kind === 'format'
      ? sendRenderedReport(reply, negotiated.format, reportInput)
      : reply.send(summary);
  }));

  fastify.post('/:id/run', ...reposRoute({
      tags: ['Test'],
      summary: 'Run a test and report its verdict',
      params: idParamSchema,
      body: {
        type: 'object',
        properties: {
          version: { type: 'integer', nullable: true },
        },
        additionalProperties: false,
      },
      response: { 200: testRunResponseSchema, 400: errorResponseSchema, 403: errorResponseSchema, 404: errorResponseSchema },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;

    // Before the lookup, as on the by-tag route: an unsatisfiable `Accept` is a
    // bad request regardless of whether the test it names exists.
    const negotiated = negotiateReportFormat(request.headers.accept);
    if (negotiated.kind === 'unacceptable') {
      return reply.status(406).send({
        error: `No supported export format in Accept: ${negotiated.accept}`,
      });
    }

    const test = repos.Test.get(id) as LdkitTest | null;
    if (!test) {
      return reply.status(404).send({ error: 'Test not found' });
    }

    const requestedVersion = request.body?.version;
    const versions = (repos.TestVersion.list() as LdkitTestVersion[]).filter(v => v.isPartOf === id);
    const target = typeof requestedVersion === 'number'
      ? versions.find(v => Number(v.version) === requestedVersion)
      : versions.find(v => v.$id === test.currentVersion)
        ?? versions.sort((a, b) => (a.version ?? 0) - (b.version ?? 0)).at(-1);

    if (!target) {
      return reply.status(404).send({ error: 'Test has no version to run' });
    }

    try {
      const result = await new TestRunner().runTestVersion(target.$id);
      await recordTestRun({
        result,
        subject: test.subject,
        backend: target.backend,
        suite: test.$id,
      });
      // The test IRI is the suite name here: one test, its cases inside it, so
      // an export of one run and an export of a tag run read the same way.
      const reportInput: TestReportInput = {
        suite: test.$id,
        entries: [{ result, subject: test.subject, backend: target.backend, criterion: test.criterion ?? null }],
      };

      return negotiated.kind === 'format'
        ? sendRenderedReport(reply, negotiated.format, reportInput)
        : reply.send(result);
    } catch (error) {
      // A test that cannot run is a 400 with a reason, not a failing test: the
      // difference between "the subject is wrong" and "the test is wrong" is
      // the whole value of the report. Unchanged by a requested export format —
      // there is no run to export, and a JUnit file reporting zero tests would
      // be read by CI as a pass.
      //
      // The by-tag route differs deliberately: there, an unrunnable member is a
      // `cantTell` verdict inside a suite that still has a tally to report.
      if (error instanceof TestNotRunnableError || error instanceof TestVersionError) {
        return reply.status(400).send({ error: error.message });
      }
      throw error;
    }
  }));

  /**
   * One test's run history, newest first.
   *
   * The verdict a run route returns says "is it green now"; this says "since
   * when", which is the question a red row actually raises. Bounded by
   * retention rather than by this route — see `TestRunStore` — so an unlimited
   * request is answerable, and `limit` is for a caller that wants the last few.
   */
  fastify.get('/:id/runs', ...reposRoute({
      tags: ['Test'],
      summary: 'List stored runs of a test, newest first',
      params: idParamSchema,
      querystring: runHistoryQuerySchema,
      response: {
        200: { type: 'array', items: storedRunResponseSchema },
        404: errorResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id } = request.params;
    // Checked rather than answering `[]`: a test that does not exist and a test
    // that has never run are different facts, and an empty history reads as the
    // second.
    if (!repos.Test.get(id)) {
      return reply.status(404).send({ error: 'Test not found' });
    }
    const runs = await listTestRuns(id, request.query?.limit);
    return reply.send(runs.map(run => toRestApi(run)));
  }));

  /**
   * One stored run, with its case rows — or rendered, on `Accept`, as a report.
   *
   * Exporting a *past* run is what a stored run buys that a live one could not:
   * every format is a pure function of `TestReportInput`, so a run read back
   * renders exactly as it did the day it ran, with no re-execution. That is
   * also the answer to "each format costs a run of its own": run once, export
   * the stored run as many times as you like.
   */
  fastify.get('/:id/runs/:runId', ...reposRoute({
      tags: ['Test'],
      summary: 'Get a stored run, with its cases or rendered as a report',
      params: {
        type: 'object',
        properties: { id: { type: 'string' }, runId: { type: 'string' } },
        required: ['id', 'runId'],
      },
      response: {
        200: storedRunDetailResponseSchema,
        404: errorResponseSchema,
        406: errorResponseSchema,
      },
    }, async ({ repos, reply, request }) => {
    const { id, runId } = request.params;

    const negotiated = negotiateReportFormat(request.headers.accept);
    if (negotiated.kind === 'unacceptable') {
      return reply.status(406).send({
        error: `No supported export format in Accept: ${negotiated.accept}`,
      });
    }

    const test = repos.Test.get(id) as LdkitTest | null;
    if (!test) {
      return reply.status(404).send({ error: 'Test not found' });
    }
    const stored = await getTestRun(runId);
    // Two ids that must agree: a run reached through the wrong test would let a
    // caller with grants on one library read a run from another.
    if (!stored || stored.run.test !== id) {
      return reply.status(404).send({ error: 'Test run not found' });
    }

    if (negotiated.kind === 'format') {
      return sendRenderedReport(reply, negotiated.format, {
        suite: stored.run.suite || stored.run.test,
        // The criterion comes from the test as it stands, not from the stored
        // run: a run records what happened, and which upstream test this one
        // implements is a fact about the test that outlives any one run of it.
        entries: [{ ...toReportEntry(stored), criterion: test.criterion ?? null }],
      });
    }

    return reply.send({
      ...toRestApi(stored.run),
      cases: stored.cases.map(row => toRestApi(row)),
    });
  }));
}
