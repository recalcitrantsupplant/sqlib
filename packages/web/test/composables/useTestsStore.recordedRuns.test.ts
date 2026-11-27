/**
 * In demo mode the Tests rail shows the runs the server recorded. They come
 * from one `GET /tests/runs/latest`, which replaced two requests per test.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const api = vi.hoisted(() => ({
  listTests: vi.fn(),
  latestRecordedTestRuns: vi.fn(),
  latestRecordedTestRun: vi.fn(),
}));

vi.mock('@/composables/useApiClient', () => ({ useApiClient: () => api }));
vi.mock('@/composables/useApiClient.js', () => ({ useApiClient: () => api }));
vi.mock('@/composables/useDeploymentMode.js', () => ({
  useDeploymentMode: () => ({ ensureLoaded: async () => undefined, isDemo: { value: true } }),
}));

const tests = [
  { id: 'urn:sqlib:test:a', name: 'A', subject: 'urn:sqlib:query:q', subjectKind: 'query', isPartOf: ['urn:sqlib:library:l'], currentVersion: 'urn:sqlib:test-version:a1' },
  { id: 'urn:sqlib:test:b', name: 'B', subject: 'urn:sqlib:query:q', subjectKind: 'query', isPartOf: ['urn:sqlib:library:l'], currentVersion: 'urn:sqlib:test-version:b1' },
];

const storedRun = {
  id: 'urn:sqlib:test-run:r1',
  test: 'urn:sqlib:test:a',
  testVersion: 'urn:sqlib:test-version:a1',
  outcome: 'passed',
  expectationKind: 'bindings',
  ranAt: '2026-11-01T00:00:00.000Z',
  cases: [{ id: 'urn:sqlib:test-run-case:c1', name: 'one', position: 0, outcome: 'passed' }],
};

async function flush() {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('recorded runs in demo mode', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
    api.listTests.mockResolvedValue(tests);
  });

  it('reads every recorded run in one request', async () => {
    api.latestRecordedTestRuns.mockResolvedValue([storedRun]);
    const { useTestsStore } = await import('@/composables/useTestsStore');
    const store = useTestsStore();
    await store.loadTests();
    await flush();

    expect(api.latestRecordedTestRuns).toHaveBeenCalledTimes(1);
    expect(api.latestRecordedTestRun).not.toHaveBeenCalled();
    expect(store.lastRunByTest.value['urn:sqlib:test:a']?.passed).toBe(true);
    expect(store.lastRunByTest.value['urn:sqlib:test:b']).toBeUndefined();

    await store.loadTests();
    await flush();
    expect(api.latestRecordedTestRuns).toHaveBeenCalledTimes(1);
  });

  it('reads each test on its own from a server without the batch route', async () => {
    api.latestRecordedTestRuns.mockRejectedValue(Object.assign(new Error('Not Found'), { statusCode: 404 }));
    api.latestRecordedTestRun.mockImplementation(async (id: string) => (id === storedRun.test ? storedRun : null));
    const { useTestsStore } = await import('@/composables/useTestsStore');
    const store = useTestsStore();
    await store.loadTests();
    await flush();

    expect(api.latestRecordedTestRun).toHaveBeenCalledTimes(2);
    expect(store.lastRunByTest.value['urn:sqlib:test:a']?.passed).toBe(true);
  });
});
