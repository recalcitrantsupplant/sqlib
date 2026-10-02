import { describe, it, expect, vi, beforeEach } from 'vitest';
import { overrideCacheCoordinatorProvider } from '../../src/lib/CacheCoordinatorProvider.js';
import { backfillBenchmarkOwnership } from '../../scripts/backfill-benchmark-ownership.js';

const MINE = 'urn:sqlib:library:hydrology';
const THEIRS = 'urn:sqlib:library:payroll';

const entities = new Map<string, Record<string, unknown>>();
const update = vi.fn(async (_type: string, id: string, patch: Record<string, unknown>) => {
  const next = { ...entities.get(id), ...patch };
  entities.set(id, next);
  return next;
});
const coordinator = {
  get: (id: string) => (entities.get(id) ?? null) as never,
  list: (type: string) => [...entities.values()].filter(entity => entity['@type'] === type) as never,
  update: update as never,
};
// `resolveOwningLibrary` walks containers through the provider, not the argument.
overrideCacheCoordinatorProvider({ getCacheCoordinator: () => coordinator, getEntityRepositories: () => ({}) });

function experiment(id: string, subjects: string[], fields: Record<string, unknown> = {}) {
  entities.set(id, { '@type': 'BenchmarkExperiment', $id: id, name: id, ...fields });
  entities.set(`${id}:v1`, {
    '@type': 'BenchmarkExperimentVersion', $id: `${id}:v1`, isPartOf: id, version: 1,
    subjectSpecs: JSON.stringify(subjects.map(subject => ({ subject }))),
  });
}

function queryVersion(id: string, library: string) {
  entities.set(`${id}:query`, { '@type': 'Query', $id: `${id}:query`, isPartOf: [library] });
  entities.set(id, { '@type': 'QueryVersion', $id: id, isPartOf: `${id}:query` });
}

beforeEach(() => {
  entities.clear();
  update.mockClear();
  entities.set(MINE, { '@type': 'Library', $id: MINE });
  entities.set(THEIRS, { '@type': 'Library', $id: THEIRS });
  queryVersion('urn:qv:a', MINE);
  queryVersion('urn:qv:b', MINE);
  queryVersion('urn:qv:c', THEIRS);
});

describe('backfillBenchmarkOwnership', () => {
  it('assigns the one library every subject lives in', async () => {
    experiment('urn:exp:1', ['urn:qv:a', 'urn:qv:b']);

    const [decision] = await backfillBenchmarkOwnership(coordinator);

    expect(decision.library).toBe(MINE);
    expect(entities.get('urn:exp:1')?.isPartOf).toBe(MINE);
  });

  it('leaves an experiment spanning libraries for a decision, unless --library names one', async () => {
    experiment('urn:exp:2', ['urn:qv:a', 'urn:qv:c']);

    expect((await backfillBenchmarkOwnership(coordinator))[0].library).toBeNull();
    expect(update).not.toHaveBeenCalled();

    expect((await backfillBenchmarkOwnership(coordinator, { fallbackLibrary: THEIRS }))[0].library).toBe(THEIRS);
    expect(entities.get('urn:exp:2')?.isPartOf).toBe(THEIRS);
  });

  it('writes nothing on a dry run, and leaves owned experiments alone', async () => {
    experiment('urn:exp:3', ['urn:qv:a']);
    experiment('urn:exp:4', ['urn:qv:c'], { isPartOf: THEIRS });

    const decisions = await backfillBenchmarkOwnership(coordinator, { dryRun: true });

    expect(decisions.map(decision => decision.experiment)).toEqual(['urn:exp:3']);
    expect(update).not.toHaveBeenCalled();
  });
});
