/**
 * `useTestRunScope` keeps one last run per library.
 *
 * A run starts from one library's tests. Before this, the app kept one run for
 * all libraries, so the Runs tab and its count showed library A's run while
 * library B was open.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ref } from 'vue';

const library = vi.hoisted(() => ({ id: null as unknown as { value: string | null } }));

vi.mock('@/composables/useActiveLibrary', () => ({
  useActiveLibrary: () => ({ activeLibraryId: library.id }),
}));

const STORAGE_KEY = 'sqlib.testRunScope.v2';

async function freshModule() {
  vi.resetModules();
  return (await import('@/composables/useTestRunScope')).useTestRunScope;
}

describe('useTestRunScope', () => {
  beforeEach(() => {
    localStorage.clear();
    library.id = ref<string | null>('lib:a');
  });

  it('shows each library its own last run', async () => {
    const useTestRunScope = await freshModule();
    const runs = useTestRunScope();

    runs.beginRun({ kind: 'all', label: 'all tests', testIds: ['t:a1', 't:a2', 't:a3'] });
    runs.endRun({ testIds: ['t:a1', 't:a2', 't:a3'] });
    expect(runs.scope.value?.testIds).toHaveLength(3);

    library.id.value = 'lib:b';
    expect(runs.scope.value).toBeNull();
    expect(runs.hasRun.value).toBe(false);

    runs.beginRun({ kind: 'all', label: 'all tests', testIds: ['t:b1'] });
    runs.endRun({ testIds: ['t:b1'] });
    expect(runs.scope.value?.testIds).toEqual(['t:b1']);

    library.id.value = 'lib:a';
    expect(runs.scope.value?.testIds).toEqual(['t:a1', 't:a2', 't:a3']);
  });

  it('records a run in the library it started in, when the library changes during the run', async () => {
    const useTestRunScope = await freshModule();
    const runs = useTestRunScope();

    runs.beginRun({ kind: 'all', label: 'all tests', testIds: ['t:a1', 't:a2'] });
    expect(runs.running.value).toBe(true);

    library.id.value = 'lib:b';
    expect(runs.running.value).toBe(false);
    runs.noteAnswered(['t:a1']);
    runs.endRun({ testIds: ['t:a1', 't:a2'] });
    expect(runs.scope.value).toBeNull();

    library.id.value = 'lib:a';
    expect(runs.scope.value?.answeredIds).toEqual(['t:a1']);
    expect(runs.scope.value?.finishedAt).not.toBeNull();
  });

  it('counts runs begun, and not library changes', async () => {
    const useTestRunScope = await freshModule();
    const runs = useTestRunScope();

    runs.beginRun({ kind: 'all', label: 'all tests', testIds: ['t:a1'] });
    expect(runs.begun.value).toBe(1);
    library.id.value = 'lib:b';
    expect(runs.begun.value).toBe(1);
  });

  it('keeps each library’s run across a reload', async () => {
    let runs = (await freshModule())();
    runs.beginRun({ kind: 'all', label: 'all tests', testIds: ['t:a1'] });
    runs.endRun();

    runs = (await freshModule())();
    expect(runs.scope.value?.testIds).toEqual(['t:a1']);
    library.id.value = 'lib:b';
    expect(runs.scope.value).toBeNull();
  });

  it('drops the old single run, whose library is not recorded', async () => {
    localStorage.setItem('sqlib.testRunScope.v1', JSON.stringify({ label: 'all tests', testIds: ['t:x'] }));
    const runs = (await freshModule())();
    expect(runs.scope.value).toBeNull();
    expect(localStorage.getItem('sqlib.testRunScope.v1')).toBeNull();
  });

  it('clears only the current library’s run', async () => {
    const runs = (await freshModule())();
    runs.beginRun({ kind: 'all', label: 'all tests', testIds: ['t:a1'] });
    runs.endRun();
    library.id.value = 'lib:b';
    runs.beginRun({ kind: 'all', label: 'all tests', testIds: ['t:b1'] });
    runs.endRun();

    runs.clearRun();
    expect(runs.scope.value).toBeNull();
    library.id.value = 'lib:a';
    expect(runs.scope.value?.testIds).toEqual(['t:a1']);
    expect(Object.keys(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'))).toEqual(['lib:a']);
  });
});
