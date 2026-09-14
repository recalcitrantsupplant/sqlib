/**
 * Turning a library's tests into runnable examples.
 *
 * A `TestCase` is already an example: it names a query, supplies arguments, and
 * records what came back. Strip the assertion and what remains is exactly the
 * payload the exported runtime takes — `ArgumentSetService.exportRuntimePayload`
 * returns `{ arguments, limits, offsets }` in the runtime's own `CallPayload`
 * shape, so nothing has to be translated.
 *
 * What that buys is two audiences at once. A person opening the demo page gets
 * prefilled, one-click calls; a language model reading the bundle gets worked
 * input/output pairs next to the signatures, which is most of what it needs to
 * fold the library into an app.
 *
 * Two rules shape the failure behaviour, both for the same reason — an export
 * must not be hostage to the state of the tests:
 *
 * - A test that cannot be turned into an example is *skipped and reported*,
 *   never fatal. A stale test is a normal thing to find in a library.
 * - Expectations are dropped unless asked for. The endpoint a bundle is pointed
 *   at holds different data from the one the test ran against, so an expectation
 *   travelling with the example is reference material at best and a false
 *   promise at worst.
 *
 * See `docs/guides/static-export.md`.
 */

import type { ExportBundle, QueryExample, WireArgumentSet } from '@sparql-query-lib/runtime';
import type { LdkitTest } from '../../persistence/schemas/TestSchema.js';
import type { LdkitTestVersion } from '../../persistence/schemas/TestVersionSchema.js';
import type { LdkitTestCase } from '../../persistence/schemas/TestCaseSchema.js';

/** How many of a query's tests become examples. */
export type ExampleMode = 'all' | 'first' | 'none';

/** The runtime payload an argument set resolves to. */
export interface ResolvedArgumentPayload {
  arguments: WireArgumentSet[];
  limits: Array<{ name: string; value: number }>;
  offsets: Array<{ name: string; value: number }>;
}

/** The reads this module needs, so a route and a script can both supply them. */
export interface ExampleSource {
  listTests(): LdkitTest[];
  getTestVersion(id: string): LdkitTestVersion | null;
  getTestCase(id: string): LdkitTestCase | null;
  resolveArgumentPayload(argumentSetVersionId: string): Promise<ResolvedArgumentPayload>;
}

export interface CollectExamplesOptions {
  mode?: ExampleMode;
  /** Carry each case's recorded answer. Off by default; see the module note. */
  includeExpected?: boolean;
}

/** A test that could not become an example, and why. */
export interface SkippedExample {
  id: string;
  name: string;
  reason: string;
}

/** One query to find examples for, as derived from a compiled bundle. */
export interface ExampleTarget {
  /** The bundle key the examples will hang off. */
  slug: string;
  /** The stable Query IRI the tests point at. */
  queryIri: string;
  /** Parameter slots the compiled template has; examples must match it. */
  slotCount: number;
}

export interface CollectedExamples {
  examples: Record<string, QueryExample[]>;
  skipped: SkippedExample[];
}

/** Order tests deterministically, so re-exporting an unchanged library matches. */
function byNameThenId(a: LdkitTest, b: LdkitTest): number {
  return (a.name ?? '').localeCompare(b.name ?? '') || a.$id.localeCompare(b.$id);
}

/**
 * Resolve a library's tests into examples, keyed by bundle slug.
 *
 * Only `subjectKind: 'query'` tests are considered: a group or rule-set test
 * describes something the export does not carry.
 */
export async function collectQueryExamples(
  source: ExampleSource,
  libraryId: string,
  targets: readonly ExampleTarget[],
  options: CollectExamplesOptions = {},
): Promise<CollectedExamples> {
  const mode = options.mode ?? 'all';
  const examples: Record<string, QueryExample[]> = {};
  const skipped: SkippedExample[] = [];
  if (mode === 'none' || targets.length === 0) return { examples, skipped };

  const testsByQuery = new Map<string, LdkitTest[]>();
  for (const test of source.listTests()) {
    if (test.subjectKind !== 'query') continue;
    if (!test.isPartOf?.includes(libraryId)) continue;
    const existing = testsByQuery.get(test.subject);
    if (existing) existing.push(test);
    else testsByQuery.set(test.subject, [test]);
  }

  for (const target of targets) {
    const tests = (testsByQuery.get(target.queryIri) ?? []).slice().sort(byNameThenId);
    const collected: QueryExample[] = [];

    for (const test of tests) {
      if (mode === 'first' && collected.length > 0) break;
      const testName = test.name ?? test.$id;

      if (!test.currentVersion) {
        skipped.push({ id: test.$id, name: testName, reason: 'The test has no current version.' });
        continue;
      }
      const version = source.getTestVersion(test.currentVersion);
      if (!version) {
        skipped.push({
          id: test.$id,
          name: testName,
          reason: `Its current version ${test.currentVersion} could not be found.`,
        });
        continue;
      }

      const cases = (version.cases ?? [])
        .map((id) => source.getTestCase(id))
        .filter((testCase): testCase is LdkitTestCase => testCase !== null)
        .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

      for (const testCase of cases) {
        if (mode === 'first' && collected.length > 0) break;
        const caseName = testCase.name ?? `${testName} #${testCase.position ?? 0}`;

        // A query with slots and a case with no arguments cannot be run as-is.
        // One with no slots needs none, and is a perfectly good example.
        if (!testCase.argumentSetVersion) {
          if (target.slotCount > 0) {
            skipped.push({
              id: testCase.$id,
              name: caseName,
              reason: 'The case supplies no arguments, but the query takes some.',
            });
            continue;
          }
          collected.push(buildExample(caseName, { arguments: [], limits: [], offsets: [] }, test, testCase, options));
          continue;
        }

        let payload: ResolvedArgumentPayload;
        try {
          payload = await source.resolveArgumentPayload(testCase.argumentSetVersion);
        } catch (error) {
          skipped.push({
            id: testCase.$id,
            name: caseName,
            reason: `Its arguments could not be resolved: ${(error as Error).message}`,
          });
          continue;
        }

        // The signature moved since the test was written. Reporting beats both
        // guessing and failing the export over somebody else's stale test.
        if (payload.arguments.length !== target.slotCount) {
          skipped.push({
            id: testCase.$id,
            name: caseName,
            reason: `It supplies ${payload.arguments.length} argument sets but the query now has ${target.slotCount} parameter slots.`,
          });
          continue;
        }

        collected.push(buildExample(caseName, payload, test, testCase, options));
      }
    }

    if (collected.length > 0) examples[target.slug] = collected;
  }

  skipped.sort((a, b) => a.name.localeCompare(b.name));
  return { examples, skipped };
}

function buildExample(
  name: string,
  payload: ResolvedArgumentPayload,
  test: LdkitTest,
  testCase: LdkitTestCase,
  options: CollectExamplesOptions,
): QueryExample {
  // A case that seeded its own data still yields a valid payload; it is only its
  // expectation that means nothing against somebody else's endpoint.
  const dataDependent = Boolean(testCase.dataGraphVersion || testCase.tupleSeeds);

  return {
    name,
    arguments: payload.arguments,
    ...(payload.limits.length > 0 ? { limits: payload.limits } : {}),
    ...(payload.offsets.length > 0 ? { offsets: payload.offsets } : {}),
    ...(options.includeExpected && testCase.expected ? { expected: testCase.expected } : {}),
    ...(options.includeExpected && testCase.expectedFormat
      ? { expectedFormat: testCase.expectedFormat }
      : {}),
    ...(dataDependent ? { dataDependent: true } : {}),
    sourceTest: test.$id,
    sourceCase: testCase.$id,
  };
}

/**
 * Attach examples to a compiled bundle, in place of the caller doing the
 * slug/IRI bookkeeping itself.
 *
 * Targets come from the bundle rather than from the query list, so the slot
 * counts examples are checked against are the compiled ones — the only counts
 * that matter at run time.
 */
export async function attachExamplesToBundle(
  bundle: ExportBundle,
  source: ExampleSource,
  libraryId: string,
  options: CollectExamplesOptions = {},
): Promise<{ bundle: ExportBundle; skipped: SkippedExample[] }> {
  const targets: ExampleTarget[] = Object.entries(bundle.queries)
    .filter(([, query]) => typeof query.sourceQuery === 'string')
    .map(([slug, query]) => ({
      slug,
      queryIri: query.sourceQuery as string,
      slotCount: query.template.slots.length,
    }));

  const { examples, skipped } = await collectQueryExamples(source, libraryId, targets, options);

  for (const [slug, list] of Object.entries(examples)) {
    bundle.queries[slug].examples = list;
  }
  return { bundle, skipped };
}
