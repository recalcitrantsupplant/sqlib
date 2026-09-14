import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  BenchmarkExperimentService,
  assertBenchmarkVersionDependencies,
} from '../../src/lib/BenchmarkExperimentService.js';

const hoisted = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}));

vi.mock('../../src/lib/CacheCoordinatorProvider.js', () => ({
  getCacheCoordinator: () => ({
    list: hoisted.list,
    get: hoisted.get,
    create: hoisted.create,
    update: hoisted.update,
    delete: hoisted.delete,
  }),
}));

vi.mock('../../src/lib/id.js', () => ({
  mintId: vi.fn(() => 'urn:sqlib:benchmark-experiment-version:next'),
}));

describe('BenchmarkExperimentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the next experiment version and updates currentVersion', async () => {
    const experimentId = 'urn:sqlib:benchmark-experiment:1';
    hoisted.list.mockReturnValue([
      {
        $id: 'urn:sqlib:benchmark-experiment-version:1',
        '@type': 'BenchmarkExperimentVersion',
        isPartOf: experimentId,
        version: 1,
        subjectSpecs: '[]',
      },
    ]);
    hoisted.create.mockResolvedValue({
      $id: 'urn:sqlib:benchmark-experiment-version:next',
      '@type': 'BenchmarkExperimentVersion',
      isPartOf: experimentId,
      version: 2,
      subjectSpecs: '[]',
    });
    hoisted.update.mockResolvedValue({ $id: experimentId });

    const service = new BenchmarkExperimentService();
    const created = await service.createVersion(experimentId, { subjectSpecs: [] });

    expect(hoisted.create).toHaveBeenCalledWith(
      'BenchmarkExperimentVersion',
      expect.objectContaining({ isPartOf: experimentId, version: 2, subjectSpecs: '[]' }),
    );
    expect(hoisted.update).toHaveBeenCalledWith(
      'BenchmarkExperiment',
      experimentId,
      { currentVersion: 'urn:sqlib:benchmark-experiment-version:next' },
    );
    expect(created.version).toBe(2);
    expect(created.subjectSpecs).toEqual([]);
  });

  it('serializes subjectSpecs on version updates', async () => {
    const experimentId = 'urn:sqlib:benchmark-experiment:2';
    const versionId = 'urn:sqlib:benchmark-experiment-version:2';
    hoisted.list.mockReturnValue([
      {
        $id: versionId,
        '@type': 'BenchmarkExperimentVersion',
        isPartOf: experimentId,
        version: 1,
        subjectSpecs: '[]',
      },
    ]);
    hoisted.update.mockResolvedValue({
      $id: versionId,
      '@type': 'BenchmarkExperimentVersion',
      isPartOf: experimentId,
      version: 1,
      subjectSpecs: JSON.stringify([{ subject: 'urn:sqlib:query-version:1' }]),
    });

    const service = new BenchmarkExperimentService();
    const updated = await service.updateVersion(experimentId, 1, {
      subjectSpecs: [{ subject: 'urn:sqlib:query-version:1' }],
      repeats: 3,
    });

    expect(hoisted.update).toHaveBeenCalledWith(
      'BenchmarkExperimentVersion',
      versionId,
      expect.objectContaining({
        repeats: 3,
        subjectSpecs: JSON.stringify([{ subject: 'urn:sqlib:query-version:1' }]),
      }),
    );
    expect(updated?.subjectSpecs).toEqual([{ subject: 'urn:sqlib:query-version:1' }]);
  });
});

/*
 * Which entity types are legal on which axis is a per-subject-kind rule, and
 * the shape cannot state it — a subject spec is three lists of IRIs. This is
 * where a plan the runner could not execute is refused, at freeze, so the
 * rules live here rather than being discovered mid-run.
 */
describe('assertBenchmarkVersionDependencies — rule set subjects', () => {
  const versionId = 'urn:sqlib:benchmark-experiment-version:v';
  const ruleSetVersionId = 'urn:sqlib:rule-set-version:1';
  const queryVersionId = 'urn:sqlib:query-version:1';
  const tupleSetId = 'urn:sqlib:tuple-set:1';
  const tupleSetVersionId = 'urn:sqlib:tuple-set-version:1';
  const dataGraphVersionId = 'urn:sqlib:data-graph-version:1';
  const argumentSetVersionId = 'urn:sqlib:argument-set-version:1';
  const backendId = 'urn:sqlib:backend:1';

  beforeEach(() => {
    hoisted.get.mockImplementation((id: string) => {
      if (id === ruleSetVersionId) return { $id: id, '@type': 'RuleSetVersion', immutable: true };
      if (id === queryVersionId) return { $id: id, '@type': 'QueryVersion', immutable: true };
      if (id === tupleSetId) return { $id: id, '@type': 'TupleSet', currentVersion: tupleSetVersionId };
      if (id === tupleSetVersionId) return { $id: id, '@type': 'TupleSetVersion' };
      if (id === dataGraphVersionId) return { $id: id, '@type': 'DataGraphVersion' };
      if (id === argumentSetVersionId) return { $id: id, '@type': 'ArgumentSetVersion' };
      if (id === backendId) return { $id: id, '@type': 'Backend' };
      return null;
    });
  });

  it('accepts a frozen rule set with tuple sets and data graphs', () => {
    expect(() => assertBenchmarkVersionDependencies(versionId, [
      { subject: ruleSetVersionId, inputs: [tupleSetId], dataGraphs: [dataGraphVersionId] },
    ])).not.toThrow();
  });

  it('refuses a backend on a rule set — the store axis is collapsed', () => {
    expect(() => assertBenchmarkVersionDependencies(versionId, [
      { subject: ruleSetVersionId, backends: [backendId] },
    ])).toThrow(/takes no backends/);
  });

  it('refuses a data graph on a query — only a rule set has a graph axis', () => {
    expect(() => assertBenchmarkVersionDependencies(versionId, [
      { subject: queryVersionId, backends: [backendId], dataGraphs: [dataGraphVersionId] },
    ])).toThrow(/takes no data graphs/);
  });

  it('refuses an argument set on a rule set’s tabular axis', () => {
    expect(() => assertBenchmarkVersionDependencies(versionId, [
      { subject: ruleSetVersionId, inputs: [argumentSetVersionId] },
    ])).toThrow(/must be a TupleSet or TupleSetVersion/);
  });

  it('refuses a rule set version that is not frozen', () => {
    hoisted.get.mockImplementation((id: string) => (id === ruleSetVersionId
      ? { $id: id, '@type': 'RuleSetVersion', immutable: false }
      : null));

    expect(() => assertBenchmarkVersionDependencies(versionId, [
      { subject: ruleSetVersionId },
    ])).toThrow(/must be frozen/);
  });
});
