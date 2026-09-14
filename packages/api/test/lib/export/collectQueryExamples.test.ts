import { describe, expect, it, vi } from 'vitest';
import {
  attachExamplesToBundle,
  collectQueryExamples,
  type ExampleSource,
  type ResolvedArgumentPayload,
} from '../../../src/lib/export/collectQueryExamples.js';
import type { LdkitTest } from '../../../src/persistence/schemas/TestSchema.js';
import type { LdkitTestVersion } from '../../../src/persistence/schemas/TestVersionSchema.js';
import type { LdkitTestCase } from '../../../src/persistence/schemas/TestCaseSchema.js';

const LIBRARY = 'urn:sqlib:library:main';
const QUERY = 'urn:sqlib:query:people';

const PAYLOAD: ResolvedArgumentPayload = {
  arguments: [
    { head: { vars: ['city'] }, arguments: { bindings: [{ city: { type: 'uri', value: 'urn:Perth' } }] } },
  ],
  limits: [],
  offsets: [],
};

function test(partial: Partial<LdkitTest> & { $id: string; name: string }): LdkitTest {
  return {
    subject: QUERY,
    subjectKind: 'query',
    isPartOf: [LIBRARY],
    currentVersion: `${partial.$id}:v1`,
    ...partial,
  } as LdkitTest;
}

function source(
  tests: LdkitTest[],
  versions: Record<string, LdkitTestVersion>,
  cases: Record<string, LdkitTestCase>,
  resolve: (id: string) => Promise<ResolvedArgumentPayload> = async () => PAYLOAD,
): ExampleSource {
  return {
    listTests: () => tests,
    getTestVersion: (id) => versions[id] ?? null,
    getTestCase: (id) => cases[id] ?? null,
    resolveArgumentPayload: vi.fn(resolve),
  };
}

const target = (slotCount = 1) => [{ slug: 'people', queryIri: QUERY, slotCount }];

function oneTest(caseOverrides: Partial<LdkitTestCase>[] = [{}]) {
  const cases: Record<string, LdkitTestCase> = {};
  caseOverrides.forEach((overrides, index) => {
    cases[`c${index}`] = {
      $id: `c${index}`,
      isPartOf: 't1:v1',
      position: index,
      argumentSetVersion: 'as1',
      ...overrides,
    } as LdkitTestCase;
  });
  return source(
    [test({ $id: 't1', name: 'People by city' })],
    { 't1:v1': { $id: 't1:v1', isPartOf: 't1', version: 1, expectationKind: 'bindings', cases: Object.keys(cases) } as LdkitTestVersion },
    cases,
  );
}

describe('collectQueryExamples', () => {
  it('turns a test case into a runnable payload', async () => {
    const result = await collectQueryExamples(oneTest([{ name: 'Perth' }]), LIBRARY, target());

    expect(result.skipped).toEqual([]);
    expect(result.examples.people).toEqual([
      {
        name: 'Perth',
        arguments: PAYLOAD.arguments,
        sourceTest: 't1',
        sourceCase: 'c0',
      },
    ]);
  });

  it('names an unnamed case after its test and position', async () => {
    const result = await collectQueryExamples(oneTest([{ position: 3 }]), LIBRARY, target());
    expect(result.examples.people[0].name).toBe('People by city #3');
  });

  it('orders cases by position', async () => {
    const src = oneTest([
      { name: 'third', position: 2 },
      { name: 'first', position: 0 },
      { name: 'second', position: 1 },
    ]);
    const result = await collectQueryExamples(src, LIBRARY, target());
    expect(result.examples.people.map((e) => e.name)).toEqual(['first', 'second', 'third']);
  });

  describe('modes', () => {
    const src = () => oneTest([{ name: 'a' }, { name: 'b' }]);

    it('takes every case by default', async () => {
      const result = await collectQueryExamples(src(), LIBRARY, target());
      expect(result.examples.people).toHaveLength(2);
    });

    it('takes only the first when asked', async () => {
      const result = await collectQueryExamples(src(), LIBRARY, target(), { mode: 'first' });
      expect(result.examples.people.map((e) => e.name)).toEqual(['a']);
    });

    it('takes none when asked, without touching the store', async () => {
      const source = src();
      const result = await collectQueryExamples(source, LIBRARY, target(), { mode: 'none' });
      expect(result.examples).toEqual({});
      expect(source.resolveArgumentPayload).not.toHaveBeenCalled();
    });
  });

  describe('expectations', () => {
    const src = () =>
      oneTest([{ name: 'a', expected: '{"head":{}}', expectedFormat: 'application/sparql-results+json' }]);

    it('drops them by default', async () => {
      const result = await collectQueryExamples(src(), LIBRARY, target());
      expect(result.examples.people[0].expected).toBeUndefined();
      expect(result.examples.people[0].expectedFormat).toBeUndefined();
    });

    it('carries them when asked', async () => {
      const result = await collectQueryExamples(src(), LIBRARY, target(), { includeExpected: true });
      expect(result.examples.people[0]).toMatchObject({
        expected: '{"head":{}}',
        expectedFormat: 'application/sparql-results+json',
      });
    });
  });

  it('flags a case that seeded its own data', async () => {
    const src = oneTest([{ name: 'seeded', dataGraphVersion: 'urn:dg:1' }]);
    const result = await collectQueryExamples(src, LIBRARY, target());
    expect(result.examples.people[0].dataDependent).toBe(true);
  });

  it('flags a case seeded through tuple seeds too', async () => {
    const src = oneTest([{ name: 'seeded', tupleSeeds: '{}' }]);
    const result = await collectQueryExamples(src, LIBRARY, target());
    expect(result.examples.people[0].dataDependent).toBe(true);
  });

  describe('selection', () => {
    it('ignores tests belonging to another library', async () => {
      const src = source([test({ $id: 't1', name: 'Elsewhere', isPartOf: ['urn:other'] })], {}, {});
      const result = await collectQueryExamples(src, LIBRARY, target());
      expect(result.examples).toEqual({});
      expect(result.skipped).toEqual([]);
    });

    it('ignores tests whose subject is a group or rule set', async () => {
      const src = source([test({ $id: 't1', name: 'Group test', subjectKind: 'queryGroup' })], {}, {});
      const result = await collectQueryExamples(src, LIBRARY, target());
      expect(result.examples).toEqual({});
    });

    it('ignores tests for a query that is not being exported', async () => {
      const src = oneTest([{ name: 'a' }]);
      const result = await collectQueryExamples(src, LIBRARY, [
        { slug: 'other', queryIri: 'urn:sqlib:query:other', slotCount: 1 },
      ]);
      expect(result.examples).toEqual({});
    });
  });

  describe('a test that cannot become an example is reported, never fatal', () => {
    it('reports a stale signature rather than failing', async () => {
      // The query gained a slot since the test was written.
      const result = await collectQueryExamples(oneTest([{ name: 'stale' }]), LIBRARY, target(2));
      expect(result.examples).toEqual({});
      expect(result.skipped[0].reason).toMatch(/supplies 1 argument sets but the query now has 2/);
    });

    it('reports a case with no arguments for a parameterised query', async () => {
      const src = oneTest([{ name: 'bare', argumentSetVersion: undefined }]);
      const result = await collectQueryExamples(src, LIBRARY, target(1));
      expect(result.skipped[0].reason).toMatch(/supplies no arguments/);
    });

    it('accepts a case with no arguments when the query takes none', async () => {
      const src = oneTest([{ name: 'bare', argumentSetVersion: undefined }]);
      const result = await collectQueryExamples(src, LIBRARY, target(0));
      expect(result.examples.people[0]).toMatchObject({ name: 'bare', arguments: [] });
    });

    it('reports a test with no current version', async () => {
      const src = source([test({ $id: 't1', name: 'Draft', currentVersion: undefined })], {}, {});
      const result = await collectQueryExamples(src, LIBRARY, target());
      expect(result.skipped[0].reason).toMatch(/no current version/);
    });

    it('reports a dangling version pointer', async () => {
      const src = source([test({ $id: 't1', name: 'Broken' })], {}, {});
      const result = await collectQueryExamples(src, LIBRARY, target());
      expect(result.skipped[0].reason).toMatch(/could not be found/);
    });

    it('reports arguments that fail to resolve', async () => {
      const src = source(
        [test({ $id: 't1', name: 'Unresolvable' })],
        { 't1:v1': { $id: 't1:v1', isPartOf: 't1', version: 1, expectationKind: 'bindings', cases: ['c0'] } as LdkitTestVersion },
        { c0: { $id: 'c0', isPartOf: 't1:v1', position: 0, argumentSetVersion: 'as1' } as LdkitTestCase },
        async () => {
          throw new Error('argument set version not found');
        },
      );
      const result = await collectQueryExamples(src, LIBRARY, target());
      expect(result.skipped[0].reason).toMatch(/could not be resolved: argument set version not found/);
    });
  });
});

describe('attachExamplesToBundle', () => {
  const bundle = () =>
    ({
      version: 1 as const,
      library: { id: LIBRARY },
      queries: {
        people: {
          template: { text: 'x', slots: [{ start: 0, end: 1, vars: ['city'] }], prefixes: [] },
          queryType: 'SELECT' as const,
          limitParameters: [],
          offsetParameters: [],
          inferredInputs: [['city']],
          textHash: 'sha256-x',
          sourceQuery: QUERY,
        },
      },
    });

  it('hangs examples off the matching bundle key', async () => {
    const result = await attachExamplesToBundle(bundle(), oneTest([{ name: 'Perth' }]), LIBRARY);
    expect(result.bundle.queries.people.examples?.[0].name).toBe('Perth');
  });

  it('checks arity against the compiled template, not the stored metadata', async () => {
    const target = bundle();
    target.queries.people.template.slots = [];
    const result = await attachExamplesToBundle(target, oneTest([{ name: 'Perth' }]), LIBRARY);
    expect(result.bundle.queries.people.examples).toBeUndefined();
    expect(result.skipped[0].reason).toMatch(/now has 0 parameter slots/);
  });

  it('skips a query with no recorded source, since nothing can point at it', async () => {
    const target = bundle();
    delete target.queries.people.sourceQuery;
    const result = await attachExamplesToBundle(target, oneTest([{ name: 'Perth' }]), LIBRARY);
    expect(result.bundle.queries.people.examples).toBeUndefined();
  });
});
