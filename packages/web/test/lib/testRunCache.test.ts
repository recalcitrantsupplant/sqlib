/**
 * The browser-local cache of test verdicts.
 *
 * The point of the cache is that a run of a few hundred tests survives a
 * reload. The point of *these* tests is the other half: that it never shows a
 * verdict which has stopped being true. A green dot beside a test you have
 * since edited is worse than no dot, so a run stamped with a superseded
 * version is dropped rather than shown, and so is one for a test that is gone.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { TestRunResult } from '@/composables/useApiClient';
import { loadRuns, saveRuns, pruneStaleRuns, clearRuns } from '@/lib/testRunCache';

function run(overrides: Partial<TestRunResult> = {}): TestRunResult {
  return {
    testId: 'urn:test:1',
    testVersionId: 'urn:test:1:v1',
    passed: true,
    message: 'ok',
    expectationKind: 'bindings',
    hermetic: true,
    durationMs: 3,
    subjectVersionId: null,
    ranAt: '2026-08-17T00:00:00.000Z',
    cases: [],
    passedCount: 1,
    failedCount: 0,
    ...overrides,
  };
}

/** A localStorage that behaves like one, so quota and JSON are real. */
function installStorage(): Storage {
  const data = new Map<string, string>();
  const store: Storage = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  };
  vi.stubGlobal('window', { localStorage: store });
  return store;
}

describe('the test run cache', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    installStorage();
    clearRuns();
  });

  it('gives back what it was given', () => {
    saveRuns({ 'urn:test:1': run() });
    expect(loadRuns()).toEqual({ 'urn:test:1': run() });
  });

  it('starts empty rather than throwing when there is no storage', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('window', undefined);
    expect(loadRuns()).toEqual({});
    expect(() => saveRuns({ 'urn:test:1': run() })).not.toThrow();
  });

  it('ignores a payload it cannot read', () => {
    const store = installStorage();
    store.setItem('sqlib.testRuns.v1', '{not json');
    expect(loadRuns()).toEqual({});
  });

  it('drops entries whose key does not match the run inside them', () => {
    const store = installStorage();
    // A hand-edited or migrated payload could disagree with itself; keying off
    // the wrong test would attach a verdict to a test that never produced it.
    store.setItem(
      'sqlib.testRuns.v1',
      JSON.stringify({ 'urn:test:2': run({ testId: 'urn:test:1' }) }),
    );
    expect(loadRuns()).toEqual({});
  });

  it('evicts the oldest runs when the payload will not fit', () => {
    const big = 'x'.repeat(400_000);
    const runs: Record<string, TestRunResult> = {};
    for (let index = 0; index < 8; index += 1) {
      const testId = `urn:test:${index}`;
      runs[testId] = run({
        testId,
        ranAt: `2026-08-1${index}T00:00:00.000Z`,
        cases: [
          {
            caseId: `${testId}:case`,
            name: 'case',
            position: 0,
            passed: true,
            message: '',
            detail: null,
            result: big,
            durationMs: 1,
          },
        ],
      });
    }
    saveRuns(runs);

    const kept = loadRuns();
    expect(Object.keys(kept).length).toBeGreaterThan(0);
    expect(Object.keys(kept).length).toBeLessThan(8);
    // What survives is the newest, because that is what the reader just did.
    expect(kept['urn:test:7']).toBeDefined();
    expect(kept['urn:test:0']).toBeUndefined();
  });

  it('keeps nothing at all rather than one run bigger than the budget', () => {
    saveRuns({
      'urn:test:1': run({
        cases: [
          {
            caseId: 'c',
            name: 'case',
            position: 0,
            passed: true,
            message: '',
            detail: null,
            result: 'x'.repeat(3_000_000),
            durationMs: 1,
          },
        ],
      }),
    });
    expect(loadRuns()).toEqual({});
  });
});

describe('pruning stale verdicts', () => {
  it('drops a verdict for a test that no longer exists', () => {
    const kept = pruneStaleRuns({ 'urn:test:1': run() }, []);
    expect(kept).toEqual({});
  });

  it('drops a verdict produced against a superseded version', () => {
    const kept = pruneStaleRuns({ 'urn:test:1': run({ testVersionId: 'urn:test:1:v1' }) }, [
      { id: 'urn:test:1', currentVersion: 'urn:test:1:v2' },
    ]);
    expect(kept).toEqual({});
  });

  it('keeps a verdict produced against the current version', () => {
    const current = run({ testVersionId: 'urn:test:1:v2' });
    const kept = pruneStaleRuns({ 'urn:test:1': current }, [
      { id: 'urn:test:1', currentVersion: 'urn:test:1:v2' },
    ]);
    expect(kept).toEqual({ 'urn:test:1': current });
  });

  it('keeps a run that never reached a version', () => {
    // The "could not be run" placeholder carries no version but does carry the
    // message explaining why, which is the whole of its value.
    const failed = run({ passed: false, testVersionId: '', message: 'backend unreachable' });
    const kept = pruneStaleRuns({ 'urn:test:1': failed }, [
      { id: 'urn:test:1', currentVersion: 'urn:test:1:v2' },
    ]);
    expect(kept).toEqual({ 'urn:test:1': failed });
  });
});
